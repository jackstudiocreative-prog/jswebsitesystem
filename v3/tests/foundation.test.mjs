import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:http';
import { migrate } from '../src/migrate.mjs';
import { handler } from '../src/server.mjs';
import { authorize,verifier } from '../src/auth.mjs';
import { create } from '../src/catalog.mjs';
import rules from '../../shared/catalog.js';
const db=new PGlite();
// PGlite is PostgreSQL compiled to WASM, not a SQL mock. Production also uses an advisory lock.
const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
test('migration replays without resetting records; checksum drift fails',async()=>{
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('admin','admin',true),('editor','editor',true),('viewer','viewer',true),('disabled','admin',false)");
 await migrate(sql);assert.equal((await db.query('SELECT * FROM staff')).rows.length,4);
 await db.query("UPDATE schema_migrations SET checksum='tampered'");
 await assert.rejects(migrate(sql),/Applied migration changed/);
 // restore checksum through a fresh schema for remaining independent cases
 await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('admin','admin',true),('editor','editor',true),('viewer','viewer',true),('disabled','admin',false)");
});
test('MFA, role and staff revocation are enforced from database',async()=>{
 for(const sub of ['admin','editor'])await authorize(db,{sub,aal:'aal2'},true);
 await authorize(db,{sub:'viewer',aal:'aal2'});
 for(const claims of [{sub:'viewer',aal:'aal2'},{sub:'admin',aal:'aal1'},{sub:'disabled',aal:'aal2'},{sub:'stranger',aal:'aal2'}])await assert.rejects(authorize(db,claims,true),e=>e.status===403);
 assert.throws(()=>verifier({issuer:'http://bad',audience:'authenticated',jwksUrl:'http://bad'}));
});
test('catalog persistence, constraints and audit trail',async()=>{
 const c=await create(db,'collections',{title:'Urban Carry'},'admin');
 const p=await create(db,'products',{title:'Wallet',collection_id:c.id},'editor');
 assert.equal(p.status,'draft');assert.equal((await db.query('SELECT * FROM products')).rows.length,1);
 assert.equal((await db.query('SELECT * FROM audit_events')).rows.length,2);
 await assert.rejects(create(db,'products',{title:'Wallet'},'admin'),e=>e.code==='23505');
 await assert.rejects(create(db,'products',{title:'Bad',collection_id:999},'admin'),e=>e.code==='23503');
 await assert.rejects(create(db,'products',{title:'Bad',unexpected:true},'admin'),e=>e.status===400);
 assert.equal(rules.slug(' Urban Carry '),'urban-carry');
});
test('HTTP rejects missing/invalid identity, viewer writes and invalid JSON',async()=>{
 const pool={connect:async()=>({...sql,release(){}})};
 const verify=async token=>{if(token==='invalid')throw Error();return {sub:token==='pre-mfa'?'admin':token,aal:token==='pre-mfa'?'aal1':'aal2'};};
 const server=createServer(handler(pool,verify));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/api/v3/products')).status,401);
  // Accepting an Auth invitation must never bypass the staff allowlist or MFA gate.
  for(const token of ['stranger','disabled','pre-mfa'])assert.equal((await fetch(base+'/api/v3/session',{headers:{Authorization:'Bearer '+token}})).status,403);
  assert.deepEqual(await (await fetch(base+'/api/v3/session',{headers:{Authorization:'Bearer editor'}})).json(),{subject:'editor',role:'editor'});
  assert.equal((await fetch(base+'/api/v3/products',{headers:{Authorization:'Bearer invalid'}})).status,401);
  assert.equal((await fetch(base+'/api/v3/products',{method:'POST',headers:{Authorization:'Bearer viewer'}})).status,403);
  assert.equal((await fetch(base+'/api/v3/products',{method:'POST',headers:{Authorization:'Bearer admin','Content-Type':'application/json'},body:'{'})).status,400);
  const r=await fetch(base+'/api/v3/products',{headers:{Authorization:'Bearer viewer'}});assert.equal(r.status,200);assert.equal((await r.json())[0].title,'Wallet');
  assert.deepEqual((await (await fetch(base+'/api/v3/storefront')).json()).products,[]);
  await db.query("UPDATE products SET status='active'");
  assert.deepEqual((await (await fetch(base+'/api/v3/storefront')).json()).products,[]);
  await db.query("UPDATE collections SET status='active'");
  const publicData=await (await fetch(base+'/api/v3/storefront')).json();assert.equal(publicData.products.length,1);assert.equal(publicData.checkoutAvailable,false);
  assert.equal((await fetch(base+'/api/v3/checkout',{method:'POST'})).status,404);
 }finally{await new Promise(r=>server.close(r));}
});
test.after(()=>db.close());
