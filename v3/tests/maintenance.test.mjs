import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeMaintenance} from '../src/maintenance.mjs';
import {handler} from '../src/handler.mjs';

test('maintenance fails closed before connecting and permits only POST',async()=>{
 let connections=0;
 for(const [method,secret,authorization,status] of [['POST',undefined,undefined,503],['POST','short','Bearer short',503],['POST','x'.repeat(32),undefined,401],['POST','x'.repeat(32),'Bearer '+'y'.repeat(32),401],['GET','x'.repeat(32),'Bearer '+'x'.repeat(32),405]]){
  const handle=handler({connect(){connections++;throw Error('must not connect');}},()=>{}, {maintenanceSecret:secret});
  const res={setHeader(){},end(v){this.body=v;}};
  await handle({url:'/api/v3/maintenance/expire-orders',method,headers:{authorization}},res);
  assert.equal(res.statusCode,status);
 }
 assert.equal(connections,0);
 assert.doesNotThrow(()=>authorizeMaintenance('Bearer '+'x'.repeat(32),'x'.repeat(32)));
});

test('maintenance errors roll back, release the connection and disclose no database details',async()=>{
 const calls=[];const secret='x'.repeat(32);
 const handle=handler({connect:async()=>({query:async q=>{calls.push(q);if(q.startsWith('SELECT id'))throw Error('private database details');return {rows:[]};},release(){calls.push('release');}})},()=>{}, {maintenanceSecret:secret});
 const res={setHeader(){},end(v){this.body=v;}};
 await handle({url:'/api/v3/maintenance/expire-orders',method:'POST',headers:{authorization:'Bearer '+secret}},res);
 assert.equal(res.statusCode,500);assert.equal(res.body,'{"error":"Internal server error"}');
 assert.equal(calls.at(-2),'ROLLBACK');assert.equal(calls.at(-1),'release');
});
