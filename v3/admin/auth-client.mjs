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
