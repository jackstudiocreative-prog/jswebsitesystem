import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {normalizeTheme,PRESETS,THEME_SECTIONS,TEMPLATE_TYPES,defaults,themeReferences} from '../shared/theme-schema.mjs';
import {renderThemeBody,themeDocument,themeCss} from '../admin/theme-render.mjs';

async function harness(){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");
 await db.query("INSERT INTO media(object_key,mime,bytes,state,created_by,format,label) VALUES ('p/1','image/png',100,'ready','editor','png','hero.png'),('p/2','image/png',100,'pending','editor','png','pending.png')");
 await db.query("INSERT INTO collections(title,slug,status) VALUES ('Wallets','wallets','active'),('Hidden','hidden','draft')");
 await db.query("INSERT INTO products(title,handle,status,price_minor,option_names,description) VALUES ('Bifold Wallet','bifold-wallet','active',7920,'{Colour}','<p>Full grain leather wallet.</p>'),('Draft Wallet','draft-wallet','draft',5000,'{}','')");
 await db.query("INSERT INTO product_collections(product_id,collection_id) VALUES (1,1),(2,1)");
 await db.query("INSERT INTO product_variants(product_id,option_values,sku,price_minor,inventory,position,active) VALUES (1,'{Black}','W-1',7920,0,0,true),(1,'{Brown}','W-2',7920,0,1,true)");
 await db.query('SET ROLE jackstudio_api');
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{cloud:{preview:m=>'https://api.cloudinary.com/private/'+m.id}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 return {db,request,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}

test('theme schema: presets, every section type, groups and unsafe values',()=>{
 for(const [id,p] of Object.entries(PRESETS))assert.doesNotThrow(()=>normalizeTheme(p.build()),id);
 const base=PRESETS['jack-studio-2026'].build();
 for(const type of TEMPLATE_TYPES){const settings=defaults(type);for(const f of THEME_SECTIONS[type]?.fields??[])if(f.required)settings[f.key]='x';
  if(type==='banner')settings.text='x';if(type==='rich_text')settings.body='x';if(['hero','image_text'].includes(type))settings.heading='x';
  assert.equal(normalizeTheme({...base,sections:[{id:'a',type,settings}]}).sections[0].type,type);}
 const bad=[
  [{...base,extra:1},/unknown property/],
  [{...base,header:[...base.header,{...base.header[0],id:'dup2'}]},/use up to 2|used once/],
  [{...base,sections:[{id:'a',type:'site_footer',settings:{}}]},/cannot be used here/],
  [{...base,footer:[{id:'f',type:'hero_banner',settings:{}}]},/cannot be used here/],
  [{...base,settings:{...base.settings,accent:'red;}body{x'}},/colour/],
  [{...base,sections:[{id:'a',type:'hero_banner',settings:{button_link:'javascript:alert(1)'}}]},/must start with/],
  [{...base,sections:[{id:'a',type:'icon_row',settings:{items:[{icon:'skull',title:'x'}]}}]},/valid choice/],
  [{...base,sections:[{id:'a',type:'icon_row',settings:{items:[{title:''}]}}]},/Title is required/],
  [{...base,sections:[{id:'a',type:'promise_split',settings:{stat_number:'12<b>'}}]},/not valid/],
  [{...base,sections:[{id:'a',type:'hero_banner',settings:{onclick:'x'}}]},/unknown setting/],
  [{...base,sections:[{id:'a',type:'outlets',settings:{outlets:Array.from({length:7},()=>({name:'x'}))}}]},/up to 6/],
  [{...base,sections:[{id:'a',type:'rich_text',settings:{body:''}}]},/Text is required/]
 ];
 for(const [content,message] of bad)assert.throws(()=>normalizeTheme(content),message);
 const refs=themeReferences(normalizeTheme({...base,sections:[{id:'a',type:'product_tabs',settings:{tabs:[{label:'A',collection_id:'7'}]}},{id:'b',type:'hero_banner',settings:{image_id:'3'}}]}));
 assert.deepEqual([[...refs.media],[...refs.collections]],[['3'],['7']]);
});

test('themes API: add, edit, preview, publish, duplicate, remove, public theme and permissions',async()=>{
 const h=await harness();
 try{
  assert.equal((await h.request('themes','GET',undefined,null)).status,401);
  assert.equal((await h.request('storefront/theme','GET',undefined,null)).status,404,'nothing live yet');
  let list=await h.request('themes');assert.deepEqual(list.body.items,[]);assert.equal(list.body.presets[0].id,'jack-studio-2026');
  assert.equal((await h.request('themes','POST',{preset:'jack-studio-2026'},'viewer')).status,403);
  assert.equal((await h.request('themes','POST',{preset:'nope'})).status,400);
  assert.equal((await h.request('themes','POST',{})).status,400);
  const created=await h.request('themes','POST',{preset:'jack-studio-2026'});assert.equal(created.status,201);
  const theme=created.body;assert.equal(theme.name,'Jack Studio 2026');assert.equal(theme.is_live,false);
  const detail=(await h.request('themes/'+theme.id)).body;assert.equal(detail.content.header[1].settings.menu[1].children[0].label,'Brand Story');
  // Edit: images must be ready media, collections must exist, revisions must match.
  const content=structuredClone(detail.content);content.sections[0].settings.image_id='2';
  assert.match((await h.request('themes/'+theme.id,'PATCH',{revision:detail.revision,content})).body.error,/ready images/);
  content.sections[0].settings.image_id='1';content.sections[4].settings.tabs[0].collection_id='1';content.sections[4].settings.tabs[1].collection_id='99';
  assert.match((await h.request('themes/'+theme.id,'PATCH',{revision:detail.revision,content})).body.error,/collection that does not exist/);
  content.sections[4].settings.tabs[1].collection_id=null;
  assert.equal((await h.request('themes/'+theme.id,'PATCH',{revision:detail.revision,content},'viewer')).status,403);
  const saved=await h.request('themes/'+theme.id,'PATCH',{revision:detail.revision,content,name:'Spring 2026'});assert.equal(saved.status,200);assert.equal(saved.body.name,'Spring 2026');
  assert.equal((await h.request('themes/'+theme.id,'PATCH',{revision:detail.revision,name:'Stale'})).status,409);
  // Preview: saved and unsaved, product rule applied, signed staff image URLs.
  const preview=(await h.request(`themes/${theme.id}/preview`,'GET',undefined,'viewer')).body;
  const tab=preview.theme.sections.find(s=>s.type==='product_tabs').tabs[0];
  assert.deepEqual(tab.map(p=>[p.title,p.price_minor,p.colours,p.excerpt]),[['Bifold Wallet',7920,['Black','Brown'],'Full grain leather wallet.']]);
  assert.equal(preview.media['1'],'https://api.cloudinary.com/private/1');
  const hidden=structuredClone(content);hidden.sections[0].hidden=true;
  const draft=(await h.request('themes/preview','POST',{content:hidden})).body;assert.equal(draft.theme.sections[0].type,'icon_row','hidden sections are left out');
  assert.equal((await h.request('themes/preview','POST',{content:{...hidden,bad:1}})).status,400);
  // Publish: one live theme; the public endpoint shows it without private image URLs.
  const copy=(await h.request('themes','POST',{from:theme.id})).body;assert.equal(copy.name,'Copy of Spring 2026');
  assert.equal((await h.request(`themes/${theme.id}/publish`,'POST',{revision:saved.body.revision},'viewer')).status,403);
  const live=await h.request(`themes/${theme.id}/publish`,'POST',{revision:saved.body.revision});assert.equal(live.body.is_live,true);
  const pub=await h.request('storefront/theme','GET',undefined,null);assert.equal(pub.status,200);
  assert.equal(pub.body.theme.sections[0].type,'hero_banner');assert.equal(pub.body.media,undefined);assert.ok(!JSON.stringify(pub.body).includes('cloudinary'));
  assert.equal(pub.body.theme.sections.find(s=>s.type==='product_tabs').tabs[0][0].handle,'bifold-wallet');
  const second=await h.request(`themes/${copy.id}/publish`,'POST',{revision:copy.revision});assert.equal(second.body.is_live,true);
  list=(await h.request('themes')).body.items;assert.deepEqual(list.map(t=>[t.name,t.is_live]),[['Copy of Spring 2026',true],['Spring 2026',false]]);
  // Remove: the live theme cannot be removed; library themes are archived, not deleted.
  assert.match((await h.request(`themes/${copy.id}/archive`,'POST',{revision:second.body.revision})).body.error,/Publish another theme/);
  const old=list.find(t=>!t.is_live);
  assert.equal((await h.request(`themes/${old.id}/archive`,'POST',{revision:old.revision})).body.archived,true);
  assert.equal((await h.request('themes/'+old.id)).status,404);
  assert.equal((await h.request('themes')).body.items.length,1);
  // Routes and methods.
  assert.equal((await h.request('themes/'+copy.id,'DELETE')).status,405);
  assert.equal((await h.request(`themes/${copy.id}/preview`,'POST',{})).status,405);
  assert.equal((await h.request('storefront/theme','POST',{},null)).status,405);
  // Audit trail and grants: archived row kept, no DELETE privilege.
  await assert.rejects(h.db.query('SELECT * FROM audit_events'),/permission denied/,'API role cannot read the audit log');
  await h.db.query('RESET ROLE');
  const actions=(await h.db.query("SELECT action FROM audit_events WHERE entity='themes' ORDER BY id")).rows.map(r=>r.action);
  await h.db.query('SET ROLE jackstudio_api');
  assert.deepEqual(actions,['create','update','duplicate','publish','publish','archive']);
  await assert.rejects(h.db.query('DELETE FROM themes'),/permission denied/);
  await assert.rejects(h.db.query('UPDATE themes SET is_live=true'),/duplicate key|unique|check constraint/,'never two live themes, never a live archived theme');
 }finally{await h.close();}
});

test('theme renderer escapes text, emits only validated colours and works without inline styles',()=>{
 const t=normalizeTheme(PRESETS['jack-studio-2026'].build());
 t.sections[0].settings.heading='<script>alert(1)</script>';t.header[0].settings.messages[0].text='"><img src=x onerror=alert(1)>';
 const data={settings:t.settings,header:t.header,sections:t.sections.map(s=>s.type==='product_tabs'?{...s,tabs:s.settings.tabs.map(()=>[{id:'1',title:'Wallet <b>',handle:'wallet',price_minor:7920,variant_count:2,featured_media_id:'9',colours:['Black','url(x)'],excerpt:'Soft & strong'}])}:s),footer:t.footer};
 const strict=renderThemeBody(data,{'9':'https://api.cloudinary.com/x/9'},{inline:false});
 assert.ok(!strict.includes('<script>alert'));assert.ok(strict.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.ok(!strict.includes('<img src=x'),'attribute injection is escaped');assert.ok(strict.includes('&quot;&gt;&lt;img src=x'));
 assert.ok(!/\sstyle=/.test(strict),'storefront markup has no inline styles (CSP style-src self)');
 assert.match(strict,/data-jt-vars="--cc-accent:#767c82"/);
 assert.match(strict,/From RM79\.20/);assert.ok(!strict.includes('url(x)'),'unsafe swatch value dropped');
 const preview=themeDocument(data,{'9':'https://api.cloudinary.com/x/9'},'https://staging.example');
 assert.match(preview,/style="--cc-accent:#767c82"/);assert.match(preview,/<style>:root\{--jt-background:#f8f4ea/);
 assert.match(themeCss(t.settings),/--jt-heading-font:"Bebas Neue"/);
});

test('virtual showroom shows the built-in Shopify cover until staff choose an image',async()=>{
 const theme=normalizeTheme(PRESETS['jack-studio-2026'].build()),showroom=()=>theme.sections.find(s=>s.type==='showroom');
 assert.match(renderThemeBody(theme,{}),/<img class="vs-cover-img" src="\/theme-assets\/virtual-showroom-cover\.jpg"/);
 showroom().settings.image_id='9';
 const html=renderThemeBody(theme,{'9':'https://api.cloudinary.com/x.jpg'});
 assert.ok(html.includes('https://api.cloudinary.com/x.jpg')&&!html.includes('virtual-showroom-cover'));
 const {stat}=await import('node:fs/promises');assert.ok((await stat(new URL('../web/theme-assets/virtual-showroom-cover.jpg',import.meta.url))).size>10000);
});

test('virtual showroom: the 3D showroom is embedded from this site; other links keep the cover link',()=>{
 const theme=normalizeTheme(PRESETS['jack-studio-2026'].build()),s=theme.sections.find(x=>x.type==='showroom');
 let html=renderThemeBody(theme,{});
 assert.match(html,/<div class="vs-stage" data-showroom="\/showroom\/"/,'old GitHub Pages address maps to /showroom/');
 assert.ok(!html.includes('github.io')&&html.includes('Loading showroom…')&&html.includes('class="vs-hint"'));
 s.settings.link='https://example.com/tour';html=renderThemeBody(theme,{});
 assert.ok(!html.includes('data-showroom')&&html.includes('href="https://example.com/tour"'));
});
