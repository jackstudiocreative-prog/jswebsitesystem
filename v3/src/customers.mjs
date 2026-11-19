// Customers for staff: records imported from Shopify's customer CSV export, plus people who paid for an
// order in this store. Staff records only — not shopper accounts (JS Membership handles those later).
//
// Import: the browser reads the CSV and sends it in batches of rows (header → value). Each row is
// matched to an existing record by Shopify customer ID, then by email, and updated; otherwise created.
// Importing the same file again changes nothing new. Marketing consent is copied exactly as exported,
// with its source, so later marketing emails only go to people who agreed.
import {HttpError} from './auth.mjs';
import {hasColumn} from './schema.mjs';
import {listCustomers as orderCustomers} from './commerce.mjs';
import {CUSTOMER_COLUMNS as COLUMNS} from '../shared/customer-columns.mjs';

export const MIGRATION_014='Customer import needs database migration 014. Ask the operator to apply it.';
export const MAX_ROWS=500;
const bad=m=>{throw new HttpError(400,m);};
const ready=db=>hasColumn(db,'customers','shopify_customer_id');

// Spreadsheet programs often keep long numbers as text with a leading apostrophe.
const clean=v=>String(v??'').replace(/^'/,'').trim();
function pick(row){
 const lower=Object.fromEntries(Object.entries(row).map(([k,v])=>[String(k).trim().toLowerCase(),v]));
 return Object.fromEntries(Object.entries(COLUMNS).map(([key,names])=>[key,clean(names.map(n=>lower[n]).find(v=>v!==undefined&&clean(v)!==''))]));
}
const yes=v=>/^(yes|true|1|subscribed)$/i.test(v);
const money=v=>{if(!v)return 0;const n=Number(v.replace(/[^0-9.]/g,''));return Number.isFinite(n)&&n>=0?Math.round(n*100):null;};
const EMAIL=/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// → normalised record or a reason it was skipped.
export function parseRow(row){
 if(!row||typeof row!=='object'||Array.isArray(row))return {error:'Not a row'};
 const r=pick(row);
 const id=r.shopify_customer_id&&/^\d{1,18}$/.test(r.shopify_customer_id)?r.shopify_customer_id:null;
 if(r.shopify_customer_id&&!id)return {error:'Customer ID is not a number'};
 const email=r.email?r.email.toLowerCase():null;
 if(email&&(!EMAIL.test(email)||email.length>254))return {error:`Email “${email.slice(0,60)}” is not valid`};
 const phone=(r.phone||r.address_phone).slice(0,40);
 if(!email&&!phone&&!r.first_name&&!r.last_name)return {error:'No email, phone or name'};
 const spent=money(r.total_spent);if(spent===null)return {error:'Total Spent is not a number'};
 const orders=r.total_orders?Number(r.total_orders):0;if(!Number.isInteger(orders)||orders<0)return {error:'Total Orders is not a whole number'};
 const country=r.country_code.toUpperCase();
 return {record:{shopify_customer_id:id,email,first_name:r.first_name.slice(0,100),last_name:r.last_name.slice(0,100),phone,company:r.company.slice(0,120),
  address1:r.address1.slice(0,200),address2:r.address2.slice(0,200),city:r.city.slice(0,100),province_code:r.province_code.toUpperCase().slice(0,10),zip:r.zip.slice(0,20),
  country_code:/^[A-Z]{2}$/.test(country)?country:'',accepts_email_marketing:yes(r.accepts_email_marketing),accepts_sms_marketing:yes(r.accepts_sms_marketing),
  tags:[...new Set(r.tags.split(',').map(t=>t.trim()).filter(Boolean))].slice(0,50).map(t=>t.slice(0,60)),note:r.note.slice(0,2000),shopify_orders:orders,shopify_spent_minor:spent}};
}
const FIELDS=['shopify_customer_id','email','first_name','last_name','phone','company','address1','address2','city','province_code','zip','country_code','accepts_email_marketing','accepts_sms_marketing','tags','note','shopify_orders','shopify_spent_minor'];

// A fixed number of queries per batch (read existing, insert new, update changed), so a batch of a
// few hundred rows finishes well inside the 30-second function limit even far from the database.
export async function importCustomers(db,input,actor){
 if(!await ready(db))throw new HttpError(503,MIGRATION_014);
 const rows=input?.rows;if(!Array.isArray(rows)||!rows.length||rows.length>MAX_ROWS)bad(`Send 1–${MAX_ROWS} rows at a time`);
 const first=Number.isInteger(input.first_line)&&input.first_line>0?input.first_line:2;
 const skipped=[],parsed=[],seenId=new Map(),seenEmail=new Map();
 for(const [i,row] of rows.entries()){
  const line=first+i,{record,error}=parseRow(row);
  if(error){skipped.push({line,reason:error});continue;}
  const dup=(record.shopify_customer_id&&seenId.get(record.shopify_customer_id))||(record.email&&seenEmail.get(record.email));
  if(dup){skipped.push({line,reason:`Same customer as line ${dup}`});continue;}
  if(record.shopify_customer_id)seenId.set(record.shopify_customer_id,line);if(record.email)seenEmail.set(record.email,line);
  parsed.push({line,record});
 }
 const ids=parsed.map(p=>p.record.shopify_customer_id).filter(Boolean),emails=parsed.map(p=>p.record.email).filter(Boolean);
 const existing=(await db.query('SELECT * FROM customers WHERE shopify_customer_id=ANY($1::bigint[]) OR email=ANY($2::text[]) ORDER BY id FOR UPDATE',[ids,emails])).rows;
 const byId=new Map(existing.filter(c=>c.shopify_customer_id!=null).map(c=>[String(c.shopify_customer_id),c])),byEmail=new Map(existing.filter(c=>c.email).map(c=>[c.email,c]));
 const norm=(f,v)=>f==='shopify_customer_id'?String(v??''):f==='shopify_spent_minor'||f==='shopify_orders'?Number(v):v;
 const inserts=[],updates=[];let unchanged=0;
 for(const {line,record} of parsed){
  let old=record.shopify_customer_id?byId.get(record.shopify_customer_id):null;
  if(!old&&record.email)old=byEmail.get(record.email);
  if(old&&record.email&&old.email!==record.email){const other=byEmail.get(record.email);if(other&&other.id!==old.id){skipped.push({line,reason:`Email ${record.email} already belongs to another customer`});continue;}}
  if(old&&old.shopify_customer_id!=null&&record.shopify_customer_id&&String(old.shopify_customer_id)!==record.shopify_customer_id){skipped.push({line,reason:`Email ${record.email} belongs to another Shopify customer`});continue;}
  if(!old){inserts.push(record);continue;}
  if(FIELDS.every(f=>JSON.stringify(norm(f,old[f]))===JSON.stringify(norm(f,record[f])))){unchanged++;continue;}
  updates.push({...record,id:String(old.id),consent_changed:old.accepts_email_marketing!==record.accepts_email_marketing||old.accepts_sms_marketing!==record.accepts_sms_marketing});
 }
 const cols=`shopify_customer_id bigint,email text,first_name text,last_name text,phone text,company text,address1 text,address2 text,city text,province_code text,zip text,country_code text,accepts_email_marketing boolean,accepts_sms_marketing boolean,tags text[],note text,shopify_orders integer,shopify_spent_minor bigint`;
 if(inserts.length)await db.query(`INSERT INTO customers(${FIELDS.join(',')},source,consent_source,consent_recorded_at,imported_at)
  SELECT ${FIELDS.join(',')},'shopify','Shopify customer export',now(),now() FROM jsonb_to_recordset($1::jsonb) AS r(${cols})`,[JSON.stringify(inserts)]);
 if(updates.length)await db.query(`UPDATE customers c SET ${FIELDS.map(f=>`${f}=r.${f}`).join(',')},imported_at=now(),updated_at=now(),
  consent_source=CASE WHEN r.consent_changed THEN 'Shopify customer export' ELSE c.consent_source END,consent_recorded_at=CASE WHEN r.consent_changed THEN now() ELSE c.consent_recorded_at END
  FROM jsonb_to_recordset($1::jsonb) AS r(id bigint,consent_changed boolean,${cols}) WHERE c.id=r.id`,[JSON.stringify(updates)]);
 if(inserts.length+updates.length)await db.query("INSERT INTO audit_events(actor,action,entity,entity_id) VALUES ($1,'import','customers',$2)",[actor,inserts.length+updates.length]);
 skipped.sort((x,y)=>x.line-y.line);
 return {created:inserts.length,updated:updates.length,unchanged,skipped};
}

// Combined list: imported records (with this store's paid orders matched by email, for staff only)
// and people who only ordered here.
export async function listCustomers(db,params){
 if(!await ready(db))return orderCustomers(db,params);
 const q=(params.get('q')??'').trim();if(q.length>150)bad('Search too long');
 const limit=Number(params.get('limit')??25),offset=Number(params.get('offset')??0);if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)bad('Invalid paging');
 const sub=params.get('subscription')??'';if(!['','subscribed','not_subscribed'].includes(sub))bad('Invalid filter');
 const sort={spent:'spent_minor DESC,name',orders:'orders DESC,name',name:'lower(name) NULLS LAST,email',recent:'last_order_at DESC NULLS LAST,id DESC'}[params.get('sort')||'spent'];if(!sort)bad('Invalid sort');
 const args=[],where=[];
 if(q){args.push('%'+q.replace(/[\\%_]/g,m=>'\\'+m)+'%');where.push(`(email ILIKE $${args.length} OR name ILIKE $${args.length} OR phone ILIKE $${args.length})`);}
 if(sub)where.push(sub==='subscribed'?'accepts_email_marketing':'NOT accepts_email_marketing');
 const base=`WITH paid AS (SELECT lower(email) AS email,count(*)::int AS orders,sum(total_minor-refunded_minor)::bigint AS spent,max(paid_at) AS last,
   (array_agg(customer_name ORDER BY id DESC))[1] AS name,(array_agg(phone ORDER BY id DESC))[1] AS phone,(array_agg(city ORDER BY id DESC))[1] AS city,(array_agg(state ORDER BY id DESC))[1] AS state
   FROM orders WHERE status='paid' GROUP BY lower(email)),
  everyone AS (
   SELECT c.id::text AS id,coalesce(c.email,'') AS email,coalesce(nullif(trim(c.first_name||' '||c.last_name),''),p.name) AS name,coalesce(nullif(c.phone,''),p.phone,'') AS phone,
    c.accepts_email_marketing,coalesce(nullif(c.city,''),p.city,'') AS city,c.province_code,coalesce(p.state,'') AS state,c.country_code,
    c.shopify_orders,c.shopify_spent_minor,coalesce(p.orders,0) AS store_orders,coalesce(p.spent,0) AS store_spent,
    c.shopify_orders+coalesce(p.orders,0) AS orders,c.shopify_spent_minor+coalesce(p.spent,0) AS spent_minor,p.last AS last_order_at,c.tags
   FROM customers c LEFT JOIN paid p ON p.email=c.email
   UNION ALL
   SELECT NULL,p.email,p.name,p.phone,false,coalesce(p.city,''),'',p.state,'MY',0,0,p.orders,p.spent,p.orders,p.spent,p.last,'{}'::text[]
   FROM paid p WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.email=p.email))
  SELECT * FROM everyone${where.length?' WHERE '+where.join(' AND '):''}`;
 const total=Number((await db.query(`SELECT count(*) AS n FROM (${base}) x`,args)).rows[0].n);
 const subscribed=Number((await db.query(`SELECT count(*) FILTER (WHERE accepts_email_marketing) AS n FROM (${base}) x`,args)).rows[0].n);
 const rows=(await db.query(`${base} ORDER BY ${sort} LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset])).rows;
 return {items:rows.map(r=>({...r,orders:Number(r.orders),spent_minor:Number(r.spent_minor),shopify_spent_minor:Number(r.shopify_spent_minor),store_spent:Number(r.store_spent)})),total,subscribed,limit,offset,imported:true};
}

export async function customerDetail(db,id){
 if(!await ready(db))throw new HttpError(503,MIGRATION_014);
 const c=(await db.query('SELECT * FROM customers WHERE id=$1',[id])).rows[0];if(!c)throw new HttpError(404,'Customer not found');
 const orders=c.email?(await db.query("SELECT id::text,number,status,fulfillment_status,total_minor,refunded_minor,created_at,paid_at FROM orders WHERE lower(email)=$1 ORDER BY id DESC LIMIT 50",[c.email])).rows:[];
 return {...c,id:String(c.id),shopify_customer_id:c.shopify_customer_id==null?null:String(c.shopify_customer_id),shopify_spent_minor:Number(c.shopify_spent_minor),orders};
}
