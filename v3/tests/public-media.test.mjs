import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {PRESETS} from '../shared/theme-schema.mjs';
import {snapWidth,publicSrcset} from '../src/media-urls.mjs';

// Products: 1 listed (active, in an active collection); 2 draft; 3 active but only in a draft collection.
// Media: 1 featured of #1, 2 gallery of #1, 3 variant image of #1, 4 gallery of draft #2,
// 5 gallery of #3, 6 unlinked library image, 7 pending upload, 8 chosen in a theme.
async function harness({cloud}={}){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");
 for(let i=1;i<=8;i++)await db.query("INSERT INTO media(object_key,mime,bytes,state,created_by,format,label,width,height,version) VALUES ($1,'image/jpeg',100,$2,'editor','jpg',$3,1200,1200,7)",['jackstudio-websitesystem/products/m'+i,i===7?'pending':'ready','photo-'+i+'.jpg']);
 await db.query("INSERT INTO collections(title,slug,status,description) VALUES ('Wallets','wallets','active','Everyday wallets.'),('Hidden','hidden','draft',''),('Empty','empty','active','')");
 await db.query("INSERT INTO products(title,handle,status,price_minor,option_names,featured_media_id) VALUES ('Bifold Wallet','bifold-wallet','active',7920,'{Color}',1),('Draft Wallet','draft-wallet','draft',5000,'{}',4),('Secret Tote','secret-tote','active',9000,'{}',5),('Card Holder','card-holder','active',3900,'{}',null)");
 await db.query("INSERT INTO product_collections(product_id,collection_id) VALUES (1,1),(2,1),(3,2),(4,1)");
 await db.query("INSERT INTO product_media(product_id,media_id,position,alt) VALUES (1,1,0,''),(1,2,1,''),(2,4,0,''),(3,5,0,'')");
 await db.query("INSERT INTO product_variants(product_id,option_values,sku,price_minor,inventory,position,active,media_id) VALUES (1,'{Brown}','W-BR',7920,0,0,true,null),(1,'{Black}','W-BK',8920,0,1,true,3),(2,'{}','D-1',5000,0,0,true,null),(3,'{}','S-1',9000,0,0,true,null),(4,'{}','C-1',3900,0,0,true,null)");
 await db.query('SET ROLE jackstudio_api');
 const derivative=(m,w)=>`https://res.cloudinary.com/demo/image/authenticated/s--sig--/w_${w}/${m.object_key}.webp`;
 const options={cloud:cloud===undefined?{preview:m=>'https://api.cloudinary.com/private/'+m.id,publicDerivative:derivative}:cloud,rateLimits:false};
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),options));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const raw=(path,init={})=>fetch(base+path,{redirect:'manual',...init});
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 for(const [variant_id,delta] of [['1',3],['3',5],['4',5],['5',9]])assert.equal((await request('inventory/adjustments','POST',{variant_id,delta,reason:'received'})).status,201);
 return {db,raw,request,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}

test('public image URLs: fixed widths, no upscaling in srcset',()=>{
 assert.deepEqual([snapWidth(1),snapWidth(320),snapWidth(500),snapWidth(1000),snapWidth(99999),snapWidth('x')],[320,320,640,1440,2048,960]);
 assert.equal(publicSrcset(9,700),'/api/v3/storefront/media/9?w=320 320w, /api/v3/storefront/media/9?w=640 640w, /api/v3/storefront/media/9?w=960 700w');
 assert.equal(publicSrcset(9,640),'/api/v3/storefront/media/9?w=320 320w, /api/v3/storefront/media/9?w=640 640w');
});

