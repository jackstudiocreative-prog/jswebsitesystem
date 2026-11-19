(function(root){
  'use strict';
  const slug = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const validSku = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,64}$/.test(value);
  const integer = (value, max=100000000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  const lowStock = 5;
  const stockStatus = (inventory, active=true) => !active ? 'inactive' : inventory <= 0 ? 'out' : inventory <= lowStock ? 'low' : 'in';
  const api = Object.freeze({slug,validSku,integer,lowStock,stockStatus});
  if(typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.JackCatalog=api;
})(globalThis);
