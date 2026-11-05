import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {cloudAdapter} from '../src/media.mjs';

test('catalogue API persists edits, relations and ordered media with role, conflict and rollback checks',async()=>{
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true),('off','admin',false)");
 await db.query("INSERT INTO media(object_key,mime,bytes,state,created_by,format) VALUES ('private/one','image/png',100,'ready','editor','png'),('private/two','image/png',100,'pending','editor','png')");
 await db.query('SET ROLE jackstudio_api');
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub:sub==='aal1'?'editor':sub,aal:sub==='aal1'?'aal1':'aal2'}),{cloud:{preview:m=>'https://api.cloudinary.com/private/'+m.id}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 try{
  const c=(await request('collections','POST',{title:'Carry',status:'active',position:2})).body;
  const c2=(await request('collections','POST',{title:'Gifts',position:1})).body;
  const created=await request('products','POST',{title:'Wallet',price_minor:12990,sku:'WAL-01',inventory:7,collection_ids:[String(c.id),String(c2.id)],media:[{media_id:'1',alt:'Front'}]});assert.equal(created.status,201);const p=created.body;
  let detail=(await request('products/'+p.id)).body;assert.equal(detail.price_minor,12990);assert.equal(detail.collection_ids.length,2);assert.equal(detail.media[0].alt,'Front');
  const found=await request('products?paged=true&q=wal-01&collection='+c.id);assert.equal(found.body.total,1);assert.equal(found.body.items[0].inventory,7);
  assert.equal((await request('products?paged=true&q=missing')).body.total,0);
  assert.equal((await request('products?paged=true&limit=101')).status,400);
  assert.equal((await request('products?paged=true&offset=-1')).status,400);
  const paged=(await request('collections?paged=true&limit=1')).body;assert.equal(paged.total,2);assert.equal(paged.items[0].id,c2.id);
  assert.equal((await request('products','POST',{title:'Other',sku:'wal-01'})).status,409);
  for(const token of ['viewer','off','unknown','aal1'])assert.equal((await request('products/'+p.id,'PATCH',{revision:1,inventory:999},token)).status,403);
  assert.equal((await request('products/'+p.id,'PATCH',{revision:1,inventory:-1})).status,400);
  assert.equal((await request('products/'+p.id,'PATCH',{revision:1,price_minor:1.25})).status,400);
  assert.equal((await request('products/'+p.id,'PATCH',{revision:1,media:[{media_id:'2'}]})).status,400);
  assert.equal((await request('products/'+p.id,'PATCH',{revision:1,media:[{media_id:'1'},{media_id:'1'}]})).status,400);
  assert.equal((await request('products/'+p.id,'PATCH',{revision:1,collection_ids:[String(c.id),'999999']})).status,409);
  detail=(await request('products/'+p.id)).body;assert.equal(detail.revision,1);assert.equal(detail.collection_ids.length,2);
  assert.equal((await request('products/'+p.id,'PATCH',{revision:1,status:'active',inventory:3})).status,200);
  assert.equal((await request('products/'+p.id,'PATCH',{revision:1,inventory:9})).status,409);
  assert.equal((await request('storefront')).body.products.length,1);
  assert.equal((await request('products/'+p.id,'PATCH',{revision:2,status:'archived',collection_ids:[String(c2.id)],media:[]})).status,200);
  assert.equal((await request('storefront')).body.products.length,0);
  assert.equal((await request('collections/'+c.id)).body.product_ids.length,0);
  assert.equal((await request('collections/'+c2.id)).body.product_ids.length,1);
  assert.equal((await request('dashboard')).body.archived,1);
  assert.equal((await request('products/'+p.id,'GET',undefined,'viewer')).status,200);
  assert.equal((await request('media/1/preview','GET',undefined,'viewer')).status,200);
  for(const token of ['unknown','off','aal1'])assert.equal((await request('media/1/preview','GET',undefined,token)).status,403);
  assert.equal((await request('media/2/preview')).status,404);
  assert.equal((await request('products/'+p.id,'DELETE')).status,405);
  await assert.rejects(db.query('DELETE FROM products'),e=>e.code==='42501');
  await assert.rejects(db.query('UPDATE staff SET active=false'),e=>e.code==='42501');
  await assert.rejects(db.query('DELETE FROM audit_events'),e=>e.code==='42501');
  await db.query('RESET ROLE');assert.equal(Number((await db.query("SELECT count(*) AS n FROM audit_events WHERE entity='products'")).rows[0].n),3);
 }finally{await new Promise(r=>server.close(r));await db.close();}
});
test('private Cloudinary preview URLs are authenticated and expire without revealing API secret',()=>{
 const url=new URL(cloudAdapter({CLOUDINARY_CLOUD_NAME:'test-cloud',CLOUDINARY_API_KEY:'test-key',CLOUDINARY_API_SECRET:'test-secret',CLOUDINARY_UPLOAD_PRESET:'signed'}).preview({object_key:'private/id',format:'png'}));
 assert.equal(url.hostname,'api.cloudinary.com');assert.equal(url.searchParams.get('type'),'authenticated');assert.ok(Number(url.searchParams.get('expires_at'))<=Date.now()/1000+301);assert.ok(url.searchParams.get('signature'));assert.equal(url.href.includes('test-secret'),false);
});
