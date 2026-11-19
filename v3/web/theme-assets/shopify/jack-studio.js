
function jsOpen(id){document.getElementById(id)?.classList.add('show')}
function jsClose(id){document.getElementById(id)?.classList.remove('show')}
function openSeries(id,el){
  document.querySelectorAll('.expand-panel').forEach(x=>x.classList.remove('show'));
  document.querySelectorAll('.mc-card').forEach(x=>x.classList.remove('active'));
  const p=document.getElementById(id); if(p)p.classList.add('show'); if(el)el.classList.add('active');
  if(p)p.scrollIntoView({behavior:'smooth',block:'start'});
}
function closeSeries(){document.querySelectorAll('.expand-panel').forEach(x=>x.classList.remove('show'));document.querySelectorAll('.mc-card').forEach(x=>x.classList.remove('active'))}
function changeQty(btn,delta){let v=btn.parentElement.querySelector('.qty-val');let n=parseInt(v.textContent||'0',10)||0;v.textContent=Math.max(0,n+delta)}
function openProduct(el){
  const modal=document.getElementById('productModal'); if(!modal)return;
  const img=el.querySelector('.simg'), name=el.querySelector('.sname'), panel=el.closest('.expand-panel');
  document.getElementById('pmPhoto').style.backgroundImage=img?.style.backgroundImage||'none';
  document.getElementById('pmName').textContent=name?.textContent||'Product';
  document.getElementById('pmEyebrow').textContent=panel?.querySelector('.ep-head h2')?.textContent||'Jack Studio';
  document.getElementById('pmSub').textContent='Jack Studio';
  document.getElementById('pmDesc').textContent='Genuine leather, finished by hand and built for everyday use.';
  modal.classList.add('show');
}
function closeProduct(){document.getElementById('productModal')?.classList.remove('show')}

/* ============================================================
   WISHLIST (localStorage based)
   ============================================================ */
var JS_WISHLIST_KEY = 'jack_studio_wishlist';

function jsGetWishlist(){
  try { return JSON.parse(localStorage.getItem(JS_WISHLIST_KEY)) || []; }
  catch(e){ return []; }
}
function jsSaveWishlist(list){
  localStorage.setItem(JS_WISHLIST_KEY, JSON.stringify(list));
  jsUpdateWishlistBadge();
}
function jsIsWishlisted(handle){
  return jsGetWishlist().indexOf(handle) !== -1;
}
function jsToggleWishlist(handle, btn){
  var list = jsGetWishlist();
  var idx = list.indexOf(handle);
  if(idx === -1){
    list.push(handle);
    if(btn) btn.classList.add('is-wished');
  } else {
    list.splice(idx, 1);
    if(btn) btn.classList.remove('is-wished');
  }
  jsSaveWishlist(list);
  jsToast(idx === -1 ? 'Added to wishlist' : 'Removed from wishlist');
}
function jsUpdateWishlistBadge(){
  var count = jsGetWishlist().length;
  document.querySelectorAll('[data-wishlist-count]').forEach(function(el){
    el.textContent = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}
function jsInitWishlistButtons(){
  document.querySelectorAll('[data-wishlist-toggle]').forEach(function(btn){
    var handle = btn.getAttribute('data-wishlist-toggle');
    if(jsIsWishlisted(handle)) btn.classList.add('is-wished');
    btn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      jsToggleWishlist(handle, btn);
    });
  });
}

/* ============================================================
   ADD TO CART (Shopify AJAX Cart API)
   ============================================================ */
function jsAddToCart(variantId, qty, btn){
  qty = qty || 1;
  if(btn){ btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Adding...'; }
  fetch('/cart/add.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: variantId, quantity: qty }] })
  })
  .then(function(res){
    if(!res.ok) throw new Error('Add to cart failed');
    return res.json();
  })
  .then(function(){
    jsToast('Added to cart');
    jsUpdateCartBadge();
    if(btn){ btn.textContent = 'Added ✓'; setTimeout(function(){ btn.textContent = btn.dataset.origText; btn.disabled = false; }, 1500); }
  })
  .catch(function(){
    jsToast('Could not add to cart');
    if(btn){ btn.textContent = btn.dataset.origText; btn.disabled = false; }
  });
}
function jsUpdateCartBadge(){
  fetch('/cart.js').then(function(r){ return r.json(); }).then(function(cart){
    document.querySelectorAll('[data-cart-count]').forEach(function(el){
      el.textContent = cart.item_count;
      el.style.display = cart.item_count > 0 ? '' : 'none';
    });
  });
}
function jsInitAddToCartButtons(){
  document.querySelectorAll('[data-add-to-cart]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.preventDefault();
      var variantId = btn.getAttribute('data-add-to-cart');
      var qty = parseInt(btn.getAttribute('data-qty') || '1', 10);
      jsAddToCart(variantId, qty, btn);
    });
  });
}

/* ============================================================
   TOAST
   ============================================================ */
function jsToast(msg){
  var t = document.getElementById('jsGlobalToast');
  if(!t){
    t = document.createElement('div');
    t.id = 'jsGlobalToast';
    t.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%) translateY(20px);background:#401410;color:#F4EFDC;padding:14px 22px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;z-index:999;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;border-radius:3px;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(window._jsToastTimer);
  window._jsToastTimer = setTimeout(function(){
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
  }, 2200);
}

document.addEventListener('DOMContentLoaded', function(){
  jsInitWishlistButtons();
  jsInitAddToCartButtons();
  jsUpdateWishlistBadge();
  jsUpdateCartBadge();
});
