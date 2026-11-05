import rules from '../../shared/catalog.js';
import {HttpError} from './auth.mjs';
import {saveVariants,syncSummary,variantsFor,variantShape,optionNames} from './inventory.mjs';
const fields={products:['title','handle','description','status','collection_id','collection_ids','price_minor','sku','inventory','media','variants','option_names','featured_media_id','shipping_profile','weight_grams'],collections:['title','slug','description','status','position']};
const bad=message=>{throw new HttpError(400,message);};
export function id(value){const s=String(value);if(!/^[1-9]\d{0,17}$/.test(s))bad('Invalid ID');return s;}
function integer(value,max=2147483647){if(!Number.isInteger(value)||value<0||value>max)bad('Invalid non-negative integer');return value;}
function ids(value){if(!Array.isArray(value)||value.length>200)bad('Choose up to 200 records');const result=value.map(id);if(new Set(result).size!==result.length)bad('Duplicate IDs');return result;}
export async function list(db,resource,params=new URLSearchParams()){
 if(!['products','collections','media'].includes(resource))throw new HttpError(404,'Not found');
 const args=[],where=[];const add=(sql,value)=>{args.push(value);where.push(sql.replace('?',`$${args.length}`));};
 const q=params.get('q')??'';if(q.length>150)bad('Search too long');
 if(q){args.push('%'+q+'%');const param='$'+args.length;where.push(resource==='products'?`(title ILIKE ${param} OR coalesce(sku,'') ILIKE ${param} OR id IN (SELECT product_id FROM product_variants WHERE sku ILIKE ${param}))`:resource==='media'?`(label ILIKE ${param} OR object_key ILIKE ${param})`:`title ILIKE ${param}`);}
 const status=params.get('status');if(status){if(!(resource==='media'?['ready','pending']:['draft','active',...(resource==='products'?['archived']:[])]).includes(status))bad('Invalid filter');add(`${resource==='media'?'state':'status'}=?`,status);}
 if(resource==='products'&&params.get('collection'))add('id IN (SELECT product_id FROM product_collections WHERE collection_id=?)',id(params.get('collection')));
 if(resource==='media'){
  const format=params.get('format');if(format){if(!['jpg','png','webp'].includes(format))bad('Invalid filter');add('format = ANY(?)',format==='jpg'?['jpg','jpeg']:[format]);}
  const usage=params.get('usage');if(usage){if(!['linked','unused'].includes(usage))bad('Invalid filter');where.push(`id ${usage==='unused'?'NOT ':''}IN (SELECT media_id FROM product_media)`);}
 }
 const filter=where.length?' WHERE '+where.join(' AND '):'';
 const paged=params.get('paged')==='true',limit=paged?integer(Number(params.get('limit')??25),100):200,offset=paged?integer(Number(params.get('offset')??0)):0;if(!limit)bad('Limit must be positive');
 const total=paged?Number((await db.query(`SELECT count(*) AS n FROM ${resource}${filter}`,args)).rows[0].n):0;
 const order=resource==='collections'?'position,id':'id';
 const extra=resource==='products'?',(SELECT count(*)::int FROM product_variants v WHERE v.product_id=products.id AND v.active) AS variant_count':'';
 const rows=(await db.query(`SELECT *${extra} FROM ${resource}${filter} ORDER BY ${order} LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset])).rows;
 return paged?{items:rows,total,limit,offset}:rows;
}
export async function detail(db,resource,key){
 if(!fields[resource])throw new HttpError(404,'Not found');
 const row=(await db.query(`SELECT * FROM ${resource} WHERE id=$1`,[id(key)])).rows[0];if(!row)throw new HttpError(404,'Record not found');
 if(resource==='products'){
  row.collection_ids=(await db.query('SELECT collection_id FROM product_collections WHERE product_id=$1 ORDER BY collection_id',[key])).rows.map(x=>String(x.collection_id));
  row.media=(await db.query('SELECT pm.media_id,pm.position,pm.alt,m.label,m.width,m.height FROM product_media pm JOIN media m ON m.id=pm.media_id WHERE pm.product_id=$1 ORDER BY pm.position',[key])).rows;
  row.featured_media_id=row.featured_media_id==null?null:String(row.featured_media_id);
  row.variants=(await variantsFor(db,key)).map(variantShape);
 }else row.product_ids=(await db.query('SELECT product_id FROM product_collections WHERE collection_id=$1 ORDER BY product_id',[key])).rows.map(x=>String(x.product_id));
 return row;
}
export async function save(db,resource,input,actor,key){
 if(!fields[resource])throw new HttpError(404,'Not found');
 if(!input||typeof input!=='object'||Array.isArray(input))bad('Object required');
 if(Object.keys(input).some(k=>![...fields[resource],...(key?['revision']:[])].includes(k)))bad('Unknown field');
 let old;
 if(key){old=(await db.query(`SELECT * FROM ${resource} WHERE id=$1 FOR UPDATE`,[id(key)])).rows[0];if(!old)throw new HttpError(404,'Record not found');if(input.revision!==old.revision)throw new HttpError(409,'Changed by another staff member. Reload before saving.');}
 const value={...old,...input},slugKey=resource==='products'?'handle':'slug';
 const title=String(value.title??'').trim(),slug=rules.slug(value[slugKey]??title);
 if(!title||title.length>(resource==='products'?150:90)||!slug)bad('Title and slug required');
 const row={title,[slugKey]:slug,description:String(value.description??''),status:value.status??'draft'};
 if(row.description.length>20000||!['draft','active',...(resource==='products'?['archived']:[])].includes(row.status))bad('Invalid description or status');
 let collectionIds,media,names,mediaIds;
 if(resource==='products'){
  // Price, SKU and stock live on variants; the product columns are a synced summary (inventory.mjs).
  names=input.option_names!==undefined?optionNames(input.option_names):(old?.option_names??[]);row.option_names=names;
  row.shipping_profile=value.shipping_profile??'general';if(!['general','luggage'].includes(row.shipping_profile))bad('Invalid shipping profile');row.weight_grams=integer(value.weight_grams??0,100000);
  if(input.collection_ids!==undefined)collectionIds=ids(input.collection_ids);
  else if(input.collection_id!==undefined)collectionIds=input.collection_id===null?[]:[id(input.collection_id)];
  else if(!key)collectionIds=[];
  row.collection_id=collectionIds?collectionIds[0]??null:old.collection_id;
  if(input.media!==undefined){if(!Array.isArray(input.media)||input.media.length>20)bad('Maximum 20 images');ids(input.media.map(x=>x.media_id));media=input.media.map(x=>({media_id:id(x.media_id),alt:String(x.alt??'')}));if(media.some(x=>x.alt.length>500))bad('Alt text too long');
   for(const m of media)if(!(await db.query("SELECT id FROM media WHERE id=$1 AND state='ready'",[m.media_id])).rows.length)bad('Choose verified ready media');}
  mediaIds=media?media.map(m=>m.media_id):key?(await db.query('SELECT media_id FROM product_media WHERE product_id=$1 ORDER BY position',[key])).rows.map(r=>String(r.media_id)):[];
  // Featured image must be one of the product images; otherwise keep the current one or use the first.
  if(input.featured_media_id!==undefined){row.featured_media_id=input.featured_media_id==null||input.featured_media_id===''?null:id(input.featured_media_id);if(row.featured_media_id&&!mediaIds.includes(row.featured_media_id))bad('Featured image must be one of the product images');}
  else{const current=old?.featured_media_id==null?null:String(old.featured_media_id);row.featured_media_id=current&&mediaIds.includes(current)?current:mediaIds[0]??null;}
 }else row.position=integer(value.position??0);
 const cols=Object.keys(row),values=Object.values(row);let result;
 if(key){values.push(key);result=(await db.query(`UPDATE ${resource} SET ${cols.map((c,i)=>`${c}=$${i+1}`).join(',')},revision=revision+1${resource==='products'?',updated_at=now()':''} WHERE id=$${values.length} RETURNING *`,values)).rows[0];}
 else result=(await db.query(`INSERT INTO ${resource} (${cols.join(',')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,values)).rows[0];
 if(collectionIds){await db.query('DELETE FROM product_collections WHERE product_id=$1',[result.id]);for(const c of collectionIds)await db.query('INSERT INTO product_collections VALUES ($1,$2)',[result.id,c]);}
 if(media){await db.query('DELETE FROM product_media WHERE product_id=$1',[result.id]);for(const [position,m]of media.entries())await db.query('INSERT INTO product_media(product_id,media_id,position,alt) VALUES($1,$2,$3,$4)',[result.id,m.media_id,position,m.alt]);}
 if(resource==='products'){await saveVariants(db,{productId:result.id,input,old,optionNamesValue:names,mediaIds,actor});await syncSummary(db,result.id);result=(await db.query('SELECT * FROM products WHERE id=$1',[result.id])).rows[0];}
 await db.query('INSERT INTO audit_events(actor,action,entity,entity_id) VALUES ($1,$2,$3,$4)',[actor,key?'update':'create',resource,result.id]);
 return result;
}
export const create=(db,resource,input,actor)=>save(db,resource,input,actor);
export async function dashboard(db){return (await db.query(`SELECT (SELECT count(*)::int FROM products) AS products,(SELECT count(*)::int FROM products WHERE status='active') AS active,(SELECT count(*)::int FROM products WHERE status='draft') AS drafts,(SELECT count(*)::int FROM products WHERE status='archived') AS archived,(SELECT count(*)::int FROM collections) AS collections,(SELECT count(*)::int FROM media WHERE state='ready') AS media,(SELECT count(*)::int FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.active AND p.status<>'archived') AS variants,(SELECT count(*)::int FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.active AND p.status<>'archived' AND v.inventory BETWEEN 1 AND $1) AS low_stock,(SELECT count(*)::int FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.active AND p.status<>'archived' AND v.inventory=0) AS out_of_stock,(SELECT count(*)::int FROM pages WHERE published_revision_id IS NOT NULL) AS published_pages,(SELECT count(*)::int FROM pages WHERE published_revision_id IS NULL OR has_unpublished_changes) AS draft_pages,(SELECT count(*)::int FROM orders WHERE status='paid') AS paid_orders,(SELECT count(*)::int FROM orders WHERE status='pending_payment') AS pending_orders,(SELECT count(*)::int FROM orders WHERE status='paid' AND fulfillment_status='unfulfilled') AS to_fulfil,(SELECT count(*)::int FROM orders WHERE needs_attention) AS attention_orders,(SELECT coalesce(sum(total_minor-refunded_minor),0)::bigint FROM orders WHERE status='paid') AS revenue_minor,(SELECT count(*)::int FROM email_outbox WHERE status<>'sent') AS emails_waiting`,[rules.lowStock])).rows[0];}
