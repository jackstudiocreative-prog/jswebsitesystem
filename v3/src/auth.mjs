import { createRemoteJWKSet, jwtVerify } from 'jose';
export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export async function verifyIdentity(token,keys,{issuer,audience}){
 return (await jwtVerify(token,keys,{issuer,audience,algorithms:['RS256','ES256'],requiredClaims:['sub','exp','iat']})).payload;
}
export function verifier({issuer,audience,jwksUrl}) {
 if(!issuer || !audience || !jwksUrl || ![issuer,jwksUrl].every(v=>new URL(v).protocol==='https:'))throw Error('HTTPS identity issuer, JWKS and audience required');
 const keys=createRemoteJWKSet(new URL(jwksUrl));
 return token => verifyIdentity(token,keys,{issuer,audience});
}
export async function authorize(db,claims,write=false){
 if(!claims?.sub || claims.aal!=='aal2')throw new HttpError(403,'Staff MFA required');
 const staff=(await db.query('SELECT role FROM staff WHERE subject=$1 AND active=true',[claims.sub])).rows[0];
 if(!staff || (write && !['admin','editor'].includes(staff.role)))throw new HttpError(403,'Staff permission required');
 return staff;
}
