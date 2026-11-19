// Orders, Customers and the read-only Settings summary for the staff workspace.
import {moneyToMinor,formatPrice} from './money.mjs';
const ORDER={pending_payment:'Awaiting payment',paid:'Paid',cancelled:'Cancelled',expired:'Expired'};
const FULFIL={unfulfilled:'Unfulfilled',fulfilled:'Fulfilled'};
const PAY={initiated:'Started',pending:'Bank pending',succeeded:'Succeeded',failed:'Failed'};
const RETURN={none:'',requested:'Return requested',received:'Return received',closed:'Return closed'};
const CARRIERS=['J&T Express','Pos Laju','Ninja Van','DHL eCommerce','City-Link Express','GDex','Lalamove','Self pickup'];
const GR={pending:'Waiting for eGHL',unknown:'Unclear — check eGHL portal',succeeded:'Refunded',failed:'Declined by eGHL'};
const ACTIVITY={paid:'Payment confirmed',expired:'Expired',fulfil:'Marked as fulfilled',tracking:'Tracking changed',cancel:'Cancelled',refund_recorded:'Refund recorded (eGHL portal)',refund_gateway_requested:'Refund sent to eGHL',refund_gateway_succeeded:'Refund confirmed by eGHL',refund_gateway_failed:'Refund declined by eGHL',refund_gateway_unknown:'Refund answer unclear',refund_gateway_settled_succeeded:'Refund confirmed by staff',refund_gateway_settled_failed:'Refund marked not made',return_requested:'Return requested',return_received:'Return received',return_closed:'Return closed',resolve:'Issue resolved',payment_checked:'Payment checked with eGHL'};
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
  for(const l of o.lines){const tr=el('tr');td(tr,el('span',l.title),...(l.variant_title?[el('small',l.variant_title,'cell-note')]:[]),...(l.personalization?[el('small','Engraving: '+l.personalization,'cell-note engraving-note')]:[]));cell(tr,l.sku||'—');cell(tr,formatPrice(l.unit_price_minor));cell(tr,String(l.quantity));cell(tr,formatPrice(l.line_total_minor));body.append(tr);}
  const totals=el('dl',undefined,'order-totals');for(const [k,v] of [['Subtotal',formatPrice(o.subtotal_minor)],['Shipping',`${formatPrice(o.shipping_minor)} · ${o.shipping_names}`],...(o.discounts??[]).map(d=>[d.code?`Discount ${d.code}${d.released?' (released)':''}`:`${d.title}${d.released?' (released)':''}`,'−'+formatPrice(d.amount_minor)]),...(!o.discounts?.length&&o.discount_minor?[['Discount','−'+formatPrice(o.discount_minor)]]:[]),['Total',formatPrice(o.total_minor)],...(o.refunded_minor?[['Refunded','−'+formatPrice(o.refunded_minor)]]:[])]){totals.append(el('dt',k),el('dd',v));}main.append(totals);
  main.append(el('h2','Customer and delivery'));const addr=el('div',undefined,'order-address');for(const line of [o.customer_name,o.email,o.phone,o.address_line1,o.address_line2,`${o.postcode} ${o.city}`,`${o.state}, Malaysia`])if(line)addr.append(el('p',line));if(o.note)addr.append(el('p','Note: '+o.note,'muted'));main.append(addr);
  // Gateway evidence: every attempt and every verified/unverified message.
  main.append(el('h2','Payments (eGHL)'));
  const pay=el('div',undefined,'table-wrap'),pt=el('table'),ph=el('thead'),phr=el('tr'),pb=el('tbody');for(const x of ['Reference','Amount','Status','Gateway transaction','Updated'])phr.append(el('th',x));ph.append(phr);pt.append(ph,pb);pay.append(pt);main.append(pay);
  for(const p of o.payments){const tr=el('tr');cell(tr,p.payment_ref);cell(tr,formatPrice(p.amount_minor));td(tr,badge(PAY[p.status],'pay-'+p.status));cell(tr,[p.provider_txn_id,p.auth_code].filter(Boolean).join(' · ')||'—');cell(tr,when(p.updated_at));pb.append(tr);}
  if(o.events.length){const list=el('ul',undefined,'event-list');for(const e of o.events)list.append(el('li',`${when(e.received_at)} · ${e.payment_ref} · ${e.source} · ${e.verified?'verified':'NOT verified'} · ${e.outcome}`));main.append(el('p','Gateway messages','field-label'),list);}
  if(o.stock.length){const list=el('ul',undefined,'event-list');for(const s of o.stock)list.append(el('li',`${when(s.created_at)} · ${s.sku??'—'} · ${s.delta>0?'+':''}${s.delta} (${s.reason.replace('_',' ')}) → ${s.quantity_after}`));main.append(el('p','Stock movements','field-label'),list);}
  if(o.emails?.length){const list=el('ul',undefined,'event-list');for(const m of o.emails)list.append(el('li',`${when(m.created_at)} · ${m.subject} → ${m.recipient} · ${m.status==='pending'?'waiting (email not configured)':m.status}`));main.append(el('p','Customer emails','field-label'),list);}
  if(o.refunds.length){const list=el('ul',undefined,'event-list');for(const r of o.refunds)list.append(el('li',`${when(r.created_at)} · ${formatPrice(r.amount_minor)} · ${r.method==='gateway'?'through eGHL':'recorded (eGHL portal)'} · ${r.reference}${r.restocked?' · restocked':''}${r.note?' · '+r.note:''} · ${r.actor_role??'staff'}`));main.append(el('p','Refunds','field-label'),list);}
  if(o.activity?.length){const list=el('ul',undefined,'event-list activity-list');for(const a of o.activity)list.append(el('li',`${when(a.created_at)} · ${ACTIVITY[a.action]??a.action.replaceAll('_',' ')}${a.detail?' · '+a.detail:''} · ${a.actor?(a.actor_role??'staff'):'system'}`));main.append(el('p','Activity','field-label'),list);}
  // Status and actions.
  aside.append(el('h2','Status'));const st=el('p',undefined,'stock-line');st.append(badge(ORDER[o.status],'order-'+o.status));if(o.status==='paid')st.append(badge(FULFIL[o.fulfillment_status],'fulfil-'+o.fulfillment_status));aside.append(st);
  if(o.status==='pending_payment')aside.append(el('p',`Stock is reserved until ${when(o.expires_at)}.`,'muted'));
  if(o.return_status&&o.return_status!=='none')st.append(badge(RETURN[o.return_status],'return-'+o.return_status));
  const gw=o.gateway??{};
  const act=async(path,body,message)=>{const r=await api(`orders/${o.id}/${path}`,{revision:o.revision,...body},'POST');await detail(o.id);notify(typeof message==='function'?message(r):message);};
  const section=title=>{const s=el('section',undefined,'order-action');s.append(el('h3',title));aside.append(s);return s;};
  if(o.needs_attention){const box=el('div',undefined,'attention-box'),note=field('How was this resolved?','');note.input.maxLength=300;box.append(el('strong','Needs attention'),el('p',o.attention_note),note.wrap,button('Mark resolved',()=>act('resolve',{note:note.input.value},'Marked as resolved.'),readOnly));aside.append(box);}
  // Payment check (QUERY): for orders whose payment was started but not confirmed.
  const unsettled=o.payments.length&&!o.payments.some(p=>p.status==='succeeded')&&['pending_payment','expired'].includes(o.status);
  if(unsettled&&o.aftersales){const s=section('Payment');
   if(gw.can_query){s.append(el('p','The customer may have paid without the confirmation reaching us. Ask eGHL for this payment’s status.','muted'),button('Check payment with eGHL',()=>act('check-payment',{},r=>r.check_result),readOnly));}
   else s.append(el('p','This gateway cannot be asked for a payment status here. Check the eGHL merchant portal.','muted'));}
  // Fulfilment.
  const carrierFields=(c='',n='',u='')=>{const known=CARRIERS.includes(c)||!c;const pick=select([['','Choose carrier'],...CARRIERS.map(x=>[x,x]),['other','Other']],known?c:'other');const lab=el('label','Carrier');lab.append(pick);
   const other=field('Carrier name',known?'':c);other.input.maxLength=60;other.wrap.hidden=pick.value!=='other';pick.addEventListener('change',()=>{other.wrap.hidden=pick.value!=='other';});
   const num=field('Tracking number',n);num.input.maxLength=80;const url=field('Tracking link (optional, https://)',u,'url');url.input.maxLength=300;
   return {nodes:[lab,other.wrap,num.wrap,url.wrap],value:()=>({tracking_carrier:pick.value==='other'?other.input.value:pick.value,tracking_number:num.input.value,tracking_url:url.input.value})};};
  if(o.status==='paid'&&o.fulfillment_status==='unfulfilled'){const s=section('Fulfil');
   // Engraving is done before packing: list exactly what to engrave on which item.
   const engraved=o.lines.filter(l=>l.personalization);if(engraved.length){const box=el('div',undefined,'engraving-list');box.append(el('strong',`Engrave before shipping (${engraved.reduce((n,l)=>n+l.quantity,0)} items)`));const ul=el('ul');for(const l of engraved)ul.append(el('li',`${l.quantity} × ${l.title}${l.variant_title?' · '+l.variant_title:''}: “${l.personalization}”`));box.append(ul);s.append(box);}
   const f=carrierFields();s.append(...(o.aftersales?f.nodes:[f.nodes[2]]),(()=>{const b=button('Mark as fulfilled',()=>act('fulfil',f.value(),'Order marked as fulfilled. The customer is emailed the tracking details.'),readOnly);b.classList.add('primary');return b;})());}
  if(o.fulfillment_status==='fulfilled'){const s=section('Shipment');
   s.append(el('p',[o.tracking_carrier,o.tracking_number].filter(Boolean).join(' · ')||'No tracking recorded.'));
   if(o.tracking_url){const a=el('a','Open tracking link');a.href=o.tracking_url;a.target='_blank';a.rel='noopener noreferrer';s.append(a);}
   if(o.aftersales){const d=el('details');d.append(el('summary','Edit tracking'));const f=carrierFields(o.tracking_carrier,o.tracking_number,o.tracking_url);d.append(el('p','Corrects what staff see and the order page. The customer is not emailed again.','muted'),...f.nodes,button('Save tracking',()=>act('tracking',f.value(),'Tracking updated.'),readOnly));s.append(d);}}
  if(o.status==='pending_payment')aside.append(button('Cancel order and release stock',async()=>{if(!window.confirm('Cancel this unpaid order? Reserved stock is released.'))return;await act('cancel',{},'Order cancelled; stock released.');},readOnly));
  // Returns: goods coming back. Money is a separate refund.
  if(o.aftersales&&o.status==='paid'&&o.fulfillment_status==='fulfilled'){const s=section('Return');
   if(o.return_note)s.append(el('p',o.return_note,'muted'));
   const note=field('Note (optional)','');note.input.maxLength=500;
   if(o.return_status==='none')s.append(el('p','When the customer sends items back, track the return here. Refund the money separately.','muted'),note.wrap,button('Start return',()=>act('return',{step:'request',note:note.input.value},'Return started.'),readOnly));
   else if(o.return_status==='requested'){const restock=field('Put the items back in stock','','checkbox');const done=o.refunds.some(r=>r.restocked);if(done){restock.input.disabled=true;restock.wrap.append(el('small','Already restocked with a refund','cell-note'));}else restock.input.checked=true;
    s.append(el('p','Waiting for the items to arrive.','muted'),note.wrap,restock.wrap,button('Items received',()=>act('return',{step:'receive',note:note.input.value,restock:restock.input.checked},'Return received.'),readOnly));}
   else if(o.return_status==='received')s.append(note.wrap,button('Close return',()=>act('return',{step:'close',note:note.input.value},'Return closed.'),readOnly));
   else s.append(el('p','Return closed.','muted'));}
  // Refunds still waiting for eGHL: staff settle them after checking the eGHL merchant portal.
  for(const g of (o.gateway_refunds??[]).filter(g=>['pending','unknown'].includes(g.status))){const s=section('Refund needs checking');s.classList.add('attention-box');
   s.append(el('p',`${formatPrice(g.amount_minor)} sent to eGHL ${when(g.created_at)} · ${GR[g.status]}`),...(g.message?[el('p',g.message,'muted')]:[]));
   const ref=field('eGHL refund reference (if refunded)',g.gateway_txn_id??'');ref.input.maxLength=80;
   s.append(ref.wrap,button('eGHL refunded it',()=>act(`gateway-refunds/${g.id}/settle`,{outcome:'succeeded',reference:ref.input.value},'Refund confirmed.'),readOnly),button('eGHL did not refund',()=>act(`gateway-refunds/${g.id}/settle`,{outcome:'failed'},'Marked as not refunded.'),readOnly));}
  const inFlight=(o.gateway_refunds??[]).filter(g=>['pending','unknown'].includes(g.status)).reduce((n,g)=>n+g.amount_minor,0);
  const left=o.total_minor-o.refunded_minor-inFlight;
  if(o.status==='paid'&&left>0){const s=section('Refund');s.append(el('p',`${formatPrice(left)} can still be refunded.`,'muted'));
   const already=o.refunds.some(r=>r.restocked)||['received','closed'].includes(o.return_status);
   const restockField=()=>{const r=field('Return items to stock','','checkbox');if(already){r.input.disabled=true;r.wrap.append(el('small','Already restocked','cell-note'));}return r;};
   // A. Through eGHL (money moves).
   const a=el('form',undefined,'refund-form');a.append(el('h4','Refund through eGHL'));
   if(o.aftersales&&gw.refunds_enabled&&!inFlight){const amount=field('Amount (MYR)',(left/100).toFixed(2)),note=field('Reason (optional)',''),restock=restockField();note.input.maxLength=500;const go=el('button','Refund through eGHL');go.type='submit';go.disabled=readOnly;
    a.append(el('p',gw.provider==='mock'?'Staging test gateway: no real money moves.':'eGHL sends the money back to the customer’s card or bank.','muted'),amount.wrap,note.wrap,restock.wrap,go);
    a.addEventListener('submit',async e=>{e.preventDefault();let minor;try{minor=moneyToMinor(amount.input.value);}catch(err){notify(err.message);return;}if(!window.confirm(`Refund ${formatPrice(minor)} to the customer through eGHL? This cannot be undone.`))return;go.disabled=true;
     try{await act('gateway-refunds',{amount_minor:minor,note:note.input.value,restock:restock.input.checked},r=>({succeeded:'eGHL refunded the customer.',failed:'eGHL declined the refund: '+(r.refund_message||'no reason given'),pending:'eGHL is processing the refund. Check it later.',unknown:'No clear answer from eGHL. Check the eGHL merchant portal, then settle it here.'})[r.refund_result]);}catch(err){notify(err.message);}finally{go.disabled=readOnly;}});}
   else a.append(el('p',inFlight?'Settle the refund waiting for eGHL first.':!o.aftersales?'Needs database migration 013.':gw.refunds_disabled_reason,'muted'));
   s.append(a);
   // B. Already refunded in the eGHL merchant portal: record it (no money moves from here).
   const form=el('form',undefined,'refund-form'),amount=field('Amount refunded (MYR)',(left/100).toFixed(2)),ref=field('eGHL refund reference',''),note=field('Note (optional)',''),restock=restockField();ref.input.maxLength=80;note.input.maxLength=500;
   const go=el('button','Record refund');go.type='submit';go.disabled=readOnly;
   form.append(el('h4','Record a refund made in the eGHL portal'),el('p','Only records it here. Make the refund in the eGHL merchant portal first.','muted'),amount.wrap,ref.wrap,note.wrap,restock.wrap,go);
   form.addEventListener('submit',async e=>{e.preventDefault();go.disabled=true;try{await act('refunds',{amount_minor:moneyToMinor(amount.input.value),reference:ref.input.value,note:note.input.value,restock:restock.input.checked},'Refund recorded.');}catch(err){notify(err.message);}finally{go.disabled=readOnly;}});
   s.append(form);
  }
  if(readOnly)for(const n of aside.querySelectorAll('input,textarea,select'))n.disabled=true;
  aside.append(button('Back to orders',()=>h.navigate('Orders')));
 }
 async function settings(t){
  const data=await api('storefront/shipping-rates');if(!current(t))return;
  const card=el('section',undefined,'card');card.append(el('h2','Payments'),el('p','eGHL Payment Gateway (same as the Shopify store). Merchant credentials are set as server environment variables and are never shown here. Refunds are processed in the eGHL merchant portal and recorded on the order.','muted'));
  card.append(el('h2','Shipping rates'),el('p','Copied from the Shopify delivery profiles (Malaysia, all states). For each profile in the bag the cheapest matching rate applies; profiles are added together.','muted'));
  const wrap=el('div',undefined,'table-wrap'),tb=el('table'),thead=el('thead'),hr=el('tr'),body=el('tbody');for(const x of ['Profile','Rate name','Price','Condition'])hr.append(el('th',x));thead.append(hr);tb.append(thead,body);wrap.append(tb);card.append(wrap);
  for(const r of data.rates){const tr=el('tr');cell(tr,r.profile==='luggage'?'Luggage Shipping Fees':'General profile');cell(tr,r.name);cell(tr,r.price_minor?formatPrice(r.price_minor):'Free');cell(tr,r.min_subtotal_minor!=null?`Order of ${formatPrice(r.min_subtotal_minor)} or more`:r.min_weight_grams!=null?`${r.min_weight_grams/1000}–${r.max_weight_grams/1000} kg`:'Any order');body.append(tr);}
  card.append(el('p','Currency: MYR. Staff permissions and MFA are managed through the approved Supabase process. Editing these settings in the workspace is not implemented yet.','muted'));
  root.append(card);
 }
 return {orders,settings,resetOrders:()=>{offset=0;search='';status='';},filterOrders:s=>{offset=0;search='';status=s;}};
}
