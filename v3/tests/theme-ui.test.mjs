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

test('theme editor edits header menu, sections and settings, previews unsaved changes and saves',async()=>{
 const {document,window,find,label}=await dom(),fake=fakeApi();
 const ui=mountAdmin(fake.api,'editor',()=>{});
 try{
  document.querySelector('[data-view="Website"]').click();await settle();
  find('Edit theme').click();await settle(60);
  assert.equal(document.querySelectorAll('.theme-tree-item').length,11,'2 header + 8 template + 1 footer sections');
  // Header: rename a menu item and add a drop-down entry.
  label('Edit Header').click();await settle();
  const menuLabel=[...document.querySelectorAll('.list-item label')].find(l=>l.textContent.startsWith('Label'));
  menuLabel.querySelector('input').value='Start';menuLabel.querySelector('input').dispatchEvent(new window.Event('input'));
  find('Add to menu').click();await settle();
  assert.match([...document.querySelectorAll('.list-field legend')][0].textContent,/Menu · 8\/10/);
  find('← All sections').click();await settle();
  // Template: hide, reorder and add a section; theme settings colour.
  label('Hide Icon row').click();await settle();
  label('Move up Collection cards').click();await settle();
  document.querySelector('select[aria-label="Section to add to Template · Home page"]').value='rich_text';
  [...document.querySelectorAll('button')].filter(b=>b.textContent==='Add section').at(-1).click();await settle();
  const body=[...document.querySelectorAll('.theme-form label')].find(l=>l.textContent.startsWith('Text'));
  body.querySelector('textarea').value='Hand-finished in Klang.';body.querySelector('textarea').dispatchEvent(new window.Event('input'));
  find('← All sections').click();await settle();
  find('Theme settings').click();await settle();
  const accent=[...document.querySelectorAll('.theme-form label')].find(l=>l.textContent.startsWith('Buttons'));
  accent.querySelector('input').value='#8DA68A';accent.querySelector('input').dispatchEvent(new window.Event('input'));
  await settle(700);
  const preview=fake.calls.filter(c=>c.path==='themes/preview').at(-1);assert.ok(preview,'unsaved edits are previewed');
  const c=preview.body.content;
  assert.equal(c.header[1].settings.menu[0].label,'Start');assert.equal(c.header[1].settings.menu.length,8);
  assert.equal(c.sections.find(s=>s.type==='icon_row').hidden,true);
  assert.deepEqual(c.sections.slice(0,3).map(s=>s.type),['hero_banner','collection_cards','icon_row']);
  assert.equal(c.sections.at(-1).type,'rich_text');assert.equal(c.sections.at(-1).settings.body,'Hand-finished in Klang.');
  assert.equal(c.settings.accent,'#8da68a');
  assert.ok(document.querySelector('.theme-preview iframe').srcdoc.includes('Hand-finished in Klang.'));
  find('Save').click();await settle();
  const save=fake.calls.find(c=>c.method==='PATCH');assert.equal(save.path,'themes/1');assert.equal(save.body.revision,3);assert.equal(save.body.content.settings.accent,'#8da68a');
 }finally{ui.destroy();}
});

test('viewers can open the editor read-only and preview the saved theme',async()=>{
 const {document,find,label}=await dom(),fake=fakeApi();
 const ui=mountAdmin(fake.api,'viewer',()=>{});
 try{
  document.querySelector('[data-view="Website"]').click();await settle();
  assert.equal(find('Publish').disabled,true);assert.equal(find('Add theme').disabled,true);
  find('View theme').click();await settle(60);
  label('View Header').click();await settle();
  assert.ok([...document.querySelectorAll('.theme-form input')].every(i=>i.disabled));
  assert.equal(find('Save').disabled,true);
  assert.ok(fake.calls.some(c=>c.path==='themes/1/preview'));assert.ok(!fake.calls.some(c=>c.path==='themes/preview'),'viewers never post previews');
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