test('storefront images: only images the live storefront shows are delivered',async()=>{
 const h=await harness();
 try{
  const get=id=>h.raw(`storefront/media/${id}?w=500`);
  // Listed product: featured, gallery and variant image. Width snaps to an allowed size.
  for(const id of [1,2,3]){const r=await get(id);assert.equal(r.status,302,'media '+id);assert.match(r.headers.get('location'),new RegExp(`w_640/jackstudio-websitesystem/products/m${id}\\.webp$`));assert.match(r.headers.get('cache-control'),/public, max-age=300/);}
  // Draft product, product only in a draft collection, unlinked, pending, unknown, malformed.
  for(const id of [4,5,6,7,99]){const r=await get(id);assert.equal(r.status,404,'media '+id);assert.equal(r.headers.get('location'),null);}
  assert.equal((await h.raw('storefront/media/0')).status,404);assert.equal((await h.raw('storefront/media/abc')).status,404);
  assert.equal((await h.raw('storefront/media/1',{method:'POST'})).status,405);
  // Archiving the product stops delivery on the next request.
  await h.db.query('RESET ROLE');await h.db.query("UPDATE products SET status='archived' WHERE id=1");await h.db.query('SET ROLE jackstudio_api');
  assert.equal((await get(1)).status,404);
  await h.db.query('RESET ROLE');await h.db.query("UPDATE products SET status='active' WHERE id=1");await h.db.query('SET ROLE jackstudio_api');
  // Theme image: delivered only while the theme that uses it is live.
  const content=PRESETS['jack-studio-2026'].build();const hero=content.sections.find(s=>s.type==='hero_banner');
  assert.ok(hero,'preset has a hero banner');hero.settings.image_id='8';
  const created=(await h.request('themes','POST',{name:'With image',preset:'jack-studio-2026'})).body;
  const draft=(await h.request(`themes/${created.id}`,'PATCH',{revision:created.revision,content})).body;assert.equal(draft.revision,created.revision+1);
  assert.equal((await get(8)).status,404,'saved but not live');
  const published=await h.request(`themes/${draft.id}/publish`,'POST',{revision:draft.revision});assert.equal(published.status,200,JSON.stringify(published.body));
  assert.equal((await get(8)).status,302,'live theme image');
  const pub=(await h.request('storefront/theme','GET',undefined,null)).body;
  assert.equal(pub.media['8'],'/api/v3/storefront/media/8?w=960');assert.ok(!JSON.stringify(pub).includes('cloudinary'));
  const other=(await h.request('themes','POST',{name:'Without image',preset:'jack-studio-2026'})).body;
  await h.request(`themes/${other.id}/publish`,'POST',{revision:other.revision});
  assert.equal((await get(8)).status,404,'theme no longer live');
 }finally{await h.close();}
});

test('storefront images: unconfigured image service says so instead of pretending',async()=>{
 const h=await harness({cloud:null});
 try{const r=await h.raw('storefront/media/1');assert.equal(r.status,503);assert.match((await r.json()).error,/not configured/);}
 finally{await h.close();}
});

test('storefront catalogue: product images, variants, collections and cart thumbnails',async()=>{
 const h=await harness();
 try{
  const p=(await h.request('storefront/products/bifold-wallet','GET',undefined,null)).body.product;
  assert.deepEqual(p.images.map(i=>i.id),['1','2','3']);
  assert.equal(p.images[0].url,'/api/v3/storefront/media/1?w=960');assert.match(p.images[0].srcset,/w=1440 1200w$/);
  assert.equal(p.images[0].width,1200);
  assert.deepEqual(p.variants.map(v=>[v.option_values[0],v.available,v.image_id]),[['Brown',true,null],['Black',false,'3']]);
  assert.deepEqual(p.collections,[{title:'Wallets',handle:'wallets'}]);
  const text=JSON.stringify(p);for(const secret of ['object_key','products/m1','sku','W-BR','inventory','cloudinary'])assert.ok(!text.includes(secret),secret);
  for(const handle of ['draft-wallet','secret-tote','missing'])assert.equal((await h.request('storefront/products/'+handle,'GET',undefined,null)).status,404,handle);

  const c=(await h.request('storefront/collections/wallets','GET',undefined,null)).body;
  assert.equal(c.collection.title,'Wallets');assert.equal(c.total,2);
  assert.deepEqual(c.products.map(x=>x.handle),['card-holder','bifold-wallet']);
  const bifold=c.products.find(x=>x.handle==='bifold-wallet');
  assert.deepEqual([bifold.price_min,bifold.price_max,bifold.available,bifold.image.id],[7920,8920,true,'1']);
  assert.equal(c.products.find(x=>x.handle==='card-holder').image,null);
  assert.deepEqual((await h.request('storefront/collections/wallets?sort=price-desc','GET',undefined,null)).body.products.map(x=>x.handle),['bifold-wallet','card-holder']);
  assert.deepEqual((await h.request('storefront/collections/all?sort=title-asc','GET',undefined,null)).body.products.map(x=>x.handle),['bifold-wallet','card-holder']);
  const empty=(await h.request('storefront/collections/empty','GET',undefined,null)).body;assert.deepEqual([empty.total,empty.products],[0,[]]);
  assert.equal((await h.request('storefront/collections/hidden','GET',undefined,null)).status,404);
  // In-stock filter: sold-out products drop out.
  assert.equal((await h.request('inventory/adjustments','POST',{variant_id:'5',delta:-9,reason:'damaged'})).status,201);
  assert.deepEqual((await h.request('storefront/collections/wallets?available=1','GET',undefined,null)).body.products.map(x=>x.handle),['bifold-wallet']);

  const bag=(await h.request('storefront/cart','POST',{lines:[{variant_id:'1',quantity:1},{variant_id:'2',quantity:1}]},null)).body;
  assert.deepEqual(bag.lines.map(l=>l.image?.id),['1','3']);
  assert.equal(bag.lines[1].available,false);
 }finally{await h.close();}
});
