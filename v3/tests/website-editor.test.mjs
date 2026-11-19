import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {normalizeSections,TEMPLATES,SECTION_TYPES,defaults,validLink} from '../shared/page-schema.mjs';

async function harness(){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");
 await db.query("INSERT INTO media(object_key,mime,bytes,state,created_by,format,label) VALUES ('p/1','image/png',100,'ready','editor','png','hero.png'),('p/2','image/png',100,'pending','editor','png','pending.png')");
 await db.query('SET ROLE jackstudio_api');
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{cloud:{preview:m=>'https://api.cloudinary.com/private/'+m.id}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 return {db,request,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
const section=(type,settings,extra={})=>({id:'s-'+type+Math.random().toString(36).slice(2,6),type,hidden:false,settings:{...defaults(type),...settings},...extra});

test('section schema validates every type, links and templates',()=>{
 for(const [name,t] of Object.entries(TEMPLATES)){const page=t.build();assert.doesNotThrow(()=>normalizeSections(page.sections),name);}
 for(const [type,schema] of Object.entries(SECTION_TYPES)){const settings=defaults(type);for(const f of schema.fields)if(f.required)settings[f.key]='Required copy';assert.equal(normalizeSections([{id:'a',type,settings}])[0].type,type);}
 for(const link of ['/pages/contact','/collections?sort=new','https://jackstudio.com.my/x','mailto:hello@example.com','tel:+60123456789',''])assert.ok(validLink(link),link);
 for(const link of ['javascript:alert(1)','//evil.example','http://insecure.example','data:text/html,x','https://user:pw@example.com',' /x<'])assert.equal(validLink(link),false,link);
 for(const [list,message] of [
  [[{id:'a',type:'video',settings:{}}],/unknown section type/],
  [[{id:'a',type:'banner',settings:{text:'x',onclick:'1'}}],/unknown setting/],
  [[{id:'a',type:'banner',settings:{text:''}}],/Text is required/],
  [[{id:'a',type:'banner',settings:{text:'x',cta_label:'Go'}}],/add a link/],
  [[{id:'a',type:'banner',settings:{text:'x',cta_href:'javascript:alert(1)'}}],/must start with/],
  [[{id:'a',type:'rich_text',settings:{body:'x'}},{id:'a',type:'rich_text',settings:{body:'y'}}],/duplicate id/],
  [[{id:'a',type:'product_grid',settings:{limit:99}}],/1–24/],
  [Array.from({length:31},(_,i)=>({id:'a'+i,type:'rich_text',settings:{body:'x'}})),/up to 30/]
 ])assert.throws(()=>normalizeSections(list),message);
});

test('pages: draft, preview, publish, unpublish, version restore, redirects and permissions',async()=>{
 const {db,request,close}=await harness();
 try{
  const c=(await request('collections','POST',{title:'Wallets',status:'active'})).body;
  const live=(await request('products','POST',{title:'Card Holder',status:'active',collection_ids:[String(c.id)],price_minor:12900,sku:'CH-1',media:[{media_id:'1',alt:'x'}]})).body;
  const draft=(await request('products','POST',{title:'Prototype',status:'draft',collection_ids:[String(c.id)]})).body;
  const hero=section('hero',{heading:'Everyday carry',media_id:'1',cta_label:'Shop',cta_href:'/collections'});
  const grid=section('product_grid',{heading:'Wallets',source:'collection',collection_id:String(c.id)});
  const manual=section('product_grid',{heading:'Picks',source:'manual',product_ids:[String(draft.id),String(live.id)]});
  const hidden=section('banner',{text:'Secret sale'},{hidden:true});
  let r=await request('pages','POST',{title:'Home',sections:[hero,grid,manual,hidden]});assert.equal(r.status,201,JSON.stringify(r.body));
  const id=r.body.id;assert.equal(r.body.slug,'home');assert.equal(r.body.status,'draft');
  // Drafts are private.
  assert.equal((await request('storefront/pages/home','GET',undefined,null)).status,404);
  for(const body of [{title:'X',sections:[section('hero',{heading:'H',media_id:'2'})]},{title:'X',sections:[section('product_grid',{source:'manual',product_ids:['999']})]},{title:'X',sections:[section('product_grid',{collection_id:'999'})]},{title:''},{title:'X',seo_title:'x'.repeat(71)},{title:'X',script:'1'}])assert.equal((await request('pages','POST',body)).status,400,JSON.stringify(body));
  assert.equal((await request('pages','POST',{title:'Home again',slug:'home'})).status,409,'slug unique');
  // Preview resolves products with the storefront rule and hides hidden sections.
  const preview=(await request('pages/'+id+'/preview','GET',undefined,'viewer')).body;
  assert.deepEqual(preview.page.sections.map(s=>s.type),['hero','product_grid','product_grid']);
  assert.deepEqual(preview.page.sections[1].products.map(p=>p.title),['Card Holder']);
  assert.deepEqual(preview.page.sections[2].products.map(p=>p.title),['Card Holder'],'draft products never shown');
  assert.equal(preview.media['1'],'https://api.cloudinary.com/private/1');
  const unsaved=(await request('pages/preview','POST',{title:'Unsaved',sections:[section('banner',{text:'Not saved yet'})]})).body;assert.equal(unsaved.page.sections[0].settings.text,'Not saved yet');
  assert.equal((await request('pages/preview','POST',{sections:[section('banner',{text:'x'})]},'viewer')).status,403);
  assert.equal((await request('pages/preview','POST',{sections:[section('banner',{text:''})]})).status,400);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pages')).rows[0].n,1,'preview writes nothing');
  // Viewer cannot change; stale revision rejected.
  let page=(await request('pages/'+id)).body;
  assert.equal((await request('pages/'+id,'PATCH',{revision:page.revision,title:'X'},'viewer')).status,403);
  assert.equal((await request('pages/'+id+'/publish','POST',{revision:page.revision},'viewer')).status,403);
  assert.equal((await request('pages/'+id+'/publish','POST',{revision:page.revision+5})).status,409);
  r=await request('pages/'+id+'/publish','POST',{revision:page.revision});assert.equal(r.status,200);assert.equal(r.body.status,'published');
  let pub=(await request('storefront/pages/home','GET',undefined,null)).body;
  assert.equal(pub.page.title,'Home');assert.equal(pub.page.sections.length,3);assert.equal(pub.checkoutAvailable,false);
  assert.equal(JSON.stringify(pub).includes('Secret sale'),false);assert.equal(JSON.stringify(pub).includes('cloudinary'),false,'no private image URLs in public data');
  // Editing the draft does not change the live page until published again.
  page=(await request('pages/'+id)).body;
  r=await request('pages/'+id,'PATCH',{revision:page.revision,title:'Home v2',slug:'welcome',sections:[section('rich_text',{body:'New copy'})]});assert.equal(r.status,200);assert.equal(r.body.status,'changes');
  pub=(await request('storefront/pages/home','GET',undefined,null)).body;assert.equal(pub.page.title,'Home','live URL and content unchanged');
  assert.equal((await request('storefront/pages/welcome','GET',undefined,null)).status,404,'draft URL is private');
  assert.equal((await request('pages','POST',{title:'Cannot steal live URL',slug:'home'})).status,409);
  page=(await request('pages/'+id)).body;assert.deepEqual(page.redirects,[],'no redirect before publishing');
  r=await request('pages/'+id+'/publish','POST',{revision:page.revision});assert.equal(r.status,200);
  assert.deepEqual((await request('storefront/pages/home','GET',undefined,null)).body,{redirect_to:'welcome'},'old URL redirects only after publishing');
  pub=(await request('storefront/pages/welcome','GET',undefined,null)).body;assert.equal(pub.page.title,'Home v2');
  // Restore version 1 as a draft, then publish it: rollback with full history kept.
  page=(await request('pages/'+id)).body;assert.deepEqual(page.revisions.map(v=>[v.number,v.live]),[[2,true],[1,false]]);
  const v1=page.revisions.find(v=>v.number===1);
  r=await request('pages/'+id+'/revisions/'+v1.id+'/restore','POST',{revision:page.revision});assert.equal(r.status,200);assert.equal(r.body.title,'Home');assert.equal(r.body.status,'changes');
  assert.equal((await request('storefront/pages/welcome','GET',undefined,null)).body.page.title,'Home v2','restore alone does not publish');
  r=await request('pages/'+id+'/publish','POST',{revision:r.body.revision});assert.equal((await request('storefront/pages/welcome','GET',undefined,null)).body.page.title,'Home');
  page=(await request('pages/'+id)).body;assert.equal(page.revisions.length,3);
  // Another page may claim the old slug; the redirect then stops.
  r=await request('pages','POST',{title:'Home',slug:'home'});assert.equal(r.status,201);
  assert.deepEqual((await request('storefront/pages/home','GET',undefined,null)).body,{redirect_to:'welcome'},'new draft does not remove live redirect');
  await request('pages/'+r.body.id+'/publish','POST',{revision:r.body.revision});
  assert.equal((await request('storefront/pages/home','GET',undefined,null)).body.page.title,'Home','new page takes the URL when published');
  // Unpublish removes it from the public site.
  r=await request('pages/'+id+'/unpublish','POST',{revision:page.revision});assert.equal(r.status,200);assert.equal(r.body.status,'draft');
  assert.equal((await request('storefront/pages/welcome','GET',undefined,null)).status,404);
  assert.equal((await request('pages/'+id+'/unpublish','POST',{revision:r.body.revision})).status,400);
  const list=(await request('pages?q=home&status=draft')).body;assert.equal(list.total,1);
  for(const [path,method] of [['pages/'+id,'DELETE'],['pages/'+id+'/publish','GET'],['pages/'+id+'/preview','POST'],['storefront/pages/welcome','POST']])assert.equal((await request(path,method,method==='GET'?undefined:{})).status,405,path+' '+method);
  assert.equal((await request('pages','GET',undefined,null)).status,401);
  // History is append-only for the API role.
  await assert.rejects(db.query('UPDATE page_revisions SET title=$1',['x']),e=>e.code==='42501');
  await assert.rejects(db.query('DELETE FROM page_revisions'),e=>e.code==='42501');
  await assert.rejects(db.query('DELETE FROM pages'),e=>e.code==='42501');
  await db.query('RESET ROLE');
  assert.deepEqual((await db.query("SELECT action FROM audit_events WHERE entity='pages' AND entity_id=$1 ORDER BY id",[id])).rows.map(r=>r.action),['create','publish','update','publish','restore','publish','unpublish']);
 }finally{await close();}
});

test('006 is additive and private to the API role',async()=>{
 const db=new PGlite();try{
  await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
  for(const file of ['001_foundation.sql','002_staff_isolation.sql','003_cloudinary.sql','004_catalog_admin.sql','005_variants_inventory.sql'])await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  await db.exec("INSERT INTO staff VALUES ('owner','admin',true); INSERT INTO products(title,handle) VALUES ('Wallet','wallet');");
  await db.exec(await readFile(new URL('../migrations/006_website_editor.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM products')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pages')).rows[0].n,0,'no pages seeded');
  for(const role of ['anon','authenticated'])for(const table of ['pages','page_revisions','page_redirects'])assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT') AS allowed",[role,table])).rows[0].allowed,false);
  for(const [table,priv,allowed] of [['pages','UPDATE',true],['pages','DELETE',false],['page_revisions','INSERT',true],['page_revisions','UPDATE',false],['page_revisions','DELETE',false],['page_redirects','DELETE',true]])assert.equal((await db.query("SELECT has_table_privilege('jackstudio_api',$1,$2) AS allowed",[table,priv])).rows[0].allowed,allowed,table+' '+priv);
  // A page can only point at its own revision.
  await db.exec("INSERT INTO pages(slug,title) VALUES ('a','A'),('b','B'); INSERT INTO page_revisions(page_id,number,slug,title,seo_title,seo_description,sections,published_by) VALUES (1,1,'a','A','','','[]','owner');");
  await assert.rejects(db.query('UPDATE pages SET published_revision_id=1 WHERE id=2'),e=>e.code==='23503');
 }finally{await db.close();}
});
