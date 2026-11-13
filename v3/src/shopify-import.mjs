import {createHash} from 'node:crypto';
import {HttpError} from './auth.mjs';
import {validateAsset,cleanLabel} from './media.mjs';
import {SHOPIFY_CDN,SHOPIFY_MEDIA} from './shopify-media.mjs';
// One-time move of the Shopify image library into the private Cloudinary media library.
// Only paths from the committed manifest are accepted, so the endpoint cannot fetch arbitrary URLs.
// Each Shopify path maps to a fixed Cloudinary public ID, which makes re-runs skip finished images
// and lets themes find "their" Shopify image without a lookup table in the database.
const KNOWN=new Set(SHOPIFY_MEDIA);
export const IMPORT_BATCH=4;
export const shopifyKey=path=>'jackstudio-websitesystem/shopify/'+createHash('sha256').update(path).digest('hex').slice(0,32);
function label(path){let n=path.split('/').pop();try{n=decodeURIComponent(n);}catch{}return cleanLabel(n);}

export async function importStatus(db){
 const keys=SHOPIFY_MEDIA.map(shopifyKey);
 const done=new Set((await db.query('SELECT object_key FROM media WHERE object_key = ANY($1::text[])',[keys])).rows.map(r=>r.object_key));
 const pending=SHOPIFY_MEDIA.filter((_,i)=>!done.has(keys[i]));
 return {total:SHOPIFY_MEDIA.length,imported:SHOPIFY_MEDIA.length-pending.length,pending,batch:IMPORT_BATCH};
}

export async function importShopify(db,actor,input,cloud){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='paths'))throw new HttpError(400,'Send the image paths to import');
 const paths=input.paths;
 if(!Array.isArray(paths)||!paths.length||paths.length>IMPORT_BATCH||new Set(paths).size!==paths.length||paths.some(p=>typeof p!=='string'||!KNOWN.has(p)))throw new HttpError(400,`Choose 1–${IMPORT_BATCH} images from the Shopify list`);
 // Sorted locks: two staff importing at once wait for each other instead of deadlocking.
 const jobs=[];
 for(const path of [...paths].sort()){
  const key=shopifyKey(path);await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
  jobs.push({path,key,existing:(await db.query('SELECT id FROM media WHERE object_key=$1',[key])).rows[0]?.id});
 }
 // Cloudinary downloads from the Shopify CDN itself. The signed upload reply is server-to-server, so it
 // is trusted for verification like the Admin API lookup used by browser uploads (no extra API quota).
 const results=await Promise.all(jobs.map(j=>j.existing?null:cloud.importRemote(SHOPIFY_CDN+j.path,j.key).then(asset=>({asset}),error=>({error}))));
 const items=[];
 for(const [i,j] of jobs.entries()){
  if(j.existing){items.push({path:j.path,status:'exists',media_id:String(j.existing)});continue;}
  const {asset,error}=results[i];
  if(error){items.push({path:j.path,status:'failed',error:'Cloudinary could not import this image'+(error?.error?.message||error?.message?': '+String(error?.error?.message||error.message).slice(0,160):'')});continue;}
  try{validateAsset(asset,j.key);}catch(e){items.push({path:j.path,status:'failed',error:e.message});continue;}
  const mime=asset.format==='png'?'image/png':asset.format==='webp'?'image/webp':'image/jpeg';
  const media=(await db.query("INSERT INTO media(object_key,mime,bytes,state,created_by,cloudinary_asset_id,version,width,height,format,label) VALUES($1,$2,$3,'ready',$4,$5,$6,$7,$8,$9,$10) RETURNING id",[j.key,mime,asset.bytes,actor,asset.asset_id,asset.version,asset.width,asset.height,asset.format,label(j.path)||j.key.split('/').pop()])).rows[0];
  await db.query("INSERT INTO audit_events(actor,action,entity,entity_id) VALUES($1,'import','media',$2)",[actor,media.id]);
  items.push({path:j.path,status:'imported',media_id:String(media.id)});
 }
 return {items};
}

