import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import pg from 'pg';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {databaseOptions} from '../src/database-tls.mjs';
import {allowPreview} from '../scripts/preview-policy.mjs';
const env={DATABASE_URL:'postgres://restricted:encoded%40password@localhost:6543/postgres?sslmode=verify-full',DATABASE_CA_CERT:tls.rootCertificates[0]};
test('pg receives CA and strict hostname verification without connection-string override',()=>{
 const options=databaseOptions(env),client=new pg.Client(options);
 assert.equal(options.connectionString,undefined);assert.equal(client.connectionParameters.ssl.ca,env.DATABASE_CA_CERT);
 assert.equal(client.connectionParameters.ssl.rejectUnauthorized,true);assert.equal(client.connectionParameters.ssl.checkServerIdentity,tls.checkServerIdentity);
 assert.equal(client.connectionParameters.password,'encoded@password');assert.equal(client.connectionParameters.port,6543);
 assert.equal(databaseOptions({...env,DATABASE_CA_CERT:env.DATABASE_CA_CERT.replaceAll('\n','\\n')}).ssl.ca,env.DATABASE_CA_CERT.trim());
});
test('reject missing/invalid CA, weaker SSL modes and configuration overrides',()=>{
 for(const ca of ['', 'C:\\prod-ca-2021.crt','-----BEGIN CERTIFICATE-----\nbad\n-----END CERTIFICATE-----'])assert.throws(()=>databaseOptions({...env,DATABASE_CA_CERT:ca}));
 for(const mode of ['verify-ca','require','disable','no-verify'])assert.throws(()=>databaseOptions({...env,DATABASE_URL:env.DATABASE_URL.replace('verify-full',mode)}));
 for(const extra of ['ssl=false','sslrootcert=C:/prod-ca-2021.crt','sslmode=disable','host=evil.example','uselibpqcompat=true'])assert.throws(()=>databaseOptions({...env,DATABASE_URL:env.DATABASE_URL+'&'+extra}));
 assert.throws(()=>databaseOptions({...env,NODE_TLS_REJECT_UNAUTHORIZED:'0'}));
});
test('real TLS handshake accepts trusted matching certificate and rejects wrong CA or hostname',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jackstudio-tls-'));
 let server;
 try{
  const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  const result=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-addext','basicConstraints=critical,CA:TRUE'],{encoding:'utf8'});
  assert.equal(result.status,0,'OpenSSL must generate disposable TLS test certificates');
  const cert=await readFile(join(dir,'cert.pem'),'utf8'),key=await readFile(join(dir,'key.pem'),'utf8');
  server=tls.createServer({key,cert},socket=>socket.end());server.on('tlsClientError',()=>{});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const ssl=new pg.Client(databaseOptions({...env,DATABASE_CA_CERT:cert})).connectionParameters.ssl;
  const connect=overrides=>new Promise((resolve,reject)=>{const socket=tls.connect({...ssl,host:'127.0.0.1',port:server.address().port,servername:'localhost',...overrides},()=>{socket.end();resolve(socket.authorized);});socket.once('error',reject);socket.setTimeout(3000,()=>socket.destroy(Error('TLS timeout')));});
  assert.equal(await connect({}),true);
  await assert.rejects(connect({servername:'wrong.example'}),e=>e.code==='ERR_TLS_CERT_ALTNAME_INVALID');
  await assert.rejects(connect({ca:tls.rootCertificates[0]}));
 }finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
test('only staging Preview is eligible; production and feature branches skip',()=>{
 assert.equal(allowPreview({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'staging'}),true);
 for(const vars of [{},{VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'staging'},{VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'main'},{VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'update/v3-tls-ca'}])assert.equal(allowPreview(vars),false);
});
test('Vercel configuration and ignore command enforce Preview policy',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.deepEqual(config.git.deploymentEnabled,{'**':false,main:false,'update/v3-tls-ca':false,staging:true});
 assert.equal(config.ignoreCommand,'node scripts/preview-policy.mjs');
 for(const [mode,branch,status] of [['preview','staging',1],['production','staging',0],['preview','main',0]]){
  const result=spawnSync(process.execPath,['scripts/preview-policy.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,VERCEL_ENV:mode,VERCEL_GIT_COMMIT_REF:branch}});
  assert.equal(result.status,status);
 }
 const blocked=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,VERCEL:'1',VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'staging'},encoding:'utf8'});
 assert.equal(blocked.status,1);assert.match(blocked.stderr,/Only staging branch Preview/);
});
