import pg from 'pg';
import { verifier } from './auth.mjs';
import { handler } from './handler.mjs';

export function configuration(env){
 if(env.APP_ENV!=='staging')throw Error('Only APP_ENV=staging is enabled');
 if(env.VERCEL_ENV==='production')throw Error('Production deployment is disabled');
 if(!env.DATABASE_URL)throw Error('Pooled DATABASE_URL required');
 const url=new URL(env.DATABASE_URL);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('PostgreSQL URL required');
 if(!['verify-full','verify-ca'].includes(url.searchParams.get('sslmode')))throw Error('Verified database TLS required');
 if(!env.AUTH_ISSUER || !env.AUTH_AUDIENCE || !env.AUTH_JWKS_URL)throw Error('Identity configuration required');
 return {connectionString:env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:10000,allowExitOnIdle:true};
}

// One small pool per warm function instance, connected through Supabase transaction pooling.
// No migrations, filesystem persistence or background work in a request.
export function runtime(env=process.env,dependencies={}){
 const Pool=dependencies.Pool??pg.Pool;
 const verify=dependencies.verifier??verifier;
 const options=configuration(env);
 const identity=verify({issuer:env.AUTH_ISSUER,audience:env.AUTH_AUDIENCE,jwksUrl:env.AUTH_JWKS_URL});
 const pool=new Pool(options);
 pool.on('error',()=>console.error('Database pool connection error'));
 return {handle:handler(pool,identity),close:()=>pool.end()};
}
