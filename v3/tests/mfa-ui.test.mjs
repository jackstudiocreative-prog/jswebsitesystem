import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as callbackHelpers from '../admin/auth-callback.mjs';
import * as helpers from '../admin/auth-client.mjs';
test('page events render the exact SDK QR, block workspace on failure and handle recovery/logout',async()=>{
 const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:true,handlers:{},addEventListener(event,fn){this.handlers[event]=fn;},removeAttribute(name){delete this[name];},replaceChildren(){}});return elements.get(id);};
 const ok=data=>({data,error:null});const qr='data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>';
 let onState,failVerify=true,updates=0;const auth={
  onAuthStateChange(fn){onState=fn;},signInWithPassword:async()=>ok({}),getSession:async()=>ok({session:{access_token:'test'}}),
  resetPasswordForEmail:async()=>ok({}),updateUser:async()=>{updates++;return ok({});},signOut:async()=>{onState('SIGNED_OUT');return ok({});},
  mfa:{listFactors:async()=>ok({totp:[]}),getAuthenticatorAssuranceLevel:async()=>ok({currentLevel:failVerify?'aal1':'aal2'}),
   enroll:async()=>ok({type:'totp',id:'factor',totp:{qr_code:qr}}),challenge:async()=>ok({id:'challenge'}),verify:async()=>failVerify?{error:new Error('Invalid code')}:ok({})}
 };
 const context=vm.createContext({...helpers,...callbackHelpers,history:{replaceState(){}},URLSearchParams,createClient:()=>({auth}),document:{getElementById:get,createElement:()=>({})},sessionStorage:{},location:{origin:'https://staging.example'},
  fetch:async path=>({ok:true,json:async()=>path==='/auth-config.json'?{url:'https://identity.example',key:'public'}:path.endsWith('/session')?{role:'editor'}:[]})});
 const source=(await readFile(new URL('../admin/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
 await vm.runInContext('(async()=>{'+source+'})()',context);
 const click=id=>get(id).handlers.click({preventDefault(){}});
 get('email').value='staff@example.test';get('password').value='test-password';await get('login').onsubmit({preventDefault(){}});
 await click('enroll');assert.equal(get('qr').src,qr);assert.equal(get('qr').hidden,false);
 get('code').value='123456';await click('verify');assert.equal(get('workspace').hidden,true);assert.equal(get('message').textContent,'Invalid code');
 failVerify=false;await click('verify');assert.equal(get('workspace').hidden,false);assert.equal(get('qr').src,undefined);
 get('new-password').value='test-only-password-123';await click('update-password');assert.equal(updates,0);
 onState('PASSWORD_RECOVERY');assert.equal(get('workspace').hidden,true);assert.equal(get('recovery').hidden,false);
 await click('update-password');assert.equal(updates,1);assert.equal(get('recovery').hidden,true);assert.equal(get('workspace').hidden,true);assert.equal(get('login').hidden,false);
});
