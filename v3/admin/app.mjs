import {createClient} from '@supabase/supabase-js';
import {authStorage,checkResult,verifiedFactor,enrollTotp,verifyTotp,recoverPassword} from './auth-client.mjs';
const $=id=>document.getElementById(id),message=text=>{$('message').textContent=text;};
// factor: the TOTP factor used for verification (verified, or the pending one created here).
// enrollment: {id,qr} of the unverified factor created on this page; enrolling: in-flight request.
let client,factor,role,recovery=false,enrollment=null,enrolling=null;
async function api(path,body){
 const {session}=checkResult(await client.auth.getSession());
 const response=await fetch('/api/v3/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+(session?.access_token??''),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw Error(data.error);return data;
}
function action(id,fn){$(id).addEventListener('click',async e=>{e.preventDefault();$(id).disabled=true;try{await fn();}catch(err){message(err.message);}finally{$(id).disabled=false;}});}
function showQr(src){if(src){$('qr').src=src;$('qr').hidden=false;}else{$('qr').removeAttribute('src');$('qr').hidden=true;}}
async function refresh(){
 const [products,collections,media]=await Promise.all(['products','collections','media'].map(p=>api(p)));
 $('catalogue').textContent=JSON.stringify({products,collections},null,2);
 $('media').replaceChildren(...media.map(m=>{const li=document.createElement('li');li.textContent=`${m.object_key} — ${m.width??'?'}×${m.height??'?'} — ${m.bytes} bytes — ${m.state} (protected master)`;return li;}));
}
async function workspace(){
 const staff=await api('session');role=staff.role;$('workspace').hidden=false;$('mfa').hidden=true;$('upload').disabled=role==='viewer';$('file').disabled=role==='viewer';message('Signed in as '+role);await refresh();
}
async function signedIn(){
 $('login').hidden=true;$('logout').hidden=false;$('mfa').hidden=false;factor=(await verifiedFactor(client.auth))??enrollment?.id??null;
 const assurance=checkResult(await client.auth.mfa.getAuthenticatorAssuranceLevel());
 if(assurance.currentLevel==='aal2')await workspace();else message(factor?'Enter authenticator code.':'Enroll an authenticator before continuing.');
}
try{
 const config=await (await fetch('/auth-config.json')).json();if(!config.url||!config.key)throw Error('Staging authentication is not configured.');
 client=createClient(config.url,config.key,{auth:{flowType:'pkce',persistSession:true,storage:authStorage(sessionStorage),detectSessionInUrl:true}});
 client.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY'){recovery=true;$('workspace').hidden=true;$('mfa').hidden=true;$('recovery').hidden=false;$('login').hidden=true;message('Choose a new password.');}if(event==='SIGNED_OUT'){factor=null;role=null;recovery=false;enrollment=null;enrolling=null;showQr(null);$('code').value='';$('recovery').hidden=true;$('workspace').hidden=true;$('mfa').hidden=true;$('logout').hidden=true;$('login').hidden=false;}});
 $('login').onsubmit=async e=>{e.preventDefault();try{checkResult(await client.auth.signInWithPassword({email:$('email').value,password:$('password').value}));$('password').value='';await signedIn();}catch(err){message(err.message);}};
 action('reset',async()=>{checkResult(await client.auth.resetPasswordForEmail($('email').value,{redirectTo:location.origin+'/admin'}));message('If eligible, a recovery email has been sent. Open it in this browser.');});
 action('update-password',async()=>{if(!recovery)throw Error('Open a valid password recovery link first.');await recoverPassword(client.auth,$('new-password').value);$('new-password').value='';$('recovery').hidden=true;message('Password updated. Sign in again.');});
 action('enroll',async()=>{
  if(enrolling)return enrolling; // one enrollment request at a time
  if(enrollment){showQr(enrollment.qr);message('Scan the QR code and enter the six-digit code.');return;} // reuse the pending factor
  if(factor)throw Error('An authenticator is already set up. Enter its code instead.');
  enrolling=enrollTotp(client.auth);
  try{enrollment=await enrolling;}finally{enrolling=null;}
  factor=enrollment.id;showQr(enrollment.qr);message('Scan the QR code and enter the six-digit code.');
 });
 action('verify',async()=>{await verifyTotp(client.auth,factor,$('code').value);enrollment=null;$('code').value='';showQr(null);await workspace();});
 action('logout',async()=>{checkResult(await client.auth.signOut());message('Signed out.');});
 action('refresh',refresh);
 action('upload',async()=>{
  if(role==='viewer')throw Error('Editor permission required');const file=$('file').files[0];if(!file||file.size>10000000||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose JPEG/PNG/WebP up to 10 MB.');
  const intent=await api('uploads/sign',{}),form=new FormData();form.set('file',file);for(const [k,v]of Object.entries(intent.params))form.set(k,String(v));form.set('api_key',intent.api_key);form.set('signature',intent.signature);
  const response=await fetch('https://api.cloudinary.com/v1_1/'+encodeURIComponent(intent.cloud_name)+'/image/upload',{method:'POST',body:form});if(!response.ok)throw Error('Upload failed; no database image was published.');
  await api('uploads/finalize',{id:intent.id});message('Master verified and stored privately.');await refresh();
 });
 message('Sign in with your invited staff account.');
}catch(err){$('login').hidden=true;message(err.message);}
