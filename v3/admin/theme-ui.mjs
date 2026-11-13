// Online Store themes in the admin: the current (live) theme, the theme library and the theme editor
// (header, home page template, footer and theme settings with a live device preview), modelled on
// Shopify's Online Store. Uses the workspace helpers from catalog-ui.mjs.
import {THEME_SETTINGS,THEME_SECTIONS,TEMPLATE_TYPES,GROUPS,MAX_TEMPLATE_SECTIONS,sectionLabel,sectionFields,defaults,fieldDefaults,newSectionId} from '../shared/theme-schema.mjs';
import {themeDocument,liquidDocument} from './theme-render.mjs';
import {createPageTools} from './theme-pages-ui.mjs';
import {PAGE_SLUGS,PAGE_TEMPLATES} from '../shared/page-templates.mjs';
const DEVICES=[['desktop','Desktop',1280],['tablet','Tablet',768],['mobile','Mobile',390]];
const when=value=>value?new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'—';
const safeMedia=media=>Object.fromEntries(Object.entries(media??{}).filter(([,url])=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='api.cloudinary.com';}catch{return false;}}));
const origin=()=>typeof location==='undefined'?'':location.origin;

export function createThemes(h){
 const {api,root,notify,readOnly,el,button,field,select,header,empty,all,thumb,previews,mediaPicker,setDirty,ticket,current,navigate}=h;
 // A scaled, sandboxed preview frame (no scripts, links disabled) that fits its container.
 function previewFrame(title,height=900){
  const stage=el('div',undefined,'preview-stage'),frame=el('iframe');frame.setAttribute('sandbox','');frame.setAttribute('title',title);frame.setAttribute('referrerpolicy','no-referrer');stage.append(frame);
  let width=1280;
  const fit=()=>{const avail=stage.clientWidth||width,scale=Math.min(1,avail/width);frame.style.width=width+'px';frame.style.height=height+'px';frame.style.transform=`scale(${scale})`;frame.style.left=Math.max(0,Math.round((avail-width*scale)/2))+'px';stage.style.height=Math.round(height*scale)+'px';};
  if(typeof window!=='undefined')window.addEventListener('resize',fit);
  return {stage,show:data=>{frame.srcdoc=data.page?liquidDocument(origin(),data.page):themeDocument(data.theme,safeMedia(data.media),origin());fit();},showSite:p=>{frame.srcdoc=liquidDocument(origin(),p);fit();},setWidth:w=>{width=w;fit();},fit,destroy:()=>typeof window!=='undefined'&&window.removeEventListener('resize',fit)};
 }
 // Full-page preview: opens the real storefront in a new tab with this theme (unsaved edits included),
 // so menus, tabs and links to other pages all work. The theme is handed over through this browser's
 // storage only (same site); visitors never see it. "Exit preview" in the tab returns to the live theme.
 function openPreview(data,title){
  if(typeof window==='undefined'||!window.open)return;
  try{window.localStorage.setItem('jt-theme-preview',JSON.stringify({name:title,theme:data.theme,media:safeMedia(data.media),pages:data.pages??null,expires:Date.now()+2*3600*1000}));}
  catch{notify('Preview needs browser storage. Allow site data for this site and try again.');return;}
  if(!window.open('/?theme_preview=1','_blank'))notify('Allow pop-ups for this site to open the preview.');
 }
 // Saved theme with its other pages rendered (editors only; viewers preview the home page).
 async function savedPreview(id){const data=await api(`themes/${id}/preview`);if(!readOnly){const t=await api('themes/'+id);data.pages=(await api('themes/preview-pages',{content:t.content},'POST')).pages;}return data;}
 const confirmed=text=>typeof window==='undefined'||window.confirm(text);
 async function rename(theme){
  const next=typeof window!=='undefined'?window.prompt('Theme name',theme.name):null;if(next==null||next.trim()===theme.name)return;
  await api('themes/'+theme.id,{revision:theme.revision,name:next.trim()},'PATCH');notify('Theme renamed.');await navigate('Website');
 }
 async function duplicate(theme){await api('themes',{from:theme.id},'POST');notify(`Copy of ${theme.name} added to the theme library.`);await navigate('Website');}
 async function publish(theme){
  if(!confirmed(`Publish "${theme.name}"? It replaces the current theme on the storefront.`))return;
  await api(`themes/${theme.id}/publish`,{revision:theme.revision},'POST');notify(`${theme.name} is now live.`);await navigate('Website');
 }

 // Fills empty image slots with the matching imported Shopify images; staff-chosen images stay.
 async function autofill(theme){const r=await api(`themes/${theme.id}/autofill`,{revision:theme.revision},'POST');notify(r.filled?`${theme.name}: filled ${r.filled} image slot${r.filled===1?'':'s'} from the Shopify images.`:'No empty image slots to fill. Import the Shopify images in the Media Library first, or the slots already have images.');await navigate('Website');}
 // Online Store overview: current theme and theme library. Pages follow below (website-ui.mjs).
 async function overview(t){
  let data;
  try{data=await api('themes');}
  catch(err){if(!current(t))return;const box=el('section',undefined,'card theme-current');box.append(el('h2','Online Store themes'),el('p','Themes are unavailable right now: '+err.message+' (the database may still need update 009).','muted'));root.append(box);return;}
  if(!current(t))return;const presets=data.presets??[],max=data.max??20;
  const live=data.items.find(x=>x.is_live),library=data.items.filter(x=>!x.is_live);
  const cur=el('section',undefined,'card theme-current');root.append(cur);
  const head=el('div',undefined,'theme-card-head');head.append(el('h2','Current theme'));if(live)head.append(el('span','Live','badge active'));cur.append(head);
  if(!live)cur.append(el('div',library.length?'No theme is live yet. Publish a theme from the library below.':'No theme yet. Add the Jack Studio 2026 theme below, customise it, then publish it.','empty-state'));
  else{
   const grid=el('div',undefined,'theme-current-grid'),info=el('div',undefined,'theme-info'),frame=previewFrame(`Preview of ${live.name}`,640);
   info.append(el('h3',live.name),el('p',`Last saved ${when(live.updated_at)}`,'muted'),el('p',`Published ${when(live.published_at)}`,'muted'));
   const actions=el('div',undefined,'actions'),edit=button(readOnly?'View theme':'Edit theme',()=>editTheme(live.id));edit.classList.add('primary');
   const view=el('a','View store','button-link');view.href='/';view.target='_blank';view.rel='noopener';
   actions.append(edit,view,button('Preview',async()=>openPreview(await savedPreview(live.id),live.name)),button('Duplicate',()=>duplicate(live),readOnly||data.items.length>=max),button('Rename',()=>rename(live),readOnly),button('Auto-fill images',()=>autofill(live),readOnly));info.append(actions);
   grid.append(frame.stage,info);cur.append(grid);
   api(`themes/${live.id}/preview`).then(p=>{if(current(t))frame.show(p);}).catch(err=>{frame.stage.replaceWith(el('p','Preview unavailable: '+err.message,'muted'));});
  }
  const lib=el('section',undefined,'card theme-library');root.append(lib);
  lib.append(el('h2','Theme library'),el('p','Themes here stay private until you publish them. Publishing one replaces the current theme; the old one returns to the library.','muted'));
  if(!library.length)lib.append(el('p','No other themes in the library.','muted'));
  for(const theme of library){
   const row=el('div',undefined,'theme-row'),copy=el('div');copy.append(el('strong',theme.name),el('span',`Last saved ${when(theme.updated_at)}`,'muted'));
   const tools=el('div',undefined,'row-actions'),pub=button('Publish',()=>publish(theme),readOnly);pub.classList.add('primary');
   tools.append(pub,button(readOnly?'View':'Edit theme',()=>editTheme(theme.id)),button('Preview',async()=>openPreview(await savedPreview(theme.id),theme.name)),button('Duplicate',()=>duplicate(theme),readOnly||data.items.length>=max),button('Rename',()=>rename(theme),readOnly),button('Auto-fill images',()=>autofill(theme),readOnly),
    button('Remove',async()=>{if(!confirmed(`Remove "${theme.name}" from the theme library?`))return;await api(`themes/${theme.id}/archive`,{revision:theme.revision},'POST');notify('Theme removed.');await navigate('Website');},readOnly));
   row.append(copy,tools);lib.append(row);
  }
  const add=el('div',undefined,'toolbar theme-add'),preset=select(presets.map(p=>[p.id,p.label]),presets[0]?.id??'');preset.setAttribute('aria-label','Theme preset');
  add.append(preset,button('Add theme',async()=>{const theme=await api('themes',{preset:preset.value},'POST');notify(`${theme.name} added to the theme library.`);await editTheme(theme.id);},readOnly||data.items.length>=max));
  if(presets.length)lib.append(add);lib.append(el('p',`${data.items.length}/${max} themes.`,'muted'));
 }

 // Theme editor.
 async function editTheme(id){
  const t=ticket();const [theme,collections]=await Promise.all([api('themes/'+id),all('collections')]);if(!current(t))return;
  header(readOnly?'View theme':'Edit theme',`${theme.name} · ${theme.is_live?'Live theme: saving updates the storefront immediately.':'Library theme: changes stay private until you publish it.'}`);
  const content=structuredClone(theme.content),mediaLabels=new Map(),openItems=new WeakSet();
  let dirty=false,device='desktop',timer=null,view={mode:'tree'},page='home';
  const touch=()=>{dirty=true;setDirty(true);schedule();};
  // Toolbar.
  const bar=el('div',undefined,'theme-toolbar'),devices=el('div',undefined,'device-toggle');devices.setAttribute('role','group');devices.setAttribute('aria-label','Preview device');
  const frame=previewFrame(`Theme preview: ${theme.name}`);
  for(const [k,label,width] of DEVICES){const n=button(`${label} · ${width}px`,()=>{device=k;for(const b of devices.children)b.setAttribute('aria-pressed',String(b===n));frame.setWidth(width);});n.setAttribute('aria-pressed',String(k===device));devices.append(n);}
  const save=button('Save',async()=>{await persist();notify(theme.is_live?'Theme saved. The storefront is updated.':'Theme saved.');},readOnly);save.classList.add('primary');
  let last=null;
  const preview=button('Preview',async()=>{const data=readOnly?await api(`themes/${id}/preview`):await api('themes/preview',{content},'POST');if(!readOnly)data.pages=(await api('themes/preview-pages',{content},'POST')).pages;openPreview(data,theme.name+(dirty?' (unsaved changes)':''));});
  const actions=el('div',undefined,'actions');actions.append(preview,save);
  if(!theme.is_live)actions.append(button(dirty?'Save and publish':'Publish',async()=>{if(!confirmed(`Publish "${theme.name}"? It replaces the current theme on the storefront.`))return;if(dirty)await persist();await api(`themes/${id}/publish`,{revision:theme.revision},'POST');dirty=false;setDirty(false);notify(`${theme.name} is now live.`);await navigate('Website');},readOnly));
  actions.append(button('Back to Online Store',()=>navigate('Website')));
  bar.append(devices,actions);root.append(bar);
  const layout=el('div',undefined,'theme-editor'),panel=el('section',undefined,'card theme-panel'),previewCard=el('section',undefined,'card theme-preview'),note=el('p','','muted');
  previewCard.append(note,frame.stage);layout.append(panel,previewCard);root.append(layout);
  async function persist(){const saved=await api('themes/'+id,{revision:theme.revision,content},'PATCH');theme.revision=saved.revision;dirty=false;setDirty(false);return saved;}
  function schedule(){if(readOnly)return;clearTimeout(timer);timer=setTimeout(()=>refresh(),600);}
  async function refresh(){
   note.textContent='Updating preview…';
   try{const html=readOnly?(await api(`themes/${id}/preview?page=${page}`)).page:(await api('themes/preview-pages',{content,page},'POST')).pages[page];if(!current(t))return;frame.showSite(html);note.textContent=readOnly?'Showing the saved theme.':dirty?'Showing your unsaved changes. Save to keep them.':'Showing the saved theme.';}
   catch(err){note.textContent='Preview not updated: '+err.message;}
  }
  // Panel, laid out like Shopify's editor: a compact section tree (icon, name, eye toggle, ··· menu)
  // and, below it, the settings of the selected section or the theme settings.
  const groups=[['header','Header','Header',content.header],['sections','Template','Template · Home page',content.sections],['footer','Footer','Footer',content.footer]];
  const NS='http://www.w3.org/2000/svg';
  const ICONS={header:'M3.5 4.5h13v3.5h-13z|M3.5 11h13M3.5 14.5h9',section:'M3.5 4h13v5h-13z|M3.5 11h13v5h-13z',image:'M3.5 4.5h13v11h-13z|m4 14 4.2-4.2 3 3 2-2 3.3 3.2|M7.6 8.6h.01',footer:'M3.5 12h13v3.5h-13z|M3.5 5.5h13M3.5 9h9',
   eye:'M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z|M10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',eyeOff:'M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z|M10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z|M3.5 3.5l13 13',
   gear:'M10 7.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z|M10 2.9v2M10 15.1v2M2.9 10h2M15.1 10h2M5 5l1.4 1.4M13.6 13.6 15 15M5 15l1.4-1.4M13.6 6.4 15 5'};
  function icon(name){const g=document.createElementNS(NS,'svg');g.setAttribute('viewBox','0 0 20 20');g.setAttribute('aria-hidden','true');g.setAttribute('focusable','false');g.setAttribute('class','theme-icon');for(const d of ICONS[name].split('|')){const p=document.createElementNS(NS,'path');p.setAttribute('d',d);g.append(p);}return g;}
  const hasImage=type=>sectionFields(type).some(f=>f.type==='media'||(f.type==='list'&&f.fields?.some(x=>x.type==='media')));
  const pages=createPageTools({el,button,field,select,mediaPicker,thumb,previews,icon,moreMenu,confirmed,readOnly,touch,collections:collections??[],mediaLabels});
  const iconFor=(group,type)=>group==='header'?'header':group==='footer'?'footer':hasImage(type)?'image':'section';
  // "···" menu: a small popover of extra actions (move, hide, remove).
  function moreMenu(name,items){
   const d=el('details',undefined,'theme-more'),sum=el('summary');sum.append(el('span','⋯','theme-more-dots'),el('span',`More actions for ${name}`,'visually-hidden'));sum.setAttribute('title','More actions');
   const menu=el('div',undefined,'theme-menu');for(const [text,fn,disabled,aria] of items){const n=button(text,fn,disabled);if(aria)n.setAttribute('aria-label',aria);menu.append(n);}
   d.addEventListener('toggle',()=>{if(d.open)for(const o of panel.querySelectorAll('details.theme-more[open]'))if(o!==d)o.open=false;});
   d.append(sum,menu);return d;
  }
  function draw(){
   panel.replaceChildren();panel.classList.toggle('has-settings',view.mode!=='tree');
   // Page picker (as in Shopify's editor): the home page or another storefront page.
   const pick=select([['home','Home page'],...PAGE_SLUGS.map(s=>[s,pages.template(content,s,false).title])],page);pick.setAttribute('aria-label','Page to edit');pick.classList.add('theme-page-select');
   pick.addEventListener('change',()=>{page=pick.value;view={mode:'tree'};draw();refresh();});
   const head=el('div',undefined,'theme-panel-title');head.append(pick);panel.append(head);
   const tree=el('div',undefined,'theme-tree-wrap');panel.append(tree);
   // Header and footer are shared by every page; the template group is the chosen page's sections.
   const choose=v=>{view=v;draw();};
   tree.append(pages.tree(content,'header',view,choose,draw,{title:'Header',fixed:true}),pages.tree(content,page,view,choose,draw,{title:'Template'}),pages.tree(content,'footer',view,choose,draw,{title:'Footer',fixed:true}));
   if(view.mode==='lq-section'&&pages.template(content,view.tpl,false)?.sections[view.id]){const f=pages.sectionForm(content,view.tpl,view.id,draw);return drawCard(f.title,'section',f.body,readOnly||view.tpl!==page?null:[[f.hidden?'Show section':'Hide section',f.toggle],['Remove section',()=>{if(!confirmed('Remove this section from the page?'))return;f.remove();view={mode:'tree'};draw();}]]);}
   if(view.mode==='lq-page'&&page!=='home')return drawCard('Page title and text','gear',pages.pageForm(content,page),null);
   view={mode:'tree'};panel.classList.remove('has-settings');
  }
  function drawCard(title,iconName,body,menu){
   const card=el('div',undefined,'theme-settings-card'),head=el('div',undefined,'theme-settings-head');head.append(icon(iconName),el('h2',title,'theme-form-title'));
   if(menu)head.append(moreMenu(title,menu.map(([text,fn])=>[text,fn,false])));
   const close=button('×',()=>{view={mode:'tree'};draw();});close.classList.add('theme-close');close.setAttribute('aria-label','Close settings');head.append(close);
   card.append(head,body);panel.append(card);
  }
  function drawForm(title,fields,values,ctx,iconName){
   const card=el('div',undefined,'theme-settings-card'),head=el('div',undefined,'theme-settings-head');
   head.append(icon(iconName),el('h2',title,'theme-form-title'));
   if(ctx&&!readOnly)head.append(moreMenu(title,[[ctx.s.hidden?'Show section':'Hide section',()=>{ctx.s.hidden=!ctx.s.hidden;touch();draw();},false],
    ...(ctx.group==='sections'?[['Remove section',()=>{if(!confirmed('Remove this section from the theme?'))return;ctx.list.splice(ctx.list.indexOf(ctx.s),1);touch();view={mode:'tree'};draw();},false]]:[])]));
   const close=button('×',()=>{view={mode:'tree'};draw();});close.classList.add('theme-close');close.setAttribute('aria-label','Close settings');head.append(close);
   const form=el('div',undefined,'section-form theme-form');card.append(head,form);panel.append(card);
   const redraw=()=>{form.replaceChildren(...fields.map(f=>control(values,f,redraw)));if(readOnly)for(const n of form.querySelectorAll('input,textarea,select,button'))n.disabled=true;};
   redraw();
  }
  // One form control per schema field; lists nest (menu → drop-down items, footer columns → links).
  function control(v,f,redraw){
   if(f.when&&v[f.when[0]]!==f.when[1])return el('span');
   if(['text','textarea','link'].includes(f.type)){const x=field(f.label+(f.required?' *':''),v[f.key],f.type==='textarea'?'textarea':'text');if(f.max)x.input.maxLength=f.max;if(f.type==='textarea')x.input.rows=3;if(f.type==='link')x.input.placeholder='/pages/contact or https://…';x.input.addEventListener('input',()=>{v[f.key]=x.input.value;touch();});return x.wrap;}
   if(f.type==='color'){const x=field(f.label,v[f.key],'color');x.input.addEventListener('input',()=>{v[f.key]=x.input.value.toLowerCase();touch();});x.wrap.classList.add('color-field');return x.wrap;}
   if(f.type==='checkbox'){const l=el('label',undefined,'check-field'),input=el('input');input.type='checkbox';input.checked=!!v[f.key];input.addEventListener('change',()=>{v[f.key]=input.checked;touch();});l.append(input,el('span',f.label));return l;}
   if(f.type==='number'){const x=field(f.label,v[f.key],'number');x.input.min=f.min;x.input.max=f.max;x.input.step=1;x.input.addEventListener('input',()=>{const n=Number(x.input.value);if(Number.isInteger(n)){v[f.key]=n;touch();}});return x.wrap;}
   if(f.type==='choice'||f.type==='collection'){const options=f.type==='choice'?f.options:[['','Choose a collection'],...collections.map(c=>[String(c.id),c.title+(c.status==='active'?'':' (draft)')])];const n=select(options,v[f.key]??'');const l=el('label',f.label);l.append(n);n.addEventListener('change',()=>{v[f.key]=n.value||(f.type==='collection'?null:n.value);touch();redraw();});return l;}
   if(f.type==='media'){
    const wrap=el('div',undefined,'media-field'),slot=el('div');wrap.append(el('span',f.label,'field-label'));
    if(v[f.key]){const img=thumb(mediaLabels.get(v[f.key])??'Selected image');wrap.append(img,el('small',mediaLabels.get(v[f.key])??`Image #${v[f.key]}`,'picker-name'));previews([{id:v[f.key],img}]);}
    else wrap.append(el('p','No image selected.','muted'));
    const tools=el('div',undefined,'actions');tools.append(button(v[f.key]?'Replace image':'Choose image',async()=>{const p=mediaPicker([],1,items=>{v[f.key]=items[0].media_id;mediaLabels.set(items[0].media_id,items[0].label);touch();redraw();});slot.replaceChildren(p.box);await p.load();p.focus();},readOnly));
    if(v[f.key])tools.append(button('Remove image',()=>{v[f.key]=null;touch();redraw();},readOnly));
    wrap.append(tools,slot);return wrap;
   }
   if(f.type==='list'){
    const items=v[f.key],box=el('fieldset',undefined,'list-field');box.append(el('legend',`${f.label} · ${items.length}/${f.max}`));
    for(const [i,item] of items.entries()){
     const d=el('details',undefined,'list-item');d.open=openItems.has(item);d.addEventListener('toggle',()=>{if(d.open)openItems.add(item);else openItems.delete(item);});
     const name=String(item[f.itemLabel]??'').trim()||`Item ${i+1}`;d.append(el('summary',name));
     for(const sub of f.fields)d.append(control(item,sub,redraw));
     const tools=el('div',undefined,'row-actions');
     const b=(text,fn,disabled,aria)=>{const n=button(text,fn,disabled);n.setAttribute('aria-label',`${aria} ${name}`);tools.append(n);};
     b('↑',()=>{[items[i-1],items[i]]=[items[i],items[i-1]];touch();redraw();},readOnly||i===0,'Move up');
     b('↓',()=>{[items[i+1],items[i]]=[items[i],items[i+1]];touch();redraw();},readOnly||i===items.length-1,'Move down');
     b('Remove',()=>{items.splice(i,1);touch();redraw();},readOnly,'Remove');
     d.append(tools);box.append(d);
    }
    box.append(button(`Add to ${f.label.toLowerCase()}`,()=>{const item=fieldDefaults(f.fields);items.push(item);openItems.add(item);touch();redraw();},readOnly||items.length>=f.max));
    return box;
   }
   return el('span');
  }
  draw();frame.setWidth(1280);await refresh();
 }
 return {overview,edit:editTheme};
}
