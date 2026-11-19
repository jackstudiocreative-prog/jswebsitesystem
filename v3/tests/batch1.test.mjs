import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {testGateway} from '../src/payments.mjs';
import {personalizationConfig,engravingError,normalizeEngraving} from '../shared/personalization.mjs';

const gateway=testGateway({provider:'mock',serviceId:'JSMOCK',password:'s'.repeat(40),actionUrl:'https://pay.test/mock',baseUrl:'https://shop.test'});
async function harness(){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");await db.query('SET ROLE jackstudio_api');
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{payments:gateway,rateLimits:false}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 const shop=(await request('collections','POST',{title:'Shop',status:'active'})).body;
 return {db,request,shop,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
const customer={name:'Aisyah Rahman',email:'aisyah@example.com',phone:'+60 12-345 6789',address_line1:'12 Jalan Klang',city:'Klang',postcode:'41000',state:'Selangor'};
const checkoutBody=lines=>({idempotency_key:randomUUID(),access_token:randomBytes(24).toString('base64url'),customer,lines});
const ENGRAVE={enabled:true,required:true,label:'Engraving',max_length:5,charset:'upper_alnum',help:'Free'};

test('engraving rules: config validation, normalisation and errors',()=>{
 assert.equal(personalizationConfig({enabled:false}),null);
 assert.throws(()=>personalizationConfig({enabled:true,max_length:0}),/1–40/);
 assert.throws(()=>personalizationConfig({enabled:true,charset:'emoji'}),/character rule/);
 const c=personalizationConfig(ENGRAVE);
 assert.equal(normalizeEngraving(c,'  jack8 '),'JACK8');
 assert.equal(engravingError(c,'1',''),'Engraving is required for this item.');
 assert.match(engravingError(c,'1','JACKIE'),/up to 5/);
 assert.match(engravingError(c,'1','JA K'),/Capital letters/);
 assert.equal(engravingError(c,'1','JACK8'),null);
 const limited=personalizationConfig({...ENGRAVE,variant_ids:['2']});
 assert.equal(engravingError(limited,'1','JACK'),'This item cannot be engraved.');
 assert.equal(engravingError(limited,'1',''),null);
});

test('engraving: product setting, bag lines, checkout and order lines; different text never merges',async()=>{
 const h=await harness();
 try{
  const p=(await h.request('products','POST',{title:'Card Holder',status:'active',collection_ids:[String(h.shop.id)],sku:'CH-1',price_minor:5900,inventory:3,personalization:ENGRAVE})).body;
  assert.equal(p.personalization.max_length,5);
  const v=(await h.request('products/'+p.id)).body.variants[0].id;
  // Invalid settings are refused.
  assert.equal((await h.request('products/'+p.id,'PATCH',{revision:p.revision,personalization:{enabled:true,max_length:99}})).status,400);
  // Public product carries the rule, not the internal variant list format.
  const pub=(await h.request('storefront/products/card-holder','GET',undefined,null)).body.product;
  assert.deepEqual([pub.engraving.label,pub.engraving.required,pub.engraving.max_length],['Engraving',true,5]);
  assert.match(pub.engraving.rule,/Capital letters/);

  // Bag: missing engraving reported per line (not silently accepted); lowercase normalised; same text merged.
  let q=(await h.request('storefront/cart','POST',{lines:[{variant_id:v,quantity:1}]},null)).body;
  assert.equal(q.lines[0].available,false);assert.match(q.lines[0].engraving_error,/required/);
  q=(await h.request('storefront/cart','POST',{lines:[{variant_id:v,quantity:1,engraving:'jack8'},{variant_id:v,quantity:1,engraving:'JACK8'},{variant_id:v,quantity:1,engraving:'AMY'}]},null)).body;
  assert.deepEqual(q.lines.map(l=>[l.engraving,l.quantity,l.available]),[['JACK8',2,true],['AMY',1,true]]);
  assert.equal(q.subtotal_minor,3*5900,'engraving does not change the price');
  // Stock is checked across lines of the same variant (3 in stock).
  q=(await h.request('storefront/cart','POST',{lines:[{variant_id:v,quantity:2,engraving:'A'},{variant_id:v,quantity:2,engraving:'B'}]},null)).body;
  assert.deepEqual(q.lines.map(l=>l.available),[false,false]);

  // Checkout refuses a missing or invalid engraving; accepts two different engravings as two lines.
  assert.equal((await h.request('storefront/checkout','POST',checkoutBody([{variant_id:v,quantity:1}]),null)).status,400);
  assert.equal((await h.request('storefront/checkout','POST',checkoutBody([{variant_id:v,quantity:1,engraving:'TOO LONG'}]),null)).status,400);
  const created=await h.request('storefront/checkout','POST',checkoutBody([{variant_id:v,quantity:1,engraving:'jack8'},{variant_id:v,quantity:1,engraving:'AMY'}]),null);
  assert.equal(created.status,201,JSON.stringify(created.body));
  assert.deepEqual(created.body.order.lines.map(l=>[l.personalization,l.quantity]),[['JACK8',1],['AMY',1]]);
  const orders=(await h.request('orders?paged=true')).body.items;
  const detail=(await h.request('orders/'+orders[0].id)).body;
  assert.deepEqual(detail.lines.map(l=>l.personalization),['JACK8','AMY']);
  assert.equal((await h.request('inventory?q=CH-1')).body.items[0].inventory,1,'both lines reserved stock');
  // Switching engraving off.
  const fresh=(await h.request('products/'+p.id)).body;
  assert.equal((await h.request('products/'+p.id,'PATCH',{revision:fresh.revision,personalization:{enabled:false}})).body.personalization,null);
  q=(await h.request('storefront/cart','POST',{lines:[{variant_id:v,quantity:1,engraving:'AMY'}]},null)).body;
  assert.match(q.lines[0].engraving_error,/cannot be engraved/);
 }finally{await h.close();}
});

test('prices: compare-at belongs to the same variant as the price shown',async()=>{
 const h=await harness();
 try{
  const p=(await h.request('products','POST',{title:'Tote',status:'active',collection_ids:[String(h.shop.id)],option_names:['Size'],variants:[
   {option_values:['S'],sku:'T-S',price_minor:10000,compare_at_minor:15000,inventory:1,active:true},
   {option_values:['L'],sku:'T-L',price_minor:20000,compare_at_minor:40000,inventory:1,active:true}]})).body;
  assert.ok(p.id);
  const card=(await h.request('storefront/collections/all','GET',undefined,null)).body.products.find(x=>x.handle==='tote');
  assert.deepEqual([card.price_min,card.price_max,card.compare_at_minor],[10000,20000,15000]);
  // Cheapest variant without a sale: no "was" price on the card even if another variant is on sale.
  const d=(await h.request('products/'+p.id)).body;
  await h.request('products/'+p.id,'PATCH',{revision:d.revision,option_names:['Size'],variants:d.variants.map(v=>({id:v.id,option_values:v.option_values,sku:v.sku,price_minor:v.price_minor,compare_at_minor:v.option_values[0]==='S'?null:40000,active:true}))});
  const card2=(await h.request('storefront/collections/all','GET',undefined,null)).body.products.find(x=>x.handle==='tote');
  assert.equal(card2.compare_at_minor,null);
 }finally{await h.close();}
});

test('featured order is the manual collection order; newest is different; membership keeps its place',async()=>{
 const h=await harness();
 try{
  const ids=[];for(const t of ['Alpha','Bravo','Charlie'])ids.push((await h.request('products','POST',{title:t,status:'active',collection_ids:[String(h.shop.id)],sku:'S-'+t,price_minor:1000,inventory:1})).body.id);
  const handles=async sort=>(await h.request(`storefront/collections/shop${sort?'?sort='+sort:''}`,'GET',undefined,null)).body.products.map(p=>p.handle);
  assert.deepEqual(await handles('newest'),['charlie','bravo','alpha']);
  assert.deepEqual(await handles(),['alpha','bravo','charlie'],'featured: order the products were added to the collection');
  let c=(await h.request('collections/'+h.shop.id)).body;
  assert.equal(c.manual_order,true);assert.deepEqual(c.products.map(p=>p.title),['Alpha','Bravo','Charlie']);
  assert.equal((await h.request('collections/'+h.shop.id,'PATCH',{revision:c.revision,product_order:['999']})).status,400);
  assert.equal((await h.request('collections/'+h.shop.id,'PATCH',{revision:c.revision,product_order:[String(ids[2]),String(ids[0])]})).status,200);
  assert.deepEqual(await handles(),['charlie','alpha','bravo']);
  assert.deepEqual(await handles('newest'),['charlie','bravo','alpha']);
  // Editing a product does not move it in collections it stays in.
  const a=(await h.request('products/'+ids[0])).body;
  await h.request('products/'+ids[0],'PATCH',{revision:a.revision,title:'Alpha 2',collection_ids:[String(h.shop.id)]});
  assert.deepEqual((await handles()).slice(0,2),['charlie','alpha']);
  // Viewer cannot reorder.
  c=(await h.request('collections/'+h.shop.id)).body;
  assert.equal((await h.request('collections/'+h.shop.id,'PATCH',{revision:c.revision,product_order:[String(ids[1])]},'viewer')).status,403);
 }finally{await h.close();}
});

test('dashboard: product and variant counts are labelled and match the filtered lists',async()=>{
 const h=await harness();
 try{
  await h.request('products','POST',{title:'Bag',status:'active',collection_ids:[String(h.shop.id)],option_names:['Color'],variants:[
   {option_values:['Brown'],sku:'B-1',price_minor:1000,inventory:0,active:true},{option_values:['Black'],sku:'B-2',price_minor:1000,inventory:2,active:true},{option_values:['Tan'],sku:'B-3',price_minor:1000,inventory:1,active:true}]});
  await h.request('products','POST',{title:'Belt',status:'active',collection_ids:[String(h.shop.id)],sku:'BE-1',price_minor:1000,inventory:0});
  await h.request('products','POST',{title:'Hidden',status:'active',sku:'H-1',price_minor:1000,inventory:9});
  const d=(await h.request('dashboard')).body;
  assert.deepEqual([d.low_stock,d.products_low_stock,d.out_of_stock,d.products_out_of_stock,d.active_unlisted,d.low_stock_at],[2,1,2,1,1,5]);
  assert.equal((await h.request('inventory?paged=true&stock=low')).body.total,d.low_stock);
  assert.equal((await h.request('inventory?paged=true&stock=out')).body.total,d.out_of_stock);
  const hidden=(await h.request('products?paged=true&listed=no')).body;
  assert.deepEqual([hidden.total,hidden.items[0].title,hidden.items[0].listed],[1,'Hidden',false]);
  assert.equal((await h.request('products?paged=true&listed=maybe')).status,400);
  assert.equal(d.live_themes,0);
 }finally{await h.close();}
});
