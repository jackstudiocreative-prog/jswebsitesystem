import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {testGateway} from '../src/payments.mjs';
import {aggregate,matchSkus,skuKey,compactKey,posClientFromEnv,readPosPage,warehouseIdsFromEnv} from '../src/pos-stock.mjs';

// Shape of GET /api/stock-warehouse rows (swagger StockWarehouseBalanceResponse), trimmed.
const row=(id,stockCode,warehouseId,qtyAvailable,extra={})=>({id,stockMasterId:id,warehouseId,warehouseCode:'W'+warehouseId,warehouseName:warehouseId===1?'HQ':'Mid Valley',stockCode,description:'Item '+stockCode,colour:'Brown',qtyOnHand:qtyAvailable,qtyAvailable,isActive:true,...extra});
const quiet=async fn=>{const e=console.error,l=console.log,errors=[],logs=[];console.error=(...a)=>errors.push(a);console.log=(...a)=>logs.push(a);try{return await fn({errors,logs});}finally{console.error=e;console.log=l;}};

test('SKU keys: case and repeated spaces ignored; compact key also drops dashes, dots and slashes',()=>{
 assert.equal(skuKey('  BAD 30516  B '),'bad 30516 b');
 assert.equal(compactKey('BAD 40107-F'),'bad40107f');
 assert.equal(compactKey('bad.40107/f'),'bad40107f');
 assert.equal(skuKey(null),'');
});

const col=(id,code,wh,qty,colour,size='')=>row(id,code,wh,qty,{colour,size});

test('aggregate: per stock code + colour + size over the counted warehouses, never below 0, whole units only',()=>{
 const {codes,warehouses,blank,rounded}=aggregate([col(1,'BAG-BAD40107',1,3,'F'),col(2,'bag-bad40107',2,4,'f'),col(3,'BAG-BAD40107',1,2,'B'),col(4,'JWB-1',1,-2,'A'),col(5,'JWB-1',2,1,'A'),col(6,'',1,9,'A'),col(7,'X1',1,2.6,''),col(8,'Y1',1,null,'')]);
 assert.equal(codes.get('bag-bad40107|f|').qty,7,'same code and colour: warehouses added');
 assert.equal(codes.get('bag-bad40107|b|').qty,2,'another colour stays apart');
 assert.equal(codes.get('jwb-1|a|').qty,0,'-2 + 1 is clamped to 0');
 assert.equal(codes.get('x1||').qty,2);assert.equal(codes.get('y1||').qty,0);
 assert.equal(blank,1);assert.equal(rounded,2);
 assert.deepEqual(warehouses.map(w=>[w.name,w.rows,w.counted]),[['HQ',5,true],['Mid Valley',2,true]],'rows without a stock code are not counted');
 // Only chosen warehouses count; the others are still listed.
 const one=aggregate([col(1,'BAG-BAD40107',1,3,'F'),col(2,'BAG-BAD40107',2,4,'F')],[2]);
 assert.equal(one.codes.get('bag-bad40107|f|').qty,4);
 assert.deepEqual(one.warehouses.map(w=>[w.id,w.counted]),[[2,true],[1,false]]);
});

