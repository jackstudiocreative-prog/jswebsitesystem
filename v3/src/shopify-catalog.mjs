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
const bad=m=>{throw new HttpError(400,m);};
const SLUG=/^[a-z0-9]+(-[a-z0-9]+)*$/;
export async function storeJson(path){
 const r=await fetch(STORE+path,{headers:{accept:'application/json'},redirect:'follow',signal:AbortSignal.timeout(15000)});
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
 for(const img of (p.images??[]).slice(0,20)){
  const path=cdnPath(img.src);if(!path||!SHOPIFY_PATH.test(path))continue;
  // Images not in the library yet are imported while time allows; a later run picks up the rest.
  let id=null;try{id=Date.now()<deadline?await mediaForPath(db,actor,path,cloud):(await db.query("SELECT id FROM media WHERE object_key=$1 AND state='ready'",[shopifyKey(path)])).rows[0]?.id;}catch{id=null;}
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
export async function importCatalog(db,actor,input,cloud,fetchJson=storeJson){
 if(!input||typeof input!=='object'||Array.isArray(input))bad('Send an import step');
 const step=input.step;
 if(step==='collections'){
  const list=(await fetchJson('/collections.json?limit=250')).collections??[];const items=[];
  for(const c of list){await db.query('SAVEPOINT c');try{items.push(await upsertCollection(db,actor,c));await db.query('RELEASE SAVEPOINT c');}catch(e){await db.query('ROLLBACK TO SAVEPOINT c');items.push({handle:c.handle,status:'failed',error:e.message});}}
  return {step,items,handles:items.filter(i=>i.status!=='failed'&&i.status!=='skipped').map(i=>i.handle)};
 }
 if(step==='products'){
  const page=Number(input.page);if(!Number.isInteger(page)||page<1||page>200)bad('Invalid page');
  const list=(await fetchJson(`/products.json?limit=${PRODUCTS_PER_STEP}&page=${page}`)).products??[];const items=[];
  const deadline=Date.now()+18000;
  for(const p of list){await db.query('SAVEPOINT p');try{items.push(await upsertProduct(db,actor,p,cloud,deadline));await db.query('RELEASE SAVEPOINT p');}catch(e){await db.query('ROLLBACK TO SAVEPOINT p');items.push({handle:p.handle,status:'failed',error:e.message});}}
  return {step,page,items,done:list.length<PRODUCTS_PER_STEP};
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
 bad('Unknown import step');
}
