import {timingSafeEqual} from 'node:crypto';
import {HttpError} from './auth.mjs';
import {sweepExpired,EXPIRABLE} from './commerce.mjs';

// An external scheduler must call the Staging endpoint. Vercel Cron targets Production only.
// No background timer: a whole bounded batch commits before the response is sent.
export const EXPIRY_BATCH=50;
export function authorizeMaintenance(authorization,secret){
 if(typeof secret!=='string'||secret.length<32)throw new HttpError(503,'Maintenance is not configured');
 const expected=Buffer.from('Bearer '+secret),actual=Buffer.from(String(authorization??''));
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new HttpError(401,'Maintenance authorization required');
}
export async function runMaintenance(db){
 const expired=await sweepExpired(db,EXPIRY_BATCH);
 await db.query("DELETE FROM rate_limits WHERE window_start<now()-interval '1 day'");
 const backlog=(await db.query("SELECT count(*)::int AS n,min(expires_at) AS oldest_due_at FROM orders o WHERE "+EXPIRABLE)).rows[0];
 return {expired,more:backlog.n>0,due:backlog.n,oldest_due_at:backlog.oldest_due_at};
}
