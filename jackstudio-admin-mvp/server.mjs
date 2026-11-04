import catalogRules from '../shared/catalog.js';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK = ['127.0.0.1','::1','localhost'].includes(HOST);
const DEMO_PASSWORD = 'JackStudio2026!';
if ((!LOOPBACK || process.env.NODE_ENV === 'production') && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 16 || process.env.ADMIN_PASSWORD === DEMO_PASSWORD)) {
 throw new Error('Public/production deployment requires a non-demo ADMIN_PASSWORD with at least 16 characters. Use a managed auth service for real deployments.');
}

const PUBLIC = join(ROOT, 'public');
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
await mkdir(DATA, { recursive: true });
await mkdir(join(PUBLIC, 'uploads'), { recursive: true });
const db = new DatabaseSync(join(DATA, 'jackstudio.sqlite'));
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
db.exec(`
 CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, handle TEXT NOT NULL UNIQUE, category TEXT NOT NULL DEFAULT 'Essentials', sku TEXT NOT NULL UNIQUE, price_cents INTEGER NOT NULL DEFAULT 0, compare_at_cents INTEGER NOT NULL DEFAULT 0, inventory INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft', image_url TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT NOT NULL UNIQUE, customer_id INTEGER REFERENCES customers(id), total_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'unfulfilled', payment_status TEXT NOT NULL DEFAULT 'paid', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER REFERENCES orders(id), product_id INTEGER REFERENCES products(id), quantity INTEGER NOT NULL, price_cents INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, content TEXT DEFAULT '', seo_title TEXT DEFAULT '', seo_description TEXT DEFAULT '', is_published INTEGER NOT NULL DEFAULT 1, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL, mime TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS collections (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL UNIQUE COLLATE NOCASE, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS page_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id INTEGER NOT NULL REFERENCES pages(id), revision_number INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', seo_title TEXT NOT NULL DEFAULT '', seo_description TEXT NOT NULL DEFAULT '', published_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(page_id,revision_number));
 CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'info', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS daily_stats (day TEXT PRIMARY KEY, visitors INTEGER NOT NULL, add_to_cart INTEGER NOT NULL DEFAULT 0);
`);
// Existing SQLite files are upgraded in place. Published content stays unchanged until Publish is clicked.
const pageColumns = new Set(db.prepare('PRAGMA table_info(pages)').all().map(c => c.name));
for (const column of ['draft_title','draft_content','draft_seo_title','draft_seo_description']) {
 if (!pageColumns.has(column)) db.exec(`ALTER TABLE pages ADD COLUMN ${column} TEXT`);
}
if (!pageColumns.has('has_unpublished_changes')) db.exec('ALTER TABLE pages ADD COLUMN has_unpublished_changes INTEGER NOT NULL DEFAULT 0');
function hashPassword(password, salt) { return scryptSync(password, salt, 64).toString('hex'); }
const count = (table) => db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get().n;
const storeName = 'Jack Studio';
function recordActivity(message, kind='info') { db.prepare('INSERT INTO activity (message,kind) VALUES (?,?)').run(message,kind); }
if (!count('users')) {
 const email = (process.env.ADMIN_EMAIL || 'admin@jackstudio.local').toLowerCase();
 const password = process.env.ADMIN_PASSWORD || DEMO_PASSWORD;
 const salt = randomBytes(20).toString('hex');
 db.prepare('INSERT INTO users(email,name,role,salt,password_hash) VALUES (?,?,?,?,?)').run(email,'Jack Studio Admin','admin',salt,hashPassword(password,salt));
}
if (!count('products')) {
 const items = [
  ['Heritage Leather Briefcase','heritage-leather-briefcase','Craft Heritage','JS-CH-101',39900,45900,32,1],
  ['Urban Crossbody Bag','urban-crossbody-bag','Urban Carry','JS-UC-202',23900,0,74,2],
  ['Classic Bifold Wallet','classic-bifold-wallet','Essential','JS-ES-303',12900,15900,118,3],
  ['Travel Weekender','travel-weekender','Travel Movement','JS-TM-404',52900,0,19,4],
  ['Executive Card Holder','executive-card-holder','Professional','JS-PR-505',9900,0,143,5],
  ['Everyday Laptop Backpack','everyday-laptop-backpack','Urban Carry','JS-UC-606',32900,0,42,6],
  ['Signature Sling Bag','signature-sling-bag','Make It Personal','JS-MP-707',22900,27900,51,7],
  ['Premium Leather Organizer','premium-leather-organizer','Professional','JS-PR-808',18900,0,65,8]
 ];
 const stmt = db.prepare('INSERT INTO products(title,handle,category,sku,price_cents,compare_at_cents,inventory,status,image_url,description) VALUES(?,?,?,?,?,?,?,?,?,?)');
 for(const p of items) stmt.run(p[0],p[1],p[2],p[3],p[4],p[5],p[6],'active',`/assets/product-${p[7]}.svg`,'Thoughtfully designed for everyday journeys. Sample product — replace with your actual listing.');
}
if (!count('customers')) {
 const stmt=db.prepare('INSERT INTO customers(name,email,phone) VALUES(?,?,?)');
 [['Amelia Tan','amelia@example.com','+60 12-000 1101'],['Daniel Lim','daniel@example.com','+60 12-000 1102'],['Jason Wong','jason@example.com','+60 12-000 1103'],['Sarah Lee','sarah@example.com','+60 12-000 1104'],['Alicia Ng','alicia@example.com','+60 12-000 1105']].forEach(c=>stmt.run(...c));
}
if (!count('orders')) {
 const stmt=db.prepare('INSERT INTO orders(order_number,customer_id,total_cents,status,payment_status,created_at) VALUES(?,?,?,?,?,?)');
 [['#JS-1008',1,39900,'unfulfilled','paid',0],['#JS-1007',2,22800,'fulfilled','paid',1],['#JS-1006',3,52900,'unfulfilled','paid',2],['#JS-1005',4,23900,'fulfilled','paid',3],['#JS-1004',5,12900,'fulfilled','paid',4],['#JS-1003',1,9900,'fulfilled','paid',5],['#JS-1002',3,32900,'fulfilled','paid',6],['#JS-1001',2,18900,'fulfilled','paid',7]].forEach(o=>{const date=new Date(Date.now()-o[5]*86400000).toISOString();stmt.run(o[0],o[1],o[2],o[3],o[4],date);});
}
if (!count('pages')) {
 const stmt=db.prepare('INSERT INTO pages(slug,title,content,seo_title,seo_description) VALUES(?,?,?,?,?)');
 [
 ['brand-story','Brand Story','We believe thoughtful design begins by understanding everyday life. From everyday needs to every journey.','Our Story | Jack Studio','Discover the Jack Studio story.'],
 ['our-services','Our Services',"We're here to provide thoughtful services designed around your needs, from personalisation to ongoing support.",'Our Services | Jack Studio','Personalisation, repairs and aftercare.'],
 ['corporate-solution','Corporate Solution','Thoughtful corporate gifting for teams, clients and milestones.','Corporate Gifts | Jack Studio','Discover corporate gifts and customization.'],
 ['outlets','Outlets','Find your nearest Jack Studio outlet.','Store Locations | Jack Studio','Find Jack Studio stores.'],
 ['contact','Contact','Get in touch with our team.','Contact | Jack Studio','Contact Jack Studio.']
 ].forEach(p=>stmt.run(...p));
}
db.exec(`UPDATE pages SET
 draft_title=COALESCE(draft_title,title),
 draft_content=COALESCE(draft_content,content),
 draft_seo_title=COALESCE(draft_seo_title,seo_title),
 draft_seo_description=COALESCE(draft_seo_description,seo_description)`);
