import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createClient} from '@supabase/supabase-js';
import * as helpers from '../admin/auth-client.mjs';
import * as callbackHelpers from '../admin/auth-callback.mjs';
const {authStorage,authOptions,isVerifierKey,VERIFIER_TTL_MS}=helpers;
const {captureCallback,completeCallback}=callbackHelpers;

const REF='cquhddsrhnacbkvszitl',KEY=`sb-${REF}-auth-token`;
// One browser profile: tabs share localStorage, each tab has its own memory.
function profile(){
 const data=new Map();
 return {data,store:{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>{data.set(k,String(v));},removeItem:k=>{data.delete(k);}}};
}

test('only Supabase PKCE verifier keys are shared between tabs; tokens stay in tab memory',()=>{
 const {data,store}=profile();
 const tabA=authStorage(store),tabB=authStorage(store);
 const legacy=`${KEY}-code-verifier`,slot=`${KEY}-flow-0123456789abcdef-code-verifier`,index=`${KEY}-flows-code-verifier`;
 for(const k of [legacy,slot,index])assert.equal(isVerifierKey(k),true,k);
 for(const k of [KEY,`${KEY}-user`,'evil-code-verifier',`${KEY}-code-verifier-x`,`sb-${REF}-auth-token-flow-bad!id-code-verifier`])assert.equal(isVerifierKey(k),false,k);
 tabA.setItem(KEY,'{"access_token":"access-secret","refresh_token":"refresh-secret"}');tabA.setItem(`${KEY}-user`,'{"id":"u"}');
 tabA.setItem(slot,'"verifier/recovery"');tabA.setItem(index,'["0123456789abcdef"]');
 assert.deepEqual([...data.keys()].sort(),[index,slot].sort(),'only verifier entries reach localStorage');
 assert.equal([...data.values()].some(v=>/secret/.test(v)),false,'no token ever reaches localStorage');
 assert.equal(tabB.getItem(slot),'"verifier/recovery"','another tab reads the verifier');
 assert.equal(tabB.getItem(KEY),null,'another tab cannot read the session');assert.match(tabA.getItem(KEY),/access-secret/);
 tabB.removeItem(slot);assert.equal(tabA.getItem(slot),null,'consumed verifier is gone for every tab');
 tabA.removeItem(KEY);assert.equal(tabA.getItem(KEY),null);
});

test('stored verifiers expire, reject tampering and fall back to tab memory when storage is blocked',()=>{
 const {data,store}=profile();let clock=1_000_000;const now=()=>clock;
 const slot=`${KEY}-flow-0123456789abcdef-code-verifier`;
 authStorage(store,{now}).setItem(slot,'"v1"');
 clock+=VERIFIER_TTL_MS-1;assert.equal(authStorage(store,{now}).getItem(slot),'"v1"');
 clock+=2;assert.equal(authStorage(store,{now}).getItem(slot),null,'expired');assert.equal(data.has(slot),false,'expired entry removed');
 for(const raw of ['"bare-unwrapped-value"','not json',JSON.stringify({value:1,expires:clock+10}),JSON.stringify({value:'v',expires:clock+VERIFIER_TTL_MS*10})]){
  data.set(slot,raw);assert.equal(authStorage(store,{now}).getItem(slot),null,raw);assert.equal(data.has(slot),false);
 }
 const blocked={getItem(){throw Error('SecurityError');},setItem(){throw Error('QuotaExceededError');},removeItem(){throw Error('SecurityError');}};
 for(const s of [blocked,null]){const tab=authStorage(s);tab.setItem(slot,'"v2"');assert.equal(tab.getItem(slot),'"v2"','same tab still works');tab.removeItem(slot);assert.equal(tab.getItem(slot),null);}
});

