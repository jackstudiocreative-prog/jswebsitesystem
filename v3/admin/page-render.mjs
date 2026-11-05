// Renders resolved page sections to HTML for the editor preview and the public page.
// Every value is escaped; links were validated by the shared schema. Images use <img>, never CSS
// url(), so no catalogue or page text can inject markup or styles.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=n=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format((n??0)/100);
const paragraphs=text=>String(text??'').split(/\n{2,}/).filter(Boolean).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
const button=(s,cls='store-button')=>s.cta_label&&s.cta_href?`<a class="${cls}" href="${esc(s.cta_href)}">${esc(s.cta_label)}</a>`:'';
function image(media,id,alt,cls){const url=id&&media[id];return url?`<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">`:`<div class="${cls} js-image-placeholder" role="img" aria-label="${esc(alt||'Image')}"></div>`;}
const render={
 hero:(s,media)=>`<section class="js-hero js-align-${s.align}">${s.media_id?image(media,s.media_id,'','js-hero-image')+'<div class="js-hero-shade"></div>':''}<div class="js-hero-content">${s.eyebrow?`<p class="js-eyebrow">${esc(s.eyebrow)}</p>`:''}<h1>${esc(s.heading)}</h1>${s.body?`<p>${esc(s.body)}</p>`:''}${button(s)}</div></section>`,
 image_text:(s,media)=>`<section class="store-section"><div class="store-section-inner js-split js-image-${s.image_position}">${image(media,s.media_id,s.image_alt,'js-split-image')}<div class="js-split-copy">${s.eyebrow?`<p class="js-eyebrow">${esc(s.eyebrow)}</p>`:''}<h2>${esc(s.heading)}</h2>${paragraphs(s.body)}${button(s)}</div></div></section>`,
 product_grid:(s,media,section)=>{const items=section.products??[];return `<section class="store-section"><div class="store-section-inner">${s.heading?`<h2 class="js-section-title">${esc(s.heading)}</h2>`:''}${s.body?`<p class="js-section-intro">${esc(s.body)}</p>`:''}${items.length?`<div class="js-grid">${items.map(p=>`<a class="js-card" href="/products/${esc(p.handle)}">${image(media,p.featured_media_id,p.title,'js-card-image')}<span class="js-card-title">${esc(p.title)}</span><span class="js-card-price">${p.variant_count>1?'From ':''}${price(p.price_minor)}</span></a>`).join('')}</div>`:'<p class="js-empty">No products to show yet. Products appear when they are active and in an active collection.</p>'}${s.cta_label?`<div class="store-section-footer">${button(s)}</div>`:''}</div></section>`;},
 banner:s=>`<section class="js-banner js-theme-${s.theme}"><div class="store-section-inner"><p>${esc(s.text)}</p>${button(s,'store-button js-banner-button')}</div></section>`,
 rich_text:s=>`<section class="store-section"><div class="js-rich js-align-${s.align}">${s.heading?`<h1>${esc(s.heading)}</h1>`:''}${paragraphs(s.body)}</div></section>`
};
export function renderPage(page,media={}){
 const sections=(page.sections??[]).filter(s=>!s.hidden&&render[s.type]);
 if(!sections.length)return '<main class="js-page"><section class="store-section"><div class="js-rich js-align-center"><p class="js-empty">This page has no visible sections yet.</p></div></section></main>';
 return `<main class="js-page">${sections.map(s=>`<div data-section="${esc(s.id)}">${render[s.type](s.settings,media,s)}</div>`).join('')}</main>`;
}
export function previewDocument(page,media,origin=''){
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.seo_title||page.title)}</title><link rel="stylesheet" href="${origin}/styles.css"><link rel="stylesheet" href="${origin}/page-sections.css"><style>a{pointer-events:none}</style></head><body class="js-body">${renderPage(page,media)}</body></html>`;
}
export {esc};
