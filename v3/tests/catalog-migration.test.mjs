import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('004 preserves existing catalogue and images, backfills memberships and restricts new table',async()=>{
 const db=new PGlite();try{
  await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
  for(const file of ['001_foundation.sql','002_staff_isolation.sql','003_cloudinary.sql'])await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  await db.exec("INSERT INTO staff VALUES ('owner','admin',true); INSERT INTO collections(title,slug) VALUES ('Original','original'); INSERT INTO products(title,handle,collection_id) VALUES ('Existing wallet','existing-wallet',1); INSERT INTO media(object_key,mime,bytes,state,created_by) VALUES ('existing/image','image/png',10,'ready','owner'); INSERT INTO product_media VALUES(1,1,0,'Original alt');");
  await db.exec(await readFile(new URL('../migrations/004_catalog_admin.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('SELECT title FROM products')).rows[0].title,'Existing wallet');
  assert.equal((await db.query('SELECT collection_id FROM product_collections')).rows[0].collection_id,1);
  assert.equal((await db.query('SELECT alt FROM product_media')).rows[0].alt,'Original alt');
  for(const role of ['anon','authenticated']){assert.equal((await db.query("SELECT has_table_privilege($1,'product_collections','SELECT') AS allowed",[role])).rows[0].allowed,false);}
  await db.exec('GRANT USAGE ON SCHEMA public TO anon; GRANT SELECT ON product_collections TO anon; SET ROLE anon;');
  assert.equal((await db.query('SELECT * FROM product_collections')).rows.length,0);
 }finally{await db.close();}
});
