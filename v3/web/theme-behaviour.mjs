// Storefront behaviour for Online Store themes. The CSP allows only same-origin scripts and styles,
// so colours are applied with CSSOM (allowed) instead of inline style attributes (blocked).
import {themeVars} from '../admin/theme-render.mjs';
const SAFE=/^(#[0-9a-f]{6}|\d{1,3}px|[a-z]{3,20})$/i;
export function applyThemeVars(root,settings){
 for(const [k,v] of Object.entries(themeVars(settings)))document.documentElement.style.setProperty(k,v);
 for(const el of root.querySelectorAll('[data-jt-vars]'))for(const pair of el.dataset.jtVars.split(';')){const i=pair.indexOf(':'),k=pair.slice(0,i),v=pair.slice(i+1);if(/^--[a-z0-9-]+$/.test(k)&&SAFE.test(v))el.style.setProperty(k,v);}
}
function announcements(root){
 for(const wrap of root.querySelectorAll('[data-jt-announce]')){
  const slides=[...wrap.querySelectorAll('.jh-ann-slide')];if(slides.length<2)continue;let i=0,timer=null;
  const show=n=>{i=(n+slides.length)%slides.length;slides.forEach((s,k)=>s.classList.toggle('is-active',k===i));};
  wrap.querySelector('.jh-ann-prev')?.addEventListener('click',()=>{show(i-1);restart();});
  wrap.querySelector('.jh-ann-next')?.addEventListener('click',()=>{show(i+1);restart();});
  const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function restart(){clearInterval(timer);if(wrap.hasAttribute('data-autoplay')&&!reduce)timer=setInterval(()=>show(i+1),5000);}
  wrap.addEventListener('mouseenter',()=>clearInterval(timer));wrap.addEventListener('mouseleave',restart);wrap.addEventListener('focusin',()=>clearInterval(timer));
  restart();
 }
}
function menus(root){
 const nav=root.querySelector('[data-jh-nav]'),opener=root.querySelector('[data-jh-menu-open]');
 const setOpen=open=>{if(!nav)return;nav.classList.toggle('open',open);opener?.setAttribute('aria-expanded',String(open));document.body.style.overflow=open?'hidden':'';if(open)nav.querySelector('[data-jh-menu-close]')?.focus();else opener?.focus();};
 opener?.addEventListener('click',()=>setOpen(true));
 for(const b of root.querySelectorAll('[data-jh-menu-close]'))b.addEventListener('click',()=>setOpen(false));
 const closeAll=()=>{for(const item of root.querySelectorAll('.jh-nav-item.jh-open')){item.classList.remove('jh-open');for(const b of item.querySelectorAll('[aria-expanded]'))b.setAttribute('aria-expanded','false');}};
 for(const btn of root.querySelectorAll('[data-jh-toggle]'))btn.addEventListener('click',e=>{
  e.preventDefault();e.stopPropagation();const item=btn.closest('.jh-nav-item'),was=item.classList.contains('jh-open');closeAll();
  if(!was){item.classList.add('jh-open');for(const b of item.querySelectorAll('[aria-expanded]'))b.setAttribute('aria-expanded','true');}
 });
 document.addEventListener('click',e=>{if(!e.target.closest('.jh-nav-item'))closeAll();});
 document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(nav?.classList.contains('open'))setOpen(false);closeAll();});
}
function carousels(root){
 for(const box of root.querySelectorAll('[data-jt-carousel]')){
  const rail=box.querySelector('[data-jt-rail]');if(!rail)continue;
  const step=dir=>{const card=rail.firstElementChild;rail.scrollBy({left:dir*((card?.getBoundingClientRect().width??280)+24),behavior:'smooth'});};
  box.querySelector('[data-jt-prev]')?.addEventListener('click',()=>step(-1));
  box.querySelector('[data-jt-next]')?.addEventListener('click',()=>step(1));
  const dots=[...box.querySelectorAll('[data-jt-dots] button')],cards=[...rail.querySelectorAll('[data-jt-card]')];
  if(dots.length){
   dots.forEach((d,i)=>d.addEventListener('click',()=>rail.scrollTo({left:cards[i].offsetLeft-rail.offsetLeft,behavior:'smooth'})));
   let ticking=false;rail.addEventListener('scroll',()=>{if(ticking)return;ticking=true;requestAnimationFrame(()=>{const max=rail.scrollWidth-rail.clientWidth,i=max<=0?0:rail.scrollLeft>=max-1?cards.length-1:Math.round(rail.scrollLeft/max*(cards.length-1));dots.forEach((d,k)=>d.classList.toggle('is-active',k===i));ticking=false;});});
  }
 }
}
function tabs(root){
 for(const wrap of root.querySelectorAll('[data-jt-tabs]')){
  const list=[...wrap.querySelectorAll('[data-jt-tab]')],panels=[...wrap.querySelectorAll('[data-jt-panel]')];
  const select=i=>{list.forEach((t,k)=>{t.classList.toggle('is-active',k===i);t.setAttribute('aria-selected',String(k===i));t.tabIndex=k===i?0:-1;});panels.forEach((p,k)=>p.classList.toggle('is-active',k===i));};
  list.forEach((t,i)=>{t.addEventListener('click',()=>select(i));t.addEventListener('keydown',e=>{const d=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(!d)return;e.preventDefault();const n=(i+d+list.length)%list.length;select(n);list[n].focus();});});
  select(0);
 }
}
function flaps(root){
 const rows=root.querySelectorAll('[data-jt-flap]');if(!rows.length||!('IntersectionObserver' in window)||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
 const io=new IntersectionObserver(entries=>{for(const e of entries)e.target.classList.toggle('in-view',e.isIntersecting);},{rootMargin:'0px 0px -15% 0px'});
 for(const row of rows){row.classList.add('is-animated');io.observe(row);}
}
function newsletter(root){
 for(const form of root.querySelectorAll('[data-jt-newsletter]'))form.addEventListener('submit',e=>{e.preventDefault();const note=form.parentElement.querySelector('[data-jt-newsletter-note]');if(note){note.textContent='Newsletter sign-up is not connected yet. Please check back soon.';note.hidden=false;}});
}
export function activateTheme(root,settings){applyThemeVars(root,settings);announcements(root);menus(root);carousels(root);tabs(root);flaps(root);newsletter(root);}
// Theme preview from the admin (Preview button): the admin stores the theme in this browser and opens
// /?theme_preview=1; the flag lives in this tab's session so every page in the tab keeps previewing.
const PREVIEW='jt-theme-preview';
let media={};
// Media for the theme being shown: signed private previews (admin preview only); the live site has none yet.
export const themeMedia=()=>media;
function previewTheme(){
 try{
  const url=new URL(location.href);
  if(url.searchParams.has('theme_preview')){sessionStorage.setItem(PREVIEW,'1');url.searchParams.delete('theme_preview');history.replaceState(null,'',url.pathname+url.search+url.hash);}
  if(sessionStorage.getItem(PREVIEW)!=='1')return null;
  const p=JSON.parse(localStorage.getItem(PREVIEW)||'null');
  if(!p?.theme?.settings||!(p.expires>Date.now())){sessionStorage.removeItem(PREVIEW);return null;}
  return p;
 }catch{return null;}
}
function previewBar(name){
 const bar=document.createElement('div');bar.className='jt-preview-bar';bar.setAttribute('role','status');
 const text=document.createElement('span');text.textContent=`Previewing theme: ${name} · Not visible to customers`;
 const exit=document.createElement('button');exit.type='button';exit.textContent='Exit preview';
 exit.addEventListener('click',()=>{try{sessionStorage.removeItem(PREVIEW);}catch{}location.reload();});
 bar.append(text,exit);document.body.prepend(bar);
}
// Fetches the live theme (or the admin preview theme); resolves to null when none is published.
export async function liveTheme(){
 const p=previewTheme();
 if(p){media=Object.fromEntries(Object.entries(p.media??{}).filter(([,u])=>{try{const x=new URL(u);return x.protocol==='https:'&&x.hostname==='api.cloudinary.com';}catch{return false;}}));previewBar(String(p.name??'Theme'));return p.theme;}
 try{const r=await fetch('/api/v3/storefront/theme');if(!r.ok)return null;const data=await r.json();return data.theme??null;}catch{return null;}
}
