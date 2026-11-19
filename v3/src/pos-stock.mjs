import {HttpError} from './auth.mjs';
// Stock from the shop POS (mPOS "JACKSTUDIO API"). The POS is the record for stock: Shopify's
// inventory is not accurate. Read-only: nothing is ever written to mPOS.
//
// GET /api/stock-warehouse returns one row per item per warehouse. Rows are summed per stockCode
// (all warehouses, or only MPOS_WAREHOUSE_ID when set) and matched to website variant SKUs.
// Website stock = mPOS qtyAvailable minus units held by unpaid website orders, because checkout
// already took those units off the website stock and gives them back if the order expires.
export const POS_DEFAULT_URL='https://api_jack.mpos-web.com';
export const POS_PAGE_SIZE=500;
const MAX_PAGES=200,REQUEST_MS=15000,TOTAL_MS=20000,LIST_CAP=1000,MAX_QTY=2147483647;

export const skuKey=s=>String(s??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
// Looser key used only when the exact key finds nothing: "BAD 40107-F" = "bad40107f".
export const compactKey=s=>skuKey(s).replace(/[\s\-_./]/g,'');

export function posClientFromEnv(env=process.env,fetchImpl=globalThis.fetch){
 const key=String(env.MPOS_API_KEY??'').trim();
 if(!key)return null;
 let base;try{base=new URL(String(env.MPOS_API_URL||POS_DEFAULT_URL));}catch{throw new HttpError(503,'MPOS_API_URL is not a valid URL.');}
 if(base.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(base.hostname))throw new HttpError(503,'MPOS_API_URL must use https.');
 const warehouse=String(env.MPOS_WAREHOUSE_ID??'').trim();
 if(warehouse&&!/^[1-9]\d{0,9}$/.test(warehouse))throw new HttpError(503,'MPOS_WAREHOUSE_ID must be a warehouse number.');
 const endpoint=new URL('api/stock-warehouse',base.href.endsWith('/')?base.href:base.href+'/');
 return {warehouseId:warehouse?Number(warehouse):null,fetchStock:()=>fetchStock(fetchImpl,endpoint,key,warehouse)};
}

async function getPage(fetchImpl,url,key,deadline){
 let r;
 try{r=await fetchImpl(url,{headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(Math.max(1000,Math.min(REQUEST_MS,deadline-Date.now())))});}
 catch(e){throw new HttpError(504,e?.name==='TimeoutError'||e?.name==='AbortError'?'mPOS did not answer in time. Nothing was changed. Try again.':'Could not reach mPOS. Nothing was changed.');}
 if(r.status===401||r.status===403)throw new HttpError(502,`mPOS rejected the API key (HTTP ${r.status}). Check MPOS_API_KEY in Vercel. Nothing was changed.`);
 if(!r.ok)throw new HttpError(502,`mPOS returned HTTP ${r.status}. Nothing was changed.`);
 let body;try{body=await r.json();}catch{throw new HttpError(502,'mPOS sent a reply that is not JSON. Nothing was changed.');}
 if(!body||typeof body!=='object'||!Array.isArray(body.items??[]))throw new HttpError(502,'mPOS reply has no items list. Nothing was changed.');
 return body;
}
// Every page, or an error: a partial list would make in-stock items look missing.
async function fetchStock(fetchImpl,endpoint,key,warehouse){
 const deadline=Date.now()+TOTAL_MS,rows=new Map();let total=null,pages=0;
 for(let page=1;;page++){
  if(page>MAX_PAGES)throw new HttpError(502,`mPOS has more than ${MAX_PAGES*POS_PAGE_SIZE} stock rows. Set MPOS_WAREHOUSE_ID to sync one warehouse. Nothing was changed.`);
  if(Date.now()>deadline)throw new HttpError(504,'Reading mPOS took too long. Nothing was changed. Try again.');
  const url=new URL(endpoint);
  for(const [k,v] of Object.entries({inStockOnly:'true',isActive:'true',pageSize:String(POS_PAGE_SIZE),page:String(page)}))url.searchParams.set(k,v);
  if(warehouse)url.searchParams.set('warehouseId',warehouse);
  const body=await getPage(fetchImpl,url,key,deadline);pages++;
  const items=body.items??[];
  if(Number.isInteger(body.totalCount))total=body.totalCount;
  items.forEach((item,i)=>rows.set(item?.id!=null?'id:'+item.id:`p${page}:${i}`,item));
  const size=Number.isInteger(body.pageSize)&&body.pageSize>0?body.pageSize:POS_PAGE_SIZE;
  if(!items.length||(total!=null?rows.size>=total:items.length<size))break;
 }
 if(total!=null&&rows.size!==total)throw new HttpError(502,`mPOS paging returned ${rows.size} of ${total} stock rows. Nothing was changed.`);
 return {rows:[...rows.values()],pages,total:rows.size};
}

// One entry per stock code (summed over warehouses).
export function aggregate(rows){
 const codes=new Map(),warehouses=new Map();let blank=0,rounded=0;
 for(const row of rows){
  const key=skuKey(row?.stockCode);
  if(!key){blank++;continue;}
  const qty=Number(row.qtyAvailable??0);
  const w=row.warehouseId??row.warehouseCode??'?';
  const wh=warehouses.get(String(w))??{id:row.warehouseId??null,code:row.warehouseCode??'',name:row.warehouseName??'',rows:0};wh.rows++;warehouses.set(String(w),wh);
  const entry=codes.get(key)??{key,stock_code:String(row.stockCode).trim(),description:String(row.description??'').trim(),colour:String(row.colour??'').trim(),qty:0,rows:0};
  entry.qty+=Number.isFinite(qty)?qty:0;entry.rows++;codes.set(key,entry);
 }
 for(const e of codes.values()){const q=Math.min(MAX_QTY,Math.max(0,Math.floor(e.qty)));if(q!==e.qty)rounded++;e.qty=q;}
 return {codes,warehouses:[...warehouses.values()],blank,rounded};
}

// Pure matching: exact SKU (case and repeated spaces ignored), then the compact key when it is
// unique on both sides. Anything that could match more than one item is skipped and reported.
export function matchSkus(codes,variants){
 const site=new Map();
 for(const v of variants){const k=skuKey(v.sku);if(!k)continue;const list=site.get(k)??[];list.push(v);site.set(k,list);}
 const matched=[],ambiguous=[],usedPos=new Set(),usedSite=new Set();
 for(const [k,list] of site){
  if(list.length>1){ambiguous.push({sku:list.map(v=>v.sku).join(' / '),reason:'Same SKU on more than one website variant'});for(const v of list)usedSite.add(v.id);if(codes.has(k))usedPos.add(k);continue;}
  const pos=codes.get(k);if(pos){matched.push({variant:list[0],pos,fuzzy:false});usedPos.add(k);usedSite.add(list[0].id);}
 }
 const loose=new Map(),add=(c,side,item)=>{if(!c)return;const g=loose.get(c)??{pos:[],site:[]};g[side].push(item);loose.set(c,g);};
 for(const [k,pos] of codes)if(!usedPos.has(k))add(compactKey(k),'pos',pos);
 for(const v of variants)if(skuKey(v.sku)&&!usedSite.has(v.id))add(compactKey(v.sku),'site',v);
 for(const g of loose.values()){
  if(!g.pos.length||!g.site.length)continue;
  if(g.pos.length===1&&g.site.length===1){matched.push({variant:g.site[0],pos:g.pos[0],fuzzy:true});usedPos.add(g.pos[0].key);usedSite.add(g.site[0].id);}
  else{ambiguous.push({sku:[...g.site.map(v=>v.sku),...g.pos.map(p=>p.stock_code)].join(' / '),reason:'Matches more than one item when spaces and dashes are ignored'});for(const p of g.pos)usedPos.add(p.key);for(const v of g.site)usedSite.add(v.id);}
 }
 const posOnly=[...codes.values()].filter(p=>!usedPos.has(p.key));
 const siteOnly=variants.filter(v=>skuKey(v.sku)&&!usedSite.has(v.id));
 return {matched,ambiguous,posOnly,siteOnly};
}

export function syncOptions(input){
 const value=input??{};
 if(typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'Object required');
 if(Object.keys(value).some(k=>!['dry_run','zero_missing'].includes(k)))throw new HttpError(400,'Unknown field');
 for(const k of ['dry_run','zero_missing'])if(value[k]!==undefined&&typeof value[k]!=='boolean')throw new HttpError(400,`${k} must be true or false`);
 return {dryRun:value.dry_run===true,zeroMissing:value.zero_missing===true};
}

const cap=list=>list.slice(0,LIST_CAP);
const label=v=>v.option_values?.length?v.option_values.join(' / '):'Default';

// Matches the mPOS feed to website variants and (unless dry run) sets their stock in one statement,
// with one ledger row per changed variant (reason "stocktake", note "POS sync …").
export async function syncFromPos(db,feed,{dryRun,zeroMissing},actor){
 const {codes,warehouses,blank,rounded}=aggregate(feed.rows);
 const variants=(await db.query(`SELECT v.id::text AS id,v.product_id::text AS product_id,v.sku,v.inventory,v.active,v.option_values,p.title AS product_title,p.status AS product_status
  FROM product_variants v JOIN products p ON p.id=v.product_id ORDER BY p.title,v.position,v.id`)).rows;
 const noSku=variants.filter(v=>v.active&&v.product_status!=='archived'&&!skuKey(v.sku)).length;
 const {matched,ambiguous,posOnly,siteOnly}=matchSkus(codes,variants);
 // Only selling variants count as "missing from mPOS"; inactive or archived ones are left alone.
 const missing=siteOnly.filter(v=>v.active&&v.product_status!=='archived');
 const targets=[...matched.map(m=>({id:m.variant.id,pos:m.pos.qty,source:'pos'})),...(zeroMissing?missing.map(v=>({id:v.id,pos:0,source:'missing'})):[])];
 let changes=[];
 if(targets.length){
  const ids=targets.map(t=>t.id),qty=targets.map(t=>t.pos),source=targets.map(t=>t.source);
  if(!dryRun)await db.query('SELECT id FROM products WHERE id IN (SELECT product_id FROM product_variants WHERE id = ANY($1::bigint[])) ORDER BY id FOR UPDATE',[ids]);
  const calc=`WITH input AS (SELECT * FROM unnest($1::bigint[],$2::int[],$3::text[]) AS t(variant_id,pos,source)),
   held AS (SELECT l.variant_id,sum(l.quantity)::int AS q FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE o.status='pending_payment' AND l.variant_id = ANY($1::bigint[]) GROUP BY l.variant_id),
   calc AS (SELECT v.id,v.product_id,v.inventory AS before,i.pos,i.source,coalesce(h.q,0) AS held,greatest(i.pos-coalesce(h.q,0),0) AS after
    FROM product_variants v JOIN input i ON i.variant_id=v.id LEFT JOIN held h ON h.variant_id=v.id)`;
  if(dryRun)changes=(await db.query(`${calc} SELECT id::text AS variant_id,before,after,pos,held,source FROM calc WHERE after<>before`,[ids,qty,source])).rows;
  else{
   changes=(await db.query(`${calc},
    upd AS (UPDATE product_variants v SET inventory=c.after,updated_at=now() FROM calc c WHERE v.id=c.id AND c.after<>c.before RETURNING c.*),
    ins AS (INSERT INTO inventory_adjustments(variant_id,product_id,delta,quantity_before,quantity_after,reason,note,actor)
     SELECT id,product_id,after-before,before,after,'stocktake',
      CASE WHEN source='missing' THEN 'POS sync: not in the mPOS in-stock list' ELSE 'POS sync: mPOS available '||pos||CASE WHEN held>0 THEN ', '||held||' held by unpaid orders' ELSE '' END END,$4::text
     FROM upd RETURNING variant_id)
    SELECT id::text AS variant_id,before,after,pos,held,source FROM upd`,[ids,qty,source,actor])).rows;
   if(changes.length)await db.query(`UPDATE products p SET inventory=least(coalesce((SELECT sum(inventory) FROM product_variants WHERE product_id=p.id AND active),0),2147483647)
    WHERE p.id IN (SELECT product_id FROM product_variants WHERE id = ANY($1::bigint[]))`,[changes.map(c=>c.variant_id)]);
  }
 }
 const byId=new Map(variants.map(v=>[v.id,v])),posFor=new Map(matched.map(m=>[m.variant.id,m.pos]));
 const changed=changes.map(c=>{const v=byId.get(c.variant_id),p=posFor.get(c.variant_id);return {variant_id:c.variant_id,product_id:v.product_id,product_title:v.product_title,variant:label(v),sku:v.sku,stock_code:p?.stock_code??null,before:Number(c.before),after:Number(c.after),held:c.held==null?null:Number(c.held)};});
 const variantRow=v=>({variant_id:v.id,product_id:v.product_id,product_title:v.product_title,variant:label(v),sku:v.sku,inventory:v.inventory});
 return {
  dry_run:dryRun,zero_missing:zeroMissing,
  pos:{rows:feed.total,pages:feed.pages,stock_codes:codes.size,warehouses,blank_codes:blank,rounded_quantities:rounded},
  matched:matched.length,changed:changed.length,unchanged:targets.length-changed.length,
  changes:cap(changed),
  fuzzy:cap(matched.filter(m=>m.fuzzy).map(m=>({sku:m.variant.sku,stock_code:m.pos.stock_code,product_title:m.variant.product_title}))),
  ambiguous:cap(ambiguous),
  pos_only:{total:posOnly.length,items:cap(posOnly.sort((a,b)=>a.stock_code.localeCompare(b.stock_code)).map(p=>({stock_code:p.stock_code,description:p.description,colour:p.colour,qty:p.qty})))},
  site_only:{total:missing.length,items:cap(missing.map(variantRow))},
  variants_without_sku:noSku
 };
}
