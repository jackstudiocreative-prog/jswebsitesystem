// Online Store theme schema, shared by the API (validation), the admin (forms) and the renderers.
// A theme is {settings, header, sections, footer, templates}: global style settings, the header group
// (announcement bar + header), the home page template sections, the footer group and the other pages.
// Every value is validated and unknown fields are rejected, exactly like page sections.
import {SECTION_TYPES,normalizeSections,validLink,defaults as pageDefaults,newSectionId} from './page-schema.mjs';
export {validLink,newSectionId};
import {normalizeTemplates,templateMedia} from './page-templates.mjs';

const text=(key,label,max,extra={})=>({key,label,type:'text',max,...extra});
const area=(key,label,max,extra={})=>({key,label,type:'textarea',max,...extra});
const link=(key,label,extra={})=>({key,label,type:'link',...extra});
const color=(key,label,value)=>({key,label,type:'color',default:value});
const choice=(key,label,options,extra={})=>({key,label,type:'choice',options,...extra});
const media=(key,label)=>({key,label,type:'media'});
const check=(key,label,value=false)=>({key,label,type:'checkbox',default:value});
const list=(key,label,max,fields,extra={})=>({key,label,type:'list',max,fields,...extra});

export const ICONS=[['shield','Shield'],['target','Target'],['group','Group'],['care','Care'],['personalisation','Personalise'],['gift','Gift'],['delivery','Delivery'],['warranty','Warranty'],['heart','Heart'],['person','Person'],['handshake','Handshake'],['headset','Headset']];

// Global style settings ("Theme settings" in the editor).
export const THEME_SETTINGS=[
 color('background','Page background','#f8f4ea'),
 color('text','Text','#2b2420'),
 color('heading','Headings','#292724'),
 color('muted','Secondary text','#716b63'),
 color('accent','Buttons','#c38239'),
 color('accent_hover','Buttons (hover)','#a8702f'),
 choice('heading_font','Heading font',[['bebas','Bebas Neue'],['inter','Inter'],['georgia','Georgia']]),
 choice('body_font','Body font',[['inter','Inter'],['georgia','Georgia'],['system','System font']]),
 text('home_seo_title','Home page SEO title',70),
 area('home_seo_description','Home page SEO description',160)
];

