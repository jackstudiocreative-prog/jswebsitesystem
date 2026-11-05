import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {mountAdmin,moneyToMinor} from '../admin/catalog-ui.mjs';
const settle=()=>new Promise(r=>setTimeout(r,30));
test('admin DOM navigates, saves product fields, blocks viewer editing and never renders catalogue HTML',async()=>{
 const {document,window}=parseHTML(await readFile(new URL('../admin/index.html',import.meta.url),'utf8'));globalThis.document=document;globalThis.window=window;window.confirm=()=>true;
 // linkedom does not implement the browser select.value setter.
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.value??this.firstElementChild?.value??'';},set(v){for(const o of this.children)o.toggleAttribute('selected',o.value===String(v));},configurable:true});
 const calls=[],messages=[];let products=[];
 const api=async(path,body,method)=>{calls.push({path,body,method});if(path==='dashboard')return {products:0,active:0,drafts:0,collections:0,media:0};if(path==='products'&&body){products=[{id:'1',...body,revision:1}];return products[0];}if(path==='products/1')return {...products[0],collection_ids:[],media:[]};return {items:path.startsWith('products?')?products:[],total:path.startsWith('products?')?products.length:0};};
 const find=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 const nav=async name=>{document.querySelector(`[data-view="${name}"]`).click();await settle();};
 let ui=mountAdmin(api,'editor',m=>messages.push(m));await ui.reload();assert.match(document.getElementById('admin-content').textContent,/No|not connected/);
 await nav('Products');find('Add product').click();await settle();
 const form=document.querySelector('.editor-grid');assert.ok(form);const field=label=>[...form.querySelectorAll('label')].find(n=>n.textContent.startsWith(label)).querySelector('input,textarea');
 field('Title').value='<img src=x onerror=alert(1)>';field('Price').value='12.34';field('SKU').value='TEST-1';field('Inventory').value='4';
 form.dispatchEvent(new window.Event('submit',{cancelable:true}));await settle();
 const saved=calls.find(c=>c.path==='products'&&c.body);assert.equal(saved.body.price_minor,1234);assert.equal(saved.body.inventory,4);assert.equal(saved.body.status,'draft');assert.equal(document.querySelectorAll('#admin-content img').length,0);assert.match(document.getElementById('admin-content').textContent,/<img src=x/);
 await nav('Orders');assert.match(document.getElementById('admin-content').textContent,/not implemented/);
 await nav('Media Library');assert.equal(document.getElementById('media-upload').hidden,false);
 ui.destroy();ui=mountAdmin(api,'viewer',()=>{});await nav('Products');assert.equal(find('Add product').disabled,true);find('View').click();await settle();assert.equal(find('Save product').disabled,true);assert.ok([...document.querySelectorAll('.editor-grid input')].every(n=>n.disabled));ui.destroy();delete globalThis.document;delete globalThis.window;
});
test('MYR price parsing avoids floating-point rounding and rejects invalid values',()=>{assert.equal(moneyToMinor('19.99'),1999);assert.equal(moneyToMinor('0.01'),1);for(const value of ['-1','1.001','NaN','1e3','99999999'])assert.throws(()=>moneyToMinor(value));});
test('all auth action targets exist in real HTML, preserving invitation and recovery controls',async()=>{const html=await readFile(new URL('../admin/index.html',import.meta.url),'utf8'),app=await readFile(new URL('../admin/app.mjs',import.meta.url),'utf8');const {document}=parseHTML(html);for(const [,id]of app.matchAll(/\$\('([^']+)'\)|action\('([^']+)'/g)){if(id)assert.ok(document.getElementById(id),id);}for(const id of ['set-invite-password','update-password','refresh','upload','logout'])assert.ok(document.getElementById(id));});
