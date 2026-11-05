// Section schema shared by the API (validation) and the admin (form generation and preview).
// Adding a section type here makes it available everywhere; unknown fields are always rejected.
const text=(key,label,max,extra={})=>({key,label,type:'text',max,...extra});
const area=(key,label,max,extra={})=>({key,label,type:'textarea',max,...extra});
const choice=(key,label,options,extra={})=>({key,label,type:'choice',options,...extra});
const cta=[text('cta_label','Button label',40),{key:'cta_href',label:'Button link (/path or https://…)',type:'link'}];
export const SECTION_TYPES=Object.freeze({
 hero:{label:'Hero',fields:[text('eyebrow','Eyebrow',60),text('heading','Heading',90,{required:true}),area('body','Text',400),{key:'media_id',label:'Background image',type:'media'},...cta,choice('align','Alignment',[['left','Left'],['center','Centre']])]},
 image_text:{label:'Image + Text',fields:[text('eyebrow','Eyebrow',60),text('heading','Heading',90,{required:true}),area('body','Text',2000),{key:'media_id',label:'Image',type:'media'},text('image_alt','Image alt text',200),choice('image_position','Image position',[['left','Image left'],['right','Image right']]),...cta]},
 product_grid:{label:'Product Grid',fields:[text('heading','Heading',90),area('body','Intro text',400),choice('source','Products from',[['collection','A collection'],['manual','Chosen products']]),{key:'collection_id',label:'Collection',type:'collection',when:['source','collection']},{key:'product_ids',label:'Products (in order)',type:'products',max:24,when:['source','manual']},{key:'limit',label:'Number of products',type:'number',min:1,max:24,default:8},...cta]},
 banner:{label:'Banner',fields:[text('text','Text',160,{required:true}),...cta,choice('theme','Style',[['light','Light'],['dark','Dark'],['accent','Accent']])]},
 rich_text:{label:'Text',fields:[text('heading','Heading',90),area('body','Text',5000,{required:true}),choice('align','Alignment',[['left','Left'],['center','Centre']])]}
});
export const MAX_SECTIONS=30;
export const newSectionId=()=>'s'+Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
export function defaults(type){
 const settings={};
 for(const f of SECTION_TYPES[type].fields)settings[f.key]=f.type==='choice'?f.options[0][0]:f.type==='number'?f.default??f.min:f.type==='products'?[]:f.type==='media'||f.type==='collection'?null:'';
 return settings;
}
const fail=message=>{throw Object.assign(new Error(message),{validation:true});};
const ID=/^[1-9]\d{0,17}$/;
export function validLink(value){return value===''||/^\/(?!\/)[A-Za-z0-9\-._~/?#&=%+]*$/.test(value)||/^(mailto|tel):[^\s<>"]{1,200}$/.test(value)||(()=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}})();}
// Returns a clean copy (ids as strings, trimmed text, every field present) or throws with a staff-readable message.
export function normalizeSections(value){
 if(!Array.isArray(value)||value.length>MAX_SECTIONS)fail(`Use up to ${MAX_SECTIONS} sections`);
 const seen=new Set();
 return value.map((s,i)=>{
  const where=`Section ${i+1}`;
  if(!s||typeof s!=='object'||Array.isArray(s))fail(where+': invalid section');
  if(Object.keys(s).some(k=>!['id','type','hidden','settings'].includes(k)))fail(where+': unknown property');
  const schema=SECTION_TYPES[s.type];if(!schema)fail(where+': unknown section type');
  const id=String(s.id??'');if(!/^[A-Za-z0-9_-]{1,40}$/.test(id)||seen.has(id))fail(where+': invalid or duplicate id');seen.add(id);
  if(s.hidden!==undefined&&typeof s.hidden!=='boolean')fail(where+': hidden must be true or false');
  const input=s.settings??{};if(typeof input!=='object'||Array.isArray(input))fail(where+': invalid settings');
  if(Object.keys(input).some(k=>!schema.fields.some(f=>f.key===k)))fail(where+': unknown setting');
  const settings={},label=`${where} (${schema.label})`;
  for(const f of schema.fields){
   const v=input[f.key];
   if(f.type==='text'||f.type==='textarea'){const t=String(v??'').trim();if(t.length>f.max)fail(`${label}: ${f.label} must be ${f.max} characters or fewer`);settings[f.key]=t;}
   else if(f.type==='link'){const t=String(v??'').trim();if(!validLink(t))fail(`${label}: ${f.label} must start with / or https://`);settings[f.key]=t;}
   else if(f.type==='choice'){const t=v??f.options[0][0];if(!f.options.some(([o])=>o===t))fail(`${label}: invalid ${f.label}`);settings[f.key]=t;}
   else if(f.type==='number'){const n=v??f.default??f.min;if(!Number.isInteger(n)||n<f.min||n>f.max)fail(`${label}: ${f.label} must be ${f.min}–${f.max}`);settings[f.key]=n;}
   else if(f.type==='media'||f.type==='collection'){if(v==null||v===''){settings[f.key]=null;continue;}const t=String(v);if(!ID.test(t))fail(`${label}: invalid ${f.label}`);settings[f.key]=t;}
   else if(f.type==='products'){const list=v??[];if(!Array.isArray(list)||list.length>f.max)fail(`${label}: choose up to ${f.max} products`);const ids=list.map(String);if(ids.some(x=>!ID.test(x))||new Set(ids).size!==ids.length)fail(`${label}: invalid or duplicate products`);settings[f.key]=ids;}
  }
  for(const f of schema.fields)if(f.required&&!settings[f.key])fail(`${label}: ${f.label} is required`);
  if(settings.cta_label&&!settings.cta_href)fail(`${label}: add a link for the button`);
  return {id,type:s.type,hidden:s.hidden??false,settings};
 });
}
// Starting layouts. Copy for the five standard pages comes from the existing V2 site content.
const s=(type,settings)=>({id:newSectionId(),type,hidden:false,settings:{...defaults(type),...settings}});
export const TEMPLATES=Object.freeze({
 blank:{label:'Blank page',build:()=>({title:'',slug:'',seo_title:'',seo_description:'',sections:[]})},
 home:{label:'Home',build:()=>({title:'Home',slug:'home',seo_title:'Jack Studio',seo_description:'Thoughtfully designed leather goods for everyday and every journey.',sections:[
  s('hero',{eyebrow:'THOUGHTFULLY DESIGNED',heading:'From everyday essentials to every journey',body:'Leather bags, wallets and travel goods made to last.',cta_label:'Shop the collection',cta_href:'/collections'}),
  s('product_grid',{heading:'Product Collection',source:'collection',limit:8}),
  s('image_text',{heading:'Our Story',body:'We believe thoughtful design begins by understanding everyday life.',cta_label:'Read our story',cta_href:'/pages/brand-story',image_position:'right'}),
  s('banner',{text:'Personalisation, repairs and aftercare for every Jack Studio piece.',cta_label:'Our services',cta_href:'/pages/our-services',theme:'dark'})]})},
 'brand-story':{label:'Brand Story',build:()=>({title:'Brand Story',slug:'brand-story',seo_title:'Our Story | Jack Studio',seo_description:'Discover the Jack Studio story.',sections:[s('rich_text',{heading:'Brand Story',body:'We believe thoughtful design begins by understanding everyday life. From everyday needs to every journey.'})]})},
 'our-services':{label:'Our Services',build:()=>({title:'Our Services',slug:'our-services',seo_title:'Our Services | Jack Studio',seo_description:'Personalisation, repairs and aftercare.',sections:[s('rich_text',{heading:'Our Services',body:"We're here to provide thoughtful services designed around your needs, from personalisation to ongoing support."})]})},
 'corporate-solution':{label:'Corporate Solution',build:()=>({title:'Corporate Solution',slug:'corporate-solution',seo_title:'Corporate Gifts | Jack Studio',seo_description:'Discover corporate gifts and customization.',sections:[s('rich_text',{heading:'Corporate Solution',body:'Thoughtful corporate gifting for teams, clients and milestones.'})]})},
 outlets:{label:'Outlets',build:()=>({title:'Outlets',slug:'outlets',seo_title:'Store Locations | Jack Studio',seo_description:'Find Jack Studio stores.',sections:[s('rich_text',{heading:'Outlets',body:'Find your nearest Jack Studio outlet.'})]})},
 contact:{label:'Contact',build:()=>({title:'Contact',slug:'contact',seo_title:'Contact | Jack Studio',seo_description:'Contact Jack Studio.',sections:[s('rich_text',{heading:'Contact',body:'Get in touch with our team.'})]})}
});