// Section types that belong to a theme. `group` decides where a type may be placed.
export const THEME_SECTIONS=Object.freeze({
 announcement_bar:{label:'Announcement bar',group:'header',fields:[
  list('messages','Announcements',6,[text('text','Text',140,{required:true}),link('link','Link (optional)')],{itemLabel:'text'}),
  check('autoplay','Rotate automatically',true),
  color('bg','Background','#8da68a'),color('fg','Text','#ffffff')]},
 site_header:{label:'Header',group:'header',fields:[
  media('logo_id','Logo image'),text('logo_text','Logo text (used without an image)',40),
  {key:'logo_height',label:'Logo height (px)',type:'number',min:16,max:200,default:128},
  list('menu','Menu',10,[text('label','Label',40,{required:true}),link('link','Link'),
   list('children','Drop-down items',8,[text('label','Label',40,{required:true}),link('link','Link'),media('image_id','Tile image (optional)')],{itemLabel:'label'})],{itemLabel:'label'}),
  link('search_link','Search icon link (hidden when empty)'),link('account_link','Account icon link (hidden when empty)'),link('wishlist_link','Wishlist icon link (hidden when empty)'),
  check('show_cart','Show bag icon',true),
  link('facebook','Facebook (menu drawer)'),link('instagram','Instagram (menu drawer)'),link('tiktok','TikTok (menu drawer)'),link('youtube','YouTube (menu drawer)'),
  color('bg','Background','#f5f1e8'),color('fg','Text and icons','#292724')]},
 hero_banner:{label:'Hero banner',group:'template',fields:[
  text('eyebrow','Eyebrow',60),text('heading','Heading',90),area('body','Text',300),media('image_id','Background image'),
  text('button_label','Button label',40),link('button_link','Button link')]},
 icon_row:{label:'Icon row',group:'template',fields:[
  text('heading','Heading',90),choice('size','Size',[['large','Large'],['medium','Medium'],['small','Small']]),
  list('items','Items',6,[choice('icon','Icon',ICONS),text('title','Title',40,{required:true}),text('subtitle','Text',120)],{itemLabel:'title'}),
  color('bg','Background','#e9e2d5')]},
 collection_cards:{label:'Collection cards',group:'template',fields:[
  text('heading','Heading',90),text('link_label','"View all" label',40),link('link','"View all" link'),
  list('cards','Cards',12,[media('image_id','Image'),text('title','Title',40,{required:true}),link('link','Link'),color('accent','Label colour','#292724')],{itemLabel:'title'}),
  color('bg','Background','#f5f1e8')]},
 promise_split:{label:'Feature and statistic',group:'template',fields:[
  media('image_id','Feature image'),text('heading','Feature heading',60),area('text','Feature text',300),text('button_label','Feature button label',40),link('button_link','Feature button link'),color('bg','Feature background','#e9e2d5'),
  text('stat_eyebrow','Statistic eyebrow',60),{key:'stat_number',label:'Statistic number (digits and commas)',type:'text',max:12,pattern:'^[0-9,]*$'},text('stat_label','Statistic label',60),area('stat_text','Statistic text',200),
  text('stat_button_label','Statistic button label',40),link('stat_button_link','Statistic button link'),media('stat_image_id','Statistic image'),color('stat_bg','Statistic background','#4a382e')]},
 product_tabs:{label:'Product tabs',group:'template',fields:[
  text('heading','Heading',90),
  list('tabs','Tabs',6,[text('label','Label',40,{required:true}),{key:'collection_id',label:'Collection',type:'collection'}],{itemLabel:'label'}),
  {key:'limit',label:'Products per tab',type:'number',min:1,max:12,default:12},
  color('bg','Background','#f5f1e8'),color('image_bg','Image background','#ffffff'),color('accent','Active tab colour','#c4823a')]},
 story_split:{label:'Image with text',group:'template',fields:[
  media('image_id','Image'),text('heading','Heading',90),area('text','Text',500),text('link_label','Link label',60),link('link','Link'),color('bg','Background','#e9e2d5')]},
 showroom:{label:'Virtual showroom',group:'template',fields:[
  text('eyebrow','Eyebrow',60),text('heading','Heading',90),area('text','Text',300),media('image_id','Cover image'),
  text('button_label','Button label',40),text('hint','Hint',100),link('link','Showroom link'),color('bg','Background','#f5f1e8')]},
 outlets:{label:'Outlets',group:'template',fields:[
  text('heading','Heading',90),text('subtitle','Subtitle',160),
  list('outlets','Outlets',6,[media('image_id','Photo'),text('location','Location label',60),text('name','Name',60,{required:true}),area('address','Address',240),link('directions','Directions link')],{itemLabel:'name'}),
  text('link_label','Button label',40),link('link','Button link'),color('bg','Background','#e9e2d5')]},
 site_footer:{label:'Footer',group:'footer',fields:[
  media('logo_id','Logo image'),text('brand','Brand text (used without an image)',40),{key:'logo_height',label:'Logo height (px)',type:'number',min:16,max:200,default:112},text('tagline','Tagline',90),
  list('columns','Link columns',4,[text('heading','Heading',40,{required:true}),list('links','Links',10,[text('label','Label',40,{required:true}),link('link','Link')],{itemLabel:'label'})],{itemLabel:'heading'}),
  text('contact_heading','Contact heading',40),text('email','Email',120),text('company','Company name',120),area('address','Address',300),
  link('facebook','Facebook'),link('instagram','Instagram'),link('youtube','YouTube'),link('tiktok','TikTok'),
  check('newsletter','Show newsletter sign-up',true),text('newsletter_label','Newsletter label',80),text('newsletter_placeholder','Newsletter placeholder',60),
  text('copyright','Copyright line',120),color('bg','Background','#f8f4ea'),color('fg','Text','#2b2420')]}
});
// Page sections (Hero, Image + Text, Product Grid, Banner, Text) can also be added to the template.
export const TEMPLATE_TYPES=[...Object.entries(THEME_SECTIONS).filter(([,v])=>v.group==='template').map(([k])=>k),...Object.keys(SECTION_TYPES)];
export const GROUPS={header:['announcement_bar','site_header'],footer:['site_footer']};
export const MAX_TEMPLATE_SECTIONS=30;
export const sectionLabel=type=>THEME_SECTIONS[type]?.label??SECTION_TYPES[type]?.label??type;
export const sectionFields=type=>THEME_SECTIONS[type]?.fields??SECTION_TYPES[type]?.fields??[];

