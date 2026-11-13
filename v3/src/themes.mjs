import {normalizeTheme,themeReferences,PRESETS} from '../shared/theme-schema.mjs';
import {SECTION_TYPES} from '../shared/page-schema.mjs';
import {resolvePageSections} from './pages.mjs';
import {HttpError} from './auth.mjs';
import {autofillThemeImages} from './shopify-import.mjs';
// Online Store themes. One theme can be live; the rest are the theme library. As in Shopify, saving
// the live theme changes the storefront immediately; staff duplicate it to work on a private copy.
// Writes lock the row and check an integer revision so two editors cannot overwrite each other.
const bad=message=>{throw new HttpError(400,message);};
const key=value=>{const s=String(value);if(!/^[1-9]\d{0,17}$/.test(s))bad('Invalid ID');return s;};
const MAX_THEMES=20;
const shape=t=>({...t,id:String(t.id)});
const audit=(db,actor,action,id)=>db.query("INSERT INTO audit_events(actor,action,entity,entity_id) VALUES ($1,$2,'themes',$3)",[actor,action,id]);
const liveLock=db=>db.query('SELECT pg_advisory_xact_lock(7348305)');
function content(value){try{return normalizeTheme(value);}catch(e){if(e.validation)bad(e.message);throw e;}}
function name(value){const n=String(value??'').trim();if(!n||n.length>60)bad('Theme name must be 1–60 characters');return n;}
function object(input,allowed){if(!input||typeof input!=='object'||Array.isArray(input))bad('Object required');if(Object.keys(input).some(k=>!allowed.includes(k)))bad('Unknown field');}
// References live inside JSON, so check them explicitly: ready media and existing collections/products.
async function checkReferences(db,theme){
 const refs=themeReferences(theme);
 const missing=async(sql,ids)=>ids.size?ids.size-(await db.query(sql,[[...ids]])).rows.length:0;
 if(await missing("SELECT id FROM media WHERE state='ready' AND id = ANY($1::bigint[])",refs.media))bad('Choose verified ready images for every section');
 if(await missing('SELECT id FROM collections WHERE id = ANY($1::bigint[])',refs.collections))bad('A section uses a collection that does not exist');
 if(await missing('SELECT id FROM products WHERE id = ANY($1::bigint[])',refs.products))bad('A section uses a product that does not exist');
}
async function locked(db,id,revision){
 const theme=(await db.query('SELECT * FROM themes WHERE id=$1 AND NOT archived FOR UPDATE',[key(id)])).rows[0];if(!theme)throw new HttpError(404,'Theme not found');
 if(revision!==theme.revision)throw new HttpError(409,'Changed by another staff member. Reload before saving.');
 return theme;
}
const columns='id,name,preset,is_live,revision,published_at,created_at,updated_at';
export async function listThemes(db){
 const rows=(await db.query(`SELECT ${columns} FROM themes WHERE NOT archived ORDER BY is_live DESC,updated_at DESC,id DESC`)).rows.map(shape);
 return {items:rows,presets:Object.entries(PRESETS).map(([id,p])=>({id,label:p.label,description:p.description})),max:MAX_THEMES};
}
export async function themeDetail(db,id){
 const theme=(await db.query('SELECT * FROM themes WHERE id=$1 AND NOT archived',[key(id)])).rows[0];if(!theme)throw new HttpError(404,'Theme not found');
 return shape(theme);
}
// New theme from a preset ({name, preset}) or a copy of an existing theme ({name, from}).
export async function createTheme(db,input,actor){
 object(input,['name','preset','from']);
 if((input.preset==null)===(input.from==null))bad('Choose a preset or a theme to copy');
 if(Number((await db.query('SELECT count(*) AS n FROM themes WHERE NOT archived')).rows[0].n)>=MAX_THEMES)bad(`Keep up to ${MAX_THEMES} themes. Remove one first.`);
 let preset,body,fallback;
 if(input.from!=null){const source=await themeDetail(db,input.from);preset=source.preset;body=source.content;fallback=`Copy of ${source.name}`.slice(0,60);}
 else{const p=PRESETS[input.preset];if(!p)bad('Unknown theme preset');preset=input.preset;body=p.build();fallback=p.label;}
 // New preset themes pick up the matching Shopify images automatically once they are imported.
 const clean=content(body);if(input.from==null)await autofillThemeImages(db,clean);await checkReferences(db,clean);
 const theme=(await db.query('INSERT INTO themes(name,preset,content,updated_by) VALUES ($1,$2,$3,$4) RETURNING *',[name(input.name??fallback),preset,JSON.stringify(clean),actor])).rows[0];
 await audit(db,actor,input.from!=null?'duplicate':'create',theme.id);return shape(theme);
}
export async function saveTheme(db,id,input,actor){
 object(input,['revision','name','content']);const theme=await locked(db,id,input.revision);
 const next=input.content!==undefined?content(input.content):theme.content;if(input.content!==undefined)await checkReferences(db,next);
 const saved=(await db.query('UPDATE themes SET name=$1,content=$2,revision=revision+1,updated_at=now(),updated_by=$3 WHERE id=$4 RETURNING *',[input.name!==undefined?name(input.name):theme.name,JSON.stringify(next),actor,theme.id])).rows[0];
 await audit(db,actor,'update',theme.id);return shape(saved);
}
// "Auto-fill images": puts imported Shopify images into empty image slots of a saved theme.
export async function autofillTheme(db,id,input,actor){
 object(input,['revision']);const theme=await locked(db,id,input.revision);
 const next=content(theme.content),filled=await autofillThemeImages(db,next);
 if(!filled)return {...shape(theme),filled};
 await checkReferences(db,next);
 const saved=(await db.query('UPDATE themes SET content=$1,revision=revision+1,updated_at=now(),updated_by=$2 WHERE id=$3 RETURNING *',[JSON.stringify(next),actor,theme.id])).rows[0];
 await audit(db,actor,'autofill',theme.id);return {...shape(saved),filled};
}
// Makes this theme the storefront; the previous live theme returns to the library unchanged.
export async function publishTheme(db,id,input,actor){
 object(input,['revision']);await liveLock(db);const theme=await locked(db,id,input.revision);
 const clean=content(theme.content);await checkReferences(db,clean);
 await db.query('UPDATE themes SET is_live=false,revision=revision+1,updated_at=now(),updated_by=$1 WHERE is_live AND id<>$2',[actor,theme.id]);
 const saved=(await db.query('UPDATE themes SET is_live=true,published_at=now(),revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 RETURNING *',[actor,theme.id])).rows[0];
 await audit(db,actor,'publish',theme.id);return shape(saved);
}
// "Remove" archives a library theme; the live theme must be replaced first.
export async function archiveTheme(db,id,input,actor){
 object(input,['revision']);await liveLock(db);const theme=await locked(db,id,input.revision);
 if(theme.is_live)bad('Publish another theme before removing the live theme');
 await db.query('UPDATE themes SET archived=true,revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2',[actor,theme.id]);
 await audit(db,actor,'archive',theme.id);return {id:String(theme.id),archived:true};
}

