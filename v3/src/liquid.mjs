// Renders the original Shopify Liquid sections (copied by scripts/import-shopify-theme.mjs) so storefront
// pages keep the exact Shopify design. Section settings come from the theme (editable in the admin theme
// editor). Inline <script> blocks are split out and served as same-site files (the storefront CSP allows
// no inline scripts); inline onclick/onchange calls become data attributes run by theme-assets/shopify/runtime.js.
import {Liquid,Tag} from 'liquidjs';
import {SECTIONS,BLOCKS,SNIPPETS,LOCALE,SETTINGS,OUTLETS,VIDEOS} from './liquid-files.mjs';
import {SECTION_SCHEMAS,BLOCK_SCHEMAS} from '../shared/liquid-theme.mjs';
import {shopifyKey} from './shopify-import.mjs';
import {publicMediaUrl,publicSrcset} from './media-urls.mjs';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const PLACEHOLDER="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='1200' viewBox='0 0 4 3'%3E%3Crect width='4' height='3' fill='%23e7e1d3'/%3E%3C/svg%3E";
const SHOPIFY_IMAGE=/^shopify:\/\/shop_images\/(.+)$/;
const isImageRef=v=>typeof v==='string'&&(SHOPIFY_IMAGE.test(v)||/^[1-9]\d{0,17}$/.test(v));
const fileKey=ref=>SHOPIFY_IMAGE.test(ref)?shopifyKey('files/'+ref.match(SHOPIFY_IMAGE)[1]):null;

