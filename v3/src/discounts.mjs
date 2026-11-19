// Discounts (migration 012): codes customers type and automatic discounts.
//
// Rules (shown to staff in the admin as well):
//  - At most ONE product discount per order (percentage or fixed amount): the entered code, or the
//    best automatic discount if that saves more. A code that saves less is reported, not stacked.
//  - At most ONE free-shipping discount, which combines with the product discount.
//  - Percentage/fixed apply to the eligible items only (all, chosen collections or chosen products);
//    a fixed amount never exceeds what those items cost. Minimum spend = bag subtotal before discounts.
//  - Valid from starts_at until ends_at; inactive discounts never apply.
//  - Usage limit counts orders that used the discount (claimed at checkout, released if the order is
//    cancelled or expires unpaid; a refund does not give the use back). "Once per customer" = once per
//    email address across unpaid and paid orders.
//  - Everything is computed here, on the server, from the database. The browser only sends the code.
import {HttpError} from './auth.mjs';
import {hasColumn} from './schema.mjs';

const bad=m=>{throw new HttpError(400,m);};
export const MIGRATION_012='Discounts need database migration 012. Ask the operator to apply it.';
const CODE=/^[A-Z0-9][A-Z0-9_-]{2,31}$/;
export const normalizeCode=c=>String(c??'').trim().toUpperCase();
export const available=db=>hasColumn(db,'orders','discount_minor');

const FIELDS=['code','title','kind','value','applies_to','collection_ids','product_ids','min_subtotal_minor','starts_at','ends_at','usage_limit','once_per_customer','active','revision'];
const ids=v=>{if(!Array.isArray(v)||v.length>500)bad('Invalid list');return [...new Set(v.map(String))].map(x=>{if(!/^[1-9]\d{0,17}$/.test(x))bad('Invalid id');return x;});};
const date=(v,label)=>{if(v==null||v==='')return null;const d=new Date(v);if(Number.isNaN(d.getTime()))bad(`${label} is not a valid date`);return d.toISOString();};

function input(body,old={}){
 if(!body||typeof body!=='object')bad('Object required');
 for(const k of Object.keys(body))if(!FIELDS.includes(k))bad(`Unknown field ${k}`);
 const v={...old,...body};
 const code=v.code==null||v.code===''?null:normalizeCode(v.code);
 if(code!==null&&!CODE.test(code))bad('Code: 3–32 letters, numbers, - or _');
 const title=String(v.title??'').trim();if(!title||title.length>120)bad('Title is required (up to 120 characters)');
 if(!['percentage','fixed','free_shipping'].includes(v.kind))bad('Choose a discount type');
 const value=v.kind==='free_shipping'?0:Number(v.value);
 if(v.kind==='percentage'&&!(Number.isInteger(value)&&value>=1&&value<=100))bad('Percentage must be 1–100');
 if(v.kind==='fixed'&&!(Number.isInteger(value)&&value>0&&value<=10000000))bad('Amount must be more than RM0');
 const applies_to=v.applies_to??'all';if(!['all','collections','products'].includes(applies_to))bad('Invalid “applies to”');
 const collection_ids=applies_to==='collections'?ids(v.collection_ids??[]):[],product_ids=applies_to==='products'?ids(v.product_ids??[]):[];
 if(applies_to==='collections'&&!collection_ids.length)bad('Choose at least one collection');
 if(applies_to==='products'&&!product_ids.length)bad('Choose at least one product');
 if(v.kind==='free_shipping'&&applies_to!=='all')bad('Free shipping applies to the whole order');
 const min=Number(v.min_subtotal_minor??0);if(!Number.isInteger(min)||min<0||min>100000000)bad('Invalid minimum spend');
 const starts_at=date(v.starts_at,'Start')??new Date().toISOString(),ends_at=date(v.ends_at,'End');
 if(ends_at&&ends_at<=starts_at)bad('End must be after start');
 const usage_limit=v.usage_limit==null||v.usage_limit===''?null:Number(v.usage_limit);
 if(usage_limit!==null&&!(Number.isInteger(usage_limit)&&usage_limit>0&&usage_limit<=1000000))bad('Usage limit must be a whole number above 0');
 return {code,title,kind:v.kind,value,applies_to,collection_ids,product_ids,min_subtotal_minor:min,starts_at,ends_at,usage_limit,once_per_customer:v.once_per_customer===true,active:v.active!==false};
}
const shape=d=>d&&{...d,id:String(d.id),collection_ids:(d.collection_ids??[]).map(String),product_ids:(d.product_ids??[]).map(String),
 status:!d.active?'inactive':new Date(d.starts_at)>new Date()?'scheduled':d.ends_at&&new Date(d.ends_at)<=new Date()?'expired':d.usage_limit!=null&&d.used_count>=d.usage_limit?'used up':'active'};

