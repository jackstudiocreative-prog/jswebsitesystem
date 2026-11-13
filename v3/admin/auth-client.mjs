// Supabase PKCE verifier entries: the legacy key, per-flow slots and the flow index
// (auth-js 2.118: sb-<ref>-auth-token[-flow-<id>|-flows]-code-verifier). Only these are persisted,
// in localStorage, so a recovery email opened in another tab of the same browser profile can finish
// the exchange. A verifier is useless without the single-use code from the email. Sessions, access
// and refresh tokens stay in this tab's memory only.
const VERIFIER_KEY=/^sb-[a-z0-9]{1,64}-auth-token(?:-flow-[A-Za-z0-9_-]{8,64}|-flows)?-code-verifier$/;
export const VERIFIER_TTL_MS=24*60*60*1000; // longest Supabase email link lifetime
export const isVerifierKey=key=>VERIFIER_KEY.test(String(key));
export function authStorage(verifierStore,{now=Date.now}={}){
 const memory=new Map(),fallback=new Map();
 const attempt=fn=>{try{return {ok:true,value:fn()};}catch{return {ok:false,value:null};}};
 const read=key=>{
  const raw=attempt(()=>verifierStore.getItem(key)).value;
  if(raw==null)return fallback.get(key)??null;
  let item=null;try{item=JSON.parse(raw);}catch{}
  // Expired, foreign or tampered entries are discarded rather than handed to the SDK.
  if(!item||typeof item.value!=='string'||!Number.isFinite(item.expires)||item.expires<=now()||item.expires>now()+VERIFIER_TTL_MS){attempt(()=>verifierStore.removeItem(key));return null;}
  return item.value;
 };
 return {
  getItem:key=>isVerifierKey(key)?read(key):memory.get(key)??null,
  setItem:(key,value)=>{
   if(!isVerifierKey(key)){memory.set(key,value);return;}
   // Storage blocked or full (private mode, quota): keep the verifier in this tab only.
   if(attempt(()=>verifierStore.setItem(key,JSON.stringify({value:String(value),expires:now()+VERIFIER_TTL_MS}))).ok)fallback.delete(key);
   else fallback.set(key,String(value));
  },
  removeItem:key=>{if(isVerifierKey(key)){attempt(()=>verifierStore.removeItem(key));fallback.delete(key);}else memory.delete(key);}
 };
}
// One place for the client options, so tests exercise exactly what the admin uses.
export const authOptions=storage=>({flowType:'pkce',persistSession:true,storage,detectSessionInUrl:false});
export function checkResult(result){if(result.error)throw result.error;return result.data;}
export const TOTP_NAME='Jack Studio Staff';
// listFactors().totp only lists verified factors; unverified ones appear only in `all`.
export async function verifiedFactor(auth){
 const data=checkResult(await auth.mfa.listFactors());return data.totp.find(f=>f.status==='verified')?.id??null;
}
export async function unverifiedTotpFactors(auth){
 const data=checkResult(await auth.mfa.listFactors());
 return (data.all??[]).filter(f=>f.factor_type==='totp'&&f.status==='unverified').map(f=>f.id);
}
// Supabase Auth generates the QR with SVGo, so the markup starts with an XML declaration and a
// comment before <svg>; supabase-js then prefixes it, unencoded, with "data:image/svg+xml;utf-8,".
// Accept that (or bare/percent-encoded markup), validate it, and re-encode it so characters such as
// "#" or "%" cannot break the data URL. The result is only ever used as an <img> src.
const QR_SVG=/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)[\s\S]*<\/svg>\s*$/i;
export function totpQrDataUrl(value){
 if(typeof value!=='string'||value.length>1000000)throw Error('Invalid authenticator QR code');
 const match=value.match(/^data:image\/svg\+xml;(?:utf-8|charset=utf-8),([\s\S]+)$/i);
 let svg=match?match[1]:value;
 if(!svg.trimStart().startsWith('<')){try{svg=decodeURIComponent(svg);}catch{throw Error('Invalid authenticator QR code');}}
 if(!QR_SVG.test(svg))throw Error('Invalid authenticator QR code');
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg.trim());
}
// Removes abandoned (never verified) TOTP enrollments, which would otherwise block a new
// enrollment with the same friendly name. Verified factors are never touched.
export async function clearUnverifiedTotp(auth){
 for(const factorId of await unverifiedTotpFactors(auth))checkResult(await auth.mfa.unenroll({factorId}));
}
export async function enrollTotp(auth){
 if(await verifiedFactor(auth))throw Error('An authenticator is already set up. Enter its code instead.');
 await clearUnverifiedTotp(auth);
 const result=await auth.mfa.enroll({factorType:'totp',friendlyName:TOTP_NAME});
 if(result.error?.code==='mfa_factor_name_conflict')throw Error('An authenticator setup is already in progress for this account. Reload the page and try again.');
 const data=checkResult(result);
 if(data.type!=='totp'||!data.id)throw Error('Invalid authenticator enrollment');
 let qr;
 try{qr=totpQrDataUrl(data.totp?.qr_code);}
 catch(err){await auth.mfa.unenroll({factorId:data.id}).catch(()=>{});throw err;} // do not leave an unusable factor behind
 return {id:data.id,qr};
}
export async function verifyTotp(auth,factorId,code){
 if(!factorId||!/^\d{6}$/.test(code))throw Error('Select an authenticator and enter six digits.');
 const challenge=checkResult(await auth.mfa.challenge({factorId}));
 checkResult(await auth.mfa.verify({factorId,challengeId:challenge.id,code}));
 const assurance=checkResult(await auth.mfa.getAuthenticatorAssuranceLevel());
 if(assurance.currentLevel!=='aal2')throw Error('MFA verification did not establish a verified session');
}
export async function recoverPassword(auth,password){
 if(password.length<16)throw Error('Use at least 16 characters.');
 checkResult(await auth.updateUser({password}));
 checkResult(await auth.signOut({scope:'global'}));
}
