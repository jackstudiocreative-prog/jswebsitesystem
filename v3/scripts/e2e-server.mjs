// Test-only server for the Playwright suite. Refuses to run unless E2E_HARNESS=1 and binds to
// 127.0.0.1. Serves the real build (public/) with the real vercel.json headers and rewrites, backed
// by the real API handler on an in-memory PostgreSQL (PGlite), a fixed test identity and the mock
// payment gateway. It is not referenced by the build or by Vercel.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from '../src/migrate.mjs';
import {handler} from '../src/handler.mjs';
import {testGateway} from '../src/payments.mjs';
// `--demo` (npm run demo) also seeds sample products and pages for hands-on testing.
const demo=process.argv.includes('--demo');
if(process.env.E2E_HARNESS!=='1'&&!demo)throw Error('Test harness only (set E2E_HARNESS=1 or run npm run demo)');
const root=new URL('../',import.meta.url),port=Number(process.env.E2E_PORT??4317);
const config=JSON.parse(await readFile(new URL('vercel.json',root),'utf8'));
// vercel.json patterns -> RegExp (":name*" any, ":name" one segment; groups are already regex).
const pattern=src=>new RegExp('^'+src.replace(/:[a-z]+\*/g,'.*').replace(/:[a-z]+/g,'[^/]+')+'$');
const rewrites=config.rewrites.map(r=>[pattern(r.source),r.destination]),headers=config.headers.map(h=>[pattern(h.source),h.headers]);
const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
await migrate(sql);
await db.query("INSERT INTO staff VALUES ('editor','editor',true),('viewer','viewer',true)");
for(const label of ['card-holder-brown.jpg','card-holder-black.jpg','weekender.jpg'])await db.query("INSERT INTO media(object_key,mime,bytes,state,created_by,format,label,width,height) VALUES ($1,'image/jpeg',200000,'ready','editor','jpg',$2,1600,1600)",['e2e/'+label,label]);
await db.query('SET ROLE jackstudio_api');
const payments=testGateway({provider:'mock',serviceId:'JSMOCK',password:'e2e-'.repeat(10),actionUrl:`http://127.0.0.1:${port}/pay/mock`,baseUrl:'https://e2e.test'});
const api=handler({connect:async()=>({...sql,release(){}})},async token=>{if(!['editor','viewer'].includes(token))throw Error('bad token');return {sub:token,aal:'aal2'};},{payments,rateLimits:false,baseUrl:'https://e2e.test',cloud:{preview:m=>'https://api.cloudinary.com/e2e/'+m.id}});
const adminJs=(await build({entryPoints:[fileURLToPath(new URL('e2e/admin-entry.mjs',root))],bundle:true,format:'esm',write:false})).outputFiles[0].text;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'};
createServer(async(req,res)=>{
 const path=new URL(req.url,'http://x').pathname;
 for(const [re,list] of headers)if(re.test(path))for(const h of list)res.setHeader(h.key,h.value);
 let target=path;for(const [re,dest] of rewrites)if(re.test(path)){target=dest;break;}
 if(target==='/api/index')return api(req,res);
 if(target==='/admin.js'){res.setHeader('Content-Type','text/javascript');return res.end(adminJs);}
 const name=target.endsWith('/')?target+'index.html':target; // "/" is the storefront home
 try{const file=await readFile(new URL('public'+name,root));res.setHeader('Content-Type',types[name.slice(name.lastIndexOf('.'))]??'application/octet-stream');res.end(file);}
 catch{res.statusCode=404;res.end('Not found');}
}).listen(port,'127.0.0.1',async()=>{
 if(!demo)return console.log('e2e harness on',port);
 const call=async(path,body,method='POST',role='editor')=>{const r=await fetch(`http://127.0.0.1:${port}/api/v3/`+path,{method,headers:{Authorization:'Bearer '+role,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok)throw Error(path+': '+j.error);return j;};
 const wallets=await call('collections',{title:'Wallets & Small Leather',status:'active',position:1}),travel=await call('collections',{title:'Travel',status:'active',position:2});
 await call('products',{title:'Card Holder',status:'active',description:'Full-grain leather card holder with four slots.\n\nHand-finished edges.',collection_ids:[String(wallets.id)],option_names:['Color'],media:[{media_id:'1',alt:'Card holder in brown'},{media_id:'2',alt:'Card holder in black'}],variants:[{option_values:['Brown'],sku:'JS-CH-BRN',price_minor:12900,inventory:12,media_id:'1'},{option_values:['Black'],sku:'JS-CH-BLK',price_minor:12900,inventory:3,media_id:'2'},{option_values:['Tan'],sku:'JS-CH-TAN',price_minor:13900,inventory:0}]});
 await call('products',{title:'Slim Wallet',status:'active',collection_ids:[String(wallets.id)],sku:'JS-SW-01',price_minor:3900,inventory:20});
 await call('products',{title:'Weekender Duffel',status:'active',collection_ids:[String(travel.id)],sku:'JS-WK-01',price_minor:69900,inventory:5,shipping_profile:'luggage',weight_grams:2500,media:[{media_id:'3',alt:'Weekender duffel'}]});
 await call('products',{title:'Everyday Tote (draft)',status:'draft',collection_ids:[String(wallets.id)],sku:'JS-TT-01',price_minor:45900,inventory:4});
 const {TEMPLATES}=await import('../shared/page-schema.mjs');
 const home=await call('pages',TEMPLATES.home.build());await call(`pages/${home.id}/publish`,{revision:home.revision});
 await call('pages',TEMPLATES['brand-story'].build());
 // Online Store: the Jack Studio 2026 theme, live, with its Best Seller tabs pointed at the sample collections.
 const theme=await call('themes',{preset:'jack-studio-2026'}),content=(await call('themes/'+theme.id,undefined,'GET')).content;
 const tabs=content.sections.find(x=>x.type==='product_tabs').settings.tabs;tabs[0].collection_id=String(wallets.id);tabs[3].collection_id=String(travel.id);
 const saved=await call('themes/'+theme.id,{revision:theme.revision,content},'PATCH');await call(`themes/${theme.id}/publish`,{revision:saved.revision});
 const b=`http://127.0.0.1:${port}`;
 console.log(`\nJack Studio V3 — local simulation (in-memory data, resets when stopped; mock eGHL, no real money)\n\n  Staff workspace (editor): ${b}/admin\n  Staff workspace (viewer): ${b}/admin?role=viewer\n  Storefront (live theme):  ${b}/\n  Website home:             ${b}/pages/home\n  Product page:             ${b}/products/card-holder\n  Bag:                      ${b}/cart\n\nPress Ctrl+C to stop.\n`);
});
