// Payment checks with the gateway (QUERY) and refunds sent through the gateway (REFUND).
//
// Two kinds of refund, kept apart on purpose:
//  - "Record a refund": staff already refunded in the eGHL merchant portal; this system only records it
//    (commerce.mjs, action 'refunds'). No money moves from here.
//  - "Refund through eGHL": this system asks eGHL to refund. Off unless the gateway allows it
//    (EGHL_REFUND_API_ENABLED=true; always on for the staging mock, which moves no money). Each request is
//    logged in gateway_refunds; the money reaches the refund ledger only when eGHL confirms it. An unclear
//    answer (timeout, unverifiable reply) is marked "unknown" and blocks that amount until staff check the
//    eGHL portal and settle it here — never retried automatically, so a customer cannot be refunded twice.
import {HttpError} from './auth.mjs';
import {hasColumn} from './schema.mjs';
import {amount} from './payments.mjs';
import {queueEmail} from './email.mjs';
import {gatewayMessage,lockedOrder,orderDetail,orderAudit,restockOrder,refundInFlight} from './commerce.mjs';

export const MIGRATION_013='This needs database migration 013. Ask the operator to apply it.';
const bad=m=>{throw new HttpError(400,m);};
const ready=db=>hasColumn(db,'refunds','method');
const QUERY_STATUSES=['0','1','2','9','10','15','16','31','-1','-2'];

// Asks the gateway about one payment and applies the answer like a callback (0 paid, 1 failed, 2 pending).
// Other answers (refunded, not found, …) are only recorded. → short outcome text.
async function checkOne(db,payments,p){
 await db.query('UPDATE payments SET last_checked_at=now() WHERE id=$1',[p.id]);
 let r;
 try{r=await payments.query(p);}catch(e){return 'gateway did not answer';}
 if(!r)return 'not supported by this gateway';
 const status=String(r.fields.TxnStatus??'');
 const log=(outcome,verified)=>db.query('INSERT INTO payment_events(payment_id,source,verified,txn_status,outcome,payload) VALUES ($1,$2,$3,$4,$5,$6)',[p.id,'query',verified,status.slice(0,4)||null,outcome,JSON.stringify({PaymentID:p.payment_ref,TxnStatus:status.slice(0,4),TxnExists:String(r.fields.TxnExists??'').slice(0,2)})]);
 if(r.exists===false||status==='-1'){await log('query_not_found',false);return 'eGHL has no record of this payment (the customer did not pay)';}
 if(['0','1','2'].includes(status)){const out=await gatewayMessage(db,'query',r.fields,payments);return out.ok?{0:'eGHL confirms the payment',1:'eGHL reports the payment failed',2:'eGHL reports the payment is still pending'}[status]:'eGHL answer was rejected (see gateway messages)';}
 const msg=payments.verify(r.fields,QUERY_STATUSES);
 await log(msg?'query_status_'+status:'rejected_signature',!!msg);
 return msg?`eGHL status ${status}; check the eGHL merchant portal`:'eGHL answer could not be verified';
}

// Scheduled: unpaid orders whose payment was started but never confirmed (missed callback, closed
// browser). Asked before their stock is released, and again for up to 3 days afterwards.
export async function reconcilePayments(db,payments,{limit=3}={}){
 if(!payments?.canQuery||!await ready(db))return {checked:0,skipped:true};
 const due=(await db.query(`SELECT p.* FROM payments p JOIN orders o ON o.id=p.order_id
  WHERE p.status IN ('initiated','pending') AND o.status IN ('pending_payment','expired') AND p.provider=$2
   AND p.created_at<now()-interval '10 minutes' AND p.created_at>now()-interval '3 days'
   AND (p.last_checked_at IS NULL OR p.last_checked_at<now()-interval '15 minutes')
  ORDER BY p.last_checked_at NULLS FIRST,p.id LIMIT $1 FOR UPDATE OF p SKIP LOCKED`,[limit,payments.provider])).rows;
 const results=[];for(const p of due)results.push(await checkOne(db,payments,p));
 return {checked:due.length,results};
}

// Staff: "Check payment with eGHL" on one order (latest unsettled payment).
export async function checkPayment(db,orderId,input,payments,actor){
 if(!await ready(db))throw new HttpError(503,MIGRATION_013);
 const o=await lockedOrder(db,orderId,input?.revision);
 if(!payments.canQuery)throw new HttpError(409,'This payment gateway cannot be asked for a status. Check the eGHL merchant portal.');
 const p=(await db.query("SELECT * FROM payments WHERE order_id=$1 ORDER BY id DESC LIMIT 1 FOR UPDATE",[o.id])).rows[0];
 if(!p)bad('This order has no payment yet');
 const outcome=await checkOne(db,payments,p);
 await orderAudit(db,actor,'payment_checked',o.id,`${p.payment_ref}: ${outcome}`);
 return {...await orderDetail(db,o.id),check_result:outcome};
}

