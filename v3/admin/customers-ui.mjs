// Customers: list (imported from Shopify + people who paid here), one customer, and the Shopify CSV import.
import {formatPrice} from './money.mjs';
import {csvObjects} from '../shared/csv.mjs';
import {CUSTOMER_HEADERS,MY_STATES} from '../shared/customer-columns.mjs';
const when=v=>v?new Intl.DateTimeFormat('en-MY',{dateStyle:'medium'}).format(new Date(v)):'—';
const MAX_BYTES=56000,MAX_ROWS=500;
export function createCustomers(h){
 const {api,root,notify,readOnly,el,button,field,select,header,current,ticket}=h;
 let offset=0,q='',sub='',sort='spent';
 const td=(tr,...nodes)=>{const c=el('td');c.append(...nodes.map(n=>typeof n==='string'?document.createTextNode(n):n));tr.append(c);return c;};
 const location=c=>[c.city,c.province_code?(c.country_code==='MY'?MY_STATES[c.province_code]??c.province_code:c.province_code):c.state,c.country_code==='MY'||c.state?'Malaysia':c.country_code].filter(Boolean).join(', ');
 const subBadge=on=>el('span',on?'Subscribed':'Not subscribed','badge '+(on?'active':'neutral'));

 async function list(t){
  const tools=el('form',undefined,'toolbar'),s=field('Search name, email or phone',q,'search');
  const f=select([['','All customers'],['subscribed','Email subscribed'],['not_subscribed','Not subscribed']],sub);f.setAttribute('aria-label','Filter by email subscription');
  const o=select([['spent','Amount spent'],['orders','Orders'],['name','Name A–Z'],['recent','Last order']],sort);o.setAttribute('aria-label','Sort customers');
  tools.append(s.wrap,f,o,el('button','Apply'));root.append(tools);
  tools.addEventListener('submit',e=>{e.preventDefault();q=s.input.value.trim();sub=f.value;sort=o.value;offset=0;h.navigate('Customers',true).catch(err=>notify(err.message));});
  for(const n of [f,o])n.addEventListener('change',()=>tools.requestSubmit());
  const params=new URLSearchParams({limit:'50',offset:String(offset),sort});if(q)params.set('q',q);if(sub)params.set('subscription',sub);
  const data=await api('customers?'+params);if(!current(t))return;
  const actions=root.querySelector('.page-actions');
  if(actions&&!readOnly&&data.imported){const imp=button('Import from Shopify',()=>importer());imp.classList.add(data.imported&&data.total?'secondary':'primary');actions.append(imp);}
  if(!data.imported)root.append(el('p','Shopify customer import needs database migration 014. Until then this list shows people who paid for an order here.','warning-note'));
  root.append(el('p',`${data.total} customer${data.total===1?'':'s'}${data.imported?` · ${data.subscribed} subscribed to email`:''}`,'result-count'));
  if(!data.items.length){const box=el('div',undefined,'empty-state');box.append(el('p',q||sub?'No matching customers.':'No customers yet. Import your Shopify customers, or they appear after their first paid order.'));if(!q&&!sub&&data.imported&&!readOnly)box.append(button('Import from Shopify',()=>importer()));root.append(box);return;}
  const wrap=el('div',undefined,'table-wrap'),tb=el('table'),thead=el('thead'),hr=el('tr'),body=el('tbody');
  for(const x of ['Customer','Email subscription','Location','Orders','Amount spent'])hr.append(el('th',x));thead.append(hr);tb.append(thead,body);wrap.append(tb);root.append(wrap);
  for(const c of data.items){const tr=el('tr');
   const name=c.id?button(c.name||c.email||c.phone||'Customer',()=>detail(c.id)):el('span',c.name||c.email);if(c.id)name.className='link-button';
   td(tr,name,el('small',c.name?c.email:'','cell-note'));td(tr,subBadge(c.accepts_email_marketing));td(tr,location(c)||'—');
   const ord=td(tr,String(c.orders));if(c.store_orders&&c.shopify_orders)ord.append(el('small',`${c.shopify_orders} Shopify · ${c.store_orders} here`,'cell-note'));
   td(tr,formatPrice(c.spent_minor));body.append(tr);}
  const pages=el('div',undefined,'pagination');
  pages.append(el('span',`${offset+1}–${offset+data.items.length} of ${data.total}`,'muted'),button('Previous',()=>{offset=Math.max(0,offset-50);return h.navigate('Customers',true);},offset===0),button('Next',()=>{offset+=50;return h.navigate('Customers',true);},offset+data.items.length>=data.total));root.append(pages);
 }

 async function detail(id){
  const t=ticket();const c=await api('customers/'+id);if(!current(t))return;
  const name=[c.first_name,c.last_name].filter(Boolean).join(' ')||c.email||c.phone;
  header(name,'Customer');const crumb=el('p',undefined,'breadcrumb');crumb.append(el('span','Customers'));root.querySelector('.page-heading > div')?.prepend(crumb);
  const grid=el('div',undefined,'editor-grid'),main=el('section',undefined,'card'),aside=el('section',undefined,'card');grid.append(main,aside);root.append(grid);
  main.append(el('h2','Orders'));
  const summary=el('dl',undefined,'order-totals');for(const [k,v] of [['Shopify orders (before this store)',`${c.shopify_orders} · ${formatPrice(c.shopify_spent_minor)}`],['Orders in this store',String(c.orders.filter(o=>o.status==='paid').length)]])summary.append(el('dt',k),el('dd',v));main.append(summary);
  if(c.orders.length){const wrap=el('div',undefined,'table-wrap'),tb=el('table'),thead=el('thead'),hr=el('tr'),body=el('tbody');for(const x of ['Order','Date','Status','Total'])hr.append(el('th',x));thead.append(hr);tb.append(thead,body);wrap.append(tb);main.append(wrap);
   for(const o of c.orders){const tr=el('tr');td(tr,o.number);td(tr,when(o.created_at));td(tr,o.status.replace('_',' '));td(tr,formatPrice(o.total_minor)+(o.refunded_minor?` (−${formatPrice(o.refunded_minor)})`:''));body.append(tr);}
   main.append(el('p','Orders here are matched by email for staff only. Customers cannot see them through this record.','muted'));}
  else main.append(el('p','No orders in this store yet. Shopify order details stay in Shopify.','muted'));
  if(c.note){main.append(el('h2','Note'),el('p',c.note));}
  aside.append(el('h2','Contact'));for(const line of [c.email,c.phone,c.company])if(line)aside.append(el('p',line));
  aside.append(el('h2','Default address'));const addr=[c.address1,c.address2,[c.zip,c.city].filter(Boolean).join(' '),c.country_code==='MY'?MY_STATES[c.province_code]??c.province_code:c.province_code,c.country_code==='MY'?'Malaysia':c.country_code].filter(Boolean);
  if(addr.length)for(const l of addr)aside.append(el('p',l));else aside.append(el('p','No address','muted'));
  aside.append(el('h2','Marketing'));const m=el('p',undefined,'stock-line');m.append(el('span','Email'),subBadge(c.accepts_email_marketing),el('span','SMS'),subBadge(c.accepts_sms_marketing));aside.append(m);
  if(c.consent_source)aside.append(el('p',`From ${c.consent_source}, ${when(c.consent_recorded_at)}`,'cell-note'));
  if(c.tags?.length){aside.append(el('h2','Tags'));const tags=el('p');for(const tag of c.tags)tags.append(el('span',tag,'badge'),' ');aside.append(tags);}
  if(c.shopify_customer_id)aside.append(el('p',`Shopify customer ID ${c.shopify_customer_id} · imported ${when(c.imported_at)}`,'cell-note'));
  aside.append(button('Back to customers',()=>h.navigate('Customers',true)));
 }

 // Import: Shopify → Customers → Export → All customers, CSV. The file is read in the browser; only the
 // columns this store uses are sent, in small batches.
 function importer(){
  header('Import customers from Shopify','');const crumb=el('p',undefined,'breadcrumb');crumb.append(el('span','Customers'));root.querySelector('.page-heading > div')?.prepend(crumb);
  const card=el('section',undefined,'card import-card');root.append(card);
  card.append(el('h2','1. Export from Shopify'));const ol=el('ol');
  for(const x of ['In Shopify admin, open Customers and click Export.','Choose “All customers” and “CSV for Excel, Numbers, or other spreadsheet programs”.','Shopify downloads the file, or emails it to the store owner for large lists.'])ol.append(el('li',x));card.append(ol);
  card.append(el('h2','2. Choose the file'));
  const file=field('Shopify customers CSV','', 'file');file.input.accept='.csv,text/csv';card.append(file.wrap);
  const info=el('div',undefined,'import-info');card.append(info);
  const go=el('button','Import customers','primary');go.type='button';go.disabled=true;
  const back=button('Back to customers',()=>h.navigate('Customers',true));
  const acts=el('div',undefined,'actions');acts.append(go,back);card.append(acts);
  card.append(el('p','Matched by Shopify customer ID, then email: importing the same file again updates records and creates no duplicates. Email and SMS subscription are copied exactly as in Shopify. Shopify order totals are kept as history; Shopify order details stay in Shopify.','muted'));
  let rows=[];
  file.input.addEventListener('change',async()=>{
   info.replaceChildren();go.disabled=true;rows=[];const f=file.input.files[0];if(!f)return;
   if(f.size>20*1024*1024){info.append(el('p','This file is larger than 20 MB. Export in smaller parts.','warning-note'));return;}
   const parsed=csvObjects(await f.text(),CUSTOMER_HEADERS);
   const lower=parsed.headers.map(x=>x.toLowerCase());
   if(!lower.includes('email')||!(lower.includes('first name')||lower.includes('customer id'))){info.append(el('p','This does not look like a Shopify customer export (no Email / First Name columns).','warning-note'));return;}
   rows=parsed.rows;const subscribed=rows.filter(r=>/^yes$/i.test(r['Accepts Email Marketing']??r['Accepts Marketing']??'')).length;
   info.append(el('p',`${rows.length} customers in the file · ${subscribed} subscribed to email`,'result-count'));go.disabled=readOnly||!rows.length;
  });
  go.addEventListener('click',async()=>{
   go.disabled=true;file.input.disabled=true;info.querySelectorAll('.import-progress,details').forEach(n=>n.remove());const progress=el('p','Importing…','result-count import-progress');progress.setAttribute('role','status');info.append(progress);
   const total={created:0,updated:0,unchanged:0,skipped:[]};let i=0,done=0;
   try{
    while(i<rows.length){
     // Batches stay under the API's request size limit.
     const batch=[];let bytes=20;while(i<rows.length&&batch.length<MAX_ROWS){const size=JSON.stringify(rows[i]).length+1;if(batch.length&&bytes+size>MAX_BYTES)break;batch.push(rows[i]);bytes+=size;i++;}
     const r=await api('customers/import',{rows:batch,first_line:i-batch.length+2});
     total.created+=r.created;total.updated+=r.updated;total.unchanged+=r.unchanged;total.skipped.push(...r.skipped);done=i;
     progress.textContent=`Imported ${done} of ${rows.length}…`;
    }
    progress.textContent=`Done: ${total.created} new, ${total.updated} updated, ${total.unchanged} unchanged${total.skipped.length?`, ${total.skipped.length} skipped`:''}.`;
    notify('Customers imported.');
   }catch(e){progress.textContent=done?`Stopped after ${done} of ${rows.length} rows: ${e.message} Importing the file again continues safely.`:`Nothing was imported: ${e.message}`;progress.classList.add('warning-note');go.disabled=false;}
   if(total.skipped.length){const d=el('details');d.append(el('summary',`${total.skipped.length} rows skipped`));const ul=el('ul');for(const s of total.skipped.slice(0,200))ul.append(el('li',`Line ${s.line}: ${s.reason}`));d.append(ul);info.append(d);}
   file.input.disabled=false;
  });
 }
 return {list,detail};
}
