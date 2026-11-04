import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrate } from '../src/migrate.mjs';
test('real PostgreSQL migration locking and persistence across connections',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
 try{await migrate(db);await migrate(db);await db.query("INSERT INTO staff VALUES ('ci-staff','admin',true) ON CONFLICT DO NOTHING");}finally{await db.end();}
 const next=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await next.connect();
 try{
  assert.equal((await next.query("SELECT role FROM staff WHERE subject='ci-staff'")).rows[0].role,'admin');
  await next.query('SET ROLE jackstudio_api');
  assert.equal((await next.query("SELECT role FROM staff WHERE subject='ci-staff'")).rows[0].role,'admin');
  await assert.rejects(next.query("UPDATE staff SET active=false"),e=>e.code==='42501');
  await assert.rejects(next.query('DELETE FROM audit_events'),e=>e.code==='42501');
  await next.query('RESET ROLE');
  await next.query('CREATE ROLE staging_anon NOLOGIN');await next.query('GRANT USAGE ON SCHEMA public TO staging_anon');await next.query('GRANT SELECT ON staff TO staging_anon');await next.query('SET ROLE staging_anon');assert.equal((await next.query('SELECT * FROM staff')).rows.length,0);
 }finally{await next.end();}
});