test('matchSkus: website SKU = mPOS model (category prefix dropped) + colour; most specific first; never guesses',()=>{
 const {codes}=aggregate([
  col(1,'BAG-BAD40107',1,3,'F'),col(2,'BAG-BAD40107',1,1,'B'),col(3,'BAG-BAD40107',1,2,'E'),
  col(4,'BAG-BAD60303',1,5,'F'),col(5,'WAL-JWC50351',1,4,'B'),
  col(6,'BAG-BAD21002',1,7,'A'),                         // single colour in mPOS: website SKU has no colour
  col(7,'BAG-BAD40313',1,1,'A'),col(8,'BAG-BAD40313',1,1,'B'), // two colours: website "BAD40313" is ambiguous
  col(9,'ACC-BELTRING35',1,9,'A'),                       // not on the website
  col(10,'BLT-JB100',1,2,'A','32'),col(11,'BLT-JB100',1,3,'A','34'),
 ]);
 const v=(id,sku)=>({id:String(id),sku,active:true,product_status:'active'});
 const r=matchSkus(codes,[v(1,'BAD 40107 F'),v(2,'BAD 40107 B'),v(3,'BAD60303-F'),v(4,'JWC50351-B'),v(5,'BAD21002'),v(6,'BAD40313'),v(7,'ONLY-SITE'),v(8,null),v(9,'JB100 A 34'),v(10,'JWC50351-C')]);
 const got=Object.fromEntries(r.matched.map(m=>[m.variant.sku,[m.pos.stock_code,m.pos.colour,m.pos.qty,m.how]]));
 assert.deepEqual(got['BAD 40107 F'],['BAG-BAD40107','F',3,'model + colour']);
 assert.deepEqual(got['BAD 40107 B'],['BAG-BAD40107','B',1,'model + colour']);
 assert.deepEqual(got['BAD60303-F'],['BAG-BAD60303','F',5,'model + colour']);
 assert.deepEqual(got['JWC50351-B'],['WAL-JWC50351','B',4,'model + colour']);
 assert.deepEqual(got['BAD21002'],['BAG-BAD21002','A',7,'model only']);
 assert.deepEqual(got['JB100 A 34'],['BLT-JB100','A',3,'model + colour + size']);
 assert.equal(r.matched.length,6);
 assert.equal(r.ambiguous.length,1);assert.equal(r.ambiguous[0].sku,'BAD40313');assert.match(r.ambiguous[0].reason,/Fits 2 mPOS items \(model only\): BAG-BAD40313 colour A, BAG-BAD40313 colour B/);
 assert.deepEqual(r.siteOnly.map(s=>s.sku).sort(),['JWC50351-C','ONLY-SITE'],'sold out / unknown; variants without SKU are not listed');
 assert.deepEqual(r.posOnly.map(p=>`${p.stock_code} ${p.colour}${p.size?' '+p.size:''}`).sort(),['ACC-BELTRING35 A','BAG-BAD40107 E','BAG-BAD40313 A','BAG-BAD40313 B','BLT-JB100 A 32']);
 // The same SKU on two website variants is never matched.
 const dup=matchSkus(codes,[v(1,'BAD 40107 F'),v(2,'bad40107-f')]);assert.equal(dup.matched.length,0);assert.match(dup.ambiguous[0].reason,/more than one website variant/);
});

test('MPOS_WAREHOUSE_ID: empty = all; one or more IDs separated by commas',()=>{
 assert.equal(warehouseIdsFromEnv({}),null);assert.equal(warehouseIdsFromEnv({MPOS_WAREHOUSE_ID:' '}),null);
 assert.deepEqual(warehouseIdsFromEnv({MPOS_WAREHOUSE_ID:'12'}),[12]);
 assert.deepEqual(warehouseIdsFromEnv({MPOS_WAREHOUSE_ID:'12, 15,12'}),[12,15]);
 assert.throws(()=>warehouseIdsFromEnv({MPOS_WAREHOUSE_ID:'HQ'}),/warehouse numbers/);
});

