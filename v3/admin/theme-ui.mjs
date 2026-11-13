// Online Store themes in the admin: the current (live) theme, the theme library and the theme editor
// (header, home page template, footer and theme settings with a live device preview), modelled on
// Shopify's Online Store. Uses the workspace helpers from catalog-ui.mjs.
import {THEME_SETTINGS,THEME_SECTIONS,TEMPLATE_TYPES,GROUPS,MAX_TEMPLATE_SECTIONS,sectionLabel,sectionFields,defaults,fieldDefaults,newSectionId} from '../shared/theme-schema.mjs';
import {themeDocument} from './theme-render.mjs';
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
  return {stage,show:data=>{frame.srcdoc=themeDocument(data.theme,safeMedia(data.media),origin());fit();},setWidth:w=>{width=w;fit();},fit,destroy:()=>typeof window!=='undefined'&&window.removeEventListener('resize',fit)};
 }
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
   actions.append(edit,view,button('Duplicate',()=>duplicate(live),readOnly||data.items.length>=max),button('Rename',()=>rename(live),readOnly),button('Auto-fill images',()=>autofill(live),readOnly));info.append(actions);
   grid.append(frame.stage,info);cur.append(grid);
   api(`themes/${live.id}/preview`).then(p=>{if(current(t))frame.show(p);}).catch(err=>{frame.stage.replaceWith(el('p','Preview unavailable: '+err.message,'muted'));});
  }
  const lib=el('section',undefined,'card theme-library');root.append(lib);
  lib.append(el('h2','Theme library'),el('p','Themes here stay private until you publish them. Publishing one replaces the current theme; the old one returns to the library.','muted'));
  if(!library.length)lib.append(el('p','No other themes in the library.','muted'));
  for(const theme of library){
   const row=el('div',undefined,'theme-row'),copy=el('div');copy.append(el('strong',theme.name),el('span',`Last saved ${when(theme.updated_at)}`,'muted'));
   const tools=el('div',undefined,'row-actions'),pub=button('Publish',()=>publish(theme),readOnly);pub.classList.add('primary');
   tools.append(pub,button(readOnly?'View':'Edit theme',()=>editTheme(theme.id)),button('Duplicate',()=>duplicate(theme),readOnly||data.items.length>=max),button('Rename',()=>rename(theme),readOnly),button('Auto-fill images',()=>autofill(theme),readOnly),
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
  let dirty=false,device='desktop',timer=null,view={mode:'tree'};
  const touch=()=>{dirty=true;setDirty(true);schedule();};
  // Toolbar.
  const bar=el('div',undefined,'theme-toolbar'),devices=el('div',undefined,'device-toggle');devices.setAttribute('role','group');devices.setAttribute('aria-label','Preview device');
  const frame=previewFrame(`Theme preview: ${theme.name}`);
  for(const [k,label,width] of DEVICES){const n=button(`${label} · ${width}px`,()=>{device=k;for(const b of devices.children)b.setAttribute('aria-pressed',String(b===n));frame.setWidth(width);});n.setAttribute('aria-pressed',String(k===device));devices.append(n);}
  const save=button('Save',async()=>{await persist();notify(theme.is_live?'Theme saved. The storefront is updated.':'Theme saved.');},readOnly);save.classList.add('primary');
  const actions=el('div',undefined,'actions');actions.append(save);
  if(!theme.is_live)actions.append(button(dirty?'Save and publish':'Publish',async()=>{if(!confirmed(`Publish "${theme.name}"? It replaces the current theme on the storefront.`))return;if(dirty)await persist();await api(`themes/${id}/publish`,{revision:theme.revision},'POST');dirty=false;setDirty(false);notify(`${theme.name} is now live.`);await navigate('Website');},readOnly));
  actions.append(button('Back to Online Store',()=>navigate('Website')));
  bar.append(devices,actions);root.append(bar);
  const layout=el('div',undefined,'theme-editor'),panel=el('section',undefined,'card theme-panel'),previewCard=el('section',undefined,'card theme-preview'),note=el('p','','muted');
  previewCard.append(note,frame.stage);layout.append(panel,previewCard);root.append(layout);
  async function persist(){const saved=await api('themes/'+id,{revision:theme.revision,content},'PATCH');theme.revision=saved.revision;dirty=false;setDirty(false);return saved;}
  function schedule(){if(readOnly)return;clearTimeout(timer);timer=setTimeout(()=>refresh(),600);}
  async function refresh(){
   note.textContent='Updating preview…';
   try{const data=readOnly?await api(`themes/${id}/preview`):await api('themes/preview',{content},'POST');if(!current(t))return;frame.show(data);note.textContent=readOnly?'Showing the saved theme.':dirty?'Showing your unsaved changes. Save to keep them.':'Showing the saved theme.';}
   catch(err){note.textContent='Preview not updated: '+err.message;}
  }
  // Panel: section tree, one section's settings or theme settings.
  const groups=[['header','Header',content.header],['sections','Template · Home page',content.sections],['footer','Footer',content.footer]];
  function draw(){
   panel.replaceChildren();
   if(view.mode==='settings')return drawForm('Theme settings',THEME_SETTINGS,content.settings,null);
   if(view.mode==='section'){const list=content[view.group],s=list.find(x=>x.id===view.id);if(s)return drawForm(sectionLabel(s.type),sectionFields(s.type),s.settings,{list,s,group:view.group});view={mode:'tree'};}
   for(const [group,label,list] of groups){
    panel.append(el('h2',label,'theme-group-title'));
    const ol=el('ol',undefined,'theme-tree');panel.append(ol);
    for(const [i,s] of list.entries()){
     const li=el('li',undefined,'theme-tree-item'+(s.hidden?' is-hidden':'')),name=sectionLabel(s.type);
     const open=button(name,()=>{view={mode:'section',group,id:s.id};draw();});open.classList.add('theme-tree-open');open.setAttribute('aria-label',`${readOnly?'View':'Edit'} ${name}${list.filter(x=>x.type===s.type).length>1?' '+(i+1):''}`);
     const tools=el('div',undefined,'row-actions');
     const b=(text,fn,disabled,aria)=>{const n=button(text,fn,disabled);n.setAttribute('aria-label',`${aria} ${name}`);tools.append(n);};
     b(s.hidden?'Show':'Hide',()=>{s.hidden=!s.hidden;touch();draw();},readOnly,s.hidden?'Show':'Hide');
     if(group==='sections'){
      b('↑',()=>{[list[i-1],list[i]]=[list[i],list[i-1]];touch();draw();},readOnly||i===0,'Move up');
      b('↓',()=>{[list[i+1],list[i]]=[list[i],list[i+1]];touch();draw();},readOnly||i===list.length-1,'Move down');
      b('Remove',()=>{if(!confirmed(`Remove this ${name} section from the theme?`))return;list.splice(i,1);touch();draw();},readOnly,'Remove');
     }
     li.append(open);if(s.hidden)li.append(el('span','Hidden','badge'));li.append(tools);ol.append(li);
    }
    const missing=group==='sections'?TEMPLATE_TYPES:GROUPS[group].filter(type=>!list.some(s=>s.type===type));
    if(missing.length&&!readOnly&&(group!=='sections'||list.length<MAX_TEMPLATE_SECTIONS)){
     const add=select(missing.map(type=>[type,sectionLabel(type)]),missing[0]);add.setAttribute('aria-label',`Section to add to ${label}`);
     const row=el('div',undefined,'toolbar section-adder');row.append(add,button('Add section',()=>{const s={id:newSectionId(),type:add.value,hidden:false,settings:defaults(add.value)};list.push(s);touch();view={mode:'section',group,id:s.id};draw();}));panel.append(row);
    }
   }
   const settings=button('Theme settings',()=>{view={mode:'settings'};draw();});settings.classList.add('theme-settings-open');panel.append(settings);
  }
  function drawForm(title,fields,values,ctx){
   const back=button('← All sections',()=>{view={mode:'tree'};draw();});back.classList.add('theme-back');
   panel.append(back,el('h2',title,'theme-group-title'));
   const form=el('div',undefined,'section-form theme-form');panel.append(form);
   const redraw=()=>{form.replaceChildren(...fields.map(f=>control(values,f,redraw)));if(readOnly)for(const n of form.querySelectorAll('input,textarea,select,button'))n.disabled=true;};
   redraw();
   if(ctx&&!readOnly){const tools=el('div',undefined,'actions');tools.append(button(ctx.s.hidden?'Show section':'Hide section',()=>{ctx.s.hidden=!ctx.s.hidden;touch();draw();}));
    if(ctx.group==='sections')tools.append(button('Remove section',()=>{if(!confirmed('Remove this section from the theme?'))return;ctx.list.splice(ctx.list.indexOf(ctx.s),1);touch();view={mode:'tree'};draw();}));panel.append(tools);}
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
