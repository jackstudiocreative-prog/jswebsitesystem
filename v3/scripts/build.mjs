import { mkdir,copyFile,cp } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { allowPreview } from './preview-policy.mjs';
if(process.env.VERCEL && !allowPreview(process.env))throw Error('Only staging branch Preview builds are enabled');
const root=new URL('../',import.meta.url);
await mkdir(new URL('public/admin/',root),{recursive:true});
await copyFile(new URL('web/index.html',root),new URL('public/index.html',root));
await copyFile(new URL('admin/index.html',root),new URL('public/admin/index.html',root));
await copyFile(new URL('../../jackstudio-admin-mvp/public/styles.css',import.meta.url),new URL('public/styles.css',root));
await copyFile(new URL('admin/catalog.css',root),new URL('public/catalog.css',root));
await copyFile(new URL('admin/page-sections.css',root),new URL('public/page-sections.css',root));
await copyFile(new URL('admin/theme.css',root),new URL('public/theme.css',root));
// Theme fonts are self-hosted (the storefront CSP allows same-origin fonts only). Both are OFL-1.1.
await mkdir(new URL('public/fonts/',root),{recursive:true});
for(const [pkg,file] of [['bebas-neue','bebas-neue-latin-400-normal.woff2'],...['400','500','600','700'].map(w=>['inter',`inter-latin-${w}-normal.woff2`])])await copyFile(new URL(`node_modules/@fontsource/${pkg}/files/${file}`,root),new URL('public/fonts/'+file,root));
// Built-in theme images (the virtual-showroom cover was a Shopify theme asset, not a library file).
await mkdir(new URL('public/theme-assets/',root),{recursive:true});
await copyFile(new URL('web/theme-assets/virtual-showroom-cover.jpg',root),new URL('public/theme-assets/virtual-showroom-cover.jpg',root));
// 3D virtual showroom (see scripts/import-showroom.py), embedded in the home page.
await cp(new URL('showroom/',root),new URL('public/showroom/',root),{recursive:true});
await copyFile(new URL('web/page.html',root),new URL('public/page.html',root));
await copyFile(new URL('web/shop.html',root),new URL('public/shop.html',root));
const url=process.env.SUPABASE_URL??'',key=process.env.SUPABASE_PUBLISHABLE_KEY??'';
if(url&&new URL(url).protocol!=='https:')throw Error('HTTPS Supabase URL required');
if(key&&!key.startsWith('sb_publishable_'))throw Error('Only a Supabase publishable key may enter the browser build');
await writeFile(new URL('public/auth-config.json',root),JSON.stringify({url,key}));
await build({entryPoints:[new URL('admin/app.mjs',root).pathname.replace(/^\/([A-Za-z]:)/,'$1')],bundle:true,format:'esm',platform:'browser',outfile:new URL('public/admin.js',root).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
await build({entryPoints:[new URL('web/page.mjs',root).pathname.replace(/^\/([A-Za-z]:)/,'$1')],bundle:true,format:'esm',platform:'browser',outfile:new URL('public/page.js',root).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
await build({entryPoints:[new URL('web/home.mjs',root).pathname.replace(/^\/([A-Za-z]:)/,'$1')],bundle:true,format:'esm',platform:'browser',outfile:new URL('public/home.js',root).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
await build({entryPoints:[new URL('web/shop.mjs',root).pathname.replace(/^\/([A-Za-z]:)/,'$1')],bundle:true,format:'esm',platform:'browser',outfile:new URL('public/shop.js',root).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
