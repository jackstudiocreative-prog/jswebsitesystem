import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
export async function migrate(db) {
 await db.query('BEGIN');
 try {
  await db.query('SELECT pg_advisory_xact_lock(7348301)');
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) {
   const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');
   const checksum=createHash('sha256').update(sql).digest('hex');
   const old=(await db.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name])).rows[0];
   if(old){if(old.checksum!==checksum)throw Error('Applied migration changed: '+name);continue;}
   await db.query(sql);
   await db.query('INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)',[name,checksum]);
  }
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.MIGRATION_DATABASE_URL)throw Error('MIGRATION_DATABASE_URL is required');
 const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});
 await db.connect();try{await migrate(db);}finally{await db.end();}
}
