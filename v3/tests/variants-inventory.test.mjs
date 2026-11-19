import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {cleanLabel} from '../src/media.mjs';

async function harness(){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");
 await db.query("INSERT INTO media(object_key,mime,bytes,state,created_by,format,label) VALUES ('p/1','image/png',100,'ready','editor','png','brown-front.png'),('p/2','image/jpeg',100,'ready','editor','jpg','black-front.jpg'),('p/3','image/webp',100,'ready','editor','webp','detail.webp'),('p/4','image/png',100,'pending','editor','png','pending.png')");
 await db.query('SET ROLE jackstudio_api');
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{cloud:{preview:m=>'https://api.cloudinary.com/private/'+m.id}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 return {db,request,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
const ledgerBalanced=async db=>(await db.query('SELECT bool_and(v.inventory=coalesce((SELECT sum(delta) FROM inventory_adjustments a WHERE a.variant_id=v.id),0)) AS ok FROM product_variants v')).rows[0].ok;

test('variants keep independent SKU, MYR price and stock; edits are validated and summary stays in sync',async()=>{
 const {db,request,close}=await harness();
 try{
  const created=await request('products','POST',{title:'Card Holder',option_names:['Color'],media:[{media_id:'1',alt:'Brown'},{media_id:'2',alt:'Black'}],variants:[{option_values:['Brown'],sku:'CH-BRN',price_minor:12990,inventory:5,media_id:'1'},{option_values:['Black'],sku:'CH-BLK',price_minor:13990,inventory:0,media_id:'2'}]});
  assert.equal(created.status,201);const id=created.body.id;
  assert.equal(created.body.price_minor,12990);assert.equal(created.body.inventory,5);assert.equal(created.body.sku,'CH-BRN');
  let p=(await request('products/'+id)).body;
  assert.deepEqual(p.option_names,['Color']);assert.equal(p.variants.length,2);
  const [brown,black]=p.variants;assert.deepEqual(brown.option_values,['Brown']);assert.equal(brown.stock_status,'low');assert.equal(black.stock_status,'out');assert.equal(black.media_id,'2');
  assert.equal(p.featured_media_id,'1');assert.equal(p.media[1].label,'black-front.jpg');
  const ledger=(await request('inventory/adjustments?product='+id)).body;assert.equal(ledger.total,1);assert.equal(ledger.items[0].reason,'initial');assert.equal(ledger.items[0].actor,'editor');
  const keep=[{id:brown.id,option_values:['Brown'],sku:'CH-BRN',price_minor:12990,media_id:'1'},{id:black.id,option_values:['Black'],sku:'CH-BLK',price_minor:13990,media_id:'2'}];
  const patch=async(body,rev=p.revision)=>request('products/'+id,'PATCH',{revision:rev,...body});
  for(const [body,message] of [
   [{variants:[keep[0]]},/Deactivate/],
   [{variants:[keep[0],{...keep[1],option_values:['brown']}]},/different option combination/],
   [{variants:[keep[0],{...keep[1],option_values:[]}]},/option value/],
   [{variants:[keep[0],{...keep[1],inventory:9}]},/inventory adjustment/],
   [{variants:[keep[0],{...keep[1],media_id:'3'}]},/product images/],
   [{variants:[keep[0],{...keep[1],price_minor:1.5}]},/Price/],
   [{price_minor:100},/per variant/],
   [{option_names:['Color','Size']},/full variant list/],
   [{option_names:[],variants:[{...keep[0],option_values:[]},{...keep[1],option_values:[]}]},/Add an option/],
   [{variants:[...keep,{option_values:['Tan'],sku:'ch-brn'}]},null]
  ]){const r=await patch(body);if(message){assert.equal(r.status,400,JSON.stringify(body));assert.match(r.body.error,message);}else assert.equal(r.status,409);}
  assert.equal((await request('products/'+id)).body.revision,p.revision,'failed edits roll back');
  // Swap SKUs between variants in one save, add a size option to both and a new inactive variant.
  let r=await patch({option_names:['Color','Size'],variants:[{...keep[0],option_values:['Brown','Small'],sku:'CH-BLK'},{...keep[1],option_values:['Black','Small'],sku:'CH-BRN'},{option_values:['Brown','Large'],sku:'CH-BRN-L',price_minor:15990,inventory:2,active:false}]});
  assert.equal(r.status,200,JSON.stringify(r.body));p=(await request('products/'+id)).body;
  assert.deepEqual(p.variants.map(v=>[v.sku,v.option_values.join('/'),v.inventory,v.active]),[['CH-BLK','Brown/Small',5,true],['CH-BRN','Black/Small',0,true],['CH-BRN-L','Brown/Large',2,false]]);
  assert.equal(p.inventory,5,'inactive stock excluded from summary');assert.equal(p.price_minor,12990);
  assert.equal((await request('products','POST',{title:'Other',sku:'ch-brn-l'})).status,409,'SKU unique across all variants');
  assert.equal((await request('products/'+id,'PATCH',{revision:p.revision,title:'X'},'viewer')).status,403);
  assert.ok(await ledgerBalanced(db));
 }finally{await close();}
});

test('inventory adjustments are transactional, attributed, never negative and cannot be bypassed',async()=>{
 const {db,request,close}=await harness();
 try{
  const p=(await request('products','POST',{title:'Weekender',sku:'WK-1',price_minor:59900,inventory:5})).body;
  const v=(await request('products/'+p.id)).body.variants[0];
  const adjust=(body,token)=>request('inventory/adjustments','POST',{variant_id:v.id,...body},token);
  let r=await adjust({delta:-2,reason:'damaged',note:'Scuffed corner'});assert.equal(r.status,201);
  assert.equal(r.body.adjustment.quantity_before,5);assert.equal(r.body.adjustment.quantity_after,3);assert.equal(r.body.variant.inventory,3);assert.equal(r.body.variant.stock_status,'low');
  r=await adjust({delta:-10,reason:'correction'});assert.equal(r.status,409);assert.match(r.body.error,/below zero/);
  assert.equal((await adjust({set_to:8,expected:5,reason:'stocktake'})).status,409,'stale count rejected');
  assert.equal((await adjust({set_to:8,reason:'stocktake'})).status,400,'count requires expected quantity');
  r=await adjust({set_to:8,expected:3,reason:'stocktake'});assert.equal(r.status,201);assert.equal(r.body.adjustment.delta,5);
  for(const body of [{delta:1,reason:'sold'},{delta:1,reason:'other'},{delta:0,reason:'received'},{delta:1.5,reason:'received'},{delta:1,set_to:2,reason:'received',expected:8},{reason:'received'},{delta:1,reason:'received',extra:1}])assert.equal((await adjust(body)).status,400,JSON.stringify(body));
  assert.equal((await adjust({delta:1,reason:'received'},'viewer')).status,403);
  assert.equal((await request('inventory/adjustments','POST',{variant_id:'999',delta:1,reason:'received'})).status,404);
  assert.equal((await request('products/'+p.id)).body.inventory,8,'summary synced');
  // Legacy single-SKU form edits still work and are recorded in the ledger as corrections.
  const current=(await request('products/'+p.id)).body;
  assert.equal((await request('products/'+p.id,'PATCH',{revision:current.revision,inventory:6,price_minor:61900})).status,200);
  const history=(await request('inventory/adjustments?paged=true&variant='+v.id,'GET',undefined,'viewer')).body;
  assert.deepEqual(history.items.map(a=>[a.reason,a.delta,a.quantity_after]),[['correction',-2,6],['stocktake',5,8],['damaged',-2,3],['initial',5,5]]);
  assert.equal(history.items[2].note,'Scuffed corner');assert.equal(history.items[0].actor,'editor');assert.equal(history.items[0].actor_role,'editor');
  const listed=(await request('inventory?stock=in')).body;assert.equal(listed.total,1);assert.equal(listed.items[0].product_title,'Weekender');
  assert.equal((await request('inventory?stock=low')).body.total,0);
  const d=(await request('dashboard')).body;assert.equal(d.variants,1);assert.equal(d.low_stock,0);assert.equal(d.out_of_stock,0);
  for(const path of ['inventory/1','inventory/adjustments/1'])assert.equal((await request(path)).status,405);
  assert.equal((await request('inventory','POST',{})).status,405);
  // The API role cannot edit stock or history outside the ledger, even with raw SQL.
  await assert.rejects(db.query('UPDATE product_variants SET inventory=99 WHERE id=$1',[v.id]),e=>e.code==='23514');
  await assert.rejects(db.query('UPDATE inventory_adjustments SET delta=1'),e=>e.code==='42501');
  await assert.rejects(db.query('DELETE FROM inventory_adjustments'),e=>e.code==='42501');
  await assert.rejects(db.query('DELETE FROM product_variants'),e=>e.code==='42501');
  assert.ok(await ledgerBalanced(db));
 }finally{await close();}
});

test('featured image, gallery order and media picker search, filters, paging and batch previews',async()=>{
 const {request,close}=await harness();
 try{
  let r=await request('products','POST',{title:'Tote',media:[{media_id:'3',alt:'Detail'},{media_id:'1',alt:'Front'}],featured_media_id:'1'});assert.equal(r.status,201);
  const id=r.body.id;let p=(await request('products/'+id)).body;assert.equal(p.featured_media_id,'1');assert.deepEqual(p.media.map(m=>String(m.media_id)),['3','1']);
  assert.equal((await request('products/'+id,'PATCH',{revision:p.revision,featured_media_id:'2'})).status,400);
  assert.equal((await request('products/'+id,'PATCH',{revision:p.revision,media:[{media_id:'3',alt:'Detail'}]})).status,200);
  p=(await request('products/'+id)).body;assert.equal(p.featured_media_id,'3','removed featured falls back to first image');
  const media=q=>request('media?paged=true&status=ready&limit=2&'+q);
  assert.equal((await media('q=front')).body.total,2);
  assert.equal((await media('format=jpg')).body.items[0].label,'black-front.jpg');
  assert.equal((await media('usage=unused')).body.total,2);assert.equal((await media('usage=linked')).body.total,1);
  const page=(await media('offset=2')).body;assert.equal(page.total,3);assert.equal(page.items.length,1);
  for(const q of ['format=gif','usage=all'])assert.equal((await media(q)).status,400);
  const shots=(await request('media/previews?ids=1,2,4','GET',undefined,'viewer')).body;assert.deepEqual(shots.items.map(x=>x.id).sort(),['1','2']);assert.equal(shots.expiresIn,300);
  assert.equal((await request('media/previews?ids='+Array.from({length:51},(_,i)=>i+1).join(','))).status,400);
  assert.equal((await request('media/previews?ids=1','GET',undefined,'unknown')).status,403);
  assert.equal((await request('media/previews','POST',{})).status,405);
 }finally{await close();}
});

test('upload labels strip paths and control characters',()=>{
 assert.equal(cleanLabel('C:\\fakepath\\Wallet Brown.JPG'),'Wallet Brown.JPG');assert.equal(cleanLabel('../a/b\u0000c.png'),'bc.png');assert.equal(cleanLabel(undefined),'');assert.equal(cleanLabel('x'.repeat(300)).length,120);
});

test('005 converts existing products to default variants without losing SKU, price, stock or images',async()=>{
 const db=new PGlite();try{
  await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
  for(const file of ['001_foundation.sql','002_staff_isolation.sql','003_cloudinary.sql','004_catalog_admin.sql'])await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  await db.exec("INSERT INTO staff VALUES ('owner','admin',true); INSERT INTO products(title,handle,sku,price_minor,inventory) VALUES ('Wallet','wallet','WAL-1',12990,7),('Draft','draft',NULL,0,0); INSERT INTO media(object_key,mime,bytes,state,created_by) VALUES ('jackstudio/products/abc','image/png',10,'ready','owner'); INSERT INTO product_media VALUES(1,1,0,'Front');");
  await db.exec(await readFile(new URL('../migrations/005_variants_inventory.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.query('SELECT product_id,sku,price_minor,inventory,option_values,active FROM product_variants ORDER BY id')).rows,[{product_id:1,sku:'WAL-1',price_minor:12990,inventory:7,option_values:[],active:true},{product_id:2,sku:null,price_minor:0,inventory:0,option_values:[],active:true}]);
  assert.deepEqual((await db.query('SELECT sku,price_minor,inventory,featured_media_id FROM products ORDER BY id')).rows,[{sku:'WAL-1',price_minor:12990,inventory:7,featured_media_id:1},{sku:null,price_minor:0,inventory:0,featured_media_id:null}]);
  assert.deepEqual((await db.query('SELECT variant_id,delta,reason,actor FROM inventory_adjustments')).rows,[{variant_id:1,delta:7,reason:'migration',actor:null}]);
  assert.equal((await db.query('SELECT alt FROM product_media')).rows[0].alt,'Front');assert.equal((await db.query('SELECT label FROM media')).rows[0].label,'abc');
  assert.ok(await ledgerBalanced(db));
  for(const role of ['anon','authenticated'])for(const table of ['product_variants','inventory_adjustments'])assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT') AS allowed",[role,table])).rows[0].allowed,false);
  for(const [table,priv,allowed] of [['product_variants','UPDATE',true],['product_variants','DELETE',false],['inventory_adjustments','INSERT',true],['inventory_adjustments','UPDATE',false],['inventory_adjustments','DELETE',false]])assert.equal((await db.query("SELECT has_table_privilege('jackstudio_api',$1,$2) AS allowed",[table,priv])).rows[0].allowed,allowed,table+' '+priv);
  assert.deepEqual((await db.query("SELECT relname FROM pg_class WHERE relname IN ('product_variants','inventory_adjustments') AND relrowsecurity ORDER BY relname")).rows.map(r=>r.relname),['inventory_adjustments','product_variants']);
 }finally{await db.close();}
});
