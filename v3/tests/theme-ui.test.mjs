import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {mountAdmin} from '../admin/catalog-ui.mjs';
import {PRESETS,normalizeTheme} from '../shared/theme-schema.mjs';
const settle=(ms=40)=>new Promise(r=>setTimeout(r,ms));

async function dom(){
 const {document,window}=parseHTML(await readFile(new URL('../admin/index.html',import.meta.url),'utf8'));globalThis.document=document;globalThis.window=window;window.confirm=()=>true;window.prompt=()=>'Renamed theme';
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.value??this.firstElementChild?.value??'';},set(v){for(const o of this.children)o.toggleAttribute('selected',o.value===String(v));},configurable:true});
 return {document,window,find:text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text),label:aria=>document.querySelector(`button[aria-label="${aria}"]`)};
}
function fakeApi(){
 const calls=[],content=normalizeTheme(PRESETS['jack-studio-2026'].build());
 let themes=[{id:'1',name:'Jack Studio 2026',preset:'jack-studio-2026',is_live:true,revision:3,updated_at:'2026-11-13T04:00:00Z',published_at:'2026-11-13T04:00:00Z',content},
  {id:'2',name:'Spring',preset:'jack-studio-2026',is_live:false,revision:1,updated_at:'2026-11-12T04:00:00Z',published_at:null,content:structuredClone(content)}];
 const api=async(path,body,method)=>{calls.push({path,body,method});
  if(path==='themes'&&!body)return {items:themes.map(({content,...t})=>t),presets:[{id:'jack-studio-2026',label:'Jack Studio 2026'}],max:20};
  if(path==='themes'&&body){const t={...themes[0],id:'3',name:'Jack Studio 2026',is_live:false,revision:1};themes.push(t);return t;}
  const m=path.match(/^themes\/(\d)$/);
  if(m&&!body)return themes.find(t=>t.id===m[1]);
  if(m&&method==='PATCH'){const t=themes.find(x=>x.id===m[1]);Object.assign(t,body,{revision:t.revision+1});return t;}
  if(path==='themes/preview-pages'){const pg=body.page??'home',t=body.content.templates??{};const all=body.page?[pg]:['home','outlets','_frame'];return {pages:Object.fromEntries(all.map(k=>[k,{header:`<p class="hdr">${t.header?.sections?.['jack-header']?.settings?.logo_text??'Header'}</p>`,html:`<h1>${t[k]?.title??k}</h1>${(t[k]?.order??[]).map(id=>`<section>${id}</section>`).join('')}`,footer:'<p>Footer</p>',scripts:[]}]))};}
  if(/^themes\/\d\/preview\?page=/.test(path))return {theme:content,media:{},page:{header:'<p>Saved header</p>',html:'<h1>Saved '+path.split('=')[1]+'</h1>',footer:''}};
  if(path==='themes/preview')return {theme:{...body.content,header:body.content.header.filter(s=>!s.hidden),sections:body.content.sections.filter(s=>!s.hidden)},media:{}};
  if(/^themes\/\d\/preview$/.test(path))return {theme:content,media:{'9':'https://evil.example/x.png'}};
  if(/^themes\/\d\/publish$/.test(path)){themes=themes.map(t=>({...t,is_live:path.startsWith('themes/'+t.id+'/')}));return {};}
  if(/^themes\/\d\/archive$/.test(path)){themes=themes.filter(t=>!path.startsWith('themes/'+t.id+'/'));return {archived:true};}
  if(path.startsWith('collections'))return {items:[{id:7,title:'Wallets',status:'active'}],total:1};
  return {items:[],total:0};};
 return {api,calls,themes:()=>themes};
}

