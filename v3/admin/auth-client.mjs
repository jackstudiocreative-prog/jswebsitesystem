export function authStorage(storage){
 const memory=new Map();
 return {getItem:key=>key.endsWith('-code-verifier')?storage.getItem(key):memory.get(key)??null,
 setItem:(key,value)=>key.endsWith('-code-verifier')?storage.setItem(key,value):memory.set(key,value),
 removeItem:key=>{storage.removeItem(key);memory.delete(key);}};
}
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
