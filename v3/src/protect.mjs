import {createHash} from 'node:crypto';
import {HttpError} from './auth.mjs';
// Fixed-window limits shared by every serverless instance (PostgreSQL counters). Call with a
// connection that is NOT inside the request transaction, so a rejected request still counts.
export const LIMITS=Object.freeze({
 checkout:[10,600],          // per client IP: 10 checkouts per 10 minutes
 'checkout-email':[5,3600],  // per email: 5 checkouts per hour
 pay:[10,600],               // payment retries per IP
 status:[60,60],             // order status checks per IP
 cart:[120,60],              // bag pricing per IP
 mock:[30,60]                // staging mock gateway per IP
});
export const MAX_PENDING_PER_EMAIL=3;
export async function limit(db,name,id){
 const [max,seconds]=LIMITS[name];
 const key=name+':'+createHash('sha256').update(String(id).toLowerCase()).digest('hex');
 const hits=(await db.query(`INSERT INTO rate_limits(key,window_start,hits) VALUES ($1,to_timestamp(floor(extract(epoch FROM now())/$2)*$2),1)
  ON CONFLICT (key,window_start) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits`,[key,seconds])).rows[0].hits;
 if(Math.random()<0.02)await db.query("DELETE FROM rate_limits WHERE window_start<now()-interval '1 day'");
 if(hits>max)throw new HttpError(429,'Too many requests. Please wait a moment and try again.');
}
