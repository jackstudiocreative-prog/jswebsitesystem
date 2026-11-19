import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {SHOPIFY_CDN,SHOPIFY_MEDIA} from '../src/shopify-media.mjs';
import {shopifyKey,THEME_IMAGES} from '../src/shopify-import.mjs';

const HERO=THEME_IMAGES.hero,CARD=THEME_IMAGES.cards['urban carry'],LOGO=THEME_IMAGES.header_logo;
async function harness(){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");
 await db.query("INSERT INTO media(object_key,mime,bytes,state,created_by,format,label) VALUES ('p/own','image/png',100,'ready','editor','png','own.png')");
 await db.query('SET ROLE jackstudio_api');
 const uploads=[],fail=new Set(),huge=new Set();
 const cloud={preview:m=>'https://api.cloudinary.com/private/'+m.id,
  importRemote:async(url,public_id)=>{uploads.push({url,public_id});if(fail.has(url))throw {error:{message:'Resource not found'}};
   return {public_id,resource_type:'image',type:'authenticated',asset_id:'a'+uploads.length,version:1,format:url.endsWith('.png')?'png':'jpg',bytes:huge.has(url)?20000000:1234,width:1600,height:900};}};
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{cloud}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 return {db,request,uploads,fail,huge,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}

test('manifest: Shopify CDN paths only, unique, approved raster formats, and covers every theme image',()=>{
 assert.ok(SHOPIFY_MEDIA.length>1500);assert.equal(new Set(SHOPIFY_MEDIA).size,SHOPIFY_MEDIA.length);
 assert.ok(SHOPIFY_MEDIA.every(p=>/^(files|products|collections)\/[A-Za-z0-9._%~-]+\.(jpe?g|png|webp)$/i.test(p)));
 assert.equal(SHOPIFY_CDN,'https://cdn.shopify.com/s/files/1/0745/2550/7871/');
 const slots=[THEME_IMAGES.header_logo,THEME_IMAGES.footer_logo,THEME_IMAGES.hero,THEME_IMAGES.promise,THEME_IMAGES.stat,THEME_IMAGES.story,...Object.values(THEME_IMAGES.menu),...Object.values(THEME_IMAGES.cards),...Object.values(THEME_IMAGES.outlets)];
 for(const p of slots)assert.ok(SHOPIFY_MEDIA.includes(p),p);
 assert.match(shopifyKey(HERO),/^jackstudio-websitesystem\/shopify\/[0-9a-f]{32}$/);
});

test('Shopify import: status, batch validation, private import, failures and idempotent re-runs',async()=>{
 const h=await harness();
 try{
  let s=await h.request('media/import');assert.equal(s.status,200);assert.equal(s.body.total,SHOPIFY_MEDIA.length);assert.equal(s.body.imported,0);assert.equal(s.body.pending.length,SHOPIFY_MEDIA.length);assert.equal(s.body.batch,4);
  assert.equal((await h.request('media/import','GET',undefined,'viewer')).status,200,'viewers can see progress');
  assert.equal((await h.request('media/import','POST',{paths:[HERO]},'viewer')).status,403);
  for(const body of [{paths:['https://evil.example/x.png']},{paths:['files/not-in-manifest.png']},{paths:SHOPIFY_MEDIA.slice(0,5)},{paths:[HERO,HERO]},{paths:[]},{paths:[HERO],url:'x'},[HERO]])
   assert.equal((await h.request('media/import','POST',body)).status,400,JSON.stringify(body).slice(0,80));
  assert.equal(h.uploads.length,0,'nothing is fetched for rejected batches');
  const broken=SHOPIFY_MEDIA.find(p=>p.startsWith('products/')),big=SHOPIFY_MEDIA.find(p=>p.startsWith('collections/'));
  h.fail.add(SHOPIFY_CDN+broken);h.huge.add(SHOPIFY_CDN+big);
  const r=await h.request('media/import','POST',{paths:[HERO,CARD,broken,big]});assert.equal(r.status,200);
  const by=Object.fromEntries(r.body.items.map(i=>[i.path,i]));
  assert.equal(by[HERO].status,'imported');assert.equal(by[CARD].status,'imported');
  assert.equal(by[broken].status,'failed');assert.match(by[broken].error,/Resource not found/);
  assert.equal(by[big].status,'failed');assert.match(by[big].error,/size/);
  assert.deepEqual(h.uploads.map(u=>u.url).sort(),[HERO,CARD,broken,big].map(p=>SHOPIFY_CDN+p).sort(),'Cloudinary fetches only manifest URLs');
  const row=(await h.db.query('SELECT * FROM media WHERE id=$1',[by[HERO].media_id])).rows[0];
  assert.equal(row.object_key,shopifyKey(HERO));assert.equal(row.label,'JACK_STUDIO.png');assert.equal(row.state,'ready');assert.equal(row.mime,'image/png');assert.equal(row.created_by,'editor');
  s=await h.request('media/import');assert.equal(s.body.imported,2);assert.ok(!s.body.pending.includes(HERO));assert.ok(s.body.pending.includes(broken),'failed images stay pending for a retry');
  const again=await h.request('media/import','POST',{paths:[HERO]});assert.equal(again.body.items[0].status,'exists');assert.equal(again.body.items[0].media_id,by[HERO].media_id);assert.equal(h.uploads.length,4,'finished images are not fetched again');
  await h.db.query('RESET ROLE');assert.equal((await h.db.query("SELECT count(*)::int AS n FROM audit_events WHERE action='import' AND entity='media'")).rows[0].n,2);
 }finally{await h.close();}
});

test('themes: new preset themes and "Auto-fill images" use the imported Shopify images, never replacing chosen ones',async()=>{
 const h=await harness();
 try{
  const before=(await h.request('themes','POST',{preset:'jack-studio-2026'})).body;
  assert.equal(before.content.sections.find(s=>s.type==='hero_banner').settings.image_id,null,'nothing to fill before the import');
  assert.equal((await h.request(`themes/${before.id}/autofill`,'POST',{revision:before.revision})).body.filled,0);
  const imported=(await h.request('media/import','POST',{paths:[HERO,CARD,LOGO]})).body.items,id=Object.fromEntries(imported.map(i=>[i.path,i.media_id]));
  // Staff picked their own header logo; auto-fill must keep it.
  const content=structuredClone(before.content);content.header.find(s=>s.type==='site_header').settings.logo_id='1';
  const saved=(await h.request(`themes/${before.id}`,'PATCH',{revision:before.revision,content})).body;
  assert.equal((await h.request(`themes/${before.id}/autofill`,'POST',{revision:saved.revision-1})).status,409,'stale revisions are rejected');
  const filled=await h.request(`themes/${before.id}/autofill`,'POST',{revision:saved.revision});assert.equal(filled.status,200);assert.equal(filled.body.filled,2);
  const t=filled.body.content;
  assert.equal(t.sections.find(s=>s.type==='hero_banner').settings.image_id,id[HERO]);
  assert.equal(t.sections.find(s=>s.type==='collection_cards').settings.cards.find(c=>c.title==='URBAN CARRY').image_id,id[CARD]);
  assert.equal(t.sections.find(s=>s.type==='collection_cards').settings.cards.find(c=>c.title==='PROFESSIONAL').image_id,null,'not imported yet');
  assert.equal(t.header.find(s=>s.type==='site_header').settings.logo_id,'1');
  assert.equal((await h.request(`themes/${before.id}/autofill`,'POST',{revision:filled.body.revision})).body.filled,0);
  const fresh=(await h.request('themes','POST',{preset:'jack-studio-2026'})).body;
  assert.equal(fresh.content.sections.find(s=>s.type==='hero_banner').settings.image_id,id[HERO],'new preset themes fill automatically');
  assert.equal(fresh.content.header.find(s=>s.type==='site_header').settings.logo_id,id[LOGO]);
  const copy=(await h.request('themes','POST',{from:before.id})).body;
  assert.equal(copy.content.header.find(s=>s.type==='site_header').settings.logo_id,'1','duplicates stay exact copies');
  assert.equal((await h.request(`themes/${before.id}/autofill`,'POST',{revision:1},'viewer')).status,403);
  assert.equal((await h.request(`themes/${before.id}/autofill`,'GET')).status,405);
 }finally{await h.close();}
});
