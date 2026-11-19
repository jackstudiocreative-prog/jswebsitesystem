// DOM text APIs deliberately avoid interpolating catalogue content as HTML.
import {richText} from '../web/rich-text.mjs';
import {CHARSETS} from '../shared/personalization.mjs';
import {createWebsite} from './website-ui.mjs';
import {createThemes} from './theme-ui.mjs';
import {moneyToMinor,formatPrice} from './money.mjs';
import {createOrders} from './orders-ui.mjs';
import {createOps} from './ops-ui.mjs';
import {createCustomers} from './customers-ui.mjs';
export {moneyToMinor,formatPrice};
// Page titles, where each page sits in the navigation, and what it is for (one line, no marketing copy).
const PAGES={
 Dashboard:{title:'Dashboard',about:'What needs your attention today.'},
 Orders:{title:'Orders',about:'Payments, shipping, cancellations and refunds for every order.'},
 Products:{title:'Products',about:'Everything you sell. Customers see a product when it is Active and in at least one active collection.'},
 Collections:{title:'Collections',parent:'Products',about:'Groups of products. Active collections appear in the store; their product order is the “Featured” sort.'},
 Inventory:{title:'Inventory',parent:'Products',about:'Stock for every variant. Each change is recorded with a reason.'},
 Customers:{title:'Customers',about:'Customers imported from Shopify and people who ordered here. Staff records, not shopper accounts.'},
 Discounts:{title:'Discounts',about:'Discount codes and automatic discounts. Amounts are always worked out on the server.'},
 Analytics:{title:'Analytics',about:'Sales, refunds, best sellers and stock for a date range, in Malaysia time.'},
 'Media Library':{title:'Media',about:'Product and page images. Originals stay private; the store shows resized copies of published images only.'},
 Website:{title:'Themes',parent:'Online Store',about:'How the whole store looks: header, footer, home page and the templates for products, collections and pages. Customers only see the published theme.'},
 Pages:{title:'Pages',parent:'Online Store',about:'Standalone content such as About us or policies. Pages are shown inside the published theme’s header and footer.'},
 Settings:{title:'Settings',about:'Shipping rates, payments, customer emails and store details.'}
};
export function mountAdmin(api,role,notify,account={}){
 const root=document.getElementById('admin-content'),upload=document.getElementById('media-upload');
 let view='Dashboard',offset=0,search='',status='',collection='',inventoryFilter='',listed='',sort='',generation=0,dirty=false;
 const readOnly=role==='viewer';
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,fn,disabled=false)=>{const n=el('button',text);n.type='button';n.disabled=disabled;n.addEventListener('click',async()=>{n.disabled=true;try{await fn();}catch(e){notify(e.message);}finally{n.disabled=disabled;}});return n;};
 // Shopify image import. Runs in small batches while this tab stays open (also on other views);
 // finished images are skipped on re-runs, so stopping and starting again is safe.
 const importer={running:false,stop:false,done:0,total:0,failed:[],line:null};
 const importLine=()=>{const i=importer;return i.running?`Importing… ${i.done}/${i.total} Shopify images in the library${i.failed.length?` · ${i.failed.length} failed`:''}`:`${i.done}/${i.total} Shopify images in the library${i.failed.length?` · ${i.failed.length} could not be imported`:''}`;};
 async function runImport(){
  const i=importer;if(i.running)return;i.running=true;i.stop=false;i.failed=[];
  try{
   const s=await api('media/import');i.done=s.imported;i.total=s.total;
   for(let at=0;at<s.pending.length&&!i.stop;at+=s.batch){
    const r=await api('media/import',{paths:s.pending.slice(at,at+s.batch)},'POST');
    for(const item of r.items){if(item.status==='failed')i.failed.push(item);else i.done++;}
    if(i.line?.isConnected)i.line.textContent=importLine();
   }
   notify(i.stop?'Shopify import paused. Start it again to continue.':i.failed.length?`Shopify import finished. ${i.failed.length} images could not be imported (see the list in the Media Library).`:'Shopify import finished. All images are in the Media Library.');
  }finally{i.running=false;if(view==='Media Library')navigate('Media Library');}
 }
 // Shopify catalogue import: collections, then products page by page (with their images), then which
 // products belong to each collection. Safe to run again: it updates instead of duplicating.
 const catalogRun={running:false,stop:false,line:null,failed:[],counts:{imported:0,updated:0}};
 async function runCatalog(){
  const c=catalogRun;if(c.running)return;c.running=true;c.stop=false;c.failed=[];c.counts={imported:0,updated:0};
  const say=t=>{if(c.line?.isConnected)c.line.textContent=t;};
  try{
   say('Importing collections…');const cols=await api('catalog/import',{step:'collections'},'POST');c.failed.push(...cols.items.filter(i=>i.status==='failed'));
   // One request at a time; a request that fails is tried once more before it is reported.
   const call=async body=>{try{return await api('catalog/import',body,'POST');}catch{await new Promise(r=>setTimeout(r,1500));return api('catalog/import',body,'POST');}};
   let failedPages=0;
   for(let page=1;!c.stop;page++){
    const skip=[];for(let n=0;n<40&&!c.stop;n++){let im;try{im=await call({step:'images',page,skip});}catch(e){c.failed.push({handle:`images of page ${page}`,error:e.message});break;}for(const f of im.failed){c.failed.push(f);skip.push(f.handle);}say(`Importing images of products page ${page}…`);if(im.retry)continue;if(!im.remaining||!im.imported&&!im.failed.length)break;}
    // A page can take several requests: the server stops before the time limit and returns next_offset.
    let r,offset=0;
    do{
     try{r=await call({step:'products',page,offset});}catch(e){c.failed.push({handle:`products page ${page}`,error:e.message});r=null;break;}
     for(const i of r.items){if(i.status==='failed'||i.status==='skipped')c.failed.push(i);else c.counts[i.status]++;}
     say(`Importing products… ${c.counts.imported} new · ${c.counts.updated} updated${c.failed.length?` · ${c.failed.length} not imported`:''}`);
     offset=r.next_offset;
    }while(offset!=null&&!c.stop);
    // A page that failed twice is reported and the import moves on; running it again fills the gap.
    failedPages=r?0:failedPages+1;
    if(r?.done||failedPages>=3||page>=200)break;
   }
   for(const handle of cols.handles){if(c.stop)break;say(`Linking products to collection ${handle}…`);try{await call({step:'memberships',handle});}catch(e){c.failed.push({handle,error:e.message});}}
   notify(c.stop?'Catalogue import paused. Start it again to continue.':`Catalogue import finished: ${c.counts.imported} new and ${c.counts.updated} updated products${c.failed.length?`, ${c.failed.length} not imported`:''}.`);
  }finally{c.running=false;if(view==='Products')navigate('Products');}
 }
 function catalogCard(){
  const box=el('section',undefined,'card shopify-import');box.append(el('h2','Import from Shopify'),el('p','Copies the published products of jackstudio.com.my (with variants, prices, tags and images) and its collections into this catalogue. Stock is taken from Shopify on 16 Nov 2026 for new variants only. Running it again updates existing products.','muted'));
  catalogRun.line=el('p',catalogRun.running?'Importing…':'','shopify-import-status');catalogRun.line.setAttribute('role','status');box.append(catalogRun.line);
  const stop=button('Pause',()=>{catalogRun.stop=true;stop.textContent='Pausing…';},true);stop.disabled=readOnly||!catalogRun.running;
  const start=button(catalogRun.running?'Importing…':'Import products from Shopify',async()=>{const run=runCatalog();start.textContent='Importing…';stop.disabled=false;await run;},readOnly||catalogRun.running);start.classList.add('primary');
  const report=el('div',undefined,'catalog-check');
  const check=button('Check against Shopify',async()=>{report.replaceChildren(el('p','Comparing every product with jackstudio.com.my…','muted'));const r=await api('catalog/import',{step:'verify'},'POST');
   const ok=r.matched===r.shopify&&!r.issues.length;
   report.replaceChildren(el('p',`${r.matched} of ${r.shopify} Shopify products match exactly in V3${r.extra.length?` · ${r.extra.length} active V3 products are not in Shopify`:''}.`,ok?'':'muted'));
   const t=el('ul');for(const c of r.collections)t.append(el('li',`${c.handle}: Shopify ${c.shopify} products, V3 ${c.v3??'missing'}`));const d1=el('details');d1.append(el('summary','Collections'),t);report.append(d1);
   if(r.issues.length){const d=el('details');d.open=true;d.append(el('summary',`${r.issues.length} differences`));const ul=el('ul');for(const i of r.issues)ul.append(el('li',`${i.handle} — ${i.problem}`));d.append(ul);report.append(d);}
   if(r.extra.length){const d=el('details');d.append(el('summary','In V3 but not in Shopify'));const ul=el('ul');for(const h of r.extra.slice(0,100))ul.append(el('li',h));d.append(ul);report.append(d);}
  });
  const actions=el('div',undefined,'actions');actions.append(start,stop,check);box.append(actions,report);
  if(catalogRun.failed.length){const d=el('details');d.append(el('summary',`${catalogRun.failed.length} products or collections were not imported`));const ul=el('ul');for(const f of catalogRun.failed.slice(0,60))ul.append(el('li',`${f.handle} — ${f.error}`));d.append(ul);box.append(d);}
  return box;
 }
 function importCard(){
  const box=el('section',undefined,'card shopify-import');box.append(el('h2','Import from Shopify'),el('p','Copies the Shopify image library (product, collection and theme images) into this private media library. Theme image slots fill automatically from these images.','muted'));
  importer.line=el('p',importer.total?importLine():'Checking what is left to import…','shopify-import-status');importer.line.setAttribute('role','status');box.append(importer.line);
  const stop=button('Pause',()=>{importer.stop=true;stop.textContent='Pausing…';},true);stop.disabled=readOnly||!importer.running;
  const start=button(importer.running?'Importing…':'Import from Shopify',async()=>{const run=runImport();start.textContent='Importing…';stop.disabled=false;importer.line.textContent=importLine();await run;},readOnly||importer.running);start.classList.add('primary');const actions=el('div',undefined,'actions');actions.append(start,stop);box.append(actions);
  if(!importer.running)api('media/import').then(s=>{importer.done=s.imported;importer.total=s.total;if(importer.line.isConnected)importer.line.textContent=importLine();if(!s.pending.length){start.textContent='All Shopify images imported';start.disabled=true;}}).catch(e=>{importer.line.textContent='Import status unavailable: '+e.message;});
  if(importer.failed.length){const d=el('details');d.append(el('summary',`${importer.failed.length} images could not be imported`));const ul=el('ul');for(const f of importer.failed.slice(0,50))ul.append(el('li',`${f.path.split('/').pop()} — ${f.error}`));d.append(ul);box.append(d);}
  return box;
 }
 const field=(label,value='',type='text')=>{const wrap=el('label',label),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.value=value??'';wrap.append(input);return {wrap,input};};
 const select=(values,current)=>{const n=el('select');for(const [value,label] of values){const o=el('option',label);o.value=value;n.append(o);}n.value=current;return n;};
 const all=async resource=>{let rows=[],n=0;do{const page=await api(`${resource}?paged=true&limit=100&offset=${n}`);rows.push(...page.items);n+=page.items.length;if(n>=page.total||!page.items.length)return rows;}while(true);};
 // Every page: breadcrumb, title, one-line purpose, and the page's main action on the right.
 function header(title,description,primary){root.replaceChildren();const info=PAGES[title]??{title,about:description};const h=el('div',undefined,'page-heading'),copy=el('div');
  if(info.parent){const crumb=el('p',undefined,'breadcrumb');crumb.append(el('span',info.parent),el('span',' / ','crumb-sep'),el('span',info.title));copy.append(crumb);}
  const t=el('h1',info.title);copy.append(t,el('p',info.about??description,'muted'));h.append(copy);
  const actions=el('div',undefined,'page-actions');if(readOnly)actions.append(el('span','Read only','badge read-only-badge'));if(primary)actions.append(primary);h.append(actions);root.append(h);return h;}
 function empty(text,action){const box=el('div',undefined,'empty-state');box.append(el('p',text));if(action)box.append(action);root.append(box);}
 function table(headings){const box=el('div',undefined,'table-wrap'),t=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');for(const text of headings)tr.append(el('th',text));head.append(tr);t.append(head,body);box.append(t);root.append(box);return body;}
 function cell(tr,text){tr.append(el('td',text));}
 function badge(tr,text){const td=el('td');td.append(el('span',text,'badge '+text));tr.append(td);}
 const REASONS=[['received','Stock received'],['stocktake','Stocktake count'],['correction','Correction'],['damaged','Damaged'],['returned','Returned'],['transfer','Transfer'],['other','Other (note required)']];
 const STOCK={in:'In stock',low:'Low stock',out:'Out of stock',inactive:'Inactive'};
 const stockBadge=status=>el('span',STOCK[status]??status,'badge stock-'+status);
 const variantName=(names,values)=>values?.length?values.join(' / '):'Default';
 const when=value=>new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 // One preview request per batch of images; URLs are private, signed and expire after five minutes.
 async function previews(entries){
  const ids=[...new Set(entries.map(e=>String(e.id)))];if(!ids.length)return;
  let data;try{data=await api('media/previews?ids='+ids.join(','));}catch{data={items:[]};}
  const urls=new Map(data.items.filter(x=>{try{const u=new URL(x.url);return u.protocol==='https:'&&u.hostname==='api.cloudinary.com';}catch{return false;}}).map(x=>[x.id,x.url]));
  for(const e of entries){if(urls.has(String(e.id)))e.img.src=urls.get(String(e.id));else e.img.replaceWith(el('span','Preview unavailable','muted'));}
 }
 function thumb(alt){const img=el('img');img.alt=alt||'Product media';img.loading='lazy';img.referrerPolicy='no-referrer';return img;}
 // Inline stock adjustment form. Counted quantities send the quantity shown so stale counts are rejected.
 function adjustPanel(variant,title,done){
  const form=el('form',undefined,'card adjust-panel'),mode=select([['add','Add stock'],['remove','Remove stock'],['set','Set counted quantity']],'add'),reason=select(REASONS,'received');
  const modeLabel=el('label','Adjustment');modeLabel.append(mode);const reasonLabel=el('label','Reason');reasonLabel.append(reason);
  const qty=field('Quantity','','number'),note=field('Note (optional)','');qty.input.min=0;qty.input.step=1;qty.input.required=true;note.input.maxLength=500;
  const save=el('button','Apply adjustment','primary');save.type='submit';
  form.setAttribute('aria-label','Adjust stock for '+title);
  form.append(el('h2','Adjust stock'),el('p',`${title} · Current stock ${variant.inventory}`,'muted'),modeLabel,qty.wrap,reasonLabel,note.wrap);
  const actions=el('div',undefined,'actions');actions.append(save,button('Cancel',()=>{form.remove();}));form.append(actions);
  form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{
   const n=Number(qty.input.value);if(!Number.isInteger(n)||n<0||qty.input.value==='')throw Error('Enter a whole-number quantity.');
   const body={variant_id:String(variant.id),reason:reason.value,note:note.input.value};
   if(mode.value==='set'){body.set_to=n;body.expected=variant.inventory;}else{if(!n)throw Error('Enter a quantity above zero.');body.delta=mode.value==='add'?n:-n;}
   const result=await api('inventory/adjustments',body,'POST');form.remove();notify(`Stock updated: ${title} now ${result.variant.inventory}.`);await done(result.variant);
  }catch(err){notify(err.message);}finally{save.disabled=false;}});
  setTimeout(()=>qty.input.focus?.(),0);return form;
 }
 function historyCard(params,names){
  const box=el('section',undefined,'card');let at=0;
  async function load(){
   const data=await api('inventory/adjustments?'+new URLSearchParams({...params,paged:'true',limit:'10',offset:String(at)}));
   box.replaceChildren(el('h2','Inventory history'));
   if(!data.items.length){box.append(el('p','No stock changes recorded yet.','muted'));return;}
   const wrap=el('div',undefined,'table-wrap'),t=el('table'),head=el('tr'),body=el('tbody');
   for(const h of ['Date','Product','Variant','Change','Stock after','Reason','Staff'])head.append(el('th',h));
   const thead=el('thead');thead.append(head);t.append(thead,body);wrap.append(t);box.append(wrap);
   for(const a of data.items){const tr=el('tr');cell(tr,when(a.created_at));cell(tr,a.product_title);cell(tr,variantName(names??a.option_names,a.option_values));cell(tr,(a.delta>0?'+':'')+a.delta);cell(tr,String(a.quantity_after));
    const reason=el('td',(REASONS.find(([k])=>k===a.reason)?.[1]??(a.reason==='initial'?'Opening stock':a.reason==='migration'?'Migrated balance':a.reason)));if(a.note)reason.append(el('small',a.note,'cell-note'));tr.append(reason);
    cell(tr,a.actor?`${a.actor_role??'staff'} · ${a.actor.slice(0,8)}`:'System');body.append(tr);}
   const pages=el('div',undefined,'pagination');pages.append(button('Newer',()=>{at=Math.max(0,at-10);return load();},at===0),button('Older',()=>{at+=10;return load();},at+data.items.length>=data.total));box.append(pages);
  }
  return {box,load};
 }
 // Searchable, filtered, paged library picker. Only one page of records and previews is loaded at a time.
 function mediaPicker(taken,room,onAdd){
  const box=el('section',undefined,'card media-picker'),chosen=new Map();let at=0,q='',format='',usage='';const size=12;
  box.setAttribute('role','region');box.setAttribute('aria-label','Choose images from the media library');
  const tools=el('form',undefined,'toolbar'),search=field('Search images','','search'),formatSel=select([['','All formats'],['jpg','JPEG'],['png','PNG'],['webp','WebP']],''),usageSel=select([['','All images'],['unused','Not used by any product'],['linked','Used by a product']],'');
  formatSel.setAttribute('aria-label','Filter by format');usageSel.setAttribute('aria-label','Filter by usage');tools.append(search.wrap,formatSel,usageSel,el('button','Search'));
  const status=el('p','','muted'),grid=el('div',undefined,'picker-grid'),pages=el('div',undefined,'pagination'),footer=el('div',undefined,'actions');
  const add=el('button','Add selected','primary');add.type='button';
  add.addEventListener('click',()=>{if(!chosen.size)return notify('Select at least one image.');onAdd([...chosen.values()]);box.remove();});
  footer.append(add,button('Cancel',()=>{box.remove();}));
  box.append(el('h2','Choose from media library'),el('p',`Verified images only · up to ${room} more for this product.`,'muted'),tools,status,grid,pages,footer);
  const count=()=>{add.textContent=chosen.size?`Add selected (${chosen.size})`:'Add selected';};
  async function load(){
   const params=new URLSearchParams({paged:'true',limit:String(size),offset:String(at),status:'ready'});if(q)params.set('q',q);if(format)params.set('format',format);if(usage)params.set('usage',usage);
   const data=await api('media?'+params);grid.replaceChildren();pages.replaceChildren();
   status.textContent=data.total?`${data.total} images · Showing ${at+1}–${at+data.items.length}`:'No images match. Upload images in the Media Library.';
   const shots=[];
   for(const m of data.items){
    const id=String(m.id),card=el('label',undefined,'picker-item'),input=el('input'),img=thumb(m.label);input.type='checkbox';
    input.checked=chosen.has(id);input.disabled=taken.includes(id);
    input.addEventListener('change',()=>{if(input.checked){if(chosen.size>=room){input.checked=false;return notify(`This product can take ${room} more image${room===1?'':'s'}.`);}chosen.set(id,{media_id:id,alt:'',label:m.label});}else chosen.delete(id);count();});
    card.append(input,img,el('span',m.label||m.object_key.split('/').pop(),'picker-name'),el('small',taken.includes(id)?'Already added':`${m.width??'?'} × ${m.height??'?'} · ${String(m.format??'').toUpperCase()}`));
    grid.append(card);shots.push({id,img});
   }
   pages.append(button('Previous',()=>{at=Math.max(0,at-size);return load();},at===0),button('Next',()=>{at+=size;return load();},at+data.items.length>=data.total));
   await previews(shots);
  }
  tools.addEventListener('submit',e=>{e.preventDefault();q=search.input.value.trim();format=formatSel.value;usage=usageSel.value;at=0;load().catch(err=>notify(err.message));});
  return {box,load,focus:()=>search.input.focus?.()};
 }
 async function editProduct(key,initialCollection){
  const ticket=++generation;upload.hidden=true;const [record,collections]=await Promise.all([key?api('products/'+key):Promise.resolve({title:'',description:'',price_minor:0,sku:'',inventory:0,status:'draft',collection_ids:initialCollection?[String(initialCollection)]:[],media:[],option_names:[],variants:[],featured_media_id:null}),all('collections')]);
  if(ticket!==generation)return;header(key?'Edit product':'New product','MYR pricing · Stock changes and checkout reservations are recorded in inventory history.');
  const form=el('form',undefined,'editor-grid'),details=el('section',undefined,'card'),aside=el('section',undefined,'card');root.append(form);form.append(details,aside);
  const title=field('Title',record.title),handle=field('URL handle (blank generates from title)',record.handle),description=field('Description',record.description,'textarea');
  title.input.required=true;title.input.maxLength=150;description.input.rows=7;
  for(const f of [title,handle,description])details.append(f.wrap);
  // How the description looks to customers (same safe rendering as the storefront).
  const descPreview=el('details',undefined,'description-preview');const descBody=el('div',undefined,'js-rich');descPreview.append(el('summary','Preview description as customers see it'),descBody);
  const drawPreview=()=>{descBody.replaceChildren(richText(description.input.value));};descPreview.addEventListener('toggle',()=>{if(descPreview.open)drawPreview();});description.input.addEventListener('input',()=>{if(descPreview.open)drawPreview();});details.append(descPreview);
  const state=select(['draft','active','archived'].map(x=>[x,x]),record.status),stateLabel=el('label','Status');stateLabel.append(state);aside.append(stateLabel,el('h2','Collections'));
  const choices=[];for(const c of collections){const f=field(c.title,'','checkbox');f.input.checked=record.collection_ids.includes(String(c.id));choices.push([c.id,f.input]);aside.append(f.wrap);}
  if(!collections.length)aside.append(el('p','Create a collection first. Products can belong to several collections.','muted'));
  const shipProfile=select([['general','General (RM5, free from RM49)'],['luggage','Luggage (RM26.90, 1–50 kg)']],record.shipping_profile??'general'),shipLabel=el('label','Shipping profile');shipLabel.append(shipProfile);
  const weight=field('Weight (kg, per item)',((record.weight_grams??0)/1000).toString(),'number');weight.input.min=0;weight.input.step=0.01;weight.input.max=100;
  aside.append(el('h2','Shipping'),shipLabel,weight.wrap,el('p','Luggage shipping needs a weight between 1 and 50 kg per order.','muted'));
  // Engraving: customers enter the text on the product page; it travels with the bag line to the order.
  const pz=record.personalization??null,pzAvailable=record.personalization!==undefined||!key;
  const pzOn=field('Offer engraving','', 'checkbox'),pzReq=field('Engraving is required','', 'checkbox'),pzLabel=field('Name shown to customers',pz?.label??'Engraving'),pzMax=field('Maximum characters',String(pz?.max_length??5),'number'),pzHelp=field('Note for customers (optional)',pz?.help??'');
  pzOn.input.checked=!!pz?.enabled;pzReq.input.checked=!!pz?.required;pzMax.input.min=1;pzMax.input.max=40;pzLabel.input.maxLength=40;pzHelp.input.maxLength=200;
  const pzRule=select(Object.entries(CHARSETS).map(([k,v])=>[k,v.label]),pz?.charset??'upper_alnum'),pzRuleLabel=el('label','Allowed characters');pzRuleLabel.append(pzRule);
  const pzVariants=(record.variants??[]).filter(v=>v.id&&(record.option_names??[]).length).map(v=>{const f=field(variantName(record.option_names,v.option_values),'','checkbox');f.input.checked=!!pz?.variant_ids?.includes(String(v.id));return [String(v.id),f];});
  const pzBox=el('div',undefined,'engraving-settings');pzBox.append(pzReq.wrap,pzLabel.wrap,pzMax.wrap,pzRuleLabel,pzHelp.wrap);
  if(pzVariants.length){pzBox.append(el('p','Only for these variants (none ticked = all variants):','muted'));for(const [,f] of pzVariants)pzBox.append(f.wrap);}
  const pzSync=()=>{pzBox.hidden=!pzOn.input.checked;};pzOn.input.addEventListener('change',pzSync);pzSync();
  aside.append(el('h2','Engraving'),pzOn.wrap,pzBox,el('p','Engraving does not change the price. It appears in the bag, checkout, order and packing list.','muted'));
  if(!pzAvailable){for(const n of [pzOn.input,pzReq.input,pzLabel.input,pzMax.input,pzHelp.input,pzRule])n.disabled=true;aside.append(el('p','Engraving settings need database migration 011 on this environment.','muted'));}
  const pzValue=()=>pzOn.input.checked?{enabled:true,required:pzReq.input.checked,label:pzLabel.input.value,max_length:Number(pzMax.input.value),charset:pzRule.value,help:pzHelp.input.value,variant_ids:pzVariants.filter(([,f])=>f.input.checked).map(([id])=>id)}:null;
  // Pricing & variants. Without options a product keeps one default variant (simple price/SKU/stock form).
  const variants=record.variants??[],simpleVariant=variants[0];
  let options=[...(record.option_names??[])];
  let rows=variants.map(v=>({id:v.id,option_values:[...v.option_values],sku:v.sku??'',price:(v.price_minor/100).toFixed(2),active:v.active,media_id:v.media_id,inventory:v.inventory,stock_status:v.stock_status}));
  const pricing=el('section',undefined,'pricing');details.append(el('h2','Pricing & inventory'),pricing);
  const simple={price:field('Price (MYR)',(record.price_minor/100).toFixed(2)),sku:field('SKU (unique, optional for drafts)',record.sku),inventory:field(key?'Inventory (change with Adjust stock)':'Inventory',record.inventory,'number')};
  simple.sku.input.maxLength=80;simple.inventory.input.min=0;simple.inventory.input.step=1;if(key)simple.inventory.input.readOnly=true;
  const adjustSlot=el('div');
  function syncSimpleToRow(){if(!rows.length)rows.push({option_values:[],active:true,media_id:null,inventory:Number(simple.inventory.input.value)||0});Object.assign(rows[0],{sku:simple.sku.input.value,price:simple.price.input.value});if(!rows[0].id)rows[0].inventory=Number(simple.inventory.input.value)||0;}
  function openAdjust(row,label){if(!row.id)return notify('Save the product before adjusting stock.');adjustSlot.replaceChildren(adjustPanel(row,label,async v=>{row.inventory=v.inventory;row.stock_status=v.stock_status;if(!options.length)simple.inventory.input.value=String(v.inventory);renderPricing();await history?.load();}));}
  function renderPricing(){
   pricing.replaceChildren();
   const optionBox=el('div',undefined,'option-names');optionBox.append(el('p','Add options such as Color or Size to sell variants with their own SKU, price and stock.','muted'));
   for(const [i,name] of options.entries()){const f=field(`Option ${i+1} name`,name);f.input.maxLength=40;f.input.addEventListener('input',()=>{options[i]=f.input.value;renderHeads();});const row=el('div',undefined,'option-row');row.append(f.wrap,button('Remove option',()=>{if(options.length===1&&rows.length>1)throw Error('Deactivate extra variants before removing the last option. Variants cannot be deleted.');options.splice(i,1);for(const r of rows)r.option_values.splice(i,1);if(!options.length&&rows[0]){simple.price.input.value=rows[0].price;simple.sku.input.value=rows[0].sku;simple.inventory.input.value=String(rows[0].inventory??0);}dirty=true;renderPricing();},readOnly));optionBox.append(row);}
   optionBox.append(button('Add option',()=>{if(options.length>=3)throw Error('Use up to 3 options.');if(!options.length)syncSimpleToRow();options.push('');for(const r of rows)r.option_values.push('');dirty=true;renderPricing();},readOnly||options.length>=3));
   pricing.append(optionBox);
   if(!options.length){
    for(const f of [simple.price,simple.sku,simple.inventory])pricing.append(f.wrap);
    if(key&&simpleVariant){const status=el('p',undefined,'stock-line');status.append(stockBadge(rows[0]?.stock_status??simpleVariant.stock_status),button('Adjust stock',()=>openAdjust(rows[0],record.title),readOnly));pricing.append(status);}
    pricing.append(adjustSlot);return;
   }
   const wrap=el('div',undefined,'table-wrap variant-table'),t=el('table'),head=el('tr'),body=el('tbody'),thead=el('thead');
   function renderHeads(){head.replaceChildren();for(const name of options)head.append(el('th',name||'Option'));for(const h of ['SKU','Price (MYR)','Stock','Image','Active','Order'])head.append(el('th',h));}
   renderHeads();thead.append(head);t.append(thead,body);wrap.append(t);
   const images=selected.map(m=>[m.media_id,m.label||('Image '+m.media_id)]);
   for(const [i,r] of rows.entries()){
    const tr=el('tr'),label=variantName(options,r.option_values)||`Variant ${i+1}`;if(!r.active)tr.className='inactive';
    const input=(value,aria,onInput,type='text')=>{const n=el('input');n.type=type;n.value=value??'';n.setAttribute('aria-label',aria);n.disabled=readOnly;n.addEventListener('input',()=>{onInput(n.value);dirty=true;});const td=el('td');td.append(n);tr.append(td);return n;};
    for(const [j,name] of options.entries())input(r.option_values[j],`${name||'Option'} for variant ${i+1}`,v=>{r.option_values[j]=v;}).maxLength=60;
    input(r.sku,`SKU for ${label}`,v=>{r.sku=v;}).maxLength=80;
    input(r.price,`Price for ${label}`,v=>{r.price=v;}).inputMode='decimal';
    const stock=el('td');
    if(r.id){stock.append(el('strong',String(r.inventory)),stockBadge(r.active?r.stock_status:'inactive'),button('Adjust',()=>openAdjust(r,`${record.title} · ${label}`),readOnly));}
    else{const n=el('input');n.type='number';n.min=0;n.step=1;n.value=String(r.inventory??0);n.setAttribute('aria-label',`Opening stock for ${label}`);n.disabled=readOnly;n.addEventListener('input',()=>{r.inventory=Number(n.value);dirty=true;});stock.append(n);}
    tr.append(stock);
    const imageTd=el('td'),img=select([['','No image'],...images],r.media_id??'');img.setAttribute('aria-label',`Image for ${label}`);img.disabled=readOnly;img.addEventListener('change',()=>{r.media_id=img.value||null;dirty=true;});imageTd.append(img);tr.append(imageTd);
    const activeTd=el('td'),active=el('input');active.type='checkbox';active.checked=r.active;active.disabled=readOnly;active.setAttribute('aria-label',`${label} is active`);active.addEventListener('change',()=>{r.active=active.checked;dirty=true;renderPricing();});activeTd.append(active);tr.append(activeTd);
    const order=el('td');order.append(button('↑',()=>{[rows[i-1],rows[i]]=[rows[i],rows[i-1]];dirty=true;renderPricing();},readOnly||i===0),button('↓',()=>{[rows[i+1],rows[i]]=[rows[i],rows[i+1]];dirty=true;renderPricing();},readOnly||i===rows.length-1));
    for(const b of order.querySelectorAll('button'))b.setAttribute('aria-label',(b.textContent==='↑'?'Move up ':'Move down ')+label);tr.append(order);body.append(tr);
   }
   pricing.append(wrap,button('Add variant',()=>{if(rows.length>=100)throw Error('Maximum 100 variants.');rows.push({option_values:options.map(()=>''),sku:'',price:rows[0]?.price??'0.00',active:true,media_id:null,inventory:0});dirty=true;renderPricing();},readOnly),el('p','Variants cannot be deleted, so stock history is kept. Deactivate a variant to stop selling it.','muted'),adjustSlot);
  }
  // Images: featured image plus ordered gallery, chosen through the paged library picker.
  details.append(el('h2','Product images'),el('p','The featured image represents the product. Gallery images follow in the order shown.','muted'));
  let selected=record.media.map(m=>({media_id:String(m.media_id),alt:m.alt,label:m.label}));let featured=record.featured_media_id?String(record.featured_media_id):selected[0]?.media_id??null;
  const picker=el('div',undefined,'image-picker'),pickerSlot=el('div');details.append(picker);
  function renderImages(){picker.replaceChildren();const shots=[];
   if(!selected.length)picker.append(el('p','No images yet. Choose images from the media library.','muted'));
   if(featured&&!selected.some(m=>m.media_id===featured))featured=selected[0]?.media_id??null;
   for(const [i,m] of selected.entries()){const box=el('div',undefined,'selected-image'+(m.media_id===featured?' featured':'')),img=thumb(m.alt||m.label);box.append(img);shots.push({id:m.media_id,img});
    box.append(el('span',m.media_id===featured?'Featured image':`Gallery ${selected.filter(x=>x.media_id!==featured).indexOf(m)+1}`,'badge'+(m.media_id===featured?' active':'')),el('small',m.label||'','picker-name'));
    const alt=field('Alt text',m.alt);alt.input.maxLength=500;alt.input.addEventListener('input',()=>{m.alt=alt.input.value;dirty=true;});
    box.append(alt.wrap,button('Set as featured',()=>{featured=m.media_id;dirty=true;renderImages();},readOnly||m.media_id===featured),button('Move up',()=>{[selected[i-1],selected[i]]=[selected[i],selected[i-1]];dirty=true;renderImages();},readOnly||i===0),button('Move down',()=>{[selected[i+1],selected[i]]=[selected[i],selected[i+1]];dirty=true;renderImages();},readOnly||i===selected.length-1),button('Remove',()=>{selected.splice(i,1);for(const r of rows)if(r.media_id===m.media_id)r.media_id=null;dirty=true;renderImages();renderPricing();},readOnly));picker.append(box);}
   previews(shots);
  }
  renderImages();details.append(button('Choose from library',async()=>{if(selected.length>=20)throw Error('Maximum 20 images.');const p=mediaPicker(selected.map(m=>m.media_id),20-selected.length,items=>{selected.push(...items);if(!featured)featured=selected[0].media_id;dirty=true;renderImages();renderPricing();});pickerSlot.replaceChildren(p.box);await p.load();p.focus();},readOnly),pickerSlot);
  renderPricing();
  const save=el('button','Save product','primary');save.type='submit';save.disabled=readOnly;
  const actions=el('div',undefined,'actions');actions.append(save,button('Back to products',()=>navigate('Products')));aside.append(actions);
  if(key)aside.append(button('Archive product',async()=>{if(dirty)throw Error('Save or discard edits before archiving.');await api('products/'+key,{revision:record.revision,status:'archived'},'PATCH');dirty=false;await navigate('Products');notify('Product archived.');},readOnly||record.status==='archived'));
  let history=null;if(key){history=historyCard({product:String(key)},record.option_names);root.append(history.box);await history.load();if(ticket!==generation)return;}
  form.addEventListener('input',()=>{dirty=true;});
  if(readOnly)for(const n of form.querySelectorAll('input,textarea,select'))n.disabled=true;
  form.addEventListener('submit',async e=>{e.preventDefault();if(readOnly)return;save.disabled=true;try{
   const kg=Number(weight.input.value||0);if(!Number.isFinite(kg)||kg<0||kg>100)throw Error('Weight must be 0–100 kg.');
   const body={shipping_profile:shipProfile.value,weight_grams:Math.round(kg*1000),title:title.input.value,description:description.input.value,status:state.value,collection_ids:choices.filter(([,n])=>n.checked).map(([id])=>String(id)),media:selected.map(({media_id,alt})=>({media_id,alt})),featured_media_id:featured};
   if(!options.length&&rows.length<=1&&!(record.option_names??[]).length){body.price_minor=moneyToMinor(simple.price.input.value);body.sku=simple.sku.input.value;if(!key)body.inventory=Number(simple.inventory.input.value);}
   else{if(!options.length)syncSimpleToRow();body.option_names=options.map(n=>n.trim());body.variants=rows.map((r,i)=>{const label=variantName(options,r.option_values)||`variant ${i+1}`;let price;try{price=moneyToMinor(String(r.price).trim());}catch(err){throw Error(`${label}: ${err.message}`);}const v={option_values:r.option_values.map(x=>x.trim()),sku:r.sku,price_minor:price,active:r.active,media_id:r.media_id};if(r.id)v.id=r.id;else v.inventory=Number(r.inventory)||0;return v;});}
   // Sent only when changed, so products save normally where migration 011 is not applied yet.
   if(pzAvailable&&JSON.stringify(pzValue())!==JSON.stringify(pz?.enabled?{enabled:true,required:pz.required,label:pz.label,max_length:pz.max_length,charset:pz.charset,help:pz.help??'',variant_ids:pz.variant_ids??[]}:null))body.personalization=pzValue();
   if(handle.input.value)body.handle=handle.input.value;if(key)body.revision=record.revision;
   await api(key?'products/'+key:'products',body,key?'PATCH':'POST');dirty=false;await navigate('Products');notify('Product saved to database.');
  }catch(e){notify(e.message);}finally{save.disabled=false;}});
 }
 // Stock from the shop POS (mPOS). "Check" previews; nothing changes until staff apply.
 function posSyncCard(){
  const box=el('section',undefined,'card pos-sync'),out=el('div',undefined,'pos-result');out.setAttribute('aria-live','polite');
  box.append(el('h2','Sync from POS'),el('p','Sets website stock from mPOS (available quantity, active in-stock items), matched by SKU. Shopify stock is not used. Check first: nothing changes until you apply.','muted'));
  const mini=(heads,rows)=>{const wrap=el('div',undefined,'table-wrap'),t=el('table'),hr=el('tr'),tb=el('tbody');for(const h of heads)hr.append(el('th',h));const th=el('thead');th.append(hr);t.append(th,tb);for(const r of rows){const tr=el('tr');for(const c of r)tr.append(el('td',String(c??'—')));tb.append(tr);}wrap.append(t);return wrap;};
  const section=(title,count,body,open=false)=>{const d=el('details',undefined,'pos-list');d.open=open;d.append(el('summary',`${title} (${count})`));if(count)d.append(body);else d.append(el('p','None.','muted'));return d;};
  const more=(shown,total)=>total>shown?el('p',`Showing ${shown} of ${total}.`,'muted'):null;
  function show(r){
   out.replaceChildren();
   const wh=r.pos.warehouses.map(w=>w.name||w.code||String(w.id)).join(', ')||'none';
   out.append(el('p',`mPOS: ${r.pos.rows} stock rows from ${r.pos.warehouses.length} warehouse${r.pos.warehouses.length===1?'':'s'} (${wh}) → ${r.pos.stock_codes} SKUs in stock.${r.pos.page_size&&r.pos.page_size<500?` (Read ${r.pos.page_size} rows at a time: mPOS could not send 500 at once.)`:''}`));
   out.append(el('p',r.dry_run?`Matched ${r.matched} website variants: ${r.changed} will change, ${r.unchanged} already correct.`:`Done: ${r.changed} variants updated, ${r.unchanged} already correct.`,r.dry_run?'':'pos-done'));
   if(r.pos.blank_codes||r.pos.rounded_quantities||r.variants_without_sku)out.append(el('p',[r.pos.blank_codes?`${r.pos.blank_codes} mPOS rows have no stock code`:'',r.pos.rounded_quantities?`${r.pos.rounded_quantities} quantities were negative or fractional and were rounded down (never below 0)`:'',r.variants_without_sku?`${r.variants_without_sku} website variants have no SKU and were skipped`:''].filter(Boolean).join(' · ')+'.','muted'));
   out.append(section(r.dry_run?'Will change':'Changed',r.changed,mini(['Product','Variant','SKU','Now','After','Held by unpaid orders'],r.changes.map(c=>[c.product_title,c.variant,c.sku,c.before,c.after,c.held||''])),r.dry_run));
   const extra=more(r.changes.length,r.changed);if(extra)out.append(extra);
   const siteBody=el('div');siteBody.append(el('p','Selling variants whose SKU is not in the mPOS in-stock list: sold out in mPOS, or the SKU is written differently.','muted'),mini(['Product','Variant','SKU','Website stock'],r.site_only.items.map(v=>[v.product_title,v.variant,v.sku,v.inventory])));
   out.append(section('On the website, not in mPOS',r.site_only.total,siteBody));
   const posBody=el('div');posBody.append(mini(['mPOS stock code','Description','Colour','Available'],r.pos_only.items.map(p=>[p.stock_code,p.description,p.colour,p.qty])));const pm=more(r.pos_only.items.length,r.pos_only.total);if(pm)posBody.append(pm);
   out.append(section('In mPOS, not on the website',r.pos_only.total,posBody));
   if(r.fuzzy.length)out.append(section('Matched ignoring spaces and dashes',r.fuzzy.length,mini(['Website SKU','mPOS stock code','Product'],r.fuzzy.map(f=>[f.sku,f.stock_code,f.product_title]))));
   if(r.ambiguous.length)out.append(section('Skipped: could match more than one item',r.ambiguous.length,mini(['SKUs','Reason'],r.ambiguous.map(a=>[a.sku,a.reason])),true));
   if(r.dry_run){
    const zero=el('input');zero.type='checkbox';zero.id='pos-zero-missing';const zl=el('label',` Also set the ${r.site_only.total} website variants not in the mPOS list to 0 (out of stock)`);zl.prepend(zero);zl.className='checkbox-line';
    if(r.site_only.total)out.append(zl);
    const apply=button('Apply to website stock',async()=>{const z=zero.checked;if(!window.confirm(`Update website stock from mPOS${z?` and set ${r.site_only.total} missing variants to 0`:''}?`))return;const res=await api('inventory/pos-sync',{zero_missing:z},'POST');notify(`Stock synced from POS: ${res.changed} variants updated.`);await render();const card=root.querySelector('.pos-sync');if(card)card.__show?.(res);});
    apply.className='primary';out.append(apply);
   }
  }
  box.__show=show;
  box.append(button('Check POS stock',async()=>{out.replaceChildren(el('p','Reading stock from mPOS…','muted'));try{show(await api('inventory/pos-sync',{dry_run:true},'POST'));}catch(e){out.replaceChildren(el('p',e.message,'error'));throw e;}}),out);
  return box;
 }
 async function inventoryView(ticket){
  if(!readOnly)root.append(posSyncCard());
  let stock=inventoryFilter;
  const tools=el('form',undefined,'toolbar'),q=field('Search product or SKU',search,'search'),filter=select([['','All stock levels'],['in','In stock'],['low','Low stock'],['out','Out of stock']],stock);filter.setAttribute('aria-label','Filter by stock level');tools.append(q.wrap,filter,el('button','Apply filters'));root.append(tools);
  tools.addEventListener('submit',e=>{e.preventDefault();search=q.input.value;inventoryFilter=filter.value;offset=0;render().catch(err=>notify(err.message));});
  const params=new URLSearchParams({paged:'true',limit:'25',offset:String(offset)});if(search)params.set('q',search);if(stock)params.set('stock',stock);
  const data=await api('inventory?'+params);if(ticket!==generation)return;
  root.append(el('p',`${data.total} active variants · Low stock at ${data.low_stock_at} or fewer · Showing ${data.items.length?offset+1:0}–${offset+data.items.length}`,'muted'));
  const slot=el('div');root.append(slot);
  if(!data.items.length)empty(search||stock?'No matching variants. Adjust your filters.':'No active variants yet. Add products to start tracking stock.');
  else{const body=table(['Product','Variant','SKU','Stock','Status','Action']);for(const v of data.items){const tr=el('tr');cell(tr,v.product_title);cell(tr,variantName(v.option_names,v.option_values));cell(tr,v.sku||'—');cell(tr,String(v.inventory));const st=el('td');st.append(stockBadge(v.stock_status));tr.append(st);const td=el('td',undefined,'row-actions');td.append(button('Adjust',()=>{slot.replaceChildren(adjustPanel(v,`${v.product_title} · ${variantName(v.option_names,v.option_values)}`,()=>render()));slot.scrollIntoView?.({block:'nearest'});},readOnly),button(readOnly?'View product':'Edit product',()=>editProduct(v.product_id)));tr.append(td);body.append(tr);}}
  const pages=el('div',undefined,'pagination');pages.append(button('Previous',()=>{offset=Math.max(0,offset-25);return render();},offset===0),button('Next',()=>{offset+=25;return render();},offset+data.items.length>=data.total));root.append(pages);
  const history=historyCard({});root.append(history.box);await history.load();
 }
 async function editCollection(key){
  const ticket=++generation;upload.hidden=true;const c=key?await api('collections/'+key):{title:'',description:'',status:'draft',position:0,product_ids:[]};if(ticket!==generation)return;header(key?'Edit collection':'New collection','Organize products and control the collection display order.');
  const form=el('form',undefined,'card editor-single');root.append(form);const title=field('Title',c.title),slug=field('URL slug (blank generates from title)',c.slug),description=field('Description',c.description,'textarea'),position=field('Display order (lower first)',c.position,'number'),status=select([['draft','draft'],['active','active']],c.status),label=el('label','Status');title.input.required=true;title.input.maxLength=90;position.input.min=0;position.input.step=1;label.append(status);form.append(title.wrap,slug.wrap,description.wrap,position.wrap,label);const save=el('button','Save collection','primary');save.disabled=readOnly;form.append(save,button('Back',()=>navigate('Collections')));form.addEventListener('input',()=>{dirty=true;});
  if(readOnly)for(const n of form.querySelectorAll('input,textarea,select'))n.disabled=true;
  form.addEventListener('submit',async e=>{e.preventDefault();if(readOnly)return;save.disabled=true;try{const body={title:title.input.value,description:description.input.value,position:Number(position.input.value),status:status.value};if(slug.input.value)body.slug=slug.input.value;if(key)body.revision=c.revision;const result=await api(key?'collections/'+key:'collections',body,key?'PATCH':'POST');dirty=false;await editCollection(result.id);notify('Collection saved.');}catch(e){notify(e.message);}finally{save.disabled=readOnly;}});
  if(key){const products=await all('products');if(ticket!==generation)return;const box=el('section',undefined,'card');box.append(el('h2','Products in this collection'),el('p',c.manual_order?'This order is the storefront’s “Featured” sort. Move products up or down, then save the order.':'Product order needs database migration 011; until then “Featured” shows newest first.','muted'));root.append(box);
   const members=(c.products??[]).map(p=>({...p}));const list=el('ol',undefined,'collection-order');box.append(list);let orderDirty=false;
   const saveOrder=button('Save product order',async()=>{const fresh=await api('collections/'+key);await api('collections/'+key,{revision:fresh.revision,product_order:members.map(m=>m.id)},'PATCH');orderDirty=false;notify('Product order saved.');await editCollection(key);},true);
   const draw=()=>{list.replaceChildren();members.forEach((p,i)=>{const li=el('li',undefined,'order-row');li.append(el('span',p.title),el('small',p.status,'cell-note'));
     li.append(button('Move up',()=>{[members[i-1],members[i]]=[members[i],members[i-1]];orderDirty=true;saveOrder.disabled=false;draw();list.children[i-1]?.querySelector('button')?.focus();},readOnly||!c.manual_order||i===0),button('Move down',()=>{[members[i+1],members[i]]=[members[i],members[i+1]];orderDirty=true;saveOrder.disabled=false;draw();list.children[i+1]?.querySelectorAll('button')[1]?.focus();},readOnly||!c.manual_order||i===members.length-1),
      button('Edit',()=>{if(dirty||orderDirty)throw Error('Save collection edits first.');return editProduct(p.id);}),button('Remove',async()=>{if(dirty||orderDirty)throw Error('Save collection edits first.');const current=await api('products/'+p.id);await api('products/'+p.id,{revision:current.revision,collection_ids:current.collection_ids.filter(x=>x!==String(key))},'PATCH');await editCollection(key);},readOnly));
     for(const b of li.querySelectorAll('button'))b.setAttribute('aria-label',`${b.textContent} ${p.title}`);list.append(li);});
    if(!members.length)list.append(el('li','No products yet.','muted'));};
   draw();if(c.manual_order&&!readOnly)box.append(saveOrder);
   const choose=select([['','Select product'],...products.filter(p=>!c.product_ids.includes(String(p.id))).map(p=>[String(p.id),p.title])],'');box.append(choose,button('Associate product',async()=>{if(dirty)throw Error('Save collection edits first.');if(!choose.value)return;const p=await api('products/'+choose.value);await api('products/'+p.id,{revision:p.revision,collection_ids:[...p.collection_ids,String(key)]},'PATCH');await editCollection(key);},readOnly),button('Create product in collection',()=>{if(dirty)throw Error('Save collection edits first.');return editProduct(null,key);},readOnly));
  }
 }
 const website=createWebsite({api,root,notify,readOnly,el,button,field,select,header,table,cell,empty,all,thumb,previews,mediaPicker,navigate,setDirty:v=>{dirty=v;},ticket:()=>++generation,current:t=>t===generation});
 const themes=createThemes({api,root,notify,readOnly,el,button,field,select,header,empty,all,thumb,previews,mediaPicker,navigate,setDirty:v=>{dirty=v;},ticket:()=>++generation,current:t=>t===generation});
 const sales=createOrders({api,root,notify,readOnly,el,button,field,select,header,table,cell,empty,navigate:v=>navigate(v,true),ticket:()=>++generation,current:t=>t===generation});
 const people=createCustomers({api,root,notify,readOnly,el,button,field,select,header,navigate,current:t=>t===generation,ticket:()=>++generation});
 const ops=createOps({api,root,notify,readOnly,el,button,field,select,all,navigate,setDirty:v=>{dirty=v;},current:t=>t===generation});
 async function render(){
  const ticket=++generation;upload.hidden=view!=='Media Library';header(view,'');
  if(view==='Orders'){await sales.orders(ticket);return;}
  if(view==='Customers'){await people.list(ticket);return;}
  if(view==='Settings'){await sales.settings(ticket);await ops.email(ticket);return;}
  if(view==='Discounts'){await ops.discounts(ticket);return;}
  if(view==='Analytics'){await ops.analytics(ticket);return;}
  if(view==='Dashboard'){
   const d=await api('dashboard');if(ticket!==generation)return;
   const grid=el('div',undefined,'metrics dashboard-primary');
   for(const [label,key,destination] of [['Net paid revenue','revenue_minor','Orders'],['Paid orders','paid_orders','Orders'],['Active products','active','Products'],['To fulfil','to_fulfil','Orders']]){
    const card=el('section',undefined,'card metric');card.append(el('span',label,'muted'),el('strong',key==='revenue_minor'?formatPrice(Number(d[key]??0)):String(d[key]??0)),button('View '+destination.toLowerCase(),()=>navigate(destination)));grid.append(card);
   }root.append(grid);
   const columns=el('div',undefined,'dashboard-columns'),tasks=el('section',undefined,'card dashboard-tasks');tasks.append(el('h2','Needs your attention'),el('p','A focused list of the next steps for your store.','muted'));
   // Each task opens the matching filtered list, and its number is that list's count.
   const n=k=>Number(d[k]??0),plural=(x,one,many)=>`${x} ${x===1?one:many}`;
   const actions=[
    {label:'Orders to fulfil',count:n('to_fulfil'),note:'Paid, not yet shipped',go:()=>{sales.filterOrders('unfulfilled');return navigate('Orders',true);}},
    {label:'Orders needing review',count:n('attention_orders'),note:'Payment or stock issue to check',go:()=>{sales.filterOrders('attention');return navigate('Orders',true);}},
    {label:'Variants low on stock',count:n('low_stock'),note:`In ${plural(n('products_low_stock'),'product','products')} · ${d.low_stock_at??5} or fewer left`,go:()=>navigate('Inventory',false,{stock:'low'})},
    {label:'Variants out of stock',count:n('out_of_stock'),note:n('products_out_of_stock')?`${plural(n('products_out_of_stock'),'product is','products are')} completely sold out`:'Other variants of these products are still in stock',go:()=>navigate('Inventory',false,{stock:'out'})},
    {label:'Active products not shown in the store',count:n('active_unlisted'),note:'Not in any active collection, so customers cannot find them',go:()=>navigate('Products',false,{status:'active',listed:'no'})},
    {label:'Online store has no published theme',count:n('live_themes')?0:1,note:n('themes')?'A theme is saved but not published. Preview it, then publish when ready.':'Create a theme for the storefront.',go:()=>navigate('Website')},
    {label:'Unpublished page drafts',count:n('draft_pages'),note:'Pages with changes not yet published',go:()=>navigate('Pages')}
   ];
   let pending=0;for(const a of actions){if(!a.count)continue;pending++;const row=el('div',undefined,'task-row');const text=el('span');text.append(el('span',a.label),el('small',a.note,'cell-note'));row.append(text,el('strong',String(a.count)),button('Review',a.go));row.querySelector('button').setAttribute('aria-label','Review '+a.label.toLowerCase());tasks.append(row);}
   if(!pending)tasks.append(el('p','You’re all caught up. No pending tasks in these categories.','dashboard-clear'));
   columns.append(tasks);root.append(columns);
   const details=el('details',undefined,'dashboard-details');details.append(el('summary','More store metrics'));const secondary=el('div',undefined,'metrics');
   for(const [label,key] of [['All products','products'],['Draft products','drafts'],['Collections','collections'],['Ready images','media'],['Active variants (all products)','variants'],['Awaiting payment','pending_orders'],['Emails waiting to send','emails_waiting'],['Published pages','published_pages']]){const item=el('div',undefined,'card');item.append(el('span',label,'muted'),el('strong',String(d[key]??0)));secondary.append(item);}details.append(secondary);root.append(details,el('p','All-time totals. Orders are paid through eGHL; revenue counts paid orders net of refunds.','muted'));return;
  }
  if(view==='Pages'){await website.list(ticket);return;}
  if(view==='Inventory'){await inventoryView(ticket);return;}
  // Online Store: current theme and theme library, then the pages list.
  if(view==='Website'){await themes.overview(ticket);if(ticket!==generation)return;
   // How themes and pages relate, with a way to the pages list (pages are edited there, not here).
   const rel=el('section',undefined,'card relation-card');rel.append(el('h2','Themes and pages'),el('p','The published theme decides the header, footer, home page and the layout of product, collection and cart pages. Pages (About us, policies, campaigns) are separate content that appears inside that theme.','muted'),button('Manage pages',()=>navigate('Pages')));root.append(rel);return;}
  const resource=view==='Products'?'products':view==='Collections'?'collections':'media';
  const params=new URLSearchParams({paged:'true',limit:'25',offset:String(offset),q:search});if(status)params.set('status',status);if(collection&&resource==='products')params.set('collection',collection);if(listed&&resource==='products')params.set('listed',listed);if(sort&&resource==='products')params.set('sort',sort);
  if(resource!=='media'){const add=button('Add '+(resource==='products'?'product':'collection'),()=>resource==='products'?editProduct():editCollection(),readOnly);add.classList.add('primary');root.querySelector('.page-actions').append(add);}
  const data=await api(resource+'?'+params);if(ticket!==generation)return;
  const tools=el('form',undefined,'toolbar'),q=field('Search',search,'search'),filter=select([['','All statuses'],...(resource==='media'?['ready','pending']:['draft','active',...(resource==='products'?['archived']:[])]).map(x=>[x,x])],status);filter.setAttribute('aria-label','Filter by status');const find=el('button','Apply filters');tools.append(q.wrap,filter,find);root.append(tools);tools.addEventListener('submit',e=>{e.preventDefault();search=q.input.value;status=filter.value;offset=0;render().catch(e=>notify(e.message));});
  if(resource==='products'){const collections=await all('collections');if(ticket!==generation)return;const choose=select([['','All collections'],...collections.map(c=>[String(c.id),c.title])],collection);choose.setAttribute('aria-label','Filter by collection');tools.insertBefore(choose,find);choose.addEventListener('change',()=>{collection=choose.value;});
   const vis=select([['','Any store visibility'],['yes','Shown in store'],['no','Active but not shown']],listed);vis.setAttribute('aria-label','Filter by store visibility');tools.insertBefore(vis,find);vis.addEventListener('change',()=>{listed=vis.value;});}
  if(resource==='products'){const order=select([['','Newest first'],['oldest','Oldest first'],['title','Title A–Z'],['title-desc','Title Z–A'],['price-asc','Price, low to high'],['price-desc','Price, high to low'],['inventory-asc','Inventory, low to high'],['inventory-desc','Inventory, high to low']],sort);order.setAttribute('aria-label','Sort products');tools.insertBefore(order,find);order.addEventListener('change',()=>{sort=order.value;offset=0;render().catch(e=>notify(e.message));});}
  const filtered=!!(search||status||collection||listed);
  const clear=()=>{search='';status='';collection='';listed='';offset=0;return show();};
  if(filtered)tools.append(button('Clear filters',clear));
  if(resource==='media'||resource==='products'){const importTools=el('details',undefined,'import-tools');importTools.open=resource==='media'?importer.running:catalogRun.running;importTools.append(el('summary','Import & sync with Shopify'),resource==='media'?importCard():catalogCard());root.append(importTools);}
  const noun={products:['product','products'],collections:['collection','collections'],media:['image','images']}[resource];
  root.append(el('p',data.total?`Showing ${offset+1}–${offset+data.items.length} of ${data.total} ${data.total===1?noun[0]:noun[1]}${filtered?' (filtered)':''}`:'','result-count'));
  if(!data.items.length)empty(filtered?`No ${noun[1]} match these filters.`:resource==='media'?'No images yet. Upload one below or import from Shopify.':`No ${noun[1]} yet.`,filtered?button('Clear filters',clear):null);
  else if(resource==='media'){const grid=el('div',undefined,'media-grid');root.append(grid);const shots=[];for(const m of data.items){const box=el('article',undefined,'card media-card'),name=m.label||m.object_key.split('/').pop();if(m.state==='ready'){const frame=el('div',undefined,'media-thumb'),img=thumb(name);frame.append(img);box.append(frame);shots.push({id:m.id,img});}box.append(el('strong',name,'media-label'),el('small',`${m.width??'?'} × ${m.height??'?'} · ${m.bytes>=1e6?(m.bytes/1e6).toFixed(1)+' MB':Math.max(1,Math.round(m.bytes/1e3))+' KB'} · ${m.state}`));grid.append(box);}previews(shots);root.append(el('p','Images load as private previews that expire after five minutes; use Refresh data to reload them. Link images from the product editor.','muted'));}
  else {const body=table(resource==='products'?['Product','Status','SKU','Price','Inventory','Action']:['Collection','Status','Order','Action']);for(const row of data.items){const tr=el('tr');if(resource==='products'&&row.status==='active'&&row.listed===false){const t=el('td');t.append(el('span',row.title),el('small','Not shown in store: add it to an active collection','cell-note'));tr.append(t);}else cell(tr,row.title);badge(tr,row.status);if(resource==='products'){const many=row.variant_count>1;cell(tr,(row.sku||'—')+(many?` · ${row.variant_count} variants`:''));cell(tr,(many?'From ':'')+formatPrice(row.price_minor));cell(tr,String(row.inventory));}else cell(tr,String(row.position));const td=el('td');td.append(button(readOnly?'View':'Edit',()=>resource==='products'?editProduct(row.id):editCollection(row.id)));tr.append(td);body.append(tr);}}
  const pages=el('div',undefined,'pagination');pages.append(button('Previous',()=>{offset=Math.max(0,offset-25);return render();},offset===0),button('Next',()=>{offset+=25;return render();},offset+data.items.length>=data.total));root.append(pages);
 }
 async function navigate(next,keep=false,preset={}){if(!keep&&next==='Orders')sales?.resetOrders();if(dirty&&!window.confirm('Discard unsaved edits?'))return;dirty=false;view=next;offset=0;search='';status=preset.status??'';collection='';inventoryFilter=preset.stock??'';listed=preset.listed??'';sort='';for(const b of document.querySelectorAll('[data-view]')){b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false');}for(const g of document.querySelectorAll('.nav-group'))g.classList.toggle('open',!!g.querySelector('[data-view].active'));closeNav();await show();}
 // Loading and error states for every page: the page title appears at once; a failure offers Retry.
 async function show(){
  const ticket=generation+1;const pending=setTimeout(()=>{if(generation===ticket&&!root.querySelector('.loading-state,.error-state')&&root.children.length<=1)root.append(el('p','Loading…','loading-state'));},150);
  try{await render();}
  catch(e){if(generation!==ticket)return;const box=el('div',undefined,'error-state');box.setAttribute('role','alert');box.append(el('p','This page could not be loaded: '+e.message),button('Retry',()=>show()));root.append(box);}
  finally{clearTimeout(pending);if(generation===ticket)root.querySelector('.loading-state')?.remove();}
 }
 // Shell: account menu (who is signed in, change password, sign out) and the collapsible menu on small screens.
 const ws=document.getElementById('workspace'),toggle=document.getElementById('nav-toggle'),accountBtn=document.getElementById('account-button'),accountMenu=document.getElementById('account-menu');
 function closeNav(){ws?.classList.remove('nav-open');toggle?.setAttribute('aria-expanded','false');}
 const onToggle=()=>{const open=!ws.classList.contains('nav-open');ws.classList.toggle('nav-open',open);toggle.setAttribute('aria-expanded',String(open));if(open)ws.querySelector('[data-view].active')?.focus();};
 const closeAccount=(focus=false)=>{if(!accountMenu||accountMenu.hidden)return;accountMenu.hidden=true;accountBtn.setAttribute('aria-expanded','false');if(focus)accountBtn.focus();};
 const onAccount=()=>{const open=accountMenu.hidden;accountMenu.hidden=!open;accountBtn.setAttribute('aria-expanded',String(open));if(open)accountMenu.querySelector('button')?.focus();};
 const onKey=e=>{if(e.key!=='Escape')return;if(accountMenu&&!accountMenu.hidden)closeAccount(true);else if(ws?.classList.contains('nav-open')){closeNav();toggle.focus();}};
 const onOutside=e=>{if(accountMenu&&!accountMenu.hidden&&!accountMenu.contains(e.target)&&!accountBtn.contains(e.target))closeAccount();};
 const accountActions=[['account-password',()=>account.changePassword?.()],['account-signout',()=>account.signOut?.()]].map(([id,fn])=>{const b=document.getElementById(id);const h=async()=>{closeAccount();try{await fn();}catch(e){notify(e.message);}};b?.addEventListener('click',h);return [b,h];});
 if(accountBtn){accountBtn.querySelector('.account-name').textContent=account.email||'Account';accountMenu.querySelector('.account-email').textContent=account.email||'';accountMenu.querySelector('.account-role').textContent={admin:'Administrator',editor:'Editor',viewer:'Viewer (read only)'}[role]??role;accountBtn.querySelector('.account-avatar').textContent=(account.email||'JS').slice(0,2).toUpperCase();accountBtn.addEventListener('click',onAccount);}
 toggle?.addEventListener('click',onToggle);document.addEventListener('keydown',onKey);document.addEventListener('click',onOutside);
 // Wide tables scroll sideways on small screens; make every table area reachable by keyboard and named.
 const tables=typeof MutationObserver==='undefined'?{observe(){},disconnect(){}}:new MutationObserver(()=>{for(const w of root.querySelectorAll('.table-wrap:not([tabindex])')){w.tabIndex=0;w.setAttribute('role','region');w.setAttribute('aria-label',(w.querySelector('th')?.textContent||'Data')+' table');}});
 tables.observe(root,{childList:true,subtree:true});
 function teardownShell(){tables.disconnect();toggle?.removeEventListener('click',onToggle);accountBtn?.removeEventListener('click',onAccount);document.removeEventListener('keydown',onKey);document.removeEventListener('click',onOutside);for(const [b,h] of accountActions)b?.removeEventListener('click',h);closeNav();closeAccount();}
 const navigation=[...document.querySelectorAll('[data-view]')].map(b=>{const fn=()=>navigate(b.dataset.view).catch(e=>notify(e.message));b.addEventListener('click',fn);return [b,fn];});
 const unload=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);
 return {reload:()=>navigate(view),destroy(){teardownShell();importer.stop=true;catalogRun.stop=true;for(const [b,fn]of navigation)b.removeEventListener('click',fn);generation++;root.replaceChildren();window.removeEventListener('beforeunload',unload);}};
}
