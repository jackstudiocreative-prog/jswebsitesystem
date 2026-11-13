import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {mountAdmin} from '../admin/catalog-ui.mjs';
import {PRESETS,normalizeTheme} from '../shared/theme-schema.mjs';
const settle=(ms=40)=>new Promise(r=>setTimeout(r,ms));
async function dom(){
 const {document,window}=parseHTML(await readFile(new URL('../admin/index.html',import.meta.url),'utf8'));globalThis.document=document;globalThis.window=window;window.confirm=()=>true;
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.value??this.firstElementChild?.value??'';},set(v){for(const o of this.children)o.toggleAttribute('selected',o.value===String(v));},configurable:true});
 return {document,find:text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)};
}

test('Media Library imports the Shopify library in batches and reports failures',async()=>{
 const {document,find}=await dom(),messages=[],posts=[];
 let pending=['files/a.png','files/b.png','files/c.png','products/d.jpg','products/e.jpg'];
 const api=async(path,body,method)=>{
  if(path==='media/import'&&!body)return {total:6,imported:6-pending.length,pending:[...pending],batch:2};
  if(path==='media/import'){posts.push(body.paths);const items=body.paths.map(p=>p==='files/c.png'?{path:p,status:'failed',error:'Image exceeds allowed format, size or dimensions'}:{path:p,status:'imported',media_id:'1'});pending=pending.filter(p=>!items.some(i=>i.path===p&&i.status==='imported'));return {items};}
  return {items:[],total:0};};
 const ui=mountAdmin(api,'editor',m=>messages.push(m));
 try{
  document.querySelector('[data-view="Media Library"]').click();await settle();
  assert.match(document.querySelector('.shopify-import-status').textContent,/1\/6 Shopify images/);
  find('Import from Shopify').click();await settle(120);
  assert.deepEqual(posts,[['files/a.png','files/b.png'],['files/c.png','products/d.jpg'],['products/e.jpg']]);
  assert.match(messages.at(-1),/1 images could not be imported/);
  assert.match(document.getElementById('admin-content').textContent,/c\.png — Image exceeds allowed format/);
  assert.match(document.querySelector('.shopify-import-status').textContent,/5\/6 Shopify images/);
 }finally{ui.destroy();}
});

test('viewers see import progress but cannot start it; themes offer "Auto-fill images"',async()=>{
 const {document,find}=await dom(),messages=[],calls=[];
 const content=normalizeTheme(PRESETS['jack-studio-2026'].build());
 const api=async(path,body,method)=>{calls.push({path,body,method});
  if(path==='media/import')return {total:3,imported:0,pending:['files/a.png','files/b.png','files/c.png'],batch:4};
  if(path==='themes'&&!body)return {items:[{id:'1',name:'Jack Studio 2026',is_live:true,revision:2,updated_at:'2026-11-13T04:00:00Z',published_at:'2026-11-13T04:00:00Z'}],presets:[],max:20};
  if(path==='themes/1/preview')return {theme:content,media:{}};
  if(path==='themes/1/autofill')return {id:'1',revision:3,filled:12};
  return {items:[],total:0};};
 let ui=mountAdmin(api,'viewer',()=>{});
 try{document.querySelector('[data-view="Media Library"]').click();await settle();assert.equal(find('Import from Shopify').disabled,true);}finally{ui.destroy();}
 ui=mountAdmin(api,'editor',m=>messages.push(m));
 try{
  document.querySelector('[data-view="Website"]').click();await settle();
  find('Auto-fill images').click();await settle();
  assert.deepEqual(calls.find(c=>c.path==='themes/1/autofill').body,{revision:2});
  assert.match(messages.at(-1),/filled 12 image slots/);
 }finally{ui.destroy();}
});

test('Media Library shows image thumbnails automatically, one preview request per page',async()=>{
 const {document}=await dom(),calls=[];
 const api=async path=>{calls.push(path);
  if(path==='media/import')return {total:2,imported:2,pending:[],batch:4};
  if(path.startsWith('media/previews'))return {items:[{id:'1',url:'https://api.cloudinary.com/a.png'},{id:'2',url:'https://evil.example/b.png'}]};
  if(path.startsWith('media?'))return {items:[{id:1,label:'JACK_STUDIO.png',object_key:'k/1',width:1600,height:900,bytes:2400000,state:'ready'},{id:2,label:'b.png',object_key:'k/2',width:10,height:10,bytes:500,state:'ready'}],total:2};
  return {items:[],total:0};};
 const ui=mountAdmin(api,'editor',()=>{});
 try{
  document.querySelector('[data-view="Media Library"]').click();await settle(80);
  assert.deepEqual(calls.filter(c=>c.startsWith('media/previews')),['media/previews?ids=1,2']);
  const imgs=[...document.querySelectorAll('.media-thumb img')];assert.equal(imgs.length,1);assert.equal(imgs[0].getAttribute('src'),'https://api.cloudinary.com/a.png');assert.equal(imgs[0].getAttribute('alt'),'JACK_STUDIO.png');
  assert.match(document.getElementById('admin-content').textContent,/1600 × 900 · 2\.4 MB/);assert.match(document.getElementById('admin-content').textContent,/Preview unavailable/);
 }finally{ui.destroy();}
});
