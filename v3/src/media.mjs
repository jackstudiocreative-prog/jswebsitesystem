import {randomUUID} from 'node:crypto';
import {v2 as cloudinary} from 'cloudinary';
import {HttpError} from './auth.mjs';
export function cloudAdapter(env=process.env){
 const {CLOUDINARY_CLOUD_NAME:cloud_name,CLOUDINARY_API_KEY:api_key,CLOUDINARY_API_SECRET:api_secret,CLOUDINARY_UPLOAD_PRESET:preset}=env;
 if(!cloud_name||!api_key||!api_secret||!preset)throw new HttpError(503,'Media service not configured');
 const options={cloud_name,api_key,api_secret,secure:true,timeout:8000};
 return {cloud_name,api_key,preset,sign:p=>cloudinary.utils.api_sign_request(p,api_secret),
  inspect:id=>cloudinary.api.resource(id,{...options,resource_type:'image',type:'authenticated'})};
}
export function validateAsset(asset,publicId){
 if(asset.public_id!==publicId||asset.resource_type!=='image'||asset.type!=='authenticated'||!asset.asset_id||!Number.isSafeInteger(asset.version)||asset.version<1)throw new HttpError(422,'Unexpected asset');
 if(!['jpg','jpeg','png','webp'].includes(asset.format)||!Number.isInteger(asset.bytes)||asset.bytes<1||asset.bytes>10000000||!Number.isInteger(asset.width)||!Number.isInteger(asset.height)||asset.width<1||asset.height<1||asset.width>10000||asset.height>10000||asset.width*asset.height>40000000)throw new HttpError(422,'Image exceeds allowed format, size or dimensions');
}
export async function signUpload(db,actor,cloud){
 // Row lock serializes requests across serverless instances; rollback on any failure.
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[actor]);
 const n=(await db.query("SELECT count(*)::int AS n FROM upload_intents WHERE actor=$1 AND created_at>now()-interval '1 minute'",[actor])).rows[0].n;
 if(n>=10)throw new HttpError(429,'Upload rate limit reached');
 const id=randomUUID(),public_id='jackstudio-websitesystem/products/'+id;
 await db.query("INSERT INTO upload_intents(id,actor,public_id,expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes')",[id,actor,public_id]);
 const params={timestamp:Math.floor(Date.now()/1000),public_id,asset_folder:'jackstudio-websitesystem/products',type:'authenticated',overwrite:false,upload_preset:cloud.preset};
 return {id,params,signature:cloud.sign(params),api_key:cloud.api_key,cloud_name:cloud.cloud_name,finalizeWithinSeconds:600};
}
export async function finalizeUpload(db,actor,id,cloud){
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw new HttpError(400,'Invalid upload intent');
 const intent=(await db.query('SELECT *,expires_at>now() AS valid FROM upload_intents WHERE id=$1 AND actor=$2 FOR UPDATE',[id,actor])).rows[0];
 if(!intent)throw new HttpError(404,'Upload intent not found');
 if(intent.media_id)return (await db.query('SELECT * FROM media WHERE id=$1',[intent.media_id])).rows[0];
 if(!intent.valid)throw new HttpError(410,'Upload intent expired');
 // Ignore browser-provided URL, MIME, dimensions and signatures: query Cloudinary server-to-server.
 let asset;try{asset=await cloud.inspect(intent.public_id);}catch{throw new HttpError(422,'Uploaded asset is not verified');}
 validateAsset(asset,intent.public_id);
 const mime=asset.format==='png'?'image/png':asset.format==='webp'?'image/webp':'image/jpeg';
 const media=(await db.query("INSERT INTO media(object_key,mime,bytes,state,created_by,cloudinary_asset_id,version,width,height,format) VALUES($1,$2,$3,'ready',$4,$5,$6,$7,$8,$9) RETURNING *",[intent.public_id,mime,asset.bytes,actor,asset.asset_id,asset.version,asset.width,asset.height,asset.format])).rows[0];
 await db.query('UPDATE upload_intents SET media_id=$1 WHERE id=$2',[media.id,id]);
 await db.query("INSERT INTO audit_events(actor,action,entity,entity_id) VALUES($1,'upload','media',$2)",[actor,media.id]);
 return media;
}
