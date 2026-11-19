import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {testGateway} from '../src/payments.mjs';
import {aggregate,matchSkus,skuKey,compactKey,posClientFromEnv,POS_PAGE_SIZE} from '../src/pos-stock.mjs';

// Shape of GET /api/stock-warehouse rows (swagger StockWarehouseBalanceResponse), trimmed.
const row=(id,stockCode,warehouseId,qtyAvailable,extra={})=>({id,stockMasterId:id,warehouseId,warehouseCode:'W'+warehouseId,warehouseName:warehouseId===1?'HQ':'Mid Valley',stockCode,description:'Item '+stockCode,colour:'Brown',qtyOnHand:qtyAvailable,qtyAvailable,isActive:true,...extra});

test('SKU keys: case and repeated spaces ignored; compact key also drops dashes, dots and slashes',()=>{
 assert.equal(skuKey('  BAD 30516  B '),'bad 30516 b');
 assert.equal(compactKey('BAD 40107-F'),'bad40107f');
 assert.equal(compactKey('bad.40107/f'),'bad40107f');
 assert.equal(skuKey(null),'');
});

test('aggregate: sums every warehouse per stock code, never below 0, whole units only',()=>{
 const {codes,warehouses,blank,rounded}=aggregate([row(1,'K 395 A',1,3),row(2,'k 395 a',2,4),row(3,'JWB-1',1,-2),row(4,'JWB-1',2,1),row(5,'',1,9),row(6,'X1',1,2.6),row(7,'Y1',1,null)]);
 assert.equal(codes.get('k 395 a').qty,7);assert.equal(codes.get('k 395 a').rows,2);
 assert.equal(codes.get('jwb-1').qty,0,'-2 + 1 is clamped to 0');
 assert.equal(codes.get('x1').qty,2);assert.equal(codes.get('y1').qty,0);
 assert.equal(blank,1);assert.equal(rounded,2);
 assert.deepEqual(warehouses.map(w=>[w.name,w.rows]),[['HQ',4],['Mid Valley',2]],'rows without a stock code are not counted');
});

test('matchSkus: exact first, loose only when unique on both sides, ambiguous skipped, leftovers listed',()=>{
 const {codes}=aggregate([row(1,'BAD 40107 F',1,5),row(2,'BAD60303-F',1,2),row(3,'JWC 1-A',1,1),row(4,'JWC1A',1,1),row(5,'ONLY-POS',1,8),row(6,'jk 1',1,4)]);
 const v=(id,sku)=>({id:String(id),sku,active:true,product_status:'active'});
 const r=matchSkus(codes,[v(1,'bad 40107 f'),v(2,'BAD 60303 F'),v(3,'JWC-1A'),v(4,'ONLY-SITE'),v(5,null),v(6,'JK 1')]);
 assert.deepEqual(r.matched.map(m=>[m.variant.id,m.pos.stock_code,m.fuzzy]).sort(),[['1','BAD 40107 F',false],['2','BAD60303-F',true],['6','jk 1',false]]);
 assert.equal(r.ambiguous.length,1,'JWC-1A could be JWC 1-A or JWC1A');assert.match(r.ambiguous[0].sku,/JWC-1A/);
 assert.deepEqual(r.posOnly.map(p=>p.stock_code),['ONLY-POS']);
 assert.deepEqual(r.siteOnly.map(s=>s.sku),['ONLY-SITE'],'variants without SKU are not listed');
});