test('callback keeps the Supabase flow id and rejects malformed or misplaced ones',()=>{
 const scrub=()=>({replaceState(){}});
 assert.deepEqual(captureCallback(new URL('https://s.example/admin?sb_flow_id=0123456789abcdef&code=abc'),scrub()),{code:'abc',flowId:'0123456789abcdef'});
 assert.deepEqual(captureCallback(new URL('https://s.example/admin?code=abc'),scrub()),{code:'abc'});
 for(const bad of ['?sb_flow_id=short&code=abc','?sb_flow_id=a%2Fb0123456789&code=abc','?sb_flow_id=0123456789abcdef&sb_flow_id=fedcba9876543210&code=abc','?sb_flow_id=0123456789abcdef','#type=invite&access_token=a&refresh_token=b&sb_flow_id=0123456789abcdef','?code=abc#sb_flow_id=0123456789abcdef'])
  assert.equal(captureCallback(new URL('https://s.example/admin'+bad),scrub()).invalid,true,bad);
});

// Minimal Supabase Auth server: verifies the PKCE challenge exactly like GoTrue (S256).
function authServer(){
 const flows=new Map(),passwords=new Map(),logouts=[],users={'staff@example.test':{id:'staff-1',email:'staff@example.test',aud:'authenticated',role:'authenticated'}};let n=0;const sessions=new Map();
 const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 const fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url),body=init.body?JSON.parse(init.body):{};
  if(url.pathname==='/auth/v1/recover'){
   const code='code'+(++n);flows.set(code,{challenge:body.code_challenge,method:body.code_challenge_method,redirect:url.searchParams.get('redirect_to'),used:false});
   return json(200,{});
  }
  if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='pkce'){
   const flow=flows.get(body.auth_code);
   const ok=flow&&!flow.used&&flow.method==='s256'&&createHash('sha256').update(body.code_verifier??'').digest('base64url')===flow.challenge;
   if(flow)flow.used=true; // single use, even when the verifier is wrong
   if(!ok)return json(400,{code:400,error_code:'bad_code_verifier',msg:'code challenge does not match previously saved code verifier'});
   const token='access-'+body.auth_code;sessions.set(token,users['staff@example.test']);
   return json(200,{access_token:token,refresh_token:'refresh-'+body.auth_code,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:users['staff@example.test']});
  }
  if(url.pathname==='/auth/v1/user'&&init.method==='PUT'){passwords.set('staff-1',body.password);}
  if(url.pathname==='/auth/v1/user'&&init.method!=='PUT'){const user=sessions.get(String(new Headers(init.headers).get('authorization')).replace('Bearer ',''));return user?json(200,user):json(401,{code:401,msg:'invalid JWT'});}
  if(url.pathname==='/auth/v1/user'&&init.method==='PUT')return json(200,users['staff@example.test']);
  if(url.pathname==='/auth/v1/logout'){logouts.push(url.searchParams.get('scope'));return new Response(null,{status:204});}
  return json(404,{msg:'not mocked '+url.pathname});
 };
 // The email link: Supabase redirects to redirect_to (which carries sb_flow_id) and appends the code.
 const link=code=>{const u=new URL(flows.get(code).redirect);u.searchParams.set('code',code);return u;};
 return {fetch,flows,link,passwords,logouts};
}
function tab(store,server,options={}){
 const events=[];const client=createClient(`https://${REF}.supabase.co`,'public-anon-key',{auth:{...authOptions(authStorage(store)),...options},global:{fetch:server.fetch}});
 client.auth.onAuthStateChange(event=>events.push(event));
 return {auth:client.auth,events,close:()=>client.auth.stopAutoRefresh?.()};
}
const request=t=>t.auth.resetPasswordForEmail('staff@example.test',{redirectTo:'https://staging.example/admin'}).then(r=>assert.equal(r.error,null));
const open=(t,url)=>completeCallback(t.auth,captureCallback(url,{replaceState(){}}));