test('Online Store shows the live theme and library; library actions call the API',async()=>{
 const {document,find,label}=await dom(),fake=fakeApi(),messages=[];
 const ui=mountAdmin(fake.api,'editor',m=>messages.push(m));
 try{
  document.querySelector('[data-view="Website"]').click();await settle();
  const text=document.getElementById('admin-content').textContent;
  assert.match(text,/Current theme/);assert.match(text,/Jack Studio 2026/);assert.match(text,/Theme library/);assert.match(text,/Spring/);assert.match(text,/Pages/);
  const frame=document.querySelector('.theme-current iframe');assert.equal(frame.getAttribute('sandbox'),'','preview runs sandboxed without scripts');
  assert.ok(!frame.srcdoc.includes('evil.example'),'only Cloudinary preview URLs reach the frame');
  assert.equal(document.querySelector('.theme-current a.button-link').getAttribute('href'),'/');
  find('Publish').click();await settle();
  assert.ok(fake.calls.some(c=>c.path==='themes/2/publish'&&c.body.revision===1));
  assert.match(messages.at(-1),/Spring is now live/);
  find('Rename').click();await settle();
  assert.ok(fake.calls.some(c=>c.method==='PATCH'&&c.body.name==='Renamed theme'));
  const remove=[...document.querySelectorAll('.theme-row button')].find(b=>b.textContent==='Remove');remove.click();await settle();
  assert.ok(fake.calls.some(c=>c.path.endsWith('/archive')));
  find('Add theme').click();await settle(80);
  assert.ok(fake.calls.some(c=>c.path==='themes'&&c.body?.preset==='jack-studio-2026'));
  assert.match(document.getElementById('admin-content').textContent,/Edit theme/,'a new theme opens in the editor');
 }finally{ui.destroy();}
});

test('theme editor: Shopify header, home sections and footer; edits are previewed and saved in the theme',async()=>{
 const {document,window,find,label}=await dom(),fake=fakeApi();
 const ui=mountAdmin(fake.api,'editor',()=>{});
 try{
  document.querySelector('[data-view="Website"]').click();await settle();
  find('Edit theme').click();await settle(60);
  const groups=[...document.querySelectorAll('.theme-group-title')].map(n=>n.textContent);assert.deepEqual(groups,['Header','Template','Footer']);
  assert.ok(document.querySelector('.theme-preview iframe').srcdoc.includes('<p class="hdr">'),'the preview is the whole page from the server');
  // Header: change the announcement text (Shopify header settings).
  [...document.querySelectorAll('.theme-tree-open')][0].click();await settle();
  const ann=[...document.querySelectorAll('.theme-form label')].find(l=>l.textContent.startsWith('Fallback logo text'));assert.ok(ann,'header setting from the Shopify schema');
  const input=ann.querySelector('input');input.value='FREE ENGRAVING';input.dispatchEvent(new window.Event('input'));
  label('Close settings').click();await settle();
  // Template: hide and move a home section.
  const names=[...document.querySelectorAll('.theme-tree-name')].map(n=>n.textContent);
  const second=names[2];label('Hide '+second).click();await settle();
  label('Move up '+second).click();await settle(700);
  const post=fake.calls.filter(c=>c.path==='themes/preview-pages').at(-1);assert.ok(post,'unsaved edits are previewed');
  const c=post.body.content;assert.equal(c.templates.header.sections['jack-header'].settings.logo_text,'FREE ENGRAVING');
  assert.equal(c.templates.home.sections[c.templates.home.order[0]].disabled,true,'moved up and hidden');
  assert.ok(document.querySelector('.theme-preview iframe').srcdoc.includes('FREE ENGRAVING'));
  find('Save').click();await settle();
  const save=fake.calls.find(x=>x.method==='PATCH');assert.equal(save.path,'themes/1');assert.equal(save.body.revision,3);assert.equal(save.body.content.templates.header.sections['jack-header'].settings.logo_text,'FREE ENGRAVING');
 }finally{ui.destroy();}
});

test('viewers open the editor read-only and see the saved page',async()=>{
 const {document,find}=await dom(),fake=fakeApi();
 const ui=mountAdmin(fake.api,'viewer',()=>{});
 try{
  document.querySelector('[data-view="Website"]').click();await settle();
  assert.equal(find('Publish').disabled,true);assert.equal(find('Add theme').disabled,true);
  find('View theme').click();await settle(60);
  [...document.querySelectorAll('.theme-tree-open')][0].click();await settle();
  assert.ok([...document.querySelectorAll('.theme-form input')].every(i=>i.disabled));
  assert.equal(find('Save').disabled,true);
  assert.ok(fake.calls.some(c=>c.path==='themes/1/preview?page=home'));assert.ok(!fake.calls.some(c=>c.path==='themes/preview-pages'),'viewers never post previews');
  assert.ok(document.querySelector('.theme-preview iframe').srcdoc.includes('Saved home'));
 }finally{ui.destroy();}
});

