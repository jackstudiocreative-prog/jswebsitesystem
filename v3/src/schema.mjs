// Optional columns from migrations that may not be applied on every database yet (they are applied
// by an operator, not at deploy). Features that need them say so instead of failing with SQL errors.
const cache=new Map(),TTL=60000;
export async function hasColumn(db,table,column){
 const k=table+'.'+column,hit=cache.get(k);if(hit&&hit.at>Date.now()-TTL)return hit.ok;
 const ok=(await db.query('SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2',[table,column])).rows.length>0;
 cache.set(k,{ok,at:Date.now()});return ok;
}
export const MIGRATION_011='This needs database migration 011 (engraving and collection order). Ask the operator to apply it.';