// Create editable collection records from existing products on first upgrade.
const seedCollection=db.prepare('INSERT OR IGNORE INTO collections(title,slug) VALUES (?,?)');
for(const p of db.prepare('SELECT DISTINCT category FROM products').all()) {
 const title=String(p.category).trim();
 const slug=title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
 if(title && slug)seedCollection.run(title,slug);
}
// Record current published content as the initial version on upgrade.
const initRevision=db.prepare('INSERT INTO page_revisions(page_id,revision_number,title,content,seo_title,seo_description) VALUES(?,1,?,?,?,?)');
for(const p of db.prepare('SELECT * FROM pages').all()) {
 const existing=db.prepare('SELECT 1 FROM page_revisions WHERE page_id=? LIMIT 1').get(p.id);
 if(!existing)initRevision.run(p.id,p.title,p.content,p.seo_title,p.seo_description);
}

if (!count('settings')) {
 const stmt=db.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
 Object.entries({site_name:storeName,announcement:'LOGO CUSTOMIZE · NAME CUSTOMIZE · GIFT BOX AVAILABLE FOR BULK ORDERS',hero_kicker:'FROM EVERYDAY ESSENTIALS',hero_title:'TO EVERY JOURNEY',hero_subtitle:'Thoughtful design. Trusted quality. Care beyond every purchase.',hero_button:'Explore Collections',contact_email:'hello@jackstudio.com.my',membership_url:'',currency:'MYR'}).forEach(([k,v])=>stmt.run(k,v));
}
if (!count('daily_stats')) {
 const stmt=db.prepare('INSERT INTO daily_stats(day,visitors,add_to_cart) VALUES(?,?,?)');
 for(let i=29;i>=0;i--){const day=new Date(Date.now()-i*86400000).toISOString().slice(0,10);stmt.run(day,Math.round(68+22*Math.sin(i*.7)+Math.max(0,29-i)*.9+(i%5)*5),Math.round(5+4*Math.cos(i*.61)+i%5));}
}
if (!count('activity')) recordActivity('Demo store initialized with sample product and order records.','setup');

const mimeTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
function json(res,value,status=200){ res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value)); }
function error(res,message,status=400){json(res,{error:message},status);}
function safeInt(v,min=0,max=10000000){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.round(n))):min;}
function settings(){return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r=>[r.key,r.value]));}
function currentUser(req) {
 const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(p=>p.trim().split('=').slice(0,2)));
 const token=cookies.js_session; if(!token || !/^[a-f0-9]{64}$/.test(token)) return null;
 const tokenHash=createHash('sha256').update(token).digest('hex');
 return db.prepare('SELECT users.id,users.email,users.name,users.role FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?').get(tokenHash,Date.now())||null;
}
async function readBody(req,limit=300000){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit) throw new Error('Request too large');chunks.push(chunk);}return Buffer.concat(chunks);}
async function parseJson(req){const raw=await readBody(req); if(!raw.length)return {};try{return JSON.parse(raw.toString('utf8'));}catch{throw new Error('Invalid JSON');}}
const getProduct=(id)=>db.prepare('SELECT * FROM products WHERE id=?').get(id);
const collectionSlug=catalogRules.slug;
function validateCollection(input,existing={}){
 const title=String(input.title??existing.title??'').trim().slice(0,90);
 const slug=collectionSlug(input.slug??(input.title===undefined?existing.slug:title));
 const description=String(input.description??existing.description??'').trim().slice(0,1000);
 const status=input.status??existing.status??'active';
 if(!title || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new Error('Collection title and valid URL slug are required.');
 if(!['active','draft'].includes(status))throw new Error('Invalid collection status');
 return {title,slug,description,status};
}

function validProduct(data, existing={}) {
 const title=String(data.title??existing.title??'').trim().slice(0,150);
 const sku=String(data.sku??existing.sku??'').trim().slice(0,65);
 const handle=String(data.handle??existing.handle??title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')).trim().toLowerCase();
 const category=String(data.category??existing.category??'Essential').trim().slice(0,90);
 const status=data.status??existing.status??'draft';
 if(!title || !sku || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) throw new Error('Title, SKU and valid URL handle are required.');
 if(!['active','draft','archived'].includes(status))throw new Error('Invalid status');
 const image=String(data.image_url??existing.image_url??'').trim().slice(0,450);
 if(image && !image.startsWith('/assets/')&&!image.startsWith('/uploads/')&&!/^https:\/\//.test(image)) throw new Error('Image URL must start with https:// or be a local uploaded image.');
 return {title,sku,handle,category,status,price_cents:safeInt(data.price_cents??existing.price_cents,0,100000000),compare_at_cents:safeInt(data.compare_at_cents??existing.compare_at_cents,0,100000000),inventory:safeInt(data.inventory??existing.inventory,0,1000000),image_url:image,description:String(data.description??existing.description??'').slice(0,5000)};
}
// Local safety net, not a replacement for managed identity protection and MFA.
const loginAttempts = new Map();
function checkLoginLimit(req) {
 const ip=req.socket.remoteAddress||'unknown';
 const now=Date.now();
 const state=loginAttempts.get(ip);
 if(state && now-state.start<15*60*1000 && state.failures>=8) return {blocked:true,ip};
 if(!state || now-state.start>=15*60*1000) loginAttempts.set(ip,{start:now,failures:0});
 return {blocked:false,ip};
}
function recordFailedLogin(ip) {
 const state=loginAttempts.get(ip);
 if(state)state.failures++;
}
function originAllowed(req){const origin=req.headers.origin; if(!origin)return true;try{return new URL(origin).host===req.headers.host;}catch{return false;}}

async function api(req,res,path,url) {
 const method=req.method;
 if(method!=='GET' && !originAllowed(req))return error(res,'Cross-origin request blocked',403);
 if(path==='/api/login'&&method==='POST') {
  const limit=checkLoginLimit(req);if(limit.blocked)return error(res,'Too many sign-in attempts. Try again later.',429);
  const body=await parseJson(req);const email=String(body.email||'').trim().toLowerCase();const pw=String(body.password||'');
  const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if(!u || !timingSafeEqual(Buffer.from(hashPassword(pw,u.salt),'hex'),Buffer.from(u.password_hash,'hex'))){recordFailedLogin(limit.ip);return error(res,'Incorrect email or password',401);}
  loginAttempts.delete(limit.ip);
  const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash,u.id,Date.now()+7*24*3600*1000);
  res.setHeader('Set-Cookie',`js_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${req.headers['x-forwarded-proto']==='https'?' ; Secure':''}`);
  return json(res,{name:u.name,email:u.email,role:u.role});
 }
 if(path==='/api/storefront'&&method==='GET') return json(res,{settings:settings(),products:db.prepare("SELECT * FROM products WHERE products.status='active' AND EXISTS (SELECT 1 FROM collections WHERE collections.title=products.category AND collections.status='active') ORDER BY products.id DESC").all(),pages:db.prepare('SELECT slug,title,content FROM pages WHERE is_published=1 ORDER BY id').all()});
 const user=currentUser(req);if(!user)return error(res,'Not signed in',401);
  if(user.role!=='admin')return error(res,'Administrator permission required',403);
 if(path==='/api/session'&&method==='GET')return json(res,user);
 if(path==='/api/logout'&&method==='POST'){
  const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(p=>p.trim().split('=').slice(0,2)));
  if(cookies.js_session)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(createHash('sha256').update(cookies.js_session).digest('hex'));
  res.setHeader('Set-Cookie','js_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');return json(res,{ok:true});
 }
 if(path==='/api/dashboard'&&method==='GET') {
  const stats=db.prepare('SELECT SUM(visitors) as visitors, SUM(add_to_cart) as carts FROM daily_stats').get();
  const sales=db.prepare("SELECT COALESCE(SUM(total_cents),0) AS revenue,COUNT(*) as orders FROM orders WHERE payment_status='paid'").get();
  return json(res,{product_count:db.prepare("SELECT COUNT(*) as n FROM products WHERE status='active'").get().n,customer_count:count('customers'),order_count:sales.orders,revenue_cents:sales.revenue,visitors:stats.visitors,carts:stats.carts,orders:db.prepare('SELECT orders.*,customers.name as customer FROM orders LEFT JOIN customers ON customers.id=orders.customer_id ORDER BY orders.created_at DESC LIMIT 5').all(),activity:db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 7').all(),daily:db.prepare('SELECT * FROM daily_stats ORDER BY day').all()});
 }
 if(path==='/api/products'&&method==='GET')return json(res,db.prepare('SELECT * FROM products ORDER BY id DESC').all());
 if(path==='/api/products'&&method==='POST') {
  const p=validProduct(await parseJson(req));
  if(!db.prepare('SELECT id FROM collections WHERE title=?').get(p.category))return error(res,'Choose an existing collection',400);
  const x=db.prepare('INSERT INTO products(title,handle,category,sku,price_cents,compare_at_cents,inventory,status,image_url,description) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.title,p.handle,p.category,p.sku,p.price_cents,p.compare_at_cents,p.inventory,p.status,p.image_url,p.description);
  recordActivity(`Product created: ${p.title}`,'product');return json(res,getProduct(x.lastInsertRowid),201);
 }
 const productMatch=path.match(/^\/api\/products\/(\d+)$/);
 if(productMatch){const id=Number(productMatch[1]);const old=getProduct(id);if(!old)return error(res,'Product not found',404);
  if(method==='PUT'){
   const p=validProduct(await parseJson(req),old);
   if(!db.prepare('SELECT id FROM collections WHERE title=?').get(p.category))return error(res,'Choose an existing collection',400);
   db.prepare('UPDATE products SET title=?,handle=?,category=?,sku=?,price_cents=?,compare_at_cents=?,inventory=?,status=?,image_url=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(p.title,p.handle,p.category,p.sku,p.price_cents,p.compare_at_cents,p.inventory,p.status,p.image_url,p.description,id);
   recordActivity(`Product updated: ${p.title}`,'product');return json(res,getProduct(id));
  }
  if(method==='DELETE'){db.prepare('DELETE FROM products WHERE id=?').run(id);recordActivity(`Product deleted: ${old.title}`,'product');return json(res,{ok:true});}
 }
 if(path==='/api/collections'&&method==='GET')return json(res,db.prepare('SELECT collections.*, (SELECT COUNT(*) FROM products WHERE products.category=collections.title) AS product_count FROM collections ORDER BY title COLLATE NOCASE').all());
 if(path==='/api/collections'&&method==='POST'){
  const p=validateCollection(await parseJson(req));
  const r=db.prepare('INSERT INTO collections(title,slug,description,status) VALUES (?,?,?,?)').run(p.title,p.slug,p.description,p.status);
  recordActivity(`Collection created: ${p.title}`,'collection');return json(res,db.prepare('SELECT * FROM collections WHERE id=?').get(r.lastInsertRowid),201);
 }
 const collectionMatch=path.match(/^\/api\/collections\/(\d+)$/);
 if(collectionMatch){
  const id=Number(collectionMatch[1]);const old=db.prepare('SELECT * FROM collections WHERE id=?').get(id);if(!old)return error(res,'Collection not found',404);
  if(method==='PUT'){
   const p=validateCollection(await parseJson(req),old);
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('UPDATE collections SET title=?,slug=?,description=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(p.title,p.slug,p.description,p.status,id);
    if(p.title!==old.title)db.prepare('UPDATE products SET category=?,updated_at=CURRENT_TIMESTAMP WHERE category=?').run(p.title,old.title);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   recordActivity(`Collection updated: ${old.title} → ${p.title}`,'collection');return json(res,db.prepare('SELECT * FROM collections WHERE id=?').get(id));
  }
  if(method==='DELETE'){
   const count=db.prepare('SELECT COUNT(*) AS n FROM products WHERE category=?').get(old.title).n;
   if(count)return error(res,'Move or delete the collection products before deleting it.',409);
   db.prepare('DELETE FROM collections WHERE id=?').run(id);
   recordActivity(`Collection deleted: ${old.title}`,'collection');return json(res,{ok:true});
  }
 }
 if(path==='/api/orders'&&method==='GET')return json(res,db.prepare('SELECT orders.*,customers.name as customer,customers.email FROM orders LEFT JOIN customers ON customers.id=orders.customer_id ORDER BY orders.created_at DESC').all());
 const orderMatch=path.match(/^\/api\/orders\/(\d+)$/);
 if(orderMatch&&method==='PATCH'){
  const input=await parseJson(req);if(!['unfulfilled','fulfilled','cancelled'].includes(input.status))return error(res,'Invalid order status');
  const result=db.prepare('UPDATE orders SET status=? WHERE id=?').run(input.status,Number(orderMatch[1]));if(!result.changes)return error(res,'Order not found',404);
  recordActivity(`Order #${orderMatch[1]} moved to ${input.status}`,'order');return json(res,{ok:true});
 }
 if(path==='/api/customers'&&method==='GET')return json(res,db.prepare("SELECT customers.*,COUNT(orders.id) as order_count,COALESCE(SUM(CASE WHEN orders.payment_status='paid' THEN orders.total_cents ELSE 0 END),0) as spent_cents FROM customers LEFT JOIN orders ON customers.id=orders.customer_id GROUP BY customers.id ORDER BY customers.id DESC").all());
 if(path==='/api/pages'&&method==='GET')return json(res,db.prepare('SELECT * FROM pages ORDER BY id').all());
 const pageMatch=path.match(/^\/api\/pages\/(\d+)$/);
 if(pageMatch&&method==='PUT'){
  const p=await parseJson(req);const id=Number(pageMatch[1]);const existing=db.prepare('SELECT * FROM pages WHERE id=?').get(id);
  if(!existing)return error(res,'Page not found',404);
  const values=[String(p.title??existing.draft_title??existing.title).trim().slice(0,160),String(p.content??existing.draft_content??existing.content).slice(0,20000),String(p.seo_title??existing.draft_seo_title??existing.seo_title).slice(0,160),String(p.seo_description??existing.draft_seo_description??existing.seo_description).slice(0,320),id];
  if(!values[0])return error(res,'Page title required');
  db.prepare('UPDATE pages SET draft_title=?,draft_content=?,draft_seo_title=?,draft_seo_description=?,has_unpublished_changes=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(...values);
  recordActivity(`Draft saved: ${values[0]}`,'page');return json(res,db.prepare('SELECT * FROM pages WHERE id=?').get(id));
 }
 const pageAction=path.match(/^\/api\/pages\/(\d+)\/(publish|unpublish)$/);
 if(pageAction&&method==='POST'){
  const id=Number(pageAction[1]);const existing=db.prepare('SELECT * FROM pages WHERE id=?').get(id);
  if(!existing)return error(res,'Page not found',404);
  if(pageAction[2]==='publish'){
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('UPDATE pages SET title=COALESCE(draft_title,title),content=COALESCE(draft_content,content),seo_title=COALESCE(draft_seo_title,seo_title),seo_description=COALESCE(draft_seo_description,seo_description),is_published=1,has_unpublished_changes=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
    const next=db.prepare('SELECT COALESCE(MAX(revision_number),0)+1 AS n FROM page_revisions WHERE page_id=?').get(id).n;
    const live=db.prepare('SELECT * FROM pages WHERE id=?').get(id);
    db.prepare('INSERT INTO page_revisions(page_id,revision_number,title,content,seo_title,seo_description) VALUES(?,?,?,?,?,?)').run(id,next,live.title,live.content,live.seo_title,live.seo_description);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
  } else db.prepare('UPDATE pages SET is_published=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
  recordActivity(`Page ${pageAction[2]==='publish'?'published':'unpublished'}: ${existing.slug}`,'page');return json(res,db.prepare('SELECT * FROM pages WHERE id=?').get(id));
 }
 const revisionList=path.match(/^\/api\/pages\/(\d+)\/revisions$/);
 if(revisionList&&method==='GET'){
  const id=Number(revisionList[1]);if(!db.prepare('SELECT id FROM pages WHERE id=?').get(id))return error(res,'Page not found',404);
  return json(res,db.prepare('SELECT id,page_id,revision_number,title,published_at FROM page_revisions WHERE page_id=? ORDER BY revision_number DESC LIMIT 30').all(id));
 }
 const restoreRevision=path.match(/^\/api\/pages\/(\d+)\/revisions\/(\d+)\/restore$/);
 if(restoreRevision&&method==='POST'){
  const pageId=Number(restoreRevision[1]),revisionId=Number(restoreRevision[2]);
  const revision=db.prepare('SELECT * FROM page_revisions WHERE id=? AND page_id=?').get(revisionId,pageId);
  if(!revision)return error(res,'Revision not found',404);
  db.prepare('UPDATE pages SET draft_title=?,draft_content=?,draft_seo_title=?,draft_seo_description=?,has_unpublished_changes=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(revision.title,revision.content,revision.seo_title,revision.seo_description,pageId);
  recordActivity(`Revision ${revision.revision_number} restored as draft`,'page');return json(res,db.prepare('SELECT * FROM pages WHERE id=?').get(pageId));
 }
 if(path==='/api/settings'&&method==='GET')return json(res,settings());
 if(path==='/api/settings'&&method==='PUT'){
  const body=await parseJson(req);const allowed=['site_name','announcement','hero_kicker','hero_title','hero_subtitle','hero_button','contact_email','membership_url'];
  const stmt=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for(const key of allowed)if(Object.hasOwn(body,key)){
   const value=String(body[key]).trim().slice(0,500);
   if(key==='membership_url'&&value&&!/^https:\/\//.test(value))return error(res,'Membership URL must use https://');
   stmt.run(key,value);
  }
  recordActivity('Storefront settings updated','settings');return json(res,settings());
 }
 if(path==='/api/media'&&method==='GET')return json(res,db.prepare('SELECT * FROM media ORDER BY id DESC').all());
 if(path==='/api/media'&&method==='POST'){
  const typ=(req.headers['content-type']||'').split(';')[0].toLowerCase();const extensions={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
  if(!extensions[typ])return error(res,'Upload PNG, JPG or WEBP images only');
  const body=await readBody(req,4*1024*1024);
  const valid=(typ==='image/png'&&body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(typ==='image/jpeg'&&body[0]===255&&body[1]===216)||(typ==='image/webp'&&body.toString('ascii',0,4)==='RIFF'&&body.toString('ascii',8,12)==='WEBP');
  if(!valid)return error(res,'Invalid image file');
  const name=(url.searchParams.get('name')||'upload').replace(/[^a-zA-Z0-9_. -]/g,'').slice(0,100),file=`${randomBytes(12).toString('hex')}${extensions[typ]}`;
  await writeFile(join(PUBLIC,'uploads',file),body);
  const mediaUrl=`/uploads/${file}`;
  const r=db.prepare('INSERT INTO media(name,url,mime,size_bytes) VALUES(?,?,?,?)').run(name,mediaUrl,typ,body.length);
  recordActivity(`Image uploaded: ${name}`,'media');return json(res,{id:Number(r.lastInsertRowid),name,url:mediaUrl,mime:typ,size_bytes:body.length},201);
 }
 return error(res,'Endpoint not found',404);
}

const PORT=Number(process.env.PORT||3000);
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`),path=decodeURIComponent(url.pathname);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(path.startsWith('/api/'))return await api(req,res,path,url);
  if(req.method!=='GET')return error(res,'Method not allowed',405);
  let file;
  if(path==='/'||path==='/admin'||path==='/admin/') file=join(PUBLIC,'admin.html');
  else if(path==='/store'||path==='/store/') file=join(PUBLIC,'store.html');
  else if(/^\/(assets|uploads)\/[a-zA-Z0-9_.\-]+$/.test(path)) file=join(PUBLIC,path);
  else if(['/admin.js','/styles.css','/store.js'].includes(path))file=join(PUBLIC,path);
  else return error(res,'Page not found',404);
  if(!existsSync(file)||!statSync(file).isFile())return error(res,'File not found',404);
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mimeTypes[extname(file)]||'application/octet-stream','Cache-Control':path.startsWith('/assets')?'public,max-age=86400':'no-store'});res.end(bytes);
 }catch(e){
  console.error(e);
  if(/UNIQUE constraint failed/.test(e.message))return error(res,'Product handle, SKU or another unique value already exists.',409);
  if(/too large/i.test(e.message))return error(res,'File or request too large',413);
  return error(res,'Unexpected server error',500);
 }
});
if(process.env.NODE_ENV!=='test')server.listen(PORT,HOST,()=>console.log(`Jack Studio Admin ${LOOPBACK?'LOCAL DEMO':'SERVER'} ready: http://${HOST}:${PORT}/admin`));
export {server,db};
