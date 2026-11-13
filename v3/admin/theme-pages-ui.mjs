// Theme editor for the other storefront pages (brand story, outlets, policies…): their Shopify sections
// and blocks, with forms generated from each section's Shopify schema (the same settings as in Shopify).
import {SECTION_SCHEMAS,PAGE_TEMPLATES,ADDABLE,blockSchema,liquidLabel} from '../shared/page-templates.mjs';

const uid=()=>Math.random().toString(36).slice(2,10);
const defaultsOf=schema=>Object.fromEntries((schema?.settings??[]).filter(f=>f.id&&f.default!==undefined).map(f=>[f.id,f.default]));

export function createPageTools(h){
 const {el,button,field,select,mediaPicker,thumb,previews,icon,moreMenu,confirmed,readOnly,touch,collections,mediaLabels}=h;
 // A page's template inside the theme content; the first edit copies the Shopify default into the theme.
 function template(content,slug,create){if(content.templates?.[slug])return content.templates[slug];if(!create)return PAGE_TEMPLATES[slug];content.templates??={};return content.templates[slug]=structuredClone(PAGE_TEMPLATES[slug]);}
 const sectionName=s=>s.name||liquidLabel(s.type);

 function tree(content,slug,view,choose,redraw){
  const t=template(content,slug,false),box=el('div');
  box.append(el('h3','Template','theme-group-title'));
  const ol=el('ol',undefined,'theme-tree');box.append(ol);
  t.order.forEach((id,i)=>{
   const s=t.sections[id],name=sectionName(s),selected=view.mode==='lq-section'&&view.id===id;
   const li=el('li',undefined,'theme-tree-item'+(s.disabled?' is-hidden':'')+(selected?' is-selected':''));
   const open=button('',()=>choose({mode:'lq-section',id}));open.classList.add('theme-tree-open');open.append(icon('section'),el('span',name,'theme-tree-name'));open.setAttribute('aria-label',`${readOnly?'View':'Edit'} ${name}`);if(selected)open.setAttribute('aria-current','true');
   const eye=button('',()=>{const w=template(content,slug,true);w.sections[id].disabled=!w.sections[id].disabled;if(!w.sections[id].disabled)delete w.sections[id].disabled;touch();redraw();},readOnly);eye.classList.add('theme-eye');eye.append(icon(s.disabled?'eyeOff':'eye'));eye.setAttribute('aria-label',`${s.disabled?'Show':'Hide'} ${name}`);
   li.append(open,eye);
   if(!readOnly)li.append(moreMenu(name,[
    ['Move up',()=>{const w=template(content,slug,true);[w.order[i-1],w.order[i]]=[w.order[i],w.order[i-1]];touch();redraw();},i===0,`Move up ${name}`],
    ['Move down',()=>{const w=template(content,slug,true);[w.order[i+1],w.order[i]]=[w.order[i],w.order[i+1]];touch();redraw();},i===t.order.length-1,`Move down ${name}`],
    ['Remove section',()=>{if(!confirmed(`Remove this ${name} section from the page?`))return;const w=template(content,slug,true);w.order.splice(i,1);delete w.sections[id];touch();if(selected)choose({mode:'tree'});else redraw();},false,`Remove ${name}`]]));
   ol.append(li);
  });
  if(!readOnly){
   const add=select(ADDABLE.map(type=>[type,liquidLabel(type)]),ADDABLE[0]);add.setAttribute('aria-label','Section to add to this page');
   const row=el('div',undefined,'section-adder');row.hidden=true;
   row.append(add,button('Add section',()=>{const w=template(content,slug,true),id=add.value.replace(/[^\w]/g,'_')+'_'+uid(),schema=SECTION_SCHEMAS[add.value];
    const preset=schema.presets?.[0]??{},blocks={},order=[];for(const b of preset.blocks??[]){const bid=uid();blocks[bid]={type:b.type,settings:{...defaultsOf(blockSchema(add.value,b.type)),...(b.settings??{})}};order.push(bid);}
    w.sections[id]={type:add.value,settings:{...defaultsOf(schema),...(preset.settings??{})},blocks,block_order:order};w.order.push(id);touch();choose({mode:'lq-section',id});}));
   const plus=button('+ Add section',()=>{row.hidden=!row.hidden;plus.setAttribute('aria-expanded',String(!row.hidden));});plus.classList.add('theme-add-section');plus.setAttribute('aria-expanded','false');
   box.append(plus,row);
  }
  const page=button('',()=>choose({mode:'lq-page'}));page.classList.add('theme-settings-open');page.append(icon('gear'),el('span','Page title and text'));if(view.mode==='lq-page')page.classList.add('is-selected');box.append(page);
  return box;
 }

 // One control per Shopify setting type.
 function control(values,f,write,redraw){
  if(f.type==='header')return el('h4',f.content??'','lq-field-header');
  if(f.type==='paragraph')return el('p',f.content??'','muted lq-field-note');
  if(!f.id)return el('span');
  const label=f.label??f.id,v=values[f.id]??f.default??'';
  const hint=n=>{if(f.info){const p=el('small',f.info,'muted lq-field-info');n.append(p);}return n;};
  if(f.type==='checkbox'){const w=el('label',undefined,'lq-check'),i=el('input');i.type='checkbox';i.checked=v===true;i.addEventListener('change',()=>write(f.id,i.checked));w.append(i,document.createTextNode(' '+label));return hint(w);}
  if(f.type==='select'||f.type==='radio'){const w=el('label',label),s=select((f.options??[]).map(o=>[String(o.value),o.label??String(o.value)]),String(v));s.addEventListener('change',()=>write(f.id,s.value));w.append(s);return hint(w);}
  if(f.type==='range'||f.type==='number'){const x=field(label+(f.unit?` (${f.unit})`:''),String(v),'text');x.input.type='number';if(f.min!=null)x.input.min=f.min;if(f.max!=null)x.input.max=f.max;if(f.step!=null)x.input.step=f.step;x.input.addEventListener('input',()=>{if(x.input.value!==''&&Number.isFinite(Number(x.input.value)))write(f.id,Number(x.input.value));});return hint(x.wrap);}
  if(f.type==='color'||f.type==='color_background'){const w=el('label',label,'lq-color'),row=el('span',undefined,'lq-color-row'),c=el('input'),t=el('input');c.type='color';t.type='text';t.value=v;c.value=/^#[0-9a-f]{6}$/i.test(v)?v:'#000000';c.setAttribute('aria-label',label+' picker');
   c.addEventListener('input',()=>{t.value=c.value;write(f.id,c.value);});t.addEventListener('change',()=>{if(/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)?$/i.test(t.value.trim())){write(f.id,t.value.trim()||null);if(/^#[0-9a-f]{6}$/i.test(t.value))c.value=t.value;}});row.append(c,t);w.append(row);return hint(w);}
  if(f.type==='collection'){const w=el('label',label),s=select([['','None'],...collections.map(c=>[c.slug,c.title])],String(v));s.addEventListener('change',()=>write(f.id,s.value||null));w.append(s);return hint(w);}
  if(f.type==='image_picker'){
   const wrap=el('div',undefined,'media-field'),slot=el('div');wrap.append(el('span',label,'field-label'));
   const ref=values[f.id];
   if(ref){const name=/^shopify:/.test(ref)?ref.split('/').pop():mediaLabels.get(ref)??`Image #${ref}`;if(/^\d+$/.test(ref)){const img=thumb(name);wrap.append(img);previews([{id:ref,img}]);}wrap.append(el('small',name,'picker-name'));}
   else wrap.append(el('p','No image selected.','muted'));
   if(!readOnly){const tools=el('div',undefined,'actions');tools.append(button(ref?'Replace image':'Choose image',async()=>{const p=mediaPicker([],1,items=>{write(f.id,items[0].media_id);mediaLabels.set(items[0].media_id,items[0].label);redraw();});slot.replaceChildren(p.box);await p.load();}));if(ref)tools.append(button('Remove image',()=>{write(f.id,null);redraw();}));wrap.append(tools,slot);}
   return hint(wrap);
  }
  if(f.type==='video'||f.type==='product'||f.type==='metaobject'||f.type==='product_list'||f.type==='collection_list'){return hint(el('p',`${label}: not available on the new site yet.`,'muted'));}
  const long=['textarea','richtext','html','inline_richtext','liquid'].includes(f.type);
  const x=field(label,v==null?'':String(v),long?'textarea':'text');if(long)x.input.rows=f.type==='richtext'||f.type==='html'?5:3;if(f.type==='url'||f.type==='video_url')x.input.placeholder='/pages/contact or https://…';if(f.placeholder)x.input.placeholder=f.placeholder;
  x.input.addEventListener('input',()=>write(f.id,x.input.value));return hint(x.wrap);
 }
 function fields(schema,values,write,redraw){const box=el('div',undefined,'section-form theme-form');for(const f of schema?.settings??[])box.append(control(values,f,write,redraw));if(readOnly)for(const n of box.querySelectorAll('input,textarea,select,button'))n.disabled=true;return box;}

 function sectionForm(content,slug,id,redraw){
  const t=template(content,slug,false),s=t.sections[id],schema=SECTION_SCHEMAS[s.type],box=el('div');
  const live=()=>template(content,slug,true).sections[id];
  box.append(fields(schema,s.settings??{},(k,v)=>{const w=live();w.settings??={};if(v==null)delete w.settings[k];else w.settings[k]=v;touch();},redraw));
  if(schema.blocks?.length){
   const order=s.block_order??Object.keys(s.blocks??{}),list=el('fieldset',undefined,'list-field');list.append(el('legend',`Blocks · ${order.length}${schema.max_blocks?'/'+schema.max_blocks:''}`));
   order.forEach((bid,i)=>{const b=s.blocks[bid],bs=blockSchema(s.type,b.type),title=b.settings?.title||b.settings?.heading||b.settings?.name||bs?.name||b.type;
    const d=el('details',undefined,'list-item'+(b.disabled?' is-hidden':''));d.append(el('summary',`${bs?.name??b.type}: ${String(title).replace(/<[^>]*>/g,'').slice(0,40)}`));
    d.append(fields(bs,b.settings??{},(k,v)=>{const w=live().blocks[bid];w.settings??={};if(v==null)delete w.settings[k];else w.settings[k]=v;touch();},redraw));
    if(!readOnly){const tools=el('div',undefined,'row-actions');
     tools.append(button('↑',()=>{const o=live().block_order;[o[i-1],o[i]]=[o[i],o[i-1]];touch();redraw();},i===0),button('↓',()=>{const o=live().block_order;[o[i+1],o[i]]=[o[i],o[i+1]];touch();redraw();},i===order.length-1),
      button(b.disabled?'Show':'Hide',()=>{const w=live().blocks[bid];w.disabled=!w.disabled;if(!w.disabled)delete w.disabled;touch();redraw();}),button('Remove',()=>{if(!confirmed('Remove this block?'))return;const w=live();w.block_order.splice(i,1);delete w.blocks[bid];touch();redraw();}));
     for(const [k,n] of [['Move up',0],['Move down',1]])tools.children[n].setAttribute('aria-label',`${k} ${title}`);d.append(tools);}
    list.append(d);});
   if(!readOnly&&(!schema.max_blocks||order.length<schema.max_blocks)){const types=schema.blocks.filter(b=>b.type!=='@app');const pick=select(types.map(b=>[b.type,b.name??b.type]),types[0]?.type);pick.setAttribute('aria-label','Block to add');
    list.append(el('div',undefined,'toolbar section-adder'));list.lastChild.append(pick,button('Add block',()=>{const w=live(),bid=uid();w.blocks??={};w.block_order??=Object.keys(w.blocks);w.blocks[bid]={type:pick.value,settings:defaultsOf(blockSchema(s.type,pick.value))};w.block_order.push(bid);touch();redraw();}));}
   box.append(list);
  }
  return {title:sectionName(s),body:box,hidden:!!s.disabled,toggle:()=>{const w=live();w.disabled=!w.disabled;if(!w.disabled)delete w.disabled;touch();redraw();},remove:()=>{const w=template(content,slug,true);w.order.splice(w.order.indexOf(id),1);delete w.sections[id];touch();}};
 }
 function pageForm(content,slug){
  const t=template(content,slug,false),box=el('div',undefined,'section-form theme-form');
  const title=field('Page title',t.title,'text');title.input.maxLength=120;title.input.addEventListener('input',()=>{template(content,slug,true).title=title.input.value;touch();});
  const text=field('Page text (used by sections that show the page text, e.g. policies; simple HTML)',t.content??'','textarea');text.input.rows=12;text.input.addEventListener('input',()=>{template(content,slug,true).content=text.input.value;touch();});
  box.append(title.wrap,text.wrap);if(readOnly)for(const n of box.querySelectorAll('input,textarea'))n.disabled=true;return box;
 }
 return {template,tree,sectionForm,pageForm};
}
