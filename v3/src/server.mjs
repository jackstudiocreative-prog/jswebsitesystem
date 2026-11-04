import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { verifier } from './auth.mjs';
import { handler } from './handler.mjs';
export { handler } from './handler.mjs';
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required; demo fallback is disabled');
 const verify=verifier({issuer:process.env.AUTH_ISSUER,audience:process.env.AUTH_AUDIENCE,jwksUrl:process.env.AUTH_JWKS_URL});
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10});
 const server=createServer(handler(pool,verify));server.listen(Number(process.env.PORT??3100),process.env.HOST??'127.0.0.1');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>pool.end()));
}
