// Storefront home page: renders the live Online Store theme (header, home sections, footer).
// Without a published theme the staging notice in index.html stays as it is.
import {renderThemeBody} from '../admin/theme-render.mjs';
import {activateTheme,liveTheme,themeMedia} from './theme-behaviour.mjs';
const theme=await liveTheme();
if(theme){
 const root=document.getElementById('theme-root');
 root.innerHTML=renderThemeBody(theme,themeMedia());
 document.body.classList.add('js-body','jt-body');
 if(theme.settings.home_seo_title)document.title=theme.settings.home_seo_title;
 document.querySelector('meta[name=description]')?.setAttribute('content',theme.settings.home_seo_description||'');
 activateTheme(root,theme.settings);
 document.getElementById('staging-notice')?.remove();
}
