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
 const server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{payments}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token=editor)=>{const h={'Content-Type':'application/json'};if(token)h.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 const callback=f=>fetch(base+'payments/mock/callback',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...f,HashValue2:responseHash2(SECRET,f)}).toString()}).then(r=>r.text());
 const customer={name:'Test Buyer',email:`buyer-${run}@example.com`,phone:'0123456789',address_line1:'1 Jalan',city:'Klang',postcode:'41000',state:'Selangor'};
 try{
  const c=(await request('collections','POST',{title:'C '+run,status:'active'})).body;
  const p=(await request('products','POST',{title:'Limited '+run,status:'active',collection_ids:[String(c.id)],sku:'LIM-'+run,price_minor:9900,inventory:3})).body;
  const v=(await request('products/'+p.id)).body.variants[0];
  const attempts=await Promise.all(Array.from({length:10},()=>request('storefront/checkout','POST',{idempotency_key:randomUUID(),access_token:randomBytes(24).toString('base64url'),customer,lines:[{variant_id:v.id,quantity:1}]},null)));
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
 }finally{await new Promise(r=>server.close(r));await pool.end();}
});
