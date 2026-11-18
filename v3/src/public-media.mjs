// Public image delivery for the storefront.
//
// Originals stay private ('authenticated' Cloudinary assets). Visitors only ever receive a fixed-width,
// metadata-stripped derivative, and only for images the live storefront actually shows:
//  - images of an active product that is in at least one active collection (featured, gallery, variant);
//  - images chosen in the live theme (V3 sections and Shopify Liquid page templates, header, footer);
//  - images in the published revision of a page.
// Draft, archived, unlinked and unpublished images are refused with 404, whatever ID is guessed.
// The check runs on every request (no long-lived signed link is handed to the browser), so unpublishing
// stops new deliveries after the short cache time below.
import {HttpError} from './auth.mjs';
import {normalizeTheme,themeReferences} from '../shared/theme-schema.mjs';
import {templateFor,SITE_PAGES} from '../shared/page-templates.mjs';
import {references} from './liquid.mjs';
import {OUTLETS} from './liquid-files.mjs';
import {shopifyKey} from './shopify-import.mjs';
import {snapWidth} from './media-urls.mjs';
export {WIDTHS,snapWidth,publicMediaUrl,publicSrcset,publicImage,PUBLIC_CLOUD} from './media-urls.mjs';

export const CACHE_SECONDS=300;
const ID=/^[1-9]\d{0,17}$/;
const PRODUCT_RULE=`EXISTS(SELECT 1 FROM products p WHERE p.status='active'
  AND EXISTS(SELECT 1 FROM product_collections pc JOIN collections c ON c.id=pc.collection_id WHERE pc.product_id=p.id AND c.status='active')
  AND (p.featured_media_id=m.id OR EXISTS(SELECT 1 FROM product_media pm WHERE pm.product_id=p.id AND pm.media_id=m.id)
   OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active AND v.media_id=m.id)))`;

// Image references of the live theme and published pages: numeric media IDs and Shopify file keys.
async function contentReferences(db){
 const ids=new Set(),keys=new Set(OUTLETS.filter(o=>o.photo).map(o=>shopifyKey('files/'+o.photo)));
 const add=ref=>{const s=String(ref);if(ID.test(s))ids.add(s);else{const name=s.match(/^shopify:\/\/shop_images\/(.+)$/)?.[1];if(name)keys.add(shopifyKey('files/'+name));}};
 const live=(await db.query('SELECT content FROM themes WHERE is_live AND NOT archived')).rows[0];
 if(live){
  let content;try{content=normalizeTheme(live.content);}catch{content=null;}
  if(content){
   const visible=list=>list.filter(s=>!s.hidden);
   for(const id of themeReferences({...content,header:visible(content.header),sections:visible(content.sections),footer:visible(content.footer)}).media)add(id);
   for(const slug of [...SITE_PAGES,'header','footer']){
    const t=templateFor(content,slug);if(!t)continue;
    const list=(t.order??[]).map(id=>({id,...t.sections[id]})).filter(s=>s.type&&!s.disabled);
    for(const r of references(list).images)add(r);
   }
  }
 }
 // Published page revisions: section settings.media_id (V3 page sections).
 for(const r of (await db.query('SELECT r.sections FROM pages p JOIN page_revisions r ON r.id=p.published_revision_id')).rows)
  for(const s of Array.isArray(r.sections)?r.sections:[])if(!s?.hidden&&s?.settings?.media_id!=null)add(s.settings.media_id);
 return {ids,keys};
}

// The ready media row, if the live storefront is allowed to show it; otherwise null.
export async function publicMediaRow(db,id){
 if(!ID.test(String(id)))return null;
 const m=(await db.query(`SELECT m.id,m.object_key,m.format,m.version,m.width,m.height,m.label,${PRODUCT_RULE} AS product FROM media m WHERE m.id=$1 AND m.state='ready'`,[String(id)])).rows[0];
 if(!m)return null;
 if(m.product)return m;
 const refs=await contentReferences(db);
 return refs.ids.has(String(m.id))||refs.keys.has(m.object_key)?m:null;
}

// GET /api/v3/storefront/media/:id?w=640 → short-lived redirect to the derivative.
export async function deliverPublicMedia(db,id,width,cloud){
 const m=await publicMediaRow(db,id);
 if(!m)throw new HttpError(404,'Image not found');
 if(!cloud?.publicDerivative)throw new HttpError(503,'Image delivery is not configured');
 return cloud.publicDerivative(m,snapWidth(width));
}
