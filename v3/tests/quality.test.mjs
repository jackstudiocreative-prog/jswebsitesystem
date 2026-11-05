import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {testGateway,responseHash2} from '../src/payments.mjs';
import {robots} from '../src/seo.mjs';
import {renderEmail} from '../src/email.mjs';

const SECRET='q'.repeat(40),gateway=testGateway({provider:'mock',serviceId:'JSMOCK',password:SECRET,actionUrl:'https://pay.test/mock',baseUrl:'https://shop.test'});
async function harness(options={}){
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true)");await db.query('SET ROLE jackstudio_api');
 const pool={connect:async()=>({...sql,release(){}})},server=createServer(handler(pool,async sub=>({sub,aal:'aal2'}),{payments:gateway,baseUrl:'https://shop.test',...options}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+server.address().port;
 const request=async(path,method='GET',body,token='editor')=>{const h={'Content-Type':'application/json'};if(token)h.Authorization='Bearer '+token;const r=await fetch(root+'/api/v3/'+path,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});const t=await r.text();let j;try{j=JSON.parse(t);}catch{j=t;}return {status:r.status,body:j,headers:r.headers};};
 const c=(await request('collections','POST',{title:'Shop',status:'active'})).body;
 const p=(await request('products','POST',{title:'Wallet & Co <Classic>',status:'active',collection_ids:[String(c.id)],sku:'W-1',price_minor:4500,inventory:20})).body;
 await request('products','POST',{title:'Hidden draft',status:'draft',collection_ids:[String(c.id)]});
 const variant=(await request('products/'+p.id)).body.variants[0];
 return {db,root,request,variant,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
const customer=(email='buyer@example.com')=>({name:'Buyer',email,phone:'0123456789',address_line1:'1 Jalan',city:'Klang',postcode:'41000',state:'Selangor'});
const checkoutBody=(variant,email,extra={})=>({idempotency_key:randomUUID(),access_token:randomBytes(24).toString('base64url'),customer:customer(email),lines:[{variant_id:variant.id,quantity:1}],...extra});

test('public endpoints are rate limited across requests, even when the request itself fails',async()=>{
 const {request,variant,close}=await harness();
 try{
  // Per email: 5 per hour (invalid requests still count).
  const sameEmail=[];for(let i=0;i<6;i++)sameEmail.push((await request('storefront/checkout','POST',{customer:customer('same@example.com')},null)).status);
  assert.deepEqual(sameEmail,[400,400,400,400,400,429]);
  // Per client: 10 per 10 minutes.
  const perIp=[];for(let i=0;i<5;i++)perIp.push((await request('storefront/checkout','POST',checkoutBody(variant,`ip${i}@example.com`),null)).status);
  assert.deepEqual(perIp,[201,201,201,201,429],'six earlier attempts + four orders = ten');
  const r=await request('storefront/checkout','POST',checkoutBody(variant,'late@example.com'),null);assert.equal(r.status,429);assert.match(r.body.error,/Too many requests/);
 }finally{await close();}
});

test('honeypot and per-customer cap on unpaid orders',async()=>{
 const {request,variant,close}=await harness({rateLimits:false});
 try{
  const bot=checkoutBody(variant,'bot@example.com');bot.customer.website='http://spam.example';
  assert.equal((await request('storefront/checkout','POST',bot,null)).status,400);
  const statuses=[];for(let i=0;i<4;i++)statuses.push((await request('storefront/checkout','POST',checkoutBody(variant,'Hoarder@Example.com'),null)).status);
  assert.deepEqual(statuses,[201,201,201,429],'max 3 unpaid orders per email (case-insensitive)');
 }finally{await close();}
});

test('order emails are queued with the change that caused them and visible to staff',async()=>{
 const {db,root,request,variant,close}=await harness({rateLimits:false});
 try{
  const r=(await request('storefront/checkout','POST',checkoutBody(variant,'mail@example.com'),null)).body;
  const f={ServiceID:'JSMOCK',PaymentID:r.payment.fields.PaymentID,OrderNumber:r.order.number,Amount:r.payment.fields.Amount,CurrencyCode:'MYR',TxnID:'T',AuthCode:'A',TxnStatus:'0',Param6:'',Param7:''};
  const callback=()=>fetch(root+'/api/v3/payments/mock/callback',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...f,HashValue2:responseHash2(SECRET,f)}).toString()}).then(x=>x.text());
  assert.equal(await callback(),'OK');assert.equal(await callback(),'OK');
  const id=(await request('orders')).body.items[0].id;let o=(await request('orders/'+id)).body;
  assert.deepEqual(o.emails.map(e=>[e.kind,e.status,e.recipient]),[['order_paid','pending','mail@example.com']],'one confirmation despite duplicate callbacks');
  assert.match(o.emails[0].subject,/is confirmed/);
  o=(await request(`orders/${id}/fulfil`,'POST',{revision:o.revision,tracking_number:'MY99'})).body;
  o=(await request(`orders/${id}/refunds`,'POST',{revision:o.revision,amount_minor:1000,reference:'RF1'})).body;
  assert.deepEqual(o.emails.map(e=>e.kind),['order_paid','order_fulfilled','order_refunded']);
  const body=(await db.query("SELECT body FROM email_outbox WHERE kind='order_fulfilled'")).rows[0].body;assert.match(body,/Tracking number: MY99/);
  assert.equal((await request('dashboard')).body.emails_waiting,3);
  // A failed transaction queues nothing.
  assert.equal((await request(`orders/${id}/refunds`,'POST',{revision:o.revision,amount_minor:999999,reference:'X'})).status,400);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM email_outbox')).rows[0].n,3);
  await assert.rejects(db.query('DELETE FROM email_outbox'),e=>e.code==='42501');
 }finally{await close();}
});

