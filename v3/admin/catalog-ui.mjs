// DOM text APIs deliberately avoid interpolating catalogue content as HTML.
import {createWebsite} from './website-ui.mjs';
import {createThemes} from './theme-ui.mjs';
import {moneyToMinor,formatPrice} from './money.mjs';
import {createOrders} from './orders-ui.mjs';
export {moneyToMinor,formatPrice};
export function mountAdmin(api,role,notify){
 const root=document.getElementById('admin-content'),upload=document.getElementById('media-upload');
 let view='Dashboard',offset=0,search='',status='',collection='',inventoryFilter='',generation=0,dirty=false;
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
 function header(title,description){root.replaceChildren();const h=el('div',undefined,'page-heading'),copy=el('div');copy.append(el('p','JACK STUDIO / COMMERCE','eyebrow'),el('h1',title),el('p',description,'muted'));h.append(copy);root.append(h);return h;}
 function empty(text){root.append(el('div',text,'empty-state'));}
 async function preview(m,container){const img=el('img');img.alt=m.alt??'Product media';img.loading='lazy';img.referrerPolicy='no-referrer';container.append(img);try{const data=await api(`media/${m.media_id??m.id}/preview`);const url=new URL(data.url);if(url.protocol!=='https:'||url.hostname!=='api.cloudinary.com')throw Error('Invalid media preview');img.src=data.url;}catch{img.remove();container.append(el('span','Preview unavailable'));}}
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
  const state=select(['draft','active','archived'].map(x=>[x,x]),record.status),stateLabel=el('label','Status');stateLabel.append(state);aside.append(stateLabel,el('h2','Collections'));
  const choices=[];for(const c of collections){const f=field(c.title,'','checkbox');f.input.checked=record.collection_ids.includes(String(c.id));choices.push([c.id,f.input]);aside.append(f.wrap);}
  if(!collections.length)aside.append(el('p','Create a collection first. Products can belong to several collections.','muted'));
  const shipProfile=select([['general','General (RM5, free from RM49)'],['luggage','Luggage (RM26.90, 1–50 kg)']],record.shipping_profile??'general'),shipLabel=el('label','Shipping profile');shipLabel.append(shipProfile);
  const weight=field('Weight (kg, per item)',((record.weight_grams??0)/1000).toString(),'number');weight.input.min=0;weight.input.step=0.01;weight.input.max=100;
  aside.append(el('h2','Shipping'),shipLabel,weight.wrap,el('p','Luggage shipping needs a weight between 1 and 50 kg per order.','muted'));
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
   if(handle.input.value)body.handle=handle.input.value;if(key)body.revision=record.revision;
   await api(key?'products/'+key:'products',body,key?'PATCH':'POST');dirty=false;await navigate('Products');notify('Product saved to database.');
  }catch(e){notify(e.message);}finally{save.disabled=false;}});
 }
 async function inventoryView(ticket){
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
  if(key){const products=await all('products');if(ticket!==generation)return;const box=el('section',undefined,'card');box.append(el('h2','Associated products'));root.append(box);for(const p of products.filter(p=>c.product_ids.includes(String(p.id))))box.append(button(p.title,()=>{if(dirty)throw Error('Save collection edits first.');return editProduct(p.id);}),button('Remove '+p.title,async()=>{if(dirty)throw Error('Save collection edits first.');const current=await api('products/'+p.id);await api('products/'+p.id,{revision:current.revision,collection_ids:current.collection_ids.filter(x=>x!==String(key))},'PATCH');await editCollection(key);},readOnly));
   const choose=select([['','Select product'],...products.filter(p=>!c.product_ids.includes(String(p.id))).map(p=>[String(p.id),p.title])],'');box.append(choose,button('Associate product',async()=>{if(dirty)throw Error('Save collection edits first.');if(!choose.value)return;const p=await api('products/'+choose.value);await api('products/'+p.id,{revision:p.revision,collection_ids:[...p.collection_ids,String(key)]},'PATCH');await editCollection(key);},readOnly),button('Create product in collection',()=>{if(dirty)throw Error('Save collection edits first.');return editProduct(null,key);},readOnly));
  }
 }
 const website=createWebsite({api,root,notify,readOnly,el,button,field,select,header,table,cell,empty,all,thumb,previews,mediaPicker,navigate,setDirty:v=>{dirty=v;},ticket:()=>++generation,current:t=>t===generation});
 const themes=createThemes({api,root,notify,readOnly,el,button,field,select,header,empty,all,thumb,previews,mediaPicker,navigate,setDirty:v=>{dirty=v;},ticket:()=>++generation,current:t=>t===generation});
 const sales=createOrders({api,root,notify,readOnly,el,button,field,select,header,table,cell,empty,navigate:v=>navigate(v,true),ticket:()=>++generation,current:t=>t===generation});
 async function render(){
  const ticket=++generation;upload.hidden=view!=='Media Library';header(view,readOnly?'Viewer access · Read only':'Staging workspace · Changes persist in the shared database');
  if(view==='Orders'){await sales.orders(ticket);return;}
  if(view==='Customers'){await sales.customers(ticket);return;}
  if(view==='Settings'){await sales.settings(ticket);return;}
  if(view==='Dashboard'){const d=await api('dashboard');if(ticket!==generation)return;const grid=el('div',undefined,'metrics');for(const [label,key]of [['All products','products'],['Active products','active'],['Draft products','drafts'],['Collections','collections'],['Ready images','media'],['Active variants','variants'],['Low stock','low_stock'],['Out of stock','out_of_stock'],['Paid orders','paid_orders'],['Revenue (paid, net of refunds)','revenue_minor'],['Awaiting payment','pending_orders'],['To fulfil','to_fulfil'],['Needs attention','attention_orders'],['Emails waiting to send','emails_waiting'],['Published pages','published_pages'],['Pages with drafts','draft_pages']]){const card=el('div',undefined,'card'+((key==='low_stock'||key==='out_of_stock'||key==='attention_orders')&&d[key]?' metric-alert':''));card.append(el('span',label,'muted'),el('strong',key==='revenue_minor'?formatPrice(Number(d[key]??0)).replace(/\u00a0/g,' '):String(d[key]??0),key==='revenue_minor'?'metric-money':undefined));grid.append(card);}root.append(grid);const welcome=el('section',undefined,'card welcome');welcome.append(el('p','BUILD YOUR COLLECTION','eyebrow'),el('h2','Made for the everyday. Managed with care.'),el('p','Manage your catalogue, organize collections and prepare your imagery. Orders are paid through eGHL; revenue counts paid orders net of refunds.'),button('Manage products',()=>navigate('Products')),button('Review orders',()=>navigate('Orders')),button('Review inventory',()=>navigate('Inventory')),button('Edit website',()=>navigate('Website')),button('Open media library',()=>navigate('Media Library')));root.append(welcome);return;}
  if(view==='Inventory'){await inventoryView(ticket);return;}
  // Online Store: current theme and theme library, then the pages list.
  if(view==='Website'){await themes.overview(ticket);if(ticket!==generation)return;root.append(el('h2','Pages','website-pages-title'));await website.list(ticket);return;}
  const resource=view==='Products'?'products':view==='Collections'?'collections':'media';
  const params=new URLSearchParams({paged:'true',limit:'25',offset:String(offset),q:search});if(status)params.set('status',status);if(collection&&resource==='products')params.set('collection',collection);
  const data=await api(resource+'?'+params);if(ticket!==generation)return;
  const tools=el('form',undefined,'toolbar'),q=field('Search',search,'search'),filter=select([['','All statuses'],...(resource==='media'?['ready','pending']:['draft','active',...(resource==='products'?['archived']:[])]).map(x=>[x,x])],status);filter.setAttribute('aria-label','Filter by status');const find=el('button','Apply filters');tools.append(q.wrap,filter,find);root.append(tools);tools.addEventListener('submit',e=>{e.preventDefault();search=q.input.value;status=filter.value;offset=0;render().catch(e=>notify(e.message));});
  if(resource==='products'){const collections=await all('collections');if(ticket!==generation)return;const choose=select([['','All collections'],...collections.map(c=>[String(c.id),c.title])],collection);choose.setAttribute('aria-label','Filter by collection');tools.insertBefore(choose,find);choose.addEventListener('change',()=>{collection=choose.value;});}
  if(resource!=='media')tools.append(button('Add '+(resource==='products'?'product':'collection'),()=>resource==='products'?editProduct():editCollection(),readOnly));
  if(resource==='media')root.append(importCard());
  root.append(el('p',`${data.total} records · Showing ${data.items.length?offset+1:0}–${offset+data.items.length}`,'muted'));
  if(!data.items.length)empty(search||status?'No matching records. Adjust your filters.':'Your collection starts here. Add your first record.');
  else if(resource==='media'){const grid=el('div',undefined,'media-grid');root.append(grid);for(const m of data.items){const box=el('article',undefined,'card media-card');box.append(el('strong',m.label||m.object_key.split('/').pop(),'media-label'),el('p',m.object_key),el('small',`${m.width??'?'} × ${m.height??'?'} · ${m.bytes} bytes · ${m.state}`));if(m.state==='ready')box.append(button('Load private preview',async()=>{await preview(m,box);}));grid.append(box);}root.append(el('p','Private previews expire after five minutes. Link images from the product editor.','muted'));}
  else {const body=table(resource==='products'?['Product','Status','SKU','Price','Inventory','Action']:['Collection','Status','Order','Action']);for(const row of data.items){const tr=el('tr');cell(tr,row.title);badge(tr,row.status);if(resource==='products'){const many=row.variant_count>1;cell(tr,(row.sku||'—')+(many?` · ${row.variant_count} variants`:''));cell(tr,(many?'From ':'')+formatPrice(row.price_minor));cell(tr,String(row.inventory));}else cell(tr,String(row.position));const td=el('td');td.append(button(readOnly?'View':'Edit',()=>resource==='products'?editProduct(row.id):editCollection(row.id)));tr.append(td);body.append(tr);}}
  const pages=el('div',undefined,'pagination');pages.append(button('Previous',()=>{offset=Math.max(0,offset-25);return render();},offset===0),button('Next',()=>{offset+=25;return render();},offset+data.items.length>=data.total));root.append(pages);
 }
 async function navigate(next,keep=false){if(!keep&&next==='Orders')sales?.resetOrders();if(dirty&&!window.confirm('Discard unsaved edits?'))return;dirty=false;view=next;offset=0;search='';status='';collection='';inventoryFilter='';for(const b of document.querySelectorAll('[data-view]')){b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false');}for(const g of document.querySelectorAll('.nav-group'))g.classList.toggle('open',!!g.querySelector('[data-view].active'));await render();}
 const navigation=[...document.querySelectorAll('[data-view]')].map(b=>{const fn=()=>navigate(b.dataset.view).catch(e=>notify(e.message));b.addEventListener('click',fn);return [b,fn];});
 const unload=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);
 return {reload:()=>navigate(view),destroy(){importer.stop=true;for(const [b,fn]of navigation)b.removeEventListener('click',fn);generation++;root.replaceChildren();window.removeEventListener('beforeunload',unload);}};
}
