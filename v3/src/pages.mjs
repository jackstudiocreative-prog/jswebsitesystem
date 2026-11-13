import rules from '../../shared/catalog.js';
import {normalizeSections} from '../shared/page-schema.mjs';
import {HttpError} from './auth.mjs';
// Website Editor: drafts live on `pages`; publishing appends an immutable `page_revisions` snapshot
// and points the page at it. Every write runs in the request transaction with a row lock and an
// integer revision, so two staff members cannot overwrite each other's draft.
const bad=message=>{throw new HttpError(400,message);};
const key=value=>{const s=String(value);if(!/^[1-9]\d{0,17}$/.test(s))bad('Invalid ID');return s;};
const status=p=>p.published_revision_id==null?'draft':p.has_unpublished_changes?'changes':'published';
const shape=p=>({...p,id:String(p.id),published_revision_id:p.published_revision_id==null?null:String(p.published_revision_id),status:status(p)});
const audit=(db,actor,action,id)=>db.query("INSERT INTO audit_events(actor,action,entity,entity_id) VALUES ($1,$2,'pages',$3)",[actor,action,id]);
function sections(value){try{return normalizeSections(value);}catch(e){if(e.validation)bad(e.message);throw e;}}
// References live inside JSON, so check them explicitly: ready media, existing collections/products.
async function checkReferences(db,list){
 const media=new Set(),collections=new Set(),products=new Set();
 for(const s of list){const v=s.settings;if(v.media_id)media.add(v.media_id);if(v.collection_id)collections.add(v.collection_id);for(const p of v.product_ids??[])products.add(p);}
 const missing=async(sql,ids)=>{if(!ids.size)return 0;const found=(await db.query(sql,[[...ids]])).rows.length;return ids.size-found;};
 if(await missing("SELECT id FROM media WHERE state='ready' AND id = ANY($1::bigint[])",media))bad('Choose verified ready images for every section');
 if(await missing('SELECT id FROM collections WHERE id = ANY($1::bigint[])',collections))bad('A product grid uses a collection that does not exist');
 if(await missing('SELECT id FROM products WHERE id = ANY($1::bigint[])',products))bad('A product grid uses a product that does not exist');
}
function fields(input,current){
 const v={...current,...input};
 const title=String(v.title??'').trim();if(!title||title.length>120)bad('Page title must be 1–120 characters');
 const slug=rules.slug(v.slug||title);if(!slug||slug.length>80)bad('Page URL must be 1–80 letters, numbers or hyphens');
 const seo_title=String(v.seo_title??'').trim(),seo_description=String(v.seo_description??'').trim();
 if(seo_title.length>70)bad('SEO title must be 70 characters or fewer');if(seo_description.length>160)bad('SEO description must be 160 characters or fewer');
 return {title,slug,seo_title,seo_description};
}
const allowed=['title','slug','seo_title','seo_description','sections'];
function object(input,extra=[]){if(!input||typeof input!=='object'||Array.isArray(input))bad('Object required');if(Object.keys(input).some(k=>![...allowed,...extra].includes(k)))bad('Unknown field');}
async function locked(db,id,revision){
 const page=(await db.query('SELECT * FROM pages WHERE id=$1 FOR UPDATE',[key(id)])).rows[0];if(!page)throw new HttpError(404,'Page not found');
 if(revision!==page.revision)throw new HttpError(409,'Changed by another staff member. Reload before saving.');
 return page;
}
export async function listPages(db,params){
 const args=[],where=[];const q=params.get('q')??'';if(q.length>150)bad('Search too long');
 if(q){args.push('%'+q+'%');where.push(`(p.title ILIKE $${args.length} OR p.slug ILIKE $${args.length})`);}
 const st=params.get('status');if(st){if(!['draft','published','changes'].includes(st))bad('Invalid filter');where.push(st==='draft'?'p.published_revision_id IS NULL':st==='published'?'p.published_revision_id IS NOT NULL AND NOT p.has_unpublished_changes':'p.published_revision_id IS NOT NULL AND p.has_unpublished_changes');}
 const limit=Number(params.get('limit')??25),offset=Number(params.get('offset')??0);if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)bad('Invalid paging');
 const filter=where.length?' WHERE '+where.join(' AND '):'';
 const total=Number((await db.query('SELECT count(*) AS n FROM pages p'+filter,args)).rows[0].n);
 const rows=(await db.query(`SELECT p.id,p.slug,p.title,p.published_revision_id,p.has_unpublished_changes,p.revision,p.updated_at,jsonb_array_length(p.sections) AS section_count,r.number AS live_number,r.published_at FROM pages p LEFT JOIN page_revisions r ON r.id=p.published_revision_id${filter} ORDER BY p.title,p.id LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset])).rows;
 return {items:rows.map(shape),total,limit,offset};
}
export async function pageDetail(db,id){
 const page=(await db.query('SELECT * FROM pages WHERE id=$1',[key(id)])).rows[0];if(!page)throw new HttpError(404,'Page not found');
 const revisions=(await db.query('SELECT r.id,r.number,r.slug,r.title,r.published_by,r.published_at,s.role AS published_by_role FROM page_revisions r LEFT JOIN staff s ON s.subject=r.published_by WHERE r.page_id=$1 ORDER BY r.number DESC LIMIT 30',[page.id])).rows.map(r=>({...r,id:String(r.id),live:String(r.id)===String(page.published_revision_id)}));
 const redirects=(await db.query('SELECT from_slug,created_at FROM page_redirects WHERE page_id=$1 ORDER BY created_at DESC',[page.id])).rows;
 return {...shape(page),revisions,redirects};
}
// Draft routing changes must not affect the live site. Serialize cross-table URL ownership checks
// before locking a page, since drafts and published revisions keep different slugs.
const routeLock=db=>db.query('SELECT pg_advisory_xact_lock(7348304)');
async function checkSlug(db,slug,id=null){
 if((await db.query('SELECT p.id FROM pages p JOIN page_revisions r ON r.id=p.published_revision_id WHERE r.slug=$1 AND ($2::bigint IS NULL OR p.id<>$2)',[slug,id])).rows.length)throw new HttpError(409,'This URL belongs to a published page.');
}
export async function createPage(db,input,actor){
 object(input);const row=fields(input,{}),list=sections(input.sections??[]);await checkReferences(db,list);
 await routeLock(db);await checkSlug(db,row.slug);
 const page=(await db.query('INSERT INTO pages(slug,title,seo_title,seo_description,sections,updated_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',[row.slug,row.title,row.seo_title,row.seo_description,JSON.stringify(list),actor])).rows[0];
 await audit(db,actor,'create',page.id);return shape(page);
}
export async function savePage(db,id,input,actor){
 object(input,['revision']);await routeLock(db);const page=await locked(db,id,input.revision);
 const row=fields(Object.fromEntries(Object.entries(input).filter(([k])=>k!=='revision'&&k!=='sections')),page),list=input.sections!==undefined?sections(input.sections):page.sections;
 await checkReferences(db,list);
 if(row.slug!==page.slug)await checkSlug(db,row.slug,page.id);
 const saved=(await db.query('UPDATE pages SET title=$1,slug=$2,seo_title=$3,seo_description=$4,sections=$5,has_unpublished_changes=true,revision=revision+1,updated_at=now(),updated_by=$6 WHERE id=$7 RETURNING *',[row.title,row.slug,row.seo_title,row.seo_description,JSON.stringify(list),actor,page.id])).rows[0];
 await audit(db,actor,'update',page.id);return shape(saved);
}
export async function publishPage(db,id,input,actor){
 object(input,['revision']);await routeLock(db);const page=await locked(db,id,input?.revision);
 const list=sections(page.sections);await checkReferences(db,list);fields({},page);
 await checkSlug(db,page.slug,page.id);
 const oldLive=page.published_revision_id==null?null:(await db.query('SELECT slug FROM page_revisions WHERE id=$1',[page.published_revision_id])).rows[0];
 await db.query('DELETE FROM page_redirects WHERE from_slug=$1',[page.slug]);
 if(oldLive&&oldLive.slug!==page.slug){await db.query('DELETE FROM page_redirects WHERE from_slug=$1',[oldLive.slug]);await db.query('INSERT INTO page_redirects(from_slug,page_id) VALUES ($1,$2)',[oldLive.slug,page.id]);}
 const number=(await db.query('SELECT coalesce(max(number),0)+1 AS n FROM page_revisions WHERE page_id=$1',[page.id])).rows[0].n;
 const rev=(await db.query('INSERT INTO page_revisions(page_id,number,slug,title,seo_title,seo_description,sections,published_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[page.id,number,page.slug,page.title,page.seo_title,page.seo_description,JSON.stringify(list),actor])).rows[0];
 const saved=(await db.query('UPDATE pages SET published_revision_id=$1,has_unpublished_changes=false,revision=revision+1,updated_at=now(),updated_by=$2 WHERE id=$3 RETURNING *',[rev.id,actor,page.id])).rows[0];
 await audit(db,actor,'publish',page.id);return shape(saved);
}
export async function unpublishPage(db,id,input,actor){
 object(input,['revision']);await routeLock(db);const page=await locked(db,id,input.revision);if(page.published_revision_id==null)bad('Page is not published');
 const saved=(await db.query('UPDATE pages SET published_revision_id=NULL,revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 RETURNING *',[actor,page.id])).rows[0];
 await audit(db,actor,'unpublish',page.id);return shape(saved);
}
// Restoring copies an old published version into the draft; nothing goes live until it is published.
export async function restoreRevision(db,id,revisionId,input,actor){
 object(input,['revision']);const page=await locked(db,id,input.revision);
 const rev=(await db.query('SELECT * FROM page_revisions WHERE id=$1 AND page_id=$2',[key(revisionId),page.id])).rows[0];if(!rev)throw new HttpError(404,'Version not found');
 const saved=(await db.query('UPDATE pages SET title=$1,seo_title=$2,seo_description=$3,sections=$4,has_unpublished_changes=true,revision=revision+1,updated_at=now(),updated_by=$5 WHERE id=$6 RETURNING *',[rev.title,rev.seo_title,rev.seo_description,JSON.stringify(rev.sections),actor,page.id])).rows[0];
 await audit(db,actor,'restore',page.id);return shape(saved);
}
// Visible sections with product grids resolved using the public storefront rule (active product in an
// active collection), so the preview shows exactly what visitors will see.
async function resolve(db,list){
 const out=[];
 for(const s of list){
  if(s.hidden)continue;const section={...s,settings:{...s.settings}};
  if(s.type==='product_grid'){
   const base=`SELECT p.id,p.title,p.handle,p.price_minor,p.featured_media_id,(SELECT count(*)::int FROM product_variants v WHERE v.product_id=p.id AND v.active) AS variant_count FROM products p WHERE p.status='active' AND EXISTS(SELECT 1 FROM product_collections pc JOIN collections c ON c.id=pc.collection_id WHERE pc.product_id=p.id AND c.status='active')`;
   let rows=[];
   if(s.settings.source==='manual'&&s.settings.product_ids.length){const found=(await db.query(base+' AND p.id = ANY($1::bigint[])',[s.settings.product_ids])).rows;rows=s.settings.product_ids.map(id=>found.find(p=>String(p.id)===id)).filter(Boolean);}
   else if(s.settings.source==='collection')rows=(await db.query(base+(s.settings.collection_id?" AND p.id IN (SELECT pc.product_id FROM product_collections pc JOIN collections c ON c.id=pc.collection_id WHERE c.id=$2 AND c.status='active')":' AND $2::bigint IS NULL')+' ORDER BY p.title,p.id LIMIT $1',[s.settings.limit,s.settings.collection_id])).rows;
   section.products=rows.slice(0,s.settings.limit).map(p=>({...p,id:String(p.id),featured_media_id:p.featured_media_id==null?null:String(p.featured_media_id)}));
  }
  out.push(section);
 }
 return out;
}
async function renderData(db,content,cloud){
 const list=await resolve(db,content.sections);
 const ids=new Set();for(const s of list){if(s.settings.media_id)ids.add(s.settings.media_id);for(const p of s.products??[])if(p.featured_media_id)ids.add(p.featured_media_id);}
 const media={};
 if(ids.size){const rows=(await db.query("SELECT * FROM media WHERE state='ready' AND id = ANY($1::bigint[])",[[...ids]])).rows;for(const m of rows)media[String(m.id)]=cloud.preview(m);}
 return {page:{title:content.title,slug:content.slug,seo_title:content.seo_title,seo_description:content.seo_description,sections:list},media,expiresIn:300};
}
// Saved draft or live version, for any staff role (viewers included).
export async function previewPage(db,id,source,cloud){
 const page=(await db.query('SELECT * FROM pages WHERE id=$1',[key(id)])).rows[0];if(!page)throw new HttpError(404,'Page not found');
 let content=page;
 if(source==='live'){if(page.published_revision_id==null)throw new HttpError(404,'Page is not published');content=(await db.query('SELECT * FROM page_revisions WHERE id=$1',[page.published_revision_id])).rows[0];}
 else if(source&&source!=='draft')bad('Invalid preview source');
 return renderData(db,content,cloud);
}
// Unsaved editor state: validated and resolved like a save, but nothing is written.
export async function previewDraft(db,input,cloud){
 object(input);const row=fields({title:'Preview',...input},{}),list=sections(input.sections??[]);await checkReferences(db,list);
 return renderData(db,{...row,sections:list},cloud);
}
// Public, unauthenticated: published content only. Images are referenced by ID; public image
// delivery is not enabled yet (originals stay private).
export async function publicPage(db,slug){
 if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)||slug.length>80)throw new HttpError(404,'Page not found');
 const page=(await db.query('SELECT r.slug,r.title,r.seo_title,r.seo_description,r.sections,r.published_at FROM pages p JOIN page_revisions r ON r.id=p.published_revision_id WHERE r.slug=$1',[slug])).rows[0];
 if(page){const {sections:list,...rest}=page;return {page:{...rest,sections:await resolve(db,list)},checkoutAvailable:false};}
 const redirect=(await db.query('SELECT live.slug FROM page_redirects r JOIN pages p ON p.id=r.page_id JOIN page_revisions live ON live.id=p.published_revision_id WHERE r.from_slug=$1',[slug])).rows[0];
 if(redirect)return {redirect_to:redirect.slug};
 throw new HttpError(404,'Page not found');
}

// Shared with the Online Store themes (src/themes.mjs) so page sections inside a theme render identically.
export {resolve as resolvePageSections};
