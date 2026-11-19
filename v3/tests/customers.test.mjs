import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {testGateway,responseHash2} from '../src/payments.mjs';
import {parseCsv,csvObjects} from '../shared/csv.mjs';
import {CUSTOMER_HEADERS} from '../shared/customer-columns.mjs';

const SECRET='c'.repeat(40);
async function harness(){
 const db=new PGlite();let count=0;const sql={get count(){return count;},query:(q,args)=>(count++,0)||q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 await migrate(sql);await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");await db.query('SET ROLE jackstudio_api');
 const gateway=testGateway({provider:'mock',serviceId:'JSMOCK',password:SECRET,actionUrl:'https://pay.test',baseUrl:'https://shop.test'});
 const server=createServer(handler({connect:async()=>({...sql,release(){}})},async sub=>({sub,aal:'aal2'}),{payments:gateway,rateLimits:false}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/v3/';
 const request=async(path,method='GET',body,token='editor')=>{const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});const t=await r.text();let j;try{j=JSON.parse(t);}catch{j=t;}return {status:r.status,body:j};};
 return {db,sql,request,base,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
// Shape of Shopify's export (apostrophe-prefixed IDs/phones, yes/no consent, quoted fields).
const CSV=`﻿Customer ID,First Name,Last Name,Email,Accepts Email Marketing,Default Address Company,Default Address Address1,Default Address Address2,Default Address City,Default Address Province Code,Default Address Country Code,Default Address Zip,Default Address Phone,Phone,Accepts SMS Marketing,Total Spent,Total Orders,Note,Tax Exempt,Tags\r
'7001,Mei Jun,Hoo,MeiJun@Example.com,yes,,"12, Jalan Cheras",,Cheras,SGR,MY,'56000,,'+60123456789,no,0.00,1,"Likes ""tan"" colour",no,"vip, gift"\r
'7002,Aresya,Farzana,aresya@example.com,no,,,,Petaling Jaya,SGR,MY,,,,no,85.68,1,,no,\r
'7003,,,ramlijusoh33@gmail.com,no,,,,,,,,,,no,0.00,0,,no,\r
'7004,Bad,Email,not-an-email,no,,,,,,,,,,no,0.00,0,,no,\r
'7005,,,,no,,,,,,,,,,no,0.00,0,,no,\r
`;
const rowsOf=text=>csvObjects(text,CUSTOMER_HEADERS).rows;

test('CSV reader: quotes, escaped quotes, commas and line breaks inside fields, BOM, CRLF',()=>{
 assert.deepEqual(parseCsv('﻿a,b\r\n"x, ""y""","line\nbreak"\r\n\r\n1,'),[['a','b'],['x, "y"','line\nbreak'],['1','']]);
 const {headers,rows}=csvObjects(CSV,CUSTOMER_HEADERS);assert.equal(headers[0],'Customer ID');assert.equal(rows.length,5);assert.equal('Tax Exempt' in rows[0],false,'unused columns not sent');
});

test('Shopify customer import: creates, skips bad rows with line numbers, re-import changes nothing, updates by ID',async()=>{
 const h=await harness();
 try{
  assert.equal((await h.request('customers/import','POST',{rows:rowsOf(CSV)},'viewer')).status,403);
  assert.equal((await h.request('customers/import','POST',{rows:[]})).status,400);
  let r=(await h.request('customers/import','POST',{rows:rowsOf(CSV),first_line:2})).body;
  assert.deepEqual([r.created,r.updated,r.unchanged],[3,0,0]);
  assert.deepEqual(r.skipped,[{line:5,reason:'Email “not-an-email” is not valid'},{line:6,reason:'No email, phone or name'}]);
  const mei=(await h.db.query("SELECT * FROM customers WHERE shopify_customer_id=7001")).rows[0];
  assert.equal(mei.email,'meijun@example.com');assert.equal(mei.phone,'+60123456789');assert.equal(mei.zip,'56000');assert.equal(mei.address1,'12, Jalan Cheras');
  assert.equal(mei.accepts_email_marketing,true);assert.equal(mei.consent_source,'Shopify customer export');assert.ok(mei.consent_recorded_at);
  assert.deepEqual(mei.tags,['vip','gift']);assert.equal(mei.note,'Likes "tan" colour');
  assert.equal(Number((await h.db.query("SELECT shopify_spent_minor FROM customers WHERE shopify_customer_id=7002")).rows[0].shopify_spent_minor),8568);
  r=(await h.request('customers/import','POST',{rows:rowsOf(CSV)})).body;assert.deepEqual([r.created,r.updated,r.unchanged],[0,0,3],'same file again: no duplicates');
  // Unsubscribed in Shopify later: consent follows, with a new timestamp.
  const changed=CSV.replace("'7001,Mei Jun,Hoo,MeiJun@Example.com,yes","'7001,Mei Jun,Hoo,meijun@example.com,no");
  r=(await h.request('customers/import','POST',{rows:rowsOf(changed)})).body;assert.equal(r.updated,1);
  assert.equal((await h.db.query("SELECT accepts_email_marketing FROM customers WHERE shopify_customer_id=7001")).rows[0].accepts_email_marketing,false);
  // An email used by another Shopify customer is not merged.
  r=(await h.request('customers/import','POST',{rows:[{'Customer ID':'9999','Email':'aresya@example.com','First Name':'X'}]})).body;assert.match(r.skipped[0].reason,/another Shopify customer/);
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM customers')).rows[0].n,3);
  await assert.rejects(h.db.query('DELETE FROM customers'),e=>e.code==='42501');
  assert.equal((await h.request('customers/import','POST',{rows:Array(501).fill({Email:'a@b.co'})})).status,400);
 }finally{await h.close();}
});

test('customer list: imported + ordered here, matched by email for staff; filters, sort and detail',async()=>{
 const h=await harness();
 try{
  await h.request('customers/import','POST',{rows:rowsOf(CSV)});
  // A paid order here from an imported customer, and one from a new person.
  const c=(await h.request('collections','POST',{title:'S',status:'active'})).body;const p=(await h.request('products','POST',{title:'W',status:'active',collection_ids:[String(c.id)],sku:'W',price_minor:6000,inventory:9})).body;const v=(await h.request('products/'+p.id)).body.variants[0];
  for(const [email,name] of [['ARESYA@example.com','Aresya F'],['new@example.com','New Person']]){
   const o=(await h.request('storefront/checkout','POST',{idempotency_key:randomUUID(),access_token:randomBytes(24).toString('base64url'),customer:{name,email,phone:'0123456789',address_line1:'1 Jalan',city:'Klang',postcode:'41000',state:'Selangor'},lines:[{variant_id:v.id,quantity:1}]},null)).body;
   const f={ServiceID:'JSMOCK',PaymentID:o.payment.fields.PaymentID,OrderNumber:o.order.number,Amount:o.payment.fields.Amount,CurrencyCode:'MYR',TxnID:'T',AuthCode:'A',TxnStatus:'0',Param6:'',Param7:''};
   await fetch(h.base+'payments/mock/callback',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...f,HashValue2:responseHash2(SECRET,f)})});
  }
  let l=(await h.request('customers','GET',undefined,'viewer')).body;
  assert.equal(l.total,4);assert.equal(l.subscribed,1);
  assert.deepEqual(l.items.map(c=>[c.email,c.orders,c.spent_minor]),[['aresya@example.com',2,8568+6000],['new@example.com',1,6000],['meijun@example.com',1,0],['ramlijusoh33@gmail.com',0,0]]);
  const a=l.items[0];assert.deepEqual([a.shopify_orders,a.store_orders],[1,1]);assert.equal(l.items[1].id,null,'ordered here only: no record yet');
  assert.deepEqual((await h.request('customers?subscription=subscribed')).body.items.map(c=>c.email),['meijun@example.com']);
  assert.deepEqual((await h.request('customers?q=jusoh')).body.items.map(c=>c.email),['ramlijusoh33@gmail.com']);
  assert.equal((await h.request('customers?sort=name')).body.items[0].name,'Aresya Farzana');
  assert.equal((await h.request('customers?sort=bogus')).status,400);
  const d=(await h.request('customers/'+a.id,'GET',undefined,'viewer')).body;assert.equal(d.orders.length,1);assert.equal(d.shopify_customer_id,'7002');
  assert.equal((await h.request('customers/999')).status,404);assert.equal((await h.request('customers/1','POST',{})).status,405);
 }finally{await h.close();}
});

