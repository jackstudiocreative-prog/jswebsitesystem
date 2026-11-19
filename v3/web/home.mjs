// Storefront home page: the live theme's home page as on Shopify (header, home sections, footer).
// No published theme and "could not load" are different situations and say so differently.
import {mountSite} from './liquid-site.mjs';
import {previewTheme,previewPages,previewInfo} from './theme-behaviour.mjs';
const box=document.getElementById('store-status');
const h=(tag,props={},...kids)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(props))if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else n.setAttribute(k,v);n.append(...kids.filter(Boolean));return n;};
function show(...kids){box?.replaceChildren(h('div',{class:'store-status-inner'},h('p',{class:'store-status-brand'},'JACK STUDIO'),...kids));}
async function load(){
 const preview=previewPages();
 if(preview){previewInfo();if(preview.home)return start(preview.home);return show(h('h1',{},'Nothing to preview'),h('p',{},'This preview has no home page.'));}
 let r;try{r=await fetch('/api/v3/storefront/theme/pages/home');}catch{r=null;}
 if(r?.ok)return start(await r.json());
 const body=r?await r.json().catch(()=>({})):{};
 if(r?.status===404&&body.error==='No live theme'){
  document.title='Jack Studio';
  return show(h('h1',{},'Our online store is being prepared'),h('p',{},'New pieces are being arranged. You can already browse the collection.'),h('a',{class:'store-button',href:'/collections/all'},'Browse all products'));
 }
 document.title='Jack Studio';
 show(h('h1',{},'This page could not be loaded'),h('p',{},'Please check your connection and try again.'),h('button',{class:'store-button',type:'button',onclick:()=>{show(h('p',{},'Loading…'));load();}},'Try again'));
}
async function start(data){
 const theme=previewTheme()?.theme??(await fetch('/api/v3/storefront/theme').then(r=>r.ok?r.json():null).catch(()=>null))?.theme;
 if(theme?.settings?.home_seo_title)document.title=theme.settings.home_seo_title;
 document.querySelector('meta[name=description]')?.setAttribute('content',theme?.settings?.home_seo_description||'');
 box?.remove();
 await mountSite(data);
}
await load();