export async function listDiscounts(db,params){
 if(!await available(db))throw new HttpError(503,MIGRATION_012);
 const q=String(params.get('q')??'').trim().slice(0,80);const args=[];let where='';
 if(q){args.push('%'+q.replace(/[\\%_]/g,m=>'\\'+m)+'%');where='WHERE title ILIKE $1 OR coalesce(code,\'\') ILIKE $1';}
 const items=(await db.query(`SELECT * FROM discounts ${where} ORDER BY active DESC,id DESC LIMIT 200`,args)).rows.map(shape);
 return {items,total:items.length};
}
export async function discountDetail(db,id){
 if(!await available(db))throw new HttpError(503,MIGRATION_012);
 const d=(await db.query('SELECT * FROM discounts WHERE id=$1',[id])).rows[0];if(!d)throw new HttpError(404,'Discount not found');
 const orders=(await db.query("SELECT count(*)::int AS n,coalesce(sum(od.amount_minor),0)::int AS saved FROM order_discounts od JOIN orders o ON o.id=od.order_id WHERE od.discount_id=$1 AND o.status='paid'",[id])).rows[0];
 return {...shape(d),paid_orders:orders.n,saved_minor:orders.saved};
}
export async function saveDiscount(db,id,body,actor){
 if(!await available(db))throw new HttpError(503,MIGRATION_012);
 let old=null;
 if(id){old=(await db.query('SELECT * FROM discounts WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw new HttpError(404,'Discount not found');
  if(body?.revision!==old.revision)throw new HttpError(409,'This discount was changed by someone else. Reload and try again.');}
 const {revision,...rest}=body??{};
 const v=input(rest,old?{...old,collection_ids:old.collection_ids.map(String),product_ids:old.product_ids.map(String),starts_at:old.starts_at,ends_at:old.ends_at}:{});
 if(old&&v.usage_limit!==null&&v.usage_limit<old.used_count)bad(`Usage limit cannot be below the ${old.used_count} uses already made`);
 if(v.code){const clash=(await db.query('SELECT id FROM discounts WHERE code=$1 AND id<>$2',[v.code,id??0])).rows[0];if(clash)throw new HttpError(409,'Another discount already uses this code');}
 const cols=['code','title','kind','value','applies_to','collection_ids','product_ids','min_subtotal_minor','starts_at','ends_at','usage_limit','once_per_customer','active'];
 const vals=cols.map(c=>v[c]);
 const row=old
  ?(await db.query(`UPDATE discounts SET ${cols.map((c,i)=>`${c}=$${i+2}`).join(',')},revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,[id,...vals])).rows[0]
  :(await db.query(`INSERT INTO discounts(${cols.join(',')},created_by) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')},$${cols.length+1}) RETURNING *`,[...vals,actor])).rows[0];
 return shape(row);
}

// --- Applying discounts to a priced bag ------------------------------------------------------------
const LIVE="active AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now()) AND (usage_limit IS NULL OR used_count<usage_limit)";
async function eligibleSubtotal(db,d,lines){
 if(d.applies_to==='all')return lines.reduce((s,l)=>s+l.line_total_minor,0);
 const pids=[...new Set(lines.map(l=>l.product_id))];
 const ok=new Set(d.applies_to==='products'?d.product_ids.map(String).filter(p=>pids.includes(p))
  :(await db.query('SELECT DISTINCT product_id FROM product_collections WHERE product_id = ANY($1::bigint[]) AND collection_id = ANY($2::bigint[])',[pids,d.collection_ids])).rows.map(r=>String(r.product_id)));
 return lines.filter(l=>ok.has(l.product_id)).reduce((s,l)=>s+l.line_total_minor,0);
}
const amountFor=(d,eligible)=>d.kind==='percentage'?Math.floor(eligible*d.value/100):d.kind==='fixed'?Math.min(d.value,eligible):0;
async function usedBy(db,d,email){
 if(!d.once_per_customer||!email)return false;
 return (await db.query("SELECT 1 FROM order_discounts od JOIN orders o ON o.id=od.order_id WHERE od.discount_id=$1 AND NOT od.released AND lower(o.email)=$2 AND o.status IN ('pending_payment','paid') LIMIT 1",[d.id,email.toLowerCase()])).rows.length>0;
}
// Why a code does not apply (customer-facing), or null.
async function codeProblem(db,d,lines,subtotal,email){
 if(!d||!d.active)return 'This code is not valid.';
 if(new Date(d.starts_at)>new Date())return 'This code is not active yet.';
 if(d.ends_at&&new Date(d.ends_at)<=new Date())return 'This code has expired.';
 if(d.usage_limit!=null&&d.used_count>=d.usage_limit)return 'This code has been fully used.';
 if(subtotal<d.min_subtotal_minor)return `Spend RM${(d.min_subtotal_minor/100).toFixed(2)} or more to use this code.`;
 if(d.kind!=='free_shipping'&&!(await eligibleSubtotal(db,d,lines)))return 'This code does not apply to the items in your bag.';
 if(await usedBy(db,d,email))return 'This code can be used once per customer.';
 return null;
}
// → {product, shipping, code_error, discount_minor}. product/shipping: {id,code,title,kind,amount_minor}.
export async function evaluate(db,{lines,subtotal,shipping_minor,code,email}){
 const none={product:null,shipping:null,code_error:null,discount_minor:0};
 if(!await available(db))return code?{...none,code_error:'Discount codes are not available yet.'}:none;
 const sellable=lines.filter(l=>l.title&&l.available!==false);
 const wanted=normalizeCode(code);let entered=null,code_error=null;
 if(wanted){entered=(await db.query('SELECT * FROM discounts WHERE code=$1',[wanted])).rows[0]??null;code_error=await codeProblem(db,entered,sellable,subtotal,email);if(code_error)entered=null;}
 const autos=(await db.query(`SELECT * FROM discounts WHERE code IS NULL AND ${LIVE} AND min_subtotal_minor<=$1 ORDER BY id`,[subtotal])).rows;
 const candidates=[];
 for(const d of [...(entered?[entered]:[]),...autos]){if(d.code===null&&await usedBy(db,d,email))continue;
  const amount=d.kind==='free_shipping'?shipping_minor??0:amountFor(d,await eligibleSubtotal(db,d,sellable));candidates.push({d,amount});}
 const pick=list=>list.sort((a,b)=>b.amount-a.amount||(a.d.code?-1:1))[0]??null;
 const product=pick(candidates.filter(c=>c.d.kind!=='free_shipping'&&c.amount>0));
 const ship=pick(candidates.filter(c=>c.d.kind==='free_shipping'&&c.amount>0));
 if(entered&&entered.kind!=='free_shipping'&&product&&product.d.id!==entered.id)code_error='A better discount is already applied to this bag.';
 if(entered&&entered.kind==='free_shipping'&&!ship)code_error=shipping_minor?null:'Shipping is already free for this bag.';
 const view=c=>c&&{id:String(c.d.id),code:c.d.code,title:c.d.title,kind:c.d.kind,amount_minor:c.amount};
 return {product:view(product),shipping:view(ship),code_error,discount_minor:(product?.amount??0)+(ship?.amount??0)};
}
// Checkout: claim each used discount (atomic usage count) and keep a snapshot on the order.
export async function claim(db,orderId,result,email){
 for(const c of [result.product,result.shipping].filter(Boolean)){
  const d=(await db.query(`UPDATE discounts SET used_count=used_count+1 WHERE id=$1 AND ${LIVE} RETURNING *`,[c.id])).rows[0];
  if(!d)throw new HttpError(409,`The discount “${c.title}” is no longer available. Review your bag and try again.`);
  if(d.once_per_customer&&await usedBy(db,d,email))throw new HttpError(409,'This code can be used once per customer.');
  await db.query('INSERT INTO order_discounts(order_id,discount_id,code,title,kind,amount_minor) VALUES ($1,$2,$3,$4,$5,$6)',[orderId,c.id,c.code,c.title,c.kind,c.amount_minor]);
 }
}
// An unpaid order that is cancelled or expires gives its discount uses back (once).
export async function release(db,orderId){
 if(!await available(db))return;
 const rows=(await db.query('UPDATE order_discounts SET released=true WHERE order_id=$1 AND NOT released RETURNING discount_id',[orderId])).rows;
 for(const r of rows)await db.query('UPDATE discounts SET used_count=greatest(used_count-1,0) WHERE id=$1',[r.discount_id]);
}
export async function reclaim(db,orderId){
 if(!await available(db))return;
 const rows=(await db.query('UPDATE order_discounts SET released=false WHERE order_id=$1 AND released RETURNING discount_id',[orderId])).rows;
 for(const r of rows)await db.query('UPDATE discounts SET used_count=used_count+1 WHERE id=$1',[r.discount_id]);
}
export async function orderDiscounts(db,orderId){
 if(!await available(db))return [];
 return (await db.query('SELECT code,title,kind,amount_minor,released FROM order_discounts WHERE order_id=$1 ORDER BY id',[orderId])).rows;
}