test('mPOS client: one page per call with X-API-Key and the required filters; compact rows',async()=>{
 assert.equal(posClientFromEnv({}),null,'no key: not configured');
 assert.throws(()=>posClientFromEnv({MPOS_API_KEY:'k',MPOS_API_URL:'http://evil.test'}),/https/);
 assert.throws(()=>posClientFromEnv({MPOS_API_KEY:'k',MPOS_WAREHOUSE_ID:'abc'}),/warehouse/);
 assert.equal(posClientFromEnv({MPOS_API_KEY:'k',MPOS_WAREHOUSE_ID:'3,4'}).warehouseId,null,'several warehouses: read all, count the chosen ones');
 const all=Array.from({length:1203},(_,i)=>row(i+1,'S'+i,1,1));const calls=[];
 const fake=async(url,init)=>{calls.push({url:new URL(url),key:init.headers['X-API-Key']});const u=new URL(url),page=Number(u.searchParams.get('page')),size=Number(u.searchParams.get('pageSize'));return Response.json({page,pageSize:size,totalCount:all.length,items:all.slice((page-1)*size,page*size)});};
 const client=posClientFromEnv({MPOS_API_KEY:'secret-key',MPOS_WAREHOUSE_ID:'3'},fake);
 await quiet(async({logs})=>{
  const r=await readPosPage(client,{step:'read',page:3,page_size:500});
  assert.deepEqual([r.page,r.page_size,r.total_count,r.items.length],[3,500,1203,203]);
  assert.deepEqual(r.items[0],{i:1001,s:'S1000',q:1,w:1,wc:'W1',wn:'HQ',d:'Item S1000',c:'Brown',z:''});
  assert.equal(calls[0].url.origin+calls[0].url.pathname,'https://api_jack.mpos-web.com/api/stock-warehouse');
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams),{inStockOnly:'true',isActive:'true',pageSize:'500',page:'3',warehouseId:'3'});
  assert.equal(calls[0].key,'secret-key');
  assert.match(JSON.stringify(logs[0]),/mPOS page.*"page":"3".*"status":200/,'each page is logged with its time');
  assert.ok(!JSON.stringify(logs).includes('secret-key'));
 });
 await assert.rejects(readPosPage(client,{step:'read',page:0,page_size:500}),e=>e.status===400);
 await assert.rejects(readPosPage(client,{step:'read',page:1,page_size:250}),e=>e.status===400);
 await assert.rejects(readPosPage(client,{step:'read',page:1,page_size:500,extra:1}),e=>e.status===400);
});

