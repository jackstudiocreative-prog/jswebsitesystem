import { X509Certificate } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';

export function databaseOptions(env){
 let url;
 try{url=new URL(env.DATABASE_URL);}catch{throw Error('Valid DATABASE_URL required');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.pathname.slice(1))throw Error('PostgreSQL host, user and database required');
 if(url.searchParams.getAll('sslmode').length!==1||url.searchParams.get('sslmode')!=='verify-full')throw Error('DATABASE_URL must use sslmode=verify-full');
 // No pg URL overrides, local certificate paths, or ssl=false may override our TLS options.
 if([...url.searchParams.keys()].some(k=>k!=='sslmode'))throw Error('Remove extra DATABASE_URL parameters; supply CA through DATABASE_CA_CERT');
 if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('Global TLS verification bypass is prohibited');
 const ca=(env.DATABASE_CA_CERT??'').replace(/\\n/g,'\n').trim();
 const certs=ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
 if(!certs?.length||ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,'').trim())throw Error('DATABASE_CA_CERT must contain only PEM CA certificates');
 try{for(const pem of certs)if(!new X509Certificate(pem).ca)throw Error();}catch{throw Error('DATABASE_CA_CERT contains an invalid CA certificate');}
 // Passing a connectionString containing sslmode to pg overwrites an explicit ssl object.
 // Parse only allowlisted fields, preserving verify-full via Node's strict TLS settings.
 let user,password,database;
 try{user=decodeURIComponent(url.username);password=decodeURIComponent(url.password);database=decodeURIComponent(url.pathname.slice(1));}catch{throw Error('Invalid DATABASE_URL encoding');}
 return {host:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port||5432),user,password,database,
  ssl:{ca,rejectUnauthorized:true,checkServerIdentity,minVersion:'TLSv1.2'}};
}
