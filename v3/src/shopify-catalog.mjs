// One-time move of the Shopify catalogue (collections, products, variants, tags, images) into V3.
// Reads the store's public storefront JSON (jackstudio.com.my/products.json etc.): no Shopify login
// or token is needed and only published products come across. Runs in small steps from the admin so
// each request stays well inside the function time limit. Re-running updates titles, text, tags,
// prices and images; stock is only set when a variant is first created (from a dated snapshot).
import {HttpError} from './auth.mjs';
import {save} from './catalog.mjs';
import {mediaForPath,SHOPIFY_PATH,shopifyKey} from './shopify-import.mjs';
import {SHOPIFY_CDN} from './shopify-media.mjs';
import {SHOPIFY_STOCK} from './shopify-stock.mjs';
import {cleanHtml} from '../shared/page-templates.mjs';

export const STORE='https://www.jackstudio.com.my';
export const PRODUCTS_PER_STEP=6;
// Vercel stops a request after 30 s and the whole transaction is rolled back. Each step stops starting
// new work after this budget and tells the admin where to continue.
export const STEP_BUDGET_MS=15000;
const bad=m=>{throw new HttpError(400,m);};
const SLUG=/^[a-z0-9]+(-[a-z0-9]+)*$/;
export async function storeJson(path){
 const r=await fetch(STORE+path,{headers:{accept:'application/json'},redirect:'follow',signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new HttpError(502,`The Shopify store answered ${r.status} for ${path}`);
 return r.json();
}
// https://cdn.shopify.com/s/files/1/0745/2550/7871/products/x.jpg?v=1 → products/x.jpg
const cdnPath=src=>{const s=String(src??'').replace(/^\/\//,'https://').split('?')[0];return s.startsWith(SHOPIFY_CDN)?decodeURIComponent(s.slice(SHOPIFY_CDN.length)):null;};
const minor=v=>v==null||v===''?null:Math.round(Number(v)*100);

async function upsertCollection(db,actor,c){
 if(!SLUG.test(c.handle??''))return {handle:c.handle,status:'skipped',error:'Address not usable in V3'};
 const old=(await db.query('SELECT id,revision FROM collections WHERE slug=$1',[c.handle])).rows[0];
 const input={title:String(c.title??c.handle).slice(0,90),slug:c.handle,description:cleanHtml(c.body_html??'',20000),status:'active'};
 const row=old?await save(db,'collections',{...input,revision:old.revision},actor,String(old.id)):await save(db,'collections',input,actor);
 return {handle:c.handle,status:old?'updated':'imported',id:String(row.id)};
}

async function upsertProduct(db,actor,p,cloud,deadline){
 if(!SLUG.test(p.handle??''))return {handle:p.handle,status:'skipped',error:'Address not usable in V3'};
 // Images: product gallery, at most 20 (V3 limit), imported into the private media library as needed.
 const media=[],byShopifyImage=new Map();
 // Images already in the library, in one query (each database round trip counts against the time limit).
 const keys=(p.images??[]).slice(0,20).map(i=>cdnPath(i.src)).filter(x=>x&&SHOPIFY_PATH.test(x)).map(shopifyKey);
 const ready=new Map(keys.length?(await db.query("SELECT id,object_key FROM media WHERE state='ready' AND object_key = ANY($1::text[])",[keys])).rows.map(r=>[r.object_key,r.id]):[]);
 for(const img of (p.images??[]).slice(0,20)){
  const path=cdnPath(img.src);if(!path||!SHOPIFY_PATH.test(path))continue;
  // Images not in the library yet are imported while time allows; a later run picks up the rest.
  let id=null;try{id=Date.now()<deadline?await mediaForPath(db,actor,path,cloud):ready.get(shopifyKey(path));}catch{id=null;}
  if(!id)continue;id=String(id);if(media.some(m=>m.media_id===id))continue;
  media.push({media_id:id,alt:String(img.alt??'').slice(0,500)});byShopifyImage.set(String(img.id),id);
 }
 const names=(p.options??[]).map(o=>o.name).filter(n=>n&&!(n==='Title'&&(p.options.length===1)&&p.variants?.length===1)).slice(0,3);
 const old=(await db.query('SELECT id,revision FROM products WHERE handle=$1',[p.handle])).rows[0];
 const existing=old?(await db.query('SELECT id,option_values,sku,price_minor,media_id FROM product_variants WHERE product_id=$1 ORDER BY position,id',[old.id])).rows:[];
 const taken=new Set();
 const variants=(p.variants??[]).slice(0,100).map((v,i)=>{
  const values=names.map((_,k)=>String(v['option'+(k+1)]??'').trim().slice(0,60)||'-');
  const match=existing.find(e=>JSON.stringify(e.option_values)===JSON.stringify(values));
  let sku=String(v.sku??'').trim().slice(0,80)||null;if(sku&&taken.has(sku.toLowerCase()))sku=null;if(sku)taken.add(sku.toLowerCase());
  const out={option_values:values,sku,price_minor:minor(v.price)??0,compare_at_minor:minor(v.compare_at_price)>minor(v.price)?minor(v.compare_at_price):null,active:true,media_id:v.featured_image?byShopifyImage.get(String(v.featured_image.id))??null:null};
  if(match)return {...out,id:String(match.id)};
  return {...out,inventory:sku?SHOPIFY_STOCK[sku.toLowerCase()]??0:0};
 });
 if(!variants.length)return {handle:p.handle,status:'skipped',error:'No variants'};
 // Variants removed in Shopify stay in V3 (order history) but are switched off.
 for(const e of existing)if(!variants.some(v=>v.id===String(e.id)))variants.push({id:String(e.id),option_values:e.option_values.length===names.length?e.option_values:names.map((_,k)=>e.option_values[k]??'Old '+e.id),sku:e.sku,price_minor:e.price_minor,active:false,media_id:null});
 // SKUs used by another product (duplicates in Shopify) are left empty instead of failing the product.
 for(const v of variants)if(v.sku){const other=(await db.query('SELECT product_id FROM product_variants WHERE sku_key=lower($1)',[v.sku])).rows[0];if(other&&(!old||String(other.product_id)!==String(old.id)))v.sku=null;}
 const tags=(Array.isArray(p.tags)?p.tags:String(p.tags??'').split(',')).map(t=>String(t).trim()).filter(Boolean).slice(0,250);
 const input={title:String(p.title??p.handle).slice(0,150),handle:p.handle,description:cleanHtml(p.body_html??'',20000),status:'active',tags,option_names:names,variants,media,featured_media_id:media[0]?.media_id??null};
 const row=old?await save(db,'products',{...input,revision:old.revision},actor,String(old.id)):await save(db,'products',input,actor);
 return {handle:p.handle,status:old?'updated':'imported',id:String(row.id)};
}

// One step per request: {step:'collections'} | {step:'products', page} | {step:'memberships', handle}.
export async function importCatalog(db,actor,input,cloud,fetchJson=storeJson,{budget=STEP_BUDGET_MS}={}){
 const started=Date.now();
 if(!input||typeof input!=='object'||Array.isArray(input))bad('Send an import step');
 const step=input.step;
 if(step==='collections'){
  const list=(await fetchJson('/collections.json?limit=250')).collections??[];const items=[];
  for(const c of list){await db.query('SAVEPOINT c');try{items.push(await upsertCollection(db,actor,c));await db.query('RELEASE SAVEPOINT c');}catch(e){await db.query('ROLLBACK TO SAVEPOINT c');items.push({handle:c.handle,status:'failed',error:e.message});}}
  return {step,items,handles:items.filter(i=>i.status!=='failed'&&i.status!=='skipped').map(i=>i.handle)};
 }
 if(step==='products'){
  const page=Number(input.page);if(!Number.isInteger(page)||page<1||page>200)bad('Invalid page');
  const offset=input.offset==null?0:Number(input.offset);if(!Number.isInteger(offset)||offset<0||offset>=PRODUCTS_PER_STEP)bad('Invalid offset');
  const list=(await fetchJson(`/products.json?limit=${PRODUCTS_PER_STEP}&page=${page}`)).products??[];const items=[];
  const deadline=0; // images are imported by the 'images' step first; this step only links them
  let i=offset;
  // At least one product per request; then only while the time budget lasts.
  for(;i<list.length;i++){
   if(i>offset&&Date.now()-started>budget)break;
   const p=list[i];await db.query('SAVEPOINT p');try{items.push(await upsertProduct(db,actor,p,cloud,deadline));await db.query('RELEASE SAVEPOINT p');}catch(e){await db.query('ROLLBACK TO SAVEPOINT p');items.push({handle:p.handle,status:'failed',error:e.message});}
  }
  const next=i<list.length?i:null;
  return {step,page,items,next_offset:next,done:next==null&&list.length<PRODUCTS_PER_STEP};
 }
 // Missing product images of one page, at most 4 per request in parallel (each request stays short).
 if(step==='images'){
  const page=Number(input.page);if(!Number.isInteger(page)||page<1||page>200)bad('Invalid page');
  const list=(await fetchJson(`/products.json?limit=${PRODUCTS_PER_STEP}&page=${page}`)).products??[];
  const paths=[...new Set(list.flatMap(p=>(p.images??[]).slice(0,20).map(i=>cdnPath(i.src))).filter(x=>x&&SHOPIFY_PATH.test(x)))];
  const have=new Set((await db.query("SELECT object_key FROM media WHERE state='ready' AND object_key = ANY($1::text[])",[paths.map(shopifyKey)])).rows.map(r=>r.object_key));
  const missing=paths.filter(x=>!have.has(shopifyKey(x))),skip=new Set((input.skip??[]).map(String)),todo=Date.now()-started>budget?[]:missing.filter(x=>!skip.has(x)).slice(0,4);
  if(!todo.length&&missing.some(x=>!skip.has(x)))return {step,page,imported:0,failed:[],remaining:missing.length,retry:true};
  const results=await Promise.all(todo.map(path=>cloud.importRemote(SHOPIFY_CDN+path,shopifyKey(path)).then(asset=>({path,asset}),error=>({path,error}))));
  const failed=[];
  for(const {path,asset,error} of results){
   if(error){failed.push({handle:path,error:'Cloudinary could not import this image'});continue;}
   await db.query('SAVEPOINT i');try{await mediaForPath(db,actor,path,{importRemote:async()=>asset});await db.query('RELEASE SAVEPOINT i');}catch(e){await db.query('ROLLBACK TO SAVEPOINT i');failed.push({handle:path,error:e.message});}
  }
  return {step,page,imported:todo.length-failed.length,failed,remaining:missing.length-todo.length};
 }
 if(step==='memberships'){
  const handle=String(input.handle??'');if(!SLUG.test(handle))bad('Invalid collection');
  const c=(await db.query('SELECT id FROM collections WHERE slug=$1',[handle])).rows[0];if(!c)bad('Import collections first');
  const handles=[];for(let page=1;page<=20;page++){const list=(await fetchJson(`/collections/${handle}/products.json?limit=250&page=${page}`)).products??[];handles.push(...list.map(p=>p.handle));if(list.length<250)break;}
  const ids=(await db.query('SELECT id FROM products WHERE handle = ANY($1::text[])',[handles])).rows.map(r=>r.id);
  await db.query('DELETE FROM product_collections WHERE collection_id=$1',[c.id]);
  for(const id of ids)await db.query('INSERT INTO product_collections VALUES ($1,$2) ON CONFLICT DO NOTHING',[id,c.id]);
  await db.query('UPDATE products SET collection_id=$1 WHERE collection_id IS NULL AND id = ANY($2::bigint[])',[c.id,ids]);
  await db.query("INSERT INTO audit_events(actor,action,entity,entity_id) VALUES($1,'import','collections',$2)",[actor,c.id]);
  return {step,handle,linked:ids.length,missing:handles.length-ids.length};
 }
 if(step==='verify')return verifyCatalog(db,fetchJson);
 bad('Unknown import step');
}

// Compares the V3 catalogue with the live Shopify store, field by field, and lists every difference.
export async function verifyCatalog(db,fetchJson=storeJson){
 const shop=[];for(let page=1;page<=20;page++){const list=(await fetchJson(`/products.json?limit=250&page=${page}`)).products??[];shop.push(...list);if(list.length<250)break;}
 const cols=(await fetchJson('/collections.json?limit=250')).collections??[];
 const issues=[],add=(handle,problem)=>{if(issues.length<300)issues.push({handle,problem});};
 const rows=(await db.query(`SELECT p.id,p.handle,p.title,p.status,p.description,p.option_names,coalesce(to_jsonb(p)->'tags','[]'::jsonb) AS tags,
   (SELECT count(*)::int FROM product_media pm WHERE pm.product_id=p.id) AS images FROM products p`)).rows;
 const byHandle=new Map(rows.map(r=>[r.handle,r]));
 const variants=new Map();for(const v of (await db.query("SELECT product_id,option_values,sku,price_minor,coalesce((to_jsonb(v)->>'compare_at_minor')::int,-1) AS compare_at,active FROM product_variants v")).rows){const k=String(v.product_id);if(!variants.has(k))variants.set(k,[]);variants.get(k).push(v);}
 let matched=0;
 for(const p of shop){
  const r=byHandle.get(p.handle);if(!r){add(p.handle,'Missing in V3');continue;}
  let ok=true;const fail=m=>{ok=false;add(p.handle,m);};
  if(r.title!==String(p.title).slice(0,150))fail('Title differs');
  if(r.status!=='active')fail(`Status is ${r.status}`);
  if(r.description!==cleanHtml(p.body_html??'',20000))fail('Description differs');
  const tags=(Array.isArray(p.tags)?p.tags:String(p.tags??'').split(',')).map(t=>String(t).trim()).filter(Boolean);
  if(JSON.stringify([...new Set(tags)].sort())!==JSON.stringify([...(r.tags??[])].sort()))fail('Tags differ');
  const names=(p.options??[]).map(o=>o.name).filter(n=>n&&!(n==='Title'&&p.options.length===1&&p.variants?.length===1)).slice(0,3);
  if(JSON.stringify(names)!==JSON.stringify(r.option_names))fail('Options differ');
  const images=(p.images??[]).filter(i=>SHOPIFY_PATH.test(cdnPath(i.src)??'')).length;
  if(Math.min(images,20)!==r.images)fail(`Images: Shopify ${images}, V3 ${r.images}`);
  const vs=(variants.get(String(r.id))??[]).filter(v=>v.active);
  if(vs.length!==(p.variants??[]).length)fail(`Variants: Shopify ${(p.variants??[]).length}, V3 ${vs.length}`);
  for(const sv of p.variants??[]){
   const values=names.map((_,k)=>String(sv['option'+(k+1)]??'').trim().slice(0,60)||'-');
   const v=vs.find(x=>JSON.stringify(x.option_values)===JSON.stringify(values));if(!v){fail(`Variant ${values.join(' / ')||'default'} missing`);continue;}
   if(v.price_minor!==minor(sv.price))fail(`Price of ${values.join(' / ')||'default'} differs`);
   const cmp=minor(sv.compare_at_price)>minor(sv.price)?minor(sv.compare_at_price):-1;if(v.compare_at!==cmp)fail(`Compare-at price of ${values.join(' / ')||'default'} differs`);
   if(sv.sku&&v.sku!==String(sv.sku).trim().slice(0,80))fail(`SKU ${sv.sku} left empty or different (duplicate in Shopify?)`);
  }
  if(ok)matched++;
 }
 const shopHandles=new Set(shop.map(p=>p.handle));
 const extra=rows.filter(r=>r.status==='active'&&!shopHandles.has(r.handle)).map(r=>r.handle);
 const colRows=new Map((await db.query('SELECT c.slug,c.status,(SELECT count(*)::int FROM product_collections pc WHERE pc.collection_id=c.id) AS n FROM collections c')).rows.map(c=>[c.slug,c]));
 const collections=[];
 for(const c of cols){if(!SLUG.test(c.handle??'')){add(c.handle,'Collection address not usable in V3');continue;}const v=colRows.get(c.handle);let n=0;for(let page=1;page<=20;page++){const list=(await fetchJson(`/collections/${c.handle}/products.json?limit=250&page=${page}`)).products??[];n+=list.length;if(list.length<250)break;}
  collections.push({handle:c.handle,shopify:n,v3:v?.n??null});if(!v)add(c.handle,'Collection missing in V3');else if(v.n!==n)add(c.handle,`Collection products: Shopify ${n}, V3 ${v.n}`);}
 return {step:'verify',shopify:shop.length,v3:rows.length,matched,extra,collections,issues};
}
