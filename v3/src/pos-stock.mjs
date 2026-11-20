import {HttpError} from './auth.mjs';
import {PLAN_2026,PLAN_2026_NAME} from '../shared/product-plan-2026.mjs';
// Stock from the shop POS (mPOS "JACKSTUDIO API"). The POS is the record for stock: Shopify's
// inventory is not accurate. Read-only: nothing is ever written to mPOS.
//
// GET /api/stock-warehouse returns one row per item colour/size per warehouse. mPOS keeps the model in
// stockCode with a category prefix and the colour apart ("BAG-BAD40107" + colour "F"); the website SKU
// has both in one ("BAD 40107 F"). Rows are summed per stockCode + colour + size over the counted
// warehouses (MPOS_WAREHOUSE_ID: one or more IDs, comma-separated; empty = all) and matched to SKUs.
// Website stock = mPOS qtyAvailable minus units held by unpaid website orders, because checkout
// already took those units off the website stock and gives them back if the order expires.
export const POS_DEFAULT_URL='https://api_jack.mpos-web.com';
// Pages are read one per request (the browser drives the loop), so a slow mPOS never meets the 30 s
// Vercel limit. 500 rows per page as asked; the browser falls back to 100 if a 500-row page fails.
export const POS_PAGE_SIZES=[500,100];
const MAX_PAGES=500,REQUEST_MS=24000,LIST_CAP=1000,MAX_QTY=2147483647,MAX_ROWS=100000;

