// Public catalogue reads for the storefront: product detail, collection listings and product cards.
// One rule decides what visitors can see: an active product that belongs to at least one active
// collection. Drafts, archived products, inactive variants, SKUs, stock counts and private media
// fields are never returned.
import {HttpError} from './auth.mjs';
import {publicImage} from './media-urls.mjs';
import {CHARSETS} from '../shared/personalization.mjs';

const HANDLE=/^[a-z0-9]+(-[a-z0-9]+)*$/;
export const LISTED=`p.status='active' AND EXISTS(SELECT 1 FROM product_collections pc JOIN collections c ON c.id=pc.collection_id WHERE pc.product_id=p.id AND c.status='active')`;
export const PAGE_SIZE=24;
// "featured": the collection's manual order (staff arrangement or Shopify's collection order, migration 011);
// for all products: in stock first, then each product's best place in its collections. "newest": most
// recently added to this catalogue.
const FEATURED_IN=`(SELECT (to_jsonb(pc)->>'position')::int FROM product_collections pc WHERE pc.product_id=p.id AND pc.collection_id=$1),p.id DESC`;
const FEATURED_ALL=`p.available DESC,(SELECT min((to_jsonb(pc)->>'position')::int) FROM product_collections pc JOIN collections c ON c.id=pc.collection_id AND c.status='active' WHERE pc.product_id=p.id),p.id DESC`;
const SORTS={
 featured:null,
 newest:'p.id DESC',
 'title-asc':'p.title ASC,p.id',
 'title-desc':'p.title DESC,p.id',
 'price-asc':'price_min ASC,p.id',
 'price-desc':'price_max DESC,p.id'
};
const LOW_STOCK=5;

// to_jsonb keeps these reads working on databases where migration 010 (tags, compare-at) is not applied yet.
const CARD=`SELECT p.id,p.title,p.handle,p.featured_media_id,
  coalesce((SELECT min(v.price_minor) FROM product_variants v WHERE v.product_id=p.id AND v.active),p.price_minor) AS price_min,
  coalesce((SELECT max(v.price_minor) FROM product_variants v WHERE v.product_id=p.id AND v.active),p.price_minor) AS price_max,
  -- Compare-at of the cheapest variant, so "was" and "now" always describe the same variant.
  (SELECT (to_jsonb(v)->>'compare_at_minor')::int FROM product_variants v WHERE v.product_id=p.id AND v.active ORDER BY v.price_minor,v.position,v.id LIMIT 1) AS compare_at,
  coalesce((SELECT sum(v.inventory) FROM product_variants v WHERE v.product_id=p.id AND v.active),0)>0 AS available,
  (SELECT pm.media_id FROM product_media pm WHERE pm.product_id=p.id ORDER BY pm.position LIMIT 1) AS first_media_id
 FROM products p`;

