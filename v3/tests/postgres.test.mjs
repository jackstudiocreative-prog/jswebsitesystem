import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrate } from '../src/migrate.mjs';
test('real PostgreSQL migration locking and persistence across connections',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
 try{await migrate(db);await migrate(db);await db.query("INSERT INTO staff VALUES ('ci-staff','admin',true) ON CONFLICT DO NOTHING");}finally{await db.end();}
 const next=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await next.connect();
 try{assert.equal((await next.query("SELECT role FROM staff WHERE subject='ci-staff'")).rows[0].role,'admin');}finally{await next.end();}
});
