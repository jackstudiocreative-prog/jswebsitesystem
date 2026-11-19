// Copies the Shopify theme (jackstudiocreative-prog/website, shopify-theme/) into V3 so the storefront can
// render the original Liquid sections with the same design. Run after changing the Shopify theme export:
//   node scripts/import-shopify-theme.mjs <path to shopify-theme> <path to data/content>
// Writes: shared/liquid-theme.mjs (section schemas + page templates, used by the admin editor and server),
// src/liquid-files.mjs (Liquid sources, server only) and web/theme-assets/shopify/ (global CSS/JS).
import {readFile,readdir,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
const [,,theme,content]=process.argv;if(!theme||!content)throw Error('usage: import-shopify-theme.mjs <shopify-theme> <data/content>');
const out=new URL('../',import.meta.url);
const json=async f=>JSON.parse((await readFile(f,'utf8')).replace(/\/\*[\s\S]*?\*\//g,''));
const SCHEMA=/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;
async function folder(dir){const map={},schemas={};for(const f of (await readdir(join(theme,dir))).filter(f=>f.endsWith('.liquid')).sort()){const src=await readFile(join(theme,dir,f),'utf8'),m=src.match(SCHEMA),name=f.slice(0,-7);map[name]=src.replace(SCHEMA,'');if(m)schemas[name]=JSON.parse(m[1]);}return {map,schemas};}
const sections=await folder('sections'),sections_schemas=sections.schemas,blocks=await folder('blocks'),snippets=await folder('snippets');
const locale=await json(join(theme,'locales/en.default.json')).catch(()=>({}));
const settings=(await json(join(theme,'config/settings_data.json'))).current??{};
// Storefront page addresses (V3 slugs) and the Shopify template each one uses.
const PAGES={'brand-story':'page.brand-story','brand-promise':'page.brand-promise','our-services':'page.our-service','corporate-solution':'page.corporate-solution','outlets':'page.outlets','contact':'page.contact-us','product-collection':'page.product-series',
 'privacy-policy':'page.privacy-policy-draft','refund-policy':'page.refund-policy-draft','shipping-policy':'page.shipping-policy-draft','terms-of-service':'page.terms-of-service-draft'};
const pages=(await json(join(content,'pages.json'))).pages;
// Old Shopify page addresses → V3 addresses, applied to every link in the copied settings.
const LINKS={};for(const p of pages){const slug=Object.entries(PAGES).find(([,t])=>t==='page.'+p.template_suffix)?.[0];if(slug&&p.handle!==slug)LINKS['/pages/'+p.handle]='/pages/'+slug;}
Object.assign(LINKS,{'/pages/our-service':'/pages/our-services','/pages/contact-us':'/pages/contact','/pages/privacy-policy':'/pages/privacy-policy','/pages/return-and-exchanges':'/pages/refund-policy','/pages/shipping':'/pages/shipping-policy','/pages/terms-and-condition':'/pages/terms-of-service','/pages/corporate':'/pages/corporate-solution','/pages/about-us':'/pages/brand-story'});
const relink=v=>typeof v==='string'?v.replace(/(?:https?:\/\/(?:www\.)?jackstudio\.com\.my)?(\/pages\/[^?#"'\s|<>]+)/g,(m,p)=>LINKS[decodeURI(p)]??LINKS[p]??p):v;
const clean=o=>Array.isArray(o)?o.map(clean):o&&typeof o==='object'?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,clean(v)])):relink(o);
const TEMPLATES={};
for(const [slug,file] of Object.entries(PAGES)){
 const t=await json(join(theme,'templates',file+'.json')),page=pages.find(p=>'page.'+p.template_suffix===file);
 const sections=Object.fromEntries(t.order.filter(id=>!t.sections[id].disabled&&sections_schemas[t.sections[id].type]).map(id=>[id,clean(t.sections[id])]));
 const body=await readFile(join(content,'pages',file.slice(5)+'.html'),'utf8').catch(()=>'');
 TEMPLATES[slug]={title:page?.title??slug,content:body,order:Object.keys(sections),sections};
}
// Outlet entries (Shopify metaobjects) for the outlets sections; photos refer to Shopify file names.
const OUTLETS=(await json(join(content,'outlets.json'))).outlets.sort((a,b)=>a.handle.localeCompare(b.handle)).map(o=>({...o,photo:o.photo?decodeURIComponent(o.photo.split('/files/').pop().split('?')[0]):null}));
// Shopify-hosted videos used by the theme (Shopify Admin API, files media_type:VIDEO): still served from
// Shopify's video CDN until they are moved.
const VIDEOS={
 '202202 P01_Store_full hd .mp4':{mp4:'https://cdn.shopify.com/videos/c/vp/4e566717733f4ccbbc4cb7e6d184b88a/4e566717733f4ccbbc4cb7e6d184b88a.HD-1080p-7.2Mbps-13989308.mp4',poster:'https://cdn.shopify.com/s/files/1/0745/2550/7871/files/preview_images/4e566717733f4ccbbc4cb7e6d184b88a.thumbnail.0000000000.jpg'},
 'Brand Awareness English Ver. 1x1.mp4':{mp4:'https://cdn.shopify.com/videos/c/vp/158730cc862d472d83499d116d128291/158730cc862d472d83499d116d128291.HD-1080p-2.5Mbps-36246589.mp4',poster:'https://cdn.shopify.com/s/files/1/0745/2550/7871/files/preview_images/158730cc862d472d83499d116d128291.thumbnail.0000000000.jpg'}
};
// Home page and the static header/footer sections (settings live in config/settings_data.json).
{
 const t=await json(join(theme,'templates/index.json'));
 const sections=Object.fromEntries(t.order.filter(id=>!t.sections[id].disabled&&sections_schemas[t.sections[id].type]).map(id=>[id,clean(t.sections[id])]));
 for(const s of Object.values(sections))if(s.type==='virtual-showroom')s.settings={...s.settings,showroom_url:'/showroom/'}; // hosted with the site
 TEMPLATES.home={title:'Home page',content:'',order:Object.keys(sections),sections};
 for(const part of ['header','footer']){const id='jack-'+part,s=settings.sections?.[id];TEMPLATES[part]={title:part==='header'?'Header':'Footer',content:'',order:[id],sections:{[id]:clean({type:id,...s})}};}
}
// Small accessibility fixes to the copied sections (design unchanged).
sections.map['virtual-showroom']=sections.map['virtual-showroom'].replace('<button type="button" class="vs-cover" aria-label="{{ section.settings.button_text }}">','<button type="button" class="vs-cover">');
const header='// Generated by scripts/import-shopify-theme.mjs from the Shopify theme export. Do not edit by hand.\n';
await writeFile(new URL('shared/liquid-theme.mjs',out),header+`export const SECTION_SCHEMAS=${JSON.stringify(sections.schemas)};\nexport const BLOCK_SCHEMAS=${JSON.stringify(blocks.schemas)};\nexport const PAGE_TEMPLATES=${JSON.stringify(TEMPLATES)};\n`);
await writeFile(new URL('src/liquid-files.mjs',out),header+`export const SECTIONS=${JSON.stringify(sections.map)};\nexport const BLOCKS=${JSON.stringify(blocks.map)};\nexport const SNIPPETS=${JSON.stringify(snippets.map)};\nexport const LOCALE=${JSON.stringify(locale)};\nexport const SETTINGS=${JSON.stringify(settings)};\nexport const OUTLETS=${JSON.stringify(OUTLETS)};\nexport const VIDEOS=${JSON.stringify(VIDEOS)};\n`);
for(const f of ['jack-studio-1to1.css','jack-studio.js','virtual-showroom-cover.jpg'])await copyFile(join(theme,'assets',f),new URL('web/theme-assets/shopify/'+f,out));
console.log(Object.keys(sections.map).length,'sections,',Object.keys(TEMPLATES).length,'page templates');
