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
  const c=(await next.query("INSERT INTO collections(title,slug) VALUES ('CI catalogue','ci-catalogue') RETURNING id")).rows[0];
  const p=(await next.query("INSERT INTO products(title,handle,sku,price_minor,inventory) VALUES ('CI product','ci-product','CI-SKU',2500,3) RETURNING id")).rows[0];
  await next.query('UPDATE products SET inventory=4 WHERE id=$1',[p.id]);
  await next.query('INSERT INTO product_collections VALUES ($1,$2)',[p.id,c.id]);
  assert.equal((await next.query('SELECT inventory FROM products WHERE id=$1',[p.id])).rows[0].inventory,4);
  await assert.rejects(next.query('DELETE FROM products'),e=>e.code==='42501');
  await next.query('RESET ROLE');
  for(const role of ['anon','authenticated']){
   await next.query('CREATE ROLE '+role+' NOLOGIN');await next.query('GRANT USAGE ON SCHEMA public TO '+role);
   assert.equal((await next.query("SELECT has_table_privilege($1,'product_collections','SELECT') AS allowed",[role])).rows[0].allowed,false);
   await next.query('SET ROLE '+role);await assert.rejects(next.query('SELECT * FROM product_collections'),e=>e.code==='42501');await next.query('RESET ROLE');
  }
  assert.equal((await next.query("SELECT relrowsecurity FROM pg_class WHERE oid='product_collections'::regclass")).rows[0].relrowsecurity,true);

  await next.query('CREATE ROLE staging_anon NOLOGIN');await next.query('GRANT USAGE ON SCHEMA public TO staging_anon');await next.query('GRANT SELECT ON staff TO staging_anon');await next.query('SET ROLE staging_anon');assert.equal((await next.query('SELECT * FROM staff')).rows.length,0);
 }finally{await next.end();}
});
