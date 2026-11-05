import {checkResult} from './auth-client.mjs';

// Capture once and remove credentials before config/network requests or SDK initialization.
export function captureCallback(location,history){
 const query=new URLSearchParams(location.search??''),hash=new URLSearchParams((location.hash??'').replace(/^#/,''));
 const keys=['code','access_token','refresh_token','type','error','error_code','error_description','token_hash'];
 if(!keys.some(k=>query.has(k)||hash.has(k)))return null;
 history.replaceState(null,'',location.pathname);
 const invalid=()=>({invalid:true});
 if(keys.some(k=>query.getAll(k).length>1||hash.getAll(k).length>1))return invalid();
 if(['error','error_code','error_description','token_hash'].some(k=>query.has(k)||hash.has(k)))return invalid();
 if(query.has('code')){
  if(keys.some(k=>hash.has(k))||keys.some(k=>k!=='code'&&query.has(k))||!query.get('code'))return invalid();
  return {code:query.get('code')};
 }
 if(keys.some(k=>query.has(k))||!['invite','recovery'].includes(hash.get('type'))||!hash.get('access_token')||!hash.get('refresh_token'))return invalid();
 return {type:hash.get('type'),access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token')};
}
export async function completeCallback(auth,callback){
 if(!callback)return null;
 try{
  if(callback.invalid)throw Error();
  let type=callback.type;
  if(callback.code){
   const data=checkResult(await auth.exchangeCodeForSession(callback.code));
   if(!data.session||data.redirectType!=='recovery')throw Error();
   type='recovery';
  }else{
   const data=checkResult(await auth.setSession({access_token:callback.access_token,refresh_token:callback.refresh_token}));
   if(!data.session)throw Error();
  }
  // Ask the configured Auth server, never trust decoded URL claims or metadata for roles.
  const {user}=checkResult(await auth.getUser());
  if(!user?.id||!user.email||(type==='invite'&&!user.invited_at))throw Error();
  return {type,email:user.email};
 }catch{
  await auth.signOut({scope:'local'}).catch(()=>{});
  throw Error('Invitation or recovery link is invalid or expired. Request a new email; recovery links must open in the originating browser tab.');
 }
}
export async function setInvitePassword(auth,password,confirmation){
 if(password.length<16)throw Error('Use at least 16 characters.');
 if(password!==confirmation)throw Error('Passwords do not match.');
 checkResult(await auth.updateUser({password}));
}
