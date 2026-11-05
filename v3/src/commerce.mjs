import {createHash,randomUUID} from 'node:crypto';
import {HttpError} from './auth.mjs';
import {adjustStock,syncSummary} from './inventory.mjs';
import {amount} from './payments.mjs';
// Orders and payments. Everything a customer sends is re-priced on the server. Stock is reserved at
// checkout through the ledger ('sale') and released if the order expires or is cancelled
// ('sale_released'). Lock order everywhere: order row, then product rows by id, then variant rows.
export const STATES=['Johor','Kedah','Kelantan','Kuala Lumpur','Labuan','Melaka','Negeri Sembilan','Pahang','Penang','Perak','Perlis','Putrajaya','Sabah','Sarawak','Selangor','Terengganu'];
export const RESERVE_MINUTES=30;
const bad=message=>{throw new HttpError(400,message);};
const key=v=>{const s=String(v);if(!/^[1-9]\d{0,17}$/.test(s))bad('Invalid ID');return s;};
const hash=t=>createHash('sha256').update(t).digest('hex');
const str=(v,label,min,max)=>{const s=String(v??'').trim();if(s.length<min||s.length>max)bad(`${label} must be ${min}–${max} characters`);return s;};
const variantTitle=(names,values)=>values?.length?values.join(' / '):'';
async function lockProducts(db,ids){if(ids.length)await db.query('SELECT id FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',[[...new Set(ids.map(String))]]);}
const SELLABLE=`p.status='active' AND v.active AND EXISTS(SELECT 1 FROM product_collections pc JOIN collections c ON c.id=pc.collection_id WHERE pc.product_id=p.id AND c.status='active')`;

