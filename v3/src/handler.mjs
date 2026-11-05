import { cloudAdapter,signUpload,finalizeUpload,previews } from './media.mjs';
import { authorize,HttpError } from './auth.mjs';
import { list,save,detail,dashboard } from './catalog.mjs';
import { adjust,inventoryList,adjustmentList } from './inventory.mjs';
import { listPages,pageDetail,createPage,savePage,publishPage,unpublishPage,restoreRevision,previewPage,previewDraft,publicPage } from './pages.mjs';
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
  const page=path.match(/^\/api\/v3\/pages(?:\/(preview)|\/([1-9]\d{0,17})(?:\/(preview|publish|unpublish|revisions\/([1-9]\d{0,17})\/restore))?)?$/);
  // page[1]: unsaved preview; page[2]: page id; page[3]: action; page[4]: version id.
  const action=page?.[1]?'draft-preview':page?.[3]?.startsWith('revisions/')?'restore':page?.[3];
  if(page&&!(action==='draft-preview'?['POST']:!page[2]?['GET','POST']:!action?['GET','PATCH']:action==='preview'?['GET']:['POST']).includes(req.method))throw new HttpError(405,'Method not available');
  const match=page?null:path.match(/^\/api\/v3\/(products|collections|media\/previews|media|session|dashboard|uploads\/sign|uploads\/finalize|inventory\/adjustments|inventory)(?:\/([1-9]\d{0,17})(\/preview)?)?$/);
  if(!match&&!page)throw new HttpError(404,'Not found');
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
  if(req.method==='GET'&&page)result=action==='preview'?await previewPage(db,page[2],url.searchParams.get('source'),options.cloud??cloudAdapter()):page[2]?await pageDetail(db,page[2]):await listPages(db,url.searchParams);
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
   if(page){result=action==='draft-preview'?await previewDraft(db,input,options.cloud??cloudAdapter()):!page[2]?await createPage(db,input,claims.sub):!action?await savePage(db,page[2],input,claims.sub):action==='publish'?await publishPage(db,page[2],input,claims.sub):action==='unpublish'?await unpublishPage(db,page[2],input,claims.sub):await restoreRevision(db,page[2],page[4],input,claims.sub);res.statusCode=page[2]||action==='draft-preview'?200:201;}
   else{
   const cloud=match[1].startsWith('uploads/')?(options.cloud??cloudAdapter()):null;
   result=match[1]==='uploads/sign'?await signUpload(db,claims.sub,cloud,input?.filename):match[1]==='inventory/adjustments'?await adjust(db,input,claims.sub):match[1]==='uploads/finalize'?await finalizeUpload(db,claims.sub,input.id,cloud):await save(db,match[1],input,claims.sub,match[2]);res.statusCode=req.method==='POST'?201:200;
   }
  }
  await db.query('COMMIT');res.end(JSON.stringify(result));
 }catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});res.statusCode=e.status??(['23505','23503','23514','22P02'].includes(e.code)?409:500);res.end(JSON.stringify({error:e.status?e.message:res.statusCode===409?'Data constraint conflict':'Internal server error'}));}
 finally{db?.release();}
};}
