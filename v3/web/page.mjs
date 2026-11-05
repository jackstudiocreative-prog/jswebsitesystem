// Public page shell: shows only published content from the read-only storefront API.
import {renderPage} from '../admin/page-render.mjs';
const root=document.getElementById('page-root');
const message=text=>{root.innerHTML='';const s=document.createElement('section');s.className='store-section';const d=document.createElement('div');d.className='js-rich js-align-center';const h=document.createElement('h1');h.textContent=text;d.append(h);s.append(d);root.append(s);};
const slug=location.pathname.match(/^\/pages\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/)?.[1];
if(!slug)message('Page not found');
else fetch('/api/v3/storefront/pages/'+slug).then(async r=>{
 const data=await r.json();
 if(data.redirect_to){location.replace('/pages/'+encodeURIComponent(data.redirect_to));return;}
 if(!r.ok||!data.page){message('Page not found');return;}
 const page=data.page;document.title=page.seo_title||`${page.title} | Jack Studio`;
 document.querySelector('meta[name=description]').setAttribute('content',page.seo_description||'');
 for(const [k,v] of [['og:title',page.seo_title||page.title],['og:description',page.seo_description||''],['og:type','website']]){const m=document.createElement('meta');m.setAttribute('property',k);m.setAttribute('content',v);document.head.append(m);}
 const link=document.createElement('link');link.rel='canonical';link.href=location.origin+'/pages/'+page.slug;document.head.append(link);
 root.innerHTML=renderPage(page,{});
}).catch(()=>message('This page could not be loaded. Please try again.'));