// Rendering data: visible sections only, product lists resolved with the public storefront rule
// (active product in an active collection), so previews show exactly what visitors will see.
const STOREFRONT_PRODUCTS=`SELECT p.id,p.title,p.handle,p.description,p.price_minor,p.featured_media_id,p.option_names,
 (SELECT count(*)::int FROM product_variants v WHERE v.product_id=p.id AND v.active) AS variant_count
 FROM products p WHERE p.status='active' AND EXISTS(SELECT 1 FROM product_collections pc JOIN collections c ON c.id=pc.collection_id WHERE pc.product_id=p.id AND c.status='active')`;
async function tabProducts(db,collectionId,limit){
 if(!collectionId)return [];
 const rows=(await db.query(STOREFRONT_PRODUCTS+" AND p.id IN (SELECT pc.product_id FROM product_collections pc JOIN collections c ON c.id=pc.collection_id WHERE c.id=$1 AND c.status='active') ORDER BY p.title,p.id LIMIT $2",[collectionId,limit])).rows;
 const out=[];
 for(const p of rows){
  const i=(p.option_names??[]).findIndex(n=>/colou?r/i.test(n));
  const colours=i<0?[]:(await db.query('SELECT DISTINCT option_values[$2::int] AS v FROM product_variants WHERE product_id=$1 AND active ORDER BY 1 LIMIT 8',[p.id,i+1])).rows.map(r=>r.v).filter(Boolean);
  out.push({id:String(p.id),title:p.title,handle:p.handle,price_minor:p.price_minor,variant_count:p.variant_count,featured_media_id:p.featured_media_id==null?null:String(p.featured_media_id),colours,excerpt:String(p.description??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,70)});
 }
 return out;
}
async function resolveTheme(db,theme){
 const visible=list=>list.filter(s=>!s.hidden);
 const sections=[];
 for(const s of visible(theme.sections)){
  if(SECTION_TYPES[s.type]){sections.push(...await resolvePageSections(db,[s]));continue;}
  if(s.type==='product_tabs'){sections.push({...s,tabs:await Promise.all(s.settings.tabs.map(t=>tabProducts(db,t.collection_id,s.settings.limit)))});continue;}
  sections.push(s);
 }
 return {settings:theme.settings,header:visible(theme.header),sections,footer:visible(theme.footer)};
}
async function mediaFor(db,resolved,cloud){
 const ids=themeReferences(resolved).media;
 for(const s of resolved.sections){for(const p of s.products??[])if(p.featured_media_id)ids.add(p.featured_media_id);for(const tab of s.tabs??[])for(const p of tab)if(p.featured_media_id)ids.add(p.featured_media_id);}
 const media={};
 if(ids.size&&cloud){const rows=(await db.query("SELECT * FROM media WHERE state='ready' AND id = ANY($1::bigint[])",[[...ids]])).rows;for(const m of rows)media[String(m.id)]=cloud.preview(m);}
 return media;
}
// Saved theme preview for any staff role (viewers included).
export async function previewTheme(db,id,cloud){
 const theme=await themeDetail(db,id);const resolved=await resolveTheme(db,content(theme.content));
 return {theme:resolved,name:theme.name,media:await mediaFor(db,resolved,cloud),expiresIn:300};
}
// Unsaved editor state: validated and resolved like a save, but nothing is written.
export async function previewThemeDraft(db,input,cloud){
 object(input,['content']);const clean=content(input.content);await checkReferences(db,clean);
 const resolved=await resolveTheme(db,clean);
 return {theme:resolved,media:await mediaFor(db,resolved,cloud),expiresIn:300};
}
// Public, unauthenticated: the live theme only. Images are referenced by ID; public image
// delivery is not enabled yet (originals stay private), so the storefront shows placeholders.
export async function publicTheme(db){
 const theme=(await db.query('SELECT content FROM themes WHERE is_live AND NOT archived')).rows[0];
 if(!theme)throw new HttpError(404,'No live theme');
 return {theme:await resolveTheme(db,content(theme.content)),checkoutAvailable:false};
}