// Staff: refund through the gateway, in three steps so the request is saved before eGHL is called:
// prepare (own transaction, committed) → payments.refund() → finish (own transaction). If anything fails
// after the call, the request stays "pending" and blocks that amount until staff settle it.
export async function prepareGatewayRefund(db,orderId,input,payments,actor){
 if(!await ready(db))throw new HttpError(503,MIGRATION_013);
 if(!input||typeof input!=='object')bad('Object required');
 const o=await lockedOrder(db,orderId,input.revision);
 if(!payments.refundsEnabled)throw new HttpError(409,payments.refundsDisabledReason);
 if(o.status!=='paid')bad('Only paid orders can be refunded');
 if(await refundInFlight(db,o.id))throw new HttpError(409,'A refund through eGHL is still waiting for a clear answer. Settle it first.');
 const value=input.amount_minor;if(!Number.isInteger(value)||value<1||value>o.total_minor-o.refunded_minor)bad('Refund must be between RM 0.01 and the amount not yet refunded');
 const note=String(input.note??'').trim().slice(0,500),restock=input.restock===true;
 if(restock&&(await db.query('SELECT 1 FROM refunds WHERE order_id=$1 AND restocked',[o.id])).rows.length)bad('Items for this order were already restocked');
 const p=(await db.query("SELECT * FROM payments WHERE order_id=$1 AND status='succeeded' ORDER BY id DESC LIMIT 1",[o.id])).rows[0];
 if(!p)bad('No successful payment to refund');
 const gr=(await db.query('INSERT INTO gateway_refunds(order_id,payment_id,amount_minor,restock,note,actor) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',[o.id,p.id,value,restock,note,actor])).rows[0];
 await db.query('UPDATE orders SET revision=revision+1,updated_at=now() WHERE id=$1',[o.id]);
 await orderAudit(db,actor,'refund_gateway_requested',o.id,`${amount(value)} MYR`);
 return {gr,payment:p};
}
export async function finishGatewayRefund(db,grId,r,actor){
 const gr=(await db.query("SELECT * FROM gateway_refunds WHERE id=$1 AND status='pending' FOR UPDATE",[grId])).rows[0];
 if(!gr)return; // already settled by staff in the meantime
 const o=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[gr.order_id])).rows[0];
 await db.query('UPDATE gateway_refunds SET status=$2,gateway_txn_id=$3,message=$4,updated_at=now() WHERE id=$1',[gr.id,r.status,r.txnId,String(r.message??'').slice(0,300)]);
 if(r.status==='succeeded')await settle(db,o,gr,r.txnId,actor);
 else await db.query('UPDATE orders SET revision=revision+1,updated_at=now() WHERE id=$1',[o.id]);
 await orderAudit(db,actor,'refund_gateway_'+r.status,o.id,`${amount(gr.amount_minor)} MYR${r.txnId?' · '+r.txnId:''}${r.status==='succeeded'?'':' · '+String(r.message??'').slice(0,120)}`);
}

// Staff: after checking the eGHL portal, settle a gateway refund that was pending or unclear.
export async function settleGatewayRefund(db,orderId,refundId,input,actor){
 if(!await ready(db))throw new HttpError(503,MIGRATION_013);
 const o=await lockedOrder(db,orderId,input?.revision);
 const gr=(await db.query('SELECT * FROM gateway_refunds WHERE id=$1 AND order_id=$2 FOR UPDATE',[refundId,o.id])).rows[0];
 if(!gr)throw new HttpError(404,'Refund not found');
 if(!['pending','unknown'].includes(gr.status))throw new HttpError(409,'This refund is already settled');
 const outcome=input?.outcome;if(!['succeeded','failed'].includes(outcome))bad('Choose whether eGHL refunded the money');
 const reference=String(input.reference??'').trim();
 if(outcome==='succeeded'&&(reference.length<1||reference.length>80))bad('Enter the eGHL refund reference from the merchant portal');
 if(outcome==='succeeded'&&gr.amount_minor>o.total_minor-o.refunded_minor)bad('This refund is more than the amount not yet refunded');
 await db.query('UPDATE gateway_refunds SET status=$2,gateway_txn_id=coalesce(nullif($3,\'\'),gateway_txn_id),message=left(message||\' Settled by staff after checking eGHL.\',300),updated_at=now() WHERE id=$1',[gr.id,outcome,reference]);
 if(outcome==='succeeded')await settle(db,o,gr,reference||gr.gateway_txn_id,actor);
 await orderAudit(db,actor,'refund_gateway_settled_'+outcome,o.id,`${amount(gr.amount_minor)} MYR${reference?' · '+reference:''}`);
 return orderDetail(db,o.id);
}

// A confirmed gateway refund enters the ledger, restocks if asked, and emails the customer.
async function settle(db,o,gr,txnId,actor){
 const refund=(await db.query("INSERT INTO refunds(order_id,amount_minor,reference,note,restocked,actor,method) VALUES ($1,$2,$3,$4,$5,$6,'gateway') RETURNING id",[o.id,gr.amount_minor,String(txnId||'eGHL').slice(0,80),gr.note,gr.restock,actor])).rows[0];
 await db.query('UPDATE gateway_refunds SET refund_id=$2 WHERE id=$1',[gr.id,refund.id]);
 if(gr.restock)await restockOrder(db,o,actor,`refund ${txnId||'eGHL'}`);
 await db.query('UPDATE orders SET refunded_minor=refunded_minor+$2,revision=revision+1,updated_at=now() WHERE id=$1',[o.id,gr.amount_minor]);
 await queueEmail(db,o.id,'order_refunded',{amount_minor:gr.amount_minor,refund_id:String(refund.id)});
}
