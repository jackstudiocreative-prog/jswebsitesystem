import {rootCertificates} from 'node:tls';
import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration,runtime } from '../src/runtime.mjs';
import api from '../api/index.mjs';
const env={DATABASE_CA_CERT:rootCertificates[0],APP_ENV:'staging',VERCEL_ENV:'preview',DATABASE_URL:'postgres://user:placeholder@db.example/db?sslmode=verify-full',AUTH_ISSUER:'https://identity.example/auth/v1',AUTH_AUDIENCE:'authenticated',AUTH_JWKS_URL:'https://identity.example/auth/v1/.well-known/jwks.json'};
test('serverless requires staging, verified TLS and explicit identity',()=>{
 assert.equal(configuration(env).max,2);
 for(const change of [{APP_ENV:'production'},{VERCEL_ENV:'production'},{DATABASE_URL:''},{DATABASE_URL:'postgres://db.example/db?sslmode=disable'},{AUTH_ISSUER:''}])assert.throws(()=>configuration({...env,...change}));
});
test('function initialization reuses service without opening a listening socket',async()=>{
 let created=0;class Pool{constructor(){created++;}on(){}async end(){}}
 const app=runtime(env,{Pool,verifier:()=>()=>{throw Error('not needed');}});
 for(let i=0;i<2;i++){let data='';await app.handle({url:'/health',method:'GET'},{setHeader(){},end(v){data=v;}});assert.equal(JSON.parse(data).status,'ok');}
 assert.equal(created,1);await app.close();
});
test('unconfigured Vercel entry fails closed without disclosing configuration',async()=>{
 const previous=process.env.APP_ENV;delete process.env.APP_ENV;
 try{const res={setHeader(){},end(v){this.body=v;}};await api({url:'/api/v3/products'},res);assert.equal(res.statusCode,503);assert.deepEqual(JSON.parse(res.body),{error:'Staging service is not configured'});}
 finally{if(previous!==undefined)process.env.APP_ENV=previous;}
});