async function mediaRows(db,ids){
 const list=[...new Set(ids.filter(Boolean).map(String))];if(!list.length)return new Map();
 const rows=(await db.query("SELECT id,width,height,label FROM media WHERE state='ready' AND id = ANY($1::bigint[])",[list])).rows;
 return new Map(rows.map(r=>[String(r.id),r]));
}
function card(p,media){
 const m=media.get(String(p.featured_media_id??''))??media.get(String(p.first_media_id??''));
 const compare=p.compare_at!=null&&Number(p.compare_at)>Number(p.price_min)?Number(p.compare_at):null;
 return {id:String(p.id),title:p.title,handle:p.handle,url:'/products/'+p.handle,price_min:Number(p.price_min),price_max:Number(p.price_max),compare_at_minor:compare,available:p.available,image:publicImage(m,p.title)};
}
export async function productCards(db,where='',params=[],{order='p.id DESC',limit=PAGE_SIZE,offset=0}={}){
 const rows=(await db.query(`SELECT * FROM (${CARD} WHERE ${LISTED}${where?' AND '+where:''}) p ORDER BY ${order} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,params)).rows;
 const media=await mediaRows(db,rows.flatMap(p=>[p.featured_media_id,p.first_media_id]));
 return rows.map(p=>card(p,media));
}

// Filters shared by collection pages and search: in stock, price range (RM), and option values
// (e.g. option.color=Brown&option.color=Black). Each filter must match one active variant.
function filterSql(params,add){
 const parts=[];
 if(params.get('available')==='1')parts.push('EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active AND v.inventory>0)');
 const rm=k=>{const v=params.get(k);if(v==null||v==='')return null;const n=Number(v);if(!Number.isFinite(n)||n<0||n>1e6)throw new HttpError(400,'Invalid price filter');return Math.round(n*100);};
 const min=rm('price_min'),max=rm('price_max');
 if(min!=null||max!=null)parts.push(`EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active AND v.price_minor>=${add(min??0)} AND v.price_minor<=${add(max??100000000)})`);
 const options={};
 for(const [k,v] of params){const m=k.match(/^option\.([a-z0-9 _-]{1,40})$/i);if(!m)continue;if(String(v).length>80)throw new HttpError(400,'Invalid filter');(options[m[1].toLowerCase()]??=[]).push(String(v));}
 if(Object.keys(options).length>5)throw new HttpError(400,'Too many filters');
 for(const [name,values] of Object.entries(options))parts.push(`EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active AND lower(v.option_values[array_position((SELECT array_agg(lower(x)) FROM unnest(p.option_names) x),${add(name)})])=ANY(${add(values.map(x=>x.toLowerCase()))}::text[]))`);
 return {parts,min,max,options,inStock:params.get('available')==='1'};
}
// Choices for the filter panel, from the products in the listing before filters are applied.
async function facets(db,base,args){
 const where=`${LISTED}${base?' AND '+base:''}`;
 const rows=(await db.query(`SELECT lower(o.name) AS name,min(o.name) AS label,v.option_values[o.i] AS value,count(DISTINCT p.id)::int AS n
  FROM products p CROSS JOIN LATERAL unnest(p.option_names) WITH ORDINALITY AS o(name,i) JOIN product_variants v ON v.product_id=p.id AND v.active
  WHERE ${where} AND v.option_values[o.i] IS NOT NULL GROUP BY 1,3 ORDER BY 1,3`,args)).rows;
 const options=[];for(const r of rows){let o=options.find(x=>x.name===r.name);if(!o)options.push(o={name:r.name,label:r.label.charAt(0).toUpperCase()+r.label.slice(1),values:[]});o.values.push({value:r.value,count:r.n});}
 const price=(await db.query(`SELECT min(v.price_minor)::int AS min,max(v.price_minor)::int AS max FROM products p JOIN product_variants v ON v.product_id=p.id AND v.active WHERE ${where}`,args)).rows[0];
 return {options:options.filter(o=>o.values.length>1&&o.values.length<=40),price:{min:price.min??0,max:price.max??0}};
}
async function listing(db,{base='',args=[],params,order}){
 const page=Math.min(500,Math.max(1,Number.parseInt(params.get('page')??'1',10)||1));
 const all=[...args],add=v=>{all.push(v);return '$'+all.length;};
 const f=filterSql(params,add),where=[base,...f.parts].filter(Boolean).join(' AND ');
 const total=(await db.query(`SELECT count(*)::int AS n FROM products p WHERE ${LISTED}${where?' AND '+where:''}`,all)).rows[0].n;
 const products=await productCards(db,where,all,{order,offset:(page-1)*PAGE_SIZE});
 return {products,total,page,pages:Math.max(1,Math.ceil(total/PAGE_SIZE)),available_only:f.inStock,
  filters:{...await facets(db,base,args),applied:{price_min:f.min,price_max:f.max,options:f.options,available:f.inStock}}};
}

export async function storefrontCollection(db,handle,params=new URLSearchParams()){
 if(!HANDLE.test(handle)||handle.length>100)throw new HttpError(404,'Collection not found');
 const sort=SORTS[params.get('sort')]?params.get('sort'):'featured';
 let collection,base='',args=[];
 if(handle==='all')collection={title:'All products',handle:'all',description:''};
 else{
  const c=(await db.query("SELECT id,title,slug,description FROM collections WHERE slug=$1 AND status='active'",[handle])).rows[0];
  if(!c)throw new HttpError(404,'Collection not found');
  collection={title:c.title,handle:c.slug,description:c.description??''};
  base='p.id IN (SELECT product_id FROM product_collections WHERE collection_id=$1)';args=[c.id];
 }
 const order=SORTS[sort]??(handle==='all'?FEATURED_ALL:FEATURED_IN);
 return {collection,sort,...await listing(db,{base,args,params,order})};
}

// Search: product title, tags, SKU (matched but never shown) and description text. Best title
// matches first. 2–80 characters; % and _ are taken literally.
export async function storefrontSearch(db,params=new URLSearchParams()){
 const q=String(params.get('q')??'').replace(/\s+/g,' ').trim();
 if(q.length<2)return {query:q,products:[],total:0,page:1,pages:1,too_short:true,filters:{options:[],price:{min:0,max:0},applied:{}}};
 if(q.length>80)throw new HttpError(400,'Search is limited to 80 characters');
 const like='%'+q.replace(/[\\%_]/g,m=>'\\'+m)+'%',words=q.split(' ').slice(0,6).map(w=>'%'+w.replace(/[\\%_]/g,m=>'\\'+m)+'%');
 // Every word must appear somewhere (title, tags, SKU or description).
 const match=i=>`(p.title ILIKE $${i} OR coalesce(to_jsonb(p)->>'tags','') ILIKE $${i} OR p.description ILIKE $${i} OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active AND v.sku ILIKE $${i}))`;
 const base=`$1::text<>'' AND `+words.map((_,i)=>match(i+2)).join(' AND ');
 const sort=SORTS[params.get('sort')]&&params.get('sort')!=='featured'?params.get('sort'):'relevance';
 const order=sort==='relevance'?'(p.title ILIKE $1) DESC,p.available DESC,p.id DESC':SORTS[sort];
 return {query:q,sort,...await listing(db,{base,args:[like,...words],params,order})};
}

export async function storefrontProduct(db,handle){
 if(!HANDLE.test(handle)||handle.length>100)throw new HttpError(404,'Product not found');
 const p=(await db.query(`SELECT p.id,p.title,p.handle,p.description,p.option_names,p.shipping_profile,p.featured_media_id,to_jsonb(p)->'personalization' AS personalization FROM products p WHERE p.handle=$1 AND ${LISTED}`,[handle])).rows[0];
 if(!p)throw new HttpError(404,'Product not found');
 const variants=(await db.query("SELECT id,option_values,price_minor,inventory,media_id,(to_jsonb(v)->>'compare_at_minor')::int AS compare_at FROM product_variants v WHERE product_id=$1 AND active ORDER BY position,id",[p.id])).rows;
 const gallery=(await db.query('SELECT media_id FROM product_media WHERE product_id=$1 ORDER BY position',[p.id])).rows.map(r=>String(r.media_id));
 const order=[...new Set([p.featured_media_id,...gallery,...variants.map(v=>v.media_id)].filter(Boolean).map(String))];
 const media=await mediaRows(db,order);
 const images=order.map(id=>publicImage(media.get(id),p.title)).filter(Boolean);
 const collections=(await db.query("SELECT c.title,c.slug FROM collections c JOIN product_collections pc ON pc.collection_id=c.id WHERE pc.product_id=$1 AND c.status='active' ORDER BY c.position,c.id",[p.id])).rows.map(c=>({title:c.title,handle:c.slug}));
 const {featured_media_id,personalization,...rest}=p;
 const engraving=personalization?.enabled?{label:personalization.label,required:personalization.required,max_length:personalization.max_length,charset:personalization.charset,rule:CHARSETS[personalization.charset]?.label??'',help:personalization.help??'',variant_ids:personalization.variant_ids??[]}:null;
 return {product:{...rest,id:String(p.id),images,collections,engraving,
  variants:variants.map(v=>({id:String(v.id),option_values:v.option_values,price_minor:v.price_minor,compare_at_minor:v.compare_at!=null&&v.compare_at>v.price_minor?v.compare_at:null,available:v.inventory>0,low:v.inventory>0&&v.inventory<=LOW_STOCK,image_id:v.media_id&&media.has(String(v.media_id))?String(v.media_id):null}))},
  checkoutAvailable:true};
}

// Home listing (legacy endpoint /api/v3/storefront): first 200 listed products as cards.
export async function storefrontIndex(db){return {products:await productCards(db,'',[],{limit:200}),checkoutAvailable:false};}