test('mPOS client: X-API-Key header, required filters, every page, and safe errors',async()=>{
 assert.equal(posClientFromEnv({}),null,'no key: not configured');
 assert.throws(()=>posClientFromEnv({MPOS_API_KEY:'k',MPOS_API_URL:'http://evil.test'}),/https/);
 assert.throws(()=>posClientFromEnv({MPOS_API_KEY:'k',MPOS_WAREHOUSE_ID:'abc'}),/warehouse/);
 const all=Array.from({length:1203},(_,i)=>row(i+1,'S'+i,1,1));const calls=[];
 const fake=async(url,init)=>{calls.push({url:new URL(url),key:init.headers['X-API-Key']});const u=new URL(url),page=Number(u.searchParams.get('page')),size=Number(u.searchParams.get('pageSize'));return Response.json({page,pageSize:size,totalCount:all.length,items:all.slice((page-1)*size,page*size)});};
 const client=posClientFromEnv({MPOS_API_KEY:'secret-key',MPOS_WAREHOUSE_ID:'3'},fake);
 const feed=await client.fetchStock();
 assert.equal(feed.rows.length,1203);assert.equal(feed.pages,3);
 assert.equal(calls[0].url.origin+calls[0].url.pathname,'https://api_jack.mpos-web.com/api/stock-warehouse');
 assert.deepEqual(Object.fromEntries(calls[0].url.searchParams),{inStockOnly:'true',isActive:'true',pageSize:String(POS_PAGE_SIZE),page:'1',warehouseId:'3'});
 assert.ok(calls.every(c=>c.key==='secret-key'));
 // A server that caps page size below 500 is still read to the end.
 const capped=posClientFromEnv({MPOS_API_KEY:'k'},async url=>{const page=Number(new URL(url).searchParams.get('page'));return Response.json({page,pageSize:100,totalCount:250,items:all.slice((page-1)*100,Math.min(page*100,250))});});
 assert.equal((await capped.fetchStock()).rows.length,250);
 // Paging that does not add up (e.g. 0-based pages) is an error, not a partial sync.
 const skipped=posClientFromEnv({MPOS_API_KEY:'k'},async url=>{const page=Number(new URL(url).searchParams.get('page'));const items=all.slice(page*500,(page+1)*500).slice(0,Math.max(0,1203-page*500));return Response.json({page,pageSize:500,totalCount:1203,items});});
 await assert.rejects(skipped.fetchStock(),e=>e.status===502&&/703 of 1203/.test(e.message));
 await assert.rejects(posClientFromEnv({MPOS_API_KEY:'secret-xyz-123'},async()=>new Response('no',{status:401})).fetchStock(),e=>e.status===502&&/API key/.test(e.message)&&!e.message.includes('secret-xyz-123'));
 await assert.rejects(posClientFromEnv({MPOS_API_KEY:'k'},async()=>new Response('<html>',{status:200})).fetchStock(),e=>e.status===502);
 await assert.rejects(posClientFromEnv({MPOS_API_KEY:'k'},async()=>{throw Object.assign(new Error('t'),{name:'TimeoutError'});}).fetchStock(),e=>e.status===504);
});

