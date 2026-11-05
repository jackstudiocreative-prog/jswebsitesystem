// Search engines: staging stays out of the index (also X-Robots-Tag: noindex in vercel.json) until
// SITE_INDEXING=on. Private areas are always disallowed. The sitemap lists only public content.
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function robots(base,indexing){
 const lines=['User-agent: *'];
 if(!indexing)lines.push('Disallow: /');
 else{for(const p of ['/admin','/api/','/cart','/checkout','/order','/pay/'])lines.push('Disallow: '+p);if(/^https:\/\//.test(base))lines.push('',`Sitemap: ${base}/sitemap.xml`);}
 return lines.join('\n')+'\n';
}
export async function sitemap(db,base){
 const urls=[];
 if(/^https:\/\/[^/]+$/.test(base)){
  const pages=(await db.query('SELECT p.slug,r.published_at FROM pages p JOIN page_revisions r ON r.id=p.published_revision_id ORDER BY p.slug')).rows;
  const products=(await db.query("SELECT p.handle,p.updated_at FROM products p WHERE p.status='active' AND EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active) AND EXISTS(SELECT 1 FROM product_collections pc JOIN collections c ON c.id=pc.collection_id WHERE pc.product_id=p.id AND c.status='active') ORDER BY p.handle")).rows;
  for(const p of pages)urls.push([`${base}/pages/${p.slug}`,p.published_at]);
  for(const p of products)urls.push([`${base}/products/${p.handle}`,p.updated_at]);
 }
 return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+urls.map(([loc,mod])=>`<url><loc>${esc(loc)}</loc><lastmod>${new Date(mod).toISOString().slice(0,10)}</lastmod></url>`).join('\n')+'\n</urlset>\n';
}
