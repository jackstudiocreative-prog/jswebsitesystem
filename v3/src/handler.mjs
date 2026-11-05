import { cloudAdapter,signUpload,finalizeUpload } from './media.mjs';
import { authorize,HttpError } from './auth.mjs';
import { list,save,detail,dashboard } from './catalog.mjs';
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
  const match=path.match(/^\/api\/v3\/(products|collections|media|session|dashboard|uploads\/sign|uploads\/finalize)(?:\/([1-9]\d{0,17})(\/preview)?)?$/);
  if(!match)throw new HttpError(404,'Not found');
  if(!['GET','POST','PATCH'].includes(req.method) || (['media','session','dashboard'].includes(match[1])&&req.method!=='GET') || (match[1].startsWith('uploads/')&&(req.method!=='POST'||match[2])) || (req.method==='PATCH'&&!match[2]) || (req.method==='POST'&&match[2]) || (match[2]&&['session','dashboard'].includes(match[1])) || (match[3]&&match[1]!=='media') || (match[1]==='media'&&match[2]&&!match[3]))throw new HttpError(405,'Method not available');
  const token=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if(!token)throw new HttpError(401,'Staff sign-in required');
  let claims;try{claims=await verify(token);}catch{throw new HttpError(401,'Invalid or expired token');}
  db=await pool.connect();await db.query('BEGIN');
  const staff=await authorize(db,claims,req.method!=='GET');
  let result;
  if(req.method==='GET'){
   if(match[3]){const media=(await db.query("SELECT * FROM media WHERE id=$1 AND state='ready'",[match[2]])).rows[0];if(!media)throw new HttpError(404,'Verified media not found');const cloud=options.cloud??cloudAdapter();result={url:cloud.preview(media),expiresIn:300};}
   else result=match[1]==='session'?{subject:claims.sub,role:staff.role}:match[1]==='dashboard'?await dashboard(db):match[2]?await detail(db,match[1],match[2]):await list(db,match[1],url.searchParams);
  }
  else{
   if(!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'JSON required');
   let body='';
   if(req.body!==undefined){body=typeof req.body==='string'?req.body:Buffer.isBuffer(req.body)?req.body.toString('utf8'):JSON.stringify(req.body);}
   else for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)throw new HttpError(413,'Request too large');}
   if(Buffer.byteLength(body)>65536)throw new HttpError(413,'Request too large');
   let input;try{input=JSON.parse(body);}catch{throw new HttpError(400,'Invalid JSON');}
   const cloud=match[1].startsWith('uploads/')?(options.cloud??cloudAdapter()):null;
   result=match[1]==='uploads/sign'?await signUpload(db,claims.sub,cloud):match[1]==='uploads/finalize'?await finalizeUpload(db,claims.sub,input.id,cloud):await save(db,match[1],input,claims.sub,match[2]);res.statusCode=req.method==='POST'?201:200;
  }
  await db.query('COMMIT');res.end(JSON.stringify(result));
 }catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});res.statusCode=e.status??(['23505','23503','23514','22P02'].includes(e.code)?409:500);res.end(JSON.stringify({error:e.status?e.message:res.statusCode===409?'Data constraint conflict':'Internal server error'}));}
 finally{db?.release();}
};}
