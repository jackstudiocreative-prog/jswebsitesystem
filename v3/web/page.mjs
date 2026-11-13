// Public page shell: shows only published content from the read-only storefront API.
import {renderPage} from '../admin/page-render.mjs';
import {renderThemeHeader,renderThemeFooter} from '../admin/theme-render.mjs';
import {activateTheme,liveTheme,themeMedia,previewPages} from './theme-behaviour.mjs';
// With a live Online Store theme, its header and footer replace the plain staging header and footer.
liveTheme().then(theme=>{
 if(!theme)return;
 const header=document.querySelector('body>header'),footer=document.querySelector('body>footer');
 const top=document.createElement('div'),bottom=document.createElement('div');
 top.innerHTML=renderThemeHeader(theme,themeMedia());bottom.innerHTML=renderThemeFooter(theme,themeMedia());
 header?.replaceWith(top);footer?.replaceWith(bottom);document.body.classList.add('jt-body');
 activateTheme(document.body,theme.settings);
});
const root=document.getElementById('page-root');
const message=text=>{root.innerHTML='';const s=document.createElement('section');s.className='store-section';const d=document.createElement('div');d.className='js-rich js-align-center';const h=document.createElement('h1');h.textContent=text;d.append(h);s.append(d);root.append(s);};
const slug=location.pathname.match(/^\/pages\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/)?.[1];
// Pages built from the theme's Shopify sections (brand story, outlets, policies…). Their CSS and section
// scripts load as same-site files; the theme's global stylesheet goes before the header/footer styles.
const load=(tag,attrs)=>new Promise(ok=>{const n=document.createElement(tag);Object.assign(n,attrs);n.onload=n.onerror=()=>ok();(tag==='link'?document.head.querySelector('link[href="/theme.css"]')?.before(n)??document.head.append(n):document.body.append(n));});
async function themePage(){
 const preview=previewPages();if(preview)return preview[slug]??null;
 const r=await fetch('/api/v3/storefront/theme/pages/'+slug).catch(()=>null);return r?.ok?r.json():null;
}
async function showThemePage(data){
 document.title=`${data.title} | Jack Studio`;
 const link=document.createElement('link');link.rel='canonical';link.href=location.origin+'/pages/'+slug;document.head.append(link);
 await load('link',{rel:'stylesheet',href:'/theme-assets/shopify/jack-studio-1to1.css'});
 root.innerHTML=data.html;root.classList.add('lq-page');document.body.classList.add('lq-body');
 await load('script',{src:'/theme-assets/shopify/runtime.js'});await load('script',{src:'/theme-assets/shopify/jack-studio.js'});
 if(data.scripts?.length)await load('script',{src:'/api/v3/storefront/theme/scripts.js?s='+encodeURIComponent(data.scripts.join(','))});
}
if(!slug)message('Page not found');
else themePage().then(data=>data?showThemePage(data):fetch('/api/v3/storefront/pages/'+slug).then(async r=>{
 const data=await r.json();
 if(data.redirect_to){location.replace('/pages/'+encodeURIComponent(data.redirect_to));return;}
 if(!r.ok||!data.page){message('Page not found');return;}
 const page=data.page;document.title=page.seo_title||`${page.title} | Jack Studio`;
 document.querySelector('meta[name=description]').setAttribute('content',page.seo_description||'');
 for(const [k,v] of [['og:title',page.seo_title||page.title],['og:description',page.seo_description||''],['og:type','website']]){const m=document.createElement('meta');m.setAttribute('property',k);m.setAttribute('content',v);document.head.append(m);}
 const link=document.createElement('link');link.rel='canonical';link.href=location.origin+'/pages/'+page.slug;document.head.append(link);
 root.innerHTML=renderPage(page,{});
})).catch(()=>message('This page could not be loaded. Please try again.'));
