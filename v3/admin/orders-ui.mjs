// Orders, Customers and the read-only Settings summary for the staff workspace.
import {moneyToMinor,formatPrice} from './money.mjs';
const ORDER={pending_payment:'Awaiting payment',paid:'Paid',cancelled:'Cancelled',expired:'Expired'};
const FULFIL={unfulfilled:'Unfulfilled',fulfilled:'Fulfilled'};
const PAY={initiated:'Started',pending:'Bank pending',succeeded:'Succeeded',failed:'Failed'};
const when=v=>v?new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'—';
export function createOrders(h){
 const {api,root,notify,readOnly,el,button,field,select,header,table,cell,empty,current,ticket}=h;
 let offset=0,search='',status='';
 const badge=(text,cls)=>el('span',text,'badge '+cls);
 const td=(tr,...nodes)=>{const c=el('td');c.append(...nodes);tr.append(c);return c;};
 async function orders(t){
  const tools=el('form',undefined,'toolbar'),q=field('Search order, name, email or phone',search,'search');
  const filter=select([['','All orders'],['pending_payment','Awaiting payment'],['paid','Paid'],['unfulfilled','To fulfil'],['attention','Needs attention'],['cancelled','Cancelled'],['expired','Expired']],status);filter.setAttribute('aria-label','Filter orders');
  tools.append(q.wrap,filter,el('button','Apply filters'));root.append(tools);
  tools.addEventListener('submit',e=>{e.preventDefault();search=q.input.value;status=filter.value;offset=0;h.navigate('Orders').catch(err=>notify(err.message));});
  const params=new URLSearchParams({paged:'true',limit:'25',offset:String(offset)});if(search)params.set('q',search);if(status)params.set('status',status);
  const data=await api('orders?'+params);if(!current(t))return;
  root.append(el('p',`${data.total} orders · Payments through eGHL · Unpaid orders release stock after 30 minutes`,'muted'));
  if(!data.items.length){empty(search||status?'No matching orders.':'No orders yet. Orders appear here when customers check out.');}
  else{const body=table(['Order','Date','Customer','Items','Total','Payment','Fulfilment','Action']);for(const o of data.items){const tr=el('tr');const first=td(tr,el('span',o.number));if(o.needs_attention)first.append(badge('Needs attention','attention'));cell(tr,when(o.created_at));td(tr,el('span',o.customer_name),el('small',o.email,'cell-note'));cell(tr,String(o.items));cell(tr,formatPrice(o.total_minor)+(o.refunded_minor?` (−${formatPrice(o.refunded_minor)})`:''));td(tr,badge(ORDER[o.status],'order-'+o.status));td(tr,o.status==='paid'?badge(FULFIL[o.fulfillment_status],'fulfil-'+o.fulfillment_status):el('span','—'));td(tr,button('View',()=>detail(o.id)));body.append(tr);}}
  const pages=el('div',undefined,'pagination');pages.append(button('Previous',()=>{offset=Math.max(0,offset-25);return h.navigate('Orders');},offset===0),button('Next',()=>{offset+=25;return h.navigate('Orders');},offset+data.items.length>=data.total));root.append(pages);
 }
 async function detail(id){
  const t=ticket();const o=await api('orders/'+id);if(!current(t))return;
  header('Order '+o.number,`Placed ${when(o.created_at)}${o.paid_at?' · Paid '+when(o.paid_at):''}`);
  const grid=el('div',undefined,'editor-grid'),main=el('section',undefined,'card'),aside=el('section',undefined,'card');root.append(grid);grid.append(main,aside);
  // Items and totals.
  main.append(el('h2','Items'));const wrap=el('div',undefined,'table-wrap'),tb=el('table'),thead=el('thead'),hr=el('tr'),body=el('tbody');for(const x of ['Product','SKU','Price','Qty','Total'])hr.append(el('th',x));thead.append(hr);tb.append(thead,body);wrap.append(tb);main.append(wrap);
  for(const l of o.lines){const tr=el('tr');td(tr,el('span',l.title),...(l.variant_title?[el('small',l.variant_title,'cell-note')]:[]));cell(tr,l.sku||'—');cell(tr,formatPrice(l.unit_price_minor));cell(tr,String(l.quantity));cell(tr,formatPrice(l.line_total_minor));body.append(tr);}
  const totals=el('dl',undefined,'order-totals');for(const [k,v] of [['Subtotal',formatPrice(o.subtotal_minor)],['Shipping',`${formatPrice(o.shipping_minor)} · ${o.shipping_names}`],['Total',formatPrice(o.total_minor)],...(o.refunded_minor?[['Refunded','−'+formatPrice(o.refunded_minor)]]:[])]){totals.append(el('dt',k),el('dd',v));}main.append(totals);
  main.append(el('h2','Customer and delivery'));const addr=el('div',undefined,'order-address');for(const line of [o.customer_name,o.email,o.phone,o.address_line1,o.address_line2,`${o.postcode} ${o.city}`,`${o.state}, Malaysia`])if(line)addr.append(el('p',line));if(o.note)addr.append(el('p','Note: '+o.note,'muted'));main.append(addr);
  // Gateway evidence: every attempt and every verified/unverified message.
  main.append(el('h2','Payments (eGHL)'));
  const pay=el('div',undefined,'table-wrap'),pt=el('table'),ph=el('thead'),phr=el('tr'),pb=el('tbody');for(const x of ['Reference','Amount','Status','Gateway transaction','Updated'])phr.append(el('th',x));ph.append(phr);pt.append(ph,pb);pay.append(pt);main.append(pay);
  for(const p of o.payments){const tr=el('tr');cell(tr,p.payment_ref);cell(tr,formatPrice(p.amount_minor));td(tr,badge(PAY[p.status],'pay-'+p.status));cell(tr,[p.provider_txn_id,p.auth_code].filter(Boolean).join(' · ')||'—');cell(tr,when(p.updated_at));pb.append(tr);}
  if(o.events.length){const list=el('ul',undefined,'event-list');for(const e of o.events)list.append(el('li',`${when(e.received_at)} · ${e.payment_ref} · ${e.source} · ${e.verified?'verified':'NOT verified'} · ${e.outcome}`));main.append(el('p','Gateway messages','field-label'),list);}
  if(o.stock.length){const list=el('ul',undefined,'event-list');for(const s of o.stock)list.append(el('li',`${when(s.created_at)} · ${s.sku??'—'} · ${s.delta>0?'+':''}${s.delta} (${s.reason.replace('_',' ')}) → ${s.quantity_after}`));main.append(el('p','Stock movements','field-label'),list);}
  if(o.emails?.length){const list=el('ul',undefined,'event-list');for(const m of o.emails)list.append(el('li',`${when(m.created_at)} · ${m.subject} → ${m.recipient} · ${m.status==='pending'?'waiting (email not configured)':m.status}`));main.append(el('p','Customer emails','field-label'),list);}
  if(o.refunds.length){const list=el('ul',undefined,'event-list');for(const r of o.refunds)list.append(el('li',`${when(r.created_at)} · ${formatPrice(r.amount_minor)} · ${r.reference}${r.restocked?' · restocked':''}${r.note?' · '+r.note:''} · ${r.actor_role??'staff'}`));main.append(el('p','Refunds','field-label'),list);}
  // Status and actions.
  aside.append(el('h2','Status'));const st=el('p',undefined,'stock-line');st.append(badge(ORDER[o.status],'order-'+o.status));if(o.status==='paid')st.append(badge(FULFIL[o.fulfillment_status],'fulfil-'+o.fulfillment_status));aside.append(st);
  if(o.status==='pending_payment')aside.append(el('p',`Stock is reserved until ${when(o.expires_at)}.`,'muted'));
  if(o.tracking_number)aside.append(el('p','Tracking: '+o.tracking_number));
  const act=async(path,body,message)=>{await api(`orders/${o.id}/${path}`,{revision:o.revision,...body},'POST');await detail(o.id);notify(message);};
  if(o.needs_attention){const box=el('div',undefined,'attention-box'),note=field('How was this resolved?','');note.input.maxLength=300;box.append(el('strong','Needs attention'),el('p',o.attention_note),note.wrap,button('Mark resolved',()=>act('resolve',{note:note.input.value},'Marked as resolved.'),readOnly));aside.append(box);}
  if(o.status==='paid'&&o.fulfillment_status==='unfulfilled'){const tr=field('Tracking number (optional)','');tr.input.maxLength=80;aside.append(el('h2','Fulfil'),tr.wrap,button('Mark as fulfilled',()=>act('fulfil',{tracking_number:tr.input.value},'Order marked as fulfilled.'),readOnly));}
  if(o.status==='pending_payment')aside.append(button('Cancel order and release stock',async()=>{if(!window.confirm('Cancel this unpaid order? Reserved stock is released.'))return;await act('cancel',{},'Order cancelled; stock released.');},readOnly));
  if(o.status==='paid'&&o.refunded_minor<o.total_minor){
   const form=el('form',undefined,'refund-form'),amount=field('Refund amount (MYR)',((o.total_minor-o.refunded_minor)/100).toFixed(2)),ref=field('eGHL refund reference',''),note=field('Note (optional)',''),restock=field('Return items to stock','','checkbox');ref.input.maxLength=80;note.input.maxLength=500;
   const already=o.refunds.some(r=>r.restocked);if(already){restock.input.disabled=true;restock.wrap.append(el('small','Already restocked','cell-note'));}
   const go=el('button','Record refund');go.type='submit';go.disabled=readOnly;
   form.append(el('h2','Refund'),el('p','Process the refund in the eGHL merchant portal first, then record it here.','muted'),amount.wrap,ref.wrap,note.wrap,restock.wrap,go);
   form.addEventListener('submit',async e=>{e.preventDefault();go.disabled=true;try{await act('refunds',{amount_minor:moneyToMinor(amount.input.value),reference:ref.input.value,note:note.input.value,restock:restock.input.checked},'Refund recorded.');}catch(err){notify(err.message);}finally{go.disabled=readOnly;}});
   aside.append(form);
  }
  if(readOnly)for(const n of aside.querySelectorAll('input,textarea,select'))n.disabled=true;
  aside.append(button('Back to orders',()=>h.navigate('Orders')));
 }
 async function customers(t){
  let at=0,q='';
  const tools=el('form',undefined,'toolbar'),s=field('Search name, email or phone','','search');tools.append(s.wrap,el('button','Search'));root.append(tools);
  const out=el('div');root.append(out);
  async function load(){
   const params=new URLSearchParams({limit:'25',offset:String(at)});if(q)params.set('q',q);
   const data=await api('customers?'+params);if(!current(t))return;out.replaceChildren(el('p',`${data.total} customers with paid orders · Member accounts connect with JS Membership later`,'muted'));
   if(!data.items.length){out.append(el('div',q?'No matching customers.':'Customers appear after their first paid order.','empty-state'));return;}
   const wrap=el('div',undefined,'table-wrap'),tb=el('table'),thead=el('thead'),hr=el('tr'),body=el('tbody');for(const x of ['Customer','Email','Phone','State','Orders','Spent','Last order',''])hr.append(el('th',x));thead.append(hr);tb.append(thead,body);wrap.append(tb);out.append(wrap);
   for(const c of data.items){const tr=el('tr');cell(tr,c.name);cell(tr,c.email);cell(tr,c.phone);cell(tr,c.state);cell(tr,String(c.orders));cell(tr,formatPrice(c.spent_minor));cell(tr,when(c.last_order_at));td(tr,button('Orders',()=>{search=c.email;status='';offset=0;return h.navigate('Orders',{keepFilters:true});}));body.append(tr);}
   const pages=el('div',undefined,'pagination');pages.append(button('Previous',()=>{at=Math.max(0,at-25);return load();},at===0),button('Next',()=>{at+=25;return load();},at+data.items.length>=data.total));out.append(pages);
  }
  tools.addEventListener('submit',e=>{e.preventDefault();q=s.input.value.trim();at=0;load().catch(err=>notify(err.message));});
  await load();
 }
 async function settings(t){
  const data=await api('storefront/shipping-rates');if(!current(t))return;
  const card=el('section',undefined,'card');card.append(el('h2','Payments'),el('p','eGHL Payment Gateway (same as the Shopify store). Merchant credentials are set as server environment variables and are never shown here. Refunds are processed in the eGHL merchant portal and recorded on the order.','muted'));
  card.append(el('h2','Shipping rates'),el('p','Copied from the Shopify delivery profiles (Malaysia, all states). For each profile in the bag the cheapest matching rate applies; profiles are added together.','muted'));
  const wrap=el('div',undefined,'table-wrap'),tb=el('table'),thead=el('thead'),hr=el('tr'),body=el('tbody');for(const x of ['Profile','Rate name','Price','Condition'])hr.append(el('th',x));thead.append(hr);tb.append(thead,body);wrap.append(tb);card.append(wrap);
  for(const r of data.rates){const tr=el('tr');cell(tr,r.profile==='luggage'?'Luggage Shipping Fees':'General profile');cell(tr,r.name);cell(tr,r.price_minor?formatPrice(r.price_minor):'Free');cell(tr,r.min_subtotal_minor!=null?`Order of ${formatPrice(r.min_subtotal_minor)} or more`:r.min_weight_grams!=null?`${r.min_weight_grams/1000}–${r.max_weight_grams/1000} kg`:'Any order');body.append(tr);}
  card.append(el('h2','Customer emails'),el('p','Order confirmation, shipping and refund emails are queued automatically with each order change. Sending is not enabled yet: choose an email provider (SMTP) to deliver queued messages.','muted'));
  card.append(el('p','Currency: MYR. Staff permissions and MFA are managed through the approved Supabase process. Editing these settings in the workspace is not implemented yet.','muted'));
  root.append(card);
 }
 return {orders,customers,settings,resetOrders:()=>{offset=0;search='';status='';}};
}
