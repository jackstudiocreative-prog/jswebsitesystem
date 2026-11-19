import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {renderPage} from '../src/liquid.mjs';
import {templateFor} from '../shared/page-templates.mjs';
import {PRESETS} from '../shared/theme-schema.mjs';

async function harness(){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true)");await db.query('SET ROLE jackstudio_api');
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{rateLimits:false}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 const pub=path=>request(path,'GET',undefined,null);
 const shop=(await request('collections','POST',{title:'Bags',status:'active'})).body;
 const mk=body=>request('products','POST',{status:'active',collection_ids:[String(shop.id)],...body});
 await mk({title:'Canvas Backpack BAD 40107',tags:['travel'],description:'<p>Roomy canvas backpack</p>',option_names:['Color'],variants:[{option_values:['Brown'],sku:'BAD40107-B',price_minor:19900,inventory:3,active:true},{option_values:['Grey'],sku:'BAD40107-E',price_minor:19900,inventory:0,active:true}]});
 await mk({title:'Leather Wallet',description:'<p>Slim bifold 50% off fabric</p>',option_names:['Color'],variants:[{option_values:['Brown'],sku:'JWC-1',price_minor:8900,inventory:5,active:true},{option_values:['Black'],sku:'JWC-2',price_minor:9900,inventory:5,active:true}]});
 await mk({title:'Sling Bag',option_names:['Size'],variants:[{option_values:['S'],sku:'SL-S',price_minor:12900,inventory:2,active:true},{option_values:['L'],sku:'SL-L',price_minor:15900,inventory:0,active:true}]});
 await request('products','POST',{title:'Secret Draft Wallet',status:'draft',collection_ids:[String(shop.id)],sku:'DRAFT-1',price_minor:100,inventory:1});
 return {db,request,pub,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
const handles=r=>r.body.products.map(p=>p.handle);

test('search: title, SKU, tags and description; every word must match; drafts and SKUs never shown',async()=>{
 const h=await harness();
 try{
  assert.deepEqual(handles(await h.pub('storefront/search?q=wallet')),['leather-wallet']);
  assert.deepEqual(handles(await h.pub('storefront/search?q=bad40107-e')),['canvas-backpack-bad-40107'],'SKU');
  assert.deepEqual(handles(await h.pub('storefront/search?q=travel')),['canvas-backpack-bad-40107'],'tag');
  assert.deepEqual(handles(await h.pub('storefront/search?q=roomy%20canvas')),['canvas-backpack-bad-40107'],'description, all words');
  assert.deepEqual(handles(await h.pub('storefront/search?q=canvas%20wallet')),[],'every word must match');
  assert.deepEqual(handles(await h.pub('storefront/search?q=50%25')),['leather-wallet'],'% is literal');
  assert.deepEqual(handles(await h.pub('storefront/search?q=_')).length,0);
  const r=await h.pub('storefront/search?q=secret');assert.deepEqual([r.body.total,r.body.products.length],[0,0]);
  assert.equal((await h.pub('storefront/search?q=a')).body.too_short,true);
  assert.equal((await h.pub('storefront/search?q='+'x'.repeat(81))).status,400);
  const text=JSON.stringify((await h.pub('storefront/search?q=bad')).body);assert.ok(!text.includes('BAD40107-B'),'SKU not returned');
  // Best title match first.
  assert.equal(handles(await h.pub('storefront/search?q=bag'))[0],'sling-bag');
 }finally{await h.close();}
});

test('collection filters: stock, price range and option values; facets from the collection',async()=>{
 const h=await harness();
 try{
  const all=(await h.pub('storefront/collections/bags')).body;
  assert.equal(all.total,3);
  const color=all.filters.options.find(o=>o.name==='color');
  assert.deepEqual(color.values.map(v=>[v.value,v.count]),[['Black',1],['Brown',2],['Grey',1]]);
  assert.ok(!all.filters.options.some(o=>o.values.length<2),'single-value options hidden');
  assert.deepEqual(all.filters.price,{min:8900,max:19900});
  assert.deepEqual(handles(await h.pub('storefront/collections/bags?option.color=Grey')),['canvas-backpack-bad-40107']);
  assert.deepEqual(handles(await h.pub('storefront/collections/bags?option.color=black&option.color=grey')).sort(),['canvas-backpack-bad-40107','leather-wallet']);
  assert.deepEqual(handles(await h.pub('storefront/collections/bags?price_min=90&price_max=150')).sort(),['leather-wallet','sling-bag']);
  assert.deepEqual(handles(await h.pub('storefront/collections/bags?option.size=L&available=1')),['sling-bag'],'available: some variant in stock');
  const f=(await h.pub('storefront/collections/bags?option.color=Brown&price_min=80')).body.filters.applied;
  assert.deepEqual([f.price_min,f.options.color],[8000,['Brown']]);
  assert.equal((await h.pub('storefront/collections/bags?price_min=abc')).status,400);
  // Search uses the same filters.
  assert.deepEqual(handles(await h.pub('storefront/search?q=bag&option.size=S')),['sling-bag']);
 }finally{await h.close();}
});

test('theme: the account icon leads to Jack Studio Club; no Shopify account pages',async()=>{
 const content=PRESETS['jack-studio-2026'].build();
 const header=templateFor(content,'header');
 const fake={query:async()=>({rows:[]})};
 const html=(await renderPage(fake,'home',header,{})).html??'';
 assert.ok(!html.includes('/account'),'no Shopify account links');
 assert.ok(html.includes('href="https://club.jackstudio.com.my/" aria-label="Account"'),'account icon → member club');
 assert.ok(html.includes('/search'),'search link kept');
});

const by_blog=b=>b.problems.find(p=>p.href==='/blogs/news')?.reason;
test('theme link check lists links that lead nowhere; staff only',async()=>{
 const h=await harness();
 try{
  const t=(await h.request('themes','POST',{name:'Links',preset:'jack-studio-2026'})).body;
  const d=(await h.request('themes/'+t.id)).body;
  const r=await h.request('themes/links','POST',{content:d.content});
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.equal(by_blog(r.body),'Blog is not available yet');
  assert.ok(r.body.checked>10);
  const by=Object.fromEntries(r.body.problems.map(p=>[p.href,p.reason]));
  assert.equal(by['/account/login'],undefined,'account link already hidden at render');
  for(const [href,reason] of Object.entries(by))assert.ok(reason,href);
  assert.ok(!Object.keys(by).includes('/cart')&&!Object.keys(by).includes('/search'),'working routes are not reported');
  assert.equal((await h.request('themes/links','POST',{content:d.content},'viewer')).status,403);
 }finally{await h.close();}
});
