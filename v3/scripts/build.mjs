import { mkdir,copyFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
await mkdir(new URL('public/admin/',root),{recursive:true});
await copyFile(new URL('web/index.html',root),new URL('public/index.html',root));
await copyFile(new URL('admin/index.html',root),new URL('public/admin/index.html',root));
await copyFile(new URL('../../jackstudio-admin-mvp/public/styles.css',import.meta.url),new URL('public/styles.css',root));
