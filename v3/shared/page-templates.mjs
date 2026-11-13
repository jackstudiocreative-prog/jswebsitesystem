// Theme page templates: the Shopify Liquid sections each storefront page (/pages/<slug>) is built from,
// with their settings and blocks (same shape as Shopify JSON templates). Defaults come from the Shopify
// theme; a theme stores its own copy once staff edit a page in the theme editor.
import {SECTION_SCHEMAS,BLOCK_SCHEMAS,PAGE_TEMPLATES} from './liquid-theme.mjs';
export {SECTION_SCHEMAS,PAGE_TEMPLATES};
// Storefront /pages/<slug> pages; 'home', 'header' and 'footer' are the home page and the site header/footer.
export const PAGE_SLUGS=Object.keys(PAGE_TEMPLATES).filter(s=>!['home','header','footer'].includes(s));
export const SITE_PAGES=['home',...PAGE_SLUGS];
export const blockSchema=(sectionType,type)=>SECTION_SCHEMAS[sectionType]?.blocks?.find(b=>b.type===type)??BLOCK_SCHEMAS[type];
export const templateFor=(content,slug)=>content?.templates?.[slug]??PAGE_TEMPLATES[slug]??null;
export const liquidLabel=type=>SECTION_SCHEMAS[type]?.name??type;
// Section types staff can add to a page: sections with a schema that are not header/footer parts.
export const ADDABLE=Object.keys(SECTION_SCHEMAS).filter(t=>!/header|footer|announcement|^_blocks$|login|cart|product-page|search|collection-main|journal/.test(t)).sort((a,b)=>liquidLabel(a).localeCompare(liquidLabel(b)));

const fail=m=>{const e=new Error(m);e.validation=true;throw e;};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const ID=/^[A-Za-z0-9_-]{1,80}$/;
// Text may carry simple formatting (as in Shopify) but never scripts, frames or event handlers.
export function cleanHtml(s,max=20000){
 return String(s??'').slice(0,max).replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi,'').replace(/<\s*\/?\s*(script|iframe|object|embed|link|meta|base)\b[^>]*>/gi,'')
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/(href|src)\s*=\s*(["']?)\s*(javascript|data|vbscript):/gi,'$1=$2#');
}
const URL_OK=/^(\/(?!\/)|#|https:\/\/|mailto:|tel:)/;
function value(f,v,label){
 if(v==null||v==='')return f.type==='checkbox'?false:v===''?'':null;
 switch(f.type){
  case 'checkbox':return v===true||v==='true';
  case 'range':case 'number':{const n=Number(v);if(!Number.isFinite(n))fail(`${label} must be a number`);return f.min!=null&&f.max!=null?Math.min(f.max,Math.max(f.min,n)):n;}
  case 'select':case 'radio':{const s=String(v);if(f.options&&!f.options.some(o=>String(o.value)===s))fail(`${label} is not a valid choice`);return s;}
  case 'color':case 'color_background':{const s=String(v).trim();if(!/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/i.test(s))fail(`${label} is not a colour`);return s;}
  case 'url':case 'video_url':{const s=String(v).trim();if(!URL_OK.test(s)&&!s.startsWith('shopify://'))fail(`${label} must start with /, #, https://, mailto: or tel:`);return s.slice(0,500);}
  case 'image_picker':{const s=String(v);if(!/^[1-9]\d{0,17}$/.test(s)&&!/^shopify:\/\/shop_images\/[^<>"]{1,200}$/.test(s))fail(`${label} is not a valid image`);return s;}
  case 'collection':case 'product':{const s=String(v);if(!/^[a-z0-9][a-z0-9-]{0,99}$/.test(s))fail(`${label} is not valid`);return s;}
  case 'video':return String(v).slice(0,300);
  default:return cleanHtml(v,f.type==='richtext'||f.type==='html'?20000:5000);
 }
}
function settings(schema,input,label){
 if(input==null)return {};if(!plain(input))fail(`${label}: settings must be an object`);
 const out={},fields=new Map((schema?.settings??[]).filter(f=>f.id).map(f=>[f.id,f]));
 for(const [k,v] of Object.entries(input)){const f=fields.get(k);if(!f)continue;out[k]=value(f,v,`${label} · ${f.label??k}`);}
 return out;
}
export function normalizeTemplate(t,slug){
 if(!plain(t))fail(`Page ${slug}: template must be an object`);
 const order=Array.isArray(t.order)?t.order:[];if(order.length>40)fail(`Page ${slug}: use up to 40 sections`);
 const sections={};
 for(const id of order){
  if(!ID.test(String(id))||sections[id])fail(`Page ${slug}: invalid section id`);
  const s=t.sections?.[id];if(!plain(s)||!SECTION_SCHEMAS[s.type])fail(`Page ${slug}: unknown section`);
  const schema=SECTION_SCHEMAS[s.type],label=s.name??schema.name??s.type;
  const blockOrder=Array.isArray(s.block_order)?s.block_order:Object.keys(s.blocks??{});if(blockOrder.length>(schema.max_blocks??50))fail(`${label}: too many blocks`);
  const blocks={};for(const bid of blockOrder){if(!ID.test(String(bid))||blocks[bid])fail(`${label}: invalid block id`);const b=s.blocks?.[bid];const bs=plain(b)?blockSchema(s.type,b.type):null;if(!bs)fail(`${label}: unknown block`);blocks[bid]={type:b.type,...(b.disabled?{disabled:true}:{}),settings:settings(bs,b.settings,`${label} · ${bs.name??b.type}`)};}
  sections[id]={type:s.type,...(s.disabled?{disabled:true}:{}),settings:settings(schema,s.settings,label),blocks,block_order:blockOrder};
 }
 return {title:String(t.title??'').trim().slice(0,120)||slug,content:cleanHtml(t.content,50000),order:[...order],sections};
}
export function normalizeTemplates(value){
 if(value==null)return undefined;if(!plain(value))fail('Page templates must be an object');
 const out={};for(const [slug,t] of Object.entries(value)){if(!PAGE_TEMPLATES[slug])fail(`Unknown page ${slug}`);out[slug]=normalizeTemplate(t,slug);}
 return out;
}
// Media ids staff chose in page templates (Shopify image references are looked up by file name instead).
export function templateMedia(templates){
 const ids=new Set();
 for(const t of Object.values(templates??{}))for(const s of Object.values(t.sections??{})){
  const walk=(schema,vals)=>{for(const f of schema?.settings??[])if(f.type==='image_picker'&&/^\d+$/.test(String(vals?.[f.id]??'')))ids.add(String(vals[f.id]));};
  walk(SECTION_SCHEMAS[s.type],s.settings);for(const b of Object.values(s.blocks??{}))walk(blockSchema(s.type,b.type),b.settings);
 }
 return ids;
}
