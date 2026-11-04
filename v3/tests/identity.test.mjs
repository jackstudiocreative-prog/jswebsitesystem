import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair,SignJWT } from 'jose';
import { verifyIdentity } from '../src/auth.mjs';
test('signed identity rejects wrong issuer, audience, signature and expired tokens',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('ES256');
 const config={issuer:'https://identity.example/auth/v1',audience:'authenticated'};
 const sign=(changes={})=>new SignJWT({aal:'aal2'}).setProtectedHeader({alg:'ES256'}).setSubject('staff').setIssuedAt().setIssuer(changes.issuer??config.issuer).setAudience(changes.audience??config.audience).setExpirationTime(changes.exp??'5m').sign(privateKey);
 assert.equal((await verifyIdentity(await sign(),publicKey,config)).sub,'staff');
 for(const changes of [{issuer:'https://wrong.example'},{audience:'wrong'},{exp:1}])await assert.rejects(verifyIdentity(await sign(changes),publicKey,config));
 const wrong=await generateKeyPair('ES256');await assert.rejects(verifyIdentity(await sign(),wrong.publicKey,config));
});