export function fieldDefaults(fields){
 const v={};
 for(const f of fields)v[f.key]=f.type==='choice'?f.default??f.options[0][0]:f.type==='number'?f.default??f.min:f.type==='checkbox'?f.default??false:f.type==='color'?f.default:f.type==='list'?[]:f.type==='media'||f.type==='collection'?null:f.default??'';
 return v;
}
export const defaults=type=>THEME_SECTIONS[type]?fieldDefaults(THEME_SECTIONS[type].fields):pageDefaults(type);

const fail=message=>{throw Object.assign(new Error(message),{validation:true});};
const ID=/^[1-9]\d{0,17}$/,HEX=/^#[0-9a-f]{6}$/i;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
// Validates one object of fields (section settings, theme settings or a list item) and returns a clean copy.
export function normalizeFields(fields,input,where){
 if(input==null)input={};if(!plain(input))fail(where+': invalid settings');
 if(Object.keys(input).some(k=>!fields.some(f=>f.key===k)))fail(where+': unknown setting');
 const out={};
 for(const f of fields){
  const v=input[f.key],label=`${where}: ${f.label}`;
  if(f.type==='text'||f.type==='textarea'){const t=String(v??f.default??'').trim();if(t.length>f.max)fail(`${label} must be ${f.max} characters or fewer`);if(f.pattern&&!new RegExp(f.pattern).test(t))fail(`${label} is not valid`);out[f.key]=t;}
  else if(f.type==='link'){const t=String(v??'').trim();if(!validLink(t))fail(`${label} must start with / or https://`);out[f.key]=t;}
  else if(f.type==='choice'){const t=v??f.default??f.options[0][0];if(!f.options.some(([o])=>o===t))fail(`${label} is not a valid choice`);out[f.key]=t;}
  else if(f.type==='number'){const n=v??f.default??f.min;if(!Number.isInteger(n)||n<f.min||n>f.max)fail(`${label} must be ${f.min}–${f.max}`);out[f.key]=n;}
  else if(f.type==='checkbox'){const b=v??f.default??false;if(typeof b!=='boolean')fail(`${label} must be on or off`);out[f.key]=b;}
  else if(f.type==='color'){const c=String(v??f.default);if(!HEX.test(c))fail(`${label} must be a colour like #c38239`);out[f.key]=c.toLowerCase();}
  else if(f.type==='media'||f.type==='collection'){if(v==null||v===''){out[f.key]=null;continue;}const t=String(v);if(!ID.test(t))fail(`${label} is not valid`);out[f.key]=t;}
  else if(f.type==='list'){const items=v??[];if(!Array.isArray(items)||items.length>f.max)fail(`${label}: use up to ${f.max}`);out[f.key]=items.map((item,i)=>normalizeFields(f.fields,item,`${label} ${i+1}`));}
  else fail(`${label}: unsupported field`);
 }
 for(const f of fields)if(f.required&&!out[f.key])fail(`${where}: ${f.label} is required`);
 return out;
}
function normalizeSection(s,where,allowed,seen){
 if(!plain(s))fail(where+': invalid section');
 if(Object.keys(s).some(k=>!['id','type','hidden','settings'].includes(k)))fail(where+': unknown property');
 if(!allowed.includes(s.type))fail(where+': this section type cannot be used here');
 const id=String(s.id??'');if(!/^[A-Za-z0-9_-]{1,40}$/.test(id)||seen.has(id))fail(where+': invalid or duplicate id');seen.add(id);
 if(s.hidden!==undefined&&typeof s.hidden!=='boolean')fail(where+': hidden must be true or false');
 if(SECTION_TYPES[s.type])return normalizeSections([{...s,id:'x'}]).map(x=>({...x,id}))[0]; // page section rules
 const label=`${where} (${THEME_SECTIONS[s.type].label})`;
 return {id,type:s.type,hidden:s.hidden??false,settings:normalizeFields(THEME_SECTIONS[s.type].fields,s.settings,label)};
}
// Returns a clean theme content object or throws a staff-readable validation error.
export function normalizeTheme(content){
 if(!plain(content))fail('Theme content must be an object');
 if(Object.keys(content).some(k=>!['settings','header','sections','footer','templates'].includes(k)))fail('Theme content has an unknown property');
 const seen=new Set();
 const group=(name,value,allowed,max,unique)=>{
  if(!Array.isArray(value??[])||(value??[]).length>max)fail(`${name}: use up to ${max} sections`);
  const out=(value??[]).map((s,i)=>normalizeSection(s,`${name} section ${i+1}`,allowed,seen));
  if(unique&&new Set(out.map(s=>s.type)).size!==out.length)fail(`${name}: each section type can be used once`);
  return out;
 };
 return {
  settings:normalizeFields(THEME_SETTINGS,content.settings,'Theme settings'),
  header:group('Header',content.header,GROUPS.header,2,true),
  sections:group('Template',content.sections,TEMPLATE_TYPES,MAX_TEMPLATE_SECTIONS,false),
  footer:group('Footer',content.footer,GROUPS.footer,1,true),
  // Other pages (/pages/<slug>): Shopify sections per page; absent pages use the Shopify defaults.
  ...(content.templates!=null?{templates:normalizeTemplates(content.templates)}:{})
 };
}
// Every media, collection and product ID a theme refers to (checked by the API).
export function themeReferences(content){
 const refs={media:new Set(),collections:new Set(),products:new Set()};
 const walk=(fields,v)=>{for(const f of fields){const x=v[f.key];if(x==null)continue;if(f.type==='media')refs.media.add(x);else if(f.type==='collection')refs.collections.add(x);else if(f.type==='products')for(const p of x)refs.products.add(p);else if(f.type==='list')for(const item of x)walk(f.fields,item);}};
 for(const s of [...content.header,...content.sections,...content.footer])walk(sectionFields(s.type),s.settings);
 for(const id of templateMedia(content.templates))refs.media.add(id);
 return refs;
}

