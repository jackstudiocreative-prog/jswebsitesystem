import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {mountAdmin} from '../admin/catalog-ui.mjs';
import {renderPage,previewDocument} from '../admin/page-render.mjs';
const settle=(ms=40)=>new Promise(r=>setTimeout(r,ms));

test('renderer escapes all content and never emits private URLs it was not given',()=>{
 const html=renderPage({sections:[
  {id:'a',type:'hero',hidden:false,settings:{eyebrow:'',heading:'<script>alert(1)</script>',body:'"quoted"',media_id:'9',cta_label:'Go',cta_href:'/x" onmouseover="1',align:'left'}},
  {id:'b',type:'banner',hidden:true,settings:{text:'Hidden banner',cta_label:'',cta_href:'',theme:'dark'}},
  {id:'c',type:'product_grid',hidden:false,settings:{heading:'Grid',body:'',source:'collection',collection_id:null,product_ids:[],limit:8,cta_label:'',cta_href:''},products:[{id:'1',title:'Card <b>Holder</b>',handle:'card-holder',price_minor:12900,variant_count:3,featured_media_id:null}]}
 ]},{});
 assert.equal(html.includes('<script>'),false);assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(html.includes('href="/x&quot; onmouseover=&quot;1"'),'attribute stays quoted');
 assert.equal(html.includes('Hidden banner'),false);assert.ok(html.includes('From RM'));assert.ok(html.includes('Card &lt;b&gt;Holder&lt;/b&gt;'));
 assert.ok(html.includes('js-image-placeholder'),'missing image renders a placeholder');
 assert.match(previewDocument({title:'T',sections:[]},{}),/This page has no visible sections/);
});

test('website editor builds sections, previews unsaved edits and saves through the real admin markup',async()=>{
 const {document,window}=parseHTML(await readFile(new URL('../admin/index.html',import.meta.url),'utf8'));globalThis.document=document;globalThis.window=window;window.confirm=()=>true;
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.value??this.firstElementChild?.value??'';},set(v){for(const o of this.children)o.toggleAttribute('selected',o.value===String(v));},configurable:true});
 const calls=[];let page={id:'3',slug:'home',title:'Home',seo_title:'',seo_description:'',status:'draft',revision:4,published_revision_id:null,sections:[{id:'s1',type:'rich_text',hidden:false,settings:{heading:'Hello',body:'Copy',align:'left'}}],revisions:[],redirects:[]};
 const api=async(path,body,method)=>{calls.push({path,body,method});
  if(path.startsWith('pages?'))return {items:[{...page,section_count:1,updated_at:'2026-11-05T03:00:00Z',live_number:null}],total:1};
  if(path==='pages/3'&&!body)return page;
  if(path==='pages/preview')return {page:{title:body.title,sections:body.sections.filter(s=>!s.hidden)},media:{}};
  if(path==='pages/3'&&method==='PATCH'){page={...page,...body,revision:5};return page;}
  if(path==='pages/3/publish')return {...page,status:'published'};
  return {items:[],total:0};};
 const find=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 const ui=mountAdmin(api,'editor',()=>{});
 try{
  document.querySelector('[data-view="Website"]').click();await settle();
  assert.match(document.getElementById('admin-content').textContent,/\/pages\/home/);
  find('Edit').click();await settle();
  assert.equal(document.querySelectorAll('.section-item').length,1);
  // Add a banner, edit it, hide the first section, reorder.
  const add=document.querySelector('.section-adder select');add.value='banner';find('Add section').click();await settle();
  assert.equal(document.querySelectorAll('.section-item').length,2);
  const text=[...document.querySelectorAll('.section-form label')].find(l=>l.textContent.startsWith('Text')).querySelector('input');text.value='Free personalisation';text.dispatchEvent(new window.Event('input'));
  document.querySelector('button[aria-label="Hide Text section 1"]').click();await settle();
  document.querySelector('button[aria-label="Move up Banner section 2"]').click();await settle(700);
  const preview=calls.filter(c=>c.path==='pages/preview').at(-1);assert.ok(preview,'unsaved edits previewed');
  assert.deepEqual(preview.body.sections.map(s=>[s.type,s.hidden]),[['banner',false],['rich_text',true]]);
  assert.ok(document.querySelector('.preview-stage iframe').getAttribute('sandbox')!==null,'preview is sandboxed');
  assert.match(document.querySelector('.preview-stage iframe').srcdoc,/Free personalisation/);
  assert.equal(calls.some(c=>c.method==='PATCH'),false,'nothing saved yet');
  find('Publish').click();await settle(80);
  const saved=calls.find(c=>c.method==='PATCH');assert.equal(saved.body.revision,4);assert.equal(saved.body.sections[0].settings.text,'Free personalisation');
  assert.deepEqual(calls.find(c=>c.path==='pages/3/publish').body,{revision:5},'publish uses the saved revision');
 }finally{ui.destroy();delete globalThis.document;delete globalThis.window;}
});