test('real Supabase SDK (admin config): reset requested in one tab completes in a new tab of the same browser',async()=>{
 const {data,store}=profile(),server=authServer(),tabA=tab(store,server);
 try{
  await request(tabA);
  assert.ok(data.size>0&&[...data.keys()].every(isVerifierKey),'only verifier entries persisted');
  const link=server.link('code1');assert.equal(link.searchParams.has('sb_flow_id'),false,'default SDK config sends no flow id');
  // The email opens in a brand-new tab: nothing from tab A's memory is available there.
  const tabB=tab(store,server);
  try{
   let scrubbed;const callback=captureCallback(link,{replaceState:(_,__,path)=>{scrubbed=path;}});assert.equal(scrubbed,'/admin');
   assert.deepEqual(await completeCallback(tabB.auth,callback),{type:'recovery',email:'staff@example.test'});
   assert.ok(tabB.events.includes('PASSWORD_RECOVERY'));
   assert.equal((await tabB.auth.getSession()).data.session.access_token,'access-code1');
   assert.equal([...data.values()].some(v=>/access-code1|refresh-code1/.test(v)),false,'session never written to localStorage');
   // A third tab of the same profile does not inherit the recovery session.
   const tabC=tab(store,server);try{assert.equal((await tabC.auth.getSession()).data.session,null);}finally{tabC.close();}
   await helpers.recoverPassword(tabB.auth,'a-brand-new-password-123');
   assert.equal(server.passwords.get('staff-1'),'a-brand-new-password-123');assert.equal(server.logouts.at(-1),'global');
   assert.equal(data.size,0,'sign-out clears every remaining verifier entry');
  }finally{tabB.close();}
 }finally{tabA.close();}
});

test('real Supabase SDK (admin config): with two requests the newest email works; an older one fails closed',async()=>{
 for(const order of [['code2'],['code1','code2']]){
  const {store}=profile(),server=authServer(),tabA=tab(store,server);
  try{
   await request(tabA);await request(tabA);
   const tabB=tab(store,server);
   try{
    if(order[0]==='code2')assert.equal((await open(tabB,server.link('code2'))).type,'recovery');
    else{
     await assert.rejects(open(tabB,server.link('code1')),/newest link in the same browser/);
     assert.equal(server.flows.get('code1').used,true);
     await assert.rejects(open(tabB,server.link('code2')),/invalid or expired/,'request a new email');
    }
   }finally{tabB.close();}
  }finally{tabA.close();}
 }
});

test('real Supabase SDK (opt-in flow ids): the flow id round-trips and selects the right verifier in another tab',async()=>{
 const {data,store}=profile(),server=authServer(),experimental={experimental:{appendPkceFlowIdToRedirects:true}},tabA=tab(store,server,experimental);
 try{
  await request(tabA);await request(tabA);
  const older=server.link('code1');assert.match(older.searchParams.get('sb_flow_id')??'',/^[A-Za-z0-9_-]{8,64}$/);
  const tabB=tab(store,server,experimental);
  try{
   const callback=captureCallback(older,{replaceState(){}});assert.equal(callback.flowId,older.searchParams.get('sb_flow_id'));
   assert.equal((await completeCallback(tabB.auth,callback)).type,'recovery','older email still works');
   assert.equal([...data.keys()].some(k=>k.includes(callback.flowId)),false,'that flow\'s verifier was consumed');
  }finally{tabB.close();}
  const tabC=tab(store,server,experimental);try{assert.equal((await open(tabC,server.link('code2'))).type,'recovery');}finally{tabC.close();}
 }finally{tabA.close();}
});

test('real Supabase SDK: expired verifiers and other browser profiles fail closed without spending the code',async()=>{
 const {store}=profile(),server=authServer(),tabA=tab(store,server);
 try{
  await request(tabA);
  const later=createClient(`https://${REF}.supabase.co`,'public-anon-key',{auth:authOptions(authStorage(store,{now:()=>Date.now()+VERIFIER_TTL_MS+1000})),global:{fetch:server.fetch}});
  try{await assert.rejects(open(later,server.link('code1')),/newest link in the same browser/);}finally{later.auth.stopAutoRefresh?.();}
  const other=tab(profile().store,server);
  try{await assert.rejects(open(other,server.link('code1')),/invalid or expired/);}finally{other.close();}
  assert.equal(server.flows.get('code1').used,false,'no token request is sent without a verifier');
 }finally{tabA.close();}
});