// Presets: starting points for "Add theme". Jack Studio 2026 reproduces the current Shopify
// storefront (jackstudio.com.my, "Website design 2026"). Images start empty because media IDs
// belong to each database; staff choose them from the Media Library.
const sec=(type,settings,extra={})=>({id:newSectionId(),type,hidden:false,settings:{...defaults(type),...settings},...extra});
const outletsPage='/pages/outlets',collectionsPage='/pages/product-collection';
export const PRESETS=Object.freeze({
 'jack-studio-2026':{label:'Jack Studio 2026',description:'The current jackstudio.com.my design: announcement bar, centred logo header, hero, collection cards, best sellers and outlets.',build:()=>({
  settings:{...fieldDefaults(THEME_SETTINGS),home_seo_title:'Jack Studio Leather Shop | Premium Bag & Wallets & Belts in Malaysia',home_seo_description:'Leading leather shop in Klang, Selangor since 2013: premium leather wallets, bags, belts, luggage and gift sets with free embossing and gift packaging.'},
  header:[
   sec('announcement_bar',{messages:[{text:'Logo customize, NAME CUSTOMIZE, GIFT BOX AVAILABLE FOR BULK PURCHASE ORDER',link:''},{text:'BULK PURCHASE ORDER WITH GOOD PRICE, PLS CONTACT (011-1201 5288)',link:''}]}),
   sec('site_header',{logo_text:'JACK STUDIO',menu:[
    {label:'Home',link:'/',children:[]},
    {label:'About Us',link:'',children:[{label:'Brand Story',link:'/pages/brand-story',image_id:null},{label:'Brand Promise',link:'/pages/brand-promise',image_id:null},{label:'Blog',link:'/pages/blog',image_id:null}]},
    {label:'Our Services',link:'/pages/our-services',children:[]},
    {label:'Product Collection',link:collectionsPage,children:[]},
    {label:'Corporate Solution',link:'/pages/corporate-solution',children:[]},
    {label:'Outlets',link:outletsPage,children:[]},
    {label:'Contact',link:'/pages/contact',children:[]}]})
  ],
  sections:[
   sec('hero_banner',{eyebrow:'From Everyday Essentials',heading:'To Every Journey',body:'Thoughtful design. Trusted quality. Care beyond every purchase.',button_label:'Explore Collections',button_link:collectionsPage}),
   sec('icon_row',{size:'large',items:[{icon:'shield',title:'MORE TRUST',subtitle:'Quality craftsmanship you can rely on.'},{icon:'target',title:'MORE RELEVANT',subtitle:'Designed for the way you live today.'},{icon:'group',title:'MORE PERSONAL',subtitle:'Personalisation that makes it yours.'}]}),
   sec('collection_cards',{heading:'Explore Our Collections',link_label:'View All',link:collectionsPage,cards:[
    ['URBAN CARRY','#767c82'],['CRAFT HERITAGE','#9a6542'],['TRAVEL MOVEMENT','#d1a15d'],['PROFESSIONAL','#536b78'],['ESSENTIAL','#b8a98f'],['MAKE IT PERSONAL','#a84c3e'],['CRAFT INNOVATIVE','#65756b']
   ].map(([title,accent])=>({image_id:null,title,link:collectionsPage,accent}))}),
   sec('promise_split',{heading:'CORPORATE SOLUTION',text:'Custom leather gifts and premium solutions for your business.',button_label:'Discover More',button_link:'/pages/corporate-solution',
    stat_eyebrow:'Trusted By Thousands',stat_number:'185,249',stat_label:'Customers Served in 2025',stat_text:'Thank you for letting Jack Studio be part of your everyday.',stat_button_label:'Learn More',stat_button_link:'/pages/brand-promise'}),
   sec('product_tabs',{heading:'BEST SELLER',tabs:['Wallet | Card Holder','Leather Bag','Leather Belt','Travel Bags','Gift Set'].map(label=>({label,collection_id:null}))}),
   sec('story_split',{heading:'From Everyday Essentials to Every Journey',text:'Built around how you live, work and travel — with trusted quality, thoughtful design and care beyond every purchase.',link_label:'JACK STUDIO BRAND STORY',link:'/pages/brand-story'}),
   sec('showroom',{eyebrow:'Virtual Showroom',heading:'Step Into Jack Studio',button_label:'Enter Showroom',hint:'Drag to look around · tap the floor to walk',link:'https://jackstudiocreative-prog.github.io/js-showroom/JackStudio_Matterport_Concept_V5/'}),
   sec('outlets',{heading:'Our Outlets',subtitle:'Discover a boutique near you.',link_label:'View All Outlets',link:outletsPage,outlets:[
    {image_id:null,location:'Klang · Selangor',name:'Aeon Bukit Tinggi',address:'Lot F63, First Floor, Aeon Bukit Tinggi Shopping Centre, 41200 Klang, Selangor',directions:'https://maps.app.goo.gl/mxSnM6NZmU5aAhYE9'},
    {image_id:null,location:'Petaling Jaya · Selangor',name:'Paradigm Mall',address:'Lot CF 33 & 35, Concourse Floor, Paradigm Mall, No.1, Jalan SS 7/26a, SS 7, 47301 Petaling Jaya, Selangor',directions:'https://maps.app.goo.gl/PCo96xoLdBm2mncZA'},
    {image_id:null,location:'Subang Jaya · Selangor',name:'Main Place Mall USJ',address:'GF-12, The Main Place Mall, Jalan USJ 21/10, Persiaran Kewajipan, 47630 Subang Jaya, Selangor',directions:'https://maps.app.goo.gl/CpzyboikCDbeCiEV9'}]})
  ],
  footer:[sec('site_footer',{brand:'JACK STUDIO',columns:[
   {heading:'Shop',links:[{label:'All Product',link:collectionsPage},{label:'Product Collection',link:collectionsPage},{label:'Corporate Solution',link:'/pages/corporate-solution'}]},
   {heading:'Info',links:[{label:'About Us',link:'/pages/brand-story'},{label:'Blog',link:'/pages/blog'},{label:'Contact Us',link:'/pages/contact'},{label:'Outlets',link:outletsPage}]},
   {heading:'Policies',links:[{label:'Privacy Policy',link:'/pages/privacy-policy'},{label:'Refund Policy',link:'/pages/refund-policy'},{label:'Shipping',link:'/pages/shipping-policy'},{label:'Terms of Service',link:'/pages/terms-of-service'}]}],
   contact_heading:'Company Details',email:'sales.jackstudio@gmail.com',company:'Jack Studio Marketing Sdn Bhd (1303213-T)',address:'3060, Persiaran Raja Muda Musa,\nKampung Raja Uda,\n42000 Pelabuhan Klang,\nSelangor',
   instagram:'https://www.instagram.com/jackstudio.leathergoods',youtube:'https://youtube.com/@jackstudioleathershop',tiktok:'https://www.tiktok.com/@jackstudio_official',
   newsletter_label:'Sign Up for More Offers',newsletter_placeholder:'Your email address',copyright:'© 2026 Jack Studio. All rights reserved.'})]
 })}
});