test('a full batch takes a fixed, small number of database queries (fits the 30-second limit); duplicates in a file are reported',async()=>{
 const h=await harness();
 try{
  const rows=Array.from({length:400},(_,i)=>({'Customer ID':String(9000+i),'First Name':'C'+i,'Email':`c${i}@example.com`,'Accepts Email Marketing':i%7?'no':'yes','Total Spent':'1.00','Total Orders':'1'}));
  let before=h.sql.count;let res=await h.request('customers/import','POST',{rows});let r=res.body;assert.equal(r.created,400,JSON.stringify(res));
  assert.ok(h.sql.count-before<=15,`queries for 400 new rows: ${h.sql.count-before}`);
  rows[3]={...rows[3],'First Name':'Changed'};before=h.sql.count;r=(await h.request('customers/import','POST',{rows})).body;
  assert.deepEqual([r.created,r.updated,r.unchanged],[0,1,399]);assert.ok(h.sql.count-before<=15);
  r=(await h.request('customers/import','POST',{rows:[{Email:'dup@example.com','First Name':'A'},{Email:'DUP@example.com','First Name':'B'}],first_line:10})).body;
  assert.equal(r.created,1);assert.deepEqual(r.skipped,[{line:11,reason:'Same customer as line 10'}]);
 }finally{await h.close();}
});
