// Membership lives on Jack Studio Club (a separate system). The account icon and any /account link
// (Shopify's account pages) go there; vercel.json redirects /account and /account/* to it.
export const MEMBER_CLUB_URL='https://club.jackstudio.com.my/';
// Storefront addresses this system serves. Theme links to anything else (Shopify's blog) would lead
// nowhere: the storefront hides them and the theme editor lists them for staff.
export const UNSUPPORTED=[{test:/^\/blogs(\/|$)/,reason:'Blog is not available yet'}];
export function unsupportedLink(href){
 if(typeof href!=='string')return null;
 let path;try{const u=new URL(href,'https://store.invalid');if(u.origin!=='https://store.invalid')return null;path=decodeURI(u.pathname);}catch{return null;}
 return UNSUPPORTED.find(r=>r.test.test(path))?.reason??null;
}
