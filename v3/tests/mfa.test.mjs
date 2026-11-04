import test from 'node:test';
import assert from 'node:assert/strict';
import {totpQrDataUrl,enrollTotp,verifyTotp,recoverPassword,verifiedFactor} from '../admin/auth-client.mjs';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M0 0h10v10z"/></svg>';
const qr='data:image/svg+xml;utf-8,'+svg;
const ok=data=>({data,error:null});
test('SDK QR URL is preserved, including percent-encoded SVG; malformed and nested URLs rejected',()=>{
 for(const value of [qr,'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)])assert.equal(totpQrDataUrl(value),value);
 for(const value of [null,undefined,{},'',svg,'https://example.com/qr.svg','javascript:alert(1)','data:text/html,'+svg,'data:image/svg+xml;utf-8,%ZZ','data:image/svg+xml;utf-8,hello','data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr),'data:image/svg+xml;utf-8,'+'a'.repeat(1000001)])assert.throws(()=>totpQrDataUrl(value),/Invalid authenticator QR code/);
});
test('TOTP enrollment uses provider data and propagates enrollment/format failures',async()=>{
 const auth={mfa:{enroll:async input=>{assert.deepEqual(input,{factorType:'totp',friendlyName:'Jack Studio Staff'});return ok({type:'totp',id:'factor',totp:{qr_code:qr}});}}};
 assert.deepEqual(await enrollTotp(auth),{id:'factor',qr});
 auth.mfa.enroll=async()=>({error:new Error('Enrollment denied')});await assert.rejects(enrollTotp(auth),/Enrollment denied/);
 auth.mfa.enroll=async()=>ok({type:'totp',id:'factor',totp:{qr_code:'invalid'}});await assert.rejects(enrollTotp(auth),/Invalid authenticator QR code/);
});
test('challenge then verification uses factor/challenge IDs and requires aal2',async()=>{
 const calls=[];const auth={mfa:{challenge:async input=>{calls.push(['challenge',input]);return ok({id:'challenge'});},verify:async input=>{calls.push(['verify',input]);return ok({});},getAuthenticatorAssuranceLevel:async()=>{calls.push(['assurance']);return ok({currentLevel:'aal2'});}}};
 await verifyTotp(auth,'factor','012345');assert.deepEqual(calls,[['challenge',{factorId:'factor'}],['verify',{factorId:'factor',challengeId:'challenge',code:'012345'}],['assurance']]);
 calls.length=0;await assert.rejects(verifyTotp(auth,'factor','12345'),/six digits/);assert.equal(calls.length,0);
 auth.mfa.challenge=async()=>({error:new Error('Challenge expired')});await assert.rejects(verifyTotp(auth,'factor','123456'),/Challenge expired/);assert.equal(calls.length,0);
 auth.mfa.challenge=async()=>ok({id:'new'});auth.mfa.verify=async()=>({error:new Error('Invalid code')});await assert.rejects(verifyTotp(auth,'factor','123456'),/Invalid code/);assert.equal(calls.length,0);
 auth.mfa.verify=async()=>ok({});auth.mfa.getAuthenticatorAssuranceLevel=async()=>ok({currentLevel:'aal1'});await assert.rejects(verifyTotp(auth,'factor','123456'),/verified session/);
});
test('existing verified TOTP is reused; unverified factors do not skip enrollment',async()=>{
 const auth={mfa:{listFactors:async()=>ok({totp:[{id:'pending',status:'unverified'},{id:'ready',status:'verified'}]})}};
 assert.equal(await verifiedFactor(auth),'ready');auth.mfa.listFactors=async()=>ok({totp:[]});assert.equal(await verifiedFactor(auth),null);
});
test('recovery rejects weak password, propagates errors and globally signs out only after update',async()=>{
 const calls=[];const auth={updateUser:async input=>{calls.push(['update',input]);return ok({});},signOut:async input=>{calls.push(['logout',input]);return ok({});}};
 await assert.rejects(recoverPassword(auth,'short'),/16 characters/);assert.equal(calls.length,0);
 await recoverPassword(auth,'test-only-password-123');assert.deepEqual(calls,[['update',{password:'test-only-password-123'}],['logout',{scope:'global'}]]);
 calls.length=0;auth.updateUser=async()=>({error:new Error('Recovery expired')});await assert.rejects(recoverPassword(auth,'test-only-password-123'),/Recovery expired/);assert.equal(calls.length,0);
});
