// Website Editor: page list, section builder, live device preview, publish and version history.
// Uses the workspace helpers from catalog-ui.mjs so it looks and behaves like the rest of the admin.
import {SECTION_TYPES,TEMPLATES,MAX_SECTIONS,defaults,newSectionId} from '../shared/page-schema.mjs';
import {previewDocument} from './page-render.mjs';
const STATUS={draft:'Draft',published:'Published',changes:'Unpublished changes'};
const DEVICES=[['desktop','Desktop',1280],['tablet','Tablet',768],['mobile','Mobile',390]];
const FRAME_HEIGHT=900;
const when=value=>new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const safeMedia=media=>Object.fromEntries(Object.entries(media??{}).filter(([,url])=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='api.cloudinary.com';}catch{return false;}}));
export function createWebsite(h){
 const {api,root,notify,readOnly,el,button,field,select,header,table,cell,empty,all,thumb,previews,mediaPicker,setDirty,ticket,current,navigate}=h;
 let offset=0,search='',status='',fit=null;
 const statusBadge=s=>el('span',STATUS[s]??s,'badge page-'+s);
 if(typeof window!=='undefined')window.addEventListener('resize',()=>fit?.());
 async function list(t){
  const tools=el('form',undefined,'toolbar'),q=field('Search pages',search,'search'),filter=select([['','All statuses'],['draft','Draft'],['published','Published'],['changes','Unpublished changes']],status);
  filter.setAttribute('aria-label','Filter by status');tools.append(q.wrap,filter,el('button','Apply filters'));root.append(tools);
  tools.addEventListener('submit',e=>{e.preventDefault();search=q.input.value;status=filter.value;offset=0;navigate('Website').catch(err=>notify(err.message));});
  const create=el('section',undefined,'card page-create'),template=select(Object.entries(TEMPLATES).map(([k,v])=>[k,v.label]),'blank'),title=field('Page title (optional for templates)','');title.input.maxLength=120;
  const tLabel=el('label','Start from');tLabel.append(template);create.append(el('h2','Create a page'),el('p','Start blank or from a Jack Studio layout. New pages stay private until you publish them.','muted'),tLabel,title.wrap,button('Create page',async()=>{
   const draft=TEMPLATES[template.value].build();if(title.input.value.trim())draft.title=title.input.value.trim();
   if(!draft.title)throw Error('Enter a page title or choose a template.');
   if(title.input.value.trim()&&template.value!=='blank')draft.slug='';
   const page=await api('pages',draft,'POST');notify('Page created as a draft.');await edit(page.id);
  },readOnly));
  const params=new URLSearchParams({paged:'true',limit:'25',offset:String(offset)});if(search)params.set('q',search);if(status)params.set('status',status);
  const data=await api('pages?'+params);if(!current(t))return;
  root.append(el('p',`${data.total} pages · Showing ${data.items.length?offset+1:0}–${offset+data.items.length}`,'muted'));
  if(!data.items.length)empty(search||status?'No matching pages. Adjust your filters.':'No pages yet. Create your first page below.');
  else{const body=table(['Page','URL','Status','Live version','Sections','Updated','Action']);for(const p of data.items){const tr=el('tr');cell(tr,p.title);cell(tr,'/pages/'+p.slug);const st=el('td');st.append(statusBadge(p.status));tr.append(st);cell(tr,p.live_number?`v${p.live_number}`:'—');cell(tr,String(p.section_count));cell(tr,when(p.updated_at));const td=el('td');td.append(button(readOnly?'View':'Edit',()=>edit(p.id)));tr.append(td);body.append(tr);}}
  const pages=el('div',undefined,'pagination');pages.append(button('Previous',()=>{offset=Math.max(0,offset-25);return navigate('Website');},offset===0),button('Next',()=>{offset+=25;return navigate('Website');},offset+data.items.length>=data.total));root.append(pages,create);
 }
 async function edit(id){
  const t=ticket();const [page,collections]=await Promise.all([api('pages/'+id),all('collections')]);if(!current(t))return;
  header(readOnly?'View page':'Edit page',`/pages/${page.slug} · Drafts stay private until published. Every publish is kept as a version you can restore.`);
  const draft={title:page.title,slug:page.slug,seo_title:page.seo_title,seo_description:page.seo_description,sections:structuredClone(page.sections)};
  let open=null,dirty=false,source=readOnly?'draft':'edits',device='desktop',timer=null;
  const productTitles=new Map(),mediaLabels=new Map();
  const touch=()=>{dirty=true;setDirty(true);schedulePreview();};
  // Settings and actions.
  const form=el('form',undefined,'editor-grid'),settings=el('section',undefined,'card'),aside=el('section',undefined,'card');root.append(form);form.append(settings,aside);
  const title=field('Page title',draft.title),slug=field('Page URL (letters, numbers, hyphens)',draft.slug),seoTitle=field('SEO title',draft.seo_title),seoDesc=field('SEO description',draft.seo_description,'textarea');
  title.input.required=true;title.input.maxLength=120;slug.input.maxLength=80;seoTitle.input.maxLength=70;seoDesc.input.maxLength=160;seoDesc.input.rows=3;
  const counter=(f,max)=>{const n=el('small','', 'char-count');const set=()=>{n.textContent=`${f.input.value.length}/${max}`;};set();f.input.addEventListener('input',set);f.wrap.append(n);};
  counter(seoTitle,70);counter(seoDesc,160);
  for(const [f,k] of [[title,'title'],[slug,'slug'],[seoTitle,'seo_title'],[seoDesc,'seo_description']])f.input.addEventListener('input',()=>{draft[k]=f.input.value;touch();});
  settings.append(el('h2','Page settings'),title.wrap,slug.wrap,el('p',page.status==='draft'?'The URL can change freely until the page is published.':'Changing the URL of a published page keeps the old address working as a redirect.','muted'),el('h2','Search engine listing'),seoTitle.wrap,seoDesc.wrap);
  const save=el('button','Save draft','primary');save.type='submit';save.disabled=readOnly;
  aside.append(el('h2','Status'));const statusLine=el('p',undefined,'stock-line');statusLine.append(statusBadge(page.status),el('span',page.published_revision_id?`Live: v${page.revisions.find(r=>r.live)?.number??'?'}`:'Not on the website','muted'));aside.append(statusLine);
  const actions=el('div',undefined,'actions');
  actions.append(save,button(dirty?'Save and publish':'Publish',async()=>{let rev=page.revision;if(dirty)rev=(await persist()).revision;await api(`pages/${id}/publish`,{revision:rev},'POST');finish('Page published to the website.');},readOnly),
   button('Unpublish',async()=>{if(!window.confirm('Remove this page from the website? The draft and versions are kept.'))return;await api(`pages/${id}/unpublish`,{revision:page.revision},'POST');finish('Page removed from the website.');},readOnly||page.status==='draft'),
   button('Back to pages',()=>navigate('Website')));
  aside.append(actions,el('h2','Versions'));
  if(!page.revisions.length)aside.append(el('p','Published versions appear here.','muted'));
  for(const r of page.revisions){const row=el('div',undefined,'version-row');row.append(el('strong',`v${r.number}`),el('span',`${when(r.published_at)} · ${r.published_by_role??'staff'} ${String(r.published_by).slice(0,8)}`,'muted'));if(r.live)row.append(el('span','Live','badge active'));
   row.append(button('Restore as draft',async()=>{if(dirty&&!window.confirm('Discard unsaved edits and restore this version as the draft?'))return;await api(`pages/${id}/revisions/${r.id}/restore`,{revision:page.revision},'POST');finish(`Version ${r.number} restored as the draft. Publish to make it live.`);},readOnly));aside.append(row);}
  if(page.redirects.length){aside.append(el('h2','Old URLs that redirect here'));for(const r of page.redirects)aside.append(el('p','/pages/'+r.from_slug,'muted'));}
  async function persist(){return api('pages/'+id,{revision:page.revision,...draft},'PATCH');}
  async function finish(message){dirty=false;setDirty(false);await edit(id);notify(message);}
  form.addEventListener('submit',async e=>{e.preventDefault();if(readOnly)return;save.disabled=true;try{await persist();await finish('Draft saved.');}catch(err){notify(err.message);}finally{save.disabled=false;}});
  // Sections.
  const sectionsCard=el('section',undefined,'card sections-card');root.append(sectionsCard);
  const summary=s=>{const v=s.settings;return String(v.heading||v.text||v.body||'').slice(0,70)||'No text yet';};
  function renderSections(){
   sectionsCard.replaceChildren(el('h2',`Sections (${draft.sections.length}/${MAX_SECTIONS})`),el('p','Sections appear on the page in this order. Hidden sections stay in the draft but are not shown.','muted'));
   if(!draft.sections.length)sectionsCard.append(el('div','Add your first section below.','empty-state'));
   const list=el('ol',undefined,'section-list');sectionsCard.append(list);
   for(const [i,s] of draft.sections.entries()){
    const item=el('li',undefined,'section-item'+(open===s.id?' open':'')+(s.hidden?' is-hidden':'')),row=el('div',undefined,'section-row'),copy=el('div',undefined,'section-copy');
    copy.append(el('strong',SECTION_TYPES[s.type].label),el('span',summary(s),'muted'));if(s.hidden)copy.append(el('span','Hidden','badge'));
    const tools=el('div',undefined,'row-actions'),label=`${SECTION_TYPES[s.type].label} section ${i+1}`;
    const b=(text,fn,disabled,aria)=>{const n=button(text,fn,disabled);if(aria)n.setAttribute('aria-label',aria);tools.append(n);};
    b(open===s.id?'Close':readOnly?'View':'Edit',()=>{open=open===s.id?null:s.id;renderSections();},false,(open===s.id?'Close ':'Edit ')+label);
    b(s.hidden?'Show':'Hide',()=>{s.hidden=!s.hidden;touch();renderSections();},readOnly,(s.hidden?'Show ':'Hide ')+label);
    b('Duplicate',()=>{if(draft.sections.length>=MAX_SECTIONS)throw Error(`Use up to ${MAX_SECTIONS} sections.`);const copy={...structuredClone(s),id:newSectionId()};draft.sections.splice(i+1,0,copy);open=copy.id;touch();renderSections();},readOnly,'Duplicate '+label);
    b('↑',()=>{[draft.sections[i-1],draft.sections[i]]=[draft.sections[i],draft.sections[i-1]];touch();renderSections();},readOnly||i===0,'Move up '+label);
    b('↓',()=>{[draft.sections[i+1],draft.sections[i]]=[draft.sections[i],draft.sections[i+1]];touch();renderSections();},readOnly||i===draft.sections.length-1,'Move down '+label);
    b('Remove',()=>{if(!window.confirm(`Remove this ${SECTION_TYPES[s.type].label} section from the draft?`))return;draft.sections.splice(i,1);if(open===s.id)open=null;touch();renderSections();},readOnly,'Remove '+label);
    row.append(el('span',String(i+1),'section-number'),copy,tools);item.append(row);if(open===s.id)item.append(sectionForm(s));list.append(item);
   }
   const add=select(Object.entries(SECTION_TYPES).map(([k,v])=>[k,v.label]),'hero');add.setAttribute('aria-label','Section type');
   const adder=el('div',undefined,'toolbar section-adder');adder.append(add,button('Add section',()=>{if(draft.sections.length>=MAX_SECTIONS)throw Error(`Use up to ${MAX_SECTIONS} sections.`);const s={id:newSectionId(),type:add.value,hidden:false,settings:defaults(add.value)};draft.sections.push(s);open=s.id;touch();renderSections();},readOnly||draft.sections.length>=MAX_SECTIONS));
   sectionsCard.append(adder);
  }
  function sectionForm(s){
   const box=el('div',undefined,'section-form'),schema=SECTION_TYPES[s.type];
   const draw=()=>{box.replaceChildren();for(const f of schema.fields){if(f.when&&s.settings[f.when[0]]!==f.when[1])continue;box.append(control(s,f,draw));}if(readOnly)for(const n of box.querySelectorAll('input,textarea,select,button'))n.disabled=true;};
   draw();return box;
  }
  function control(s,f,redraw){
   const v=s.settings;
   if(f.type==='text'||f.type==='textarea'||f.type==='link'){const x=field(f.label+(f.required?' *':''),v[f.key],f.type==='textarea'?'textarea':'text');if(f.max)x.input.maxLength=f.max;if(f.type==='textarea')x.input.rows=f.max>1000?6:3;if(f.type==='link')x.input.placeholder='/pages/contact';x.input.addEventListener('input',()=>{v[f.key]=x.input.value;touch();});return x.wrap;}
   if(f.type==='choice'||f.type==='collection'){const options=f.type==='choice'?f.options:[['','All active collections'],...collections.map(c=>[String(c.id),c.title+(c.status==='active'?'':' (draft)')])];const n=select(options,v[f.key]??'');const l=el('label',f.label);l.append(n);n.addEventListener('change',()=>{v[f.key]=n.value||(f.type==='collection'?null:n.value);touch();redraw();});return l;}
   if(f.type==='number'){const x=field(f.label,v[f.key],'number');x.input.min=f.min;x.input.max=f.max;x.input.step=1;x.input.addEventListener('input',()=>{v[f.key]=Number(x.input.value);touch();});return x.wrap;}
   if(f.type==='media'){
    const wrap=el('div',undefined,'media-field'),slot=el('div');wrap.append(el('span',f.label,'field-label'));
    if(v[f.key]){const img=thumb(mediaLabels.get(v[f.key])??'Selected image');wrap.append(img,el('small',mediaLabels.get(v[f.key])??`Image #${v[f.key]}`,'picker-name'));previews([{id:v[f.key],img}]);}
    else wrap.append(el('p','No image selected.','muted'));
    const tools=el('div',undefined,'actions');tools.append(button(v[f.key]?'Replace image':'Choose image',async()=>{const p=mediaPicker([],1,items=>{v[f.key]=items[0].media_id;mediaLabels.set(items[0].media_id,items[0].label);touch();redraw();});slot.replaceChildren(p.box);await p.load();p.focus();},readOnly));
    if(v[f.key])tools.append(button('Remove image',()=>{v[f.key]=null;touch();redraw();},readOnly));
    wrap.append(tools,slot);return wrap;
   }
   if(f.type==='products'){
    const wrap=el('div',undefined,'products-field'),chosen=el('ol',undefined,'chosen-products'),results=el('div',undefined,'product-results');wrap.append(el('span',`${f.label} · ${v[f.key].length}/${f.max}`,'field-label'),chosen);
    const missing=v[f.key].filter(pid=>!productTitles.has(pid));
    if(missing.length)Promise.all(missing.map(pid=>api('products/'+pid).then(p=>productTitles.set(pid,p.title)).catch(()=>productTitles.set(pid,'Unavailable product')))).then(redraw);
    for(const [i,pid] of v[f.key].entries()){const li=el('li');li.append(el('span',productTitles.get(pid)??'Loading…'),button('↑',()=>{[v[f.key][i-1],v[f.key][i]]=[v[f.key][i],v[f.key][i-1]];touch();redraw();},readOnly||i===0),button('↓',()=>{[v[f.key][i+1],v[f.key][i]]=[v[f.key][i],v[f.key][i+1]];touch();redraw();},readOnly||i===v[f.key].length-1),button('Remove',()=>{v[f.key].splice(i,1);touch();redraw();},readOnly));chosen.append(li);}
    if(!v[f.key].length)chosen.append(el('li','No products chosen yet.','muted'));
    const q=field('Find products to add','','search');const find=button('Search',async()=>{const data=await api('products?'+new URLSearchParams({paged:'true',limit:'8',q:q.input.value}));results.replaceChildren();if(!data.items.length)results.append(el('p','No matching products.','muted'));for(const p of data.items){productTitles.set(String(p.id),p.title);const row=el('div',undefined,'product-result');row.append(el('span',`${p.title} · ${p.status}`),button(v[f.key].includes(String(p.id))?'Added':'Add',()=>{if(v[f.key].length>=f.max)throw Error(`Choose up to ${f.max} products.`);v[f.key].push(String(p.id));touch();redraw();},readOnly||v[f.key].includes(String(p.id))));results.append(row);}},readOnly);
    const searchRow=el('div',undefined,'toolbar');searchRow.append(q.wrap,find);wrap.append(searchRow,results,el('p','Only active products in an active collection appear on the website.','muted'));return wrap;
   }
   return el('span','');
  }
  // Preview: current edits (validated, nothing saved), saved draft or the live version.
  const previewCard=el('section',undefined,'card preview-card'),bar=el('div',undefined,'preview-bar'),stage=el('div',undefined,'preview-stage'),frame=el('iframe'),note=el('p','','muted');
  frame.setAttribute('sandbox','');frame.setAttribute('title','Page preview');frame.setAttribute('referrerpolicy','no-referrer');stage.append(frame);
  const sourceSel=select([...(readOnly?[]:[['edits','Current edits']]),['draft','Saved draft'],...(page.published_revision_id?[['live','Live version']]:[])],source);sourceSel.setAttribute('aria-label','Preview source');
  sourceSel.addEventListener('change',()=>{source=sourceSel.value;refresh();});
  const devices=el('div',undefined,'device-toggle');devices.setAttribute('role','group');devices.setAttribute('aria-label','Preview device');
  for(const [k,label,width] of DEVICES){const n=button(`${label} · ${width}px`,()=>{device=k;for(const b of devices.children)b.setAttribute('aria-pressed',String(b===n));fit();});n.setAttribute('aria-pressed',String(k===device));devices.append(n);}
  bar.append(devices,sourceSel,button('Refresh preview',()=>refresh()));previewCard.append(el('h2','Preview'),bar,note,stage);root.append(previewCard);
  fit=()=>{const width=DEVICES.find(d=>d[0]===device)[2],avail=stage.clientWidth||width,scale=Math.min(1,avail/width);frame.style.width=width+'px';frame.style.height=FRAME_HEIGHT+'px';frame.style.transform=`scale(${scale})`;frame.style.left=Math.max(0,Math.round((avail-width*scale)/2))+'px';stage.style.height=Math.round(FRAME_HEIGHT*scale)+'px';};
  function schedulePreview(){if(source!=='edits')return;clearTimeout(timer);timer=setTimeout(()=>refresh(),600);}
  async function refresh(){
   note.textContent='Updating preview…';
   try{const data=source==='edits'?await api('pages/preview',draft,'POST'):await api(`pages/${id}/preview?source=${source}`);if(!current(t))return;
    frame.srcdoc=previewDocument(data.page,safeMedia(data.media));note.textContent=source==='edits'?'Showing your current edits. Nothing is saved or published until you choose to.':source==='live'?'Showing what visitors see now.':'Showing the last saved draft.';fit();}
   catch(err){note.textContent='Preview not updated: '+err.message;}
  }
  renderSections();fit();await refresh();
  if(readOnly)for(const n of form.querySelectorAll('input,textarea,select'))n.disabled=true;
 }
 return {list,edit};
}
