// Shopify AJAX cart compatibility for the imported theme (quick add, cart badge, cart drawer).
// The theme calls /cart.js, /cart/add.js, /cart/change.js and /products/<handle>.js as on Shopify;
// these calls are answered from the V3 bag and the public storefront API. Nothing else is intercepted.
import {bag,setBag,quote,updateBadges,MAX_QTY} from './bag.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
async function cart(){
 const items=bag();if(!items.length)return {token:'',item_count:0,items:[],total_price:0,original_total_price:0,items_subtotal_price:0,currency:'MYR',requires_shipping:true};
 const q=await quote(items);
 const lines=q.lines.filter(l=>l.title).map((l,i)=>({key:l.variant_id,id:Number(l.variant_id),variant_id:Number(l.variant_id),product_id:Number(l.product_id),quantity:l.quantity,title:l.variant_title?`${l.title} - ${l.variant_title}`:l.title,product_title:l.title,variant_title:l.variant_title||null,handle:l.handle,url:'/products/'+l.handle,price:l.unit_price_minor,final_price:l.unit_price_minor,line_price:l.line_total_minor,final_line_price:l.line_total_minor,original_line_price:l.line_total_minor,image:l.image?.url??null,featured_image:l.image?{url:l.image.url,alt:l.image.alt}:null,available:l.available!==false,index:i+1}));
 return {token:'',item_count:lines.reduce((s,l)=>s+l.quantity,0),items:lines,total_price:q.subtotal_minor,original_total_price:q.subtotal_minor,items_subtotal_price:q.subtotal_minor,currency:'MYR',requires_shipping:true};
}
async function body(init){try{const raw=init?.body;if(typeof raw==='string')return JSON.parse(raw);if(raw instanceof FormData)return Object.fromEntries(raw);}catch{}return {};}
async function add(input){
 const wanted=(Array.isArray(input.items)?input.items:[input]).map(i=>({variant_id:String(i.id??i.variant_id??''),quantity:Math.max(1,Number.parseInt(i.quantity??1,10)||1)})).filter(i=>/^[1-9]\d{0,17}$/.test(i.variant_id));
 if(!wanted.length)return json({status:422,message:'Choose a product option',description:'This item could not be added.'},422);
 const before=bag(),next=before.map(i=>({...i}));
 for(const w of wanted){const line=next.find(i=>i.variant_id===w.variant_id);if(line)line.quantity=Math.min(MAX_QTY,line.quantity+w.quantity);else next.push({variant_id:w.variant_id,quantity:Math.min(MAX_QTY,w.quantity)});}
 // Check with the server before keeping the change: unknown, unlisted or sold-out variants are refused.
 let q;try{q=await quote(next);}catch(e){return json({status:e.status||422,message:'Unavailable',description:e.message},422);}
 const bad=q.lines.find(l=>wanted.some(w=>w.variant_id===l.variant_id)&&l.available===false);
 if(bad)return json({status:422,message:'Unavailable',description:bad.title?'Not enough stock for this quantity.':'This item is no longer available.'},422);
 setBag(next);
 const added=q.lines.filter(l=>wanted.some(w=>w.variant_id===l.variant_id)).map(l=>({id:Number(l.variant_id),variant_id:Number(l.variant_id),quantity:l.quantity,title:l.title,product_title:l.title,variant_title:l.variant_title||null,price:l.unit_price_minor,url:'/products/'+l.handle,image:l.image?.url??null}));
 return json(Array.isArray(input.items)?{items:added}:added[0]);
}
async function change(input){
 const items=bag(),key=String(input.id??'');let target=key?items.find(i=>i.variant_id===key):items[(Number(input.line)||0)-1];
 if(target){const n=Math.max(0,Math.min(MAX_QTY,Number.parseInt(input.quantity??0,10)||0));target.quantity=n;setBag(items);}
 return json(await cart());
}
async function product(handle){
 const r=await originalFetch('/api/v3/storefront/products/'+encodeURIComponent(handle));if(!r.ok)return json({status:404,message:'Not found'},404);
 const p=(await r.json()).product,img=p.images?.[0]??null,prices=p.variants.map(v=>v.price_minor);
 return json({id:Number(p.id),title:p.title,handle:p.handle,url:'/products/'+p.handle,description:p.description,price:Math.min(...prices),price_min:Math.min(...prices),price_max:Math.max(...prices),available:p.variants.some(v=>v.available),featured_image:img?.url??null,images:(p.images??[]).map(i=>i.url),options:p.option_names??[],variants:p.variants.map(v=>({id:Number(v.id),title:v.option_values.join(' / ')||'Default Title',options:v.option_values,price:v.price_minor,compare_at_price:v.compare_at_minor,available:v.available}))});
}
const originalFetch=window.fetch.bind(window);
if(!window.__jsCartBridge){
 window.__jsCartBridge=true;
 window.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin===location.origin){
   const path=url.pathname.replace(/\/+$/,''),method=(init.method||'GET').toUpperCase();
   try{
    if(path==='/cart.js'&&method==='GET')return json(await cart());
    if(path==='/cart/add.js'&&method==='POST')return await add(await body(init));
    if((path==='/cart/change.js'||path==='/cart/update.js')&&method==='POST')return await change(await body(init));
    const h=path.match(/^\/products\/([a-z0-9-]{1,100})\.js$/)?.[1];if(h&&method==='GET')return await product(h);
   }catch(e){return json({status:500,message:'Error',description:e.message||'Please try again.'},500);}
  }
  return originalFetch(input,init);
 };
}
updateBadges();