test('pages stay usable when the themes service is unavailable (e.g. before migration 009)',async()=>{
 const {document}=await dom(),messages=[];
 const api=async path=>{if(path==='themes')throw Error('Internal server error');if(path.startsWith('pages?'))return {items:[],total:0};return {items:[],total:0};};
 const ui=mountAdmin(api,'editor',m=>messages.push(m));
 try{
  document.querySelector('[data-view="Website"]').click();await settle();
  const text=document.getElementById('admin-content').textContent;
  assert.match(text,/Themes are unavailable right now/);assert.match(text,/Create a page/);
 }finally{ui.destroy();}
});

test('Preview opens the storefront in preview mode with every page, including unsaved edits',async()=>{
 const {document,window,find}=await dom(),fake=fakeApi(),store=new Map();let opened=null;
 window.localStorage={setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k)??null};window.open=url=>{opened=url;return {};};
 const ui=mountAdmin(fake.api,'editor',()=>{});
 try{
  document.querySelector('[data-view="Website"]').click();await settle();
  find('Edit theme').click();await settle(60);
  [...document.querySelectorAll('.theme-tree-open')][0].click();await settle();
  const ann=[...document.querySelectorAll('.theme-form label')].find(l=>l.textContent.startsWith('Fallback logo text')).querySelector('input');ann.value='Preview me';ann.dispatchEvent(new window.Event('input'));
  find('Preview').click();await settle(80);
  assert.equal(opened,'/?theme_preview=1');
  const saved=JSON.parse(store.get('jt-theme-preview'));
  assert.match(saved.pages.home.header,/Preview me/,'unsaved edits are previewed');assert.ok(saved.pages.outlets&&saved.pages._frame,'every page is handed over');
  assert.match(saved.name,/unsaved changes/);assert.ok(saved.expires>Date.now());
 }finally{ui.destroy();delete window.open;delete window.localStorage;}
});

test('the editor switches to another page, edits its Shopify sections and saves them in the theme',async()=>{
 const {document,window,find,label}=await dom(),fake=fakeApi(),base=fake.api,posts=[];
 const api=async(path,body,method)=>{if(path==='themes/preview-pages'){posts.push(body);return {pages:{[body.page]:{html:`<h1>${body.content.templates?.[body.page]?.title??'Default'}</h1>`,scripts:[]}}};}return base(path,body,method);};
 const ui=mountAdmin(api,'editor',()=>{});
 try{
  document.querySelector('[data-view="Website"]').click();await settle();
  find('Edit theme').click();await settle(60);
  const pick=document.querySelector('select[aria-label="Page to edit"]');assert.ok([...pick.options].some(o=>o.value==='outlets'));
  pick.value='privacy-policy';pick.dispatchEvent(new window.Event('change'));await settle(80);
  assert.ok(document.querySelector('.theme-preview iframe').srcdoc.includes('<h1>Default</h1>'),'page preview uses the server-rendered sections');
  assert.ok([...document.querySelectorAll('.theme-tree-name')].some(n=>/Policy Page/.test(n.textContent)));
  find('Page title and text').click();await settle();
  const title=[...document.querySelectorAll('.theme-form label')].find(l=>l.textContent.startsWith('Page title'));
  title.querySelector('input').value='Privacy Notice';title.querySelector('input').dispatchEvent(new window.Event('input'));await settle(700);
  assert.equal(posts.at(-1).content.templates['privacy-policy'].title,'Privacy Notice');assert.ok(document.querySelector('.theme-preview iframe').srcdoc.includes('<h1>Privacy Notice</h1>'));
  find('Save').click();await settle();
  assert.equal(fake.calls.find(c=>c.method==='PATCH').body.content.templates['privacy-policy'].title,'Privacy Notice');
 }finally{ui.destroy();}
});
