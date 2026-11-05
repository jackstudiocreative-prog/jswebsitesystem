import rules from '../../shared/catalog.js';
import {HttpError} from './auth.mjs';
// Variants and the append-only stock ledger. Callers run inside the request transaction.
// Lock order is always product row, then variant rows, so saves and stock adjustments serialize.
export const REASONS=['received','stocktake','correction','damaged','returned','transfer','other'];
const bad=message=>{throw new HttpError(400,message);};
const key=value=>{const s=String(value);if(!/^[1-9]\d{0,17}$/.test(s))bad('Invalid ID');return s;};
const whole=(value,label,min=0,max=2147483647)=>{if(!Number.isInteger(value)||value<min||value>max)bad(`${label} must be a whole number between ${min} and ${max}`);return value;};
const text=(value,label,max)=>{const s=String(value??'').trim();if(!s||s.length>max)bad(`${label} must be 1–${max} characters`);return s;};
const shape=v=>({...v,id:String(v.id),product_id:String(v.product_id),media_id:v.media_id==null?null:String(v.media_id),stock_status:rules.stockStatus(v.inventory,v.active)});

export async function variantsFor(db,productId,lock=false){
 return (await db.query(`SELECT * FROM product_variants WHERE product_id=$1 ORDER BY position,id${lock?' FOR UPDATE':''}`,[productId])).rows;
}
// One statement: the stock change and its ledger row commit together or not at all. The WHERE
// guard is re-checked after any row lock wait, so concurrent removals can never go below zero.
export async function adjustStock(db,{variantId,delta,reason,note='',actor,orderId=null}){
 if(delta===0)return null;
 const row=(await db.query(`WITH v AS (UPDATE product_variants SET inventory=inventory+$2,updated_at=now() WHERE id=$1 AND inventory+$2>=0 RETURNING id,product_id,inventory)
  INSERT INTO inventory_adjustments(variant_id,product_id,delta,quantity_before,quantity_after,reason,note,actor,order_id)
  SELECT id,product_id,$2,inventory-$2,inventory,$3,$4,$5,$6 FROM v RETURNING *`,[variantId,delta,reason,note,actor??null,orderId])).rows[0];
 if(!row)throw new HttpError(409,'Inventory cannot go below zero.');
 return row;
}
// Legacy product columns stay readable: lowest active price, total active stock, first active SKU.
export async function syncSummary(db,productId){
 await db.query(`UPDATE products SET price_minor=coalesce((SELECT min(price_minor) FROM product_variants WHERE product_id=$1 AND active),0),
  inventory=least(coalesce((SELECT sum(inventory) FROM product_variants WHERE product_id=$1 AND active),0),2147483647),
  sku=(SELECT sku FROM product_variants WHERE product_id=$1 AND active ORDER BY position,id LIMIT 1) WHERE id=$1`,[productId]);
}
function optionNames(value){
 if(!Array.isArray(value)||value.length>3)bad('Use up to 3 options');
 const names=value.map(n=>text(n,'Option name',40));
 if(new Set(names.map(n=>n.toLowerCase())).size!==names.length)bad('Option names must be different');
 return names;
}
function variantInput(v,count){
 if(!v||typeof v!=='object'||Array.isArray(v))bad('Variant object required');
 if(Object.keys(v).some(k=>!['id','option_values','sku','price_minor','active','media_id','inventory'].includes(k)))bad('Unknown variant field');
 const values=v.option_values??[];if(!Array.isArray(values)||values.length!==count)bad(`Each variant needs ${count} option value${count===1?'':'s'}`);
 const sku=v.sku==null||String(v.sku).trim()===''?null:text(v.sku,'SKU',80);
 return {id:v.id==null?null:key(v.id),option_values:values.map(x=>text(x,'Option value',60)),sku,price_minor:whole(v.price_minor??0,'Price'),active:v.active===undefined?true:v.active,media_id:v.media_id==null||v.media_id===''?null:key(v.media_id),inventory:v.inventory};
}
// Builds and applies the variant list for a product save. Products without options keep exactly
// one default variant, so pre-variant API clients (price_minor/sku/inventory) keep working.
export async function saveVariants(db,{productId,input,old,optionNamesValue,mediaIds,actor}){
 const legacy=['price_minor','sku','inventory'].filter(k=>input[k]!==undefined);
 if(input.variants!==undefined&&legacy.length)bad('Send price, SKU and stock per variant');
 if(input.option_names!==undefined&&input.variants===undefined)bad('Changing options requires the full variant list');
 const existing=old?await variantsFor(db,productId,true):[];
 const names=optionNamesValue;let list;
 if(input.variants!==undefined){
  if(!Array.isArray(input.variants)||!input.variants.length||input.variants.length>100)bad('Products need 1–100 variants');
  list=input.variants.map(v=>variantInput(v,names.length));
  const ids=list.filter(v=>v.id).map(v=>v.id);
  if(new Set(ids).size!==ids.length||ids.some(i=>!existing.some(e=>String(e.id)===i)))bad('Unknown or duplicate variant');
  if(existing.some(e=>!ids.includes(String(e.id))))bad('Variants cannot be removed. Deactivate them instead.');
  if(!names.length&&list.length!==1)bad('Add an option such as Color or Size to create more than one variant');
  const combos=list.map(v=>v.option_values.map(x=>x.toLowerCase()).join('\u0000'));if(new Set(combos).size!==combos.length)bad('Each variant needs a different option combination');
  if(list.some(v=>typeof v.active!=='boolean'))bad('Variant active must be true or false');
  if(list.some(v=>v.id&&v.inventory!==undefined))bad('Change existing stock with an inventory adjustment');
  for(const v of list)if(v.inventory!==undefined)whole(v.inventory,'Inventory');
 }else if(!old){
  list=[variantInput({sku:input.sku,price_minor:input.price_minor,inventory:input.inventory},0)];whole(list[0].inventory??0,'Inventory');
 }else if(legacy.length){
  if(names.length||existing.length!==1)bad('This product has variants. Edit price, SKU and stock per variant.');
  const e=existing[0],merged={sku:input.sku!==undefined?input.sku:e.sku,price_minor:input.price_minor!==undefined?input.price_minor:e.price_minor};
  list=[{...variantInput(merged,0),id:String(e.id),active:e.active,media_id:e.media_id==null?null:String(e.media_id)}];
  if(input.inventory!==undefined)list[0].stockTarget=whole(input.inventory,'Inventory');
 }
 const usable=list??existing.map(e=>({media_id:e.media_id==null?null:String(e.media_id)}));
 if(usable.some(v=>v.media_id&&!mediaIds.includes(v.media_id)))bad('A variant image must be one of the product images');
 if(!list)return;
 for(const [position,v] of list.entries()){
  if(v.id){
   const e=existing.find(x=>String(x.id)===v.id),changed=JSON.stringify(e.option_values)!==JSON.stringify(v.option_values)||e.sku!==v.sku||e.price_minor!==v.price_minor||e.position!==position||e.active!==v.active||String(e.media_id??'')!==String(v.media_id??'');
   if(changed){await db.query('UPDATE product_variants SET option_values=$1,sku=$2,price_minor=$3,position=$4,active=$5,media_id=$6,updated_at=now() WHERE id=$7',[v.option_values,v.sku,v.price_minor,position,v.active,v.media_id,v.id]);await db.query("INSERT INTO audit_events(actor,action,entity,entity_id) VALUES ($1,'update','product_variants',$2)",[actor,v.id]);}
   if(v.stockTarget!==undefined&&v.stockTarget!==e.inventory)await adjustStock(db,{variantId:v.id,delta:v.stockTarget-e.inventory,reason:'correction',note:'Edited from product form',actor});
  }else{
   const created=(await db.query('INSERT INTO product_variants(product_id,option_values,sku,price_minor,position,active,media_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',[productId,v.option_values,v.sku,v.price_minor,position,v.active,v.media_id])).rows[0];
   // A new product's own 'create' audit covers its first variants.
   if(old)await db.query("INSERT INTO audit_events(actor,action,entity,entity_id) VALUES ($1,'create','product_variants',$2)",[actor,created.id]);
   if(v.inventory)await adjustStock(db,{variantId:created.id,delta:v.inventory,reason:'initial',actor});
  }
 }
}
export {optionNames};
export async function adjust(db,input,actor){
 if(!input||typeof input!=='object'||Array.isArray(input))bad('Object required');
 if(Object.keys(input).some(k=>!['variant_id','delta','set_to','expected','reason','note'].includes(k)))bad('Unknown field');
 if((input.delta===undefined)===(input.set_to===undefined))bad('Send either a quantity change or a counted quantity');
 if(!REASONS.includes(input.reason))bad('Choose an adjustment reason');
 const note=String(input.note??'').trim();if(note.length>500)bad('Note must be 500 characters or fewer');if(input.reason==='other'&&!note)bad('Add a note for “Other” adjustments');
 const variantId=key(input.variant_id);
 const owner=(await db.query('SELECT product_id FROM product_variants WHERE id=$1',[variantId])).rows[0];if(!owner)throw new HttpError(404,'Variant not found');
 await db.query('SELECT id FROM products WHERE id=$1 FOR UPDATE',[owner.product_id]);
 const v=(await db.query('SELECT * FROM product_variants WHERE id=$1 FOR UPDATE',[variantId])).rows[0];
 // A counted quantity overwrites stock, so it must be based on the quantity the employee saw.
 if(input.expected!==undefined&&whole(input.expected,'Expected quantity')!==v.inventory)throw new HttpError(409,'Stock changed since you loaded it. Reload before adjusting.');
 if(input.set_to!==undefined&&input.expected===undefined)bad('Counted quantity requires the expected current quantity');
 const delta=input.delta!==undefined?whole(input.delta,'Quantity change',-1000000,1000000):whole(input.set_to,'Counted quantity')-v.inventory;
 if(!delta)bad('Quantity is unchanged');
 const adjustment=await adjustStock(db,{variantId,delta,reason:input.reason,note,actor});
 await syncSummary(db,owner.product_id);
 await db.query("INSERT INTO audit_events(actor,action,entity,entity_id) VALUES ($1,'adjust','inventory_adjustments',$2)",[actor,adjustment.id]);
 const variant=(await db.query('SELECT * FROM product_variants WHERE id=$1',[variantId])).rows[0];
 return {adjustment,variant:shape(variant)};
}
function paging(params){
 const limit=Number(params.get('limit')??25),offset=Number(params.get('offset')??0);
 whole(limit,'Limit',1,100);whole(offset,'Offset');return {limit,offset};
}
export async function inventoryList(db,params){
 const args=[],where=[];const add=(sql,value)=>{args.push(value);where.push(sql.replaceAll('?','$'+args.length));};
 const q=params.get('q')??'';if(q.length>150)bad('Search too long');if(q)add("(p.title ILIKE ? OR coalesce(v.sku,'') ILIKE ?)",'%'+q+'%');
 const stock=params.get('stock');if(stock){if(!['in','low','out'].includes(stock))bad('Invalid filter');if(stock==='out')where.push('v.inventory=0');else add(stock==='low'?'v.inventory BETWEEN 1 AND ?':'v.inventory>?',rules.lowStock);}
 if(params.get('product'))add('v.product_id=?',key(params.get('product')));
 if(params.get('include_inactive')!=='true')where.push("v.active AND p.status<>'archived'");
 const {limit,offset}=paging(params),filter=where.length?' WHERE '+where.join(' AND '):'';
 const total=Number((await db.query(`SELECT count(*) AS n FROM product_variants v JOIN products p ON p.id=v.product_id${filter}`,args)).rows[0].n);
 const rows=(await db.query(`SELECT v.*,p.title AS product_title,p.status AS product_status,p.option_names FROM product_variants v JOIN products p ON p.id=v.product_id${filter} ORDER BY p.title,p.id,v.position,v.id LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset])).rows;
 return {items:rows.map(shape),total,limit,offset,low_stock_at:rules.lowStock};
}
export async function adjustmentList(db,params){
 const args=[],where=[];const add=(sql,value)=>{args.push(value);where.push(sql.replace('?','$'+args.length));};
 if(params.get('variant'))add('a.variant_id=?',key(params.get('variant')));
 if(params.get('product'))add('a.product_id=?',key(params.get('product')));
 const {limit,offset}=paging(params),filter=where.length?' WHERE '+where.join(' AND '):'';
 const total=Number((await db.query(`SELECT count(*) AS n FROM inventory_adjustments a${filter}`,args)).rows[0].n);
 const rows=(await db.query(`SELECT a.*,p.title AS product_title,v.sku,v.option_values,p.option_names,s.role AS actor_role FROM inventory_adjustments a JOIN product_variants v ON v.id=a.variant_id JOIN products p ON p.id=a.product_id LEFT JOIN staff s ON s.subject=a.actor${filter} ORDER BY a.id DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset])).rows;
 return {items:rows,total,limit,offset};
}
export {shape as variantShape};
