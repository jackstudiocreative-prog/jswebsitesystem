import {mountAdmin} from './catalog-ui.mjs';
import {createClient} from '@supabase/supabase-js';
import {authStorage,checkResult,verifiedFactor,enrollTotp,verifyTotp,recoverPassword} from './auth-client.mjs';
import {captureCallback,completeCallback,setInvitePassword} from './auth-callback.mjs';
const callback=captureCallback(location,history);
const $=id=>document.getElementById(id),message=text=>{$('message').textContent=text;};
let adminUI,client,factor,role,recovery=false,invitation=false;
async function api(path,body,method=body?'POST':'GET'){
 const {session}=checkResult(await client.auth.getSession());
 const response=await fetch('/api/v3/'+path,{method,headers:{Authorization:'Bearer '+(session?.access_token??''),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw Error(data.error);return data;
}
function action(id,fn){$(id).addEventListener('click',async e=>{e.preventDefault();$(id).disabled=true;try{await fn();}catch(err){message(err.message);}finally{$(id).disabled=false;}});}
async function refresh(){if(adminUI)await adminUI.reload();}
async function workspace(){
 const staff=await api('session');role=staff.role;$('workspace').hidden=false;$('mfa').hidden=true;$('upload').disabled=role==='viewer';$('file').disabled=role==='viewer';message('Signed in as '+role);if(!adminUI)adminUI=mountAdmin(api,role,message);await refresh();
}
async function signedIn(){
 if(invitation||recovery)throw Error('Complete password setup first.');
 $('login').hidden=true;$('logout').hidden=false;$('mfa').hidden=false;factor=await verifiedFactor(client.auth);
 const assurance=checkResult(await client.auth.mfa.getAuthenticatorAssuranceLevel());
 if(assurance.currentLevel==='aal2')await workspace();else message(factor?'Enter authenticator code.':'Enroll an authenticator before continuing.');
}
try{
 const config=await (await fetch('/auth-config.json')).json();if(!config.url||!config.key)throw Error('Staging authentication is not configured.');
 client=createClient(config.url,config.key,{auth:{flowType:'pkce',persistSession:true,storage:authStorage(sessionStorage),detectSessionInUrl:false}});
 client.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY'){recovery=true;$('workspace').hidden=true;$('mfa').hidden=true;$('recovery').hidden=false;$('login').hidden=true;message('Choose a new password.');}if(event==='SIGNED_OUT'){adminUI?.destroy();adminUI=null;factor=null;role=null;recovery=false;invitation=false;$('invitation').hidden=true;$('invite-password').value='';$('invite-confirm').value='';$('new-password').value='';$('qr').removeAttribute('src');$('qr').hidden=true;$('code').value='';$('recovery').hidden=true;$('workspace').hidden=true;$('mfa').hidden=true;$('logout').hidden=true;$('login').hidden=false;}});
 $('login').onsubmit=async e=>{e.preventDefault();try{checkResult(await client.auth.signInWithPassword({email:$('email').value,password:$('password').value}));$('password').value='';await signedIn();}catch(err){message(err.message);}};
 action('reset',async()=>{checkResult(await client.auth.resetPasswordForEmail($('email').value,{redirectTo:location.origin+'/admin'}));message('If eligible, a recovery email has been sent. Open it in this browser.');});
 action('update-password',async()=>{if(!recovery)throw Error('Open a valid password recovery link first.');await recoverPassword(client.auth,$('new-password').value);$('new-password').value='';$('recovery').hidden=true;message('Password updated. Sign in again.');});
 action('set-invite-password',async()=>{if(!invitation)throw Error('Open a valid invitation first.');await setInvitePassword(client.auth,$('invite-password').value,$('invite-confirm').value);$('invite-password').value='';$('invite-confirm').value='';invitation=false;$('invitation').hidden=true;await signedIn();});
 action('enroll',async()=>{if(invitation||recovery)throw Error('Complete password setup first.');if(factor)throw Error('An authenticator is already selected.');const data=await enrollTotp(client.auth);factor=data.id;$('qr').src=data.qr;$('qr').hidden=false;message('Scan the QR code and enter the six-digit code.');});
 action('verify',async()=>{if(invitation||recovery)throw Error('Complete password setup first.');await verifyTotp(client.auth,factor,$('code').value);$('code').value='';$('qr').removeAttribute('src');$('qr').hidden=true;await workspace();});
 action('logout',async()=>{checkResult(await client.auth.signOut());message('Signed out.');});
 action('refresh',refresh);
 action('upload',async()=>{
  if(role==='viewer')throw Error('Editor permission required');const file=$('file').files[0];if(!file||file.size>10000000||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose JPEG/PNG/WebP up to 10 MB.');
  const intent=await api('uploads/sign',{}),form=new FormData();form.set('file',file);for(const [k,v]of Object.entries(intent.params))form.set(k,String(v));form.set('api_key',intent.api_key);form.set('signature',intent.signature);
  const response=await fetch('https://api.cloudinary.com/v1_1/'+encodeURIComponent(intent.cloud_name)+'/image/upload',{method:'POST',body:form});if(!response.ok)throw Error('Upload failed; no database image was published.');
  await api('uploads/finalize',{id:intent.id});message('Master verified and stored privately.');await refresh();
 });
 const accepted=await completeCallback(client.auth,callback);
 if(accepted){
  invitation=accepted.type==='invite';recovery=accepted.type==='recovery';
  $('login').hidden=true;$('logout').hidden=false;$('workspace').hidden=true;$('mfa').hidden=true;
  $('invitation').hidden=!invitation;$('recovery').hidden=!recovery;
  $('invite-email').textContent=accepted.email;
  message(invitation?'Confirm your invited email below and choose your first password (at least 16 characters).':'Choose a new password.');
 }else message('Sign in with your invited staff account.');
}catch(err){$('workspace').hidden=true;$('mfa').hidden=true;$('invitation').hidden=true;$('recovery').hidden=true;$('login').hidden=!client;message(err.message);}
