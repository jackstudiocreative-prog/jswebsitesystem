import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
// Real PostgreSQL with separate connections: concurrent stock changes and saves must serialize,
// never deadlock and never produce negative stock or an unbalanced ledger.
test('real PostgreSQL serializes concurrent stock adjustments and product saves',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const owner=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await owner.connect();
 const run=randomUUID().slice(0,8),editor='inv-'+run;
 try{await migrate(owner);await owner.query("INSERT INTO staff VALUES ($1,'editor',true)",[editor]);}finally{await owner.end();}
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:8});
 pool.on('connect',client=>{client.query('SET ROLE jackstudio_api');});
 const server=createServer(handler(pool,async sub=>({sub,aal:'aal2'})));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+editor,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 try{
  const p=(await request('products','POST',{title:'Concurrent '+run,option_names:['Color'],variants:[{option_values:['Brown'],sku:'CC-'+run,price_minor:9900,inventory:5}]})).body;
  const v=(await request('products/'+p.id)).body.variants[0];
  const results=await Promise.all(Array.from({length:6},()=>request('inventory/adjustments','POST',{variant_id:v.id,delta:-2,reason:'correction'})));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,201,409,409,409,409]);
  // Product saves running alongside stock changes neither deadlock nor overwrite stock.
  const detail=(await request('products/'+p.id)).body;
  const mixed=await Promise.all([
   request('products/'+p.id,'PATCH',{revision:detail.revision,variants:[{id:v.id,option_values:['Brown'],sku:'CC-'+run,price_minor:10900}]}),
   request('inventory/adjustments','POST',{variant_id:v.id,delta:4,reason:'received'}),
   request('inventory/adjustments','POST',{variant_id:v.id,delta:3,reason:'returned'})]);
  assert.deepEqual(mixed.map(r=>r.status),[200,201,201]);
  const final=(await request('products/'+p.id)).body;
  assert.equal(final.variants[0].inventory,8);assert.equal(final.variants[0].price_minor,10900);assert.equal(final.inventory,8);
  const history=(await request('inventory/adjustments?variant='+v.id+'&limit=100')).body;
  assert.equal(history.total,5);assert.equal(history.items.reduce((n,a)=>n+a.delta,0),8);
  for(const a of history.items)assert.equal(a.quantity_after,a.quantity_before+a.delta);
  const db=await pool.connect();
  try{
   await assert.rejects(db.query('UPDATE product_variants SET inventory=50 WHERE id=$1',[v.id]),e=>e.code==='23514');
   for(const q of ['DELETE FROM product_variants','DELETE FROM inventory_adjustments','UPDATE inventory_adjustments SET note=$1'])await assert.rejects(db.query(q,q.includes('$1')?['x']:[]),e=>e.code==='42501');
  }finally{db.release();}
 }finally{await new Promise(r=>server.close(r));await pool.end();}
});
