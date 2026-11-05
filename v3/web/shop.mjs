// Storefront: product, bag, checkout, order status and the staging-only mock payment page.
// The browser never decides prices or totals; every number shown comes from the server.
const STATES=['Johor','Kedah','Kelantan','Kuala Lumpur','Labuan','Melaka','Negeri Sembilan','Pahang','Penang','Perak','Perlis','Putrajaya','Sabah','Sarawak','Selangor','Terengganu'];
const BAG='js-bag',ORDERS='js-orders',ATTEMPT='js-checkout-attempt';
const price=n=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format((n??0)/100);
const read=(store,k,f)=>{try{return JSON.parse(store.getItem(k))??f;}catch{return f;}};
const write=(store,k,v)=>{try{store.setItem(k,JSON.stringify(v));}catch{}};
const root=document.getElementById('shop-root');
function h(tag,props={},...kids){const n=document.createElement(tag);for(const [k,v] of Object.entries(props??{})){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)n.setAttribute(k,v===true?'':v);}for(const c of kids.flat())if(c!=null&&c!==false)n.append(c instanceof Node?c:String(c));return n;}
async function api(path,body){const r=await fetch('/api/v3/storefront/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(data.error||'Something went wrong. Please try again.'),{status:r.status});return data;}
const bag=()=>read(localStorage,BAG,[]);
function setBag(items){write(localStorage,BAG,items.filter(i=>i.quantity>0));count();}
function count(){const n=bag().reduce((s,i)=>s+i.quantity,0);const el=document.getElementById('bag-count');if(el)el.textContent=String(n);}
function page(title,...kids){document.title=`${title} | Jack Studio`;root.replaceChildren(h('section',{class:'store-section'},h('div',{class:'store-section-inner js-shop'},...kids)));}
const notice=(text,kind='')=>h('p',{class:'js-notice '+kind,role:kind==='error'?'alert':'status'},text);
const random=()=>{const b=new Uint8Array(32);crypto.getRandomValues(b);return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};

async function product(handle){
 let data;try{data=await api('products/'+handle);}catch(e){return page('Product not found',h('h1',{},'Product not found'),h('p',{},'It may be unavailable. '),h('a',{href:'/',class:'store-button'},'Back to home'));}
 const p=data.product,names=p.option_names??[];const chosen=names.map((_,i)=>p.variants.find(v=>v.available)?.option_values[i]??p.variants[0]?.option_values[i]);
 const priceEl=h('p',{class:'js-product-price'}),stock=h('p',{class:'js-stock'}),qty=h('input',{type:'number',min:'1',max:'20',value:'1',id:'qty'}),add=h('button',{class:'store-button',type:'button'},'Add to bag'),msg=h('div');
 const current=()=>p.variants.find(v=>v.option_values.every((x,i)=>x===chosen[i]))??(names.length?null:p.variants[0]);
 const update=()=>{const v=current();priceEl.textContent=v?price(v.price_minor):'Unavailable';stock.textContent=!v?'This combination is not available.':!v.available?'Sold out':v.low?'Only a few left':'In stock';add.disabled=!v||!v.available;};
 const pickers=names.map((name,i)=>{const values=[...new Set(p.variants.map(v=>v.option_values[i]))];const s=h('select',{id:'opt'+i,onchange:e=>{chosen[i]=e.target.value;update();}},...values.map(v=>h('option',{value:v,selected:v===chosen[i]},v)));return h('label',{},name,s);});
 add.addEventListener('click',()=>{const v=current(),n=Number(qty.value);if(!v||!Number.isInteger(n)||n<1||n>20){msg.replaceChildren(notice('Choose a quantity from 1 to 20.','error'));return;}const items=bag(),line=items.find(i=>i.variant_id===v.id);if(line)line.quantity=Math.min(20,line.quantity+n);else items.push({variant_id:v.id,quantity:n});setBag(items);msg.replaceChildren(notice('Added to your bag. ',''),h('a',{href:'/cart'},'View bag'));});
 page(p.title,h('div',{class:'js-product'},h('div',{class:'js-card-image js-image-placeholder',role:'img','aria-label':p.title}),h('div',{class:'js-product-copy'},h('p',{class:'js-eyebrow'},'JACK STUDIO'),h('h1',{},p.title),priceEl,stock,...pickers,h('label',{},'Quantity',qty),add,msg,h('div',{class:'js-description'},...String(p.description||'').split(/\n{2,}/).filter(Boolean).map(t=>h('p',{},t))))));
 update();
}
async function cart(){
 const items=bag();if(!items.length)return page('Your bag',h('h1',{},'Your bag'),h('p',{},'Your bag is empty.'),h('a',{href:'/',class:'store-button'},'Continue shopping'));
 let q;try{q=await api('cart',{lines:items});}catch(e){return page('Your bag',h('h1',{},'Your bag'),notice(e.message,'error'),h('button',{class:'store-button',onclick:()=>{setBag([]);cart();}},'Clear bag'));}
 const rows=q.lines.map(l=>{const qty=h('input',{type:'number',min:'1',max:'20',value:String(l.quantity),'aria-label':`Quantity for ${l.title||'item'}`,onchange:e=>{const n=Math.max(1,Math.min(20,Number(e.target.value)||1));setBag(bag().map(i=>i.variant_id===l.variant_id?{...i,quantity:n}:i));cart();}});
  return h('div',{class:'js-line'+(l.available===false?' is-unavailable':'')},h('div',{},h('strong',{},l.title||'Unavailable item'),l.variant_title?h('small',{},l.variant_title):null,l.available===false?h('small',{class:'js-warn'},l.title?'Not enough stock for this quantity':'No longer available'):l.low?h('small',{},'Only a few left'):null),l.title?h('span',{},price(l.unit_price_minor)):h('span'),qty,h('span',{},l.title?price(l.line_total_minor):'—'),h('button',{type:'button',class:'js-link',onclick:()=>{setBag(bag().filter(i=>i.variant_id!==l.variant_id));cart();}},'Remove'));});
 const blocked=q.lines.some(l=>l.available===false)||q.shipping_error;
 page('Your bag',h('h1',{},'Your bag'),h('div',{class:'js-lines'},...rows),summary(q),blocked?notice(q.shipping_error||'Update your bag to continue.','error'):null,h('div',{class:'js-actions'},h('a',{href:'/',class:'js-link'},'Continue shopping'),h('a',{href:blocked?'#':'/checkout',class:'store-button','aria-disabled':blocked?'true':false,onclick:e=>{if(blocked)e.preventDefault();}},'Checkout')));
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
  h('p',{class:'js-fine'},'You will pay securely on the eGHL payment page (online banking, cards and e-wallets). Your items are held for 30 minutes.'),
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
  h('a',{href:'/',class:'js-link'},'Continue shopping'));
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
count();
const path=location.pathname.replace(/\/+$/,'');
const route=path.match(/^\/products\/([a-z0-9-]+)$/)?.[1];
(route?product(route):path==='/cart'?cart():path==='/checkout'?checkout():path.startsWith('/order')?order(path.split('/')[2]):path==='/pay/mock'?mock():page('Not found',h('h1',{},'Page not found'))).catch(e=>page('Error',notice(e.message||'Something went wrong.','error')));
