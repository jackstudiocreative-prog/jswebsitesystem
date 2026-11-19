// Engraving / personalisation rules, shared by the server (authoritative) and the storefront (hints).
// Config on a product (products.personalization, migration 011):
//   {enabled, required, label, max_length, charset, help, variant_ids}
// variant_ids empty = every variant offers it. Engraving never changes the price.
export const CHARSETS=Object.freeze({
 upper_alnum:{label:'Capital letters and numbers (A–Z, 0–9), no spaces',test:/^[A-Z0-9]+$/,transform:s=>s.toUpperCase()},
 alnum:{label:'Letters and numbers, no spaces',test:/^[A-Za-z0-9]+$/},
 alnum_space:{label:'Letters, numbers and single spaces',test:/^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/},
 text:{label:'Letters, numbers, spaces and . , & - \' symbols',test:/^[A-Za-z0-9 .,&'-]+$/}
});
export const MAX_ENGRAVING=40;
const fail=m=>{throw Object.assign(new Error(m),{status:400});};

// Staff input → stored config (or null to switch off).
export function personalizationConfig(input){
 if(input==null||input===false)return null;
 if(typeof input!=='object'||Array.isArray(input))fail('Engraving settings must be an object');
 if(!input.enabled)return null;
 const max=Number(input.max_length??10);if(!Number.isInteger(max)||max<1||max>MAX_ENGRAVING)fail(`Engraving length must be 1–${MAX_ENGRAVING} characters`);
 const charset=String(input.charset??'upper_alnum');if(!CHARSETS[charset])fail('Choose an engraving character rule');
 const label=String(input.label??'Engraving').trim().slice(0,40)||'Engraving';
 const help=String(input.help??'').trim().slice(0,200);
 const variant_ids=Array.isArray(input.variant_ids)?[...new Set(input.variant_ids.map(String))]:[];
 if(variant_ids.some(v=>!/^[1-9]\d{0,17}$/.test(v)))fail('Invalid variant for engraving');
 return {enabled:true,required:input.required===true,label,max_length:max,charset,help,variant_ids};
}
export const offersEngraving=(config,variantId)=>!!config?.enabled&&(!config.variant_ids?.length||config.variant_ids.includes(String(variantId)));
// Normalises what the customer typed (trim, capitals where the rule needs them). '' = none.
export function normalizeEngraving(config,value){
 let s=String(value??'').replace(/\s+/g,' ').trim();
 const rule=CHARSETS[config?.charset];if(rule?.transform)s=rule.transform(s);
 return s;
}
// Error message for this engraving on this variant, or null when it is acceptable.
export function engravingError(config,variantId,value){
 const s=String(value??'');
 if(!offersEngraving(config,variantId))return s?'This item cannot be engraved.':null;
 if(!s)return config.required?`${config.label} is required for this item.`:null;
 if(s.length>config.max_length)return `${config.label}: up to ${config.max_length} characters.`;
 if(!CHARSETS[config.charset].test.test(s))return `${config.label}: ${CHARSETS[config.charset].label}.`;
 return null;
}
