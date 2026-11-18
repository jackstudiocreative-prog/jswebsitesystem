// Public storefront image URLs (no database or Cloudinary access; see public-media.mjs for the checks).
export const WIDTHS=Object.freeze([320,640,960,1440,2048]);
export const snapWidth=w=>{const n=Number(w);if(!Number.isFinite(n)||n<=0)return 960;return WIDTHS.find(x=>x>=n)??WIDTHS[WIDTHS.length-1];};
export const publicMediaUrl=(id,w=960)=>`/api/v3/storefront/media/${id}?w=${snapWidth(w)}`;
// srcset: allowed widths up to the original. The step above the original is delivered at the original
// size (no upscaling), so it is described with the original width.
export function publicSrcset(id,originalWidth){
 const max=Number(originalWidth)||WIDTHS[WIDTHS.length-1];
 const list=WIDTHS.filter(w=>w<max),next=WIDTHS.find(w=>w>=max);if(next)list.push(next);
 return list.map(w=>`${publicMediaUrl(id,w)} ${Math.min(w,max)}w`).join(', ');
}
// Shape returned by public APIs: no storage key, version, Cloudinary ID or private URL.
export const publicImage=(m,alt='')=>m?{id:String(m.id),url:publicMediaUrl(m.id,960),srcset:publicSrcset(m.id,m.width),width:m.width??null,height:m.height??null,alt:String(alt||m.label||'').slice(0,200)}:null;

// Stand-in for the Cloudinary adapter in public renderers: every image becomes a checked public URL.
export const PUBLIC_CLOUD=Object.freeze({public:true,preview:m=>publicMediaUrl(m.id,960)});
