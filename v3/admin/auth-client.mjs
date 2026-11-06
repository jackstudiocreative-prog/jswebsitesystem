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
export async function verifiedFactor(auth){
 const data=checkResult(await auth.mfa.listFactors());return data.totp.find(f=>f.status==='verified')?.id??null;
}
// Supabase already returns a data URL. Validate it without wrapping or re-encoding it.
export function totpQrDataUrl(value){
 if(typeof value!=='string'||value.length>1000000)throw Error('Invalid authenticator QR code');
 const match=value.match(/^data:image\/svg\+xml;(?:utf-8|charset=utf-8),([\s\S]+)$/i);
 if(!match)throw Error('Invalid authenticator QR code');
 let svg;try{svg=decodeURIComponent(match[1]);}catch{throw Error('Invalid authenticator QR code');}
 if(!/^\s*<svg(?:\s|>)[\s\S]*<\/svg>\s*$/i.test(svg))throw Error('Invalid authenticator QR code');
 return value;
}
export async function enrollTotp(auth){
 const data=checkResult(await auth.mfa.enroll({factorType:'totp',friendlyName:'Jack Studio Staff'}));
 if(data.type!=='totp'||!data.id)throw Error('Invalid authenticator enrollment');
 return {id:data.id,qr:totpQrDataUrl(data.totp?.qr_code)};
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
