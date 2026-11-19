import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {renderPage,extract,scriptBundle} from '../src/liquid.mjs';
import {PAGE_TEMPLATES,PAGE_SLUGS,normalizeTemplates,cleanHtml} from '../shared/page-templates.mjs';
import {normalizeTheme,PRESETS} from '../shared/theme-schema.mjs';
import {shopifyKey} from '../src/shopify-import.mjs';

async function harness(){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");
 await db.query("INSERT INTO media(object_key,mime,bytes,state,created_by,format,label,width,height) VALUES ($1,'image/png',100,'ready','editor','png','JACK_STUDIO.png',1600,900)",[shopifyKey('files/Screenshot_2026-08-14_093530.png')]);
 await db.query('SET ROLE jackstudio_api');
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{cloud:{preview:m=>'https://api.cloudinary.com/private/'+m.id}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let json;try{json=JSON.parse(text);}catch{}return {status:r.status,body:json??text,type:r.headers.get('content-type')};};
 return {sql,request,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}

test('every Shopify page template renders with its original sections, scripts split out',async()=>{
 const db=new PGlite();const sql={query:(q,a)=>q.includes(';')&&!a?db.exec(q).then(r=>r.at(-1)):db.query(q,a)};await migrate(sql);
 try{
  assert.deepEqual(PAGE_SLUGS,['brand-story','brand-promise','our-services','corporate-solution','outlets','contact','product-collection','privacy-policy','refund-policy','shipping-policy','terms-of-service']);
  for(const slug of PAGE_SLUGS){
   const r=await renderPage(sql,slug,PAGE_TEMPLATES[slug],{strict:true});
   assert.ok(r.html.length>1000,slug);assert.ok(!/<script(?![^>]*application\/(ld\+)?json)/i.test(r.html),`${slug}: no inline scripts left`);assert.ok(!/\son(click|change)=/i.test(r.html),`${slug}: no inline handlers`);
  }
  const outlets=await renderPage(sql,'outlets',PAGE_TEMPLATES.outlets);assert.match(outlets.html,/Aeon Bukit Tinggi/);assert.match(outlets.html,/Klang Valley/i);
  const policy=await renderPage(sql,'privacy-policy',PAGE_TEMPLATES['privacy-policy']);assert.match(policy.html,/Collected Information/);
 }finally{await db.close();}
});

test('extract moves inline scripts and handlers out; bundles run each section separately',()=>{
 const r=extract('<div onclick="openSeries(\'a\',this)">x</div><script>var a=1;</script><script type="application/ld+json">{}</script><script src="//evil"></script>','s1');
 assert.equal(r.scripts.length,1);assert.match(r.html,/data-lq-on-click="openSeries\('a',this\)"/);assert.match(r.html,/application\/ld\+json/);assert.ok(!r.html.includes('evil'));
 const js=scriptBundle(r.scripts);assert.match(js,/try\{\nvar a=1;\n\}catch/);
});

test('page templates are validated: unknown sections, unsafe links and scripts in text are rejected or removed',()=>{
 const base=structuredClone(PAGE_TEMPLATES['brand-story']),id=base.order[0];
 assert.throws(()=>normalizeTemplates({nope:base}),/Unknown page/);
 assert.throws(()=>normalizeTemplates({'brand-story':{...base,sections:{...base.sections,[id]:{type:'hacker'}}}}),/unknown section/);
 const urlField=Object.keys(base.sections).map(k=>base.sections[k]).find(s=>s.type==='brand-story-hero');
 const bad=structuredClone(base);bad.sections[id].settings.heading='<img src=x onerror=alert(1)>Hello<script>alert(1)</script>';
 assert.equal(normalizeTemplates({'brand-story':bad})['brand-story'].sections[id].settings.heading,'<img src=x>Hello');
 assert.equal(cleanHtml('<a href="javascript:alert(1)">x</a>'),'<a href="#alert(1)">x</a>');
 const theme=normalizeTheme({...PRESETS['jack-studio-2026'].build(),templates:{'brand-story':base}});assert.equal(theme.templates['brand-story'].order.length,base.order.length);
});

test('storefront theme pages: live theme only, scripts file, staff previews with private images',async()=>{
 const h=await harness();
 try{
  assert.equal((await h.request('storefront/theme/pages/outlets','GET',undefined,null)).status,404,'no live theme yet');
  const t=(await h.request('themes','POST',{preset:'jack-studio-2026'})).body;await h.request(`themes/${t.id}/publish`,'POST',{revision:t.revision});
  const page=await h.request('storefront/theme/pages/outlets','GET',undefined,null);assert.equal(page.status,200);assert.equal(page.body.title,'Outlets');assert.match(page.body.html,/Aeon Bukit Tinggi/);
  assert.ok(!page.body.html.includes('api.cloudinary.com'),'the public site never gets private image links');
  assert.equal((await h.request('storefront/theme/pages/not-a-page','GET',undefined,null)).status,404);
  const story=await h.request('storefront/theme/pages/brand-promise','GET',undefined,null);
  if(story.body.scripts.length){const js=await h.request('storefront/theme/scripts.js?s='+story.body.scripts.join(','),'GET',undefined,null);assert.equal(js.status,200);assert.match(js.type,/javascript/);}
  assert.equal((await h.request('storefront/theme/scripts.js?s=evil:<x>','GET',undefined,null)).status,400);
  const detail=(await h.request('themes/'+t.id)).body;
  const prev=await h.request('themes/preview-pages','POST',{content:detail.content,page:'outlets'});assert.equal(prev.status,200);assert.match(prev.body.pages.outlets.html,/https:\/\/api\.cloudinary\.com\/private\/1/,'staff preview shows the imported outlet photo');
  assert.equal((await h.request('themes/preview-pages','POST',{content:detail.content},'viewer')).status,403);
  // Saving an edited page keeps it in the theme; the storefront follows.
  const content=structuredClone(detail.content);content.templates={'privacy-policy':{...structuredClone(PAGE_TEMPLATES['privacy-policy']),title:'Privacy Notice 2026'}};
  const saved=await h.request('themes/'+t.id,'PATCH',{revision:detail.revision,content});assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.match((await h.request('storefront/theme/pages/privacy-policy','GET',undefined,null)).body.html,/Privacy Notice 2026/);
 }finally{await h.close();}
});
