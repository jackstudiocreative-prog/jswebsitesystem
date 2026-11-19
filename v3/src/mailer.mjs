// Sending the email outbox (src/email.mjs queues messages in the order's own transaction).
//
// Provider: Resend (HTTPS API), configured with RESEND_API_KEY and EMAIL_FROM. Nothing else is needed;
// there is no SMTP client in this system.
// Safety: unless EMAIL_MODE=live, every message goes to EMAIL_TEST_RECIPIENT instead of the customer
// (subject marked "[TEST for customer@…]"). Without a test recipient and not live, nothing is sent.
// Retries: a failed message is retried after 5, 10, 20, 40 minutes; after 5 attempts it stays "failed"
// until staff press Retry. The provider receives an idempotency key per message, so a retry after an
// unclear result (timeout) cannot deliver the same message twice.
import {HttpError} from './auth.mjs';
import {hasColumn} from './schema.mjs';

export const MAX_ATTEMPTS=5;
export function mailerFromEnv(env=process.env){
 const key=env.RESEND_API_KEY,from=env.EMAIL_FROM,live=env.EMAIL_MODE==='live',test=env.EMAIL_TEST_RECIPIENT||null;
 if(!key||!from)return {configured:false,live,test,reason:'No email provider is configured (RESEND_API_KEY and EMAIL_FROM).'};
 if(!live&&!test)return {configured:false,live,test,reason:'Set EMAIL_TEST_RECIPIENT (or EMAIL_MODE=live on the live store) before sending.'};
 return {configured:true,live,test,provider:'resend',from,
  async send({to,subject,text,idempotencyKey}){
   const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({from,to:[to],subject,text})});
   const body=await r.json().catch(()=>({}));
   if(!r.ok)throw Object.assign(new Error((body.message||body.name||'Provider error '+r.status).slice(0,300)),{permanent:r.status>=400&&r.status<500&&r.status!==429});
   return body.id??null;
  }};
}
const backoff=attempts=>5*2**Math.max(0,attempts-1); // minutes

// Sends up to `limit` due messages. Rows are locked (SKIP LOCKED) so two runs never send the same row.
export async function sendPending(db,mailer,{limit=20}={}){
 if(!mailer?.configured)return {sent:0,failed:0,skipped:true,reason:mailer?.reason??'Email is not configured'};
 const retryCol=await hasColumn(db,'email_outbox','next_attempt_at');
 const rows=(await db.query(`SELECT * FROM email_outbox WHERE status='pending'${retryCol?' AND next_attempt_at<=now()':''} ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,[limit])).rows;
 let sent=0,failed=0;
 for(const m of rows){
  const to=mailer.live?m.recipient:mailer.test,subject=mailer.live?m.subject:`[TEST for ${m.recipient}] ${m.subject}`.slice(0,200);
  try{
   const id=await mailer.send({to,subject,text:m.body,idempotencyKey:'jackstudio-outbox-'+m.id});
   await db.query(`UPDATE email_outbox SET status='sent',sent_at=now(),attempts=attempts+1,last_error=''${retryCol?',provider_id=$2':''} WHERE id=$1`,retryCol?[m.id,id?String(id).slice(0,200):null]:[m.id]);sent++;
  }catch(e){
   const attempts=m.attempts+1,give_up=e.permanent||attempts>=MAX_ATTEMPTS;
   await db.query(`UPDATE email_outbox SET attempts=$2,last_error=$3,status=$4${retryCol?",next_attempt_at=now()+make_interval(mins=>$5)":''} WHERE id=$1`,retryCol?[m.id,attempts,String(e.message).slice(0,500),give_up?'failed':'pending',backoff(attempts)]:[m.id,attempts,String(e.message).slice(0,500),give_up?'failed':'pending']);failed++;
  }
 }
 return {sent,failed,skipped:false};
}
export async function retryEmail(db,id){
 const retryCol=await hasColumn(db,'email_outbox','next_attempt_at');
 const r=(await db.query(`UPDATE email_outbox SET status='pending'${retryCol?',next_attempt_at=now()':''} WHERE id=$1 AND status='failed' RETURNING id`,[id])).rows[0];
 if(!r)throw new HttpError(409,'Only failed emails can be retried');
 return {id:String(r.id),status:'pending'};
}
export async function emailStatus(db,mailer){
 const counts=Object.fromEntries((await db.query("SELECT status,count(*)::int AS n FROM email_outbox GROUP BY status")).rows.map(r=>[r.status,r.n]));
 const recent=(await db.query("SELECT e.id,e.kind,e.recipient,e.subject,e.status,e.attempts,e.last_error,e.created_at,e.sent_at,o.number FROM email_outbox e JOIN orders o ON o.id=e.order_id ORDER BY e.id DESC LIMIT 50")).rows.map(r=>({...r,id:String(r.id)}));
 return {configured:!!mailer?.configured,mode:mailer?.live?'live':'test',test_recipient:mailer?.live?null:mailer?.test??null,reason:mailer?.configured?null:mailer?.reason,counts:{pending:counts.pending??0,sent:counts.sent??0,failed:counts.failed??0},recent};
}
