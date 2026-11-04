import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/migrate.mjs';
import { signUpload,finalizeUpload,validateAsset } from '../src/media.mjs';
import {authStorage} from '../admin/auth-client.mjs';
test('token storage retains only PKCE verifier in tab storage',()=>{
 const map=new Map(),disk={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const storage=authStorage(disk);storage.setItem('access','secret');storage.setItem('auth-code-verifier','verifier');assert.equal(map.has('access'),false);assert.equal(storage.getItem('access'),'secret');assert.equal(map.get('auth-code-verifier'),'verifier');storage.removeItem('access');assert.equal(storage.getItem('access'),null);
});
test('uploads use verified provider metadata, isolation, idempotency and limits',async()=>{
 const db=new PGlite();const sql={query:(q,args)=>q.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):q.includes(';')&&!args?db.exec(q).then(r=>r.at(-1)):db.query(q,args)};
 try{
  await migrate(sql);await db.query("INSERT INTO staff VALUES('a','admin',true),('b','editor',true)");
  let inspection=0;const cloud={cloud_name:'test',api_key:'public-key',preset:'restricted',sign:()=> 'signature',inspect:async id=>{inspection++;return {public_id:id,asset_id:'asset1',resource_type:'image',type:'authenticated',format:'png',bytes:123,width:400,height:400,version:1};}};
  const intent=await signUpload(sql,'a',cloud);assert.equal(intent.params.overwrite,false);assert.equal(intent.params.type,'authenticated');assert.match(intent.params.public_id,/^jackstudio-websitesystem\/products\//);
  await assert.rejects(finalizeUpload(sql,'b',intent.id,cloud),e=>e.status===404);
  const media=await finalizeUpload(sql,'a',intent.id,cloud);assert.equal(media.bytes,123);assert.equal(media.state,'ready');
  assert.equal((await finalizeUpload(sql,'a',intent.id,cloud)).id,media.id);assert.equal(inspection,1);
  const expired=await signUpload(sql,'a',cloud);await db.query("UPDATE upload_intents SET expires_at=now()-interval '1 minute' WHERE id=$1",[expired.id]);await assert.rejects(finalizeUpload(sql,'a',expired.id,cloud),e=>e.status===410);
  for(let i=0;i<8;i++)await signUpload(sql,'a',cloud);await assert.rejects(signUpload(sql,'a',cloud),e=>e.status===429);
  const asset=await cloud.inspect('expected');for(const change of [{format:'svg'},{bytes:10000001},{width:10001},{public_id:'foreign'},{type:'upload'}])assert.throws(()=>validateAsset({...asset,...change},'expected'));
  await db.exec('SET ROLE jackstudio_api');assert.equal((await db.query('SELECT * FROM media')).rows.length,1);await assert.rejects(db.query("UPDATE staff SET role='admin' WHERE subject='b'"));await assert.rejects(db.query('DELETE FROM audit_events'));await db.exec('RESET ROLE');
  await db.exec('CREATE ROLE anon NOLOGIN; GRANT USAGE ON SCHEMA public TO anon; GRANT SELECT ON media TO anon; SET ROLE anon');assert.equal((await db.query('SELECT * FROM media')).rows.length,0);await db.exec('RESET ROLE');
 }finally{await db.close();}
});
