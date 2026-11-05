import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {mountAdmin} from '../admin/catalog-ui.mjs';
const settle=()=>new Promise(r=>setTimeout(r,40));
test('variant editor, paged media picker and inventory view use real markup and never load the whole library',async()=>{
 const {document,window}=parseHTML(await readFile(new URL('../admin/index.html',import.meta.url),'utf8'));globalThis.document=document;globalThis.window=window;window.confirm=()=>true;
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.value??this.firstElementChild?.value??'';},set(v){for(const o of this.children)o.toggleAttribute('selected',o.value===String(v));},configurable:true});
 const calls=[];
 const product={id:'7',title:'Card Holder',description:'',status:'active',revision:3,collection_ids:[],option_names:['Color'],featured_media_id:'1',media:[{media_id:'1',alt:'Brown',label:'brown.jpg'}],
  variants:[{id:'11',option_values:['Brown'],sku:'CH-BRN',price_minor:12900,inventory:3,active:true,media_id:'1',stock_status:'low'},{id:'12',option_values:['Black'],sku:'CH-BLK',price_minor:12900,inventory:0,active:true,media_id:null,stock_status:'out'}]};
 const api=async(path,body,method)=>{calls.push({path,body,method});
  if(path==='products/7'&&!body)return product;
  if(path.startsWith('media?'))return {items:[{id:'1',label:'brown.jpg',object_key:'k/1',format:'jpg'},{id:'2',label:'black.jpg',object_key:'k/2',format:'jpg'}],total:30,limit:12,offset:0};
  if(path.startsWith('media/previews'))return {items:[{id:'1',url:'https://api.cloudinary.com/x/1'},{id:'2',url:'https://evil.example/2'}]};
  if(path==='inventory/adjustments'&&body)return {adjustment:{id:'1'},variant:{...product.variants[0],inventory:8,stock_status:'in'}};
  if(path.startsWith('inventory?'))return {items:[{...product.variants[0],product_id:'7',product_title:'Card Holder',option_names:['Color']}],total:1,limit:25,offset:0,low_stock_at:5};
  return {items:[],total:0};};
 const find=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 const messages=[];const ui=mountAdmin(api,'editor',m=>messages.push(m));
 try{
  document.querySelector('[data-view="Inventory"]').click();await settle();
  assert.match(document.getElementById('admin-content').textContent,/Low stock/);
  find('Edit product').click();await settle();
  const rows=document.querySelectorAll('.variant-table tbody tr');assert.equal(rows.length,2);
  assert.match(rows[1].textContent,/Out of stock/);
  assert.ok(!calls.some(c=>/^media(\?|$)/.test(c.path)),'editor does not load the media library up front');
  // Stock adjustment sends the reason, and counted quantities include the stock the employee saw.
  rows[0].querySelector('button').click();await settle();
  const panel=document.querySelector('.adjust-panel');panel.querySelector('select').value='set';panel.querySelector('input[type=number]').value='8';
  panel.querySelectorAll('select')[1].value='stocktake';panel.dispatchEvent(new window.Event('submit',{cancelable:true}));await settle();
  const adj=calls.find(c=>c.path==='inventory/adjustments'&&c.body);assert.deepEqual(adj.body,{variant_id:'11',reason:'stocktake',note:'',set_to:8,expected:3});
  // Picker loads one filtered page and one batched preview request; untrusted preview hosts are dropped.
  find('Choose from library').click();await settle();
  const page=calls.find(c=>c.path.startsWith('media?'));const q=new URLSearchParams(page.path.split('?')[1]);
  assert.equal(q.get('limit'),'12');assert.equal(q.get('status'),'ready');
  assert.equal(calls.filter(c=>c.path.startsWith('media/previews')).length,2,'one batch for selected images, one for the picker page');
  const items=document.querySelectorAll('.picker-item');assert.equal(items[0].querySelector('input').disabled,true,'already-added image');
  assert.equal(document.querySelectorAll('.picker-item img[src^="https://evil"]').length,0);
  items[1].querySelector('input').checked=true;items[1].querySelector('input').dispatchEvent(new window.Event('change'));
  find('Add selected (1)').click();await settle();
  document.querySelector('.editor-grid').dispatchEvent(new window.Event('submit',{cancelable:true}));await settle();
  const saved=calls.find(c=>c.path==='products/7'&&c.method==='PATCH');
  assert.deepEqual(saved.body.option_names,['Color']);assert.equal(saved.body.featured_media_id,'1');
  assert.deepEqual(saved.body.media.map(m=>m.media_id),['1','2']);
  assert.deepEqual(saved.body.variants.map(v=>[v.id,v.sku,v.price_minor,v.inventory]),[['11','CH-BRN',12900,undefined],['12','CH-BLK',12900,undefined]],'existing stock is never sent in a save');
  assert.equal(saved.body.revision,3);
 }finally{ui.destroy();delete globalThis.document;delete globalThis.window;}
});
