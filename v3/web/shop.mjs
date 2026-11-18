// Storefront: product, bag, checkout, order status and the staging-only mock payment page.
// The browser never decides prices or totals; every number shown comes from the server.
const STATES=['Johor','Kedah','Kelantan','Kuala Lumpur','Labuan','Melaka','Negeri Sembilan','Pahang','Penang','Perak','Perlis','Putrajaya','Sabah','Sarawak','Selangor','Terengganu'];
import {bag,setBag,updateBadges} from './bag.mjs';
import {siteData,mountSite} from './liquid-site.mjs';
import './image-fallback.mjs';
const ORDERS='js-orders',ATTEMPT='js-checkout-attempt';
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
 let data;try{data=await api('products/'+handle);}catch(e){return page('Product not found',h('h1',{},'Product not found'),h('p',{},'This product is not available right now. '),h('a',{href:'/collections/all',class:'store-button'},'Browse all products'));}
 const p=data.product,names=p.option_names??[];const chosen=names.map((_,i)=>p.variants.find(v=>v.available)?.option_values[i]??p.variants[0]?.option_values[i]);
 const images=p.images??[];
 const priceEl=h('p',{class:'js-product-price'}),stock=h('p',{class:'js-stock',role:'status'}),qty=h('input',{type:'number',min:'1',max:'20',value:'1',id:'qty'}),add=h('button',{class:'store-button',type:'button'},'Add to bag'),msg=h('div');
 // Gallery: main image plus thumbnails; choosing a variant with its own image shows that image.
 const main=h('div',{class:'js-gallery-main'});let current_image=null;
 const show=id=>{const img=images.find(i=>i.id===id)??images[0]??null;if(img&&img.id===current_image)return;current_image=img?.id??null;main.replaceChildren(picture(img,{cls:'js-card-image js-product-image',eager:true}));thumbs.forEach(t=>t.setAttribute('aria-current',t.dataset.id===current_image?'true':'false'));};
 const thumbs=images.length>1?images.map((img,i)=>h('button',{type:'button',class:'js-thumb','data-id':img.id,'aria-label':`Show image ${i+1} of ${images.length}`,onclick:()=>show(img.id)},picture(img,{cls:'js-thumb-image',sizes:'80px'}))):[];
 const current=()=>p.variants.find(v=>v.option_values.every((x,i)=>x===chosen[i]))??(names.length?null:p.variants[0]);
 const update=()=>{const v=current();
  priceEl.replaceChildren(v?.compare_at_minor?h('s',{class:'js-compare'},price(v.compare_at_minor)):'',v?.compare_at_minor?' ':'',v?price(v.price_minor):'Unavailable');
  stock.textContent=!v?'This combination is not available.':!v.available?'Sold out':v.low?'Only a few left':'In stock';
  add.disabled=!v||!v.available;add.textContent=v&&!v.available?'Sold out':'Add to bag';
  if(v?.image_id)show(v.image_id);};
 const pickers=names.map((name,i)=>{const values=[...new Set(p.variants.map(v=>v.option_values[i]))];const s=h('select',{id:'opt'+i,onchange:e=>{chosen[i]=e.target.value;update();}},...values.map(v=>h('option',{value:v,selected:v===chosen[i]},v)));return h('label',{},name,s);});
 add.addEventListener('click',()=>{const v=current(),n=Number(qty.value);if(!v||!Number.isInteger(n)||n<1||n>20){msg.replaceChildren(notice('Choose a quantity from 1 to 20.','error'));return;}const items=bag(),line=items.find(i=>i.variant_id===v.id);if(line)line.quantity=Math.min(20,line.quantity+n);else items.push({variant_id:v.id,quantity:n});setBag(items);msg.replaceChildren(notice('Added to your bag. ',''),h('a',{href:'/cart'},'View bag'));});
 const summary=String(p.description||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,155);meta('description',summary);meta('og:title',p.title,'property');meta('og:description',summary,'property');meta('og:type','product','property');if(images[0])meta('og:image',location.origin+images[0].url,'property');canonical('/products/'+p.handle);
 const crumbs=h('nav',{class:'js-breadcrumbs','aria-label':'Breadcrumb'},h('a',{href:'/'},'Home'),' / ',p.collections?.[0]?h('a',{href:'/collections/'+p.collections[0].handle},p.collections[0].title):h('a',{href:'/collections/all'},'All products'),' / ',h('span',{'aria-current':'page'},p.title));
 await page(p.title,crumbs,h('div',{class:'js-product'},h('div',{class:'js-gallery'},main,thumbs.length?h('div',{class:'js-thumbs'},...thumbs):null),h('div',{class:'js-product-copy'},h('p',{class:'js-eyebrow'},'JACK STUDIO'),h('h1',{},p.title),priceEl,stock,...pickers,h('label',{},'Quantity',qty),add,msg,h('div',{class:'js-description'},...String(p.description||'').split(/\n{2,}/).filter(Boolean).map(t=>h('p',{},t))))));
 show(null);update();
}
const SORT_LABELS={featured:'Featured',newest:'Newest','price-asc':'Price, low to high','price-desc':'Price, high to low','title-asc':'Alphabetically, A–Z','title-desc':'Alphabetically, Z–A'};
async function collection(handle){
 const params=new URLSearchParams(location.search),query=new URLSearchParams();
 for(const k of ['sort','available','page'])if(params.get(k))query.set(k,params.get(k));
 let data;try{data=await api('collections/'+handle+(query.size?'?'+query:''));}catch(e){return page('Collection not found',h('h1',{},'Collection not found'),h('p',{},'This collection is not available. '),h('a',{href:'/collections/all',class:'store-button'},'Browse all products'));}
 const c=data.collection,go=changes=>{const next=new URLSearchParams(query);for(const [k,v] of Object.entries(changes)){if(v==null||v===''||v===false)next.delete(k);else next.set(k,v);}if(!('page' in changes))next.delete('page');location.assign(location.pathname+(next.size?'?'+next:''));};
 meta('description',String(c.description||c.title).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,155));canonical('/collections/'+c.handle);
 const sort=h('select',{id:'sort',onchange:e=>go({sort:e.target.value==='featured'?null:e.target.value})},...Object.entries(SORT_LABELS).map(([v,l])=>h('option',{value:v,selected:v===data.sort},l)));
 const stockOnly=h('input',{type:'checkbox',id:'in-stock',checked:data.available_only,onchange:e=>go({available:e.target.checked?'1':null})});
 const toolbar=h('div',{class:'js-toolbar'},h('label',{class:'js-check'},stockOnly,'In stock only'),h('p',{class:'js-count',role:'status'},`${data.total} ${data.total===1?'product':'products'}`),h('label',{class:'js-sort'},'Sort by',sort));
 const empty=!data.products.length?h('div',{class:'js-empty-state'},h('p',{},data.available_only&&data.total===0?'Nothing in stock in this collection right now.':'New pieces are coming to this collection soon.'),data.available_only?h('button',{type:'button',class:'store-button js-secondary',onclick:()=>go({available:null})},'Show all products'):h('a',{href:'/collections/all',class:'store-button js-secondary'},'Browse all products')):null;
 const pager=data.pages>1?h('nav',{class:'js-pager','aria-label':'Pages'},data.page>1?h('a',{href:'?'+new URLSearchParams({...Object.fromEntries(query),page:String(data.page-1)}),rel:'prev'},'Previous'):null,h('span',{},`Page ${data.page} of ${data.pages}`),data.page<data.pages?h('a',{href:'?'+new URLSearchParams({...Object.fromEntries(query),page:String(data.page+1)}),rel:'next'},'Next'):null):null;
 await page(c.title,h('nav',{class:'js-breadcrumbs','aria-label':'Breadcrumb'},h('a',{href:'/'},'Home'),' / ',h('span',{'aria-current':'page'},c.title)),h('h1',{},c.title),c.description?h('div',{class:'js-description'},...String(c.description).replace(/<[^>]*>/g,' ').split(/\n{2,}/).filter(t=>t.trim()).map(t=>h('p',{},t))):null,toolbar,empty??h('div',{class:'js-grid'},...data.products.map(productCard)),pager);
}
async function cart(){
 const items=bag();if(!items.length)return page('Your bag',h('h1',{},'Your bag'),h('p',{},'Your bag is empty.'),h('a',{href:'/collections/all',class:'store-button'},'Continue shopping'));
 let q;try{q=await api('cart',{lines:items});}catch(e){return page('Your bag',h('h1',{},'Your bag'),notice(e.message,'error'),h('button',{class:'store-button',onclick:()=>{setBag([]);cart();}},'Clear bag'));}
 const rows=q.lines.map(l=>{const qty=h('input',{type:'number',min:'1',max:'20',value:String(l.quantity),'aria-label':`Quantity for ${l.title||'item'}`,onchange:e=>{const n=Math.max(1,Math.min(20,Number(e.target.value)||1));setBag(bag().map(i=>i.variant_id===l.variant_id?{...i,quantity:n}:i));cart();}});
  return h('div',{class:'js-line'+(l.available===false?' is-unavailable':'')},h('div',{class:'js-line-product'},l.handle?h('a',{href:'/products/'+l.handle,tabindex:'-1','aria-hidden':'true'},picture(l.image,{cls:'js-line-image',sizes:'72px'})):picture(null,{cls:'js-line-image'}),h('div',{},l.handle?h('a',{href:'/products/'+l.handle,class:'js-line-title'},h('strong',{},l.title)):h('strong',{},'Unavailable item'),l.variant_title?h('small',{},l.variant_title):null,l.available===false?h('small',{class:'js-warn'},l.title?'Not enough stock for this quantity':'No longer available'):l.low?h('small',{},'Only a few left'):null)),l.title?h('span',{},price(l.unit_price_minor)):h('span'),qty,h('span',{},l.title?price(l.line_total_minor):'—'),h('button',{type:'button',class:'js-link',onclick:()=>{setBag(bag().filter(i=>i.variant_id!==l.variant_id));cart();}},'Remove'));});
 const blocked=q.lines.some(l=>l.available===false)||q.shipping_error;
 page('Your bag',h('h1',{},'Your bag'),h('div',{class:'js-lines'},...rows),summary(q),blocked?notice(q.shipping_error||'Update your bag to continue.','error'):null,h('div',{class:'js-actions'},h('a',{href:'/collections/all',class:'js-link'},'Continue shopping'),h('a',{href:blocked?'#':'/checkout',class:'store-button','aria-disabled':blocked?'true':false,onclick:e=>{if(blocked)e.preventDefault();}},'Checkout')));
}
function summary(q){return h('dl',{class:'js-summary'},h('dt',{},'Subtotal'),h('dd',{},price(q.subtotal_minor)),h('dt',{},'Shipping'),h('dd',{},q.shipping_minor==null?'—':q.shipping_minor?price(q.shipping_minor):'Free'),...(q.shipping_names?.length?[h('dt',{class:'js-ship-name'},''),h('dd',{class:'js-ship-name'},q.shipping_names.join(' · '))]:[]),h('dt',{class:'js-total'},'Total'),h('dd',{class:'js-total'},q.total_minor==null?'—':price(q.total_minor)));}
async function checkout(){
 const items=bag();if(!items.length){location.replace('/cart');return;}
 let q;try{q=await api('cart',{lines:items});}catch(e){return page('Checkout',notice(e.message,'error'));}
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
  const sig=JSON.stringify(items);let attempt=read(sessionStorage,ATTEMPT,null);if(!attempt||attempt.sig!==sig){attempt={sig,key:crypto.randomUUID(),token:random()};write(sessionStorage,ATTEMPT,attempt);}
  const customer=Object.fromEntries(new FormData(form));
  try{const r=await api('checkout',{idempotency_key:attempt.key,access_token:attempt.token,customer,lines:items});const orders=read(localStorage,ORDERS,{});orders[r.order.number]=attempt.token;write(localStorage,ORDERS,orders);setBag([]);sessionStorage.removeItem(ATTEMPT);msg.replaceChildren(notice('Taking you to secure payment…'));pay(r.payment,r.order.number);}
  catch(err){msg.replaceChildren(notice(err.message,'error'));button.disabled=false;if(err.status===409)sessionStorage.removeItem(ATTEMPT);}
 });
 page('Checkout',h('h1',{},'Checkout'),h('div',{class:'js-checkout'},form,h('aside',{class:'js-aside'},h('h2',{},'Order summary'),...q.lines.map(l=>h('p',{class:'js-mini'},`${l.quantity} × ${l.title}${l.variant_title?' · '+l.variant_title:''}`,h('span',{},price(l.line_total_minor)))),summary(q))));
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
  h('div',{class:'js-lines'},...o.lines.map(l=>h('div',{class:'js-line'},h('div',{},h('strong',{},l.title),l.variant_title?h('small',{},l.variant_title):null),h('span',{},price(l.unit_price_minor)),h('span',{},'× '+l.quantity),h('span',{},price(l.line_total_minor))))),
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
(route?product(route):coll?collection(coll):path==='/cart'?cart():path==='/checkout'?checkout():path.startsWith('/order')?order(path.split('/')[2]):path==='/pay/mock'?mock():page('Not found',h('h1',{},'Page not found'))).catch(e=>page('Error',notice(e.message||'Something went wrong.','error')));
