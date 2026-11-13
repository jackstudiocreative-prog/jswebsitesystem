// Storefront home page: the live theme's home page as on Shopify (header, home sections, footer).
// Without a published theme the staging notice in index.html stays as it is.
import {siteData,mountSite} from './liquid-site.mjs';
import {previewTheme} from './theme-behaviour.mjs';
const data=await siteData('home');
if(data){
 const theme=previewTheme()?.theme??(await fetch('/api/v3/storefront/theme').then(r=>r.ok?r.json():null).catch(()=>null))?.theme;
 if(theme?.settings?.home_seo_title)document.title=theme.settings.home_seo_title;
 document.querySelector('meta[name=description]')?.setAttribute('content',theme?.settings?.home_seo_description||'');
 await mountSite(data);
}
