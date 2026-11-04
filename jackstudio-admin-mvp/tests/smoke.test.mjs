import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const project= fileURLToPath(new URL('../server.mjs',import.meta.url));
const tmp=await mkdtemp(join(tmpdir(),'js-commerce-test-'));
const port=32000+Math.floor(Math.random()*10000);
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[project],{env:{...process.env,PORT:String(port),DATA_DIR:tmp,ADMIN_EMAIL:'test@jackstudio.local',ADMIN_PASSWORD:'TestPassword!2026'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',b=>output+=b.toString());child.stderr.on('data',b=>output+=b.toString());
async function ready(){for(let i=0;i<80;i++){try{const r=await fetch(base+'/api/storefront');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('App failed to start: '+output);}
await ready();
let cookie='';
async function req(path,method='GET',data){const headers={};if(cookie)headers.Cookie=cookie;if(data!==undefined)headers['Content-Type']='application/json';const res=await fetch(base+'/api'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});return {status:res.status,data:await res.json(),headers:res.headers};}
test('First-run storefront and authentication',async()=>{
 let r=await req('/storefront');assert.equal(r.status,200);assert.equal(r.data.products.length,8);
 r=await req('/dashboard');assert.equal(r.status,401);
 r=await req('/login','POST',{email:'test@jackstudio.local',password:'TestPassword!2026'});assert.equal(r.status,200);cookie=r.headers.get('set-cookie')?.split(';')[0]||'';assert.match(cookie,/js_session=/);
 r=await req('/session');assert.equal(r.data.email,'test@jackstudio.local');
});
test('Products CRUD and storefront synchronization',async()=>{
 let r=await req('/products','POST',{title:'Test Demo Belt',sku:'JS-TEST-000',price_cents:15900,inventory:3,status:'active'});assert.equal(r.status,201);const id=r.data.id;
 r=await req('/storefront');assert.ok(r.data.products.some(p=>p.id===id));
 r=await req(`/products/${id}`,'PUT',{price_cents:17900,inventory:8});assert.equal(r.status,200);assert.equal(r.data.inventory,8);
 r=await req(`/products/${id}`,'DELETE');assert.equal(r.status,200);
 r=await req('/storefront');assert.ok(!r.data.products.some(p=>p.id===id));
});
test('Customers, orders, page editor and settings',async()=>{
 let r=await req('/customers');assert.equal(r.status,200);assert.equal(r.data.length,5);
 r=await req('/orders');assert.equal(r.data.length,8);const id=r.data[0].id;
 r=await req(`/orders/${id}`,'PATCH',{status:'fulfilled'});assert.equal(r.status,200);
 r=await req('/pages');const page=r.data.find(p=>p.slug==='brand-story');assert.ok(page);
 r=await req(`/pages/${page.id}`,'PUT',{content:'Hello from the database',is_published:1});assert.equal(r.status,200);
 r=await req('/storefront');assert.notEqual(r.data.pages.find(p=>p.slug==='brand-story').content,'Hello from the database');
 r=await req(`/pages/${page.id}/publish`,'POST');assert.equal(r.status,200);
 r=await req('/storefront');assert.equal(r.data.pages.find(p=>p.slug==='brand-story').content,'Hello from the database');
 r=await req(`/pages/${page.id}/unpublish`,'POST');assert.equal(r.status,200);
 r=await req('/storefront');assert.ok(!r.data.pages.some(p=>p.slug==='brand-story'));
 r=await req('/settings','PUT',{hero_title:'TEST HERO'});assert.equal(r.data.hero_title,'TEST HERO');
});
test('Collections CRUD, rename propagation and protected deletion',async()=>{
 let r=await req('/collections');assert.equal(r.status,200);assert.ok(r.data.some(c=>c.title==='Urban Carry'));
 r=await req('/collections','POST',{title:'New Test Collection',slug:'new-test-collection',description:'Test collection',status:'draft'});
 assert.equal(r.status,201);const id=r.data.id;
 r=await req('/products','POST',{title:'Test Collection Wallet',sku:'JS-COL-999',category:'New Test Collection',price_cents:5000,inventory:3,status:'draft'});
 assert.equal(r.status,201);const productId=r.data.id;
 r=await req(`/collections/${id}`,'PUT',{title:'Renamed Test Collection',description:'Renamed',status:'active'});
 assert.equal(r.status,200);assert.equal(r.data.title,'Renamed Test Collection');
 r=await req('/products');assert.equal(r.data.find(p=>p.id===productId).category,'Renamed Test Collection');
 r=await req(`/collections/${id}`,'DELETE');assert.equal(r.status,409);
 r=await req(`/collections/${id}`,'PUT',{status:'draft'});assert.equal(r.status,200);
 r=await req(`/products/${productId}`,'PUT',{status:'active'});assert.equal(r.status,200);
 r=await req('/storefront');assert.ok(!r.data.products.some(p=>p.id===productId),'draft collection hidden from storefront');
 r=await req(`/collections/${id}`,'PUT',{status:'active'});assert.equal(r.status,200);
 r=await req('/storefront');assert.ok(r.data.products.some(p=>p.id===productId),'active collection visible on storefront');
 r=await req(`/products/${productId}`,'DELETE');assert.equal(r.status,200);
 r=await req(`/collections/${id}`,'DELETE');assert.equal(r.status,200);
 r=await req('/collections');assert.ok(!r.data.some(c=>c.id===id));
});

test('Website Page revisions can be restored as unpublished drafts',async()=>{
 let r=await req('/pages');const p=r.data.find(x=>x.slug==='brand-story');assert.ok(p);
 const oldContent=p.content;
 r=await req(`/pages/${p.id}/revisions`);assert.equal(r.status,200);assert.ok(r.data.length>=1);
 const previousId=r.data[0].id;
 r=await req(`/pages/${p.id}`,'PUT',{title:'Updated Brand Story',content:'Published test version',seo_title:'Test SEO'});assert.equal(r.status,200);
 r=await req(`/pages/${p.id}/publish`,'POST');assert.equal(r.status,200);
 r=await req(`/pages/${p.id}/revisions`);assert.equal(r.status,200);assert.ok(r.data.length>=2);
 r=await req(`/pages/${p.id}/revisions/${previousId}/restore`,'POST');assert.equal(r.status,200);
 assert.equal(r.data.draft_content,oldContent);assert.equal(r.data.has_unpublished_changes,1);
 // Public API still returns the latest published version until Publish is clicked again.
 r=await req('/storefront');assert.equal(r.data.pages.find(x=>x.slug==='brand-story').content,'Published test version');
 r=await req(`/pages/${p.id}/publish`,'POST');assert.equal(r.status,200);
 r=await req('/storefront');assert.equal(r.data.pages.find(x=>x.slug==='brand-story').content,oldContent);
});


test('Image upload, media listing and auth logout',async()=>{
 let r=await req('/media');assert.equal(r.status,200);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9W1Llu0AAAAASUVORK5CYII=','base64');
 const upload=await fetch(base+'/api/media?name=test.png',{method:'POST',headers:{Cookie:cookie,'Content-Type':'image/png'},body:png});
 assert.equal(upload.status,201);const media=await upload.json();assert.match(media.url,/^\/uploads\/.*\.png$/);
 r=await req('/media');assert.equal(r.data.length,1);
 const logout=await req('/logout','POST');assert.equal(logout.status,200);
 const privateRoute=await req('/products');assert.equal(privateRoute.status,401);
});

test('Login throttling rejects repeated invalid credentials',async()=>{
 for(let i=0;i<8;i++){
  const r=await req('/login','POST',{email:'test@jackstudio.local',password:'wrong-pass'});
  assert.equal(r.status,401);
 }
 const r=await req('/login','POST',{email:'test@jackstudio.local',password:'wrong-pass'});
 assert.equal(r.status,429);
});
test('Public server cannot start with the demo password',()=>{
 const r=spawnSync(process.execPath,[project],{env:{...process.env,HOST:'0.0.0.0',ADMIN_PASSWORD:'',DATA_DIR:tmp},encoding:'utf8',timeout:4000});
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/non-demo ADMIN_PASSWORD/);
});


test.after(async()=>{child.kill();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1000);});await rm(tmp,{recursive:true,force:true});});