// Shopify rule copied: per shipping profile in the cart, the cheapest rate whose conditions match the
// items of that profile; the order pays the sum across profiles. A profile with no matching rate
// (e.g. luggage without a weight) cannot be shipped.
export async function quoteShipping(db,groups){
 const rates=(await db.query('SELECT * FROM shipping_rates WHERE active ORDER BY price_minor,id')).rows;
 let total=0;const names=[];
 for(const [profile,g] of Object.entries(groups)){
  const rate=rates.find(r=>r.profile===profile&&(r.min_subtotal_minor==null||g.subtotal>=r.min_subtotal_minor)&&(r.min_weight_grams==null||g.weight>=r.min_weight_grams)&&(r.max_weight_grams==null||g.weight<=r.max_weight_grams));
  if(!rate)throw new HttpError(409,profile==='luggage'?'Luggage shipping is not available for this order. Please chat with us.':'Shipping is not available for this order.');
  total+=rate.price_minor;names.push(rate.name);
 }
 return {shipping_minor:total,names:[...new Set(names)]};
}
function linesInput(value){
 if(!Array.isArray(value)||!value.length||value.length>50)bad('Your bag needs 1–50 items');
 const lines=value.map(l=>{if(!l||typeof l!=='object')bad('Invalid item');const q=l.quantity;if(!Number.isInteger(q)||q<1||q>20)bad('Quantity must be 1–20');return {variant_id:key(l.variant_id),quantity:q};});
 if(new Set(lines.map(l=>l.variant_id)).size!==lines.length)bad('Duplicate items');
 return lines;
}
// Prices the bag from the database. `lock` is used at checkout; the bag preview reads without locks.
async function price(db,lines,{strict=true}={}){
 const rows=(await db.query(`SELECT v.*,p.title,p.option_names,p.shipping_profile,p.weight_grams,p.handle,(${SELLABLE}) AS sellable FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id = ANY($1::bigint[])`,[lines.map(l=>l.variant_id)])).rows;
 const out=[],groups={};let subtotal=0;
 for(const l of lines){
  const v=rows.find(r=>String(r.id)===l.variant_id);
  if(!v||!v.sellable){if(strict)throw new HttpError(409,'An item in your bag is no longer available.');out.push({...l,available:false});continue;}
  const line={variant_id:l.variant_id,product_id:String(v.product_id),title:v.title,handle:v.handle,variant_title:variantTitle(v.option_names,v.option_values),sku:v.sku,unit_price_minor:v.price_minor,quantity:l.quantity,line_total_minor:v.price_minor*l.quantity,available:v.inventory>=l.quantity,in_stock:v.inventory};
  out.push(line);subtotal+=line.line_total_minor;
  const g=groups[v.shipping_profile]??={subtotal:0,weight:0};g.subtotal+=line.line_total_minor;g.weight+=v.weight_grams*l.quantity;
 }
 return {lines:out,subtotal,groups};
}
export async function quoteBag(db,input){
 const lines=linesInput(input?.lines);const priced=await price(db,lines,{strict:false});
 let shipping=null,shippingError=null;
 if(priced.lines.some(l=>l.available===false&&!l.title))shippingError='Remove unavailable items to continue.';
 else try{shipping=await quoteShipping(db,priced.groups);}catch(e){if(!e.status)throw e;shippingError=e.message;}
 return {lines:priced.lines.map(({in_stock,...l})=>({...l,low:in_stock!==undefined&&in_stock<=5})),subtotal_minor:priced.subtotal,shipping_minor:shipping?.shipping_minor??null,shipping_names:shipping?.names??[],shipping_error:shippingError,total_minor:shipping?priced.subtotal+shipping.shipping_minor:null,currency:'MYR'};
}
function customerInput(c){
 if(!c||typeof c!=='object')bad('Customer details required');
 const email=str(c.email,'Email',3,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))bad('Enter a valid email');
 const phone=str(c.phone,'Phone',6,30);if(!/^\+?[0-9 ()-]{6,30}$/.test(phone))bad('Enter a valid phone number');
 const postcode=String(c.postcode??'').trim();if(!/^\d{5}$/.test(postcode))bad('Postcode must be 5 digits');
 if(!STATES.includes(c.state))bad('Choose a state');
 return {customer_name:str(c.name,'Name',1,120),email,phone,address_line1:str(c.address_line1,'Address',1,200),address_line2:String(c.address_line2??'').trim().slice(0,200),city:str(c.city,'City',1,100),postcode,state:c.state,note:String(c.note??'').trim().slice(0,500)};
}
function token(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(value))bad('Invalid order access token');return value;}
async function newPayment(db,order,payments){
 const n=Number((await db.query('SELECT count(*) AS n FROM payments WHERE order_id=$1',[order.id])).rows[0].n)+1;
 if(n>10)throw new HttpError(429,'Too many payment attempts for this order. Please contact us.');
 const payment=(await db.query('INSERT INTO payments(order_id,provider,payment_ref,amount_minor) VALUES ($1,$2,$3,$4) RETURNING *',[order.id,payments.provider,`${order.number}P${n}`,order.total_minor])).rows[0];
 return payment;
}
const publicOrder=(o,lines,payment)=>({number:o.number,status:o.status,fulfillment_status:o.fulfillment_status,customer_name:o.customer_name,city:o.city,state:o.state,subtotal_minor:o.subtotal_minor,shipping_minor:o.shipping_minor,total_minor:o.total_minor,refunded_minor:o.refunded_minor,shipping_names:o.shipping_names,tracking_number:o.tracking_number,expires_at:o.expires_at,created_at:o.created_at,paid_at:o.paid_at,payment_status:payment?.status??null,lines:lines.map(l=>({title:l.title,variant_title:l.variant_title,quantity:l.quantity,unit_price_minor:l.unit_price_minor,line_total_minor:l.line_total_minor}))});
// Releases stock for unpaid orders past their reservation. Orders with a recent pending (e.g. FPX
// bank-pending) payment are kept for up to 24 hours while the bank confirms.
export async function sweepExpired(db,limit=20){
 const due=(await db.query(`SELECT id FROM orders o WHERE status='pending_payment' AND expires_at<now() AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='pending' AND p.updated_at>now()-interval '24 hours') ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED`,[limit])).rows;
 for(const {id} of due)await release(db,id,'expired');
 return due.length;
}
async function release(db,orderId,status,actor=null){
 const lines=(await db.query('SELECT * FROM order_lines WHERE order_id=$1 ORDER BY variant_id',[orderId])).rows;
 await lockProducts(db,lines.map(l=>l.product_id));
 const order=(await db.query("UPDATE orders SET status=$2,cancelled_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",[orderId,status])).rows[0];
 for(const l of lines)await adjustStock(db,{variantId:l.variant_id,delta:l.quantity,reason:'sale_released',note:`${order.number} ${status}`,actor,orderId});
 for(const p of new Set(lines.map(l=>String(l.product_id))))await syncSummary(db,p);
 return order;
}
export async function checkout(db,input,payments,custIp){
 if(!input||typeof input!=='object')bad('Object required');
 if(typeof input.idempotency_key!=='string'||!/^[0-9a-f-]{36}$/i.test(input.idempotency_key))bad('Invalid checkout key');
 const access=token(input.access_token);
 const existing=(await db.query('SELECT * FROM orders WHERE idempotency_key=$1 FOR UPDATE',[input.idempotency_key])).rows[0];
 if(existing){
  // Same checkout submitted twice (double click, retry after a network error): never a second order.
  if(existing.access_token_hash!==hash(access))throw new HttpError(409,'This checkout was already submitted.');
  const lines=(await db.query('SELECT * FROM order_lines WHERE order_id=$1 ORDER BY id',[existing.id])).rows;
  const last=(await db.query('SELECT * FROM payments WHERE order_id=$1 ORDER BY id DESC LIMIT 1',[existing.id])).rows[0];
  return {order:publicOrder(existing,lines,last),payment:existing.status==='pending_payment'&&last?.status==='initiated'?payments.request(last,existing,custIp):null};
 }
 await sweepExpired(db,5);
 const lines=linesInput(input.lines),customer=customerInput(input.customer);
 const priced=await price(db,lines);
 const shipping=await quoteShipping(db,priced.groups);
 const number='JSW'+(await db.query("SELECT nextval('order_number_seq') AS n")).rows[0].n;
 const order=(await db.query(`INSERT INTO orders(number,idempotency_key,access_token_hash,customer_name,email,phone,address_line1,address_line2,city,postcode,state,note,subtotal_minor,shipping_minor,total_minor,shipping_names,expires_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now()+make_interval(mins=>$17)) RETURNING *`,[number,input.idempotency_key,hash(access),customer.customer_name,customer.email,customer.phone,customer.address_line1,customer.address_line2,customer.city,customer.postcode,customer.state,customer.note,priced.subtotal,shipping.shipping_minor,priced.subtotal+shipping.shipping_minor,shipping.names.join(' · '),RESERVE_MINUTES])).rows[0];
 await lockProducts(db,priced.lines.map(l=>l.product_id));
 for(const l of priced.lines){
  await db.query('INSERT INTO order_lines(order_id,product_id,variant_id,title,variant_title,sku,unit_price_minor,quantity,line_total_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[order.id,l.product_id,l.variant_id,l.title,l.variant_title,l.sku,l.unit_price_minor,l.quantity,l.line_total_minor]);
  try{await adjustStock(db,{variantId:l.variant_id,delta:-l.quantity,reason:'sale',note:number,orderId:order.id});}
  catch(e){if(e.status===409){const left=(await db.query('SELECT inventory FROM product_variants WHERE id=$1',[l.variant_id])).rows[0].inventory;throw new HttpError(409,left?`Only ${left} left of ${l.title}${l.variant_title?' · '+l.variant_title:''}.`:`${l.title}${l.variant_title?' · '+l.variant_title:''} just sold out.`);}throw e;}
 }
 for(const p of new Set(priced.lines.map(l=>l.product_id)))await syncSummary(db,p);
 const payment=await newPayment(db,order,payments);
 const saved=(await db.query('SELECT * FROM order_lines WHERE order_id=$1 ORDER BY id',[order.id])).rows;
 return {order:publicOrder(order,saved,payment),payment:payments.request(payment,order,custIp)};
}
async function orderByToken(db,number,access,lock=false){
 if(!/^JSW\d{1,12}$/.test(number))throw new HttpError(404,'Order not found');
 const o=(await db.query(`SELECT * FROM orders WHERE number=$1${lock?' FOR UPDATE':''}`,[number])).rows[0];
 if(!o||o.access_token_hash!==hash(token(access)))throw new HttpError(404,'Order not found');
 return o;
}
export async function orderStatus(db,number,input){
 await sweepExpired(db,5);
 const o=await orderByToken(db,number,input?.access_token);
 const lines=(await db.query('SELECT * FROM order_lines WHERE order_id=$1 ORDER BY id',[o.id])).rows,last=(await db.query('SELECT * FROM payments WHERE order_id=$1 ORDER BY id DESC LIMIT 1',[o.id])).rows[0];
 return {order:publicOrder(o,lines,last)};
}
export async function retryPayment(db,number,input,payments,custIp){
 const o=await orderByToken(db,number,input?.access_token,true);
 if(o.status!=='pending_payment'||new Date(o.expires_at)<new Date())throw new HttpError(409,'This order can no longer be paid. Please place a new order.');
 const busy=(await db.query("SELECT 1 FROM payments WHERE order_id=$1 AND status IN ('succeeded','pending')",[o.id])).rows.length;
 if(busy)throw new HttpError(409,'A payment for this order is already being processed.');
 const payment=await newPayment(db,o,payments);
 return {payment:payments.request(payment,o,custIp)};
}
// Applies one gateway message. Safe to receive any number of times, in any order.
const keep=f=>Object.fromEntries(Object.entries(f).filter(([k])=>!/^(CardNo|CardHolder|CardExp|CVV|Token|HashValue2?)$/i.test(k)).map(([k,v])=>[k,String(v).slice(0,300)]).slice(0,40));
export async function gatewayMessage(db,source,fields,payments){
 const msg=payments.verify(fields);
 const event=async(paymentId,outcome)=>db.query('INSERT INTO payment_events(payment_id,source,verified,txn_status,outcome,payload) VALUES ($1,$2,$3,$4,$5,$6)',[paymentId,source,!!msg,msg?.txnStatus??null,outcome,JSON.stringify(keep(fields??{}))]);
 if(!msg){await event(null,'rejected_signature');return {ok:false};}
 const found=(await db.query('SELECT id,order_id FROM payments WHERE payment_ref=$1 AND provider=$2',[msg.paymentRef,payments.provider])).rows[0];
 if(!found){await event(null,'unknown_payment');return {ok:false};}
 const order=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[found.order_id])).rows[0];
 const payment=(await db.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE',[found.id])).rows[0];
 const flag=note=>db.query("UPDATE orders SET needs_attention=true,attention_note=trim(attention_note||' '||$2),updated_at=now() WHERE id=$1",[order.id,note]);
 if(msg.amount!==amount(payment.amount_minor)||msg.currency!=='MYR'){await event(payment.id,'rejected_amount');await flag(`Gateway reported ${msg.currency} ${msg.amount} for ${payment.payment_ref}; expected MYR ${amount(payment.amount_minor)}.`);return {ok:false,number:order.number};}
 if(payment.status==='succeeded'){await event(payment.id,'duplicate');return {ok:true,number:order.number};}
 if(msg.txnStatus==='0'){
  await db.query("UPDATE payments SET status='succeeded',provider_txn_id=$2,auth_code=$3,updated_at=now() WHERE id=$1",[payment.id,msg.txnId,msg.authCode]);
  if(order.status==='paid'){await event(payment.id,'duplicate_payment');await flag(`Second successful payment ${payment.payment_ref} received; refund one payment.`);return {ok:true,number:order.number};}
  if(order.status!=='pending_payment'){
   // Paid after the reservation was released: take the stock again if it is still there.
   const lines=(await db.query('SELECT * FROM order_lines WHERE order_id=$1 ORDER BY variant_id',[order.id])).rows;await lockProducts(db,lines.map(l=>l.product_id));
   const short=[];for(const l of lines){try{await adjustStock(db,{variantId:l.variant_id,delta:-l.quantity,reason:'sale',note:`${order.number} paid late`,orderId:order.id});}catch(e){if(e.status!==409)throw e;short.push(l.title);}}
   for(const p of new Set(lines.map(l=>String(l.product_id))))await syncSummary(db,p);
   if(short.length)await flag(`Paid after the order ${order.status}; not enough stock for ${short.join(', ')}. Restock or refund.`);
  }
  await db.query("UPDATE orders SET status='paid',paid_at=now(),cancelled_at=NULL,revision=revision+1,updated_at=now() WHERE id=$1",[order.id]);
  await event(payment.id,'paid');return {ok:true,number:order.number};
 }
 const next=msg.txnStatus==='2'?'pending':'failed';
 await db.query('UPDATE payments SET status=$2,provider_txn_id=coalesce($3,provider_txn_id),updated_at=now() WHERE id=$1',[payment.id,next,msg.txnId]);
 await event(payment.id,next);return {ok:true,number:order.number};
}
export async function mockComplete(db,input,payments){
 if(payments.provider!=='mock')throw new HttpError(404,'Not found');
 const o=await orderByToken(db,String(input?.number??''),input?.access_token);
 if(!['approve','decline','pending'].includes(input?.outcome))bad('Invalid outcome');
 const payment=(await db.query("SELECT * FROM payments WHERE order_id=$1 ORDER BY id DESC LIMIT 1",[o.id])).rows[0];if(!payment)throw new HttpError(404,'Payment not found');
 return gatewayMessage(db,'callback',payments.simulate(payment,o,input.outcome),payments);
}

