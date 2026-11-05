import rules from '../../shared/catalog.js';
import {HttpError} from './auth.mjs';
const fields={products:['title','handle','description','status','collection_id','collection_ids','price_minor','sku','inventory','media'],collections:['title','slug','description','status','position']};
const bad=message=>{throw new HttpError(400,message);};
export function id(value){const s=String(value);if(!/^[1-9]\d{0,17}$/.test(s))bad('Invalid ID');return s;}
function integer(value,max=2147483647){if(!Number.isInteger(value)||value<0||value>max)bad('Invalid non-negative integer');return value;}
function ids(value){if(!Array.isArray(value)||value.length>200)bad('Choose up to 200 records');const result=value.map(id);if(new Set(result).size!==result.length)bad('Duplicate IDs');return result;}
export async function list(db,resource,params=new URLSearchParams()){
 if(!['products','collections','media'].includes(resource))throw new HttpError(404,'Not found');
 const args=[],where=[];const add=(sql,value)=>{args.push(value);where.push(sql.replace('?',`$${args.length}`));};
 const q=params.get('q')??'';if(q.length>150)bad('Search too long');
 if(q){args.push('%'+q+'%');const param='$'+args.length;where.push(resource==='products'?`(title ILIKE ${param} OR coalesce(sku,'') ILIKE ${param})`:`${resource==='media'?'object_key':'title'} ILIKE ${param}`);}
 const status=params.get('status');if(status){if(!(resource==='media'?['ready','pending']:['draft','active',...(resource==='products'?['archived']:[])]).includes(status))bad('Invalid filter');add(`${resource==='media'?'state':'status'}=?`,status);}
 if(resource==='products'&&params.get('collection'))add('id IN (SELECT product_id FROM product_collections WHERE collection_id=?)',id(params.get('collection')));
 const filter=where.length?' WHERE '+where.join(' AND '):'';
 const paged=params.get('paged')==='true',limit=paged?integer(Number(params.get('limit')??25),100):200,offset=paged?integer(Number(params.get('offset')??0)):0;if(!limit)bad('Limit must be positive');
 const total=paged?Number((await db.query(`SELECT count(*) AS n FROM ${resource}${filter}`,args)).rows[0].n):0;
 const order=resource==='collections'?'position,id':'id';
 const rows=(await db.query(`SELECT * FROM ${resource}${filter} ORDER BY ${order} LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset])).rows;
 return paged?{items:rows,total,limit,offset}:rows;
}
export async function detail(db,resource,key){
 if(!fields[resource])throw new HttpError(404,'Not found');
 const row=(await db.query(`SELECT * FROM ${resource} WHERE id=$1`,[id(key)])).rows[0];if(!row)throw new HttpError(404,'Record not found');
 if(resource==='products'){
  row.collection_ids=(await db.query('SELECT collection_id FROM product_collections WHERE product_id=$1 ORDER BY collection_id',[key])).rows.map(x=>String(x.collection_id));
  row.media=(await db.query('SELECT media_id,position,alt FROM product_media WHERE product_id=$1 ORDER BY position',[key])).rows;
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
 let collectionIds,media;
 if(resource==='products'){
  row.price_minor=integer(value.price_minor??0);row.inventory=integer(value.inventory??0);
  row.sku=value.sku==null||value.sku===''?null:String(value.sku).trim();if(row.sku!==null&&(!row.sku||row.sku.length>80))bad('SKU must be 1–80 characters');
  if(input.collection_ids!==undefined)collectionIds=ids(input.collection_ids);
  else if(input.collection_id!==undefined)collectionIds=input.collection_id===null?[]:[id(input.collection_id)];
  else if(!key)collectionIds=[];
  row.collection_id=collectionIds?collectionIds[0]??null:old.collection_id;
  if(input.media!==undefined){if(!Array.isArray(input.media)||input.media.length>20)bad('Maximum 20 images');ids(input.media.map(x=>x.media_id));media=input.media.map(x=>({media_id:id(x.media_id),alt:String(x.alt??'')}));if(media.some(x=>x.alt.length>500))bad('Alt text too long');
   for(const m of media)if(!(await db.query("SELECT id FROM media WHERE id=$1 AND state='ready'",[m.media_id])).rows.length)bad('Choose verified ready media');}
 }else row.position=integer(value.position??0);
 const cols=Object.keys(row),values=Object.values(row);let result;
 if(key){values.push(key);result=(await db.query(`UPDATE ${resource} SET ${cols.map((c,i)=>`${c}=$${i+1}`).join(',')},revision=revision+1${resource==='products'?',updated_at=now()':''} WHERE id=$${values.length} RETURNING *`,values)).rows[0];}
 else result=(await db.query(`INSERT INTO ${resource} (${cols.join(',')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,values)).rows[0];
 if(collectionIds){await db.query('DELETE FROM product_collections WHERE product_id=$1',[result.id]);for(const c of collectionIds)await db.query('INSERT INTO product_collections VALUES ($1,$2)',[result.id,c]);}
 if(media){await db.query('DELETE FROM product_media WHERE product_id=$1',[result.id]);for(const [position,m]of media.entries())await db.query('INSERT INTO product_media(product_id,media_id,position,alt) VALUES($1,$2,$3,$4)',[result.id,m.media_id,position,m.alt]);}
 await db.query('INSERT INTO audit_events(actor,action,entity,entity_id) VALUES ($1,$2,$3,$4)',[actor,key?'update':'create',resource,result.id]);
 return result;
}
export const create=(db,resource,input,actor)=>save(db,resource,input,actor);
export async function dashboard(db){return (await db.query(`SELECT (SELECT count(*)::int FROM products) AS products,(SELECT count(*)::int FROM products WHERE status='active') AS active,(SELECT count(*)::int FROM products WHERE status='draft') AS drafts,(SELECT count(*)::int FROM products WHERE status='archived') AS archived,(SELECT count(*)::int FROM collections) AS collections,(SELECT count(*)::int FROM media WHERE state='ready') AS media`)).rows[0];}
