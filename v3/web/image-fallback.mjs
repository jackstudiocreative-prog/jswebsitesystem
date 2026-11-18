// A storefront image that cannot be delivered (unpublished in the meantime, or the image service is not
// configured) becomes the neutral placeholder instead of a broken-image icon.
const PLACEHOLDER="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 3'%3E%3Crect width='4' height='3' fill='%23e7e1d3'/%3E%3C/svg%3E";
if(!window.__jsImageFallback){
 window.__jsImageFallback=true;
 document.addEventListener('error',e=>{const img=e.target;if(!(img instanceof HTMLImageElement)||img.dataset.failed)return;
  if(!/\/api\/v3\/storefront\/media\//.test(img.currentSrc||img.src))return;
  img.dataset.failed='1';img.removeAttribute('srcset');img.src=PLACEHOLDER;img.classList.add('js-image-failed');},true);
}
