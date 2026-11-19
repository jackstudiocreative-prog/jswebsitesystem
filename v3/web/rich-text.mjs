// Product and collection descriptions (imported from Shopify as HTML) shown safely.
// The HTML is parsed into an inert document (nothing runs or loads) and rebuilt element by element from
// an allowlist: paragraphs, line breaks, lists, emphasis, headings, links, tables and images. Every
// attribute that is not explicitly allowed is dropped; wrappers (div, span, …) keep only their content.
const KEEP=new Set(['P','BR','UL','OL','LI','STRONG','B','EM','I','U','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TD','TH','HR']);
const HEADING={H1:'h3',H2:'h3',H3:'h3',H4:'h4',H5:'h4',H6:'h4'};
const DROP=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SELECT','TEXTAREA','svg','SVG','MATH','TEMPLATE','NOSCRIPT','LINK','META','BASE','VIDEO','AUDIO','SOURCE']);
const safeHref=h=>/^(https:\/\/|\/(?!\/)|mailto:|tel:|#)/i.test(h??'')?h:null;
// Images only from the shop's own sources (also allowed by the page's Content-Security-Policy).
const safeSrc=s=>{const v=String(s??'').replace(/^\/\//,'https://');return /^https:\/\/cdn\.shopify\.com\//.test(v)||/^\/api\/v3\/storefront\/media\/\d+/.test(v)?v:null;};

// Event-handler attributes are renamed inside tags before parsing, so no browser ever sees one (some
// Chromium builds report a CSP violation for them even in an inert DOMParser document).
const defuse=html=>html.replace(/<[^>]+>/g,tag=>tag.replace(/([\s/"']|^)on([a-z]+\s*=)/gi,'$1data-removed-on$2'));
const parse=html=>new DOMParser().parseFromString(defuse(html),'text/html');
function rebuild(node,out){
 for(const child of node.childNodes){
  if(child.nodeType===3){out.append(document.createTextNode(child.nodeValue));continue;}
  if(child.nodeType!==1)continue;
  const tag=child.tagName;
  if(DROP.has(tag))continue;
  let el=null;
  if(KEEP.has(tag))el=document.createElement(tag.toLowerCase());
  else if(HEADING[tag])el=document.createElement(HEADING[tag]);
  else if(tag==='A'){const href=safeHref(child.getAttribute('href'));if(href){el=document.createElement('a');el.href=href;if(/^https:/i.test(href)&&new URL(href).origin!==location.origin){el.rel='noopener noreferrer';el.target='_blank';}}}
  else if(tag==='IMG'){const src=safeSrc(child.getAttribute('src'));if(src){const img=document.createElement('img');img.src=src;img.alt=(child.getAttribute('alt')??'').slice(0,200);img.loading='lazy';img.decoding='async';out.append(img);}continue;}
  if(!el){rebuild(child,out);continue;} // unknown wrapper: keep its content only
  if(el.tagName==='TD'||el.tagName==='TH'){for(const a of ['colspan','rowspan']){const n=Number(child.getAttribute(a));if(Number.isInteger(n)&&n>1&&n<=20)el.setAttribute(a,String(n));}}
  rebuild(child,el);
  // Shopify descriptions often contain empty paragraphs used as spacing.
  if(el.tagName==='P'&&!el.textContent.trim()&&!el.querySelector('img'))continue;
  if(el.tagName==='TABLE'){const wrap=document.createElement('div');wrap.className='js-table-scroll';wrap.append(el);out.append(wrap);continue;}
  out.append(el);
 }
}
export function richText(html){
 const frag=document.createDocumentFragment();
 const text=String(html??'');if(!text.trim())return frag;
 // Plain text (no tags): blank lines separate paragraphs.
 if(!/<[a-z!/]/i.test(text)){for(const para of text.split(/\n{2,}/).map(t=>t.trim()).filter(Boolean)){const p=document.createElement('p');p.textContent=para;frag.append(p);}return frag;}
 const doc=parse(text);
 rebuild(doc.body,frag);
 return frag;
}
// Plain text for meta descriptions (entities decoded, tags removed).
export function plainText(html,max=155){
 const text=/<[a-z!/]/i.test(String(html??''))?parse(String(html)).body.textContent:String(html??'');
 return text.replace(/\s+/g,' ').trim().slice(0,max);
}