export const skuKey=s=>String(s??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
// Looser key used only when the exact key finds nothing: "BAD 40107-F" = "bad40107f".
export const compactKey=s=>skuKey(s).replace(/[\s\-_./]/g,'');

// Category prefix in front of the model in mPOS stock codes: "BAG-", "ACC-" (only when a number follows).
const PREFIX=/^[a-z]{2,6}\s*-\s*(?=.*\d)/;
export const baseCode=code=>skuKey(code).replace(PREFIX,'');

// Product list (shared/product-plan-2026.mjs). A SKU or mPOS code belongs to a listed model when, with
// spaces and dashes ignored, it starts with the model and what follows is a short colour/size code that
// starts with a letter: "BAD60303-F" and "jwd 30157 n a" do, "BL 3113 B" is not BL311. Longest model wins.
export const planModels=rows=>[...new Set(rows.map(r=>compactKey(Array.isArray(r)?r[0]:r)))].filter(Boolean).sort((a,b)=>b.length-a.length);
export const PLAN_MODELS=planModels(PLAN_2026);
export function planModelOf(code,models=PLAN_MODELS){
 const k=compactKey(code);if(!k)return null;
 for(const m of models){if(!k.startsWith(m))continue;const rest=k.slice(m.length);if(rest===''||(rest.length<=8&&/^[a-z]/.test(rest)))return m;}
 return null;
}
const posPlanModel=(e,models)=>planModelOf(baseCode(e.stock_code),models)??planModelOf(e.stock_code,models);

// MPOS_WAREHOUSE_ID: warehouse IDs to count, comma-separated ("12" or "12,15"). Empty = every warehouse.
export function warehouseIdsFromEnv(env=process.env){
 const raw=String(env.MPOS_WAREHOUSE_ID??'').trim();
 if(!raw)return null;
 const ids=raw.split(',').map(s=>s.trim()).filter(Boolean);
 if(!ids.length||ids.some(s=>!/^[1-9]\d{0,9}$/.test(s)))throw new HttpError(503,'MPOS_WAREHOUSE_ID must be warehouse numbers, separated by commas.');
 return [...new Set(ids.map(Number))];
}

export function posClientFromEnv(env=process.env,fetchImpl=globalThis.fetch){
 const key=String(env.MPOS_API_KEY??'').trim();
 if(!key)return null;
 let base;try{base=new URL(String(env.MPOS_API_URL||POS_DEFAULT_URL));}catch{throw new HttpError(503,'MPOS_API_URL is not a valid URL.');}
 if(base.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(base.hostname))throw new HttpError(503,'MPOS_API_URL must use https.');
 const ids=warehouseIdsFromEnv(env);
 // One warehouse: let mPOS filter (fewer rows). Several: read all and count only those (see aggregate).
 const warehouse=ids?.length===1?String(ids[0]):'';
 const endpoint=new URL('api/stock-warehouse',base.href.endsWith('/')?base.href:base.href+'/');
 return {warehouseId:warehouse?Number(warehouse):null,fetchPage:(page,pageSize)=>{
  const url=new URL(endpoint);
  for(const [k,v] of Object.entries({inStockOnly:'true',isActive:'true',pageSize:String(pageSize),page:String(page)}))url.searchParams.set(k,v);
  if(warehouse)url.searchParams.set('warehouseId',warehouse);
  return getPage(fetchImpl,url,key);
 }};
}

// Printable start of a reply for error messages and logs (control characters removed, whitespace collapsed).
const snippet=(text,n=160)=>String(text).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
async function getPage(fetchImpl,url,key){
 const started=Date.now(),info={page:url.searchParams.get('page'),pageSize:url.searchParams.get('pageSize')};
 const secs=()=>((Date.now()-started)/1000).toFixed(1)+' s';
 let r;
 try{r=await fetchImpl(url,{headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(REQUEST_MS)});}
 catch(e){
  const timeout=e?.name==='TimeoutError'||e?.name==='AbortError';
  console.error('pos-sync: mPOS request failed',{...info,after:secs(),error:timeout?'timeout':String(e?.cause?.code??e?.message??e).slice(0,80)});
  throw new HttpError(504,timeout?`mPOS did not answer within ${REQUEST_MS/1000} seconds (page ${info.page}, ${info.pageSize} rows). Nothing was changed.`:'Could not reach mPOS. Nothing was changed.');
 }
 if(r.status===401||r.status===403)throw new HttpError(502,`mPOS rejected the API key (HTTP ${r.status}). Check MPOS_API_KEY in Vercel. Nothing was changed.`);
 let text;
 try{text=await r.text();}
 catch(e){console.error('pos-sync: mPOS reply cut off',{...info,status:r.status,after:secs()});throw new HttpError(502,`mPOS reply was cut off while reading (HTTP ${r.status}, after ${secs()}). Nothing was changed.`);}
 console.log('pos-sync: mPOS page',{...info,status:r.status,after:secs(),characters:text.length});
 if(!r.ok)throw new HttpError(502,`mPOS returned HTTP ${r.status}${text?`: "${snippet(text,120)}"`:''}. Nothing was changed.`);
 let body;
 try{body=JSON.parse(text.replace(/^﻿/,''));}
 catch{
  // Say exactly what came back, so the cause can be seen without access to mPOS (never the key).
  const where=r.redirected&&r.url?(()=>{try{const u=new URL(r.url);return `, redirected to ${u.origin}${u.pathname}`;}catch{return ', redirected';}})():'';
  const detail=`HTTP ${r.status}, ${r.headers?.get?.('content-type')||'no content type'}, ${text.length} characters after ${secs()}${where}${text.length?`, starts "${snippet(text)}"${text.length>160?`, ends "${snippet(text.slice(-80),80)}"`:''}`:''}`;
  console.error('pos-sync: mPOS reply is not JSON',{...info,detail});
  throw new HttpError(502,`mPOS sent a reply that is not JSON (${detail}). Nothing was changed.`);
 }
 // A bare list is accepted as one page with no total.
 if(Array.isArray(body))body={items:body};
 if(!body||typeof body!=='object'||!Array.isArray(body.items??[]))throw new HttpError(502,`mPOS reply has no items list (starts "${snippet(text)}"). Nothing was changed.`);
 return body;
}

// Only what the sync uses, in short keys, so a whole catalogue fits in one request back.
const compact=row=>({i:row?.id??null,s:String(row?.stockCode??'').slice(0,100),q:Number(row?.qtyAvailable??0)||0,w:row?.warehouseId??null,wc:String(row?.warehouseCode??'').slice(0,40),wn:String(row?.warehouseName??'').slice(0,80),d:String(row?.description??'').slice(0,120),c:String(row?.colour??'').slice(0,60),z:String(row?.size??'').slice(0,60)});
const expand=r=>({id:r.i,stockCode:r.s,qtyAvailable:r.q,warehouseId:r.w,warehouseCode:r.wc,warehouseName:r.wn,description:r.d,colour:r.c,size:r.z??''});

// Step "read": one mPOS page.
export async function readPosPage(pos,input){
 if(Object.keys(input).some(k=>!['step','page','page_size'].includes(k)))throw new HttpError(400,'Unknown field');
 if(!Number.isInteger(input.page)||input.page<1||input.page>MAX_PAGES)throw new HttpError(400,`Page must be 1–${MAX_PAGES}`);
 if(!POS_PAGE_SIZES.includes(input.page_size))throw new HttpError(400,`Page size must be ${POS_PAGE_SIZES.join(' or ')}`);
 const body=await pos.fetchPage(input.page,input.page_size);
 const items=body.items??[];
 return {page:input.page,page_size:Number.isInteger(body.pageSize)&&body.pageSize>0?body.pageSize:input.page_size,total_count:Number.isInteger(body.totalCount)?body.totalCount:null,items:items.map(compact)};
}

// One entry per stock code + colour + size, summed over the counted warehouses (all when ids is null).
export function aggregate(rows,ids=null){
 const codes=new Map(),warehouses=new Map(),count=ids?new Set(ids.map(String)):null;let blank=0,rounded=0;
 for(const row of rows){
  const code=skuKey(row?.stockCode);
  if(!code){blank++;continue;}
  const w=row.warehouseId??row.warehouseCode??'?',counted=!count||count.has(String(row.warehouseId));
  const wh=warehouses.get(String(w))??{id:row.warehouseId??null,code:row.warehouseCode??'',name:row.warehouseName??'',rows:0,counted};wh.rows++;warehouses.set(String(w),wh);
  if(!counted)continue;
  const colour=String(row.colour??'').trim(),size=String(row.size??'').trim(),key=[code,skuKey(colour),skuKey(size)].join('|');
  const qty=Number(row.qtyAvailable??0);
  const entry=codes.get(key)??{key,stock_code:String(row.stockCode).trim(),colour,size,description:String(row.description??'').trim(),qty:0,rows:0};
  entry.qty+=Number.isFinite(qty)?qty:0;entry.rows++;codes.set(key,entry);
 }
 for(const e of codes.values()){const q=Math.min(MAX_QTY,Math.max(0,Math.floor(e.qty)));if(q!==e.qty)rounded++;e.qty=q;}
 return {codes,warehouses:[...warehouses.values()].sort((a,b)=>Number(b.counted)-Number(a.counted)||b.rows-a.rows),blank,rounded};
}

// Matching. Website SKU ("BAD 40107 F", "JWC50351-B") against the mPOS model (stock code with or without
// its category prefix) plus colour and size, ignoring case, spaces, dashes, dots and slashes. Three passes,
// most specific first: model+colour+size, model+colour, model alone (single-colour website products such
// as "BAD21002"). A SKU that fits more than one mPOS item in a pass is skipped and reported, never guessed.
export const HOW=['model + colour + size','model + colour','model only'];
export function matchSkus(codes,variants){
 const tiers=[new Map(),new Map(),new Map()];
 const put=(t,k,e)=>{if(!k)return;const l=tiers[t].get(k)??[];if(!l.includes(e))l.push(e);tiers[t].set(k,l);};
 for(const e of codes.values()){
  const c=compactKey(e.colour),z=compactKey(e.size);
  for(const model of new Set([compactKey(baseCode(e.stock_code)),compactKey(e.stock_code)])){
   if(!model)continue;
   put(0,model+c+z,e);if(z)put(1,model+c,e);put(2,model,e);
  }
 }
 const site=new Map();
 for(const v of variants){const k=compactKey(v.sku);if(!k)continue;const list=site.get(k)??[];list.push(v);site.set(k,list);}
 const matched=[],ambiguous=[],usedPos=new Set(),done=new Set();
 for(const [k,list] of site)if(list.length>1){ambiguous.push({sku:list.map(v=>v.sku).join(' / '),reason:'Same SKU on more than one website variant'});done.add(k);}
 const label=e=>[e.stock_code,e.colour&&`colour ${e.colour}`,e.size&&`size ${e.size}`].filter(Boolean).join(' ');
 for(let t=0;t<3;t++)for(const [k,list] of site){
  if(done.has(k))continue;
  const cand=(tiers[t].get(k)??[]).filter(e=>!usedPos.has(e.key));
  if(!cand.length)continue;
  done.add(k);
  if(cand.length===1){const e=cand[0];matched.push({variant:list[0],pos:e,how:t===0?['model',e.colour&&'colour',e.size&&'size'].filter(Boolean).join(' + '):t===1?'model + colour (size not in SKU)':'model only'});usedPos.add(e.key);}
  else ambiguous.push({sku:list[0].sku,reason:`Fits ${cand.length} mPOS items (${HOW[t]}): ${cand.slice(0,4).map(label).join(', ')}${cand.length>4?', …':''}`});
 }
 const posOnly=[...codes.values()].filter(p=>!usedPos.has(p.key));
 const siteOnly=variants.filter(v=>compactKey(v.sku)&&!done.has(compactKey(v.sku)));
 return {matched,ambiguous,posOnly,siteOnly};
}

// Step "check" (dry run) or "apply": the rows the browser read page by page with step "read".
// An editor sending made-up rows can do no more than with Adjust stock; every change is in the ledger.
export function syncOptions(input){
 const value=input??{};
 if(typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'Object required');
 if(Object.keys(value).some(k=>!['dry_run','zero_missing','hide_outside','rows','pages','page_size'].includes(k)))throw new HttpError(400,'Unknown field');
 for(const k of ['dry_run','zero_missing','hide_outside'])if(value[k]!==undefined&&typeof value[k]!=='boolean')throw new HttpError(400,`${k} must be true or false`);
 if(!Array.isArray(value.rows))throw new HttpError(400,'Read stock from mPOS first');
 if(value.rows.length>MAX_ROWS)throw new HttpError(400,`More than ${MAX_ROWS} mPOS rows`);
 const str=(v,n)=>typeof v==='string'&&v.length<=n;
 for(const r of value.rows)if(!r||typeof r!=='object'||!str(r.s,100)||typeof r.q!=='number'||!Number.isFinite(r.q)||!(r.w===null||Number.isInteger(r.w)||str(r.w,40))||!str(r.wc??'',40)||!str(r.wn??'',80)||!str(r.d??'',120)||!str(r.c??'',60)||!str(r.z??'',60))throw new HttpError(400,'Invalid mPOS row');
 const pages=Number.isInteger(value.pages)&&value.pages>0?value.pages:null,pageSize=POS_PAGE_SIZES.includes(value.page_size)?value.page_size:null;
 return {dryRun:value.dry_run===true,zeroMissing:value.zero_missing===true,hideOutside:value.hide_outside===true,feed:{rows:value.rows.map(expand),pages,total:value.rows.length,page_size:pageSize}};
}

const cap=list=>list.slice(0,LIST_CAP);
const label=v=>v.option_values?.length?v.option_values.join(' / '):'Default';

// Matches the mPOS feed to website variants and (unless dry run) sets their stock in one statement,
// with one ledger row per changed variant (reason "stocktake", note "POS sync …").
// Only models in the product list take part: website variants and mPOS items of other models are left
// out of matching and of every list. plan=null means every model (no list).
export async function syncFromPos(db,{feed,dryRun,zeroMissing,hideOutside=false,warehouseIds=null,planRows=PLAN_2026},actor){
 const plan=planRows?planModels(planRows):null;
 const agg=aggregate(feed.rows,warehouseIds),{warehouses,blank,rounded}=agg;
 const all=(await db.query(`SELECT v.id::text AS id,v.product_id::text AS product_id,v.sku,v.inventory,v.active,v.option_values,p.title AS product_title,p.status AS product_status
  FROM product_variants v JOIN products p ON p.id=v.product_id ORDER BY p.title,v.position,v.id`)).rows;
 const noSku=all.filter(v=>v.active&&v.product_status!=='archived'&&!skuKey(v.sku)).length;
 const variants=plan?all.filter(v=>planModelOf(v.sku,plan)):all;
 const codes=plan?new Map([...agg.codes].filter(([,e])=>posPlanModel(e,plan))):agg.codes;
 const {matched,ambiguous,posOnly,siteOnly}=matchSkus(codes,variants);
 // Products with no SKU in the list (archived ones aside). Products without any SKU are reported, never hidden.
 const byProduct=new Map();
 for(const v of all){if(v.product_status==='archived')continue;const p=byProduct.get(v.product_id)??{product_id:v.product_id,title:v.product_title,status:v.product_status,skus:[],in_plan:false};if(skuKey(v.sku))p.skus.push(v.sku);if(!plan||planModelOf(v.sku,plan))p.in_plan=true;byProduct.set(v.product_id,p);}
 const outside=[...byProduct.values()].filter(p=>!p.in_plan&&p.skus.length).sort((a,b)=>a.title.localeCompare(b.title));
 const toHide=outside.filter(p=>p.status==='active');
 let hidden=0;
 if(hideOutside&&!dryRun&&toHide.length){
  // audit_events is write-only for the API role, so the ids come from the UPDATE.
  const ids=(await db.query("UPDATE products SET status='draft',updated_at=now() WHERE id = ANY($1::bigint[]) AND status='active' RETURNING id::text AS id",[toHide.map(p=>p.product_id)])).rows.map(r=>r.id);
  if(ids.length)await db.query("INSERT INTO audit_events(actor,action,entity,entity_id) SELECT $2::text,'update','products',unnest($1::bigint[])",[ids,actor]);
  hidden=ids.length;
 }
 // Models in the list with no website variant at all, with what mPOS has of them.
 const onSite=new Set(variants.map(v=>planModelOf(v.sku,plan??[])).filter(Boolean));
 const posByModel=new Map();for(const e of codes.values()){const m=posPlanModel(e,plan??[]);if(m)posByModel.set(m,(posByModel.get(m)??0)+e.qty);}
 const rowsOf=r=>Array.isArray(r)?r:[r,'','',''];
 const planMissing=plan?planRows.map(rowsOf).filter(r=>!onSite.has(compactKey(r[0]))).map(r=>({model:r[0],category:r[1],type:r[2],price:r[3],mpos_available:posByModel.get(compactKey(r[0]))??0})):[];
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
 const changed=changes.map(c=>{const v=byId.get(c.variant_id),p=posFor.get(c.variant_id);return {variant_id:c.variant_id,product_id:v.product_id,product_title:v.product_title,variant:label(v),sku:v.sku,stock_code:p?.stock_code??null,colour:p?.colour??null,before:Number(c.before),after:Number(c.after),held:c.held==null?null:Number(c.held)};});
 const variantRow=v=>({variant_id:v.id,product_id:v.product_id,product_title:v.product_title,variant:label(v),sku:v.sku,inventory:v.inventory});
 return {
  dry_run:dryRun,zero_missing:zeroMissing,hide_outside:hideOutside,
  plan:plan?{name:planRows===PLAN_2026?PLAN_2026_NAME:'Product list',models:plan.length,website_variants:variants.length,outside_variants:all.filter(v=>skuKey(v.sku)).length-variants.length,mpos_items_outside:agg.codes.size-codes.size}:null,
  pos:{rows:feed.total,pages:feed.pages,page_size:feed.page_size??null,stock_codes:codes.size,warehouses,counted_warehouses:warehouses.filter(w=>w.counted).length,warehouse_filter:warehouseIds,blank_codes:blank,rounded_quantities:rounded},
  outside:{total:outside.length,active:toHide.length,hidden,items:cap(outside.map(p=>({product_id:p.product_id,title:p.title,status:hidden&&p.status==='active'?'draft':p.status,skus:p.skus.slice(0,6).join(', ')+(p.skus.length>6?', …':'')})))},
  plan_missing:{total:planMissing.length,items:planMissing},
  matched:matched.length,changed:changed.length,unchanged:targets.length-changed.length,
  changes:cap(changed),
  matches:cap(matched.map(m=>({sku:m.variant.sku,product_title:m.variant.product_title,variant:label(m.variant),stock_code:m.pos.stock_code,colour:m.pos.colour,size:m.pos.size,qty:m.pos.qty,how:m.how})).sort((a,b)=>a.sku.localeCompare(b.sku))),
  ambiguous:cap(ambiguous),
  pos_only:{total:posOnly.length,items:cap(posOnly.sort((a,b)=>a.stock_code.localeCompare(b.stock_code)||a.colour.localeCompare(b.colour)).map(p=>({stock_code:p.stock_code,description:p.description,colour:p.colour,size:p.size,qty:p.qty})))},
  site_only:{total:missing.length,items:cap(missing.map(variantRow))},
  variants_without_sku:noSku
 };
}