test('admin page: only this tab\'s own recovery exchange opens the password form',async()=>{
 const run=async({search,exchange})=>{
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:true,handlers:{},addEventListener(k,fn){this.handlers[k]=fn;},removeAttribute(k){delete this[k];},replaceChildren(){}});return elements.get(id);};
  const ok=d=>({data:d,error:null});let state,updates=0,signOuts=[],storage;
  const auth={onAuthStateChange:fn=>{state=fn;},getUser:async()=>ok({user:{id:'staff-1',email:'staff@example.test'}}),getSession:async()=>ok({session:null}),
   exchangeCodeForSession:async(code,options)=>exchange(code,options,()=>state('PASSWORD_RECOVERY')),
   updateUser:async()=>{updates++;return ok({});},signOut:async o=>{signOuts.push(o?.scope);state('SIGNED_OUT');return ok({});},mfa:{}};
  const shared=new Map();
  const context=vm.createContext({mountAdmin:()=>({reload:async()=>{},destroy(){}}),...helpers,...callbackHelpers,URLSearchParams,
   createClient:(_,__,options)=>{storage=options.auth.storage;return {auth};},document:{getElementById:get,createElement:()=>({})},
   localStorage:{getItem:k=>shared.get(k)??null,setItem:(k,v)=>shared.set(k,v),removeItem:k=>shared.delete(k)},
   location:new URL('https://staging.example/admin'+search),history:{replaceState(){}},
   fetch:async()=>({ok:true,json:async()=>({url:'https://identity.example',key:'public'})})});
  const source=(await readFile(new URL('../admin/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  await vm.runInContext('(async()=>{'+source+'})()',context);
  return {get,state:e=>state(e),click:id=>get(id).handlers.click({preventDefault(){}}),updates:()=>updates,signOuts,storage,shared};
 };
 // Email tab: code + flow id -> exchange in this tab -> recovery form -> password updated, all sessions revoked.
 let seen;
 const emailTab=await run({search:'?sb_flow_id=0123456789abcdef&code=abc',exchange:async(code,options,fire)=>{seen={code,options};fire();return {data:{session:{},redirectType:'recovery'},error:null};}});
 assert.deepEqual(seen,{code:'abc',options:{flowId:'0123456789abcdef'}});
 assert.equal(emailTab.get('recovery').hidden,false);assert.equal(emailTab.get('login').hidden,true);
 emailTab.get('new-password').value='a-new-long-password-1';await emailTab.click('update-password');
 assert.equal(emailTab.updates(),1);assert.deepEqual(emailTab.signOuts,['global']);assert.equal(emailTab.get('recovery').hidden,true);assert.equal(emailTab.get('login').hidden,false);
 // Requesting tab: Supabase relays the other tab's PASSWORD_RECOVERY; it must not open a sessionless form.
 const requestTab=await run({search:'',exchange:async()=>{throw Error('not used');}});
 requestTab.state('PASSWORD_RECOVERY');
 assert.equal(requestTab.get('recovery').hidden,true);
 assert.equal(requestTab.get('message').textContent,'Password recovery is open in another tab.');
 requestTab.get('new-password').value='a-new-long-password-1';await requestTab.click('update-password');assert.equal(requestTab.updates(),0);
 // The admin wires localStorage only for verifier keys.
 requestTab.storage.setItem(`${KEY}-code-verifier`,'"v"');requestTab.storage.setItem(KEY,'{"access_token":"t"}');
 assert.deepEqual([...requestTab.shared.keys()],[`${KEY}-code-verifier`]);
});
