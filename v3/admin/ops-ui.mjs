// Discounts, Analytics and email delivery (Settings). Text is set with DOM text APIs only.
import {formatPrice,moneyToMinor} from './money.mjs';
export function createOps(h){
 const {api,root,notify,readOnly,el,button,field,select,all,current,setDirty,navigate}=h;
 const when=v=>v?new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(v)):'—';
 const tableOf=(headings,label)=>{const wrap=el('div',undefined,'table-wrap'),t=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');for(const x of headings)tr.append(el('th',x));head.append(tr);t.append(head,body);wrap.append(t);wrap.setAttribute('aria-label',label);return {wrap,body};};
 const td=(tr,text,cls)=>{const c=el('td',text);if(cls)c.className=cls;tr.append(c);return c;};
 const unavailable=(e)=>{const box=el('div',undefined,'error-state');box.setAttribute('role','alert');box.append(el('p',e.message));root.append(box);};
 const describe=d=>d.kind==='percentage'?`${d.value}% off`:d.kind==='fixed'?`${formatPrice(d.value)} off`:'Free shipping';
 const scope=d=>d.applies_to==='all'?'Whole order':d.applies_to==='collections'?`${d.collection_ids.length} collection${d.collection_ids.length===1?'':'s'}`:`${d.product_ids.length} product${d.product_ids.length===1?'':'s'}`;

 async function discounts(ticket){
  let data;try{data=await api('discounts');}catch(e){if(current(ticket))unavailable(e);return;}
  if(!current(ticket))return;
  const add=button('Create discount',()=>edit(null),readOnly);add.classList.add('primary');root.querySelector('.page-actions')?.append(add);
  const rules=el('details',undefined,'card rules-card');rules.append(el('summary','How discounts combine'));
  for(const t of ['One product discount per order: the customer’s code, or the best automatic discount if it saves more.','One free-shipping discount, which can be used together with a product discount.','Minimum spend is the bag subtotal before discounts. A fixed amount never exceeds the eligible items.','Usage limits count orders. An unpaid order that is cancelled or expires gives its use back; a refund does not.','Prices, discounts and shipping are always recalculated on the server at checkout.'])rules.append(el('p',t));
  root.append(rules);
  if(!data.items.length){const box=el('div',undefined,'empty-state');box.append(el('p','No discounts yet.'));root.append(box);return;}
  root.append(el('p',`${data.items.length} discount${data.items.length===1?'':'s'}`,'result-count'));
  const {wrap,body}=tableOf(['Discount','Code','Type','Applies to','Status','Used','Action'],'Discounts table');root.append(wrap);
  for(const d of data.items){const tr=el('tr');td(tr,d.title);td(tr,d.code??'Automatic');td(tr,describe(d)+(d.min_subtotal_minor?` · min ${formatPrice(d.min_subtotal_minor)}`:''));td(tr,scope(d));
   const st=el('td');st.append(el('span',d.status,'badge '+(d.status==='active'?'active':'draft')));tr.append(st);
   td(tr,`${d.used_count}${d.usage_limit?' / '+d.usage_limit:''}`);const act=el('td');act.append(button(readOnly?'View':'Edit',()=>edit(d.id)));tr.append(act);body.append(tr);}
 }
 const localInput=v=>{if(!v)return '';const d=new Date(v);const p=n=>String(n).padStart(2,'0');const my=new Date(d.getTime()+8*3600e3);return `${my.getUTCFullYear()}-${p(my.getUTCMonth()+1)}-${p(my.getUTCDate())}T${p(my.getUTCHours())}:${p(my.getUTCMinutes())}`;};
 const fromLocal=v=>v?new Date(v+':00+08:00').toISOString():null;
 async function edit(id){
  const d=id?await api('discounts/'+id):{title:'',code:'',kind:'percentage',value:10,applies_to:'all',collection_ids:[],product_ids:[],min_subtotal_minor:0,starts_at:new Date().toISOString(),ends_at:null,usage_limit:null,once_per_customer:false,active:true};
  const [collections,products]=await Promise.all([all('collections'),all('products')]);
  root.replaceChildren();const head=el('div',undefined,'page-heading'),copy=el('div');const crumb=el('p',undefined,'breadcrumb');crumb.append(el('span','Discounts'));copy.append(crumb,el('h1',id?'Edit discount':'Create discount'),el('p',id?`Used ${d.used_count} time${d.used_count===1?'':'s'} · ${d.paid_orders} paid order${d.paid_orders===1?'':'s'} saved customers ${formatPrice(d.saved_minor)}`:'Codes customers type at checkout, or automatic discounts.','muted'));head.append(copy);root.append(head);
  const form=el('form',undefined,'card discount-form');let dirty=false;const touch=()=>{dirty=true;setDirty(true);};form.addEventListener('input',touch);form.addEventListener('change',touch);
  const method=select([['code','Discount code'],['automatic','Automatic discount']],d.code?'code':id?'automatic':'code');const methodL=el('label','Method');methodL.append(method);
  const code=field('Code (customers type this; letters, numbers, - and _)',d.code??'');code.input.maxLength=32;code.input.autocapitalize='characters';
  const title=field('Title (shown on the bag, order and email)',d.title);title.input.maxLength=120;
  const kind=select([['percentage','Percentage off'],['fixed','Fixed amount off'],['free_shipping','Free shipping']],d.kind);const kindL=el('label','Type');kindL.append(kind);
  const value=field(d.kind==='fixed'?'Amount (MYR)':'Percentage',d.kind==='fixed'?(d.value/100).toFixed(2):String(d.value),'text');value.input.inputMode='decimal';
  const applies=select([['all','Whole order'],['collections','Specific collections'],['products','Specific products']],d.applies_to);const appliesL=el('label','Applies to');appliesL.append(applies);
  const pickBox=el('fieldset',undefined,'pick-list');
  const min=field('Minimum spend (MYR, optional)',d.min_subtotal_minor?(d.min_subtotal_minor/100).toFixed(2):'');min.input.inputMode='decimal';
  const starts=field('Starts (Malaysia time)',localInput(d.starts_at),'datetime-local'),ends=field('Ends (optional)',localInput(d.ends_at),'datetime-local');
  const limit=field('Total uses (optional)',d.usage_limit?String(d.usage_limit):'','number');limit.input.min=1;
  const once=field('Once per customer (email)','','checkbox');once.input.checked=!!d.once_per_customer;
  const active=field('Active','','checkbox');active.input.checked=d.active!==false;
  const sync=()=>{code.wrap.hidden=method.value!=='code';value.wrap.hidden=kind.value==='free_shipping';value.wrap.firstChild.textContent=kind.value==='fixed'?'Amount (MYR)':'Percentage';appliesL.hidden=kind.value==='free_shipping';if(kind.value==='free_shipping')applies.value='all';
   pickBox.replaceChildren();pickBox.hidden=applies.value==='all';if(applies.value==='all')return;
   const list=applies.value==='collections'?collections.map(c=>[String(c.id),c.title]):products.map(p=>[String(p.id),p.title]);const chosen=new Set((applies.value==='collections'?d.collection_ids:d.product_ids).map(String));
   pickBox.append(el('legend',applies.value==='collections'?'Collections':'Products'));const scroll=el('div',undefined,'pick-scroll');for(const [pid,t] of list){const f=field(t,'','checkbox');f.input.value=pid;f.input.checked=chosen.has(pid);scroll.append(f.wrap);}pickBox.append(scroll);};
  for(const n of [method,kind,applies])n.addEventListener('change',sync);sync();
  const save=button(id?'Save discount':'Create discount',async()=>{
   const toMinor=v=>moneyToMinor(String(v).trim());
   const body={title:title.input.value,code:method.value==='code'?code.input.value:null,kind:kind.value,value:kind.value==='free_shipping'?0:kind.value==='fixed'?toMinor(value.input.value):Number(value.input.value),applies_to:applies.value,
    collection_ids:applies.value==='collections'?[...pickBox.querySelectorAll('input:checked')].map(i=>i.value):[],product_ids:applies.value==='products'?[...pickBox.querySelectorAll('input:checked')].map(i=>i.value):[],
    min_subtotal_minor:min.input.value.trim()?toMinor(min.input.value):0,starts_at:fromLocal(starts.input.value),ends_at:fromLocal(ends.input.value),usage_limit:limit.input.value?Number(limit.input.value):null,once_per_customer:once.input.checked,active:active.input.checked};
   if(method.value==='code'&&!body.code)throw Error('Enter a code, or choose Automatic discount');
   const saved=id?await api('discounts/'+id,{...body,revision:d.revision},'PATCH'):await api('discounts',body);
   dirty=false;setDirty(false);notify(id?'Discount saved.':'Discount created.');return edit(saved.id);},readOnly);save.classList.add('primary');
  const back=button('Back to discounts',()=>{if(dirty&&!window.confirm('Discard unsaved changes?'))return;setDirty(false);return navigate('Discounts');});
  form.append(methodL,code.wrap,title.wrap,kindL,value.wrap,appliesL,pickBox,min.wrap,starts.wrap,ends.wrap,limit.wrap,once.wrap,active.wrap);
  if(readOnly)for(const n of form.querySelectorAll('input,select'))n.disabled=true;
  const actions=el('div',undefined,'actions');actions.append(save,back);form.append(actions);root.append(form);
 }

 // --- Analytics ----------------------------------------------------------------------------------
 let range={preset:'30'};
 async function analytics(ticket){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur'}).format(new Date());
  const shift=(d,n)=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
  const presets={today:[today,today],'7':[shift(today,-6),today],'30':[shift(today,-29),today],month:[today.slice(0,8)+'01',today],custom:[range.from??shift(today,-29),range.to??today]};
  const [from,to]=presets[range.preset]??presets['30'];
  const tools=el('form',undefined,'toolbar report-tools');const preset=select([['today','Today'],['7','Last 7 days'],['30','Last 30 days'],['month','This month'],['custom','Custom range']],range.preset);preset.setAttribute('aria-label','Date range');
  const f=field('From',from,'date'),t=field('To',to,'date');const apply=el('button','Show');tools.append(preset,f.wrap,t.wrap,apply);root.append(tools);
  const syncCustom=()=>{const c=preset.value==='custom';f.wrap.hidden=!c;t.wrap.hidden=!c;};syncCustom();
  preset.addEventListener('change',()=>{syncCustom();if(preset.value!=='custom'){range={preset:preset.value};navigate('Analytics',true).catch(e=>notify(e.message));}});
  tools.addEventListener('submit',e=>{e.preventDefault();range=preset.value==='custom'?{preset:'custom',from:f.input.value,to:t.input.value}:{preset:preset.value};navigate('Analytics',true).catch(err=>notify(err.message));});
  let r;try{r=await api(`reports?from=${from}&to=${to}`);}catch(e){if(current(ticket))unavailable(e);return;}
  if(!current(ticket))return;
  const s=r.summary,grid=el('div',undefined,'metrics dashboard-primary');
  for(const [label,v,note] of [['Net sales',formatPrice(s.net_sales_minor),'Collected − refunds'],['Orders',String(s.orders),'Paid in this period'],['Average order value',formatPrice(s.average_order_minor),'Collected ÷ orders'],['Refunds',formatPrice(s.refunds_minor),`${s.refund_count} recorded`]]){const c=el('section',undefined,'card metric');c.append(el('span',label,'muted'),el('strong',v),el('small',note,'cell-note'));grid.append(c);}
  root.append(el('p',`${r.from} to ${r.to} · Malaysia time`,'result-count'),grid);
  const breakdown=el('section',undefined,'card');breakdown.append(el('h2','Sales breakdown'));const dl=el('dl',undefined,'report-breakdown');
  for(const [k,v] of [['Gross sales (items)',formatPrice(s.gross_sales_minor)],['Discounts','−'+formatPrice(s.discounts_minor)],['Shipping charged',formatPrice(s.shipping_minor)],['Total collected',formatPrice(s.collected_minor)],['Refunds recorded','−'+formatPrice(s.refunds_minor)],['Net sales',formatPrice(s.net_sales_minor)],['Unpaid orders cancelled / expired',`${s.cancelled_orders} / ${s.expired_orders}`]]){dl.append(el('dt',k),el('dd',v));}
  breakdown.append(dl);root.append(breakdown);
  // Daily collected amount as simple bars, with a text table for screen readers and exact values.
  const chart=el('section',undefined,'card');chart.append(el('h2','Collected per day'));const max=Math.max(1,...r.series.map(d=>d.collected_minor));
  const bars=el('div',undefined,'report-bars');bars.setAttribute('aria-hidden','true');for(const d of r.series){const b=el('span',undefined,'report-bar');b.style.height=`${Math.round(d.collected_minor/max*100)}%`;b.title=`${d.day}: ${formatPrice(d.collected_minor)} · ${d.orders} orders`;bars.append(b);}
  chart.append(bars);const details=el('details');details.append(el('summary','Show daily figures'));const daily=tableOf(['Day','Orders','Collected'],'Daily figures');for(const d of r.series){const tr=el('tr');td(tr,d.day);td(tr,String(d.orders));td(tr,formatPrice(d.collected_minor));daily.body.append(tr);}details.append(daily.wrap);chart.append(details);root.append(chart);
  const top=el('section',undefined,'card');top.append(el('h2','Best-selling products'));
  if(!r.top_products.length)top.append(el('p','No paid orders in this period.','muted'));else{const tb=tableOf(['Product','Units','Item revenue'],'Best-selling products');for(const p of r.top_products){const tr=el('tr');td(tr,p.title);td(tr,String(p.units));td(tr,formatPrice(p.revenue_minor));tb.body.append(tr);}top.append(tb.wrap);}
  root.append(top);
  const inv=el('section',undefined,'card');inv.append(el('h2','Stock now'),el('p',`${r.inventory.variants_in_stock} variants in stock · ${r.inventory.variants_low} low (5 or fewer) · ${r.inventory.variants_out} out of stock`));inv.append(button('Open inventory',()=>navigate('Inventory')));root.append(inv);
  const notes=el('details',undefined,'card rules-card');notes.append(el('summary','How these numbers are counted'));
  for(const x of ['Orders count on the day they were paid. Unpaid, cancelled and expired orders are not sales.','Refunds count on the day they were recorded, whichever day the order was paid.','Net sales = total collected − refunds in this period.','Best sellers use item prices before order discounts.','There is no conversion rate yet: the store does not record visits.'])notes.append(el('p',x));
  root.append(notes);
 }

 // --- Email delivery (Settings) -------------------------------------------------------------------
 async function email(ticket){
  let s;try{s=await api('email');}catch(e){return;}
  if(!current(ticket))return;
  const card=el('section',undefined,'card email-card');card.append(el('h2','Customer emails'));
  if(!s.configured)card.append(el('p','Not sending: '+s.reason,'warning-note'));
  else card.append(el('p',s.mode==='live'?'Sending to customers.':`Test mode: every email goes to ${s.test_recipient}, not to customers.`,'muted'));
  card.append(el('p',`${s.counts.pending} waiting · ${s.counts.sent} sent · ${s.counts.failed} failed`,'result-count'));
  if(s.configured&&!readOnly)card.append(button('Send waiting emails now',async()=>{const r=await api('email/send',{});notify(r.skipped?r.reason:`Sent ${r.sent}${r.failed?`, ${r.failed} failed (will retry)`:''}.`);await navigate('Settings',true);}));
  if(s.recent.length){const tb=tableOf(['Order','Email','To','Status','Attempts','Last error','Action'],'Recent emails');
   for(const m of s.recent){const tr=el('tr');td(tr,m.number);td(tr,{order_paid:'Order confirmed',order_fulfilled:'Shipped',order_refunded:'Refund'}[m.kind]??m.kind);td(tr,m.recipient);const st=el('td');st.append(el('span',m.status,'badge '+(m.status==='sent'?'active':m.status==='failed'?'archived':'draft')));tr.append(st);td(tr,String(m.attempts));td(tr,m.last_error||'—');
    const a=el('td');if(m.status==='failed'&&!readOnly)a.append(button('Retry',async()=>{await api(`email/${m.id}/retry`,{});notify('Email queued again.');await navigate('Settings',true);}));tr.append(a);tb.body.append(tr);}
   card.append(tb.wrap);}
  root.append(card);
 }
 return {discounts,analytics,email};
}
