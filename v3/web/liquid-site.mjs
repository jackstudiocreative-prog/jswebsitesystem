// Storefront pages built from the Shopify theme (header, page sections, footer; see src/liquid.mjs).
// The HTML comes from the server (or, in a staff preview tab, from the admin); the theme's stylesheet,
// the small runtime and the section scripts load as same-site files.
import {previewPages,previewInfo} from './theme-behaviour.mjs';
export async function siteData(slug){
 const preview=previewPages();if(preview){previewInfo();return preview[slug]??null;}
 const r=await fetch('/api/v3/storefront/theme/pages/'+slug).catch(()=>null);return r?.ok?r.json():null;
}
const load=(tag,attrs)=>new Promise(ok=>{const n=document.createElement(tag);Object.assign(n,attrs);n.onload=n.onerror=()=>ok();(tag==='link'?document.head:document.body).append(n);});
// Replaces the page with header + main + footer. `main` (optional) is an element to show instead of the
// page sections (pages that are not built from the theme).
export async function mountSite(data,main){
 // Only the Shopify theme's own styles apply (the V3 home styles use the same class names).
 for(const href of main?['/theme.css']:['/theme.css','/styles.css','/page-sections.css'])document.head.querySelector(`link[href="${href}"]`)?.remove();
 await load('link',{rel:'stylesheet',href:'/theme-assets/shopify/base.css'});
 await load('link',{rel:'stylesheet',href:'/theme-assets/shopify/jack-studio-1to1.css'});
 const bar=document.querySelector('.jt-preview-bar');
 const head=document.createElement('div');head.className='lq-header';head.innerHTML=data.header??'';
 const body=document.createElement('main');body.id='MainContent';body.className='lq-page';if(main)body.append(main);else body.innerHTML=data.html??'';
 const foot=document.createElement('div');foot.className='lq-footer';foot.innerHTML=data.footer??'';
 for(const n of [...document.body.children])if(n!==bar&&n.tagName!=='SCRIPT')n.remove();
 document.body.className='lq-body';document.body.append(head,body,foot);if(bar)document.body.prepend(bar);
 await load('script',{src:'/theme-assets/shopify/runtime.js'});await load('script',{src:'/theme-assets/shopify/jack-studio.js'});
 if(data.scripts?.length)await load('script',{src:'/api/v3/storefront/theme/scripts.js?s='+encodeURIComponent(data.scripts.join(','))});
}
