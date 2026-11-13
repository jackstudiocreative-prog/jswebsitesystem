// Public page shell (/pages/<slug>): pages built from the theme's Shopify sections, or published V3
// pages shown between the theme's header and footer.
import {renderPage} from '../admin/page-render.mjs';
import {siteData,mountSite} from './liquid-site.mjs';
const root=document.getElementById('page-root');
const message=text=>{root.innerHTML='';const s=document.createElement('section');s.className='store-section';const d=document.createElement('div');d.className='js-rich js-align-center';const h=document.createElement('h1');h.textContent=text;d.append(h);s.append(d);root.append(s);};
const slug=location.pathname.match(/^\/pages\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/)?.[1];
const canonical=path=>{const link=document.createElement('link');link.rel='canonical';link.href=location.origin+path;document.head.append(link);};
async function show(){
 if(!slug){message('Page not found');return;}
 const data=await siteData(slug);
 if(data){document.title=`${data.title} | Jack Studio`;canonical('/pages/'+slug);await mountSite(data);return;}
 const r=await fetch('/api/v3/storefront/pages/'+slug);const page=await r.json().catch(()=>({}));
 if(page.redirect_to){location.replace('/pages/'+encodeURIComponent(page.redirect_to));return;}
 const frame=await siteData('_frame');
 if(!r.ok||!page.page){message('Page not found');if(frame)await mountSite(frame,root);return;}
 const p=page.page;document.title=p.seo_title||`${p.title} | Jack Studio`;
 document.querySelector('meta[name=description]').setAttribute('content',p.seo_description||'');
 for(const [k,v] of [['og:title',p.seo_title||p.title],['og:description',p.seo_description||''],['og:type','website']]){const m=document.createElement('meta');m.setAttribute('property',k);m.setAttribute('content',v);document.head.append(m);}
 canonical('/pages/'+p.slug);root.innerHTML=renderPage(p,{});if(frame)await mountSite(frame,root);
}
show().catch(()=>message('This page could not be loaded. Please try again.'));
