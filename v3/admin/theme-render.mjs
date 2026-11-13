// Renders an Online Store theme (header group, template sections, footer group) to HTML. Used by the
// admin theme editor preview and the public storefront. Every value is escaped; links and colours were
// validated by the shared schema. The storefront CSP forbids inline styles, so per-section colours are
// emitted as data-jt-vars and applied with CSSOM by web/theme-behaviour.mjs; the sandboxed admin
// preview (no scripts) gets them as style attributes instead ({inline:true}).
import {esc,renderPageSection} from './page-render.mjs';

const SAFE_VAR=/^(#[0-9a-f]{6}|\d{1,3}px|[a-z]{3,20})$/i;
const vars=(map,o)=>{const list=Object.entries(map).filter(([,v])=>v!=null&&SAFE_VAR.test(String(v))).map(([k,v])=>`${k}:${v}`);if(!list.length)return '';return o.inline?` style="${esc(list.join(';'))}"`:` data-jt-vars="${esc(list.join(';'))}"`;};
const money=minor=>'RM'+((minor??0)/100).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
const external=href=>/^https:/i.test(href)?' target="_blank" rel="noopener"':'';
const a=(href,inner,cls='',extra='')=>`<a${cls?` class="${cls}"`:''} href="${esc(href||'#')}"${external(href)}${extra}>${inner}</a>`;
const lines=text=>esc(text).replace(/\n/g,'<br>');
function img(media,id,alt,cls){const url=id&&media[id];return url?`<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">`:`<span class="${cls} jt-placeholder" role="img" aria-label="${esc(alt||'Image')}"></span>`;}

const svg=(body,size=20,extra='fill="none" stroke="currentColor" stroke-width="2"')=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${extra} aria-hidden="true" focusable="false">${body}</svg>`;
const ICON={
 menu:svg('<line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/>',22),
 close:svg('<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>'),
 account:svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'),
 wishlist:svg('<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>'),
 search:svg('<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>'),
 cart:svg('<path d="M5 7h14l-1.5 11a2 2 0 0 1-2 1.7h-7A2 2 0 0 1 6.5 18L5 7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>'),
 caret:'<svg class="jh-caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9"/></svg>',
 facebook:svg('<path d="M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.3-1.5 1.6-1.5H17V4.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.6V14h2.7v8h3.2z"/>',18,'fill="currentColor"'),
 instagram:svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/>',18),
 tiktok:svg('<path d="M19.6 6.8c-1.4-.1-2.7-.9-3.4-2.1-.3-.5-.5-1-.6-1.5V3h-3.4v13.6c0 1.4-1.1 2.5-2.5 2.5-.6 0-1.2-.2-1.7-.6-.7-.5-1.1-1.4-1.1-2.3 0-1.6 1.3-2.9 2.9-2.9.3 0 .5 0 .8.1v-3.5c-.3 0-.5-.1-.8-.1-3.5 0-6.3 2.8-6.3 6.3s2.8 6.3 6.3 6.3 6.3-2.8 6.3-6.3V9.7c1.3.9 2.9 1.5 4.5 1.5V7.8c-.4 0-.7 0-1-.1z"/>',18,'fill="currentColor"'),
 youtube:svg('<path d="M23 7.5s-.2-1.6-.9-2.3c-.9-.9-1.8-.9-2.3-1C16.5 4 12 4 12 4s-4.5 0-7.8.2c-.5.1-1.4.1-2.3 1C1.2 5.9 1 7.5 1 7.5S.8 9.4.8 11.3v1.4c0 1.9.2 3.8.2 3.8s.2 1.6.9 2.3c.9.9 2.1.9 2.6 1 1.9.2 8 .2 8 .2s4.5 0 7.8-.2c.5-.1 1.4-.1 2.3-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.8v-1.4c0-1.9-.2-3.8-.2-3.8zM9.7 15.2V8.8L15.6 12l-5.9 3.2z"/>',18,'fill="currentColor"')
};
const featureIcon=body=>`<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false">${body}</svg>`;
const FEATURE_ICONS={
 personalisation:'<path d="M8 26h16M12 22l2-14h4l2 14"/>',
 gift:'<rect x="5" y="12" width="22" height="14" rx="1"/><path d="M5 17h22M16 12v14M12 12c-2 0-3-1-3-3s1-3 3-3c1.5 0 3 2 4 3-1 0-3.5 3-4 3zM20 12c2 0 3-1 3-3s-1-3-3-3c-1.5 0-3 2-4 3 1 0 3.5 3 4 3z"/>',
 care:'<path d="M13 4h6v6h-6zM10 10h12v18a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2z"/><path d="M14 18h4M14 22h4"/>',
 warranty:'<path d="M16 4l10 4v8c0 6-4 11-10 12-6-1-10-6-10-12V8z"/><path d="M11 16l3 3 6-6"/>',
 shield:'<path d="M16 4l10 4v8c0 6-4 11-10 12-6-1-10-6-10-12V8z"/>',
 delivery:'<rect x="3" y="11" width="17" height="12" rx="1"/><path d="M20 15h6l3 4v4h-9z"/><circle cx="9" cy="27" r="2.2"/><circle cx="24" cy="27" r="2.2"/>',
 heart:'<path d="M16 27s-11-7-11-15a6 6 0 0 1 11-4 6 6 0 0 1 11 4c0 8-11 15-11 15z"/>',
 person:'<circle cx="16" cy="11" r="5"/><path d="M5 28c0-6 5-10 11-10s11 4 11 10"/>',
 handshake:'<path d="M4 16l6-6 6 6 2-2 4 4-6 6-4-4-8-4z"/><path d="M28 16l-6-6-2 2"/>',
 headset:'<path d="M6 18v-2a10 10 0 0 1 20 0v2"/><rect x="4" y="17" width="6" height="9" rx="2"/><rect x="22" y="17" width="6" height="9" rx="2"/><path d="M28 26a4 4 0 0 1-4 4h-3"/>',
 target:'<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="6.5"/><circle cx="16" cy="16" r="2" fill="currentColor" stroke="none"/>',
 group:'<circle cx="12" cy="11" r="4"/><circle cx="22" cy="12.5" r="3.3"/><path d="M4 27c0-4.6 3.6-8 8-8s8 3.4 8 8"/><path d="M20 19.3c3.6 0 6.5 2.7 6.5 7.7"/>'
};

const sections={
 announcement_bar:(v,m,o)=>{const msgs=v.messages;if(!msgs.length)return '';const many=msgs.length>1;
  return `<div class="jh-announce-wrap" data-jt-announce${v.autoplay?' data-autoplay':''}${vars({'--jh-ann-bg':v.bg,'--jh-ann-fg':v.fg},o)}>${many?'<button type="button" class="jh-ann-arrow jh-ann-prev" aria-label="Previous announcement">&#8249;</button>':''}<div class="jh-ann-track" aria-live="polite">${msgs.map((x,i)=>`<div class="jh-ann-slide${i?'':' is-active'}">${x.link?a(x.link,esc(x.text),'jh-ann-text'):`<span class="jh-ann-text">${esc(x.text)}</span>`}</div>`).join('')}</div>${many?'<button type="button" class="jh-ann-arrow jh-ann-next" aria-label="Next announcement">&#8250;</button>':''}</div>`;},
 site_header:(v,m,o)=>{
  const logo=(cls,scale)=>v.logo_id&&m[v.logo_id]?`<img class="${cls}" src="${esc(m[v.logo_id])}" alt="${esc(v.logo_text||'Jack Studio')}" referrerpolicy="no-referrer">`:`<span class="${scale?'jh-brand-mobile':'jh-brand'}">${esc(v.logo_text||'JACK STUDIO')}</span>`;
  const icon=(href,label,name)=>href?a(href,ICON[name],'jh-icon',` aria-label="${label}"`):'';
  const items=v.menu.map((item,i)=>{
   if(!item.children.length)return a(item.link||'/',esc(item.label),'jh-nav-link');
   const id=`jh-menu-${i}`,mega=item.children.some(c=>c.image_id);
   const parent=item.link?a(item.link,esc(item.label),'jh-nav-link jh-nav-parent'):`<button type="button" class="jh-nav-link jh-nav-parent" aria-expanded="false" aria-controls="${id}" data-jh-toggle>${esc(item.label)}</button>`;
   const caret=`<button type="button" class="jh-caret-btn" aria-label="Show ${esc(item.label)} menu" aria-expanded="false" aria-controls="${id}" data-jh-toggle>${ICON.caret}</button>`;
   const links=item.children.map(c=>mega?a(c.link,`<span class="jh-mega-img">${img(m,c.image_id,c.label,'jh-mega-pic')}</span><span class="jh-mega-label">${esc(c.label)}</span>`,'jh-mega-tile'):a(c.link,esc(c.label),'jh-dropdown-link')).join('');
   return `<div class="jh-nav-item${mega?' jh-has-mega':''}">${parent}${caret}<div class="${mega?'jh-mega':'jh-dropdown'}" id="${id}"><div class="jh-mega-inner">${links}</div></div></div>`;
  }).join('');
  const socials=['facebook','instagram','tiktok','youtube'].filter(k=>v[k]).map(k=>a(v[k],ICON[k],'',` aria-label="${k[0].toUpperCase()+k.slice(1)}"`)).join('');
  return `<div class="jh-header"${vars({'--jh-bg':v.bg,'--jh-fg':v.fg,'--jh-logo-h':v.logo_height+'px'},o)}><div class="jh-top"><div class="jh-left"><button class="jh-icon jh-menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" data-jh-menu-open>${ICON.menu}</button></div><div class="jh-logo">${a('/',logo('jh-logo-img'))}</div><div class="jh-right">${icon(v.account_link,'Account','account')}${icon(v.wishlist_link,'Wishlist','wishlist')}${icon(v.search_link,'Search','search')}${v.show_cart?a('/cart',ICON.cart+'<span class="jh-badge" data-cart-count hidden>0</span>','jh-icon jh-cart',' aria-label="Bag"'):''}</div></div>`
   +`<nav class="jh-nav" aria-label="Main menu" data-jh-nav><div class="jh-nav-mobile-top"><button type="button" class="jh-nav-close" aria-label="Close menu" data-jh-menu-close>${ICON.close}</button><div class="jh-nav-mobile-logo">${logo('jh-logo-img',true)}</div><div class="jh-nav-mobile-icons">${v.search_link?a(v.search_link,ICON.search,'',' aria-label="Search"'):''}${v.show_cart?a('/cart',ICON.cart,'',' aria-label="Bag"'):''}</div></div><div class="jh-nav-links">${items}</div>${v.account_link||socials?`<div class="jh-nav-mobile-bottom">${v.account_link?a(v.account_link,'Log in','jh-nav-login'):''}<div class="jh-nav-socials">${socials}</div></div>`:''}</nav></div>`;
 },
 hero_banner:(v,m)=>`<section class="hb-hero">${v.image_id?img(m,v.image_id,'','hb-media'):''}<div class="hb-overlay"></div><div class="hb-copy">${v.eyebrow?`<span class="hb-eyebrow">${esc(v.eyebrow)}</span>`:''}${v.heading?`<h1>${esc(v.heading)}</h1>`:''}${v.body?`<p class="hb-body">${esc(v.body)}</p>`:''}${v.button_label&&v.button_link?a(v.button_link,esc(v.button_label),'hb-btn'):''}</div></section>`,
 icon_row:(v,m,o)=>`<section class="si-wrap si-${v.size}"${vars({'--si-bg':v.bg},o)}>${v.heading?`<h2 class="si-heading">${esc(v.heading)}</h2>`:''}<div class="si-grid">${v.items.map(x=>`<div class="si-item"><div class="si-icon">${featureIcon(FEATURE_ICONS[x.icon]??'<circle cx="16" cy="16" r="12"/>')}</div><div class="si-body"><div class="si-title">${esc(x.title)}</div>${x.subtitle?`<div class="si-sub">${esc(x.subtitle)}</div>`:''}</div></div>`).join('')}</div></section>`,
 collection_cards:(v,m,o)=>`<section class="cc-wrap"${vars({'--cc-bg':v.bg},o)}><div class="cc-layout"><div class="cc-side">${v.heading?`<h2 class="cc-heading">${esc(v.heading)}</h2>`:''}${v.link_label&&v.link?a(v.link,`${esc(v.link_label)} &rarr;`,'cc-viewall'):''}</div><div class="cc-carousel" data-jt-carousel>${v.cards.length>1?'<button type="button" class="cc-arrow cc-arrow-prev" data-jt-prev aria-label="Previous collections">&larr;</button><button type="button" class="cc-arrow cc-arrow-next" data-jt-next aria-label="Next collections">&rarr;</button>':''}<div class="cc-rail" data-jt-rail>${v.cards.map(c=>a(c.link,`<span class="cc-img-wrap">${img(m,c.image_id,c.title,'cc-img')}</span><span class="cc-btn"${vars({'--cc-accent':c.accent},o)}>${esc(c.title)}</span>`,'cc-card',' data-jt-card')).join('')}</div>${v.cards.length>1?`<div class="cc-dots" data-jt-dots>${v.cards.map((c,i)=>`<button type="button" class="cc-dot${i?'':' is-active'}" aria-label="Go to ${esc(c.title)}"></button>`).join('')}</div>`:''}</div></div></section>`,
 promise_split:(v,m,o)=>{
  const digits=[...v.stat_number].map((ch,i)=>ch===','?'<span class="cps-stat-fc-comma">,</span>':`<span class="cps-stat-fc-cell cps-d${Math.min(i,11)}"><span class="cps-stat-fc-back">${esc(ch)}</span><span class="cps-stat-fc-line"></span><span class="cps-stat-fc-flap"></span></span>`).join('');
  return `<section class="cps-wrap"><div class="cps-row"${vars({'--cps-bg':v.bg},o)}><div class="cps-row-img">${img(m,v.image_id,v.heading,'cps-pic')}</div><div class="cps-row-text">${v.heading?`<h2 class="cps-heading">${esc(v.heading)}</h2>`:''}${v.text?`<p class="cps-desc">${lines(v.text)}</p>`:''}${v.button_label&&v.button_link?a(v.button_link,`${esc(v.button_label)} &rarr;`,'cps-btn'):''}</div></div>`
   +`<div class="cps-stat-row"${vars({'--cps-stat-bg':v.stat_bg},o)}><div class="cps-stat-left">${v.stat_eyebrow?`<span class="cps-stat-eyebrow">${esc(v.stat_eyebrow)}</span>`:''}${digits?`<div class="cps-stat-fc-row" data-jt-flap aria-label="${esc(v.stat_number)}">${digits}</div>`:''}${v.stat_label?`<span class="cps-stat-label">${esc(v.stat_label)}</span>`:''}<span class="cps-stat-divider"></span>${v.stat_text?`<p class="cps-stat-tagline">${esc(v.stat_text)}</p>`:''}${v.stat_button_label&&v.stat_button_link?a(v.stat_button_link,`${esc(v.stat_button_label)} &rarr;`,'cps-stat-link'):''}</div><div class="cps-stat-image"><span class="cps-stat-image-fade"></span>${img(m,v.stat_image_id,'','cps-pic')}</div></div></section>`;
 },
 product_tabs:(v,m,o,s)=>{
  const tabs=s.tabs??v.tabs.map(()=>[]);
  const card=p=>a('/products/'+p.handle,`<span class="ctab-card-img">${img(m,p.featured_media_id,p.title,'ctab-pic')}</span><span class="ctab-card-body"><span class="ctab-card-title">${esc(p.title)}</span><span class="ctab-card-price">${p.variant_count>1?'From ':''}${money(p.price_minor)}</span>${p.colours?.length?`<span class="ctab-swatches">${p.colours.filter(c=>/^[a-z]{3,20}$/i.test(c)).map(c=>`<span class="ctab-dot" title="${esc(c)}"${vars({'--ctab-dot':c.toLowerCase()},o)}></span>`).join('')}</span>`:''}${p.excerpt?`<span class="ctab-card-sub">${esc(p.excerpt)}</span>`:''}</span>`,'ctab-card');
  return `<section class="ctab-wrap" data-jt-tabs${vars({'--ctab-bg':v.bg,'--ctab-img-bg':v.image_bg,'--ctab-accent':v.accent},o)}>${v.heading?`<h2 class="ctab-heading">${esc(v.heading)}</h2>`:''}<div class="ctab-tabs" role="tablist">${v.tabs.map((t,i)=>`<button type="button" role="tab" class="ctab-tab${i?'':' is-active'}" aria-selected="${i?'false':'true'}" data-jt-tab="${i}">${esc(t.label)}</button>`).join('')}</div><div class="ctab-panels">${v.tabs.map((t,i)=>`<div class="ctab-panel${i?'':' is-active'}" role="tabpanel" data-jt-panel="${i}"><div class="ctab-carousel" data-jt-carousel>${tabs[i].length>3?'<button type="button" class="ctab-arrow ctab-arrow-prev" data-jt-prev aria-label="Previous products">&larr;</button><button type="button" class="ctab-arrow ctab-arrow-next" data-jt-next aria-label="Next products">&rarr;</button>':''}<div class="ctab-rail" data-jt-rail>${tabs[i].length?tabs[i].map(card).join(''):`<p class="ctab-empty">${t.collection_id?'No products in this collection yet.':'Choose a collection for this tab in the theme editor.'}</p>`}</div></div></div>`).join('')}</div></section>`;
 },
 story_split:(v,m,o)=>`<section class="ci-wrap"${vars({'--ci-bg':v.bg},o)}><div class="ci-grid"><div class="ci-image">${img(m,v.image_id,v.heading,'ci-pic')}</div><div class="ci-body">${v.heading?`<h2 class="ci-heading">${esc(v.heading)}</h2>`:''}${v.text?`<p class="ci-desc">${lines(v.text)}</p>`:''}${v.link_label&&v.link?a(v.link,`${esc(v.link_label)} &rarr;`,'ci-link'):''}</div></div></section>`,
 showroom:(v,m,o)=>`<section class="vs-wrap"${vars({'--vs-bg':v.bg},o)}><div class="vs-head">${v.eyebrow?`<span class="vs-eyebrow">${esc(v.eyebrow)}</span>`:''}${v.heading?`<h2 class="vs-heading">${esc(v.heading)}</h2>`:''}${v.text?`<p class="vs-body">${esc(v.text)}</p>`:''}</div><div class="vs-stage">${(v.link?a:(h,inner,cls)=>`<div class="${cls}">${inner}</div>`)(v.link,`${img(m,v.image_id,'Jack Studio virtual showroom','vs-cover-img')}<span class="vs-shade"></span><span class="vs-cta"><span class="vs-play">${svg('<path d="M8 5v14l11-7z" fill="currentColor"/>',22,'')}</span>${v.button_label?`<span class="vs-cta-label">${esc(v.button_label)}</span>`:''}${v.hint?`<span class="vs-cta-hint">${esc(v.hint)}</span>`:''}</span>`,'vs-cover')}</div></section>`,
 outlets:(v,m,o)=>`<section class="ot-wrap"${vars({'--ot-bg':v.bg},o)}>${v.heading?`<h2>${esc(v.heading)}</h2>`:''}${v.subtitle?`<div class="ot-sub">${esc(v.subtitle)}</div>`:''}<div class="ot-track">${v.outlets.map(x=>`<div class="ot-card"><div class="ot-photo">${img(m,x.image_id,x.name,'ot-pic')}</div><div class="ot-body">${x.location?`<div class="ot-loc">${esc(x.location)}</div>`:''}<h3>${esc(x.name)}</h3>${x.address?`<div class="ot-row">${esc(x.address)}</div>`:''}${x.directions?a(x.directions,'Get Directions','ot-btn'):''}</div></div>`).join('')}</div>${v.link_label&&v.link?a(v.link,`${esc(v.link_label)} &rarr;`,'ot-viewall'):''}</section>`,
 site_footer:(v,m,o)=>{
  const socials=['facebook','instagram','youtube','tiktok'].filter(k=>v[k]).map(k=>a(v[k],ICON[k],'',` aria-label="${k[0].toUpperCase()+k.slice(1)}"`)).join('');
  const contact=v.contact_heading||v.email||v.company||v.address||socials;
  return `<footer class="jf-footer"${vars({'--jf-bg':v.bg,'--jf-fg':v.fg,'--jf-logo-h':v.logo_height+'px'},o)}><div class="jf-top">${v.logo_id&&m[v.logo_id]?`<img class="jf-logo" src="${esc(m[v.logo_id])}" alt="${esc(v.brand||'Jack Studio')}" referrerpolicy="no-referrer">`:`<div class="jf-brand">${esc(v.brand)}</div>`}${v.tagline?`<div class="jf-tagline">${esc(v.tagline)}</div>`:''}</div><div class="jf-cols">${v.columns.map(c=>`<div class="jf-col"><h2 class="jf-col-title">${esc(c.heading)}</h2>${c.links.map(l=>a(l.link,esc(l.label))).join('')}</div>`).join('')}${contact?`<div class="jf-col jf-contact">${v.contact_heading?`<h2 class="jf-col-title">${esc(v.contact_heading)}</h2>`:''}${v.email?`<div class="jf-label">Email:</div>${a('mailto:'+v.email,esc(v.email))}`:''}${v.company||v.address?'<div class="jf-label jf-gap">Address:</div>':''}${v.company?`<div class="jf-addr">${esc(v.company)}</div>`:''}${v.address?`<div class="jf-addr">${lines(v.address)}</div>`:''}${socials?`<div class="jf-social">${socials}</div>`:''}</div>`:''}</div>${v.newsletter?`<div class="jf-newsletter"><div class="jf-newsletter-label" id="jf-newsletter-label">${esc(v.newsletter_label)}</div><form class="jf-newsletter-form" data-jt-newsletter novalidate><input type="email" aria-labelledby="jf-newsletter-label" placeholder="${esc(v.newsletter_placeholder)}"><button type="submit" aria-label="Sign up">&rarr;</button></form><p class="jf-newsletter-note" data-jt-newsletter-note hidden></p></div>`:''}<div class="jf-bottom"><span>${esc(v.copyright)}</span><span>Jack Studio Marketing Sdn Bhd</span></div></footer>`;
 }
};
function section(s,media,o){
 if(sections[s.type])return `<div class="jt-section" data-section="${esc(s.id)}">${sections[s.type](s.settings,media,o,s)}</div>`;
 return `<div class="js-page jt-page-section">${renderPageSection(s,media)}</div>`; // page section styles apply inside .js-page
}
// Global style variables from theme settings.
const FONTS={bebas:'"Bebas Neue",Impact,sans-serif',inter:'Inter,Arial,sans-serif',georgia:'Georgia,"Times New Roman",serif',system:'system-ui,-apple-system,"Segoe UI",Arial,sans-serif'};
export function themeVars(settings){
 const out={};for(const k of ['background','text','heading','muted','accent','accent_hover'])out['--jt-'+k.replace('_','-')]=settings[k];
 out['--jt-heading-font']=FONTS[settings.heading_font];out['--jt-body-font']=FONTS[settings.body_font];return out;
}
export const themeCss=settings=>`:root{${Object.entries(themeVars(settings)).map(([k,v])=>`${k}:${v}`).join(';')}}`;
export const renderThemeHeader=(data,media={},o={})=>`<header class="jt-header-group">${data.header.map(s=>section(s,media,o)).join('')}</header>`;
export const renderThemeFooter=(data,media={},o={})=>data.footer.map(s=>section(s,media,o)).join('');
export function renderThemeBody(data,media={},o={}){
 return renderThemeHeader(data,media,o)+`<main id="MainContent" class="jt-main">${data.sections.map(s=>section(s,media,o)).join('')||'<section class="store-section"><div class="js-rich js-align-center"><p class="js-empty">This theme has no visible sections yet.</p></div></section>'}</main>`+renderThemeFooter(data,media,o);
}
// Full document for the sandboxed admin preview (no scripts run there; links are disabled).
export function themeDocument(data,media,origin=''){
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Theme preview</title><link rel="stylesheet" href="${origin}/styles.css"><link rel="stylesheet" href="${origin}/page-sections.css"><link rel="stylesheet" href="${origin}/theme.css"><style>${themeCss(data.settings)}a,button{pointer-events:none}</style></head><body class="js-body jt-body">${renderThemeBody(data,media,{inline:true})}</body></html>`;
}
