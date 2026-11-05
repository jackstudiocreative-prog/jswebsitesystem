import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {testGateway,responseHash2} from '../src/payments.mjs';
// Real PostgreSQL, separate connections: simultaneous checkouts can never oversell, simultaneous
// gateway callbacks mark an order paid exactly once, and checkout never deadlocks with product saves.
test('real PostgreSQL: concurrent checkouts, duplicate callbacks and product saves',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const owner=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await owner.connect();
 const run=randomUUID().slice(0,8),editor='shop-'+run;
 try{await migrate(owner);await owner.query("INSERT INTO staff VALUES ($1,'editor',true)",[editor]);}finally{await owner.end();}
 const SECRET='k'.repeat(40),payments=testGateway({provider:'mock',serviceId:'JSMOCK',password:SECRET,actionUrl:'https://pay.test',baseUrl:'https://shop.test'});
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:10});pool.on('connect',c=>{c.query('SET ROLE jackstudio_api');});
 const maintenanceSecret='disposable-ci-maintenance-secret-123';
 const server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{payments,rateLimits:false,maintenanceSecret}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token=editor)=>{const h={'Content-Type':'application/json'};if(token)h.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 const callback=f=>fetch(base+'payments/mock/callback',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...f,HashValue2:responseHash2(SECRET,f)}).toString()}).then(r=>r.text());
 const customer={name:'Test Buyer',email:`buyer-${run}@example.com`,phone:'0123456789',address_line1:'1 Jalan',city:'Klang',postcode:'41000',state:'Selangor'};
 try{
  const c=(await request('collections','POST',{title:'C '+run,status:'active'})).body;
  const p=(await request('products','POST',{title:'Limited '+run,status:'active',collection_ids:[String(c.id)],sku:'LIM-'+run,price_minor:9900,inventory:3})).body;
  const v=(await request('products/'+p.id)).body.variants[0];
  const attempts=await Promise.all(Array.from({length:10},()=>request('storefront/checkout','POST',{idempotency_key:randomUUID(),access_token:randomBytes(24).toString('base64url'),customer:{...customer,email:`buyer-${randomUUID()}@example.com`},lines:[{variant_id:v.id,quantity:1}]},null)));
  assert.deepEqual(attempts.map(a=>a.status).sort(),[201,201,201,409,409,409,409,409,409,409]);
  const first=attempts.find(a=>a.status===201).body;
  const f={ServiceID:'JSMOCK',PaymentID:first.payment.fields.PaymentID,OrderNumber:first.order.number,Amount:first.payment.fields.Amount,CurrencyCode:'MYR',TxnID:'X',AuthCode:'A',TxnStatus:'0',Param6:'',Param7:''};
  assert.deepEqual(await Promise.all(Array.from({length:5},()=>callback(f))),['OK','OK','OK','OK','OK']);
  const db=await pool.connect();
  try{
   assert.equal((await db.query("SELECT count(*)::int AS n FROM payment_events e JOIN payments p ON p.id=e.payment_id WHERE p.payment_ref=$1 AND e.outcome='paid'",[f.PaymentID])).rows[0].n,1,'paid exactly once');
   assert.equal((await db.query('SELECT inventory FROM product_variants WHERE id=$1',[v.id])).rows[0].inventory,0);
  }finally{db.release();}
  // Stock arrives while a product save and a checkout run at the same time.
  await request('inventory/adjustments','POST',{variant_id:v.id,delta:5,reason:'received'});
  const detail=(await request('products/'+p.id)).body;
  const mixed=await Promise.all([request('products/'+p.id,'PATCH',{revision:detail.revision,title:'Limited edition '+run}),request('storefront/checkout','POST',{idempotency_key:randomUUID(),access_token:randomBytes(24).toString('base64url'),customer,lines:[{variant_id:v.id,quantity:2}]},null)]);
  assert.deepEqual(mixed.map(m=>m.status),[200,201]);
  const check=await pool.connect();try{assert.equal((await check.query('SELECT inventory FROM product_variants WHERE id=$1',[v.id])).rows[0].inventory,3);}finally{check.release();}
  await request('inventory/adjustments','POST',{variant_id:v.id,delta:20,reason:'received'});
  const makeOrder=email=>({idempotency_key:randomUUID(),access_token:randomBytes(24).toString('base64url'),customer:{...customer,email},lines:[{variant_id:v.id,quantity:1}]});
  const identical=makeOrder(`idem-${run}@example.com`);
  const repeated=await Promise.all(Array.from({length:5},()=>request('storefront/checkout','POST',identical,null)));
  assert.deepEqual(repeated.map(r=>r.status),[201,201,201,201,201]);assert.equal(new Set(repeated.map(r=>r.body.order.number)).size,1,'concurrent identical key creates one order');
  const capped=await Promise.all(Array.from({length:6},()=>request('storefront/checkout','POST',makeOrder(`cap-${run}@example.com`),null)));
  assert.deepEqual(capped.map(r=>r.status).sort(),[201,201,201,429,429,429],'email cap serializes across connections');
  // A save winning the product lock must determine the price, not an earlier unlocked snapshot.
  const writer=await pool.connect();
  try{
   await writer.query('BEGIN');await writer.query('SELECT id FROM products WHERE id=$1 FOR UPDATE',[p.id]);
   const writerPid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const waiting=request('storefront/checkout','POST',makeOrder(`price-${run}@example.com`),null);
   let blocked=false;
   for(let i=0;i<100;i++){
    // SQL text in pg_stat_activity is intentionally hidden from the restricted API role.
    // Observe the lock relationship directly without requiring pg_read_all_stats privileges.
    const monitor=await pool.connect();try{blocked=(await monitor.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS waiting',[writerPid])).rows[0].waiting;}finally{monitor.release();}
    if(blocked)break;await new Promise(r=>setTimeout(r,20));
   }
   assert.ok(blocked,'checkout is waiting for the staff product lock');
   await writer.query('UPDATE product_variants SET price_minor=12900 WHERE id=$1',[v.id]);await writer.query('UPDATE products SET price_minor=12900 WHERE id=$1',[p.id]);await writer.query('COMMIT');
   const latest=await waiting;assert.equal(latest.status,201);assert.equal(latest.body.order.total_minor,12900,'price read after the winning save commits');
  }finally{await writer.query('ROLLBACK');writer.release();}
  // Two scheduler workers and duplicate delivery must release every order only once.
  const control=await pool.connect();let expiredIds;
  try{expiredIds=(await control.query("UPDATE orders SET expires_at=now()-interval '1 minute' WHERE status='pending_payment' AND id IN (SELECT order_id FROM order_lines WHERE variant_id=$1) RETURNING id",[v.id])).rows.map(r=>r.id);}finally{control.release();}
  const sweep=()=>fetch(base+'maintenance/expire-orders',{method:'POST',headers:{Authorization:'Bearer '+maintenanceSecret}}).then(async r=>({status:r.status,body:await r.json()}));
  const swept=await Promise.all([sweep(),sweep()]);assert.deepEqual(swept.map(r=>r.status),[200,200]);assert.equal(swept.reduce((n,r)=>n+r.body.expired,0),expiredIds.length);
  assert.equal((await sweep()).body.expired,0);
  const verify=await pool.connect();try{
   assert.equal((await verify.query('SELECT inventory FROM product_variants WHERE id=$1',[v.id])).rows[0].inventory,27);
   const releases=(await verify.query("SELECT order_id,count(*)::int AS n FROM inventory_adjustments WHERE order_id = ANY($1::bigint[]) AND reason='sale_released' GROUP BY order_id",[expiredIds])).rows;
   assert.equal(releases.length,expiredIds.length);assert.ok(releases.every(r=>r.n===1));
   assert.equal((await verify.query('SELECT inventory=(SELECT sum(delta) FROM inventory_adjustments WHERE variant_id=$1) AS balanced FROM product_variants WHERE id=$1',[v.id])).rows[0].balanced,true);
  }finally{verify.release();}
 }finally{await new Promise(r=>server.close(r));await pool.end();}
});