// Staff (admin/editor write, viewer read).
export async function listOrders(db,params){
 await sweepExpired(db,20);
 const args=[],where=[];const add=(sql,v)=>{args.push(v);where.push(sql.replaceAll('?','$'+args.length));};
 const q=(params.get('q')??'').trim();if(q.length>150)bad('Search too long');if(q)add('(number ILIKE ? OR email ILIKE ? OR customer_name ILIKE ? OR phone ILIKE ?)','%'+q+'%');
 const st=params.get('status');if(st){if(!['pending_payment','paid','cancelled','expired','unfulfilled','attention'].includes(st))bad('Invalid filter');if(st==='unfulfilled')where.push("status='paid' AND fulfillment_status='unfulfilled'");else if(st==='attention')where.push('needs_attention');else add('status=?',st);}
 const limit=Number(params.get('limit')??25),offset=Number(params.get('offset')??0);if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)bad('Invalid paging');
 const filter=where.length?' WHERE '+where.join(' AND '):'';
 const total=Number((await db.query('SELECT count(*) AS n FROM orders'+filter,args)).rows[0].n);
 const rows=(await db.query(`SELECT id,number,status,fulfillment_status,needs_attention,customer_name,email,total_minor,refunded_minor,created_at,paid_at,(SELECT coalesce(sum(quantity),0)::int FROM order_lines l WHERE l.order_id=orders.id) AS items FROM orders${filter} ORDER BY id DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset])).rows;
 return {items:rows.map(r=>({...r,id:String(r.id)})),total,limit,offset};
}
export async function orderDetail(db,id){
 const o=(await db.query('SELECT * FROM orders WHERE id=$1',[key(id)])).rows[0];if(!o)throw new HttpError(404,'Order not found');
 const {access_token_hash,idempotency_key,...order}=o;
 const q=(sql)=>db.query(sql,[o.id]).then(r=>r.rows);
 return {...order,id:String(o.id),lines:await q('SELECT * FROM order_lines WHERE order_id=$1 ORDER BY id'),payments:await q('SELECT id,provider,payment_ref,amount_minor,status,provider_txn_id,auth_code,created_at,updated_at FROM payments WHERE order_id=$1 ORDER BY id'),
  events:await q('SELECT e.source,e.verified,e.txn_status,e.outcome,e.received_at,p.payment_ref FROM payment_events e JOIN payments p ON p.id=e.payment_id WHERE p.order_id=$1 ORDER BY e.id'),
  refunds:await q('SELECT r.amount_minor,r.reference,r.note,r.restocked,r.created_at,r.actor,s.role AS actor_role FROM refunds r LEFT JOIN staff s ON s.subject=r.actor WHERE r.order_id=$1 ORDER BY r.id'),
  stock:await q('SELECT a.reason,a.delta,a.quantity_after,a.created_at,v.sku FROM inventory_adjustments a JOIN product_variants v ON v.id=a.variant_id WHERE a.order_id=$1 ORDER BY a.id')};
}
async function lockedOrder(db,id,revision){
 const o=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[key(id)])).rows[0];if(!o)throw new HttpError(404,'Order not found');
 if(revision!==o.revision)throw new HttpError(409,'Order changed. Reload before continuing.');return o;
}
const orderAudit=(db,actor,action,id)=>db.query("INSERT INTO audit_events(actor,action,entity,entity_id) VALUES ($1,$2,'orders',$3)",[actor,action,id]);
export async function orderAction(db,id,action,input,actor){
 if(!input||typeof input!=='object')bad('Object required');
 const o=await lockedOrder(db,id,input.revision);
 if(action==='fulfil'){
  if(o.status!=='paid'||o.fulfillment_status==='fulfilled')bad('Only paid, unfulfilled orders can be marked fulfilled');
  const tracking=String(input.tracking_number??'').trim();if(tracking.length>80)bad('Tracking number too long');
  await db.query("UPDATE orders SET fulfillment_status='fulfilled',tracking_number=$2,fulfilled_at=now(),revision=revision+1,updated_at=now() WHERE id=$1",[o.id,tracking]);
 }else if(action==='cancel'){
  if(o.status!=='pending_payment')bad('Only unpaid orders can be cancelled. Record a refund for paid orders.');
  if((await db.query("SELECT 1 FROM payments WHERE order_id=$1 AND status IN ('pending','succeeded')",[o.id])).rows.length)throw new HttpError(409,'A payment for this order is in progress. Wait for the gateway result.');
  await release(db,o.id,'cancelled',actor);
 }else if(action==='refunds'){
  // Refunds are processed in the eGHL merchant portal; this records them and can restock once.
  if(o.status!=='paid')bad('Only paid orders can be refunded');
  const value=input.amount_minor;if(!Number.isInteger(value)||value<1||value>o.total_minor-o.refunded_minor)bad('Refund must be between RM 0.01 and the amount not yet refunded');
  const reference=str(input.reference,'eGHL refund reference',1,80),note=String(input.note??'').trim().slice(0,500),restock=input.restock===true;
  if(restock&&(await db.query('SELECT 1 FROM refunds WHERE order_id=$1 AND restocked',[o.id])).rows.length)bad('Items for this order were already restocked');
  await db.query('INSERT INTO refunds(order_id,amount_minor,reference,note,restocked,actor) VALUES ($1,$2,$3,$4,$5,$6)',[o.id,value,reference,note,restock,actor]);
  if(restock){const lines=(await db.query('SELECT * FROM order_lines WHERE order_id=$1 ORDER BY variant_id',[o.id])).rows;await lockProducts(db,lines.map(l=>l.product_id));for(const l of lines)await adjustStock(db,{variantId:l.variant_id,delta:l.quantity,reason:'returned',note:`${o.number} refund ${reference}`,actor,orderId:o.id});for(const p of new Set(lines.map(l=>String(l.product_id))))await syncSummary(db,p);}
  await db.query('UPDATE orders SET refunded_minor=refunded_minor+$2,revision=revision+1,updated_at=now() WHERE id=$1',[o.id,value]);
 }else if(action==='resolve'){
  if(!o.needs_attention)bad('Nothing to resolve');
  const note=str(input.note,'Resolution note',1,300);
  await db.query("UPDATE orders SET needs_attention=false,attention_note=trim(attention_note||' Resolved: '||$2),revision=revision+1,updated_at=now() WHERE id=$1",[o.id,note]);
 }else throw new HttpError(404,'Not found');
 await orderAudit(db,actor,action==='refunds'?'refund':action,o.id);
 return orderDetail(db,o.id);
}
// Customers are derived from paid orders until the JS Membership integration is defined.
export async function listCustomers(db,params){
 const q=(params.get('q')??'').trim();if(q.length>150)bad('Search too long');
 const limit=Number(params.get('limit')??25),offset=Number(params.get('offset')??0);if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)bad('Invalid paging');
 const args=q?['%'+q+'%']:[],filter=q?' AND (email ILIKE $1 OR customer_name ILIKE $1 OR phone ILIKE $1)':'';
 const base=`FROM orders WHERE status='paid'${filter} GROUP BY lower(email)`;
 const total=Number((await db.query(`SELECT count(*) AS n FROM (SELECT 1 ${base}) x`,args)).rows[0].n);
 const rows=(await db.query(`SELECT lower(email) AS email,(array_agg(customer_name ORDER BY id DESC))[1] AS name,(array_agg(phone ORDER BY id DESC))[1] AS phone,(array_agg(state ORDER BY id DESC))[1] AS state,count(*)::int AS orders,sum(total_minor-refunded_minor)::bigint AS spent_minor,max(paid_at) AS last_order_at ${base} ORDER BY max(paid_at) DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset])).rows;
 return {items:rows.map(r=>({...r,spent_minor:Number(r.spent_minor)})),total,limit,offset};
}
export async function shippingRates(db){return (await db.query('SELECT profile,name,price_minor,min_subtotal_minor,min_weight_grams,max_weight_grams FROM shipping_rates WHERE active ORDER BY profile,price_minor')).rows;}
// Public product page data: sellable variants only, availability without exact stock counts.
export async function storefrontProduct(db,handle){
 if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(handle))throw new HttpError(404,'Product not found');
 const p=(await db.query(`SELECT p.id,p.title,p.handle,p.description,p.option_names,p.shipping_profile FROM products p WHERE p.handle=$1 AND p.status='active' AND EXISTS(SELECT 1 FROM product_collections pc JOIN collections c ON c.id=pc.collection_id WHERE pc.product_id=p.id AND c.status='active')`,[handle])).rows[0];
 if(!p)throw new HttpError(404,'Product not found');
 const variants=(await db.query('SELECT id,option_values,price_minor,inventory FROM product_variants WHERE product_id=$1 AND active ORDER BY position,id',[p.id])).rows.map(v=>({id:String(v.id),option_values:v.option_values,price_minor:v.price_minor,available:v.inventory>0,low:v.inventory>0&&v.inventory<=5}));
 return {product:{...p,id:String(p.id),variants},checkoutAvailable:true};
}
export {randomUUID};