// The images jackstudio.com.my uses in each slot of the Jack Studio 2026 theme (from the Shopify
// theme settings, home template and outlet entries). Keys are matched case-insensitively.
export const THEME_IMAGES=Object.freeze({
 header_logo:'files/JS_Logo__Black_1.png',
 footer_logo:'files/JackStudioLogo11-Photoroom.png',
 hero:'files/JACK_STUDIO.png',
 promise:'files/0d028c55-75f7-42dd-9ab6-65d56e534576.jpg',
 stat:'files/414c56ca828c42ada2278e6ef01428ec.png',
 story:'files/f8330fd6-c7ce-409a-9bec-cada3369fca7.jpg',
 menu:{'brand story':'files/66c9ad59-0fe8-4ace-84d2-a8fa21ae30eb.jpg','brand promise':'files/588af16e-ed8a-48fe-b28c-bd4312553264.png','blog':'files/3d699863-f676-4d8f-9e3e-a6b73ca03922.jpg'},
 cards:{'urban carry':'files/Urban_Carry__Five_bags_on_stone_plinths.png','craft heritage':'files/Craft_Heritage__Owl-Inspired_Leather_Bags.png','travel movement':'files/584206f1-ce65-4172-abc1-89e865cde249.png','professional':'files/Professional_Leather_Bags_Display.png','essential':'files/b19d9b6c-fe1d-49b4-abec-89ee40b64742.png','make it personal':'files/Make_It_Personal_Gift_Set_Ad.png','craft innovative':'files/Craft_Innovative_Wallet_Collection.png'},
 outlets:{'aeon bukit tinggi':'files/Screenshot_2026-08-14_093530.png','paradigm mall':'files/Screenshot_2026-08-14_093652.png','main place mall usj':'files/Screenshot_2026-08-14_093803.png'}
});
const norm=s=>String(s??'').trim().toLowerCase();
// Walks theme content and calls visit(holder, field, shopifyPath) for every image slot with a known image.
function slots(theme,visit){
 const T=THEME_IMAGES;
 for(const s of [...(theme.header??[]),...(theme.sections??[]),...(theme.footer??[])]){
  const v=s.settings??{};
  if(s.type==='site_header'){visit(v,'logo_id',T.header_logo);for(const m of v.menu??[])for(const c of m.children??[])visit(c,'image_id',T.menu[norm(c.label)]);}
  else if(s.type==='hero_banner')visit(v,'image_id',T.hero);
  else if(s.type==='collection_cards')for(const c of v.cards??[])visit(c,'image_id',T.cards[norm(c.title)]);
  else if(s.type==='promise_split'){visit(v,'image_id',T.promise);visit(v,'stat_image_id',T.stat);}
  else if(s.type==='story_split')visit(v,'image_id',T.story);
  else if(s.type==='outlets')for(const o of v.outlets??[])visit(o,'image_id',T.outlets[norm(o.name)]);
  else if(s.type==='site_footer')visit(v,'logo_id',T.footer_logo);
 }
}
// Fills only empty slots, so images staff chose themselves are never replaced. Returns the count filled.
export async function autofillThemeImages(db,theme){
 const wanted=new Map();slots(theme,(h,f,p)=>{if(p&&h[f]==null)wanted.set(shopifyKey(p),null);});
 if(!wanted.size)return 0;
 for(const r of (await db.query("SELECT id,object_key FROM media WHERE state='ready' AND object_key = ANY($1::text[])",[[...wanted.keys()]])).rows)wanted.set(r.object_key,String(r.id));
 let filled=0;slots(theme,(h,f,p)=>{const id=p&&wanted.get(shopifyKey(p));if(id&&h[f]==null){h[f]=id;filled++;}});
 return filled;
}
