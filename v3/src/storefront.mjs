// Public catalogue reads for the storefront: product detail, collection listings and product cards.
// One rule decides what visitors can see: an active product that belongs to at least one active
// collection. Drafts, archived products, inactive variants, SKUs, stock counts and private media
// fields are never returned.
import {HttpError} from './auth.mjs';
import {publicImage} from './media-urls.mjs';

const HANDLE=/^[a-z0-9]+(-[a-z0-9]+)*$/;
export const LISTED=`p.status='active' AND EXISTS(SELECT 1 FROM product_collections pc JOIN collections c ON c.id=pc.collection_id WHERE pc.product_id=p.id AND c.status='active')`;
export const PAGE_SIZE=24;
const SORTS={
 featured:'p.id DESC',
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
  (SELECT max((to_jsonb(v)->>'compare_at_minor')::int) FROM product_variants v WHERE v.product_id=p.id AND v.active) AS compare_at,
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

export async function storefrontCollection(db,handle,params=new URLSearchParams()){
 if(!HANDLE.test(handle)||handle.length>100)throw new HttpError(404,'Collection not found');
 const sort=SORTS[params.get('sort')]?params.get('sort'):'featured';
 const page=Math.min(500,Math.max(1,Number.parseInt(params.get('page')??'1',10)||1));
 const inStock=params.get('available')==='1';
 let collection,where='',args=[];
 if(handle==='all')collection={title:'All products',handle:'all',description:''};
 else{
  const c=(await db.query("SELECT id,title,slug,description FROM collections WHERE slug=$1 AND status='active'",[handle])).rows[0];
  if(!c)throw new HttpError(404,'Collection not found');
  collection={title:c.title,handle:c.slug,description:c.description??''};
  where='p.id IN (SELECT product_id FROM product_collections WHERE collection_id=$1)';args=[c.id];
 }
 if(inStock)where=(where?where+' AND ':'')+'EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active AND v.inventory>0)';
 const total=(await db.query(`SELECT count(*)::int AS n FROM products p WHERE ${LISTED}${where?' AND '+where:''}`,args)).rows[0].n;
 const products=await productCards(db,where,args,{order:SORTS[sort],offset:(page-1)*PAGE_SIZE});
 return {collection,products,total,page,pages:Math.max(1,Math.ceil(total/PAGE_SIZE)),sort,available_only:inStock};
}

export async function storefrontProduct(db,handle){
 if(!HANDLE.test(handle)||handle.length>100)throw new HttpError(404,'Product not found');
 const p=(await db.query(`SELECT p.id,p.title,p.handle,p.description,p.option_names,p.shipping_profile,p.featured_media_id FROM products p WHERE p.handle=$1 AND ${LISTED}`,[handle])).rows[0];
 if(!p)throw new HttpError(404,'Product not found');
 const variants=(await db.query("SELECT id,option_values,price_minor,inventory,media_id,(to_jsonb(v)->>'compare_at_minor')::int AS compare_at FROM product_variants v WHERE product_id=$1 AND active ORDER BY position,id",[p.id])).rows;
 const gallery=(await db.query('SELECT media_id FROM product_media WHERE product_id=$1 ORDER BY position',[p.id])).rows.map(r=>String(r.media_id));
 const order=[...new Set([p.featured_media_id,...gallery,...variants.map(v=>v.media_id)].filter(Boolean).map(String))];
 const media=await mediaRows(db,order);
 const images=order.map(id=>publicImage(media.get(id),p.title)).filter(Boolean);
 const collections=(await db.query("SELECT c.title,c.slug FROM collections c JOIN product_collections pc ON pc.collection_id=c.id WHERE pc.product_id=$1 AND c.status='active' ORDER BY c.position,c.id",[p.id])).rows.map(c=>({title:c.title,handle:c.slug}));
 const {featured_media_id,...rest}=p;
 return {product:{...rest,id:String(p.id),images,collections,
  variants:variants.map(v=>({id:String(v.id),option_values:v.option_values,price_minor:v.price_minor,compare_at_minor:v.compare_at!=null&&v.compare_at>v.price_minor?v.compare_at:null,available:v.inventory>0,low:v.inventory>0&&v.inventory<=LOW_STOCK,image_id:v.media_id&&media.has(String(v.media_id))?String(v.media_id):null}))},
  checkoutAvailable:true};
}

// Home listing (legacy endpoint /api/v3/storefront): first 200 listed products as cards.
export async function storefrontIndex(db){return {products:await productCards(db,'',[],{limit:200}),checkoutAvailable:false};}