test('emails are plain text and include the order, totals and address',()=>{
 const {subject,body}=renderEmail('order_paid',{number:'JSW50001',customer_name:'Aisyah',subtotal_minor:12900,shipping_minor:0,total_minor:12900,address_line1:'12 Jalan Kota',address_line2:'',postcode:'41000',city:'Klang',state:'Selangor',tracking_number:'',refunded_minor:0},[{quantity:1,title:'Card Holder',variant_title:'Brown',line_total_minor:12900}]);
 assert.equal(subject,'Your Jack Studio order JSW50001 is confirmed');assert.match(body,/1 × Card Holder \(Brown\)/);assert.match(body,/Shipping: Free/);assert.match(body,/41000 Klang/);assert.equal(/<[a-z]/i.test(body),false);
});

test('robots, sitemap and public caching',async()=>{
 assert.equal(robots('https://shop.test',false),'User-agent: *\nDisallow: /\n','staging stays out of search');
 const open=robots('https://shop.test',true);for(const p of ['/admin','/api/','/checkout','/order'])assert.ok(open.includes('Disallow: '+p));assert.ok(open.includes('Sitemap: https://shop.test/sitemap.xml'));
 const {root,request,close}=await harness({rateLimits:false});
 try{
  const page=(await request('pages','POST',{title:'Brand Story'})).body;await request(`pages/${page.id}/publish`,'POST',{revision:page.revision});
  await request('pages','POST',{title:'Unpublished'});
  const xml=await (await fetch(root+'/sitemap.xml')).text();
  assert.ok(xml.includes('<loc>https://shop.test/pages/brand-story</loc>'));assert.ok(xml.includes('<loc>https://shop.test/products/wallet-co-classic</loc>'));
  assert.equal(xml.includes('unpublished'),false);assert.equal(xml.includes('hidden-draft'),false);
  assert.equal((await fetch(root+'/robots.txt')).headers.get('content-type'),'text/plain; charset=utf-8');
  const product=await request('storefront/products/wallet-co-classic','GET',undefined,null);assert.match(product.headers.get('cache-control'),/public/);
  assert.match((await request('storefront/pages/brand-story','GET',undefined,null)).headers.get('cache-control'),/public/);
  assert.equal((await request('products','GET')).headers.get('cache-control'),'no-store','private data never cached');
 }finally{await close();}
});

test('008 is additive and private to the API role',async()=>{
 const db=new PGlite();try{
  await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
  for(const f of ['001_foundation','002_staff_isolation','003_cloudinary','004_catalog_admin','005_variants_inventory','006_website_editor','007_commerce','008_quality'])await db.exec(await readFile(new URL(`../migrations/${f}.sql`,import.meta.url),'utf8'));
  for(const role of ['anon','authenticated'])for(const t of ['rate_limits','email_outbox'])assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT') AS a",[role,t])).rows[0].a,false);
  for(const [t,priv,ok] of [['rate_limits','DELETE',true],['email_outbox','UPDATE',true],['email_outbox','DELETE',false]])assert.equal((await db.query("SELECT has_table_privilege('jackstudio_api',$1,$2) AS a",[t,priv])).rows[0].a,ok);
  await assert.rejects(db.query("INSERT INTO rate_limits VALUES ('checkout:1.2.3.4',now(),1)"),e=>e.code==='23514','raw IPs cannot be stored');
 }finally{await db.close();}
});