async function harness(feedRows){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");await db.query('SET ROLE jackstudio_api');
 const state={rows:feedRows,fetches:0};
 const pos={fetchStock:async()=>{state.fetches++;return {rows:state.rows,pages:1,total:state.rows.length};}};
 const gateway=testGateway({provider:'mock',serviceId:'JSMOCK',password:'p'.repeat(40),actionUrl:'https://pay.test',baseUrl:'https://shop.test'});
 const server=createServer(handler({connect:async()=>({...sql,release(){}})},async sub=>({sub,aal:'aal2'}),{payments:gateway,rateLimits:false,pos}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});const t=await r.text();let j;try{j=JSON.parse(t);}catch{j=t;}return {status:r.status,body:j};};
 return {db,request,state,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
const stockOf=async(db,sku)=>(await db.query('SELECT inventory FROM product_variants WHERE lower(sku)=lower($1)',[sku])).rows[0].inventory;
const balanced=async db=>(await db.query('SELECT bool_and(v.inventory=coalesce((SELECT sum(delta) FROM inventory_adjustments a WHERE a.variant_id=v.id),0)) AS ok FROM product_variants v')).rows[0].ok;

test('Sync from POS: preview changes nothing; apply sets stock, keeps the ledger balanced, lists both kinds of missing SKUs',async()=>{
 const h=await harness([row(1,'K 395 A',1,3),row(2,'K 395 A',2,4),row(3,'BAD 40107-F',1,2),row(4,'NEW-IN-POS',1,9),row(5,'CH-BLK',1,5)]);
 try{
  const c=(await h.request('collections','POST',{title:'Shop',status:'active'})).body;
  const mk=body=>h.request('products','POST',{collection_ids:[String(c.id)],status:'active',...(body.variants?{}:{price_minor:1000}),...body});
  assert.equal((await mk({title:'Wallet',sku:'k 395 a',inventory:20})).status,201);
  await mk({title:'Backpack',sku:'BAD 40107 F',inventory:0});
  const ch=await mk({title:'Card Holder',option_names:['Color'],variants:[{option_values:['Brown'],sku:'CH-BRN',price_minor:1000,inventory:4},{option_values:['Black'],sku:'CH-BLK',price_minor:1000,inventory:5}]});
  assert.equal(ch.status,201,JSON.stringify(ch.body));
  const old=await mk({title:'Old Bag',sku:'GONE-1',inventory:6,status:'archived'});assert.equal(old.status,201,JSON.stringify(old.body));
  assert.equal((await h.request('inventory/pos-sync','POST',{dry_run:true},'viewer')).status,403,'viewers cannot sync');
  assert.equal((await h.request('inventory/pos-sync','GET')).status,405);
  assert.equal((await h.request('inventory/pos-sync','POST',{dry_run:'yes'})).status,400);
  assert.equal((await h.request('inventory/pos-sync','POST',{force:true})).status,400);

  let r=(await h.request('inventory/pos-sync','POST',{dry_run:true})).body;
  assert.equal(r.dry_run,true);assert.equal(r.matched,3);assert.equal(r.changed,2);assert.equal(r.unchanged,1,'CH-BLK already 5');
  assert.deepEqual(r.changes.map(x=>[x.sku,x.before,x.after]).sort(),[['BAD 40107 F',0,2],['k 395 a',20,7]]);
  assert.deepEqual(r.fuzzy.map(f=>[f.sku,f.stock_code]),[['BAD 40107 F','BAD 40107-F']]);
  assert.deepEqual(r.pos_only.items.map(p=>[p.stock_code,p.qty]),[['NEW-IN-POS',9]]);
  assert.deepEqual(r.site_only.items.map(v=>v.sku),['CH-BRN'],'archived products are not listed');
  assert.equal(r.pos.stock_codes,4);assert.equal(r.pos.warehouses.length,2);
  assert.equal(await stockOf(h.db,'k 395 a'),20,'preview changed nothing');

  r=(await h.request('inventory/pos-sync','POST',{})).body;
  assert.equal(r.dry_run,false);assert.equal(r.changed,2);
  assert.equal(await stockOf(h.db,'k 395 a'),7);assert.equal(await stockOf(h.db,'BAD 40107 F'),2);assert.equal(await stockOf(h.db,'CH-BRN'),4,'missing SKUs untouched unless asked');
  assert.equal(await balanced(h.db),true);
  const ledger=(await h.db.query("SELECT reason,note,actor,delta FROM inventory_adjustments WHERE note LIKE 'POS sync%' ORDER BY id")).rows;
  assert.equal(ledger.length,2);assert.ok(ledger.every(l=>l.reason==='stocktake'&&l.actor==='editor'));assert.match(ledger.find(l=>l.delta===-13).note,/mPOS available 7/);
  const product=(await h.db.query("SELECT inventory FROM products WHERE title='Wallet'")).rows[0];assert.equal(product.inventory,7,'product summary follows');

  r=(await h.request('inventory/pos-sync','POST',{})).body;assert.equal(r.changed,0,'running again changes nothing');

  r=(await h.request('inventory/pos-sync','POST',{zero_missing:true})).body;
  assert.equal(r.changed,1);assert.equal(await stockOf(h.db,'CH-BRN'),0);assert.equal(await stockOf(h.db,'GONE-1'),6,'archived product untouched');
  assert.match((await h.db.query("SELECT note FROM inventory_adjustments ORDER BY id DESC LIMIT 1")).rows[0].note,/not in the mPOS in-stock list/);
  assert.equal(await balanced(h.db),true);
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
  const r=(await h.request('inventory/pos-sync','POST',{})).body;
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
 const failing={fetchStock:async()=>{const e=new Error('mPOS rejected the API key (HTTP 401). Check MPOS_API_KEY in Vercel. Nothing was changed.');e.status=502;throw e;}};
 const servers=[];
 const start=async opts=>{const s=createServer(handler({connect:async()=>({...sql,release(){}})},async sub=>({sub,aal:'aal2'}),{rateLimits:false,...opts}));servers.push(s);await new Promise(r=>s.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+s.address().port+'/api/v3/inventory/pos-sync';};
 const post=async url=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer editor'},body:'{}'});return {status:r.status,body:await r.json()};};
 try{
  let r=await post(await start({}));assert.equal(r.status,503);assert.match(r.body.error,/MPOS_API_KEY/);
  r=await post(await start({pos:failing}));assert.equal(r.status,502);assert.match(r.body.error,/Nothing was changed/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM inventory_adjustments')).rows[0].n,0);
 }finally{if(saved!==undefined)process.env.MPOS_API_KEY=saved;for(const s of servers)await new Promise(r=>s.close(r));await db.close();}
});
