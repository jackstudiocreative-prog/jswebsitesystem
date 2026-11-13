// Runtime for pages built from the Shopify theme sections (see src/liquid.mjs).
// 1. Inline onclick/onchange calls from the original theme arrive as data-lq-on-* attributes (the storefront
//    allows no inline scripts); they are run here by calling the named global function with literal arguments.
// 2. Forms that have no online service yet say so instead of pretending to send.
(function(){
 function value(raw,el,ev){var s=raw.trim();if(s==='this')return el;if(s==='event')return ev;if(s==='true')return true;if(s==='false')return false;if(s==='null')return null;
  if(/^-?\d+(\.\d+)?$/.test(s))return Number(s);var q=s.match(/^(['"])([\s\S]*)\1$/);if(q)return q[2];return undefined;}
 function args(list){var out=[],cur='',quote=null;for(var i=0;i<list.length;i++){var c=list[i];if(quote){cur+=c;if(c===quote&&list[i-1]!=='\\')quote=null;}else if(c==='"'||c==="'"){quote=c;cur+=c;}else if(c===','){out.push(cur);cur='';}else cur+=c;}if(cur.trim())out.push(cur);return out;}
 function run(code,el,ev){
  code.split(';').forEach(function(part){var p=part.trim();if(!p)return;if(/^return\s+false$/.test(p)){ev.preventDefault();return;}
   var m=p.match(/^(?:return\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(([\s\S]*)\)$/);if(!m)return;
   var path=m[1].split('.'),owner=window,fn=window;for(var i=0;i<path.length;i++){owner=fn;fn=fn&&fn[path[i]];}
   if(typeof fn==='function'){var r=fn.apply(owner===window?el:owner,args(m[2]).map(function(a){return value(a,el,ev);}));if(r===false)ev.preventDefault();}
  });
 }
 ['click','change','input','submit'].forEach(function(type){document.addEventListener(type,function(ev){var attr='data-lq-on-'+type,el=ev.target&&ev.target.closest&&ev.target.closest('['+attr+']');if(el)run(el.getAttribute(attr),el,ev);});});
 document.addEventListener('submit',function(ev){var f=ev.target;if(!f||!f.hasAttribute||!f.hasAttribute('data-lq-form'))return;ev.preventDefault();
  var note=f.querySelector('.lq-form-note');if(!note){note=document.createElement('p');note.className='lq-form-note';note.setAttribute('role','status');f.appendChild(note);}
  note.textContent='Online forms are not active on the new site yet. Please contact us by WhatsApp, phone or email for now.';});
})();
