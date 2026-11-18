import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {SHOPIFY_CDN} from '../src/shopify-media.mjs';
import {renderPage} from '../src/liquid.mjs';
import {PAGE_TEMPLATES} from '../shared/page-templates.mjs';

const img=(id,name)=>({id,src:`${SHOPIFY_CDN}products/${name}?v=1`,alt:'Alt '+name});
function store(){
 const products=[
  {handle:'urban-sling',title:'Urban Sling',body_html:'<p>Soft leather.</p><script>x()</script>',tags:['cat-bag','Bag'],options:[{name:'Color',values:['Black','Brown']}],images:[img(1,'a.jpg'),img(2,'b.jpg')],
   variants:[{sku:'JWC20163A',price:'199.00',compare_at_price:'259.00',option1:'Black',featured_image:{id:2}},{sku:'JWC20163B',price:'199.00',compare_at_price:null,option1:'Brown'}]},
  {handle:'card-holder',title:'Card Holder',body_html:'',tags:['cat-wallet'],options:[{name:'Title',values:['Default Title']}],images:[img(3,'c.jpg')],variants:[{sku:'JWC20163A',price:'59.00',option1:'Default Title'}]},
  {handle:'Bad Handle',title:'Bad',tags:[],options:[],images:[],variants:[{sku:'X',price:'1'}]}
 ];
 const calls=[];
 return {calls,products,fetch:async path=>{calls.push(path);
  if(path.startsWith('/collections.json'))return {collections:[{handle:'urban-carry',title:'Urban Carry',body_html:'<b>Carry</b>'},{handle:'bad handle',title:'X'}]};
  const m=path.match(/^\/products\.json\?limit=(\d+)&page=(\d+)/);if(m){const n=+m[1],p=+m[2];return {products:products.slice((p-1)*n,p*n)};}
  if(path.startsWith('/collections/urban-carry/products.json'))return {products:[{handle:'urban-sling'},{handle:'card-holder'},{handle:'gone'}]};
  throw Error('unexpected '+path);}};
}
async function harness(options={}){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");await db.query('SET ROLE jackstudio_api');
 const uploads=[],s=store();
 const cloud={preview:m=>'https://api.cloudinary.com/p/'+m.id,importRemote:async(url,public_id)=>{uploads.push(url);return {public_id,resource_type:'image',type:'authenticated',asset_id:'a'+uploads.length,version:1,format:'jpg',bytes:1000,width:800,height:800};}};
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{cloud,storeJson:s.fetch,...options}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const post=async(body,token='editor')=>{const r=await fetch(base+'catalog/import',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 return {db,sql,post,uploads,s,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}

test('catalogue import: collections, products with variants, tags, prices, images, stock and memberships; re-runs update',async()=>{
 const h=await harness();
 try{
  assert.equal((await h.post({step:'collections'},'viewer')).status,403);
  const cols=await h.post({step:'collections'});assert.equal(cols.status,200);assert.deepEqual(cols.body.handles,['urban-carry']);assert.equal(cols.body.items[1].status,'skipped');
  const im=await h.post({step:'images',page:1});assert.equal(im.status,200);assert.equal(im.body.imported,3);assert.equal(im.body.remaining,0);
  assert.equal((await h.post({step:'images',page:1})).body.imported,0,'images already in the library are not fetched again');
  let r=await h.post({step:'products',page:1});assert.equal(r.status,200);assert.equal(r.body.done,true);
  const by=Object.fromEntries(r.body.items.map(i=>[i.handle,i]));
  assert.equal(by['urban-sling'].status,'imported');assert.equal(by['card-holder'].status,'imported');assert.equal(by['Bad Handle'].status,'skipped');
  await h.db.query('RESET ROLE');
  const p=(await h.db.query("SELECT * FROM products WHERE handle='urban-sling'")).rows[0];
  assert.deepEqual(p.tags,['cat-bag','Bag']);assert.equal(p.status,'active');assert.equal(p.description,'<p>Soft leather.</p>','scripts removed from descriptions');assert.deepEqual(p.option_names,['Color']);
  const vs=(await h.db.query('SELECT * FROM product_variants WHERE product_id=$1 ORDER BY position',[p.id])).rows;
  assert.deepEqual(vs.map(v=>[v.option_values[0],v.sku,v.price_minor,v.compare_at_minor,v.inventory]),[['Black','JWC20163A',19900,25900,37],['Brown','JWC20163B',19900,null,29]],'stock from the dated Shopify snapshot');
  const media=(await h.db.query('SELECT m.label,m.object_key FROM product_media pm JOIN media m ON m.id=pm.media_id WHERE pm.product_id=$1 ORDER BY pm.position',[p.id])).rows;
  assert.deepEqual(media.map(m=>m.label),['a.jpg','b.jpg']);assert.ok(vs[0].media_id,'variant image linked');
  const card=(await h.db.query("SELECT v.* FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.handle='card-holder'")).rows;
  assert.equal(card.length,1);assert.deepEqual(card[0].option_values,[]);assert.equal(card[0].sku,null,'duplicate Shopify SKU left empty');
  await h.db.query('SET ROLE jackstudio_api');
  const m=await h.post({step:'memberships',handle:'urban-carry'});assert.equal(m.body.linked,2);assert.equal(m.body.missing,1);
  // Re-run: Shopify changed a price and removed a colour; nothing is duplicated, stock is kept.
  h.s.products[0].variants=[{sku:'JWC20163A',price:'179.00',option1:'Black'}];
  r=await h.post({step:'products',page:1});assert.equal(r.body.items[0].status,'updated');
  await h.db.query('RESET ROLE');
  assert.equal((await h.db.query("SELECT count(*)::int n FROM products")).rows[0].n,2);
  const after=(await h.db.query("SELECT v.option_values,v.price_minor,v.active,v.inventory FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.handle='urban-sling' ORDER BY v.position")).rows;
  assert.deepEqual(after.map(v=>[v.option_values[0],v.price_minor,v.active,v.inventory]),[['Black',17900,true,37],['Brown',19900,false,29]]);
  assert.equal(h.uploads.length,3,'images are imported once');
  // Verification compares every field with the store and lists differences.
  await h.db.query('SET ROLE jackstudio_api');
  const v=(await h.post({step:'verify'})).body;
  assert.equal(v.shopify,3);assert.equal(v.matched,1,'urban-sling matches after the update');
  assert.ok(v.issues.some(i=>i.handle==='Bad Handle'&&/Missing/.test(i.problem)));assert.ok(v.issues.some(i=>i.handle==='card-holder'&&/SKU/.test(i.problem)));
  assert.deepEqual(v.collections,[{handle:'urban-carry',shopify:3,v3:2}]);assert.ok(v.issues.some(i=>i.handle==='bad handle'));
  await h.db.query('RESET ROLE');
  // The theme's series shelves and best sellers see the products by collection and tag.
  const page=await renderPage(h.sql,'product-collection',PAGE_TEMPLATES['product-collection']);
  assert.match(page.html,/Urban Sling/);
 }finally{await h.close();}
});

test('catalogue import: a slow page continues where it stopped instead of timing out',async()=>{
 const h=await harness({importBudget:0});
 try{
  await h.post({step:'collections'});await h.post({step:'images',page:1});
  // Budget 0: one product per request, then next_offset says where to continue.
  let r=await h.post({step:'products',page:1});
  assert.deepEqual([r.body.items.length,r.body.next_offset,r.body.done],[1,1,false]);
  r=await h.post({step:'products',page:1,offset:1});assert.deepEqual([r.body.items.length,r.body.next_offset,r.body.done],[1,2,false]);
  r=await h.post({step:'products',page:1,offset:2});assert.deepEqual([r.body.items.length,r.body.next_offset,r.body.done],[1,null,true]);
  assert.equal(r.body.items[0].status,'skipped');
  assert.equal((await h.post({step:'products',page:1,offset:6})).status,400);
  assert.equal(Number((await h.sql.query("SELECT count(*) AS n FROM products")).rows[0].n),2);
 }finally{await h.close();}
});
