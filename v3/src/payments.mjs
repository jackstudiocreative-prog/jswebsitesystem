import {createHash,timingSafeEqual} from 'node:crypto';
import {HttpError} from './auth.mjs';
// eGHL hosted payment page, the same gateway as the Shopify store. The browser posts a signed form to
// eGHL; only a server-to-server callback (or browser return) whose signature verifies can change a
// payment. Card details never reach this system.
//
// UNVERIFIED PROTOCOL CANDIDATE: neither hash has been validated against this merchant's official
// integration document or eGHL Sandbox. Mock tests only prove our internal consistency.
// Request hash (omitted optional fields are assumed empty; confirm with the merchant document):
//   SHA256(Password + ServiceID + PaymentID + MerchantReturnURL + MerchantCallBackURL + Amount + CurrencyCode + CustIP + PageTimeout)
// Response hash: CONFIRM FIELD ORDER WITH eGHL's MERCHANT DOCUMENTATION during sandbox testing.
//   HashValue2 = SHA256(Password + TxnID + ServiceID + PaymentID + TxnStatus + Amount + CurrencyCode + AuthCode + OrderNumber + Param6 + Param7)
//   HashValue  = SHA256(Password + TxnID + ServiceID + PaymentID + TxnStatus + Amount + CurrencyCode + AuthCode)
// TxnStatus: 0 = success, 1 = failed, 2 = pending.
// Checked against "eGHL Internet Payment Gateway Merchant Integration Guide 2.8n" (sections 2.13.1.1-3):
// the request hash also includes MerchantApprovalURL, MerchantUnApprovalURL, CardNo and Token, which are
// empty because we do not send them, so the formula above is the same. QUERY and REFUND requests hash
// Password + ServiceID + PaymentID + Amount + CurrencyCode. QUERY answers carry the payment response
// fields (signed like a payment response) plus TxnExists. Still to confirm with this merchant's current
// document and eGHL Sandbox before live use.
export const PAGE_TIMEOUT='900';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const same=(a,b)=>{const x=Buffer.from(String(a??'').toLowerCase()),y=Buffer.from(String(b??'').toLowerCase());return x.length===y.length&&x.length>0&&timingSafeEqual(x,y);};
export const amount=minor=>(minor/100).toFixed(2);
export const requestHash=(password,f)=>sha(password+f.ServiceID+f.PaymentID+f.MerchantReturnURL+f.MerchantCallBackURL+f.Amount+f.CurrencyCode+f.CustIP+f.PageTimeout);
export const responseHash=(password,f)=>sha(password+(f.TxnID??'')+f.ServiceID+f.PaymentID+f.TxnStatus+f.Amount+f.CurrencyCode+(f.AuthCode??''));
export const queryHash=(password,f)=>sha(password+f.ServiceID+f.PaymentID+f.Amount+f.CurrencyCode);
export const responseHash2=(password,f)=>sha(password+(f.TxnID??'')+f.ServiceID+f.PaymentID+f.TxnStatus+f.Amount+f.CurrencyCode+(f.AuthCode??'')+(f.OrderNumber??'')+(f.Param6??'')+(f.Param7??''));
// Server-to-server call to eGHL (QUERY / REFUND). Answers are "key=value&…" strings.
async function post(url,fields,timeoutMs){
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields).toString(),signal:AbortSignal.timeout(timeoutMs)});
 if(!r.ok)throw new Error('Gateway answered HTTP '+r.status);
 return Object.fromEntries(new URLSearchParams((await r.text()).trim()));
}
function gateway({provider,serviceId,password,actionUrl,baseUrl,apiUrl=actionUrl,refundsEnabled=false,transport=post}){
 const urls={MerchantReturnURL:`${baseUrl}/api/v3/payments/${provider}/return`,MerchantCallBackURL:`${baseUrl}/api/v3/payments/${provider}/callback`};
 const self={
  provider,
  request(payment,order,custIp){
   const f={TransactionType:'SALE',PymtMethod:'ANY',ServiceID:serviceId,PaymentID:payment.payment_ref,OrderNumber:order.number,PaymentDesc:`Jack Studio order ${order.number}`,...urls,Amount:amount(payment.amount_minor),CurrencyCode:'MYR',CustIP:custIp,CustName:order.customer_name,CustEmail:order.email,CustPhone:order.phone,LanguageCode:'en',PageTimeout:PAGE_TIMEOUT};
   return {action:actionUrl,method:'POST',fields:{...f,HashValue:requestHash(password,f)}};
  },
  // Returns null when the message is not from the gateway (bad or missing signature, wrong merchant).
  verify(f,statuses=['0','1','2']){
   if(!f||Object.values(f).some(v=>typeof v!=='string'))return null;
   if(!f||f.ServiceID!==serviceId||!f.PaymentID||!statuses.includes(String(f.TxnStatus))||!/^\d+\.\d{2}$/.test(String(f.Amount??'')))return null;
   if(!/^[0-9a-f]{64}$/i.test(f.HashValue2||f.HashValue||''))return null;
   const ok=f.HashValue2?same(f.HashValue2,responseHash2(password,f)):same(f.HashValue,responseHash(password,f));
   if(!ok)return null;
   return {paymentRef:String(f.PaymentID),txnStatus:String(f.TxnStatus),amount:String(f.Amount),currency:String(f.CurrencyCode),orderNumber:f.HashValue2?f.OrderNumber:null,txnId:f.TxnID?String(f.TxnID).slice(0,80):null,authCode:f.AuthCode?String(f.AuthCode).slice(0,40):null,pymtMethod:/^[A-Z]{2,10}$/.test(f.PymtMethod??'')&&f.PymtMethod!=='ANY'?f.PymtMethod:null};
  },
  // QUERY: the gateway's own record of a payment. → {fields, exists} or null when this gateway cannot be asked.
  // fields are signed like a payment response; the caller verifies them with verify(fields, …statuses).
  canQuery:provider==='eghl',
  async query(payment){
   if(provider!=='eghl')return null;
   const f={TransactionType:'QUERY',PymtMethod:payment.pymt_method||'ANY',ServiceID:serviceId,PaymentID:payment.payment_ref,Amount:amount(payment.amount_minor),CurrencyCode:'MYR'};
   const res=await transport(apiUrl,{...f,HashValue:queryHash(password,f)},8000);
   return {fields:res,exists:res.TxnExists===undefined?null:res.TxnExists==='0'};
  },
  // REFUND through the gateway. Off unless explicitly enabled (EGHL_REFUND_API_ENABLED=true); the mock
  // gateway "refunds" without money so the staff flow can be tried on staging.
  refundsEnabled:provider==='mock'||refundsEnabled,
  refundsDisabledReason:provider==='mock'||refundsEnabled?null:'Refunds through eGHL are not switched on for this store. Refund in the eGHL merchant portal, then record the refund here.',
  async refund(payment,amountMinor){
   if(!(provider==='mock'||refundsEnabled))throw new HttpError(409,'Refunds through eGHL are not switched on');
   const f={TransactionType:'REFUND',PymtMethod:payment.pymt_method||'ANY',ServiceID:serviceId,PaymentID:payment.payment_ref,Amount:amount(amountMinor),CurrencyCode:'MYR'};
   if(provider==='mock')return {status:'succeeded',txnId:'MOCKRF'+payment.id+'-'+amountMinor,message:'Mock refund (no money moved)'};
   let res;try{res=await transport(apiUrl,{...f,HashValue:queryHash(password,f)},15000);}
   catch(e){return {status:'unknown',txnId:null,message:'No clear answer from eGHL ('+String(e.message).slice(0,120)+'). Check the eGHL merchant portal before trying again.'};}
   // The answer must be signed and about this payment and amount; otherwise staff check the portal.
   const msg=self.verify(res,['0','1','2','-1','-2']);
   if(!msg||msg.paymentRef!==payment.payment_ref||msg.amount!==f.Amount)return {status:'unknown',txnId:null,message:'eGHL answer could not be verified. Check the eGHL merchant portal.'};
   const status=msg.txnStatus==='0'?'succeeded':msg.txnStatus==='2'?'pending':'failed';
   return {status,txnId:msg.txnId,message:String(res.TxnMessage??'').slice(0,200)};
  },
  // Mock only: builds the same signed callback eGHL would send, so the full path is exercised on staging.
  simulate(payment,order,outcome){
   if(provider!=='mock')throw new HttpError(404,'Not found');
   const f={TransactionType:'SALE',PymtMethod:'ANY',ServiceID:serviceId,PaymentID:payment.payment_ref,OrderNumber:order.number,Amount:amount(payment.amount_minor),CurrencyCode:'MYR',TxnID:'MOCK'+payment.id,AuthCode:outcome==='approve'?'MOCK01':'',TxnStatus:outcome==='approve'?'0':outcome==='pending'?'2':'1',TxnMessage:outcome,Param6:'',Param7:''};
   return {...f,HashValue2:responseHash2(password,f)};
  }
 };
 return self;
}
// Configuration comes only from environment variables. Mock payments are refused outside staging.
export function paymentAdapter(env=process.env){
 const baseUrl=env.PUBLIC_BASE_URL??'';
 if(!/^https:\/\/[^/]+$/.test(baseUrl))throw new HttpError(503,'Checkout is not configured');
 if(env.PAYMENT_PROVIDER==='eghl'){
  if(env.APP_ENV!=='staging'||env.EGHL_SANDBOX_ENABLED!=='true')throw new HttpError(503,'eGHL sandbox validation is required');
  if(!env.EGHL_SERVICE_ID||!env.EGHL_PASSWORD||!/^https:\/\//.test(env.EGHL_PAYMENT_URL??''))throw new HttpError(503,'Checkout is not configured');
  return gateway({provider:'eghl',serviceId:env.EGHL_SERVICE_ID,password:env.EGHL_PASSWORD,actionUrl:env.EGHL_PAYMENT_URL,apiUrl:/^https:\/\//.test(env.EGHL_API_URL??'')?env.EGHL_API_URL:env.EGHL_PAYMENT_URL,refundsEnabled:env.EGHL_REFUND_API_ENABLED==='true',baseUrl});
 }
 if(env.PAYMENT_PROVIDER==='mock'&&env.APP_ENV==='staging'&&(env.MOCK_PAYMENT_SECRET??'').length>=32)
  return gateway({provider:'mock',serviceId:'JSMOCK',password:env.MOCK_PAYMENT_SECRET,actionUrl:`${baseUrl}/pay/mock`,baseUrl});
 throw new HttpError(503,'Checkout is not configured');
}
export {gateway as testGateway};
