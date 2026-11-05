import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {testGateway,paymentAdapter,requestHash,responseHash2} from '../src/payments.mjs';

const SECRET='s'.repeat(40);
const gateway=testGateway({provider:'mock',serviceId:'JSMOCK',password:SECRET,actionUrl:'https://pay.test/mock',baseUrl:'https://shop.test'});
async function harness(){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");
 await db.query('SET ROLE jackstudio_api');
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{payments:gateway}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,redirect:'manual',...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:r.status,body:json,headers:r.headers};};
 const form=async(path,fields,method='POST')=>{const r=await fetch(base+path+(method==='GET'?'?'+new URLSearchParams(fields):''),{method,redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},...(method==='POST'?{body:new URLSearchParams(fields).toString()}:{})});return {status:r.status,text:await r.text(),location:r.headers.get('location')};};
 // Catalogue: active collection; wallet (general, RM45), luggage (RM399, 3 kg), draft product.
 const c=(await request('collections','POST',{title:'Shop',status:'active'})).body;
 const mk=async(body)=>{const p=(await request('products','POST',{collection_ids:[String(c.id)],...body})).body;return {product:p,variant:(await request('products/'+p.id)).body.variants[0]};};
 const wallet=await mk({title:'Wallet',status:'active',sku:'W-1',price_minor:4500,inventory:3});
 const luggage=await mk({title:'Cabin Luggage',status:'active',sku:'L-1',price_minor:39900,inventory:5,shipping_profile:'luggage',weight_grams:3000});
 const light=await mk({title:'Luggage Tag',status:'active',sku:'L-2',price_minor:2000,inventory:5,shipping_profile:'luggage',weight_grams:0});
 const draft=await mk({title:'Prototype',status:'draft',sku:'D-1',price_minor:100,inventory:5});
 return {db,request,form,wallet,luggage,light,draft,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
const customer={name:'Aisyah Rahman',email:'Aisyah@example.com',phone:'+60 12-345 6789',address_line1:'12 Jalan Klang',city:'Klang',postcode:'41000',state:'Selangor'};
const order=(lines,extra={})=>({idempotency_key:randomUUID(),access_token:randomBytes(24).toString('base64url'),customer,lines,...extra});
const stock=async(db,variant)=>(await db.query('SELECT inventory FROM product_variants WHERE id=$1',[variant.id])).rows[0].inventory;
const balanced=async db=>(await db.query('SELECT bool_and(v.inventory=coalesce((SELECT sum(delta) FROM inventory_adjustments a WHERE a.variant_id=v.id),0)) AS ok FROM product_variants v')).rows[0].ok;
const signed=(fields,overrides={})=>{const f={...fields,...overrides};delete f.HashValue2;return {...f,HashValue2:responseHash2(SECRET,f)};};

test('eGHL request hash, configuration guard and mock-only-on-staging',()=>{
 const f={ServiceID:'SIT',PaymentID:'JSW1P1',MerchantReturnURL:'https://a/r',MerchantCallBackURL:'https://a/c',Amount:'49.00',CurrencyCode:'MYR',CustIP:'1.2.3.4',PageTimeout:'900'};
 assert.equal(requestHash('pw',f),createHash('sha256').update('pwSITJSW1P1https://a/rhttps://a/c49.00MYR1.2.3.4900').digest('hex'));
 for(const env of [{},{PUBLIC_BASE_URL:'http://x.test',PAYMENT_PROVIDER:'mock',APP_ENV:'staging',MOCK_PAYMENT_SECRET:SECRET},{PUBLIC_BASE_URL:'https://x.test',PAYMENT_PROVIDER:'mock',APP_ENV:'production',MOCK_PAYMENT_SECRET:SECRET},{PUBLIC_BASE_URL:'https://x.test',PAYMENT_PROVIDER:'eghl',EGHL_SERVICE_ID:'S',EGHL_PASSWORD:'p',EGHL_PAYMENT_URL:'http://insecure'}])assert.throws(()=>paymentAdapter(env),e=>e.status===503);
 assert.equal(paymentAdapter({PUBLIC_BASE_URL:'https://x.test',PAYMENT_PROVIDER:'eghl',EGHL_SERVICE_ID:'S',EGHL_PASSWORD:'p',EGHL_PAYMENT_URL:'https://test.example/Payment.aspx'}).provider,'eghl');
});

test('shipping copies the Shopify rules: RM5, free from RM49, luggage RM26.90 for 1–50 kg, summed per profile',async()=>{
 const {request,wallet,luggage,light,draft,close}=await harness();
 try{
  const bag=async lines=>(await request('storefront/cart','POST',{lines},null)).body;
  assert.equal((await bag([{variant_id:wallet.variant.id,quantity:1}])).shipping_minor,500);
  assert.equal((await bag([{variant_id:wallet.variant.id,quantity:2}])).shipping_minor,0,'RM90 ≥ RM49');
  assert.equal((await bag([{variant_id:luggage.variant.id,quantity:1}])).shipping_minor,2690);
  assert.equal((await bag([{variant_id:wallet.variant.id,quantity:1},{variant_id:luggage.variant.id,quantity:1}])).shipping_minor,3190);
  assert.match((await bag([{variant_id:light.variant.id,quantity:1}])).shipping_error,/Luggage shipping is not available/);
  const d=await bag([{variant_id:draft.variant.id,quantity:1}]);assert.equal(d.lines[0].available,false);assert.equal(d.total_minor,null);
  assert.equal((await request('storefront/shipping-rates','GET',undefined,null)).body.rates.length,3);
  const p=(await request('storefront/products/wallet','GET',undefined,null)).body.product;assert.equal(p.variants[0].available,true);assert.equal(p.variants[0].low,true);assert.equal('inventory' in p.variants[0],false,'exact stock not public');
  assert.equal((await request('storefront/products/prototype','GET',undefined,null)).status,404);
 }finally{await close();}
});

test('checkout reserves stock, is idempotent, prices on the server and cannot oversell',async()=>{
 const {db,request,wallet,draft,close}=await harness();
 try{
  const body=order([{variant_id:wallet.variant.id,quantity:2,price_minor:1}]);
  const r=await request('storefront/checkout','POST',body,null);assert.equal(r.status,201,JSON.stringify(r.body));
  assert.equal(r.body.order.total_minor,9000,'client price ignored; free shipping from RM49');assert.match(r.body.order.number,/^JSW5\d{4}$/);
  const f=r.body.payment.fields;assert.equal(r.body.payment.action,'https://pay.test/mock');assert.equal(f.Amount,'90.00');assert.equal(f.CurrencyCode,'MYR');assert.equal(f.HashValue,requestHash(SECRET,f));assert.equal(f.MerchantCallBackURL,'https://shop.test/api/v3/payments/mock/callback');
  assert.equal(await stock(db,wallet.variant),1);
  const again=await request('storefront/checkout','POST',body,null);assert.equal(again.body.order.number,r.body.order.number,'double submit returns the same order');assert.equal(await stock(db,wallet.variant),1);
  assert.equal((await request('storefront/checkout','POST',{...body,access_token:randomBytes(24).toString('base64url')},null)).status,409);
  const sold=await request('storefront/checkout','POST',order([{variant_id:wallet.variant.id,quantity:2}]),null);assert.equal(sold.status,409);assert.match(sold.body.error,/Only 1 left/);
  assert.equal(await stock(db,wallet.variant),1,'failed checkout rolled back');
  assert.equal((await request('storefront/checkout','POST',order([{variant_id:draft.variant.id,quantity:1}]),null)).status,409);
  for(const bad of [order([]),order([{variant_id:wallet.variant.id,quantity:21}]),order([{variant_id:wallet.variant.id,quantity:1}],{customer:{...customer,postcode:'4100'}}),order([{variant_id:wallet.variant.id,quantity:1}],{customer:{...customer,state:'Bali'}}),order([{variant_id:wallet.variant.id,quantity:1}],{access_token:'short'})])assert.equal((await request('storefront/checkout','POST',bad,null)).status,400);
  const ledger=(await db.query("SELECT reason,delta,actor,order_id FROM inventory_adjustments WHERE reason='sale'")).rows;assert.equal(ledger.length,1);assert.equal(ledger[0].actor,null);assert.ok(ledger[0].order_id);
  assert.ok(await balanced(db));
 }finally{await close();}
});

test('gateway callbacks: verified success once, duplicates, tampering, amount mismatch, failure and retry',async()=>{
 const {db,request,form,wallet,close}=await harness();
 try{
  const body=order([{variant_id:wallet.variant.id,quantity:1}]);const r=(await request('storefront/checkout','POST',body,null)).body;const number=r.order.number;
  const base={ServiceID:'JSMOCK',PaymentID:r.payment.fields.PaymentID,OrderNumber:number,Amount:'50.00',CurrencyCode:'MYR',TxnID:'T1',AuthCode:'',Param6:'',Param7:''};
  // Tampered signature: logged, nothing changes.
  let cb=await form('payments/mock/callback',{...signed({...base,TxnStatus:'0'}),HashValue2:'0'.repeat(64)});assert.equal(cb.status,400);assert.equal(cb.text,'REJECTED');
  const status=async()=>(await request(`storefront/orders/${number}/status`,'POST',{access_token:body.access_token},null)).body.order;
  assert.equal((await status()).status,'pending_payment');
  // Wrong amount, correctly signed: rejected and flagged for staff.
  cb=await form('payments/mock/callback',signed({...base,TxnStatus:'0',Amount:'1.00'}));assert.equal(cb.status,400);
  // Failure, then retry with a new payment reference.
  cb=await form('payments/mock/callback',signed({...base,TxnStatus:'1'}));assert.equal(cb.text,'OK');assert.equal((await status()).payment_status,'failed');
  const retry=(await request(`storefront/orders/${number}/pay`,'POST',{access_token:body.access_token},null)).body;assert.equal(retry.payment.fields.PaymentID,number+'P2');
  // Success arrives on the browser return (303 to the order page) and again on the callback.
  const ok={...base,PaymentID:number+'P2',TxnID:'T2',AuthCode:'A1',TxnStatus:'0'};
  const back=await form('payments/mock/return',signed(ok));assert.equal(back.status,303);assert.equal(back.location,'/order/'+number);
  cb=await form('payments/mock/callback',signed(ok));assert.equal(cb.text,'OK');cb=await form('payments/mock/callback',signed(ok));assert.equal(cb.text,'OK');
  const done=await status();assert.equal(done.status,'paid');assert.equal(done.payment_status,'succeeded');
  // A late failure for the paid payment never downgrades it.
  await form('payments/mock/callback',signed({...ok,TxnStatus:'1'}));assert.equal((await status()).status,'paid');
  assert.equal((await request(`storefront/orders/${number}/pay`,'POST',{access_token:body.access_token},null)).status,409);
  assert.equal((await request(`storefront/orders/${number}/status`,'POST',{access_token:randomBytes(24).toString('base64url')},null)).status,404,'token required');
  const events=(await db.query('SELECT outcome FROM payment_events ORDER BY id')).rows.map(e=>e.outcome);
  assert.deepEqual(events,['rejected_signature','rejected_amount','failed','paid','duplicate','duplicate','duplicate']);
  const o=(await request('orders?status=attention')).body;assert.equal(o.total,1,'amount mismatch flagged');
  assert.equal(await stock(db,wallet.variant),2,'stock taken once');assert.ok(await balanced(db));
 }finally{await close();}
});

test('unpaid orders expire and release stock; late payments re-reserve or flag for staff',async()=>{
 const {db,request,form,wallet,close}=await harness();
 try{
  const a=order([{variant_id:wallet.variant.id,quantity:3}]);const ra=(await request('storefront/checkout','POST',a,null)).body;
  assert.equal(await stock(db,wallet.variant),0);
  await db.query("RESET ROLE");await db.query("UPDATE orders SET expires_at=now()-interval '1 minute'");await db.query('SET ROLE jackstudio_api');
  assert.equal((await request(`storefront/orders/${ra.order.number}/status`,'POST',{access_token:a.access_token},null)).body.order.status,'expired');
  assert.equal(await stock(db,wallet.variant),3,'released');
  // Someone else buys 2; the expired order is then paid: only 1 left, so staff are alerted.
  const b=order([{variant_id:wallet.variant.id,quantity:2}]);await request('storefront/checkout','POST',b,null);
  const late={ServiceID:'JSMOCK',PaymentID:ra.payment.fields.PaymentID,OrderNumber:ra.order.number,Amount:'135.00',CurrencyCode:'MYR',TxnID:'TL',AuthCode:'A',TxnStatus:'0',Param6:'',Param7:''};
  assert.equal((await form('payments/mock/callback',signed(late))).text,'OK');
  const detail=(await request('orders?status=attention')).body.items[0];assert.equal(detail.number,ra.order.number);assert.equal(detail.status,'paid');
  const full=(await request('orders/'+detail.id)).body;assert.match(full.attention_note,/not enough stock/);
  assert.equal(await stock(db,wallet.variant),1,'no negative stock');assert.ok(await balanced(db));
 }finally{await close();}
});

test('staff order workflow: roles, fulfil, cancel, refunds with restock, customers and dashboard',async()=>{
 const {db,request,form,wallet,luggage,close}=await harness();
 try{
  const pay=async lines=>{const b=order(lines);const r=(await request('storefront/checkout','POST',b,null)).body;await form('payments/mock/callback',signed({ServiceID:'JSMOCK',PaymentID:r.payment.fields.PaymentID,OrderNumber:r.order.number,Amount:r.payment.fields.Amount,CurrencyCode:'MYR',TxnID:'T'+r.order.number,AuthCode:'A',TxnStatus:'0',Param6:'',Param7:''}));return r.order.number;};
  const paidNumber=await pay([{variant_id:luggage.variant.id,quantity:1}]);
  const pending=(await request('storefront/checkout','POST',order([{variant_id:wallet.variant.id,quantity:1}]),null)).body.order.number;
  const list=(await request('orders','GET',undefined,'viewer')).body;assert.equal(list.total,2);
  const paid=list.items.find(o=>o.number===paidNumber),open=list.items.find(o=>o.number===pending);
  let d=(await request('orders/'+paid.id)).body;assert.equal(d.lines[0].title,'Cabin Luggage');assert.equal(d.total_minor,42590);assert.equal(d.payments[0].status,'succeeded');assert.equal('access_token_hash' in d,false);
  assert.equal((await request(`orders/${paid.id}/fulfil`,'POST',{revision:d.revision},'viewer')).status,403);
  assert.equal((await request(`orders/${paid.id}/cancel`,'POST',{revision:d.revision})).status,400,'paid orders are refunded, not cancelled');
  d=(await request(`orders/${paid.id}/fulfil`,'POST',{revision:d.revision,tracking_number:'MY123'})).body;assert.equal(d.fulfillment_status,'fulfilled');
  assert.equal((await request(`orders/${paid.id}/refunds`,'POST',{revision:d.revision,amount_minor:50000,reference:'R1'})).status,400,'cannot exceed total');
  d=(await request(`orders/${paid.id}/refunds`,'POST',{revision:d.revision,amount_minor:42590,reference:'EGHL-RF-1',restock:true})).body;assert.equal(d.refunded_minor,42590);assert.equal(d.refunds[0].restocked,true);
  assert.equal(await stock(db,luggage.variant),5,'restocked');
  assert.equal((await request(`orders/${paid.id}/refunds`,'POST',{revision:d.revision,amount_minor:1,reference:'x'})).status,400,'fully refunded');
  let o=(await request('orders/'+open.id)).body;o=(await request(`orders/${open.id}/cancel`,'POST',{revision:o.revision})).body;assert.equal(o.status,'cancelled');assert.equal(await stock(db,wallet.variant),3);
  assert.equal((await request(`orders/${open.id}/cancel`,'POST',{revision:o.revision-1})).status,409,'stale revision');
  await pay([{variant_id:wallet.variant.id,quantity:2}]);
  const customers=(await request('customers?q=aisyah')).body;assert.equal(customers.total,1);assert.equal(customers.items[0].email,'aisyah@example.com');assert.equal(customers.items[0].orders,2);assert.equal(customers.items[0].spent_minor,9000);
  const dash=(await request('dashboard')).body;assert.equal(dash.paid_orders,2);assert.equal(Number(dash.revenue_minor),9000);assert.equal(dash.to_fulfil,1);
  for(const [p,m] of [['orders/'+paid.id,'PATCH'],['customers/1','GET'],['orders/'+paid.id+'/fulfil','GET']])assert.equal((await request(p,m,m==='GET'?undefined:{})).status,405);
  for(const q of ['DELETE FROM orders','DELETE FROM payment_events','UPDATE payment_events SET outcome=$1','DELETE FROM refunds','UPDATE shipping_rates SET price_minor=0'])await assert.rejects(db.query(q,q.includes('$1')?['x']:[]),e=>e.code==='42501',q);
  assert.ok(await balanced(db));
 }finally{await close();}
});

test('007 copies Shopify shipping, keeps the ledger and is private to the API role',async()=>{
 const db=new PGlite();try{
  await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
  const run=async f=>db.exec(await readFile(new URL(`../migrations/${f}.sql`,import.meta.url),'utf8'));
  for(const f of ['001_foundation','002_staff_isolation','003_cloudinary','004_catalog_admin'])await run(f);
  await db.exec("INSERT INTO staff VALUES ('o','admin',true); INSERT INTO products(title,handle,sku,inventory) VALUES ('W','w','W1',4);");
  for(const f of ['005_variants_inventory','006_website_editor'])await run(f);
  await db.exec(await readFile(new URL('../migrations/007_commerce.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.query('SELECT profile,price_minor,min_subtotal_minor,min_weight_grams,max_weight_grams FROM shipping_rates ORDER BY id')).rows,[{profile:'general',price_minor:0,min_subtotal_minor:4900,min_weight_grams:null,max_weight_grams:null},{profile:'general',price_minor:500,min_subtotal_minor:null,min_weight_grams:null,max_weight_grams:null},{profile:'luggage',price_minor:2690,min_subtotal_minor:null,min_weight_grams:1000,max_weight_grams:50000}]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM inventory_adjustments WHERE reason='migration'")).rows[0].n,1,'existing ledger kept');
  await assert.rejects(db.query("INSERT INTO inventory_adjustments(variant_id,product_id,delta,quantity_before,quantity_after,reason) VALUES (1,1,1,4,5,'received')"),e=>e.code==='23514','staff reasons still need an actor');
  for(const role of ['anon','authenticated'])for(const t of ['orders','payments','payment_events','refunds','shipping_rates','order_lines'])assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT') AS a",[role,t])).rows[0].a,false,role+' '+t);
 }finally{await db.close();}
});
