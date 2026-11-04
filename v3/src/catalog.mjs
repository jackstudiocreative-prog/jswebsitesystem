import rules from '../../shared/catalog.js';
import { HttpError } from './auth.mjs';
const fields={products:['title','handle','description','status','collection_id'],collections:['title','slug','description','status']};
export async function list(db,resource){
 if(!['products','collections','media'].includes(resource))throw new HttpError(404,'Not found');
 return (await db.query(`SELECT * FROM ${resource} ORDER BY id LIMIT 200`)).rows;
}
export async function create(db,resource,input,actor){
 if(!fields[resource])throw new HttpError(404,'Not found');
 if(!input || typeof input!=='object' || Array.isArray(input))throw new HttpError(400,'Object required');
 const allowed=fields[resource];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw new HttpError(400,'Unknown field');
 const title=String(input.title??'').trim();
 const key=resource==='products'?'handle':'slug';
 const slug=rules.slug(input[key]??title);
 if(!title || title.length>(resource==='products'?150:90) || !slug)throw new HttpError(400,'Title and slug required');
 const row={title,[key]:slug,description:String(input.description??''),status:input.status??'draft'};
 if(!['draft','active',...(resource==='products'?['archived']:[])].includes(row.status))throw new HttpError(400,'Invalid status');
 if(row.description.length>20000)throw new HttpError(400,'Description too long');
 if(resource==='products')row.collection_id=input.collection_id??null;
 const cols=Object.keys(row);
 const result=(await db.query(`INSERT INTO ${resource} (${cols.join(',')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(row))).rows[0];
 await db.query('INSERT INTO audit_events(actor,action,entity,entity_id) VALUES ($1,$2,$3,$4)',[actor,'create',resource,result.id]);
 return result;
}
