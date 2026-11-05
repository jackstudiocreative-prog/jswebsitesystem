import { cloudAdapter,signUpload,finalizeUpload,previews } from './media.mjs';
import { authorize,HttpError } from './auth.mjs';
import { list,save,detail,dashboard } from './catalog.mjs';
import { adjust,inventoryList,adjustmentList } from './inventory.mjs';
import { listPages,pageDetail,createPage,savePage,publishPage,unpublishPage,restoreRevision,previewPage,previewDraft,publicPage } from './pages.mjs';
import { quoteBag,checkout,orderStatus,retryPayment,gatewayMessage,mockComplete,listOrders,orderDetail,orderAction,listCustomers,shippingRates,storefrontProduct } from './commerce.mjs';
import { paymentAdapter } from './payments.mjs';
async function readBody(req){
 if(req.body!==undefined){const b=typeof req.body==='string'?req.body:Buffer.isBuffer(req.body)?req.body.toString('utf8'):req.body&&typeof req.body==='object'?new URLSearchParams(req.body).toString():'';if(Buffer.byteLength(b)>65536)throw new HttpError(413,'Request too large');return b;}
 let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)throw new HttpError(413,'Request too large');}return body;
}
const clientIp=req=>{const ip=String(req.headers['x-forwarded-for']??'').split(',')[0].trim()||req.socket?.remoteAddress||'';return /^[0-9a-fA-F:.]{3,45}$/.test(ip)?ip:'0.0.0.0';};
export function handler(pool,verify,options={}){return async(req,res)=>{
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 let db;
 try{
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  if(path==='/health'&&req.method==='GET'){res.end('{"status":"ok","commerce":"not-connected"}');return;}
  if(path==='/api/v3/storefront'&&req.method==='GET'){
   db=await pool.connect();
   const rows=(await db.query("SELECT p.id,p.title,p.handle,p.description FROM products p WHERE p.status='active' AND EXISTS(SELECT 1 FROM product_collections pc JOIN collections c ON c.id=pc.collection_id WHERE pc.product_id=p.id AND c.status='active') ORDER BY p.id LIMIT 200")).rows;
   res.end(JSON.stringify({products:rows,checkoutAvailable:false}));return;
  }
  // Public published pages (no staff token). Drafts, hidden sections and private images are never exposed.
  const published=path.match(/^\/api\/v3\/storefront\/pages\/([^/]{1,100})$/);
  if(published){if(req.method!=='GET')throw new HttpError(405,'Method not available');db=await pool.connect();res.end(JSON.stringify(await publicPage(db,published[1])));return;}
  // Public storefront commerce: bag pricing, checkout and order status (the order access token stays in
  // the request body, never the URL).
  const shop=path.match(/^\/api\/v3\/storefront\/(products\/([a-z0-9-]{1,100})|cart|checkout|shipping-rates|orders\/(JSW\d{1,12})\/(status|pay))$/);
  if(shop){
   const kind=shop[1].startsWith('products/')?'product':shop[1].startsWith('orders/')?shop[4]:shop[1];
   if(req.method!==(['product','shipping-rates'].includes(kind)?'GET':'POST'))throw new HttpError(405,'Method not available');
   let input;if(req.method==='POST'){if(!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'JSON required');try{input=JSON.parse(await readBody(req));}catch(e){if(e.status)throw e;throw new HttpError(400,'Invalid JSON');}}
   db=await pool.connect();await db.query('BEGIN');
   const payments=()=>options.payments??paymentAdapter(process.env);
   const result=kind==='product'?await storefrontProduct(db,shop[2]):kind==='shipping-rates'?{rates:await shippingRates(db),currency:'MYR'}:kind==='cart'?await quoteBag(db,input):kind==='checkout'?await checkout(db,input,payments(),clientIp(req)):kind==='status'?await orderStatus(db,shop[3],input):await retryPayment(db,shop[3],input,payments(),clientIp(req));
   await db.query('COMMIT');res.statusCode=kind==='checkout'?201:200;res.end(JSON.stringify(result));return;
  }
  // Gateway messages. Every message is logged; only a verified signature can change a payment.
  const gw=path.match(/^\/api\/v3\/payments\/(eghl|mock)\/(callback|return|complete)$/);
  if(gw){
   const payments=options.payments??paymentAdapter(process.env);
   if(payments.provider!==gw[1])throw new HttpError(404,'Not found');
   if(gw[2]==='complete'){
    if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(405,'Method not available');
    let input;try{input=JSON.parse(await readBody(req));}catch(e){if(e.status)throw e;throw new HttpError(400,'Invalid JSON');}
    db=await pool.connect();await db.query('BEGIN');const r=await mockComplete(db,input,payments);await db.query('COMMIT');res.end(JSON.stringify({ok:r.ok}));return;
   }
   if(!(req.method==='POST'||(req.method==='GET'&&gw[2]==='return')))throw new HttpError(405,'Method not available');
   const fields=Object.fromEntries(req.method==='GET'?url.searchParams:new URLSearchParams(await readBody(req)));
   db=await pool.connect();await db.query('BEGIN');const r=await gatewayMessage(db,gw[2],fields,payments);await db.query('COMMIT');
   if(gw[2]==='callback'){res.setHeader('Content-Type','text/plain');res.statusCode=r.ok?200:400;res.end(r.ok?'OK':'REJECTED');return;}
   res.statusCode=303;res.setHeader('Location',r.number?'/order/'+r.number:'/order/');res.end('{}');return;
  }
  const sales=path.match(/^\/api\/v3\/(orders|customers)(?:\/([1-9]\d{0,17})(?:\/(fulfil|cancel|refunds|resolve))?)?$/);
  if(sales&&!(sales[1]==='customers'?(!sales[2]&&req.method==='GET'):sales[3]?req.method==='POST':req.method==='GET'))throw new HttpError(405,'Method not available');
  const page=path.match(/^\/api\/v3\/pages(?:\/(preview)|\/([1-9]\d{0,17})(?:\/(preview|publish|unpublish|revisions\/([1-9]\d{0,17})\/restore))?)?$/);
  // page[1]: unsaved preview; page[2]: page id; page[3]: action; page[4]: version id.
  const action=page?.[1]?'draft-preview':page?.[3]?.startsWith('revisions/')?'restore':page?.[3];
  if(page&&!(action==='draft-preview'?['POST']:!page[2]?['GET','POST']:!action?['GET','PATCH']:action==='preview'?['GET']:['POST']).includes(req.method))throw new HttpError(405,'Method not available');
  const match=page||sales?null:path.match(/^\/api\/v3\/(products|collections|media\/previews|media|session|dashboard|uploads\/sign|uploads\/finalize|inventory\/adjustments|inventory)(?:\/([1-9]\d{0,17})(\/preview)?)?$/);
  if(!match&&!page&&!sales)throw new HttpError(404,'Not found');
  if(match){
  if((['media/previews','inventory'].includes(match[1])&&(req.method!=='GET'||match[2]))||(match[1]==='inventory/adjustments'&&(!['GET','POST'].includes(req.method)||match[2])))throw new HttpError(405,'Method not available');
  if(!['GET','POST','PATCH'].includes(req.method) || (['media','session','dashboard'].includes(match[1])&&req.method!=='GET') || (match[1].startsWith('uploads/')&&(req.method!=='POST'||match[2])) || (req.method==='PATCH'&&!match[2]) || (req.method==='POST'&&match[2]) || (match[2]&&['session','dashboard'].includes(match[1])) || (match[3]&&match[1]!=='media') || (match[1]==='media'&&match[2]&&!match[3]))throw new HttpError(405,'Method not available');
  }
  const token=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if(!token)throw new HttpError(401,'Staff sign-in required');
  let claims;try{claims=await verify(token);}catch{throw new HttpError(401,'Invalid or expired token');}
  db=await pool.connect();await db.query('BEGIN');
  const staff=await authorize(db,claims,req.method!=='GET');
  let result;
  if(req.method==='GET'&&sales)result=sales[1]==='customers'?await listCustomers(db,url.searchParams):sales[2]?await orderDetail(db,sales[2]):await listOrders(db,url.searchParams);
  else if(req.method==='GET'&&page)result=action==='preview'?await previewPage(db,page[2],url.searchParams.get('source'),options.cloud??cloudAdapter()):page[2]?await pageDetail(db,page[2]):await listPages(db,url.searchParams);
  else if(req.method==='GET'){
   if(match[3]){const media=(await db.query("SELECT * FROM media WHERE id=$1 AND state='ready'",[match[2]])).rows[0];if(!media)throw new HttpError(404,'Verified media not found');const cloud=options.cloud??cloudAdapter();result={url:cloud.preview(media),expiresIn:300};}
   else if(match[1]==='media/previews')result=await previews(db,url.searchParams.get('ids'),options.cloud??cloudAdapter());
   else if(match[1].startsWith('inventory'))result=match[1]==='inventory'?await inventoryList(db,url.searchParams):await adjustmentList(db,url.searchParams);
   else result=match[1]==='session'?{subject:claims.sub,role:staff.role}:match[1]==='dashboard'?await dashboard(db):match[2]?await detail(db,match[1],match[2]):await list(db,match[1],url.searchParams);
  }
  else{
   if(!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'JSON required');
   let body='';
   if(req.body!==undefined){body=typeof req.body==='string'?req.body:Buffer.isBuffer(req.body)?req.body.toString('utf8'):JSON.stringify(req.body);}
   else for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)throw new HttpError(413,'Request too large');}
   if(Buffer.byteLength(body)>65536)throw new HttpError(413,'Request too large');
   let input;try{input=JSON.parse(body);}catch{throw new HttpError(400,'Invalid JSON');}
   if(sales){result=await orderAction(db,sales[2],sales[3],input,claims.sub);}
   else if(page){result=action==='draft-preview'?await previewDraft(db,input,options.cloud??cloudAdapter()):!page[2]?await createPage(db,input,claims.sub):!action?await savePage(db,page[2],input,claims.sub):action==='publish'?await publishPage(db,page[2],input,claims.sub):action==='unpublish'?await unpublishPage(db,page[2],input,claims.sub):await restoreRevision(db,page[2],page[4],input,claims.sub);res.statusCode=page[2]||action==='draft-preview'?200:201;}
   else{
   const cloud=match[1].startsWith('uploads/')?(options.cloud??cloudAdapter()):null;
   result=match[1]==='uploads/sign'?await signUpload(db,claims.sub,cloud,input?.filename):match[1]==='inventory/adjustments'?await adjust(db,input,claims.sub):match[1]==='uploads/finalize'?await finalizeUpload(db,claims.sub,input.id,cloud):await save(db,match[1],input,claims.sub,match[2]);res.statusCode=req.method==='POST'?201:200;
   }
  }
  await db.query('COMMIT');res.end(JSON.stringify(result));
 }catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});res.statusCode=e.status??(['23505','23503','23514','22P02'].includes(e.code)?409:500);res.end(JSON.stringify({error:e.status?e.message:res.statusCode===409?'Data constraint conflict':'Internal server error'}));}
 finally{db?.release();}
};}
