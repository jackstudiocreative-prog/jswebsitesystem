import {createHash,timingSafeEqual} from 'node:crypto';
import {HttpError} from './auth.mjs';
// eGHL hosted payment page, the same gateway as the Shopify store. The browser posts a signed form to
// eGHL; only a server-to-server callback (or browser return) whose signature verifies can change a
// payment. Card details never reach this system.
//
// Request hash (confirmed from eGHL's published SDK usage, callback flow):
//   SHA256(Password + ServiceID + PaymentID + MerchantReturnURL + MerchantCallBackURL + Amount + CurrencyCode + CustIP + PageTimeout)
// Response hash: CONFIRM FIELD ORDER WITH eGHL's MERCHANT DOCUMENTATION during sandbox testing.
//   HashValue2 = SHA256(Password + TxnID + ServiceID + PaymentID + TxnStatus + Amount + CurrencyCode + AuthCode + OrderNumber + Param6 + Param7)
//   HashValue  = SHA256(Password + TxnID + ServiceID + PaymentID + TxnStatus + Amount + CurrencyCode + AuthCode)
// TxnStatus: 0 = success, 1 = failed, 2 = pending.
export const PAGE_TIMEOUT='900';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const same=(a,b)=>{const x=Buffer.from(String(a??'').toLowerCase()),y=Buffer.from(String(b??'').toLowerCase());return x.length===y.length&&x.length>0&&timingSafeEqual(x,y);};
export const amount=minor=>(minor/100).toFixed(2);
export const requestHash=(password,f)=>sha(password+f.ServiceID+f.PaymentID+f.MerchantReturnURL+f.MerchantCallBackURL+f.Amount+f.CurrencyCode+f.CustIP+f.PageTimeout);
export const responseHash=(password,f)=>sha(password+(f.TxnID??'')+f.ServiceID+f.PaymentID+f.TxnStatus+f.Amount+f.CurrencyCode+(f.AuthCode??''));
export const responseHash2=(password,f)=>sha(password+(f.TxnID??'')+f.ServiceID+f.PaymentID+f.TxnStatus+f.Amount+f.CurrencyCode+(f.AuthCode??'')+(f.OrderNumber??'')+(f.Param6??'')+(f.Param7??''));
function gateway({provider,serviceId,password,actionUrl,baseUrl}){
 const urls={MerchantReturnURL:`${baseUrl}/api/v3/payments/${provider}/return`,MerchantCallBackURL:`${baseUrl}/api/v3/payments/${provider}/callback`};
 return {
  provider,
  request(payment,order,custIp){
   const f={TransactionType:'SALE',PymtMethod:'ANY',ServiceID:serviceId,PaymentID:payment.payment_ref,OrderNumber:order.number,PaymentDesc:`Jack Studio order ${order.number}`,...urls,Amount:amount(payment.amount_minor),CurrencyCode:'MYR',CustIP:custIp,CustName:order.customer_name,CustEmail:order.email,CustPhone:order.phone,LanguageCode:'en',PageTimeout:PAGE_TIMEOUT};
   return {action:actionUrl,method:'POST',fields:{...f,HashValue:requestHash(password,f)}};
  },
  // Returns null when the message is not from the gateway (bad or missing signature, wrong merchant).
  verify(f){
   if(!f||f.ServiceID!==serviceId||!f.PaymentID||!['0','1','2'].includes(String(f.TxnStatus))||!/^\d+\.\d{2}$/.test(String(f.Amount??'')))return null;
   const ok=f.HashValue2?same(f.HashValue2,responseHash2(password,f)):same(f.HashValue,responseHash(password,f));
   if(!ok)return null;
   return {paymentRef:String(f.PaymentID),txnStatus:String(f.TxnStatus),amount:String(f.Amount),currency:String(f.CurrencyCode),txnId:f.TxnID?String(f.TxnID).slice(0,80):null,authCode:f.AuthCode?String(f.AuthCode).slice(0,40):null};
  },
  // Mock only: builds the same signed callback eGHL would send, so the full path is exercised on staging.
  simulate(payment,order,outcome){
   if(provider!=='mock')throw new HttpError(404,'Not found');
   const f={TransactionType:'SALE',PymtMethod:'ANY',ServiceID:serviceId,PaymentID:payment.payment_ref,OrderNumber:order.number,Amount:amount(payment.amount_minor),CurrencyCode:'MYR',TxnID:'MOCK'+payment.id,AuthCode:outcome==='approve'?'MOCK01':'',TxnStatus:outcome==='approve'?'0':outcome==='pending'?'2':'1',TxnMessage:outcome,Param6:'',Param7:''};
   return {...f,HashValue2:responseHash2(password,f)};
  }
 };
}
// Configuration comes only from environment variables. Mock payments are refused outside staging.
export function paymentAdapter(env=process.env){
 const baseUrl=env.PUBLIC_BASE_URL??'';
 if(!/^https:\/\/[^/]+$/.test(baseUrl))throw new HttpError(503,'Checkout is not configured');
 if(env.PAYMENT_PROVIDER==='eghl'){
  if(!env.EGHL_SERVICE_ID||!env.EGHL_PASSWORD||!/^https:\/\//.test(env.EGHL_PAYMENT_URL??''))throw new HttpError(503,'Checkout is not configured');
  return gateway({provider:'eghl',serviceId:env.EGHL_SERVICE_ID,password:env.EGHL_PASSWORD,actionUrl:env.EGHL_PAYMENT_URL,baseUrl});
 }
 if(env.PAYMENT_PROVIDER==='mock'&&env.APP_ENV==='staging'&&(env.MOCK_PAYMENT_SECRET??'').length>=32)
  return gateway({provider:'mock',serviceId:'JSMOCK',password:env.MOCK_PAYMENT_SECRET,actionUrl:`${baseUrl}/pay/mock`,baseUrl});
 throw new HttpError(503,'Checkout is not configured');
}
export {gateway as testGateway};