// Shopify-style image object. src is a URL when one can be shown (signed admin preview); otherwise a
// neutral placeholder so layouts keep their shape.
function image(row,url,alt,pub=false){
 const src=url||(row?.width&&row?.height?`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${row.width}' height='${row.height}' viewBox='0 0 ${row.width} ${row.height}'%3E%3Crect width='${row.width}' height='${row.height}' fill='%23e7e1d3'/%3E%3C/svg%3E`:PLACEHOLDER),w=row?.width??1600,h=row?.height??1200;
 const img={id:row?.id?String(row.id):null,src,url:src,alt:alt??row?.label??'',width:w,height:h,aspect_ratio:w/h,presentation:{focal_point:'50% 50%'},toString(){return src;}};
 // Public storefront images: image_url/image_tag pick a fixed width and add a srcset.
 if(pub&&url&&row?.id)Object.defineProperties(img,{_public:{value:true},_srcset:{value:publicSrcset(row.id,row.width)}});
 return img;
}
// Shopify-hosted video (shopify://files/videos/<name>) → object for the video_tag filter.
function video(v){const name=String(v??'').match(/^shopify:\/\/files\/videos\/(.+)$/)?.[1];const m=name&&VIDEOS[name];return m?{alt:'',sources:[{url:m.mp4,mime_type:'video/mp4'}],preview_image:{src:m.poster,url:m.poster,toString:()=>m.poster},toString:()=>m.mp4}:null;}
// Shopify resource links (shopify://pages/x) → storefront paths.
function link(v){if(typeof v!=='string')return v;const m=v.match(/^shopify:\/\/(pages|collections|products|blogs)\/(.+)$/);return m?`/${m[1]}/${m[2]}`:v;}
function outlet(v,ctx){const h=String(v??'').split('/').pop();const o=OUTLETS.find(x=>x.handle===h);return o?Object.fromEntries(Object.entries(o).map(([k,x])=>[k,{value:k==='photo'&&x?ctx.fileImage(x):x}])):null;}
function videoUrl(v){
 const s=String(v??'');let m=s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,20})/);if(m)return {id:m[1],type:'youtube',toString:()=>s};
 m=s.match(/vimeo\.com\/(?:video\/)?(\d{5,12})/);if(m)return {id:m[1],type:'vimeo',toString:()=>s};return null;
}
const money=c=>'RM'+(Number(c??0)/100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');

// Context: loads referenced images and collections in one pass before rendering.
export async function loadContext(db,refs,{mediaUrl=null,publicImages=false}={}){
 const keys=new Set(),ids=new Set();
 for(const r of refs.images){if(/^\d+$/.test(r))ids.add(r);else if(fileKey(r))keys.add(fileKey(r));}
 for(const o of OUTLETS)if(o.photo)keys.add(shopifyKey('files/'+o.photo));
 const rows=keys.size||ids.size?(await db.query("SELECT id,object_key,label,width,height,format FROM media WHERE state='ready' AND (object_key = ANY($1::text[]) OR id = ANY($2::bigint[]))",[[...keys],[...ids]])).rows:[];
 const byKey=new Map(rows.map(r=>[r.object_key,r])),byId=new Map(rows.map(r=>[String(r.id),r]));
 const collections=new Map();
 if(refs.collections.size){
  const cs=(await db.query("SELECT id,title,slug,description FROM collections WHERE status='active' AND slug = ANY($1::text[])",[[...refs.collections]])).rows;
  for(const c of cs){
   // to_jsonb keeps this working before migration 010 (tags, compare-at prices).
   const ps=(await db.query(`SELECT p.id,p.title,p.handle,p.price_minor,p.featured_media_id,p.option_names,coalesce(to_jsonb(p)->'tags','[]'::jsonb) AS tags,
     (SELECT coalesce(sum(v.inventory),0) FROM product_variants v WHERE v.product_id=p.id AND v.active)>0 AS available,
     (SELECT (to_jsonb(v)->>'compare_at_minor')::int FROM product_variants v WHERE v.product_id=p.id AND v.active ORDER BY v.price_minor,v.position,v.id LIMIT 1) AS compare_at,
     (SELECT array_agg(pm.media_id ORDER BY pm.position) FROM product_media pm WHERE pm.product_id=p.id) AS media_ids,
     (SELECT coalesce(json_agg(json_build_object('id',v.id::text,'options',v.option_values,'price',v.price_minor,'available',v.inventory>0,'media_id',v.media_id::text) ORDER BY v.position,v.id),'[]'::json) FROM product_variants v WHERE v.product_id=p.id AND v.active) AS variants
    FROM products p JOIN product_collections pc ON pc.product_id=p.id WHERE pc.collection_id=$1 AND p.status='active' ORDER BY (to_jsonb(pc)->>'position')::int NULLS LAST,p.id DESC LIMIT 250`,[c.id])).rows;
   collections.set(c.slug,{...c,products:ps});
  }
  // Product images in one query.
  const mids=[...new Set([...collections.values()].flatMap(c=>c.products.flatMap(p=>[...(p.media_ids??[]),p.featured_media_id,...(Array.isArray(p.variants)?p.variants.map(v=>v.media_id):[])].filter(Boolean).map(String))))];
  if(mids.length)for(const r of (await db.query("SELECT id,object_key,label,width,height,format FROM media WHERE state='ready' AND id = ANY($1::bigint[])",[mids])).rows)byId.set(String(r.id),r);
 }
 const img=(ref,alt)=>{if(ref==null||ref==='')return null;const row=/^\d+$/.test(String(ref))?byId.get(String(ref)):byKey.get(fileKey(String(ref)));return image(row,row&&mediaUrl?mediaUrl(row):null,alt,publicImages);};
 const fileImage=name=>{const row=byKey.get(shopifyKey('files/'+name));return image(row,row&&mediaUrl?mediaUrl(row):null,undefined,publicImages);};
 const product=p=>{const images=(p.media_ids??[]).map(id=>img(String(id),p.title)).filter(Boolean),featured=p.featured_media_id?img(String(p.featured_media_id),p.title):images[0]??null;
  // Real variant IDs, so the theme's quick-add buttons put the right variant in the bag (web/cart-bridge.mjs).
  const names=p.option_names??[],variants=(Array.isArray(p.variants)?p.variants:[]).map(v=>({id:v.id,title:(v.options??[]).join(' / ')||'Default Title',options:v.options??[],option1:v.options?.[0]??null,option2:v.options?.[1]??null,option3:v.options?.[2]??null,price:v.price,available:v.available,featured_image:v.media_id?img(v.media_id,p.title):null,toString:()=>v.id}));
  const prices=variants.map(v=>v.price),first=variants.find(v=>v.available)??variants[0]??null;
  const options_with_values=names.map((name,i)=>({name,position:i+1,values:[...new Set(variants.map(v=>v.options[i]).filter(Boolean))]}));
  return {id:String(p.id),title:p.title,handle:p.handle,url:'/products/'+p.handle,price:prices.length?Math.min(...prices):p.price_minor,price_min:prices.length?Math.min(...prices):p.price_minor,price_max:prices.length?Math.max(...prices):p.price_minor,price_varies:new Set(prices).size>1,variants,first_available_variant:first,selected_or_first_available_variant:first,has_only_default_variant:variants.length<=1&&!names.length,options:names,compare_at_price:p.compare_at>(prices.length?Math.min(...prices):p.price_minor)?p.compare_at:null,compare_at_price_max:p.compare_at>(prices.length?Math.min(...prices):p.price_minor)?p.compare_at:null,available:p.available,tags:Array.isArray(p.tags)?p.tags:[],options_with_values,featured_image:featured,featured_media:featured?{preview_image:featured}:null,images,media:images.map(i=>({preview_image:i,media_type:'image'})),metafields:{},toString:()=>p.handle};};
 const collection=slug=>{const c=collections.get(slug);if(!c)return null;const products=c.products.map(product);return {id:String(c.id),title:c.title,handle:c.slug,url:'/collections/'+c.slug,description:c.description??'',products,products_count:products.length,all_products_count:products.length,image:null,toString:()=>c.slug};};
 return {img,fileImage,collection};
}

// Collects every image and collection referenced by the sections' settings (by schema type).
export function references(sections){
 const refs={images:new Set(),collections:new Set(['all'])};
 const walk=(schema,settings)=>{for(const f of schema?.settings??[]){const v=settings?.[f.id];if(v==null||v==='')continue;if(f.type==='image_picker'&&isImageRef(v))refs.images.add(String(v));else if(f.type==='collection')refs.collections.add(String(v));}};
 for(const s of sections){const schema=SECTION_SCHEMAS[s.type];walk(schema,s.settings);for(const b of Object.values(s.blocks??{}))walk(blockSchema(s.type,b.type),b.settings);}
 return refs;
}
const blockSchema=(sectionType,type)=>SECTION_SCHEMAS[sectionType]?.blocks?.find(b=>b.type===type)??BLOCK_SCHEMAS[type];

// Shopify fills unset settings with their schema defaults and turns ids into objects.
function resolveSettings(schema,values,ctx){
 const out={};
 for(const f of schema?.settings??[]){
  if(!f.id)continue;let v=values?.[f.id];if(v===undefined)v=f.default;
  if(f.type==='image_picker')v=v?ctx.img(v):null;
  else if(f.type==='collection')v=v?ctx.collection(String(v)):null;
  else if(f.type==='video')v=video(v);
  else if(f.type==='url'||f.type==='link_list')v=link(v);
  else if(f.type==='metaobject')v=f.metaobject_type==='outlet'?outlet(v,ctx):null;
  else if(f.type==='video_url')v=videoUrl(v);
  else if(f.type==='product')v=null;
  out[f.id]=v;
 }
 for(const [k,v] of Object.entries(values??{}))if(!(k in out))out[k]=v;
 return out;
}

class FormTag extends Tag{
 constructor(token,remain,liquid,parser){super(token,remain,liquid);this.kind=token.args.match(/^\s*['"]([\w_]+)['"]/)?.[1]??'form';this.attrs=[...token.args.matchAll(/(\w+):\s*['"]([^'"]*)['"]/g)].map(m=>[m[1],m[2]]);this.tpls=[];const s=parser.parseStream(remain).on('tag:endform',()=>s.stop()).on('template',t=>this.tpls.push(t)).on('end',()=>{throw new Error('form not closed');});s.start();}
 *render(ctx,emitter){
  const action={contact:'/api/v3/storefront/contact',customer:'/api/v3/storefront/newsletter'}[this.kind]??'#';
  const attrs=this.attrs.map(([k,v])=>` ${esc(k)}="${esc(v)}"`).join('');
  emitter.write(`<form method="post" action="${action}" data-lq-form="${esc(this.kind)}"${attrs}><input type="hidden" name="form_type" value="${esc(this.kind)}">`);
  ctx.push({form:{'posted_successfully?':false,errors:null,email:'',body:''}});yield this.liquid.renderer.renderTemplates(this.tpls,ctx,emitter);ctx.pop();emitter.write('</form>');
 }
}
class PassTag extends Tag{ // {% paginate %}, {% javascript %}, {% stylesheet %}: render the body as is.
 constructor(token,remain,liquid,parser){super(token,remain,liquid);this.end='end'+token.name;this.tpls=[];const s=parser.parseStream(remain).on('tag:'+this.end,()=>s.stop()).on('template',t=>this.tpls.push(t)).on('end',()=>{throw new Error(token.name+' not closed');});s.start();this.name=token.name;}
 *render(ctx,emitter){if(this.name==='javascript'){emitter.write('<script>');yield this.liquid.renderer.renderTemplates(this.tpls,ctx,emitter);emitter.write('</script>');}else if(this.name==='stylesheet'){emitter.write('<style>');yield this.liquid.renderer.renderTemplates(this.tpls,ctx,emitter);emitter.write('</style>');}else yield this.liquid.renderer.renderTemplates(this.tpls,ctx,emitter);}
}
class ContentForTag extends Tag{ // {% content_for 'blocks' %}: theme blocks of the current section.
 *render(ctx,emitter){const section=ctx.getSync(['section']);for(const b of section?.blocks??[]){const src=BLOCKS[b.type];if(!src)continue;ctx.push({block:b});emitter.write(yield this.liquid.parseAndRender(src,ctx.getAll?ctx.getAll():{...ctx.environments,block:b,section}));ctx.pop();}}
}

let engine;
function liquid(){
 if(engine)return engine;
 engine=new Liquid({templates:SNIPPETS,strictFilters:false,strictVariables:false,ownPropertyOnly:false});
 engine.registerTag('form',FormTag);for(const t of ['paginate','javascript','stylesheet'])engine.registerTag(t,PassTag);engine.registerTag('content_for',ContentForTag);
 engine.registerTag('section',class extends Tag{render(){return '';}});
 const widthArg=args=>{for(const a of args)if(Array.isArray(a)&&a[0]==='width')return a[1];return undefined;};
 const imgUrl=(v,...args)=>{if(v==null||v==='')return '';if(typeof v!=='object')return String(v);const w=widthArg(args);return v._public&&w?publicMediaUrl(v.id,w):v.src;};
 engine.registerFilter('image_url',imgUrl);engine.registerFilter('img_url',(v,size)=>imgUrl(v,...(typeof size==='string'&&/^\d+x/.test(size)?[['width',Number(size.split('x')[0])]]:[])));engine.registerFilter('file_url',v=>imgUrl(v));
 engine.registerFilter('image_tag',function(v,...args){const o=Object.fromEntries(args.filter(Array.isArray));const src=imgUrl(v,...args);if(!src)return '';
  const pub=typeof v==='object'&&v?._public;
  const attrs={src,srcset:pub?v._srcset:undefined,alt:o.alt??(typeof v==='object'?v.alt:''),loading:o.loading,width:o.width??(typeof v==='object'?v.width:undefined),height:o.height??(typeof v==='object'?v.height:undefined),class:o.class,sizes:o.sizes??(pub?'(min-width: 990px) 50vw, 100vw':undefined)};
  return '<img'+Object.entries(attrs).filter(([,x])=>x!=null&&x!=='').map(([k,x])=>` ${k}="${esc(x)}"`).join('')+'>';});
 engine.registerFilter('placeholder_svg_tag',(name,cls)=>`<svg class="${esc(cls??'placeholder-svg')}" viewBox="0 0 4 3" aria-hidden="true"><rect width="4" height="3" fill="#e7e1d3"/></svg>`);
 engine.registerFilter('video_tag',function(v,...args){if(!v?.sources?.length)return '';const o=Object.fromEntries(args.filter(Array.isArray));
  const flags=['autoplay','muted','loop','playsinline','controls'].filter(k=>o[k]===true).join(' ');const attrs=['preload','class'].filter(k=>o[k]).map(k=>` ${k}="${esc(o[k])}"`).join('');
  return `<video ${flags}${attrs} poster="${esc(v.preview_image?.src??'')}">${v.sources.map(s=>`<source src="${esc(s.url)}" type="${esc(s.mime_type)}">`).join('')}<img src="${esc(v.preview_image?.src??'')}" alt=""></video>`;});
 engine.registerFilter('asset_url',name=>'/theme-assets/shopify/'+String(name));
 engine.registerFilter('stylesheet_tag',url=>`<link rel="stylesheet" href="${esc(url)}">`);engine.registerFilter('script_tag',url=>`<script src="${esc(url)}"></script>`);
 engine.registerFilter('money',money);engine.registerFilter('money_with_currency',c=>money(c)+' MYR');engine.registerFilter('money_without_trailing_zeros',c=>money(c).replace(/\.00$/,''));engine.registerFilter('money_without_currency',c=>money(c).slice(2));
 engine.registerFilter('t',(key,...args)=>{const v=String(key).split('.').reduce((o,k)=>o?.[k],LOCALE);const o=Object.fromEntries(args.filter(Array.isArray));return typeof v==='string'?v.replace(/\{\{\s*(\w+)\s*\}\}/g,(m,k)=>o[k]??''):String(key).split('.').pop().replace(/_/g,' ');});
 const handleize=s=>String(s??'').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g,'').trim().replace(/[\s_-]+/g,'-').replace(/^-|-$/g,'');
 engine.registerFilter('handleize',handleize);engine.registerFilter('handle',handleize);
 engine.registerFilter('url_param_escape',s=>encodeURIComponent(String(s??'')));
 engine.registerFilter('default_errors',()=> '');engine.registerFilter('link_to',(text,url)=>`<a href="${esc(url)}">${text}</a>`);
 engine.registerFilter('within',url=>url);engine.registerFilter('color_to_rgb',c=>c);engine.registerFilter('color_modify',c=>c);
 return engine;
}

const PAGE_GLOBALS=page=>({
 settings:SETTINGS,shop:{name:'Jack Studio',url:'',metaobjects:{outlet:{values:OUTLETS.map(o=>({...Object.fromEntries(Object.entries(o).map(([k,v])=>[k,{value:v}]))}))}}},
 routes:{root_url:'/',cart_url:'/cart',cart_add_url:'/cart',collections_url:'/pages/product-collection',all_products_collection_url:'/collections/all',search_url:'/search',account_url:'/account',account_login_url:'/account/login'},
 request:{locale:{iso_code:'en'},page_type:page.handle==='home'?'index':'page',design_mode:false,path:page.handle==='home'?'/':'/pages/'+page.handle,host:''},template:{name:page.handle==='home'?'index':'page',suffix:page.handle==='home'?null:page.handle},
 page:{title:page.title,content:page.content??'',handle:page.handle,url:'/pages/'+page.handle},cart:{item_count:0,items:[]},customer:null,
});

// Renders one template ({title, content, order, sections}) for /pages/<handle>. Returns html and scripts.
export async function renderPage(db,handle,template,options={}){
 const list=(template.order??[]).map(id=>({id,...template.sections[id]})).filter(s=>s&&!s.disabled&&SECTIONS[s.type]!=null);
 const ctx=await loadContext(db,references(list),options);
 const outlets=OUTLETS.map(o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,{value:k==='photo'&&v?ctx.fileImage(v):v}])));
 const globals={...PAGE_GLOBALS({...template,handle}),images:new Proxy({},{get:(t,name)=>typeof name==='string'?ctx.fileImage(name):undefined}),collections:new Proxy({},{get:(t,h)=>typeof h==='string'?ctx.collection(h):undefined})};
 globals.shop.metaobjects.outlet.values=outlets;
 let html='';const scripts=[];
 for(const s of list){
  const schema=SECTION_SCHEMAS[s.type];
  const blocks=(s.block_order??Object.keys(s.blocks??{})).map(id=>({id,...s.blocks[id]})).filter(b=>b.type&&!b.disabled).map(b=>({id:b.id,type:b.type,settings:resolveSettings(blockSchema(s.type,b.type),b.settings,ctx),shopify_attributes:''}));
  const section={id:s.id,settings:resolveSettings(schema,s.settings,ctx),blocks,index:list.indexOf(s)+1};
  let out;try{out=await liquid().parseAndRender(SECTIONS[s.type],{...globals,section});}
  catch(e){out=`<!-- section ${esc(s.type)} failed to render -->`;if(options.strict)throw e;}
  const split=extract(out,s.id);scripts.push(...split.scripts);
  html+=`<div id="shopify-section-${esc(s.id)}" class="shopify-section" data-section-type="${esc(s.type)}">${split.html}</div>`;
 }
 return {html,scripts};
}

// Moves inline scripts out of the markup and turns inline event attributes into data attributes.
export function extract(html,id){
 const scripts=[];
 html=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi,(m,attrs,body)=>{if(/type=["']?application\/(ld\+)?json/i.test(attrs))return m;if(/\bsrc=/i.test(attrs))return '';if(body.trim())scripts.push({id,code:body});return '';});
 // Decorative images in the original theme have no alt text; screen readers should skip them.
 html=html.replace(/<img(?![^>]*\salt=)/gi,'<img alt=""');
 html=html.replace(/\son(click|change|input|submit)\s*=\s*"([^"]*)"/gi,(m,ev,code)=>` data-lq-on-${ev.toLowerCase()}="${code}"`);
 return {html,scripts};
}
// One same-site script file: each section's code runs in its own scope, so one failure cannot stop the rest.
// Sections are inserted after the page has loaded, so "DOMContentLoaded"/"load" listeners run right away.
// Each section's code runs in its own block (function declarations stay global, as in Shopify).
const PRELUDE="(function(){var d=document,w=window,da=d.addEventListener,wa=w.addEventListener;d.addEventListener=function(t,f,o){if(t==='DOMContentLoaded'&&d.readyState!=='loading'){setTimeout(f,0);return;}return da.call(d,t,f,o);};w.addEventListener=function(t,f,o){if(t==='load'&&d.readyState==='complete'){setTimeout(f,0);return;}return wa.call(w,t,f,o);};w.__lqRestore=function(){d.addEventListener=da;w.addEventListener=wa;};})();\n";
export const scriptBundle=scripts=>PRELUDE+scripts.map(s=>`try{\n${s.code}\n}catch(e){console.error('section ${String(s.id).replace(/[^\w-]/g,'')}',e);}`).join('\n')+'\nsetTimeout(function(){window.__lqRestore&&window.__lqRestore();},0);\n';
