// Storefront: product, bag, checkout, order status and the staging-only mock payment page.
// The browser never decides prices or totals; every number shown comes from the server.
const STATES=['Johor','Kedah','Kelantan','Kuala Lumpur','Labuan','Melaka','Negeri Sembilan','Pahang','Penang','Perak','Perlis','Putrajaya','Sabah','Sarawak','Selangor','Terengganu'];
import {bag,setBag,updateBadges} from './bag.mjs';
import {siteData,mountSite} from './liquid-site.mjs';
import './image-fallback.mjs';
import {richText,plainText} from './rich-text.mjs';
const ORDERS='js-orders',ATTEMPT='js-checkout-attempt',CODE='js-discount-code';
// The discount code the customer typed. Only the code is kept here; the server decides what it is worth.
const savedCode=()=>{try{return localStorage.getItem(CODE)||'';}catch{return '';}};
const saveCode=v=>{try{v?localStorage.setItem(CODE,v):localStorage.removeItem(CODE);}catch{}};
const price=n=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format((n??0)/100);
const read=(store,k,f)=>{try{return JSON.parse(store.getItem(k))??f;}catch{return f;}};
const write=(store,k,v)=>{try{store.setItem(k,JSON.stringify(v));}catch{}};
const root=document.getElementById('shop-root');
function h(tag,props={},...kids){const n=document.createElement(tag);for(const [k,v] of Object.entries(props??{})){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)n.setAttribute(k,v===true?'':v);}for(const c of kids.flat())if(c!=null&&c!==false)n.append(c instanceof Node?c:String(c));return n;}
async function api(path,body){const r=await fetch('/api/v3/storefront/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(data.error||'Something went wrong. Please try again.'),{status:r.status});return data;}
function meta(name,content,attr='name'){let m=document.head.querySelector(`meta[${attr}="${name}"]`);if(!m){m=document.createElement('meta');m.setAttribute(attr,name);document.head.append(m);}m.setAttribute('content',content);}
function canonical(path){let l=document.head.querySelector('link[rel=canonical]');if(!l){l=document.createElement('link');l.rel='canonical';document.head.append(l);}l.href=location.origin+path;}
// Pages share the live theme's header and footer (as on the theme's own pages) when a theme is live.
// The frame is mounted before the first content is shown, so nothing moves under the visitor's pointer.
const framePromise=siteData('_frame').catch(()=>null);let framed=null;
async function page(title,...kids){
 if(framed===null){framed=false;const frame=await framePromise;if(frame){framed=true;await mountSite(frame,root);}}
 document.title=`${title} | Jack Studio`;root.replaceChildren(h('section',{class:'store-section'},h('div',{class:'store-section-inner js-shop'},...kids)));
 updateBadges();}
const notice=(text,kind='')=>h('p',{class:'js-notice '+kind,role:kind==='error'?'alert':'status'},text);
const random=()=>{const b=new Uint8Array(32);crypto.getRandomValues(b);return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};

const money=(min,max)=>min===max?price(min):`${price(min)} – ${price(max)}`;
// Responsive public image (src/media-urls.mjs). Above-the-fold images load first; the rest lazily.
function picture(img,{cls='js-card-image',sizes='(min-width: 990px) 50vw, 100vw',eager=false}={}){
 if(!img)return h('div',{class:cls+' js-image-placeholder',role:'img','aria-label':'Image coming soon'});
 return h('img',{class:cls,src:img.url,srcset:img.srcset,sizes,width:img.width,height:img.height,alt:img.alt??'',loading:eager?'eager':'lazy',fetchpriority:eager?'high':false,decoding:'async'});
}
function productCard(p){
 return h('a',{class:'js-card js-product-card',href:p.url},
  h('div',{class:'js-card-media'},picture(p.image,{sizes:'(min-width: 990px) 25vw, 50vw'}),p.available?null:h('span',{class:'js-badge'},'Sold out'),p.compare_at_minor&&p.available?h('span',{class:'js-badge js-badge-sale'},'Sale'):null),
  h('span',{class:'js-card-title'},p.title),
  h('span',{class:'js-card-price'},p.compare_at_minor?h('s',{class:'js-compare'},price(p.compare_at_minor)):null,' ',(p.price_min!==p.price_max?'From ':'')+price(p.price_min)));
}
async function product(handle){
 let data;try{data=await api('products/'+handle);}catch(e){return notFound('Product not found','This product is not available right now.');}
 const p=data.product,names=p.option_names??[];const chosen=names.map((_,i)=>p.variants.find(v=>v.available)?.option_values[i]??p.variants[0]?.option_values[i]);
 const images=p.images??[],eng=p.engraving;
 const priceEl=h('p',{class:'js-product-price'}),stock=h('p',{class:'js-stock',role:'status'}),qty=h('input',{type:'number',min:'1',max:'20',value:'1',id:'qty',inputmode:'numeric'}),add=h('button',{class:'store-button js-add',type:'button'},'Add to bag'),msg=h('div',{'aria-live':'polite'});
 // Gallery: main image plus thumbnails; choosing a variant with its own image shows that image.
 const main=h('div',{class:'js-gallery-main'});let current_image=null;
 const show=id=>{const img=images.find(i=>i.id===id)??images[0]??null;if(img&&img.id===current_image)return;current_image=img?.id??null;main.replaceChildren(picture(img,{cls:'js-card-image js-product-image',eager:true}));thumbs.forEach(t=>t.setAttribute('aria-current',t.dataset.id===current_image?'true':'false'));};
 const thumbs=images.length>1?images.map((img,i)=>h('button',{type:'button',class:'js-thumb','data-id':img.id,'aria-label':`Show image ${i+1} of ${images.length}`,onclick:()=>show(img.id)},picture(img,{cls:'js-thumb-image',sizes:'80px'}))):[];
 const current=()=>p.variants.find(v=>v.option_values.every((x,i)=>x===chosen[i]))??(names.length?null:p.variants[0]);
 // Engraving (when the product offers it for the chosen variant): rules shown up front, checked here and on the server.
 const engInput=eng?h('input',{type:'text',id:'engraving',maxlength:String(eng.max_length),autocomplete:'off',spellcheck:'false','aria-describedby':'engraving-rule'}):null;
 const engCount=eng?h('span',{class:'js-count-hint','aria-hidden':'true'}):null;
 const engBox=eng?h('div',{class:'js-engraving-field'},h('label',{for:'engraving'},`${eng.label}${eng.required?'':' (optional)'}`),engInput,h('p',{id:'engraving-rule',class:'js-hint'},`${eng.rule}. Up to ${eng.max_length} characters.${eng.help?' '+eng.help:''}`),engCount):null;
 const offers=v=>!!eng&&!!v&&(!eng.variant_ids.length||eng.variant_ids.includes(v.id));
 const engValue=()=>{let t=(engInput?.value??'').replace(/\s+/g,' ').trim();if(eng?.charset==='upper_alnum')t=t.toUpperCase();return t;};
 const engProblem=v=>{if(!offers(v))return null;const t=engValue();if(!t)return eng.required?`Enter the ${eng.label.toLowerCase()} for this item.`:null;if(t.length>eng.max_length)return `Up to ${eng.max_length} characters.`;const rules={upper_alnum:/^[A-Z0-9]+$/,alnum:/^[A-Za-z0-9]+$/,alnum_space:/^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/,text:/^[A-Za-z0-9 .,&'-]+$/};return rules[eng.charset]?.test(t)?null:eng.rule+'.';};
 if(engInput)engInput.addEventListener('input',()=>{if(eng.charset==='upper_alnum'){const at=engInput.selectionStart;engInput.value=engInput.value.toUpperCase();engInput.setSelectionRange(at,at);}engCount.textContent=`${engInput.value.length}/${eng.max_length}`;engInput.removeAttribute('aria-invalid');});
 const update=()=>{const v=current();
  priceEl.replaceChildren(v?.compare_at_minor?h('s',{class:'js-compare'},price(v.compare_at_minor)):'',v?.compare_at_minor?' ':'',v?price(v.price_minor):'Unavailable');
  stock.textContent=!v?'This combination is not available.':!v.available?'Sold out':v.low?'Only a few left':'In stock';
  add.disabled=!v||!v.available;add.textContent=v&&!v.available?'Sold out':'Add to bag';
  if(engBox)engBox.hidden=!offers(v);if(engCount)engCount.textContent=`${engInput.value.length}/${eng.max_length}`;
  if(v?.image_id)show(v.image_id);};
 const pickers=names.map((name,i)=>{const values=[...new Set(p.variants.map(v=>v.option_values[i]))];const s=h('select',{id:'opt'+i,onchange:e=>{chosen[i]=e.target.value;update();}},...values.map(v=>h('option',{value:v,selected:v===chosen[i]},v)));return h('label',{},name,s);});
 add.addEventListener('click',()=>{const v=current(),n=Number(qty.value);
  if(!v||!Number.isInteger(n)||n<1||n>20){msg.replaceChildren(notice('Choose a quantity from 1 to 20.','error'));return;}
  const problem=engProblem(v);if(problem){engInput.setAttribute('aria-invalid','true');engInput.focus();msg.replaceChildren(notice(problem,'error'));return;}
  const engraving=offers(v)?engValue():'';
  // One bag line per variant and engraving: different engravings are never merged.
  const items=bag(),line=items.find(i=>i.variant_id===v.id&&(i.engraving??'')===engraving);if(line)line.quantity=Math.min(20,line.quantity+n);else items.push({variant_id:v.id,quantity:n,...(engraving?{engraving}:{})});setBag(items);
  msg.replaceChildren(notice(engraving?`Added to your bag with ${eng.label.toLowerCase()} “${engraving}”. `:'Added to your bag. ',''),h('a',{href:'/cart'},'View bag'));});
 const summary=plainText(p.description);meta('description',summary);meta('og:title',p.title,'property');meta('og:description',summary,'property');meta('og:type','product','property');if(images[0])meta('og:image',location.origin+images[0].url,'property');canonical('/products/'+p.handle);
 const crumbs=h('nav',{class:'js-breadcrumbs','aria-label':'Breadcrumb'},h('a',{href:'/'},'Home'),' / ',p.collections?.[0]?h('a',{href:'/collections/'+p.collections[0].handle},p.collections[0].title):h('a',{href:'/collections/all'},'All products'),' / ',h('span',{'aria-current':'page'},p.title));
 const description=h('div',{class:'js-description js-rich'});description.append(richText(p.description));
 await page(p.title,crumbs,h('div',{class:'js-product'},h('div',{class:'js-gallery'},main,thumbs.length?h('div',{class:'js-thumbs'},...thumbs):null),h('div',{class:'js-product-copy'},h('p',{class:'js-eyebrow'},'JACK STUDIO'),h('h1',{class:'js-product-title'},p.title),priceEl,stock,...pickers,engBox,h('label',{},'Quantity',qty),add,msg,policyLinks(),description)));
 show(null);update();
}
const policyLinks=()=>h('p',{class:'js-policies'},'Delivery and returns: ',h('a',{href:'/pages/shipping-policy'},'Shipping policy'),' · ',h('a',{href:'/pages/refund-policy'},'Refund policy'));
const SORT_LABELS={featured:'Featured',newest:'Newest','price-asc':'Price, low to high','price-desc':'Price, high to low','title-asc':'Alphabetically, A–Z','title-desc':'Alphabetically, Z–A'};
// Listing pages (collection, search): filters live in the URL, so results can be shared and reloaded.
const LISTING_KEYS=k=>['sort','available','page','price_min','price_max','q'].includes(k)||k.startsWith('option.');
function listingParams(){const p=new URLSearchParams(location.search),q=new URLSearchParams();for(const [k,v] of p)if(LISTING_KEYS(k)&&v!=='')q.append(k,v);return q;}
function goTo(query,changes){const next=new URLSearchParams(query);for(const [k,v] of Object.entries(changes)){next.delete(k);if(Array.isArray(v))for(const x of v)next.append(k,x);else if(v!=null&&v!==''&&v!==false)next.set(k,v);}if(!('page' in changes))next.delete('page');location.assign(location.pathname+(next.size?'?'+next:''));}
// Filter panel: availability, price range and the option values (colour, size…) found in this listing.
function filterPanel(data,query){
 const f=data.filters??{options:[],price:{min:0,max:0},applied:{}},applied=f.applied??{};
 const form=h('form',{class:'js-filters','aria-label':'Filters'});
 const stock=h('input',{type:'checkbox',name:'available',value:'1',checked:!!applied.available});
 form.append(h('fieldset',{},h('legend',{},'Availability'),h('label',{class:'js-check'},stock,'In stock only')));
 if(f.price.max>0){const lo=h('input',{type:'number',name:'price_min',min:'0',step:'1',inputmode:'numeric',placeholder:String(Math.floor(f.price.min/100)),value:applied.price_min!=null?String(applied.price_min/100):''}),hi=h('input',{type:'number',name:'price_max',min:'0',step:'1',inputmode:'numeric',placeholder:String(Math.ceil(f.price.max/100)),value:applied.price_max!=null?String(applied.price_max/100):''});
  form.append(h('fieldset',{class:'js-price'},h('legend',{},'Price (RM)'),h('label',{},'From',lo),h('label',{},'To',hi)));}
 for(const o of f.options){const chosen=(applied.options??{})[o.name]??[];form.append(h('fieldset',{},h('legend',{},o.label),...o.values.map(v=>h('label',{class:'js-check'},h('input',{type:'checkbox',name:'option.'+o.name,value:v.value,checked:chosen.some(c=>c.toLowerCase()===v.value.toLowerCase())}),`${v.value} (${v.count})`))));}
 form.append(h('div',{class:'js-filter-actions'},h('button',{type:'submit',class:'store-button'},'Apply filters'),h('button',{type:'button',class:'js-link',onclick:()=>{const keep={};for(const k of [...query.keys()])if(k==='sort'||k==='q')keep[k]=query.get(k);location.assign(location.pathname+(Object.keys(keep).length?'?'+new URLSearchParams(keep):''));}},'Clear all')));
 form.addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(form),changes={available:fd.get('available')?'1':null,price_min:fd.get('price_min')||null,price_max:fd.get('price_max')||null};
  for(const k of [...query.keys()])if(k.startsWith('option.'))changes[k]=null;for(const o of f.options)changes['option.'+o.name]=fd.getAll('option.'+o.name);
  if(changes.price_min&&changes.price_max&&Number(changes.price_min)>Number(changes.price_max))return form.querySelector('.js-price')?.append(notice('“From” must be lower than “To”.','error'));goTo(query,changes);});
 // Collapsed behind "Filter" on small screens; open by default on wide ones.
 const d=h('details',{class:'js-filter-box'},h('summary',{},'Filter'+(activeCount(applied)?` (${activeCount(applied)})`:'')),form);if(matchMedia('(min-width: 900px)').matches)d.open=true;return d;
}
const activeCount=a=>(a.available?1:0)+(a.price_min!=null||a.price_max!=null?1:0)+Object.values(a.options??{}).reduce((n,v)=>n+v.length,0);
function listingBody(data,query,{emptyText}){
 const sort=h('select',{id:'sort',onchange:e=>goTo(query,{sort:e.target.value===(query.has('q')?'relevance':'featured')?null:e.target.value})},...Object.entries(query.has('q')?{relevance:'Best match',...Object.fromEntries(Object.entries(SORT_LABELS).filter(([k])=>k!=='featured'))}:SORT_LABELS).map(([v,l])=>h('option',{value:v,selected:v===data.sort},l)));
 const toolbar=h('div',{class:'js-toolbar'},h('p',{class:'js-count',role:'status'},`${data.total} ${data.total===1?'product':'products'}`),h('label',{class:'js-sort'},'Sort by',sort));
 const filtered=activeCount(data.filters?.applied??{})>0;
 const empty=!data.products.length?h('div',{class:'js-empty-state'},h('p',{},filtered?'No products match these filters.':emptyText),filtered?h('button',{type:'button',class:'store-button js-secondary',onclick:()=>filterPanelClear(query)},'Clear filters'):h('a',{href:'/collections/all',class:'store-button js-secondary'},'Browse all products')):null;
 const link=n=>'?'+(()=>{const q=new URLSearchParams(query);q.set('page',String(n));return q;})();
 const pager=data.pages>1?h('nav',{class:'js-pager','aria-label':'Pages'},data.page>1?h('a',{href:link(data.page-1),rel:'prev'},'Previous'):null,h('span',{},`Page ${data.page} of ${data.pages}`),data.page<data.pages?h('a',{href:link(data.page+1),rel:'next'},'Next'):null):null;
 return h('div',{class:'js-listing'},filterPanel(data,query),h('div',{class:'js-results'},toolbar,empty??h('div',{class:'js-grid'},...data.products.map(productCard)),pager));
}
function filterPanelClear(query){const keep=new URLSearchParams();for(const k of ['sort','q'])if(query.get(k))keep.set(k,query.get(k));location.assign(location.pathname+(keep.size?'?'+keep:''));}
async function collection(handle){
 const query=listingParams();query.delete('q');
 let data;try{data=await api('collections/'+handle+(query.size?'?'+query:''));}catch(e){return notFound('Collection not found','This collection is not available.');}
 const c=data.collection;
 meta('description',plainText(c.description||c.title));canonical('/collections/'+c.handle);
 await page(c.title,h('nav',{class:'js-breadcrumbs','aria-label':'Breadcrumb'},h('a',{href:'/'},'Home'),' / ',h('span',{'aria-current':'page'},c.title)),h('h1',{},c.title),c.description?(()=>{const d=h('div',{class:'js-description js-rich'});d.append(richText(c.description));return d;})():null,listingBody(data,query,{emptyText:'New pieces are coming to this collection soon.'}));
}
async function search(){
 const query=listingParams(),q=query.get('q')??'';
 const input=h('input',{type:'search',name:'q',id:'search-q',value:q,maxlength:'80',autocomplete:'off',enterkeyhint:'search','aria-label':'Search products'});
 const form=h('form',{role:'search',class:'js-search-form',onsubmit:e=>{e.preventDefault();const v=input.value.trim();location.assign('/search'+(v?'?'+new URLSearchParams({q:v}):''));}},input,h('button',{type:'submit',class:'store-button'},'Search'));
 meta('description','Search Jack Studio products');canonical('/search');
 if(!q){await page('Search',h('h1',{},'Search'),form,h('p',{class:'js-hint'},'Search by product name, collection or code, for example “wallet” or “BAD 40107”.'));input.focus();return;}
 let data;try{data=await api('search?'+query);}catch(e){return page('Search',h('h1',{},'Search'),form,notice(e.message,'error'));}
 if(data.too_short)return page('Search',h('h1',{},'Search'),form,h('p',{class:'js-hint'},'Type at least 2 characters.'));
 await page(`Search: ${data.query}`,h('h1',{},'Search'),form,h('p',{class:'js-hint'},`Results for “${data.query}”`),listingBody(data,query,{emptyText:`No products found for “${data.query}”. Try another word, or browse all products.`}));
}
// Wishlist: product handles saved by the theme's heart buttons (this browser only).
async function wishlist(){
 let handles=[];try{handles=JSON.parse(localStorage.getItem('jack_studio_wishlist'))||[];}catch{}
 handles=[...new Set(handles.filter(x=>typeof x==='string'&&/^[a-z0-9-]{1,100}$/.test(x)))].slice(0,50);
 const head=[h('h1',{},'Wishlist'),h('p',{class:'js-hint'},'Saved in this browser.')];
 if(!handles.length)return page('Wishlist',...head,h('div',{class:'js-empty-state'},h('p',{},'Nothing saved yet. Tap the heart on a product to keep it here.'),h('a',{href:'/collections/all',class:'store-button js-secondary'},'Browse all products')));
 const found=(await Promise.all(handles.map(x=>api('products/'+x).then(d=>d.product).catch(()=>null))));
 const items=found.filter(Boolean),gone=handles.length-items.length;
 const save=list=>{try{localStorage.setItem('jack_studio_wishlist',JSON.stringify(list));}catch{}};
 if(gone)save(items.map(p=>p.handle));
 const cards=items.map(p=>{const prices=p.variants.map(v=>v.price_minor);const c=productCard({title:p.title,url:'/products/'+p.handle,image:p.images?.[0]??null,available:p.variants.some(v=>v.available),price_min:Math.min(...prices),price_max:Math.max(...prices),compare_at_minor:null});
  const wrap=h('div',{class:'js-wish-item'},c,h('button',{type:'button',class:'js-link','aria-label':'Remove '+p.title+' from wishlist',onclick:()=>{save(items.filter(x=>x!==p).map(x=>x.handle));wishlist();}},'Remove'));return wrap;});
 await page('Wishlist',...head,gone?h('p',{class:'js-hint'},`${gone} saved ${gone===1?'item is':'items are'} no longer available and ${gone===1?'was':'were'} removed.`):null,items.length?h('div',{class:'js-grid'},...cards):h('p',{},'Your saved items are no longer available.'));
}
function notFound(title='Page not found',text='This page does not exist or has moved.'){
 document.querySelector('meta[name=robots]')?.setAttribute('content','noindex');
 return page(title,h('h1',{},title),h('p',{},text),h('div',{class:'js-filter-actions'},h('a',{href:'/collections/all',class:'store-button'},'Browse all products'),h('a',{href:'/search',class:'js-link'},'Search')));
}
async function cart(){
 const items=bag();if(!items.length)return page('Your bag',h('h1',{},'Your bag'),h('p',{},'Your bag is empty.'),h('a',{href:'/collections/all',class:'store-button'},'Continue shopping'));
 let q;try{q=await api('cart',{lines:items,discount_code:savedCode()});}catch(e){return page('Your bag',h('h1',{},'Your bag'),notice(e.message,'error'),h('button',{class:'store-button',onclick:()=>{setBag([]);cart();}},'Clear bag'));}
 // A code that no longer applies is dropped, with the reason shown once.
 const codeNote=q.discount_error&&savedCode()?q.discount_error:null;if(q.discount_error)saveCode('');
 // The server's lines are the record (engraving normalised, identical lines merged); the bag follows them.
 setBag(q.lines.map(l=>({variant_id:l.variant_id,quantity:l.quantity,...(l.engraving?{engraving:l.engraving}:{})})));
 const same=l=>i=>i.variant_id===l.variant_id&&(i.engraving??'')===(l.engraving??'');
 const rows=q.lines.map(l=>{const qty=h('input',{type:'number',min:'1',max:'20',value:String(l.quantity),inputmode:'numeric','aria-label':`Quantity for ${l.title||'item'}${l.engraving?' engraved '+l.engraving:''}`,onchange:e=>{const n=Math.max(1,Math.min(20,Number(e.target.value)||1));setBag(bag().map(i=>same(l)(i)?{...i,quantity:n}:i));cart();}});
  return h('div',{class:'js-line'+(l.available===false?' is-unavailable':'')},h('div',{class:'js-line-product'},l.handle?h('a',{href:'/products/'+l.handle,tabindex:'-1','aria-hidden':'true'},picture(l.image,{cls:'js-line-image',sizes:'72px'})):picture(null,{cls:'js-line-image'}),h('div',{},l.handle?h('a',{href:'/products/'+l.handle,class:'js-line-title'},h('strong',{},l.title)):h('strong',{},'Unavailable item'),l.variant_title?h('small',{},l.variant_title):null,l.engraving?h('small',{class:'js-engraving'},`${l.engraving_label||'Engraving'}: ${l.engraving}`):null,l.engraving_error?h('small',{class:'js-warn'},l.engraving_error+' Remove this item and add it again from the product page.'):l.available===false?h('small',{class:'js-warn'},l.title?'Not enough stock for this quantity':'No longer available'):l.low?h('small',{},'Only a few left'):null)),l.title?h('span',{},price(l.unit_price_minor)):h('span'),qty,h('span',{},l.title?price(l.line_total_minor):'—'),h('button',{type:'button',class:'js-link','aria-label':`Remove ${l.title||'item'}${l.engraving?' engraved '+l.engraving:''}`,onclick:()=>{setBag(bag().filter(i=>!same(l)(i)));cart();}},'Remove'));});
 const blocked=q.lines.some(l=>l.available===false)||q.shipping_error;
 page('Your bag',h('h1',{},'Your bag'),h('div',{class:'js-lines'},...rows),summary(q),codeForm(q,codeNote),policyLinks(),blocked?notice(q.shipping_error||'Update your bag to continue.','error'):null,h('div',{class:'js-actions'},h('a',{href:'/collections/all',class:'js-link'},'Continue shopping'),h('a',{href:blocked?'#':'/checkout',class:'store-button','aria-disabled':blocked?'true':false,onclick:e=>{if(blocked)e.preventDefault();}},'Checkout')));
}
function summary(q){return h('dl',{class:'js-summary'},h('dt',{},'Subtotal'),h('dd',{},price(q.subtotal_minor)),h('dt',{},'Shipping'),h('dd',{},q.shipping_minor==null?'—':q.shipping_minor?price(q.shipping_minor):'Free'),...(q.shipping_names?.length?[h('dt',{class:'js-ship-name'},''),h('dd',{class:'js-ship-name'},q.shipping_names.join(' · '))]:[]),...(q.discounts??[]).flatMap(d=>[h('dt',{class:'js-discount'},d.code?`Discount (${d.code})`:d.title),h('dd',{class:'js-discount'},'−'+price(d.amount_minor))]),...(!q.discounts&&q.discount_minor?[h('dt',{class:'js-discount'},'Discount'),h('dd',{class:'js-discount'},'−'+price(q.discount_minor))]:[]),h('dt',{class:'js-total'},'Total'),h('dd',{class:'js-total'},q.total_minor==null?'—':price(q.total_minor)));}
function codeForm(q,note){
 const applied=(q.discounts??[]).find(d=>d.code);
 if(applied)return h('div',{class:'js-code'},h('p',{class:'js-code-applied'},h('span',{},`Code ${applied.code} applied · ${applied.title}`),h('button',{type:'button',class:'js-link',onclick:()=>{saveCode('');cart();}},'Remove code')));
 const input=h('input',{name:'discount_code',autocomplete:'off',autocapitalize:'characters',maxlength:'32',spellcheck:'false'});
 const msg=h('p',{class:'js-code-msg',role:'status'},note?notice(note,'error'):'');
 const form=h('form',{class:'js-code',onsubmit:async e=>{e.preventDefault();const code=input.value.trim();if(!code)return;const b=form.querySelector('button');b.disabled=true;
  try{const r=await api('cart',{lines:bag(),discount_code:code});if(r.discount_error){msg.replaceChildren(notice(r.discount_error,'error'));b.disabled=false;return;}saveCode(r.discount_code);cart();}
  catch(err){msg.replaceChildren(notice(err.message,'error'));b.disabled=false;}}},
  h('label',{},'Discount code',h('span',{class:'js-code-row'},input,h('button',{type:'submit',class:'store-button store-button--secondary'},'Apply'))),msg);
 return form;
}
async function checkout(){
 const items=bag();if(!items.length){location.replace('/cart');return;}
 let q;try{q=await api('cart',{lines:items,discount_code:savedCode()});}catch(e){return page('Checkout',notice(e.message,'error'));}
 if(q.discount_error&&savedCode()){saveCode('');location.replace('/cart');return;}
 if(q.lines.some(l=>l.available===false)||q.shipping_error){location.replace('/cart');return;}
 const field=(label,name,attrs={})=>h('label',{},label,h('input',{name,required:true,...attrs}));
 const form=h('form',{class:'js-form'},
  h('h2',{},'Contact'),field('Full name','name',{autocomplete:'name',maxlength:'120'}),field('Email','email',{type:'email',autocomplete:'email',maxlength:'254'}),field('Phone','phone',{type:'tel',autocomplete:'tel',maxlength:'30'}),
  h('h2',{},'Delivery (Malaysia)'),field('Address','address_line1',{autocomplete:'address-line1',maxlength:'200'}),field('Address line 2 (optional)','address_line2',{autocomplete:'address-line2',maxlength:'200',required:false}),
  h('div',{class:'js-row'},field('Postcode','postcode',{inputmode:'numeric',pattern:'[0-9]{5}',maxlength:'5',autocomplete:'postal-code'}),field('City','city',{autocomplete:'address-level2',maxlength:'100'})),
  h('label',{},'State',h('select',{name:'state',required:true},h('option',{value:''},'Choose a state'),...STATES.map(s=>h('option',{value:s},s)))),
  h('label',{},'Order note (optional)',h('textarea',{name:'note',maxlength:'500',rows:'2'})),
  h('div',{class:'js-trap','aria-hidden':'true'},h('label',{},'Website',h('input',{name:'website',tabindex:'-1',autocomplete:'off'}))),
  h('p',{class:'js-fine'},'Continue to the payment page. Your items are held for 30 minutes; bank-pending payments may take longer to confirm.'),
  h('button',{class:'store-button',type:'submit'},`Pay ${price(q.total_minor)}`),h('div',{id:'checkout-msg'}));
 form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('button[type=submit]'),msg=form.querySelector('#checkout-msg');button.disabled=true;msg.replaceChildren(notice('Holding your items…'));
  // One attempt id per bag, so a double click or a retry after a network error never creates two orders.
  const sig=JSON.stringify([items,savedCode()]);let attempt=read(sessionStorage,ATTEMPT,null);if(!attempt||attempt.sig!==sig){attempt={sig,key:crypto.randomUUID(),token:random()};write(sessionStorage,ATTEMPT,attempt);}
  const customer=Object.fromEntries(new FormData(form));
  try{const r=await api('checkout',{idempotency_key:attempt.key,access_token:attempt.token,customer,lines:items,discount_code:savedCode()});const orders=read(localStorage,ORDERS,{});orders[r.order.number]=attempt.token;write(localStorage,ORDERS,orders);setBag([]);saveCode('');sessionStorage.removeItem(ATTEMPT);msg.replaceChildren(notice('Taking you to secure payment…'));pay(r.payment,r.order.number);}
  catch(err){msg.replaceChildren(notice(err.message,'error'));button.disabled=false;if(err.status===409)sessionStorage.removeItem(ATTEMPT);}
 });
 page('Checkout',h('h1',{},'Checkout'),h('div',{class:'js-checkout'},form,h('aside',{class:'js-aside'},h('h2',{},'Order summary'),...q.lines.map(l=>h('p',{class:'js-mini'},`${l.quantity} × ${l.title}${l.variant_title?' · '+l.variant_title:''}${l.engraving?' · Engraving: '+l.engraving:''}`,h('span',{},price(l.line_total_minor)))),summary(q))));
}
function pay(payment,number){
 if(!payment)return void location.assign('/order/'+number);
 if(new URL(payment.action,location.href).pathname==='/pay/mock')return void location.assign('/pay/mock#'+encodeURIComponent(number));
 const form=h('form',{method:'POST',action:payment.action,class:'js-hidden'},...Object.entries(payment.fields).map(([k,v])=>h('input',{type:'hidden',name:k,value:v})));document.body.append(form);form.submit();
}
const STATUS={pending_payment:['Awaiting payment','Complete your payment to confirm this order.'],paid:['Thank you — your order is confirmed','We are preparing your items.'],expired:['Payment time ended','Your items were released. Please place a new order.'],cancelled:['Order cancelled','This order was cancelled.']};
async function order(number,polls=0){
 const token=read(localStorage,ORDERS,{})[number];
 if(!number||!token)return page('Order',h('h1',{},'Order'),h('p',{},'We could not find this order on this device. Please contact us with your order number.'),h('a',{href:'/',class:'store-button'},'Back to home'));
 let o;try{o=(await api(`orders/${number}/status`,{access_token:token})).order;}catch(e){return page('Order',h('h1',{},'Order not found'),notice(e.message,'error'));}
 const [title,copy]=STATUS[o.status];const waiting=o.status==='pending_payment'&&['initiated','pending'].includes(o.payment_status)&&polls<30;
 const extra=[];
 if(o.status==='pending_payment'&&o.payment_status==='pending')extra.push(notice('Your bank is still confirming the payment. This page updates automatically.'));
 if(o.status==='pending_payment'&&new Date(o.expires_at)>new Date()&&['failed','initiated',null].includes(o.payment_status))extra.push(h('button',{class:'store-button',type:'button',onclick:async e=>{e.target.disabled=true;try{const r=await api(`orders/${number}/pay`,{access_token:token});pay(r.payment,number);}catch(err){e.target.replaceWith(notice(err.message,'error'));}}},o.payment_status==='failed'?'Try payment again':'Pay now'));
 if(o.status==='pending_payment'&&o.payment_status==='failed')extra.unshift(notice('The payment was not completed. You can try again while your items are held.','error'));
 page(title,h('p',{class:'js-eyebrow'},'ORDER '+o.number),h('h1',{},title),h('p',{},copy),...extra,
  h('div',{class:'js-lines'},...o.lines.map(l=>h('div',{class:'js-line'},h('div',{},h('strong',{},l.title),l.variant_title?h('small',{},l.variant_title):null,l.personalization?h('small',{class:'js-engraving'},'Engraving: '+l.personalization):null),h('span',{},price(l.unit_price_minor)),h('span',{},'× '+l.quantity),h('span',{},price(l.line_total_minor))))),
  summary({...o,shipping_names:o.shipping_names?[o.shipping_names]:[]}),
  o.status==='paid'?h('p',{class:'js-fine'},`Delivering to ${o.city}, ${o.state}.${o.fulfillment_status==='fulfilled'?' Shipped'+(o.tracking_number?' · Tracking '+o.tracking_number:'')+'.':''}${o.refunded_minor?' Refunded '+price(o.refunded_minor)+'.':''}`):null,
  h('a',{href:'/collections/all',class:'js-link'},'Continue shopping'));
 if(waiting)setTimeout(()=>order(number,polls+1),4000);
}
async function mock(){
 const number=decodeURIComponent(location.hash.slice(1)),token=read(localStorage,ORDERS,{})[number];
 if(!token)return page('Test payment',h('h1',{},'Test payment'),notice('Order not found on this device.','error'));
 const o=(await api(`orders/${number}/status`,{access_token:token})).order;
 const go=outcome=>async e=>{e.target.disabled=true;const r=await fetch('/api/v3/payments/mock/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number,access_token:token,outcome})});if(!r.ok){e.target.replaceWith(notice('Test payment unavailable.','error'));return;}location.assign('/order/'+number);};
 page('Test payment',h('p',{class:'js-eyebrow'},'STAGING · NO REAL MONEY'),h('h1',{},'eGHL test payment'),h('p',{},`Order ${o.number} · ${price(o.total_minor)}`),h('p',{class:'js-fine'},'This stands in for the eGHL payment page until sandbox credentials are configured. Each button sends a signed gateway callback through the same verification as eGHL.'),
  h('div',{class:'js-actions'},h('button',{class:'store-button',type:'button',onclick:go('approve')},'Approve payment'),h('button',{class:'store-button js-secondary',type:'button',onclick:go('decline')},'Decline'),h('button',{class:'store-button js-secondary',type:'button',onclick:go('pending')},'Bank pending')));
}
updateBadges();
const path=location.pathname.replace(/\/+$/,'');
const route=path.match(/^\/products\/([a-z0-9-]+)$/)?.[1],coll=path==='/collections'?'all':path.match(/^\/collections\/([a-z0-9-]+)$/)?.[1];
(route?product(route):coll?collection(coll):path==='/cart'?cart():path==='/checkout'?checkout():path.startsWith('/order')?order(path.split('/')[2]):path==='/pay/mock'?mock():path==='/search'?search():path==='/pages/wishlist'||path==='/wishlist'?wishlist():notFound()).catch(e=>page('Error',notice(e.message||'Something went wrong.','error')));
