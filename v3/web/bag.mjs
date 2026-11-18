// The customer's bag: variant IDs and quantities in this browser only. Prices, stock and totals always
// come from the server (/api/v3/storefront/cart).
export const BAG='js-bag',MAX_QTY=20,MAX_LINES=50;
const read=()=>{try{const v=JSON.parse(localStorage.getItem(BAG));return Array.isArray(v)?v.filter(i=>i&&/^[1-9]\d{0,17}$/.test(String(i.variant_id))&&Number.isInteger(i.quantity)&&i.quantity>0):[];}catch{return [];}};
export const bag=()=>read();
export function setBag(items){
 const clean=items.filter(i=>i.quantity>0).slice(0,MAX_LINES).map(i=>({variant_id:String(i.variant_id),quantity:Math.min(MAX_QTY,i.quantity)}));
 try{localStorage.setItem(BAG,JSON.stringify(clean));}catch{}
 updateBadges();return clean;
}
export const itemCount=()=>bag().reduce((s,i)=>s+i.quantity,0);
// Every bag counter on the page: the simple shop header and the theme header ([data-cart-count]).
export function updateBadges(){
 const n=itemCount();
 const simple=document.getElementById('bag-count');if(simple)simple.textContent=String(n);
 document.querySelectorAll('[data-cart-count]').forEach(el=>{el.textContent=String(n);el.style.display=n>0?'':'none';
  // The theme's cart link is named by aria-label; keep the visible count inside the name.
  const link=el.closest('a,button');if(link)link.setAttribute('aria-label',n>0?`Cart, ${n} ${n===1?'item':'items'}`:'Cart');});
}
export async function quote(lines=bag()){
 const r=await fetch('/api/v3/storefront/cart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lines})});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(data.error||'Your bag could not be loaded.'),{status:r.status});return data;
}
