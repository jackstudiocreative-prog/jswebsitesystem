import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {testGateway,requestHash,queryHash,responseHash2,paymentAdapter} from '../src/payments.mjs';

const SECRET='e'.repeat(40),MAINT='maintenance-test-'.repeat(3);
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
// A stand-in for eGHL's server-to-server API: answers QUERY/REFUND from a table the test controls,
// signed exactly as eGHL signs payment responses.
function fakeEghl(){
 const state={answers:new Map(),refund:null,calls:[],down:false};
 const sign=f=>({...f,HashValue2:responseHash2(SECRET,f)});
 state.transport=async(url,fields)=>{
  state.calls.push(fields);if(state.down)throw new Error('timeout');
  assert.equal(fields.HashValue,queryHash(SECRET,fields),'QUERY/REFUND request hash');
  if(fields.TransactionType==='REFUND'){if(state.refund==='garbage')return {TxnStatus:'0'};const st=state.refund??'0';return sign({ServiceID:'JSE',PaymentID:fields.PaymentID,Amount:fields.Amount,CurrencyCode:'MYR',TxnID:'RF'+state.calls.length,AuthCode:'',TxnStatus:st,OrderNumber:'',Param6:'',Param7:'',TxnMessage:st==='0'?'Refund successful':'Refund failed'});}
  const a=state.answers.get(fields.PaymentID);if(!a)return {TxnExists:'1',TxnStatus:'-1',ServiceID:'JSE',PaymentID:fields.PaymentID,Amount:fields.Amount,CurrencyCode:'MYR'};
  return {...sign({ServiceID:'JSE',PaymentID:fields.PaymentID,Amount:a.amount??fields.Amount,CurrencyCode:'MYR',TxnID:'Q'+fields.PaymentID,AuthCode:'A1',TxnStatus:a.status,OrderNumber:a.order,Param6:'',Param7:''}),TxnExists:'0'};
 };
 return state;
}
async function harness({refunds=true}={}){
 const eghl=fakeEghl();
 const gateway=testGateway({provider:'eghl',serviceId:'JSE',password:SECRET,actionUrl:'https://pay.test/eghl',apiUrl:'https://api.test/eghl',refundsEnabled:refunds,baseUrl:'https://shop.test',transport:eghl.transport});
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");await db.query('SET ROLE jackstudio_api');
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{payments:gateway,rateLimits:false,maintenanceSecret:MAINT,mailer:{configured:false,reason:'test'}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:r.status,body:json};};
 const callback=async fields=>{const r=await fetch(base+'payments/eghl/callback',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields).toString()});return r.text();};
 const sweep=()=>fetch(base+'maintenance/expire-orders',{method:'POST',headers:{authorization:'Bearer '+MAINT}}).then(r=>r.json());
 const c=(await request('collections','POST',{title:'Shop',status:'active'})).body;
 const mk=async body=>{const p=(await request('products','POST',{status:'active',collection_ids:[String(c.id)],...body})).body;return (await request('products/'+p.id)).body.variants[0];};
 const wallet=await mk({title:'Wallet',sku:'W-1',price_minor:4500,inventory:10});
 const bag=await mk({title:'Card Case',sku:'C-1',price_minor:4899,inventory:10});
 const luggage=await mk({title:'Cabin Luggage',sku:'L-1',price_minor:39900,inventory:5,shipping_profile:'luggage',weight_grams:25000});
 const owner=async(q,a)=>{await db.query('RESET ROLE');try{return await db.query(q,a);}finally{await db.query('SET ROLE jackstudio_api');}};
 const stock=async v=>(await db.query('SELECT inventory FROM product_variants WHERE id=$1',[v.id])).rows[0].inventory;
 const orderId=async number=>(await db.query('SELECT id FROM orders WHERE number=$1',[number])).rows[0].id;
 const detail=async number=>(await request('orders/'+await orderId(number))).body;
 const act=async(number,path,body={},token)=>{const d=await detail(number);return request(`orders/${d.id}/${path}`,'POST',{revision:d.revision,...body},token);};
 const signed=(r,status='0',extra={})=>{const f={ServiceID:'JSE',PaymentID:r.payment.fields.PaymentID,OrderNumber:r.order.number,Amount:r.payment.fields.Amount,CurrencyCode:'MYR',TxnID:'T'+r.order.number,AuthCode:'A',TxnStatus:status,Param6:'',Param7:'',PymtMethod:'CC',...extra};return {...f,HashValue2:responseHash2(SECRET,f)};};
 return {mk,db,eghl,request,callback,sweep,wallet,bag,luggage,owner,stock,detail,act,signed,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
const customer={name:'Aisyah Rahman',email:'aisyah@example.com',phone:'+60 12-345 6789',address_line1:'12 Jalan Klang',city:'Klang',postcode:'41000',state:'Selangor'};
const order=lines=>({idempotency_key:randomUUID(),access_token:randomBytes(24).toString('base64url'),customer,lines});
const buy=async(h,lines)=>{const body=order(lines);const r=await h.request('storefront/checkout','POST',body,null);assert.equal(r.status,201,JSON.stringify(r.body));return {...r.body,access_token:body.access_token};};
const paid=async(h,lines)=>{const r=await buy(h,lines);assert.equal(await h.callback(h.signed(r)),'OK');return r;};

test('eGHL hashes follow the merchant integration guide (2.8n): request, query/refund and response',()=>{
 const f={ServiceID:'JSE',PaymentID:'JSW50001P1',MerchantReturnURL:'https://shop.test/r',MerchantCallBackURL:'https://shop.test/c',Amount:'90.00',CurrencyCode:'MYR',CustIP:'1.2.3.4',PageTimeout:'900'};
 // Password + ServiceID + PaymentID + MerchantReturnURL + MerchantApprovalURL + MerchantUnApprovalURL + MerchantCallBackURL + Amount + CurrencyCode + CustIP + PageTimeout + CardNo + Token (unsent fields empty)
 assert.equal(requestHash(SECRET,f),sha(SECRET+'JSE'+'JSW50001P1'+'https://shop.test/r'+''+''+'https://shop.test/c'+'90.00'+'MYR'+'1.2.3.4'+'900'+''+''));
 assert.equal(queryHash(SECRET,{ServiceID:'JSE',PaymentID:'P1',Amount:'1.00',CurrencyCode:'MYR'}),sha(SECRET+'JSE'+'P1'+'1.00'+'MYR'));
 const r={TxnID:'T',ServiceID:'JSE',PaymentID:'P1',TxnStatus:'0',Amount:'1.00',CurrencyCode:'MYR',AuthCode:'A',OrderNumber:'O',Param6:'',Param7:''};
 assert.equal(responseHash2(SECRET,r),sha(SECRET+'T'+'JSE'+'P1'+'0'+'1.00'+'MYR'+'A'+'O'+''+''));
 // Real eGHL refunds stay off unless explicitly enabled; the gateway is still refused outside staging sandbox.
 const env={PUBLIC_BASE_URL:'https://shop.test',PAYMENT_PROVIDER:'eghl',APP_ENV:'staging',EGHL_SANDBOX_ENABLED:'true',EGHL_SERVICE_ID:'JSE',EGHL_PASSWORD:SECRET,EGHL_PAYMENT_URL:'https://pay.test'};
 assert.equal(paymentAdapter(env).refundsEnabled,false);assert.match(paymentAdapter(env).refundsDisabledReason,/merchant portal/);
 assert.equal(paymentAdapter({...env,EGHL_REFUND_API_ENABLED:'true'}).refundsEnabled,true);
 assert.throws(()=>paymentAdapter({...env,APP_ENV:'production'}),/sandbox/);
});

test('payment checks: a missed callback is found before stock is released; unpaid and failed payments are not',async()=>{
 const h=await harness();
 try{
  const missed=await buy(h,[{variant_id:h.wallet.id,quantity:2}]),never=await buy(h,[{variant_id:h.wallet.id,quantity:1}]),declined=await buy(h,[{variant_id:h.wallet.id,quantity:1}]);
  assert.equal(await h.stock(h.wallet),6);
  h.eghl.answers.set(missed.payment.fields.PaymentID,{status:'0',order:missed.order.number});
  h.eghl.answers.set(declined.payment.fields.PaymentID,{status:'1',order:declined.order.number});
  await h.owner("UPDATE payments SET created_at=now()-interval '40 minutes'");await h.owner("UPDATE orders SET expires_at=now()-interval '1 minute'");
  const m=await h.sweep();assert.equal(m.payments_checked.checked,3);
  assert.equal((await h.detail(missed.order.number)).status,'paid','paid from the QUERY answer, not expired');
  assert.equal((await h.detail(never.order.number)).status,'expired');assert.equal((await h.detail(declined.order.number)).status,'expired');
  assert.equal(await h.stock(h.wallet),8,'only the paid order keeps its stock; nothing taken twice');
  const d=await h.detail(missed.order.number);
  assert.deepEqual(d.events.map(e=>[e.source,e.outcome]),[['query','paid']]);assert.equal(d.payments[0].status,'succeeded');
  assert.ok(d.activity.some(a=>a.action==='paid'&&/query/.test(a.detail)));
  assert.equal((await h.detail(declined.order.number)).payments[0].status,'failed');
  assert.deepEqual((await h.detail(never.order.number)).events.map(e=>e.outcome),['query_not_found']);
  // The late real callback for the same payment is a duplicate: no second confirmation, no stock change.
  assert.equal(await h.callback(h.signed(missed)),'OK');
  assert.equal(await h.stock(h.wallet),8);assert.equal((await h.db.query("SELECT count(*)::int AS n FROM email_outbox WHERE kind='order_paid'")).rows[0].n,1);
  // Checked payments are not asked again straight away.
  assert.equal((await h.sweep()).payments_checked.checked,0);
 }finally{await h.close();}
});

test('payment checks: wrong amount is flagged, staff can check one order, viewers cannot',async()=>{
 const h=await harness();
 try{
  const r=await buy(h,[{variant_id:h.wallet.id,quantity:1}]);
  assert.equal((await h.act(r.order.number,'check-payment',{},'viewer')).status,403);
  let c=await h.act(r.order.number,'check-payment');assert.equal(c.status,200);assert.match(c.body.check_result,/no record/);
  h.eghl.answers.set(r.payment.fields.PaymentID,{status:'0',order:r.order.number,amount:'1.00'});
  c=await h.act(r.order.number,'check-payment');assert.match(c.body.check_result,/rejected/);
  assert.equal(c.body.needs_attention,true);assert.match(c.body.attention_note,/expected MYR 50\.00/);assert.equal(c.body.status,'pending_payment');
  h.eghl.answers.set(r.payment.fields.PaymentID,{status:'2',order:r.order.number});
  c=await h.act(r.order.number,'check-payment');assert.match(c.body.check_result,/still pending/);assert.equal(c.body.payments[0].status,'pending');
  h.eghl.down=true;c=await h.act(r.order.number,'check-payment');assert.equal(c.body.check_result,'gateway did not answer');
  assert.ok(c.body.activity.filter(a=>a.action==='payment_checked').length>=4);
  assert.deepEqual(c.body.gateway,{provider:'eghl',can_query:true,refunds_enabled:true,refunds_disabled_reason:null});
 }finally{await h.close();}
});

test('callbacks: cancel/failed, success, repeated success, success after failure; stock and confirmation happen once',async()=>{
 const h=await harness();
 try{
  const r=await buy(h,[{variant_id:h.wallet.id,quantity:1}]);
  assert.equal(await h.callback(h.signed(r,'1')),'OK');assert.equal((await h.detail(r.order.number)).payments[0].status,'failed');
  assert.equal(await h.callback(h.signed(r,'0')),'OK');assert.equal(await h.callback(h.signed(r,'0')),'OK');assert.equal(await h.callback(h.signed(r,'1')),'OK');
  const d=await h.detail(r.order.number);assert.equal(d.status,'paid');assert.equal(d.payments[0].status,'succeeded','a later failure never undoes a success');
  assert.deepEqual(d.events.map(e=>e.outcome),['failed','paid','duplicate','duplicate']);
  assert.equal(await h.stock(h.wallet),9);assert.equal((await h.db.query("SELECT count(*)::int AS n FROM inventory_adjustments WHERE order_id=$1",[d.id])).rows[0].n,1);
  assert.equal((await h.db.query('SELECT pymt_method FROM payments')).rows[0].pymt_method,'CC','method kept for QUERY/REFUND');
  assert.equal(await h.callback({...h.signed(r,'0'),Amount:'45.01'}),'REJECTED','tampered amount');
 }finally{await h.close();}
});

test('refunds: recorded (eGHL portal) vs through eGHL; unclear answers block until staff settle them',async()=>{
 const h=await harness();
 try{
  const r=await paid(h,[{variant_id:h.wallet.id,quantity:2}]); // RM90, free shipping
  assert.equal(await h.stock(h.wallet),8);
  // 1. Through eGHL, success: ledger entry 'gateway', email, restock.
  let x=await h.act(r.order.number,'gateway-refunds',{amount_minor:2000,note:'Scratched',restock:true});assert.equal(x.status,200,JSON.stringify(x.body));
  assert.equal(x.body.refund_result,'succeeded');assert.equal(x.body.refunded_minor,2000);assert.deepEqual(x.body.refunds.map(f=>[f.method,f.amount_minor,f.restocked]),[['gateway',2000,true]]);
  assert.equal(await h.stock(h.wallet),10);const req=h.eghl.calls.at(-1);assert.equal(req.TransactionType,'REFUND');assert.equal(req.Amount,'20.00');assert.equal(req.PymtMethod,'CC');
  // 2. Recorded after a portal refund.
  x=await h.act(r.order.number,'refunds',{amount_minor:1000,reference:'PORTAL-1'});assert.deepEqual(x.body.refunds.map(f=>f.method),['gateway','recorded']);
  // 3. Unclear answer (gateway down): nothing refunded here, amount blocked, no automatic retry.
  h.eghl.down=true;x=await h.act(r.order.number,'gateway-refunds',{amount_minor:3000});assert.equal(x.body.refund_result,'unknown');assert.equal(x.body.refunded_minor,3000);
  h.eghl.down=false;
  assert.equal((await h.act(r.order.number,'gateway-refunds',{amount_minor:100})).status,409,'second gateway refund blocked');
  assert.equal((await h.act(r.order.number,'refunds',{amount_minor:6000,reference:'X'})).status,400,'RM60 left minus RM30 in doubt');
  const gr=x.body.gateway_refunds.find(g=>g.status==='unknown');
  assert.equal((await h.act(r.order.number,`gateway-refunds/${gr.id}/settle`,{outcome:'succeeded'})).status,400,'reference required');
  x=await h.act(r.order.number,`gateway-refunds/${gr.id}/settle`,{outcome:'succeeded',reference:'EGHL-RF-9'});assert.equal(x.body.refunded_minor,6000);
  assert.equal((await h.act(r.order.number,`gateway-refunds/${gr.id}/settle`,{outcome:'failed'})).status,409,'already settled');
  // 4. Declined by eGHL and an unverifiable answer.
  h.eghl.refund='1';x=await h.act(r.order.number,'gateway-refunds',{amount_minor:500});assert.equal(x.body.refund_result,'failed');assert.equal(x.body.refunded_minor,6000);
  h.eghl.refund='garbage';x=await h.act(r.order.number,'gateway-refunds',{amount_minor:500});assert.equal(x.body.refund_result,'unknown');
  const g2=x.body.gateway_refunds.find(g=>g.status==='unknown');x=await h.act(r.order.number,`gateway-refunds/${g2.id}/settle`,{outcome:'failed'});assert.equal(x.body.refunded_minor,6000);
  assert.equal((await h.db.query("SELECT count(*)::int AS n FROM email_outbox WHERE kind='order_refunded'")).rows[0].n,3,'emails only for refunds that happened');
  const acts=x.body.activity.map(a=>a.action);for(const a of ['refund_gateway_requested','refund_gateway_succeeded','refund_recorded','refund_gateway_unknown','refund_gateway_settled_succeeded','refund_gateway_failed','refund_gateway_settled_failed'])assert.ok(acts.includes(a),a);
  assert.equal((await h.act(r.order.number,'gateway-refunds',{amount_minor:100},'viewer')).status,403);
 }finally{await h.close();}
});

test('refunds through eGHL are refused with a reason when not switched on',async()=>{
 const h=await harness({refunds:false});
 try{
  const r=await paid(h,[{variant_id:h.wallet.id,quantity:2}]);
  const d=await h.detail(r.order.number);assert.equal(d.gateway.refunds_enabled,false);assert.match(d.gateway.refunds_disabled_reason,/merchant portal/);
  const x=await h.act(r.order.number,'gateway-refunds',{amount_minor:100});assert.equal(x.status,409);assert.match(x.body.error,/merchant portal/);
  assert.equal(h.eghl.calls.length,0,'eGHL never called');assert.equal((await h.db.query('SELECT count(*)::int AS n FROM gateway_refunds')).rows[0].n,0);
 }finally{await h.close();}
});

test('fulfilment with carrier and link, tracking corrections, and returns with one-time restock',async()=>{
 const h=await harness();
 try{
  const r=await paid(h,[{variant_id:h.wallet.id,quantity:2}]);
  assert.equal((await h.act(r.order.number,'return',{step:'request'})).status,400,'not shipped yet');
  assert.equal((await h.act(r.order.number,'fulfil',{tracking_carrier:'J&T Express',tracking_number:'JT1',tracking_url:'http://track.test/1'})).status,400,'https only');
  let x=await h.act(r.order.number,'fulfil',{tracking_carrier:'J&T Express',tracking_number:'JT1',tracking_url:'https://track.test/JT1'});assert.equal(x.body.fulfillment_status,'fulfilled');
  const mail=(await h.db.query("SELECT body FROM email_outbox WHERE kind='order_fulfilled'")).rows[0].body;assert.match(mail,/Carrier: J&T Express/);assert.match(mail,/Track your parcel: https:\/\/track\.test\/JT1/);
  x=await h.act(r.order.number,'tracking',{tracking_carrier:'Pos Laju',tracking_number:'PL9'});assert.equal(x.body.tracking_carrier,'Pos Laju');assert.equal(x.body.tracking_url,'');
  assert.equal((await h.db.query("SELECT count(*)::int AS n FROM email_outbox WHERE kind='order_fulfilled'")).rows[0].n,1,'no second shipping email');
  assert.equal((await h.act(r.order.number,'tracking',{})).status,400);
  const pub=(await h.request(`storefront/orders/${r.order.number}/status`,'POST',{access_token:r.access_token},null)).body.order;assert.equal(pub.tracking_carrier,'Pos Laju');assert.equal(pub.tracking_number,'PL9');
  assert.equal((await h.act(r.order.number,'return',{step:'receive'})).status,409,'must be requested first');
  x=await h.act(r.order.number,'return',{step:'request',note:'Wrong colour'});assert.equal(x.body.return_status,'requested');
  assert.equal(await h.stock(h.wallet),8);
  x=await h.act(r.order.number,'return',{step:'receive',restock:true});assert.equal(x.body.return_status,'received');assert.equal(await h.stock(h.wallet),10);
  // A refund afterwards cannot restock again (net units already back).
  x=await h.act(r.order.number,'refunds',{amount_minor:9000,reference:'R',restock:true});assert.equal(x.status,200);assert.equal(await h.stock(h.wallet),10,'never more than was taken');
  x=await h.act(r.order.number,'return',{step:'close'});assert.equal(x.body.return_status,'closed');assert.match(x.body.return_note,/Wrong colour/);
  assert.deepEqual(x.body.activity.filter(a=>a.action.startsWith('return_')).map(a=>a.action),['return_requested','return_received','return_closed']);
  assert.match(x.body.activity.find(a=>a.action==='return_received').detail,/2 units back to stock/);
  assert.equal((await h.act(r.order.number,'return',{step:'request'},'viewer')).status,403);
  for(const q of ['DELETE FROM order_activity','UPDATE order_activity SET detail=$1','DELETE FROM gateway_refunds'])await assert.rejects(h.db.query(q,q.includes('$1')?['x']:[]),e=>e.code==='42501',q);
 }finally{await h.close();}
});

test('shipping boundaries: RM48.99 vs RM49.00, mixed profiles add up, luggage weight limits',async()=>{
 const h=await harness();
 try{
  const q=async lines=>(await h.request('storefront/cart','POST',{lines},null)).body;
  assert.equal((await q([{variant_id:h.bag.id,quantity:1}])).shipping_minor,500,'RM48.99 pays shipping');
  const pen=await h.mk({title:'Pen',sku:'P-1',price_minor:1,inventory:5});
  assert.equal((await q([{variant_id:h.bag.id,quantity:1},{variant_id:pen.id,quantity:1}])).shipping_minor,0,'RM49.00 exactly is free');
  const mixed=await q([{variant_id:h.bag.id,quantity:1},{variant_id:h.luggage.id,quantity:1}]);assert.equal(mixed.shipping_minor,500+2690,'each profile charged on its own items');
  assert.equal((await q([{variant_id:h.wallet.id,quantity:2},{variant_id:h.luggage.id,quantity:2}])).shipping_minor,2690,'50 kg is the limit, included');
  assert.match((await q([{variant_id:h.luggage.id,quantity:3}])).shipping_error,/not available/,'75 kg cannot ship');
  // The server ignores any price or shipping the browser sends.
  const r=await h.request('storefront/checkout','POST',{...order([{variant_id:h.bag.id,quantity:1,price_minor:1}]),shipping_minor:0,total_minor:1},null);assert.equal(r.body.order.total_minor,5399);
 }finally{await h.close();}
});
