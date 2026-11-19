import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {testGateway,responseHash2} from '../src/payments.mjs';
import {mailerFromEnv,sendPending} from '../src/mailer.mjs';

const SECRET='s'.repeat(40),MAINT='maintenance-test-'.repeat(3);
const gateway=testGateway({provider:'mock',serviceId:'JSMOCK',password:SECRET,actionUrl:'https://pay.test/mock',baseUrl:'https://shop.test'});
// A recording mailer: never contacts a real provider.
function fakeMailer({live=false,test='qa@jackstudio.test',fail=null}={}){const sent=[];return {sent,configured:true,live,test,async send(m){if(fail){const f=fail(m);if(f)throw f;}sent.push(m);return 'msg_'+sent.length;}};}
async function harness(mailer=fakeMailer()){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");await db.query('SET ROLE jackstudio_api');
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{payments:gateway,rateLimits:false,maintenanceSecret:MAINT,mailer}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:r.status,body:json};};
 const form=async(path,fields)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields).toString()});return r.text();};
 const shop=(await request('collections','POST',{title:'Shop',status:'active'})).body,bags=(await request('collections','POST',{title:'Bags',status:'active'})).body;
 const mk=async body=>{const p=(await request('products','POST',{status:'active',collection_ids:[String(shop.id)],...body})).body;return {product:p,variant:(await request('products/'+p.id)).body.variants[0]};};
 const wallet=await mk({title:'Wallet',sku:'W-1',price_minor:4500,inventory:20});
 const bag=await mk({title:'Tote Bag',sku:'B-1',price_minor:20000,inventory:20,collection_ids:[String(shop.id),String(bags.id)]});
 const sweep=()=>fetch(base+'maintenance/expire-orders',{method:'POST',headers:{authorization:'Bearer '+MAINT}}).then(r=>r.json());
 return {db,request,form,sweep,wallet,bag,bags,mailer,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
const customer={name:'Aisyah Rahman',email:'aisyah@example.com',phone:'+60 12-345 6789',address_line1:'12 Jalan Klang',city:'Klang',postcode:'41000',state:'Selangor'};
const order=(lines,extra={})=>({idempotency_key:randomUUID(),access_token:randomBytes(24).toString('base64url'),customer,lines,...extra});
const asOwner=async(db,q,args)=>{await db.query('RESET ROLE');try{return await db.query(q,args);}finally{await db.query('SET ROLE jackstudio_api');}};
async function pay(h,r){return h.form('payments/mock/callback',(f=>({...f,HashValue2:responseHash2(SECRET,f)}))({ServiceID:'JSMOCK',PaymentID:r.payment.fields.PaymentID,OrderNumber:r.order.number,Amount:r.payment.fields.Amount,CurrencyCode:'MYR',TxnID:'T'+r.order.number,AuthCode:'A',TxnStatus:'0',Param6:'',Param7:''}));}

test('discount admin: validation, unique codes, revisions, viewer read-only',async()=>{
 const h=await harness();
 try{
  const bad=[{title:'',kind:'percentage',value:10},{title:'x',kind:'percentage',value:150},{title:'x',kind:'fixed',value:0},{title:'x',code:'a b',kind:'percentage',value:5},{title:'x',kind:'free_shipping',applies_to:'products',product_ids:['1']},{title:'x',kind:'percentage',value:5,applies_to:'collections',collection_ids:[]},{title:'x',kind:'percentage',value:5,ends_at:'2000-01-01'},{title:'x',kind:'percentage',value:5,price:1}];
  for(const b of bad)assert.equal((await h.request('discounts','POST',b)).status,400,JSON.stringify(b));
  const d=await h.request('discounts','POST',{title:'Welcome 10%',code:' welcome10 ',kind:'percentage',value:10});assert.equal(d.status,201);assert.equal(d.body.code,'WELCOME10');assert.equal(d.body.status,'active');
  assert.equal((await h.request('discounts','POST',{title:'Dup',code:'WELCOME10',kind:'fixed',value:100})).status,409);
  assert.equal((await h.request('discounts','POST',{title:'v',kind:'fixed',value:100},'viewer')).status,403);
  assert.equal((await h.request('discounts','GET',undefined,'viewer')).body.total,1);
  const u=await h.request('discounts/'+d.body.id,'PATCH',{title:'Welcome',revision:d.body.revision});assert.equal(u.status,200);
  assert.equal((await h.request('discounts/'+d.body.id,'PATCH',{title:'Stale',revision:d.body.revision})).status,409,'stale revision');
  assert.equal((await h.request('discounts/'+d.body.id,'PATCH',{active:false,revision:u.body.revision})).body.status,'inactive');
  const future=await h.request('discounts','POST',{title:'Later',code:'LATER',kind:'fixed',value:500,starts_at:new Date(Date.now()+864e5).toISOString()});assert.equal(future.body.status,'scheduled');
  assert.equal((await h.request('discounts/999','GET')).status,404);
 }finally{await h.close();}
});

test('discount maths on the server: best product discount, free shipping stacks, scope and minimum spend',async()=>{
 const h=await harness();
 try{
  await h.request('discounts','POST',{title:'Bags RM30 off',kind:'fixed',value:3000,applies_to:'collections',collection_ids:[String(h.bags.id)]});
  await h.request('discounts','POST',{title:'15% off',code:'SAVE15',kind:'percentage',value:15,min_subtotal_minor:10000});
  await h.request('discounts','POST',{title:'Free delivery',code:'SHIPFREE',kind:'free_shipping'});
  const quote=(lines,code)=>h.request('storefront/cart','POST',{lines,discount_code:code},null).then(r=>r.body);
  const w={variant_id:h.wallet.variant.id,quantity:1},b={variant_id:h.bag.variant.id,quantity:1};
  let q=await quote([w]);assert.equal(q.discount_minor,0,'automatic bag discount ignores the wallet');assert.equal(q.total_minor,5000);
  q=await quote([w],'save15');assert.equal(q.discount_error,'Spend RM100.00 or more to use this code.');assert.equal(q.total_minor,5000);
  q=await quote([w],'nope');assert.equal(q.discount_error,'This code is not valid.');
  q=await quote([w,b]);assert.deepEqual(q.discounts.map(d=>[d.title,d.amount_minor]),[['Bags RM30 off',3000]]);assert.equal(q.total_minor,24500-3000,'free shipping over RM49, automatic RM30');
  q=await quote([w,b],'SAVE15');assert.deepEqual(q.discounts.map(d=>[d.code,d.amount_minor]),[['SAVE15',3675]],'code is better (15% of 245.00) and replaces the automatic one');assert.equal(q.total_minor,24500-3675);
  q=await quote([{...b,quantity:1}],'SAVE15');assert.equal(q.discounts[0].code,'SAVE15');assert.equal(q.discounts[0].amount_minor,3000,'tie on RM30: the code is kept');
  await h.request('discounts','POST',{title:'Big bag',kind:'fixed',value:5000,applies_to:'products',product_ids:[String(h.bag.product.id)]});
  q=await quote([w,b],'SAVE15');assert.equal(q.discount_error,'A better discount is already applied to this bag.');assert.equal(q.discount_minor,5000);assert.equal(q.discount_code,null);
  q=await quote([{...w,quantity:2}],'SHIPFREE');assert.equal(q.discount_error,'Shipping is already free for this bag.');
  q=await quote([w],'SHIPFREE');assert.equal(q.shipping_minor,500);assert.deepEqual(q.discounts.map(d=>[d.kind,d.amount_minor]),[['free_shipping',500]]);assert.equal(q.total_minor,4500);
  const r=await h.request('storefront/checkout','POST',order([w,b],{discount_code:'save15'}),null);assert.equal(r.status,400);assert.match(r.body.error,/better discount/,'checkout refuses a code that is no longer the applied one');
 }finally{await h.close();}
});

test('checkout: discounted total is charged, usage is claimed atomically and given back on cancel or expiry, not on refund',async()=>{
 const h=await harness();
 try{
  const d=(await h.request('discounts','POST',{title:'RM20 off',code:'TWENTY',kind:'fixed',value:2000,usage_limit:2,once_per_customer:true})).body;
  const w={variant_id:h.wallet.variant.id,quantity:2};
  const a=await h.request('storefront/checkout','POST',order([w],{discount_code:'twenty'}),null);assert.equal(a.status,201,JSON.stringify(a.body));
  assert.equal(a.body.order.total_minor,9000-2000);assert.equal(a.body.order.discount_minor,2000);assert.equal(a.body.payment.fields.Amount,'70.00','gateway amount is the discounted total');
  const same=await h.request('storefront/checkout','POST',order([w],{discount_code:'TWENTY',customer:{...customer,email:'AISYAH@example.com'}}),null);assert.equal(same.status,400);assert.match(same.body.error,/once per customer/);
  const b=await h.request('storefront/checkout','POST',order([w],{discount_code:'TWENTY',customer:{...customer,email:'ben@example.com'}}),null);assert.equal(b.status,201);
  assert.equal((await h.request('discounts/'+d.id)).body.used_count,2);
  const c=await h.request('storefront/checkout','POST',order([w],{discount_code:'TWENTY',customer:{...customer,email:'chen@example.com'}}),null);assert.equal(c.status,400);assert.match(c.body.error,/fully used/);
  // Cancel B (unpaid) → its use returns; Chen can now use the code.
  const list=(await h.request('orders')).body.items,ob=list.find(o=>o.number===b.body.order.number);
  let det=(await h.request('orders/'+ob.id)).body;await h.request(`orders/${ob.id}/cancel`,'POST',{revision:det.revision});
  assert.equal((await h.request('discounts/'+d.id)).body.used_count,1);
  det=(await h.request('orders/'+ob.id)).body;assert.deepEqual(det.discounts.map(x=>[x.code,x.amount_minor,x.released]),[['TWENTY',2000,true]]);
  const c2=await h.request('storefront/checkout','POST',order([w],{discount_code:'TWENTY',customer:{...customer,email:'chen@example.com'}}),null);assert.equal(c2.status,201);
  // Expiry gives the use back too.
  await asOwner(h.db,"UPDATE orders SET expires_at=now()-interval '1 minute' WHERE number=$1",[c2.body.order.number]);
  const swept=await h.sweep();assert.equal(swept.expired,1);assert.equal((await h.request('discounts/'+d.id)).body.used_count,1);
  // A paid then refunded order keeps its use; refunds are capped at the discounted total.
  await pay(h,a.body);const oa=(await h.request('orders')).body.items.find(o=>o.number===a.body.order.number);det=(await h.request('orders/'+oa.id)).body;
  assert.equal(det.status,'paid');assert.equal((await h.request(`orders/${oa.id}/refunds`,'POST',{revision:det.revision,amount_minor:7001,reference:'R'})).status,400);
  assert.equal((await h.request(`orders/${oa.id}/refunds`,'POST',{revision:det.revision,amount_minor:7000,reference:'R1'})).status,200);
  assert.equal((await h.request('discounts/'+d.id)).body.used_count,1);
  const detail=(await h.request('discounts/'+d.id)).body;assert.equal(detail.paid_orders,1);assert.equal(detail.saved_minor,2000);
  // Paying an expired order late counts the discount as used again.
  await pay(h,c2.body);assert.equal((await h.request('discounts/'+d.id)).body.used_count,2);
  // The database enforces total = subtotal + shipping − discount.
  await assert.rejects(asOwner(h.db,'UPDATE orders SET discount_minor=1 WHERE number=$1',[a.body.order.number]));
 }finally{await h.close();}
});

test('emails: queued once per event, test mode redirects, retries back off, failed ones retry on request',async()=>{
 let failNext=0;const mailer=fakeMailer({fail:()=>failNext-->0?Object.assign(new Error('Provider error 503'),{permanent:false}):null});
 const h=await harness(mailer);
 try{
  const r=(await h.request('storefront/checkout','POST',order([{variant_id:h.wallet.variant.id,quantity:2}]),null)).body;
  await pay(h,r);await pay(h,r);
  const queued=(await h.db.query("SELECT kind,status FROM email_outbox")).rows;assert.deepEqual(queued,[{kind:'order_paid',status:'pending'}],'a repeated callback does not queue a second email');
  let s=(await h.request('email','GET',undefined,'viewer')).body;assert.equal(s.configured,true);assert.equal(s.mode,'test');assert.equal(s.test_recipient,'qa@jackstudio.test');assert.equal(s.counts.pending,1);
  assert.equal((await h.request('email/send','POST',{},'viewer')).status,403);
  failNext=1;let sent=(await h.request('email/send','POST',{})).body;assert.deepEqual([sent.sent,sent.failed],[0,1]);
  let row=(await h.db.query("SELECT status,attempts,last_error,next_attempt_at>now() AS later FROM email_outbox")).rows[0];assert.deepEqual(row,{status:'pending',attempts:1,last_error:'Provider error 503',later:true});
  sent=(await h.request('email/send','POST',{})).body;assert.equal(sent.sent,0,'not due yet');
  await asOwner(h.db,'UPDATE email_outbox SET next_attempt_at=now()');
  sent=(await h.request('email/send','POST',{})).body;assert.equal(sent.sent,1);
  assert.equal(mailer.sent.length,1);assert.equal(mailer.sent[0].to,'qa@jackstudio.test','never the customer in test mode');assert.match(mailer.sent[0].subject,/^\[TEST for aisyah@example.com\] /);assert.match(mailer.sent[0].idempotencyKey,/^jackstudio-outbox-\d+$/);
  // Permanent failure stops; Retry puts it back.
  const o=(await h.request('orders')).body.items[0];let det=(await h.request('orders/'+o.id)).body;
  await h.request(`orders/${o.id}/fulfil`,'POST',{revision:det.revision,tracking_number:'MY1'});
  mailer.send=async()=>{throw Object.assign(new Error('Invalid recipient'),{permanent:true});};
  await h.request('email/send','POST',{});s=(await h.request('email')).body;assert.equal(s.counts.failed,1);
  const failed=s.recent.find(m=>m.status==='failed');assert.equal(failed.kind,'order_fulfilled');
  assert.equal((await h.request(`email/${s.recent.find(m=>m.status==='sent').id}/retry`,'POST',{})).status,409);
  assert.equal((await h.request(`email/${failed.id}/retry`,'POST',{})).body.status,'pending');
  // Refund emails: one per refund.
  det=(await h.request('orders/'+o.id)).body;await h.request(`orders/${o.id}/refunds`,'POST',{revision:det.revision,amount_minor:1000,reference:'A'});
  det=(await h.request('orders/'+o.id)).body;await h.request(`orders/${o.id}/refunds`,'POST',{revision:det.revision,amount_minor:1000,reference:'B'});
  assert.equal((await h.db.query("SELECT count(*)::int AS n FROM email_outbox WHERE kind='order_refunded'")).rows[0].n,2);
 }finally{await h.close();}
});

test('emails are never marked sent without a provider; env rules for test and live mode',async()=>{
 assert.equal(mailerFromEnv({}).configured,false);
 assert.match(mailerFromEnv({RESEND_API_KEY:'k',EMAIL_FROM:'a@b.c'}).reason,/EMAIL_TEST_RECIPIENT/);
 const t=mailerFromEnv({RESEND_API_KEY:'k',EMAIL_FROM:'a@b.c',EMAIL_TEST_RECIPIENT:'qa@x.y'});assert.deepEqual([t.configured,t.live,t.test],[true,false,'qa@x.y']);
 assert.equal(mailerFromEnv({RESEND_API_KEY:'k',EMAIL_FROM:'a@b.c',EMAIL_MODE:'live'}).live,true);
 const h=await harness(mailerFromEnv({}));
 try{
  const r=(await h.request('storefront/checkout','POST',order([{variant_id:h.wallet.variant.id,quantity:2}]),null)).body;await pay(h,r);
  const s=(await h.request('email')).body;assert.equal(s.configured,false);assert.match(s.reason,/RESEND_API_KEY/);
  const sent=(await h.request('email/send','POST',{})).body;assert.equal(sent.skipped,true);assert.equal(sent.sent,0);
  const m=await h.sweep();assert.equal(m.email.skipped,true);
  assert.deepEqual((await h.db.query('SELECT status,attempts FROM email_outbox')).rows,[{status:'pending',attempts:0}]);
  assert.deepEqual(await sendPending(h.db,null),{sent:0,failed:0,skipped:true,reason:'Email is not configured'});
 }finally{await h.close();}
});

test('reports: paid orders by Malaysia day, discounts, refunds on their own day, no conversion metric',async()=>{
 const h=await harness();
 try{
  await h.request('discounts','POST',{title:'RM10',code:'TEN',kind:'fixed',value:1000});
  const a=(await h.request('storefront/checkout','POST',order([{variant_id:h.wallet.variant.id,quantity:2}],{discount_code:'TEN'}),null)).body;await pay(h,a);
  const b=(await h.request('storefront/checkout','POST',order([{variant_id:h.bag.variant.id,quantity:1}]),null)).body;await pay(h,b);
  await h.request('storefront/checkout','POST',order([{variant_id:h.wallet.variant.id,quantity:1}]),null); // unpaid
  // A paid 23:30 MYT on 1 Nov (15:30 UTC) and B paid 00:30 MYT on 2 Nov (16:30 UTC 1 Nov).
  await asOwner(h.db,"UPDATE orders SET paid_at='2026-11-01T15:30:00Z' WHERE number=$1",[a.order.number]);
  await asOwner(h.db,"UPDATE orders SET paid_at='2026-11-01T16:30:00Z' WHERE number=$1",[b.order.number]);
  const ob=(await h.request('orders')).body.items.find(o=>o.number===b.order.number),det=(await h.request('orders/'+ob.id)).body;
  await h.request(`orders/${ob.id}/refunds`,'POST',{revision:det.revision,amount_minor:5000,reference:'R'});
  await asOwner(h.db,"UPDATE refunds SET created_at='2026-11-03T02:00:00Z'");
  let r=(await h.request('reports?from=2026-11-01&to=2026-11-01')).body;
  assert.deepEqual([r.summary.orders,r.summary.gross_sales_minor,r.summary.discounts_minor,r.summary.collected_minor,r.summary.refunds_minor],[1,9000,1000,8000,0]);
  assert.deepEqual(r.series,[{day:'2026-11-01',orders:1,collected_minor:8000}]);
  r=(await h.request('reports?from=2026-11-01&to=2026-11-03','GET',undefined,'viewer')).body;
  assert.equal(r.summary.orders,2);assert.equal(r.summary.collected_minor,28000);assert.equal(r.summary.refunds_minor,5000);assert.equal(r.summary.net_sales_minor,23000);assert.equal(r.summary.average_order_minor,14000);
  assert.deepEqual(r.series.map(d=>d.orders),[1,1,0]);assert.deepEqual(r.top_products.map(p=>[p.title,p.units]),[['Wallet',2],['Tote Bag',1]]);
  assert.equal(r.conversion,null);assert.equal(r.timezone,'Asia/Kuala_Lumpur');
  for(const q of ['from=2026-13-01&to=2026-13-02','from=2026-11-05&to=2026-11-01','from=2024-01-01&to=2026-01-01'])assert.equal((await h.request('reports?'+q)).status,400,q);
 }finally{await h.close();}
});

test('Colour and Color option names share one filter',async()=>{
 const h=await harness();
 try{
  const c=(await h.request('collections','POST',{title:'Mixed',status:'active'})).body;
  await h.request('products','POST',{title:'A',status:'active',collection_ids:[String(c.id)],option_names:['Colour'],variants:[{option_values:['Brown'],sku:'A1',price_minor:100,inventory:1,active:true},{option_values:['Tan'],sku:'A2',price_minor:100,inventory:1,active:true}]});
  await h.request('products','POST',{title:'B',status:'active',collection_ids:[String(c.id)],option_names:['Color'],variants:[{option_values:['Brown'],sku:'B1',price_minor:100,inventory:1,active:true},{option_values:['Black'],sku:'B2',price_minor:100,inventory:1,active:true}]});
  const r=(await h.request('storefront/collections/mixed','GET',undefined,null)).body;
  const opts=r.filters.options.filter(o=>/colou?r/i.test(o.name));assert.equal(opts.length,1);
  assert.deepEqual(opts[0].values.map(v=>[v.value,v.count]),[['Black',1],['Brown',2],['Tan',1]]);
  const f=(await h.request('storefront/collections/mixed?option.colour=brown','GET',undefined,null)).body;assert.equal(f.total,2);
 }finally{await h.close();}
});
