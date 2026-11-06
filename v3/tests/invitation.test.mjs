import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as callbackHelpers from '../admin/auth-callback.mjs';
import * as helpers from '../admin/auth-client.mjs';
const {captureCallback,completeCallback,setInvitePassword}=callbackHelpers;
const ok=data=>({data,error:null});
const invited={id:'invited-user',email:'staff@example.test',invited_at:'2026-11-05'};
test('callbacks are scrubbed before verification; ambiguous, expired and unsupported links fail closed',async()=>{
 for(const suffix of ['#type=invite&access_token=a&refresh_token=b','#type=recovery&access_token=a&refresh_token=b','?code=pkce']){
  let cleaned;const url=new URL('https://staging.example/admin'+suffix);
  const callback=captureCallback(url,{replaceState:(_,__,path)=>{cleaned=path;}});
  assert.equal(cleaned,'/admin');assert.ok(callback);
 }
 for(const suffix of ['#type=invite&access_token=a','?type=invite&access_token=a&refresh_token=b','#type=invite&type=recovery&access_token=a&refresh_token=b','?code=a#type=invite&access_token=a&refresh_token=b','#error_description=secret-token','#type=signup&access_token=a&refresh_token=b']){
  let signedOut=false;
  const callback=captureCallback(new URL('https://staging.example/admin'+suffix),{replaceState(){}});
  await assert.rejects(completeCallback({signOut:async()=>{signedOut=true;}},callback),/invalid or expired/);
  assert.equal(signedOut,true);
 }
 assert.equal(captureCallback(new URL('https://staging.example/admin'),{}),null);
});
test('invite uses provider-validated identity; recovery retains PKCE exchange; no roles are provisioned',async()=>{
 const calls=[];const auth={setSession:async tokens=>{calls.push(tokens);return ok({session:{}});},getUser:async()=>ok({user:invited}),signOut:async()=>ok({}),exchangeCodeForSession:async code=>{assert.equal(code,'pkce');return ok({session:{},redirectType:'recovery'});}};
 assert.deepEqual(await completeCallback(auth,{type:'invite',access_token:'a',refresh_token:'b'}),{type:'invite',email:invited.email});
 assert.deepEqual(calls,[{access_token:'a',refresh_token:'b'}]);
 assert.equal((await completeCallback(auth,{code:'pkce'})).type,'recovery');
 await assert.rejects(completeCallback({...auth,getUser:async()=>ok({user:{id:'not-invited',email:'x'}})},{type:'invite',access_token:'a',refresh_token:'b'}));
 await assert.rejects(completeCallback({...auth,setSession:async()=>({error:Error('expired token secret')})},{type:'invite'}),e=>!e.message.includes('secret'));
 await assert.rejects(completeCallback({...auth,exchangeCodeForSession:async()=>({error:Error('missing verifier')})},{code:'pkce'}));
});
test('first password requires 16 characters and confirmation; provider rejection propagates',async()=>{
 let updates=0;const auth={updateUser:async()=>{updates++;return ok({});}};
 await assert.rejects(setInvitePassword(auth,'short','short'));
 await assert.rejects(setInvitePassword(auth,'long-password-123','mismatch'));
 assert.equal(updates,0);
 await setInvitePassword(auth,'long-password-123','long-password-123');assert.equal(updates,1);
 await assert.rejects(setInvitePassword({updateUser:async()=>({error:Error('expired session')})},'long-password-123','long-password-123'),/expired/);
});
test('invitation page requires password before MFA and staff authorization before workspace',async()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:true,handlers:{},addEventListener(k,fn){this.handlers[k]=fn;},removeAttribute(k){delete this[k];},replaceChildren(){}});return elements.get(id);};
 let state,updates=0,aal='aal1',allowed=false,enrollments=0,config;
 const auth={onAuthStateChange:fn=>{state=fn;},setSession:async()=>ok({session:{}}),getUser:async()=>ok({user:invited}),getSession:async()=>ok({session:{access_token:'token'}}),updateUser:async()=>{updates++;return ok({});},signOut:async()=>{state('SIGNED_OUT');return ok({});},mfa:{listFactors:async()=>ok({totp:[]}),getAuthenticatorAssuranceLevel:async()=>ok({currentLevel:aal}),enroll:async()=>{enrollments++;return ok({type:'totp',id:'factor',totp:{qr_code:'data:image/svg+xml;utf-8,<svg></svg>'}});},challenge:async()=>ok({id:'challenge'}),verify:async()=>{aal='aal2';return ok({});}}};
 let scrubbed=false;
 const context=vm.createContext({mountAdmin:()=>({reload:async()=>{},destroy(){}}),...helpers,...callbackHelpers,URLSearchParams,createClient:(_,__,options)=>{config=options;return {auth};},document:{getElementById:get,createElement:()=>({})},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},location:new URL('https://staging.example/admin#type=invite&access_token=a&refresh_token=b'),history:{replaceState(){scrubbed=true;}},fetch:async path=>{assert.equal(scrubbed,true);return {ok:path.endsWith('/session')?allowed:true,json:async()=>path==='/auth-config.json'?{url:'https://identity.example',key:'public'}:path.endsWith('/session')?(allowed?{role:'editor'}:{error:'Staff access denied'}):[]};}});
 const source=(await readFile(new URL('../admin/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
 await vm.runInContext('(async()=>{'+source+'})()',context);
 const click=id=>get(id).handlers.click({preventDefault(){}});
 assert.equal(config.auth.detectSessionInUrl,false);assert.equal(get('invitation').hidden,false);assert.equal(get('invite-email').textContent,invited.email);
 await click('enroll');assert.equal(enrollments,0);
 get('invite-password').value='short';get('invite-confirm').value='short';await click('set-invite-password');assert.equal(updates,0);
 get('invite-password').value=get('invite-confirm').value='long-password-123';await click('set-invite-password');assert.equal(updates,1);assert.equal(get('mfa').hidden,false);assert.equal(get('invite-password').value,'');
 await click('enroll');get('code').value='123456';await click('verify');assert.equal(get('workspace').hidden,true);assert.equal(get('message').textContent,'Staff access denied');
 allowed=true;get('code').value='123456';await click('verify');assert.equal(get('workspace').hidden,false);
 await click('logout');assert.equal(get('workspace').hidden,true);assert.equal(get('invitation').hidden,true);assert.equal(get('login').hidden,false);
});
