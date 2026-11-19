// Storefront addresses this system serves. Theme links to anything else (Shopify's blog, customer
// accounts) would lead nowhere: the storefront hides them and the theme editor lists them for staff.
export const UNSUPPORTED=[{test:/^\/blogs(\/|$)/,reason:'Blog is not available yet'},{test:/^\/account(\/|$)/,reason:'Customer accounts are not available yet'}];
export function unsupportedLink(href){
 if(typeof href!=='string')return null;
 let path;try{const u=new URL(href,'https://store.invalid');if(u.origin!=='https://store.invalid')return null;path=decodeURI(u.pathname);}catch{return null;}
 return UNSUPPORTED.find(r=>r.test.test(path))?.reason??null;
}
