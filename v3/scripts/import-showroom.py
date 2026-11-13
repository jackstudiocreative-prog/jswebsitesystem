#!/usr/bin/env python3
"""Copies the Jack Studio 3D showroom (jackstudiocreative-prog/js-showroom, JackStudio_Matterport_Concept_V5)
into v3/showroom so the storefront can embed it directly (same site, no new page, fast load).

The original keeps every texture as a base64 PNG inside JavaScript (~66 MB). This script moves each texture
into its own WebP file (~4.6 MB in total) and leaves only the small layout data in the JavaScript files.
Usage: python3 scripts/import-showroom.py <path to JackStudio_Matterport_Concept_V5>
"""
import base64, io, pathlib, re, shutil, sys
from PIL import Image

src = pathlib.Path(sys.argv[1]); dst = pathlib.Path(__file__).resolve().parent.parent / 'showroom'
if dst.exists(): shutil.rmtree(dst)
(dst / 'assets').mkdir(parents=True)
shutil.copy(src / 'style.css', dst / 'style.css')
# Pause hook: the home page stops the render loop while the showroom is scrolled out of view
# (same-site frames are not throttled by the browser, so a running loop would slow the page).
loop = "if(now-lastOverlay>45){updateOverlay();lastOverlay=now}requestAnimationFrame(render)}"
app = (src / 'app.js').read_text(); assert app.count(loop) == 1
(dst / 'app.js').write_text(app.replace(loop, "if(now-lastOverlay>45){updateOverlay();lastOverlay=now}if(window.vsPaused){window.vsResume=()=>{window.vsResume=null;last=performance.now();requestAnimationFrame(render)};return}requestAnimationFrame(render)}"))
for photo in (src / 'assets').glob('*.jpg'):  # reference photos for "View reference"
    if photo.name not in ('showroom_atlas.jpg', 'showroom-cover.jpg'): shutil.copy(photo, dst / 'assets' / photo.name)
for data in sorted((src / 'assets').glob('*-data.js')):
    text = data.read_text(); m = re.search(r'"data:image/(png|jpeg);base64,([^"]+)"', text)
    image = Image.open(io.BytesIO(base64.b64decode(m.group(2)))); image.load()
    webp = data.name.replace('-data.js', '.webp'); out = io.BytesIO()
    if image.mode in ('RGBA', 'LA') or 'transparency' in image.info: image.convert('RGBA').save(out, 'WEBP', quality=82, method=6, alpha_quality=90)
    else: image.convert('RGB').save(out, 'WEBP', quality=82, method=6)
    (dst / 'assets' / webp).write_bytes(out.getvalue())
    (dst / 'assets' / data.name).write_text(text[:m.start()] + '"assets/' + webp + '"' + text[m.end():])
html = (src / 'index.html').read_text()
open(dst / 'index.html', 'w').write(html)
print('showroom copied to', dst)