test('mPOS client: errors say what happened (status, type, length, start of reply) and never the key',async()=>{
 const one=(fn,key='secret-xyz-123')=>posClientFromEnv({MPOS_API_KEY:key},fn).fetchPage(1,500);
 await quiet(async({errors})=>{
  await assert.rejects(one(async()=>new Response('no',{status:401})),e=>e.status===502&&/API key/.test(e.message)&&!e.message.includes('secret-xyz-123'));
  await assert.rejects(one(async()=>new Response('<!DOCTYPE html>\n<html><title>Error</title><body>An unhandled error has occurred.</body></html>',{status:200,headers:{'content-type':'text/html; charset=utf-8'}})),e=>{
   assert.equal(e.status,502);assert.match(e.message,/not JSON \(HTTP 200, text\/html; charset=utf-8, \d+ characters after \d+\.\d s, starts "<!DOCTYPE html> <html><title>Error<\/title>/);return true;});
  // JSON cut off part-way, as when the server fails while writing a large page.
  await assert.rejects(one(async()=>new Response(JSON.stringify({page:1,pageSize:500,totalCount:9,items:[row(1,'A',1,1)]}).slice(0,60),{status:200,headers:{'content-type':'application/json'}})),e=>/not JSON \(HTTP 200, application\/json, 60 characters/.test(e.message));
  await assert.rejects(one(async()=>new Response('',{status:200})),e=>/0 characters/.test(e.message));
  await assert.rejects(one(async()=>new Response('{"title":"Internal Server Error"}',{status:500})),e=>/HTTP 500: "\{"title":"Internal Server Error"\}"/.test(e.message));
  await assert.rejects(one(async()=>{throw Object.assign(new Error('t'),{name:'TimeoutError'});}),e=>e.status===504&&/within 24 seconds \(page 1, 500 rows\)/.test(e.message));
  assert.equal((await one(async()=>Response.json([row(1,'A',1,1),row(2,'B',1,1)]))).items.length,2,'a bare list is accepted');
  assert.ok(errors.length>=3);assert.ok(errors.every(a=>!JSON.stringify(a).includes('secret-xyz-123')),'logs never contain the key');
 });
});

// Fake mPOS behind the real handler; the test reads it the way the admin page does.
async function harness(feedRows,{failSize=null,posWarehouses=null}={}){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");await db.query('SET ROLE jackstudio_api');
 const state={rows:feedRows,calls:[]};
 const pos={fetchPage:async(page,size)=>{state.calls.push([page,size]);if(size===failSize){const e=new Error('mPOS did not answer within 24 seconds (page 1, 500 rows). Nothing was changed.');e.status=504;throw e;}return {page,pageSize:size,totalCount:state.rows.length,items:state.rows.slice((page-1)*size,page*size)};}};
 const gateway=testGateway({provider:'mock',serviceId:'JSMOCK',password:'p'.repeat(40),actionUrl:'https://pay.test',baseUrl:'https://shop.test'});
 const server=createServer(handler({connect:async()=>({...sql,release(){}})},async sub=>({sub,aal:'aal2'}),{payments:gateway,rateLimits:false,pos,posWarehouses}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});const t=await r.text();let j;try{j=JSON.parse(t);}catch{j=t;}return {status:r.status,body:j};};
 // Same loop as the admin card: pages until totalCount; 500 first, 100 if a 500-row page fails.
 const readAll=async()=>{
  for(const size of [500,100]){
   const rows=[];let page=1,total=null,failed=false;
   for(;;page++){const r=await request('inventory/pos-sync','POST',{step:'read',page,page_size:size});if(r.status!==200){failed=true;break;}total=r.body.total_count;rows.push(...r.body.items);if(!r.body.items.length||rows.length>=total)break;}
   if(!failed)return {rows,pages:page,page_size:size};
  }
  throw Error('mPOS read failed');
 };
 const sync=async(extra={},token)=>{const read=await readAll();return request('inventory/pos-sync','POST',{...read,...extra},token);};
 return {db,request,readAll,sync,state,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
const stockOf=async(db,sku)=>(await db.query('SELECT inventory FROM product_variants WHERE lower(sku)=lower($1)',[sku])).rows[0].inventory;
const balanced=async db=>(await db.query('SELECT bool_and(v.inventory=coalesce((SELECT sum(delta) FROM inventory_adjustments a WHERE a.variant_id=v.id),0)) AS ok FROM product_variants v')).rows[0].ok;

test('Sync from POS: check changes nothing; apply sets stock, keeps the ledger balanced, lists both kinds of missing SKUs',async()=>{
 const h=await harness([col(1,'WAL-K395',1,3,'A'),col(2,'WAL-K395',2,4,'A'),col(3,'BAG-BAD40107',1,2,'F'),col(4,'ACC-NEWINPOS',1,9,'A'),col(5,'CH',1,5,'BLK')]);
 try{
  const c=(await h.request('collections','POST',{title:'Shop',status:'active'})).body;
  const mk=body=>h.request('products','POST',{collection_ids:[String(c.id)],status:'active',...(body.variants?{}:{price_minor:1000}),...body});
  assert.equal((await mk({title:'Wallet',sku:'k 395 a',inventory:20})).status,201);
  await mk({title:'Backpack',sku:'BAD 40107 F',inventory:0});
  const ch=await mk({title:'Card Holder',option_names:['Color'],variants:[{option_values:['Brown'],sku:'CH-BRN',price_minor:1000,inventory:4},{option_values:['Black'],sku:'CH-BLK',price_minor:1000,inventory:5}]});
  assert.equal(ch.status,201,JSON.stringify(ch.body));
  const old=await mk({title:'Old Bag',sku:'GONE-1',inventory:6,status:'archived'});assert.equal(old.status,201,JSON.stringify(old.body));
  assert.equal((await h.request('inventory/pos-sync','POST',{step:'read',page:1,page_size:500},'viewer')).status,403,'viewers cannot read');
  assert.equal((await h.sync({dry_run:true},'viewer')).status,403,'viewers cannot sync');
  assert.equal((await h.request('inventory/pos-sync','GET')).status,405);
  assert.equal((await h.request('inventory/pos-sync','POST',{dry_run:true})).status,400,'rows are required');
  assert.equal((await h.sync({dry_run:'yes'})).status,400);
  assert.equal((await h.sync({force:true})).status,400);
  assert.equal((await h.request('inventory/pos-sync','POST',{rows:[{s:1,q:'x'}]})).status,400);

  let r=(await h.sync({dry_run:true})).body;
  assert.equal(r.dry_run,true);assert.equal(r.matched,3);assert.equal(r.changed,2);assert.equal(r.unchanged,1,'CH-BLK already 5');
  assert.deepEqual(r.changes.map(x=>[x.sku,x.before,x.after]).sort(),[['BAD 40107 F',0,2],['k 395 a',20,7]]);
  assert.deepEqual(r.matches.map(m=>[m.sku,m.stock_code,m.colour,m.qty]),[['BAD 40107 F','BAG-BAD40107','F',2],['CH-BLK','CH','BLK',5],['k 395 a','WAL-K395','A',7]]);
  assert.deepEqual(r.changes.find(x=>x.sku==='k 395 a').stock_code,'WAL-K395');
  assert.deepEqual(r.pos_only.items.map(p=>[p.stock_code,p.colour,p.qty]),[['ACC-NEWINPOS','A',9]]);
  assert.equal(r.pos.warehouse_filter,null);assert.equal(r.pos.counted_warehouses,2);
  assert.deepEqual(r.site_only.items.map(v=>v.sku),['CH-BRN'],'archived products are not listed');
  assert.equal(r.pos.stock_codes,4);assert.equal(r.pos.warehouses.length,2);assert.equal(r.pos.rows,5);assert.equal(r.pos.page_size,500);
  assert.equal(await stockOf(h.db,'k 395 a'),20,'check changed nothing');

  r=(await h.sync()).body;
  assert.equal(r.dry_run,false);assert.equal(r.changed,2);
  assert.equal(await stockOf(h.db,'k 395 a'),7);assert.equal(await stockOf(h.db,'BAD 40107 F'),2);assert.equal(await stockOf(h.db,'CH-BRN'),4,'missing SKUs untouched unless asked');
  assert.equal(await balanced(h.db),true);
  const ledger=(await h.db.query("SELECT reason,note,actor,delta FROM inventory_adjustments WHERE note LIKE 'POS sync%' ORDER BY id")).rows;
  assert.equal(ledger.length,2);assert.ok(ledger.every(l=>l.reason==='stocktake'&&l.actor==='editor'));assert.match(ledger.find(l=>l.delta===-13).note,/mPOS available 7/);
  const product=(await h.db.query("SELECT inventory FROM products WHERE title='Wallet'")).rows[0];assert.equal(product.inventory,7,'product summary follows');

  r=(await h.sync()).body;assert.equal(r.changed,0,'running again changes nothing');

  r=(await h.sync({zero_missing:true})).body;
  assert.equal(r.changed,1);assert.equal(await stockOf(h.db,'CH-BRN'),0);assert.equal(await stockOf(h.db,'GONE-1'),6,'archived product untouched');
  assert.match((await h.db.query("SELECT note FROM inventory_adjustments ORDER BY id DESC LIMIT 1")).rows[0].note,/not in the mPOS in-stock list/);
  assert.equal(await balanced(h.db),true);
 }finally{await h.close();}
});

test('Sync from POS: many pages are read one request each; a failing 500-row page falls back to 100; large row sets are accepted',async()=>{
 const rows=Array.from({length:1234},(_,i)=>row(i+1,'BULK-'+i,1+(i%2),3));
 const h=await harness(rows,{failSize:500});
 try{
  await h.request('products','POST',{title:'Bulk',status:'active',sku:'BULK-7',price_minor:100,inventory:1});
  const read=await h.readAll();
  assert.equal(read.page_size,100);assert.equal(read.rows.length,1234);assert.equal(read.pages,13);
  assert.deepEqual(h.state.calls.slice(0,2),[[1,500],[1,100]]);
  const r=await h.request('inventory/pos-sync','POST',{...read,dry_run:true});
  assert.equal(r.status,200,JSON.stringify(r.body).slice(0,200));
  assert.equal(r.body.pos.rows,1234);assert.equal(r.body.pos.page_size,100);assert.equal(r.body.pos.pages,13);
  assert.deepEqual(r.body.changes.map(c=>[c.sku,c.before,c.after]),[['BULK-7',1,3]]);
  assert.equal(r.body.pos_only.total,1233);
 }finally{await h.close();}
});

test('Sync from POS: with MPOS_WAREHOUSE_ID only the chosen warehouses count; the rest are listed, not added',async()=>{
 const h=await harness([col(1,'BAG-BAD40107',1,3,'F'),col(2,'BAG-BAD40107',2,40,'F'),col(3,'BAG-BAD40107',3,500,'F')],{posWarehouses:[1,2]});
 try{
  await h.request('products','POST',{title:'Backpack',status:'active',sku:'BAD 40107 F',price_minor:100,inventory:0});
  const r=(await h.sync({dry_run:true})).body;
  assert.deepEqual(r.changes.map(c=>[c.sku,c.after]),[['BAD 40107 F',43]],'3 + 40; warehouse 3 is not counted');
  assert.deepEqual(r.pos.warehouse_filter,[1,2]);assert.equal(r.pos.counted_warehouses,2);
  assert.deepEqual(r.pos.warehouses.map(w=>[w.id,w.counted]),[[1,true],[2,true],[3,false]]);
 }finally{await h.close();}
});

test('Sync from POS: units held by unpaid website orders are kept off, so an expired order returns them correctly',async()=>{
 const h=await harness([row(1,'W-1',1,5)]);
 try{
  const c=(await h.request('collections','POST',{title:'Shop',status:'active'})).body;
  const p=(await h.request('products','POST',{collection_ids:[String(c.id)],title:'Wallet',status:'active',sku:'W-1',price_minor:4500,inventory:3})).body;
  const variant=(await h.request('products/'+p.id)).body.variants[0];
  const co=await h.request('storefront/checkout','POST',{idempotency_key:randomUUID(),access_token:randomBytes(24).toString('base64url'),customer:{name:'Aisyah Rahman',email:'a@example.com',phone:'+60 12-345 6789',address_line1:'12 Jalan Klang',city:'Klang',postcode:'41000',state:'Selangor'},lines:[{variant_id:variant.id,quantity:2}]});
  assert.equal(co.status,201);assert.equal(await stockOf(h.db,'W-1'),1);
  const r=(await h.sync()).body;
  assert.deepEqual([r.changes[0].before,r.changes[0].after,r.changes[0].held],[1,3,2],'mPOS 5 minus 2 held');
  assert.match((await h.db.query("SELECT note FROM inventory_adjustments ORDER BY id DESC LIMIT 1")).rows[0].note,/2 held by unpaid orders/);
  await h.db.query("UPDATE orders SET expires_at=now()-interval '1 hour'");
  const {sweepExpired}=await import('../src/commerce.mjs');await sweepExpired({query:(q,a)=>h.db.query(q,a)});
  assert.equal(await stockOf(h.db,'W-1'),5,'after the order expires the website matches mPOS');
  assert.equal(await balanced(h.db),true);
 }finally{await h.close();}
});

test('Sync from POS: not configured and mPOS errors leave stock unchanged',async()=>{
 const db=new PGlite();const sql={query:(q,args)=>q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true)");await db.query('SET ROLE jackstudio_api');
 const saved=process.env.MPOS_API_KEY;delete process.env.MPOS_API_KEY;
 const failing={fetchPage:async()=>{const e=new Error('mPOS rejected the API key (HTTP 401). Check MPOS_API_KEY in Vercel. Nothing was changed.');e.status=502;throw e;}};
 const servers=[];
 const start=async opts=>{const s=createServer(handler({connect:async()=>({...sql,release(){}})},async sub=>({sub,aal:'aal2'}),{rateLimits:false,...opts}));servers.push(s);await new Promise(r=>s.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+s.address().port+'/api/v3/inventory/pos-sync';};
 const post=async url=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer editor'},body:JSON.stringify({step:'read',page:1,page_size:500})});return {status:r.status,body:await r.json()};};
 try{
  let r=await post(await start({}));assert.equal(r.status,503);assert.match(r.body.error,/MPOS_API_KEY/);
  r=await post(await start({pos:failing}));assert.equal(r.status,502);assert.match(r.body.error,/Nothing was changed/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM inventory_adjustments')).rows[0].n,0);
 }finally{if(saved!==undefined)process.env.MPOS_API_KEY=saved;for(const s of servers)await new Promise(r=>s.close(r));await db.close();}
});
