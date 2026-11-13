(()=>{'use strict';
const $=id=>document.getElementById(id),canvas=$('world');
const gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'high-performance'})||canvas.getContext('webgl',{antialias:true,alpha:false});
if(!gl){$('loading').innerHTML='<div class="loadbox">Your browser does not support WebGL.<br>Please use Chrome or Edge.</div>';return;}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t;
const rects=window.JS_ATLAS_RECTS||{};
const vs=`attribute vec3 aPos;attribute vec2 aUV;attribute float aShade;uniform mat4 uVP;uniform vec3 uCamera;varying vec2 vUV;varying float vShade;varying float vDist;varying vec3 vWorld;void main(){vWorld=aPos;gl_Position=uVP*vec4(aPos,1.);vUV=aUV;vShade=aShade;vDist=distance(aPos,uCamera);}`;
const fs=`precision highp float;varying vec2 vUV;varying float vShade;varying float vDist;uniform sampler2D uTexture;uniform float uCut;uniform float uHeritage;uniform vec4 uContacts[28];varying vec3 vWorld;void main(){vec4 tex=texture2D(uTexture,vUV);float cov=1.;if(uCut>0.){cov=clamp((tex.a-uCut)*3.+.5,0.,1.);if(cov<.02)discard;}vec3 color=tex.rgb*vShade;if(uHeritage>.5&&abs(vWorld.y-.8625)<.002){float shadow=1.;for(int i=0;i<28;i++){vec4 c=uContacts[i];vec2 p=(vWorld.xz-c.xy)/c.zw;shadow*=1.-.26*exp(-dot(p,p)*2.2);}color*=max(.48,shadow);}color=mix(color,vec3(.81,.78,.74),clamp((vDist-10.)/24.,0.,.28));gl_FragColor=vec4(color,cov);}`;
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);   // antialiased edges on photo cut-outs (MSAA)
const loc={pos:gl.getAttribLocation(program,'aPos'),uv:gl.getAttribLocation(program,'aUV'),shade:gl.getAttribLocation(program,'aShade'),mvp:gl.getUniformLocation(program,'uVP'),camera:gl.getUniformLocation(program,'uCamera'),sampler:gl.getUniformLocation(program,'uTexture'),cut:gl.getUniformLocation(program,'uCut'),heritage:gl.getUniformLocation(program,'uHeritage'),contacts:gl.getUniformLocation(program,'uContacts[0]')};
gl.uniform4fv(loc.contacts,new Float32Array([-0.25,-1.15,0.13,0.2,-0.45,-1.31,0.08,0.14,-0.2,-1.5699999999999998,0.08,0.16,-0.015,-1.93,0.07,0.14,-0.245,-2.295,0.18,0.18,-0.34,-2.68,0.09,0.2,-0.08,-2.64,0.07,0.15,-0.43,-3.0300000000000002,0.08,0.14,-0.05,-3.04,0.075,0.16,-0.075,-3.45,0.07,0.14,0.24,-2.235,0.13,0.08,0.13,-2.45,0.13,0.08,0.13,-2.61,0.13,0.08,0.13,-2.77,0.13,0.08,0.34,-2.41,0.07,0.08,0.35,-2.59,0.07,0.08,0.29,-2.89,0.07,0.08,0.385,-3.11,0.07,0.08,0.5,-2.37,0.09,0.06,0.49,-2.56,0.09,0.06,0.49,-2.75,0.12,0.06,0.13,-3,0.13,0.13,0.405,-3.3899999999999997,0.12,0.12,0.26,-1.77,0.12,0.12,0.16,-3.25,0.12,0.1,-0.025,-1.18,0.19,0.28,-0.245,-1.92,0.07,0.18,-0.4,-3.29,0.15,0.18]));
const verts=[],UVS=[],shades=[];
// Photo cut-out products (RGBA sprite sheet, alpha-tested), drawn as a second pass.
const SP=window.JS_SPRITES||{},SPS=window.JS_SPRITE_SIZE||[1,1],sV=[],sU=[],sS=[];
// Each product is a photo card that turns (around its vertical axis) to face the viewer, so it is
// always seen from the front; the turn is limited so cards never swing out of their shelf.
const SPR=[];let MANQ=null,manParts=null,manTex=null;let LBQ=null,lbTex=null,lbMesh=null;
function sprite(x,zc,hw,y0,y1,key,shade=1,turn=true){const m=SP[key];if(!m)return;const [u,v,w,h]=m.uv;
 let b=[x,y0,zc],t=[x,y1,zc],e=[x,y0,zc+hw];if(XF){b=XF(b);t=XF(t);e=XF(e)}
 SPR.push({x:b[0],z:b[2],y0:b[1],y1:t[1],hw:e[2]-b[2],turn,uv:[(u+.5)/SPS[0],(v+.5)/SPS[1],(u+w-.5)/SPS[0],(v+h-.5)/SPS[1]],shade})}
// a photo panel fixed in space: q = bottom-left, bottom-right, top-right, top-left
function photoQuad(key,q,shade=1){const m=SP[key];if(!m)return;const [u,v,w,h]=m.uv;
 SPR.push({quad:q,uv:[(u+.5)/SPS[0],(v+.5)/SPS[1],(u+w-.5)/SPS[0],(v+h-.5)/SPS[1]],shade})}
// cards stay parallel to the screen (face the view direction), so a row of them always lines up
function spriteGeometry(yaw){const P=[];const a0=Math.atan2(Math.cos(yaw),-Math.sin(yaw));for(const s of SPR){if(s.quad){for(const i of [0,1,2,0,2,3])P.push(...s.quad[i]);continue}let nx=-1,nz=0;
 if(typeof s.turn==='number'){nx=-Math.cos(s.turn);nz=-Math.sin(s.turn)}else if(s.turn){let a=a0,d=Math.atan2(Math.sin(a-Math.PI),Math.cos(a-Math.PI));d=Math.max(-.9,Math.min(.9,d));nx=-Math.cos(d);nz=-Math.sin(d)}
 const rx=nz*s.hw,rz=-nx*s.hw,q=[[s.x-rx,s.y0,s.z-rz],[s.x+rx,s.y0,s.z+rz],[s.x+rx,s.y1,s.z+rz],[s.x-rx,s.y1,s.z-rz]];
 for(const i of [0,1,2,0,2,3])P.push(...q[i])}return P}
const vw=4096;function uvTile(id){const r=rects[id]||rects.white;return [(r[0]+2)/vw,(r[1]+2)/vw,(r[0]+r[2]-2)/vw,(r[1]+r[3]-2)/vw]}
let XF=null;// optional point transform (used to scale a whole zone)
function quad(a,b,c,d,texture='wall',shade=1){if(XF){a=XF(a);b=XF(b);c=XF(c);d=XF(d)}const uv=uvTile(texture),p=[a,b,c,a,c,d],t=[[uv[0],uv[3]],[uv[2],uv[3]],[uv[2],uv[1]],[uv[0],uv[3]],[uv[2],uv[1]],[uv[0],uv[1]]];for(let i=0;i<6;i++){verts.push(...p[i]);UVS.push(...t[i]);shades.push(shade)}}
function box(x,y,z,w,h,d,tex='wood',light=1){const a=x-w/2,b=x+w/2,c=y-h/2,e=y+h/2,f=z-d/2,g=z+d/2;
quad([a,c,g],[b,c,g],[b,e,g],[a,e,g],tex,light*.96);quad([b,c,f],[a,c,f],[a,e,f],[b,e,f],tex,light*.85);
quad([a,c,f],[a,c,g],[a,e,g],[a,e,f],tex,light*.77);quad([b,c,g],[b,c,f],[b,e,f],[b,e,g],tex,light*.91);
quad([a,e,g],[b,e,g],[b,e,f],[a,e,f],tex,light*1.07);quad([a,c,f],[b,c,f],[b,c,g],[a,c,g],tex,light*.58)}
function xpanel(x,zb,ze,yb,yt,tex,shade=1,side=1){const l=side===1?zb:ze,r=side===1?ze:zb;quad([x,yb,l],[x,yb,r],[x,yt,r],[x,yt,l],tex,shade)}
function zpanel(z,xb,xe,yb,yt,tex,shade=1){quad([xb,yb,z],[xe,yb,z],[xe,yt,z],[xb,yt,z],tex,shade)}
function ring(cx,cz,r=0.28,shade=1){const seg=24,y=.035;for(let i=0;i<seg;i++){const a=i*Math.PI*2/seg,b=(i+1)*Math.PI*2/seg;
quad([cx+Math.cos(a)*(r-.065),y,cz+Math.sin(a)*(r-.065)],[cx+Math.cos(b)*(r-.065),y,cz+Math.sin(b)*(r-.065)],[cx+Math.cos(b)*r,y,cz+Math.sin(b)*r],[cx+Math.cos(a)*r,y,cz+Math.sin(a)*r],'cream',shade)}}
function line3(a,b,w=0.045,tex='metal'){// square-section beam between two points
const d=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],L=Math.hypot(...d);if(L<1e-6)return;const n=d.map(v=>v/L);
let r=Math.abs(n[1])<.9?[n[2],0,-n[0]]:[1,0,0];let rl=Math.hypot(...r);r=r.map(v=>v/rl*w/2);
const u=[n[1]*r[2]-n[2]*r[1],n[2]*r[0]-n[0]*r[2],n[0]*r[1]-n[1]*r[0]];
const P=(p,sr,su)=>[p[0]+r[0]*sr+u[0]*su,p[1]+r[1]*sr+u[1]*su,p[2]+r[2]*sr+u[2]*su];
const C=[[1,1],[-1,1],[-1,-1],[1,-1]],sh=[1.02,.9,.7,.86];
for(let i=0;i<4;i++){const [s1,u1]=C[i],[s2,u2]=C[(i+1)%4];quad(P(a,s1,u1),P(a,s2,u2),P(b,s2,u2),P(b,s1,u1),tex,.83*sh[i])}}
// Environment geometry: phototextured racks in a walkable world, not panorama cards.
// Our Story recess under the staircase (left wall): runs from m=-.45 to 3.2 along the wall, 0.75 m deep
const OS={zs:-.6,W:3.2,m2:0,SW:.3,d:m=>Math.min(4.055,.9+.9855*m)};
const FRONT=4.55,RC=(-10.22+FRONT)/2,RL=FRONT+10.22; // room front (entrance) and centre/length along z
function buildWorld(){
// Floor: repeated genuine volumetric floor geometry, light-oak texture.
for(let x=-5.4;x<5.4;x+=1.35)for(let z=-10.1;z<FRONT-.05;z+=1.6)
quad([x,0,z+1.6],[x+1.35,0,z+1.6],[x+1.35,0,z],[x,0,z],'floor',.95+((Math.round(z*5+x*2)%3)*.018));
box(0,4.14,RC,11,0.17,RL,'cream',1.04);quad([-5.5,4.054,FRONT],[5.5,4.054,FRONT],[5.5,4.054,-10.22],[-5.5,4.054,-10.22],'cream',1.0);   // ceiling underside, lit
// White plaster walls, room boundary and entrance side returns.
box(5.52,2,RC,.18,4,RL,'wall',.99);
{const zA=OS.zs-OS.m2,zB=OS.zs-OS.W;box(-5.52+OS.SW/2,2.03,(FRONT+zA)/2,.18+OS.SW,4.06,FRONT-zA,'wall',.95);box(-5.52,2,(zB-10.22)/2,.18,4,zB+10.22,'wall',.95);
 {const m0=OS.m2,m1=OS.W;quad([-5.43,OS.d(m0),OS.zs-m0],[-5.43,OS.d(m1),OS.zs-m1],[-5.43,4.06,OS.zs-m1],[-5.43,4.06,OS.zs-m0],'wall',.82)}}
// Front wall with a pair of glass doors (entrance): plain white wall either side and above,
// two frameless-look glass leaves with slim silver frames, long pull handles and a floor threshold.
{const DW=1.6,DH=2.7,T=.16;box(-(5.5+DW)/2,2.03,FRONT,5.5-DW,4.06,T,'wall',1);box((5.5+DW)/2,2.03,FRONT,5.5-DW,4.06,T,'wall',1);
 box(0,(DH+4.06)/2,FRONT,2*DW,4.06-DH,T,'wall',1);
 for(const sx of [-1,1]){const x0=sx>0?0:-DW,x1=sx>0?DW:0,xc=(x0+x1)/2,w=DW;
  quad([x0+.03,.03,FRONT-.004],[x1-.03,.03,FRONT-.004],[x1-.03,DH-.03,FRONT-.004],[x0+.03,DH-.03,FRONT-.004],'glass',1.18);
  for(const [cx,cy,ww,hh] of [[xc,DH-.015,w,.03],[xc,.015,w,.03],[x0+.015,DH/2,.03,DH],[x1-.015,DH/2,.03,DH]])box(cx,cy,FRONT-.004,ww,hh,.04,'white',.82);
  const hx=sx>0?x0+.12:x1-.12;box(hx,1.1,FRONT-.06,.025,1.0,.025,'white',.95);for(const y of [.68,1.52])box(hx,y,FRONT-.035,.02,.02,.05,'white',.9)}
 box(0,.006,FRONT-.02,2*DW,.012,.2,'white',.7)}

// Glass entrance doors and side mullions (light gray, intentionally translucent-looking).

// Wall skirt/baseboard around all sides
box(5.38,.13,RC,.12,.26,RL-.2,'wood',.82);{const zA=OS.zs-OS.m2,zB=OS.zs-OS.W;box(-5.38+OS.SW,.13,(FRONT-.1+zA)/2,.12,.26,FRONT-.1-zA,'wood',.82);box(-5.38,.13,(zB-10.12)/2,.12,.26,zB+10.12,'wood',.82)}
for(const s of [-1,1])box(s*(5.3+2.17)/2,.11,-10.075,5.3-2.17,.22,.11,'wood',.85);
ceiling();
backWall();
// Main wall arrays with actual store photos integrated into the display backing.
brandWalls();essentialZone();
urbanZone();profZone();travelZone();
// Main freestanding display islands, with three-dimensional leather products.
craftInnovative(0.3,0.35);craftHeritage(0,-2.25);giftTable(0,-5.8);walletCounter(0,-7.45);
}
// Back of store, rebuilt from the storefront photo: lit JACK STUDiO letters over a wide
// solid white end wall, nothing else on the wall.
function backWall(){
// Proportions measured from the storefront photo: fascia ~1/3 of the wall height, letters 0.44 m
// tall and 3.24 m wide, sitting 0.35 m above a 4.3 m wide opening. The opening is kept as a
// shallow white recess (structure only; nothing behind it is shown).
const Z=-10.22,T=.18,F=Z+T/2,OW=2.17,OH=2.70,R=.12,CEIL=4.055;
box(-(5.5+OW)/2,OH/2,Z,5.5-OW,OH,T,'bw_lower',1.04);box((5.5+OW)/2,OH/2,Z,5.5-OW,OH,T,'bw_lower',1.04);
box(0,(OH+4.1)/2,Z,11,4.1-OH,T,'bw_lower',1.04);
zpanel(F+.003,-5.5,5.5,OH,CEIL,'bw_fascia',1.0);
// recess: back face, side reveals, soffit and a strip of floor
zpanel(F-R,-OW,OW,0,OH,'bw_lower',.95);
xpanel(-OW,F-R,F,0,OH,'bw_lower',.84,1);xpanel(OW,F-R,F,0,OH,'bw_lower',.9,-1);
quad([-OW,OH,F],[OW,OH,F],[OW,OH,F-R],[-OW,OH,F-R],'bw_lower',.72);
quad([-OW,.001,F+.04],[OW,.001,F+.04],[OW,.001,F-R],[-OW,.001,F-R],'floor',.9);
// thin shadow line where the soffit meets the fascia
box(0,OH-.004,F+.002,OW*2,.008,.004,'metal',.6);
}
// TRAVEL MOVEMENT corner (right wall, back), rebuilt from the store photos.
// Shelf heights, bay width and every product's size/position are measured from the wide store
// photo; the products themselves are cut out of that photo (JS_SPRITES), so they match exactly.
// PROFESSIONAL zone (right wall, between Travel Movement and Urban Carry), rebuilt from the store photos.
// Units u are the photos' own (pegboard panel = 1.22 u); G scales them into this room.
// Left: the tall black ladder shelf with its products (cut out of the photo, one card per product).
// Right: the PROFESSIONAL wall (perspective-corrected photo: lettering, two pegboards, belts) and
// the two mannequins standing in front of it.

// PROFESSIONAL zone rebuilt from the store photos (atlas assets/pro-data.js): real pegboard panels with
// the measured hole lattice, pine shelves on dowels, every product a solid 3D body built from its photo
// silhouette, belts as hanging straps with their buckles, chrome stands, printed signs on acrylic.
var PRV=[],PRU=[],PRS=[],proMesh=null,proTex=null;
function proItems(){const J=window.JS_PRO;if(!J)return false;const R=J.R,Gm=J.G,A=Math.PI/2;
 const {q,F,box,cyl}=mkTM(R,PRV,PRU,PRS,0,0,0);
 const infl=P=>{const Fd=P.F,w=P.w,h=P.h,gw=Fd.gw,gh=Fd.gh,r=R[P.id],rb=R[P.bk],hd=P.d/2,raw=atob(Fd.f),f=new Float32Array(raw.length);
  for(let i=0;i<raw.length;i++)f[i]=raw.charCodeAt(i)/255;const FF=(i,j)=>f[Math.max(0,Math.min(gh,j))*(gw+1)+Math.max(0,Math.min(gw,i))],du=w/gw,dv=h/gh;
  for(const sg of [1,-1]){const vert=(i,j)=>{const t=sg*FF(i,j)*hd,gx=(FF(i+1,j)-FF(i-1,j))*hd/(2*du),gy=-(FF(i,j+1)-FF(i,j-1))*hd/(2*dv),l=Math.hypot(gx,gy,1),
     shd=Math.max(.35,(.6+.24*(-gy/l)+.2/l+.05*gx/l*sg)*(sg>0?1:.8)),uv=sg>0?[r[0]+(r[2]-r[0])*i/gw,r[1]+(r[3]-r[1])*j/gh]:[rb[2]-(rb[2]-rb[0])*i/gw,rb[1]+(rb[3]-rb[1])*j/gh];
     const vv=(1-j/gh)*h,tl=P.tilt||0;return [[P.cx-t*Math.cos(tl)+vv*Math.sin(tl),P.y0+vv*Math.cos(tl)+t*Math.sin(tl)*0,P.zc+(i/gw-.5)*w],uv,shd]};
   for(let j=0;j<gh;j++)for(let i=0;i<gw;i++){if(FF(i,j)+FF(i+1,j)+FF(i,j+1)+FF(i+1,j+1)===0)continue;
    const Q=[vert(i,j),vert(i+1,j),vert(i+1,j+1),vert(i,j+1)];for(const k of (sg>0?[0,1,2,0,2,3]:[0,2,1,0,3,2])){PRV.push(...Q[k][0]);PRU.push(...Q[k][1]);PRS.push(Q[k][2])}}}};
 const BX=5.43-.006-.018,WOOD=[.86,.72,.54];
 // pegboard panels (18 mm), front face = wood grain with the hole lattice; panel seam
 for(const [g,k] of [[Gm.left,'boardL'],[Gm.right,'boardR']]){const T=F((g.z0+g.z1)/2,0,-A,0,0),w=g.z1-g.z0,h=g.y1-g.y0;
  box(F(5.43-.006-.009,(g.z0+g.z1)/2,-A),[0,g.y0,-.009],w,h,.018,{f:k,s:'c_edge',b:'c_edge'});
  box(F(BX-.0005,(g.z0+g.z1)/2,-A),[0,g.seam-.0008,0],w-.004,.0016,.001,{s:'c_edge'});
  for(const [z0,z1,y,dd] of g.shelves){const zz0=g===Gm.left?g.z0+z0/1000:z0,zz1=g===Gm.left?g.z0+z1/1000:z1,yy=g===Gm.left?g.y1-y/1000:y;
   box(F(BX-dd/2,(zz0+zz1)/2,-A),[0,yy,0],zz1-zz0,.018,dd,{s:'c_wood',t:'c_wood'});
   for(const zz of [zz0+.03,zz1-.03])tube([BX,yy-.012,zz],[BX-dd-.012,yy-.012,zz],.011,.011,WOOD,[0,0],10)}
  for(const [z,y] of g.dowels){const zz=g===Gm.left?g.z0+z/1000:z,yy=g===Gm.left?g.y1-y/1000:y;tube([BX,yy,zz],[BX-.07,yy+.012,zz],.011,.011,WOOD,[0,0],10)}
  for(const b of g.belts){let zz,yt,yb,c;if(g===Gm.left){zz=g.z0+b[0]/1000;yt=g.y1-b[1]/1000;yb=g.y1-b[2]/1000;c=b[3]}else{[zz,yt,yb,c]=b}
   bar((p,n)=>[p,n],[BX-.012,yt,zz],[BX-.006,yb,zz],[0,0,1],.035,.0045,c,LEA);
   for(const sz of [-1,1])bar((p,n)=>[p,n],[BX-.0145,yt-.02,zz+sz*.013],[BX-.0085,yb+.02,zz+sz*.013],[0,0,1],.0012,.0005,c.map(v=>v*2.2+.08),LEA);
   if(R.L_htag&&g===Gm.left&&b[0]!==1025){const ty=yt-.17;box(F(BX-.02,zz+.004,-A),[0,ty,0],.042,.075,.0015,{f:'L_htag',s:'c_white'})}}
  for(const st of (g.straps||[]))bar((p,n)=>[p,n],[BX-.06,st[0][1],st[0][0]],[BX-.03,st[1][1],st[1][0]],[1,0,0],.022,.003,[.05,.05,.06],LEA)}
 // printed matter: signs, cards, price labels (thin boards, leaning back by t)
 for(const p of J.PR){if(!p.d)continue;const T=F(p.x,(p.z0+p.z1)/2,-A,p.t||0,p.y0);box(T,[0,0,0],p.z1-p.z0,p.y1-p.y0,p.d,{f:p.k,s:'c_white',b:'c_white'})}
 // PROFESSIONAL cut letters
 {const L=Gm.letters,r=R.letters,x=5.43-.012,h=(L.z1-L.z0)*L.ar,P=[[x,L.y0,L.z0],[x,L.y0,L.z1],[x,L.y0+h,L.z1],[x,L.y0+h,L.z0]],U=[[r[0],r[3]],[r[2],r[3]],[r[2],r[1]],[r[0],r[1]]];
  for(const i of [0,1,2,0,2,3]){PRV.push(...P[i]);PRU.push(...U[i]);PRS.push(1)}}
 // chrome T-stands under the bags that hang on them
 for(const [z,y0,y1,dx] of Gm.stands){const x=Gm.cx+(dx||0);disc((p,n)=>[[x+p[0],y0+.004+p[2],z+p[1]],[n[0],n[2],n[1]]],[0,0,0],.07,.006,SILVER,MET,24);
  tube([x,y0,z],[x,y1,z],.007,.007,SILVER,MET,8);tube([x,y1,z-.1],[x,y1,z+.1],.006,.006,SILVER,MET,8);for(const sz of [-1,1])tube([x,y1,z+sz*.1],[x-.03,y1+.04,z+sz*.12],.005,.005,SILVER,MET,6)}
 // ---- ladder shelf, all levels laid out from the frontal store photo (positions/sizes measured in build.py).
 //      Bags that read as boxes are solid boxes with their straightened photo faces; straps, handles, chrome
 //      stands and log slices are real geometry, so nothing is see-through and no cut-out edge is visible.
 if(Gm.q){const Q=Gm.q,X=Q.cx,LV=Q.LV,SV=SILVER,BLK=[.075,.075,.08];
  const bx=(k,b,x,z,y,w,h,d,yaw=0,tilt=0,sd='c_lea')=>box(F(x,z,-A+yaw,tilt,y),[0,0,0],w,h,d,{f:k,b:b||sd,s:sd,t:sd,d:'c_lea2'});
  const cr=(P,n)=>{const R=[P[0],...P,P[P.length-1]],O=[];for(let i=1;i<R.length-2;i++)for(let k=0;k<n;k++){const t=k/n,t2=t*t,t3=t2*t;
    O.push([0,1,2].map(c=>.5*(2*R[i][c]+(-R[i-1][c]+R[i+1][c])*t+(2*R[i-1][c]-5*R[i][c]+4*R[i+1][c]-R[i+2][c])*t2+(-R[i-1][c]+3*R[i][c]-3*R[i+1][c]+R[i+2][c])*t3)))}O.push(P[P.length-1]);return O};
  const strap=(P,wid,thk,col)=>{const n=P.length,W=[],T=[];   // continuous ribbon: neighbouring segments share their cross-sections
   for(let i=0;i<n;i++){const a=P[Math.max(0,i-1)],b=P[Math.min(n-1,i+1)],tg=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],w=n3([0,tg[2],-tg[1]]);W.push(w.map(v=>v*wid/2));T.push(n3(crs(tg,w)).map(v=>v*thk))}
   const o=(p,w,t,s)=>p.map((v,c)=>v+s*w[c]-t[c]/2);
   for(let i=0;i<n-1;i++){const t=T[i].map((v,c)=>(v+T[i+1][c])/2);prism((p,nn)=>[p,nn],[o(P[i],W[i],t,-1),o(P[i],W[i],t,1),o(P[i+1],W[i+1],t,1),o(P[i+1],W[i+1],t,-1)],t,col,LEA)}};
  const dsk=(x,y,z,r,h,col,mat,N=28)=>disc((p,n)=>[[x+p[0],y+p[2],z+p[1]],[n[0],n[2],n[1]]],[0,0,0],r,h,col,mat,N);
  // wire display stand: round base, pole, M-shaped top with two ball-tipped hooks
  const stand=(px,pz,Y,y1)=>{dsk(px,Y+.002,pz,.065,.007,SV,MET);tube([px,Y,pz],[px,y1,pz],.0055,.0055,SV,MET,10);
   tube([px,y1,pz-.11],[px,y1+.016,pz],.004,.004,SV,MET,6);tube([px,y1+.016,pz],[px,y1,pz+.11],.004,.004,SV,MET,6);
   for(const sz of [-1,1]){tube([px,y1,pz+sz*.11],[px-.004,y1+.03,pz+sz*.12],.0035,.0035,SV,MET,6);dsk(px-.004,y1+.03,pz+sz*.12,.007,.008,SV,MET,10)}};
  const log=(x,z,Y,r,h)=>{dsk(x,Y,z,r,h,[.36,.25,.17],LEA);dsk(x,Y+h,z,r*.9,.0015,[.74,.58,.40],LEA)};
  // briefcase hanging by both handles on a stand: handle loops rise from the buckle tabs to the hook; pole hidden inside the bag
  const hang=(fk,bk,cx,[zc,w,y0,h],d,apex,tabs,col,Y)=>{const top=y0+h;bx(fk,bk,cx,zc,y0,w,h,d);stand(cx,zc,Y,apex+.012);
   for(const sg of [-1,1]){const P=[];for(let i=0;i<=28;i++){const t=i/28*Math.PI,sn=Math.sin(t);
     P.push([cx+sg*(d/2+.0035)*(1-.92*Math.pow(sn,1.4)),top-.04+(apex-top+.04)*sn,zc+(tabs[0]+tabs[1])/2-(tabs[1]-tabs[0])/2*Math.cos(t)])}strap(P,.026,.0035,col)}};
  // shoulder bag on a stand: strap from both side rings over the top of the stand
  const sling=(fk,bk,[zc,w,y0,h],d,y1,px,pz,col,Y,wid=.032)=>{const cx=px-d/2-.012,top=y0+h;stand(px,pz,Y,y1);bx(fk,bk,cx,zc,y0,w,h,d);
   strap(cr([[cx,top-.012,zc-w/2-.004],[cx+.008,top+.05,zc-w/2+.004],[px-.006,y1-.005,pz-.1],[px-.006,y1+.026,pz-.05],[px-.006,y1+.032,pz],[px-.006,y1+.026,pz+.05],[px-.006,y1-.005,pz+.1],[cx+.008,top+.05,zc+w/2-.004],[cx,top-.012,zc+w/2+.004]],8),wid,.004,col)};
  // level 2: brown BAB50506 hanging (back), brown BAB50507 on a log (front), brown sling with its tan strap, sign card
  hang('F_brL',0,X+.1,Q.brL,.1,Q.brL_apex,Q.brL_tabs,[.42,.26,.15],LV[2]);
  {const [lz,lh]=Q.brM_log;log(X-.06,lz,LV[2],.07,lh);const b=Q.brM.slice();b[2]=LV[2]+lh+.0015;bx('F_brM',0,X-.06,b[0],b[2],b[1],b[3],.09)}
  sling('F_sl',0,Q.sl2,.065,Q.sl2_top,X+.09,Q.sl2_pole,[.40,.25,.14],LV[2],.045);
  {const [zc,w,y0,h]=Q.card;box(F(X-.14,zc,-A,.18,LV[2]),[0,0,0],w,h,.006,{f:'F_card',s:'c_white',b:'c_white'});box(F(X-.12,zc,-A,0,LV[2]),[0,0,.01],w*.9,.02,.04,{s:'c_wood'})}
  // level 1: black messenger on its stand, navy backpack on a log, ID-holder stand
  sling('F_msg',0,Q.msg,.09,Q.msg_top,X+.06,Q.msg_pole,BLK,LV[1],.036);
  log(X-.03,Q.bp_log[0],LV[1],.075,Q.bp_log[1]);
  stand(X+.12,Q.id_pole[0],LV[1],Q.id_pole[1]);
  // level 0: black BAB50506 hanging, black BAB50507 on a log, black sling, JWC50354 long wallets on metal label plates
  hang('B_6f','B_6b',X+.1,Q.bL,.1,Q.bL_apex,[-.079,.079],BLK,LV[0]);
  {const [lz,lh]=Q.bM_log;log(X-.06,lz,LV[0],.075,lh);const b=Q.bM.slice();bx('B_7f','B_7b',X-.06,b[0],LV[0]+lh+.0015,b[1],b[3],.09)}
  sling('B_sl',0,Q.sl0,.06,Q.sl0_top,X+.08,Q.sl0_pole,BLK,LV[0]);
  Q.wl.forEach(([zc,w],i)=>{const k=i?'B_wlB':'B_wlK',sd=i?'c_wbrn':'c_wblk',W=.2,H=.1,D=.024,cx=X-.1+i*.03,yw=i?.12:-.14;
   bx(k,k,cx,zc,LV[0],W,H,D,yw,.12,sd);box(F(cx,zc,-A+yw,0,LV[0]),[0,0,D/2+.018],.07,.024,.004,{s:'c_metal'})})}
 for(const P of J.P)infl(P);
 return true}
function profZone(){
const W=5.43,G=1.12,ZP=-1.85,Z=u=>ZP+u*G,id=(p,n)=>[p,n];const PRO=window.JS_PRO&&proItems();
// ---- wall photo
{const m=SP.pf_wall;if(m&&!PRO)sprite(W-.006,Z((m.u0+m.u1)/2),(m.u1-m.u0)*G/2,(m.v0+.13)*G,(m.v1+.13)*G,'pf_wall',.76,false);}
// ---- tall ladder shelf: 1.23 u wide, 0.45 u deep, left side is a ladder with an angled top
const SW=1.23*G,SD=.45*G,zl=Z(-2.56),zr=zl+SW,xf=W-SD,xb=W-.03,post=(x,z,y0,y1)=>box(x,(y0+y1)/2,z,.04,y1-y0,.04,'metal',1);
const top=3.58*G,LV=[.14,1.11,2.03,2.75].map(v=>v*G);
post(xf,zl,0,top-.25);post(xb,zl,0,top);line3([xf,top-.25,zl],[xf+.18,top,zl],.04,'metal');line3([xf+.18,top,zl],[xb,top,zl],.04,'metal');
post(xf,zr,0,top);post(xb,zr,0,top);box((xf+xb)/2,top,zr,SD,.04,.04,'metal',1);
for(let y=.33;y<top-.3;y+=.33)box((xf+xb)/2,y,zl,SD,.035,.035,'metal',1);
box((xf+xb)/2,.06,zr,SD,.04,.04,'metal',1);
for(const y of LV){box((xf+xb)/2,y-.015,(zl+zr)/2,SD-.02,.03,SW-.03,'birch',1.1);if(y>1)box(xf+.06,y-.034,(zl+zr)/2,.02,.008,SW-.1,'white',1.6)}
for(const [y0,y1] of [[LV[0],LV[1]],[LV[1],LV[2]]]){line3([xb-.01,y0+.03,zl+.03],[xb-.01,y1-.03,zr-.03],.014,'metal');line3([xb-.01,y1-.03,zl+.03],[xb-.01,y0+.03,zr-.03],.014,'metal')}
// products (cards face the viewer like the other shelves); chrome poles under the hanging pieces
const xc=xf+SD*.48;
if(!PRO)for(const k of ['pf_bp_black','pf_bp_blue','pf_bp_brown','pf_bag_l','pf_bag_m','pf_bag_r','pf_hang','pf_tags','pf_bp_navy','pf_wallets3','pf_poster','pf_belts','pf_bags4','pf_books','pf_wallets4']){
 const m=SP[k];if(!m)continue;const zc=zl+m.z*G,y0=m.y*G;sprite(xc,zc,m.w*G/2,y0,y0+m.h*G,k,1.05,true);}
for(const [k,lv] of [['pf_bag_r',2],['pf_hang',1],['pf_tags',1]]){const m=SP[k];if(!m||PRO)continue;const zc=zl+m.z*G;box(xc+.05,(LV[lv]+m.y*G+.05)/2,zc,.012,m.y*G+.05-LV[lv],.012,'white',.95);box(xc+.05,LV[lv]+.004,zc,.14,.008,.14,'metal',1.3)}
{const m=SP.pf_poster;if(m&&!PRO)box(xc+.06,(LV[1]+m.y*G)/2,zl+m.z*G,.16,m.y*G-LV[1],m.w*G*.8,'metal',.75);}
// ---- mannequins (cut out of the photos; base on the floor, facing the room)
for(const [k,u,d] of [['pf_mq_lanyard',-.9,.55],['pf_mq_suit',-.21,.62]]){const m=SP[k];if(m&&!PRO)sprite(W-d*G,Z(u),m.w*G/2,0,m.h*G,k,1.0,true)}
}
// URBAN CARRY zone (right wall, after Professional), rebuilt from the store photos (same units as
// profZone). Left: the open ladder frame in front of the URBAN CARRY lettering and poster, with one
// shelf and a hanging rail. Right: the big two-bay ladder shelf. Products are cut out of the photos.
function ladderSide(xf,xb,z,top,angled,dir){const post=(x,h)=>box(x,h/2,z,.04,h,.04,'metal',1);
 if(angled){post(xf,top-.28);post(xb,top);line3([xf,top-.28,z],[xf+.2,top,z],.04,'metal');line3([xf+.2,top,z],[xb,top,z],.04,'metal')}
 else{post(xf,top);post(xb,top);box((xf+xb)/2,top,z,xb-xf,.04,.04,'metal',1)}
 for(let y=.3;y<top-.32;y+=.3)box((xf+xb)/2,y,z,xb-xf,.035,.035,'metal',1)}

// URBAN CARRY products as solid 3D pieces: each product's silhouette (from the store photo) is
// extruded to its real depth with a rounded, bulging edge band; the photo is its front face, the
// mirrored photo its back, the band its own leather colour (atlas assets/urban-data.js).
var UCV=[],UCU=[],UCS=[],ucMesh=null,ucTex=null;
function ucPiece(P,R,xf,zc,y0,G,d){const w=P.w*G,h=P.h*G,c=P.c,n=c.length,r=R[P.id],rb=R[P.bk||P.id],sw=R[P.sw||'sw_'+P.id],bul=Math.min(.014,d*.16),K=6;
 const W=(u,v,t)=>[xf+.05+d/2-t,y0+v,zc+u];          // u -> +z (viewer's right), v up, t toward the room (-x)
 let ar=0;for(let i=0;i<n;i++){const a=c[i],b=c[(i+1)%n];ar+=a[0]*b[1]-b[0]*a[1]}const sg=ar>0?1:-1;
 const pu=i=>(c[i][0]-.5)*w,pv=i=>c[i][1]*h;
 const nrm=c.map((p,i)=>{const a=c[(i-1+n)%n],b=c[(i+1)%n],dx=(b[0]-a[0])*w,dy=(b[1]-a[1])*h,l=Math.hypot(dx,dy)||1;return [sg*dy/l,-sg*dx/l]});
 const push=(p,uv,shd)=>{UCV.push(...p);UCU.push(...uv);UCS.push(shd)};
 const sU=(sw[0]+sw[2])/2,sV=(sw[1]+sw[3])/2;
 for(let k=0;k<K;k++){const t0=k/K*Math.PI,t1=(k+1)/K*Math.PI;
  for(let i=0;i<n;i++){const j=(i+1)%n,V=(q,t)=>{const o=bul*Math.sin(t);return W(pu(q)+nrm[q][0]*o,pv(q)+nrm[q][1]*o,d/2*Math.cos(t))},
    S=(q,t)=>{const ny=nrm[q][1]*Math.sin(t),nt=Math.cos(t);return Math.max(.35,.62+.26*ny+.16*nt)};
   const quad=[[i,t0],[j,t0],[j,t1],[i,t1]];for(const ix of [0,1,2,0,2,3]){const [q,t]=quad[ix];push(V(q,t),[sU,sV],S(q,t))}}}
 // front (photo, alpha-cut) and back (mirrored photo)
 const F=[[-w/2,0],[w/2,0],[w/2,h],[-w/2,h]],UVf=[[r[0],r[3]],[r[2],r[3]],[r[2],r[1]],[r[0],r[1]]];
 for(const ix of [0,1,2,0,2,3])push(W(F[ix][0],F[ix][1],d/2+.0005),UVf[ix],1.02);
 const UVb=[[rb[2],rb[3]],[rb[0],rb[3]],[rb[0],rb[1]],[rb[2],rb[1]]];
 for(const ix of [0,2,1,0,3,2])push(W(F[ix][0],F[ix][1],-d/2-.0005),UVb[ix],.72)}
// inflated product body: depth field F (fraction of d/2 at each grid point) -> rounded front and back
// surfaces that meet at the product's silhouette; front/back photos projected straight on.
function ucInflate(P,R,Fd,xf,zc,y0,G,d){const w=P.w*G,h=P.h*G,gw=Fd.gw,gh=Fd.gh,r=R[P.id],rb=R[P.bk||P.id];
 const raw=atob(Fd.f),f=new Float32Array(raw.length);for(let i=0;i<raw.length;i++)f[i]=raw.charCodeAt(i)/255;
 const F=(i,j)=>f[Math.max(0,Math.min(gh,j))*(gw+1)+Math.max(0,Math.min(gw,i))],du=w/gw,dv=h/gh,hd=d/2;
 const W=(u,v,t)=>[xf+.05+hd-t,y0+v,zc+u];
 for(const sg of [1,-1]){
  const vert=(i,j)=>{const t=sg*F(i,j)*hd,gx=(F(i+1,j)-F(i-1,j))*hd/(2*du),gy=-(F(i,j+1)-F(i,j-1))*hd/(2*dv),l=Math.hypot(gx,gy,1),
    nu=-gx/l,nv=-gy/l,nt=1/l,shd=Math.max(.35,(.6+.24*nv+.2*nt-.05*nu*sg)*(sg>0?1:.8));
    const uv=sg>0?[r[0]+(r[2]-r[0])*i/gw,r[1]+(r[3]-r[1])*j/gh]:[rb[2]-(rb[2]-rb[0])*i/gw,rb[1]+(rb[3]-rb[1])*j/gh];
    return [W((i/gw-.5)*w,(1-j/gh)*h,t),uv,shd]};
  for(let j=0;j<gh;j++)for(let i=0;i<gw;i++){if(F(i,j)+F(i+1,j)+F(i,j+1)+F(i+1,j+1)===0)continue;
   const q=[vert(i,j),vert(i+1,j),vert(i+1,j+1),vert(i,j+1)],ord=sg>0?[0,1,2,0,2,3]:[0,2,1,0,3,2];
   for(const k of ord){UCV.push(...q[k][0]);UCU.push(...q[k][1]);UCS.push(q[k][2])}}}}
function ucItems(Z0,sl,xf,G){const J=window.JS_UC;if(!J)return false;
 const DEP={uf_coffee:.035,uf_card:.03,uf_duffel:.2,uf_bags:.13,uf_hangL:.1,uf_hangR:.11};
 for(const P of J.P){const shelf=P.kind==='shelf',w=P.w*G,d=P.d||DEP[P.kind]||Math.max(.05,Math.min(.17,w*.42));
  const zc=shelf?sl+P.z*G:Z0+P.z*G,x=P.kind.startsWith('uf_hang')?xf+.12-.05-d/2:xf;
  if(J.F&&J.F[P.id])ucInflate(P,J.R,J.F[P.id],x,zc,P.y*G,G,d);else ucPiece(P,J.R,x,zc,P.y*G,G,d);
  if(P.pid==='duf'){const sx=xf+.05+d/2,y0=1.62*G,y1=P.y*G;                 // chrome duffel stand: round base, pole, T-cradle
   for(let i=0;i<20;i++){const a0=i/20*6.283,a1=(i+1)/20*6.283;tube([sx+Math.cos(a0)*.075,y0+.004,zc+Math.sin(a0)*.075],[sx+Math.cos(a1)*.075,y0+.004,zc+Math.sin(a1)*.075],.006,.006,SILVER,MET,6)}
   tube([sx,y0+.004,zc],[sx,y1+.02,zc],.007,.007,SILVER,MET,8);tube([sx,y1+.02,zc-.09],[sx,y1+.02,zc+.09],.006,.006,SILVER,MET,8)}}
 return true}
function urbanZone(){
const W=5.43,G=1.12,Z0=-1.85+1.22*G,Z=u=>Z0+u*G,D=.45*G,xf=W-D,xb=W-.03,xm=(xf+xb)/2;
const card=(k,x,turn=true)=>{const m=SP[k];if(m)sprite(x,Z(m.z0!==undefined?0:m.z),m.w*G/2,m.y*G,(m.y+m.h)*G,k,1.05,turn)};
// ---- wall: lettering + poster (photo, above the frame's shelf)
// URBAN CARRY cut letters and the framed poster, straightened from the store photo (atlas urban-data.js)
if(window.JS_UC&&window.JS_UC.R.uc_letters){const R=window.JS_UC.R,zc0=Z(.705),qd=(x,y0,y1,z0,z1,k,sh)=>{const r=R[k],P=[[x,y0,z0],[x,y0,z1],[x,y1,z1],[x,y1,z0]],U=[[r[0],r[3]],[r[2],r[3]],[r[2],r[1]],[r[0],r[1]]];for(const i of [0,1,2,0,2,3]){UCV.push(...P[i]);UCU.push(...U[i]);UCS.push(sh)}};
 const LW=.92,LH=LW*296/1814,LY=3.2;qd(W-.01,LY,LY+LH,zc0-LW/2,zc0+LW/2,'uc_letters',1.0);
 const FW=.74,FH=1.03,FY=1.92,FZ=zc0,FB=.022,FD=.025;box(W-FD/2-.002,FY+FH/2,FZ,FD,FH,FW,'metal',.55);
 qd(W-FD-.003,FY+FB,FY+FH-FB,FZ-FW/2+FB,FZ+FW/2-FB,'uc_poster',1.0)}
else{const m=SP.uw_wall;if(m)sprite(W-.006,Z((m.u0+m.u1)/2),(m.u1-m.u0)*G/2,m.v0*G,m.v1*G,'uw_wall',.76,false);}
// ---- open ladder frame: two ladder sides, one shelf with LED strip, hanging rail
// its right side is the big shelf's left ladder (shared, as in the store)
const fl=Z(0.0),fr=Z(1.41),ftop=3.4*G,SV=1.62*G,RV=1.36*G;
ladderSide(xf,xb,fl,ftop,true);
box(xm,SV-.015,(fl+fr)/2,D-.02,.03,fr-fl-.03,'birch',1.1);box(xf+.06,SV-.034,(fl+fr)/2,.02,.008,fr-fl-.1,'cream',2.0);
box(xf+.12,RV,(fl+fr)/2,.035,.035,fr-fl,'metal',1);
const UC=window.JS_UC&&ucItems(Z0,Z(1.41),xf,G);
if(!UC)for(const k of ['uf_coffee','uf_duffel','uf_card','uf_bags'])card(k,xm-.02);
for(const k of ['uf_hangL','uf_hangR']){const m=SP[k];if(!m)continue;const zc=Z(m.z);if(!UC)sprite(xf+.12,zc,m.w*G/2,m.y*G,(m.y+m.h)*G,k,1.05,false);
 box(xf+.12,RV-.02,zc,.03,.05,.025,'metal',1);
 if(UC){const ps=window.JS_UC.P.filter(P=>P.kind===k).sort((a,b)=>b.w*b.h-a.w*a.h),P=ps[0];if(P){const bz=Z0+P.z*G,ty=(P.y+P.h)*G-.015,hw=P.w*G*.36;
  for(const dz of [-hw,hw])line3([xf+.12,ty,bz+dz],[xf+.12,RV-.03,zc],.01,'metal')}}
 else if(k==='uf_hangR'){const ty=(m.y+m.h)*G-.02;for(const dz of [-.12,.12])line3([xf+.12,ty,zc+dz*G],[xf+.12,RV-.03,zc],.012,'metal')}}
// ---- big two-bay ladder shelf (image 2): 2 x 1.22 u bays, 5 levels, X bracing, LED strips
const sl=Z(1.41),BW=1.22*G,sr=sl+2*BW,top=3.36*G,LV=[.11,.58,1.28,1.94,2.62].map(v=>v*G);
ladderSide(xf,xb,sl,top,true);ladderSide(xf,xb,sr,top,true);
box(xf,top/2,sl+BW,.04,top,.04,'metal',1);box(xb,top/2,sl+BW,.04,top,.04,'metal',1);box(xm,top,sl+BW,D,.04,.04,'metal',1);
for(let b=0;b<2;b++){const zc=sl+BW*(b+.5);for(const y of LV){box(xm,y-.015,zc,D-.02,.03,BW-.03,'birch',1.1);if(y>.5)box(xf+.06,y-.034,zc,.02,.008,BW-.1,'cream',2.0)}}
for(const [b,y0,y1] of [[0,LV[1],LV[2]],[1,LV[2],LV[3]]]){const z0=sl+BW*b+.03,z1=sl+BW*(b+1)-.03;line3([xb-.01,y0+.03,z0],[xb-.01,y1-.03,z1],.014,'metal');line3([xb-.01,y1-.03,z0],[xb-.01,y0+.03,z1],.014,'metal')}
if(!UC)for(const [k,m] of Object.entries(SP)){if(!k.startsWith('ub_'))continue;const zc=sl+(m.z-0.0)*G*(2*BW/(2*1.22*G));sprite(xf+D*.48,zc,m.w*G/2,m.y*G,(m.y+m.h)*G,k,1.05,true)}
}
// CRAFT INNOVATIVE: the MagWallet display near the entrance and the chrome sign stand beside it,
// rebuilt from the store photos (white plinth, black tray with light strip, backboard with the
// three wallets, CRAFT INNOVATIVE poster on a two-arm chrome stand). S = room scale.
function craftInnovative(cx,cz){
 const S=1.3,PW=.45*S,PD=.36*S,PH=.92*S,TW=.55*S,TD=.42*S,BW=.49*S,BH=BW*SP.ci_board.aspect,F=cz+PD/2;
 // plinth (white), its front panel lettering is the photo
 box(cx,PH/2,cz,PW,PH,PD,'white',.97);
 photoQuad('ci_plinth',[[cx-PW/2,.004,F+.002],[cx+PW/2,.004,F+.002],[cx+PW/2,PH,F+.002],[cx-PW/2,PH,F+.002]],1.0);
 // tray: thin black band, white light strip, black top slab
 const tz=cz+.02*S,y1=PH+.014*S,y2=y1+.011*S,y3=y2+.028*S;
 box(cx,PH+.007*S,tz,TW-.01*S,.014*S,TD-.01*S,'metal',1);box(cx,(y1+y2)/2,tz,TW-.004*S,.011*S,TD-.004*S,'white',1.35);box(cx,(y2+y3)/2,tz,TW,.028*S,TD,'metal',1.1);
 const tf=tz+TD/2,tb=tz-TD/2+.03*S,ty=y3+.002;
 photoQuad('ci_tray',[[cx-TW/2+.004,ty,tf-.004],[cx+TW/2-.004,ty,tf-.004],[cx+TW/2-.004,ty,tb+.10*S],[cx-TW/2+.004,ty,tb+.10*S]],1.15);
 box(cx,ty-.001,(tb+tb+.10*S)/2,TW-.01,.002,.10*S,'metal',1);
 // backboard with the wallets (photo), a thin black panel behind it
 box(cx,ty+BH/2,tb-.006,BW,BH,.008,'metal',1);
 photoQuad('ci_board',[[cx-BW/2,ty,tb],[cx+BW/2,ty,tb],[cx+BW/2,ty+BH,tb],[cx-BW/2,ty+BH,tb]],1.15);
 // chrome sign stand on the left: rounded base plate, pole, two arms, poster clipped to the top arm
 const sx=cx-.6*S,sz=cz-.03*S,ST=1.5*S,AR=.37*S,ch='white';
 box(sx,.008,sz,.36*S,.016,.30*S,ch,.82);box(sx,.018,sz,.33*S,.006,.27*S,ch,1.05);
 box(sx,ST/2,sz,.03,ST,.03,ch,.9);box(sx,ST-.12*S,sz,.045,.03,.045,ch,.75);
 for(const ay of [ST-.04*S,.88*S]){box(sx+AR/2,ay,sz,AR,.024,.024,ch,.92);box(sx+AR+.006,ay,sz,.03,.03,.03,'metal',1)}
 const pw=.22*S,ph=pw*SP.ci_poster.aspect,px=sx+.03+pw/2+.03*S,ptop=ST-.04*S-.05*S;
 box(px,ptop-ph/2,sz+.002,pw,ph,.004,'white',.95);   // poster back (plain white)
 photoQuad('ci_poster',[[px-pw/2,ptop-ph,sz+.006],[px+pw/2,ptop-ph,sz+.006],[px+pw/2,ptop,sz+.006],[px-pw/2,ptop,sz+.006]],1.12);
 for(const dx of [-pw*.3,pw*.3]){box(px+dx,ptop+.025*S,sz+.006,.008,.05*S,.006,ch,.8);box(px+dx,ptop+.002,sz+.006,.025,.02,.012,ch,.95)}
}
// CRAFT HERITAGE: the long walnut table with black U-frame legs, rebuilt from the store photos.
// As in the store it stands lengthways (long side along the room); its display side faces the
// right-hand wall (+x), so from the entrance you see its end. The table top is the straightened
// photo of the top; everything standing on it is cut out of the same photo and set at its own depth.
// generic textured-mesh builder (same helpers as the gift table) writing into V/U/S with atlas rects R
function mkTM(R,V,U,S,cx,cz,yT){
 const uvq=k=>{const r=R[k]||R.c_white;return [[r[0],r[3]],[r[2],r[3]],[r[2],r[1]],[r[0],r[1]]]};
 const tri=(P,T,sh)=>{for(const i of [0,1,2,0,2,3]){V.push(...P[i]);U.push(...T[i]);S.push(sh)}};
 const q=(a,b,c,d,k,sh=1)=>tri([a,b,c,d],uvq(k),sh);
 const F=(x,z,yaw=0,tilt=0,y0=0)=>{const cy=Math.cos(yaw),sy=Math.sin(yaw),ct=Math.cos(tilt),st=Math.sin(tilt);
  return p=>{const y1=p[1]*ct+p[2]*st,z1=-p[1]*st+p[2]*ct,x1=p[0];return [cx+x+x1*cy+z1*sy,yT+y0+y1,cz+z-x1*sy+z1*cy]}};
 const box=(T,o,w,h,d,fc)=>{const X=[o[0]-w/2,o[0]+w/2],Y=[o[1],o[1]+h],Z=[o[2]-d/2,o[2]+d/2],P=(i,j,k)=>T([X[i],Y[j],Z[k]]),g=k=>fc[k]||fc.s||'c_white';
  q(P(0,0,1),P(1,0,1),P(1,1,1),P(0,1,1),g('f'),.97);q(P(1,0,0),P(0,0,0),P(0,1,0),P(1,1,0),g('b'),.74);
  q(P(0,0,0),P(0,0,1),P(0,1,1),P(0,1,0),g('l'),.82);q(P(1,0,1),P(1,0,0),P(1,1,0),P(1,1,1),g('r'),.82);
  q(P(0,1,1),P(1,1,1),P(1,1,0),P(0,1,0),g('t'),1.04);q(P(0,0,0),P(1,0,0),P(1,0,1),P(0,0,1),g('d'),.6)};
 const cone=(T,a,b,r0,r1,side,N=14,sh0=.72)=>{const d=b.map((v,i)=>v-a[i]),L=Math.hypot(...d),n=d.map(v=>v/L),u=Math.abs(n[1])<.9?[0,1,0]:[1,0,0];
  let e1=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];const l1=Math.hypot(...e1);e1=e1.map(v=>v/l1);const e2=[n[1]*e1[2]-n[2]*e1[1],n[2]*e1[0]-n[0]*e1[2],n[0]*e1[1]-n[1]*e1[0]];
  const ring=(c,r,t)=>c.map((v,i)=>v+r*(Math.cos(t)*e1[i]+Math.sin(t)*e2[i]));
  for(let i=0;i<N;i++){const t0=i/N*6.2832,t1=(i+1)/N*6.2832,sh=sh0+.3*Math.max(0,Math.sin((t0+t1)/2)*.8+.2);q(T(ring(a,r0,t0)),T(ring(a,r0,t1)),T(ring(b,r1,t1)),T(ring(b,r1,t0)),side,sh)}};
 const cyl=(T,a,b,r,side,N=14)=>cone(T,a,b,r,r,side,N);
 const disc=(c,r,ex,ey,k,sh=1.04,N=28)=>{const rc=R[k],cu=(rc[0]+rc[2])/2,cv=(rc[1]+rc[3])/2,hu=(rc[2]-rc[0])/2,hv=(rc[3]-rc[1])/2;
  for(let i=0;i<N;i++){const t0=i/N*6.2832,t1=(i+1)/N*6.2832,pt=t=>c.map((v,j)=>v+r*(Math.cos(t)*ex[j]+Math.sin(t)*ey[j]));
   for(const [P,W] of [[c,[cu,cv]],[pt(t0),[cu+Math.cos(t0)*hu,cv-Math.sin(t0)*hv]],[pt(t1),[cu+Math.cos(t1)*hu,cv-Math.sin(t1)*hv]]]){V.push(...P);U.push(...W);S.push(sh)}}};
 const path=(T,pts,r,k,N=6)=>{for(let i=0;i+1<pts.length;i++)cyl(T,pts[i],pts[i+1],r,k,N)};
 return {q,tri,F,box,cone,cyl,disc,path,I:F(0,0)}}
var CHV=[],CHU=[],CHS=[],chMesh=null,chTex=null;
// CRAFT HERITAGE contents modelled in 3D (no photo cut-outs): leather goods are shaded leather geometry
// (rounded bodies, pockets, zips, stitching, straps, buckles, logo studs); only printed matter (signs,
// cards, badges) carries a print, and the log slices their wood. +x = display side, +z = entrance end.
function heritageItems(cx,cz,yT,L,DP){const R=window.JS_CH,{q,tri,F,box,cyl,disc:tdisc,I}=mkTM(R,CHV,CHU,CHS,cx,cz,yT);
 const A=Math.PI/2,LE=()=>LEA,ME=()=>MET;
 // Live-edge timber slab: a continuous top grain and gently irregular solid edge.
 const edge=z=>DP/2+.009*Math.sin(z*6)+.005*Math.sin(z*15);
 const wood=R.timber;
 for(let j=0;j<64;j++){const z0=-L/2+j*L/64,z1=z0+L/64;
  for(let k=0;k<8;k++){const f0=-1+k/4,f1=f0+.25,points=[[edge(z0)*f0,0,z0],[edge(z1)*f0,0,z1],[edge(z1)*f1,0,z1], [edge(z0)*f1,0,z0]],u0=(j%16)/16,u1=u0+1/16,v0=(k%4)/4,v1=v0+1/4;
   const uv=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>[wood[0]+(wood[2]-wood[0])*u,wood[1]+(wood[3]-wood[1])*v*.69]);tri(points.map(I),uv,1);
  }
  for(const sg of [-1,1])q(I([sg*edge(z0),-.057,z0]),I([sg*edge(z1),-.057,z1]),I([sg*edge(z1),0,z1]),I([sg*edge(z0),0,z0]),'c_oakc',.84);
 }for(const sg of [-1,1])q(I([-DP/2,-.057,sg*L/2]),I([DP/2,-.057,sg*L/2]),I([DP/2,0,sg*L/2]),I([-DP/2,0,sg*L/2]),'timber',.8);
 // ---- lit geometry helpers: local u across, v up, w towards the front; yaw turns the front (w) to world ----
 const T=(x,z,yaw=0,y0=0,tilt=0)=>{const c=Math.cos(yaw),s=Math.sin(yaw),ct=Math.cos(tilt),st=Math.sin(tilt),
   r=p=>{const v=p[1]*ct-p[2]*st,w=p[1]*st+p[2]*ct;return [p[0]*c+w*s,v,-p[0]*s+w*c]};
   return (p,n)=>{const P=r(p),N=r(n);return [[cx+x+P[0],yT+y0+P[1],cz+z+P[2]],N]}};
 const W0=(p,n)=>[[cx+p[0],yT+p[1],cz+p[2]],n];
 const sh=(c,k)=>c.map(v=>Math.min(1,v*k));
 const ln=(t,a,b,wd,th,col,mat=LEA,up=[0,0,1])=>bar(t,a,b,up,wd,th,col,mat);
 const tb=(t,pts,r,col,mat=LEA,N=8)=>{for(let i=0;i+1<pts.length;i++){const a=t(pts[i],[0,1,0])[0],b=t(pts[i+1],[0,1,0])[0];tube(a,b,r,r,col,mat,N)}};
 const stitchRect=(t,u0,u1,v0,v1,w,col)=>{for(const [a,b] of [[[u0,v0,w],[u1,v0,w]],[[u1,v0,w],[u1,v1,w]],[[u1,v1,w],[u0,v1,w]],[[u0,v1,w],[u0,v0,w]]])ln(t,a,b,.0018,.0006,col,LEA)};
 const logo=(t,u,v,w,r=.009)=>{disc(t,[u,v,w],r,.0012,[.12,.1,.09],MET);disc(t,[u,v,w+.0012],r*.62,.0006,sh(SILVER,.7),MET)};
 const zip=(t,u0,u1,v,w,col)=>{ln(t,[u0,v,w],[u1,v,w],.012,.0015,sh(col,.5),LEA,[0,0,1]);ln(t,[u0,v,w+.001],[u1,v,w+.001],.004,.0018,SILVER,MET,[0,0,1]);
   ln(t,[u1-.01,v,w+.003],[u1-.01,v-.03,w+.003],.008,.002,sh(col,.85),LEA,[1,0,0])};
 const topZip=(t,w,h,d,col)=>{ln(t,[-w*.42,h,0],[w*.42,h,0],.012,.0012,sh(col,.5),LEA,[0,1,0].map((_,i)=>i==2?1:0));ln(t,[-w*.42,h+.001,0],[w*.42,h+.001,0],.004,.0016,SILVER,MET,[0,0,1]);
   rbox(t,[w*.3,h+.006,0],[.008,.005,.006],.003,SILVER,ME);ln(t,[w*.3,h+.008,.004],[w*.3,h-.03,d/2+.006],.007,.002,sh(col,.85),LEA,[1,0,0])};
 const strapArc=(t,w,h,lift,col,wd=.022)=>{const P=[];for(let i=0;i<=14;i++){const a=i/14*Math.PI;P.push([-w/2*.92*Math.cos(a),h+lift*Math.sin(a),0])}
   for(let i=0;i+1<P.length;i++)ln(t,P[i],P[i+1],wd,.003,col,LEA,[0,0,1]);for(const sg of [-1,1]){rbox(t,[sg*w/2*.92,h+.005,0],[.006,.01,.006],.002,SILVER,ME)}};
 // leather bag: rounded body + optional front pocket / flap & buckle strap / front zip / top zip / strap / logo
 const bag=(x,z,yaw,o)=>{const {w,h,d,col}=o,t=T(x,z,yaw,o.y||0),st=o.stitch||[.78,.52,.28],F=d/2;
  rbox(t,[0,h/2,0],[w/2,h/2,d/2],o.r||.03,col,LE,[6,6,4]);
  if(o.pocket){const [pw,ph,pv]=o.pocket,pd=.022;rbox(t,[0,pv+ph/2,F+pd/2-.006],[pw/2,ph/2,pd/2],.012,sh(col,1.04),LE,[4,4,2]);stitchRect(t,-pw/2+.008,pw/2-.008,pv+.008,pv+ph-.008,F+pd-.005,st);logo(t,pw*.32,pv+ph*.25,F+pd-.005)}
  if(o.flap){const [fw,fh]=o.flap;rbox(t,[0,h-fh/2,F+.004],[fw/2,fh/2,.004],.008,sh(col,1.06),LE,[4,4,2]);stitchRect(t,-fw/2+.006,fw/2-.006,h-fh+.006,h-.006,F+.0085,st);logo(t,0,h-fh*.35,F+.009)}
  if(o.buckle){const bv=o.buckle;ln(t,[0,bv+.07,F+.012],[0,bv-.06,F+.012],.03,.004,sh(col,.95),LEA,[1,0,0]);
   const bw=.032,bh=.026;for(const [a,b] of [[[-bw/2,bv-bh/2],[bw/2,bv-bh/2]],[[bw/2,bv-bh/2],[bw/2,bv+bh/2]],[[bw/2,bv+bh/2],[-bw/2,bv+bh/2]],[[-bw/2,bv+bh/2],[-bw/2,bv-bh/2]]])tube(t([a[0],a[1],F+.016],[0,0,1])[0],t([b[0],b[1],F+.016],[0,0,1])[0],.0022,.0022,o.brass?[.66,.55,.3]:SILVER,MET,6);
   ln(t,[0,bv-bh/2,F+.017],[0,bv+bh/2,F+.017],.003,.002,SILVER,MET,[1,0,0]);disc(t,[0,bv+.05,F+.016],.004,.002,SILVER,MET)}
  if(o.fzip)zip(t,-w*.36,w*.36,o.fzip,F+.001,col);
  if(o.tzip!==false)topZip(t,w,h,d,col);
  if(o.strap)strapArc(t,w,h,o.strap,sh(col,.9),o.sw||.022);
  if(o.handle){const P=[];for(let i=0;i<=10;i++){const a=i/10*Math.PI;P.push([-.05*Math.cos(a),h+o.handle*Math.sin(a),0])}tb(t,P,.006,sh(col,.9))}
  if(o.logo)logo(t,o.logo[0],o.logo[1],F+.001);
  if(o.wrist){const P=[];for(let i=0;i<=8;i++){const a=i/8;P.push([w/2+.01+a*.09,h*.55-a*.11,F*.3])}tb(t,P,.005,sh(col,.9))}
  return t};

 // ---- real product bodies: the product's silhouette (rounded profile) extruded to its depth with
 //      rounded edges; front/back carry the studio product photos, the edge band its own leather ----
 const PV=(k,u,v,crop)=>{const r=R[k];if(!r)throw Error('Missing Craft Heritage texture: '+k);
  const c=crop||(k.startsWith('P_owl')?[.055,.12,.945,.98]:/P_(m_|s_|t_|w_wb)/.test(k)?[.045,.035,.955,.965]:[0,0,1,1]);
  return [r[0]+(r[2]-r[0])*(c[0]+(c[2]-c[0])*u),r[1]+(r[3]-r[1])*(c[1]+(c[3]-c[1])*(1-v))]};
 const rrect=(w,h,rt,rb,n=5)=>{const P=[],arc=(cu,cv,r,a0)=>{for(let i=0;i<=n;i++){const a=a0+i/n*Math.PI/2;P.push([cu+r*Math.cos(a),cv+r*Math.sin(a)])}};
  arc(w/2-rb,rb,rb,-Math.PI/2);arc(w/2-rt,h-rt,rt,0);arc(-w/2+rt,h-rt,rt,Math.PI/2);arc(-w/2+rb,rb,rb,Math.PI);return P};
 const dome=(w,h,sh)=>{const P=[];P.push([w/2,0]);for(let i=0;i<=12;i++){const a=i/12*Math.PI;P.push([w/2*Math.cos(a)*(1-.04*Math.sin(a)),h-sh+sh*Math.sin(a)])}P.push([-w/2,0]);return P};
 const prod=(T,prof,w,h,d,fk,bk,o={})=>{const r=Math.min(o.r||.012,d/2*.95),K=4,n=prof.length,sk=o.side||'S_'+fk.slice(2);
  const N=prof.map((p,i)=>{const a=prof[(i-1+n)%n],b=prof[(i+1)%n],e1=[p[1]-a[1],-(p[0]-a[0])],e2=[b[1]-p[1],-(b[0]-p[0])],l1=Math.hypot(...e1)||1,l2=Math.hypot(...e2)||1;
   const m=[e1[0]/l1+e2[0]/l2,e1[1]/l1+e2[1]/l2],l=Math.hypot(...m)||1;return [m[0]/l,m[1]/l]});
  const pt=(i,off,z)=>[prof[i][0]-N[i][0]*off,prof[i][1]-N[i][1]*off,z];
  const shd=(nu,nv,nw)=>.66+.22*nv+.14*nw+.06*nu;
  const put=(P,U,S)=>{for(const j of [0,1,2,0,2,3]){CHV.push(...T(P[j]));CHU.push(...U[j]);CHS.push(S[j])}};
  for(const sg of [1,-1]){const k=sg>0?fk:bk,uvp=(p)=>PV(k,sg>0?(p[0]+w/2)/w:1-(p[0]+w/2)/w,p[1]/h,o.crop);
   const ring=t=>{const th=t*Math.PI/2;return {off:r*(1-Math.cos(th)),z:sg*(d/2-r+r*Math.sin(th)),nw:Math.sin(th),nr:Math.cos(th)}};
   for(let k2=0;k2<K;k2++){const A=ring(k2/K),B=ring((k2+1)/K);
    for(let i=0;i<n;i++){const j=(i+1)%n,P=[pt(i,A.off,A.z),pt(j,A.off,A.z),pt(j,B.off,B.z),pt(i,B.off,B.z)];
     const S=[[i,A],[j,A],[j,B],[i,B]].map(([q,R0])=>shd(N[q][0]*R0.nr,N[q][1]*R0.nr,sg*R0.nw));
     const Pq=sg>0?P:[P[1],P[0],P[3],P[2]],Sq=sg>0?S:[S[1],S[0],S[3],S[2]];put(Pq,Pq.map(uvp),Sq)}}
   const c=[0,0];prof.forEach(p=>{c[0]+=p[0]/n;c[1]+=p[1]/n});const zc=sg*d/2,cc=[c[0],c[1],zc];
   for(let i=0;i<n;i++){const j=(i+1)%n,P=sg>0?[cc,pt(i,r,zc),pt(j,r,zc)]:[cc,pt(j,r,zc),pt(i,r,zc)];for(const q of P){CHV.push(...T(q));CHU.push(...uvp(q));CHS.push(shd(0,0,sg))}}}
  // edge band between the two bevels
  let acc=0;const per=prof.reduce((s0,p,i)=>s0+Math.hypot(prof[(i+1)%n][0]-p[0],prof[(i+1)%n][1]-p[1]),0);
  for(let i=0;i<n;i++){const j=(i+1)%n,L=Math.hypot(prof[j][0]-prof[i][0],prof[j][1]-prof[i][1]),u0=(acc/per*6)%1,u1=u0+L/per*6;acc+=L;
   const z0=d/2-r,P=[pt(i,0,-z0),pt(j,0,-z0),pt(j,0,z0),pt(i,0,z0)],rc=R[sk],U=[[u0,1],[u1,1],[u1,0],[u0,0]].map(([u,v])=>[rc[0]+(rc[2]-rc[0])*Math.min(1,u%1.0001),rc[1]+(rc[3]-rc[1])*v]);
   put([P[1],P[0],P[3],P[2]],[U[1],U[0],U[3],U[2]],[j,i,i,j].map(q=>shd(N[q][0],N[q][1],0)))}};
 // product placed standing (front facing yaw) or lying flat (front up)
 const stand=(x,z,yaw,y0=0)=>{const f=F(x,z,yaw,0,y0);return p=>f(p)};
 const flatT=(x,z,yaw,y0=0)=>{const f=F(x,z,yaw,0,y0);return p=>f([p[0],p[2]+0,-p[1]]).map((v,i)=>v)};
 const lie=(x,z,yaw,w,l,d,k,o={})=>{const f=F(x,z,yaw,0,d/2+(o.y||0));prod(p=>f([p[0],p[2],-(p[1]-l/2)]),rrect(w,l,o.rc||.006,o.rc||.006),w,l,d,'P_'+k,'P_'+k,{r:Math.min(.006,d/2),side:'S_'+k})};
 const webbing=(T,pts,wd,col)=>{for(let i=0;i+1<pts.length;i++){const a=T(pts[i]),b=T(pts[i+1]);bar((p,n)=>[p,n],a,b,[0,1,0],.003,wd,col,LEA)}};
 // textured strap along a path (table-local points); vert: image runs top->bottom along the path
 const strip=(pts,wd,k,acr,vert=false,rep=1,sh=1)=>{const r=R[k],L=[0];for(let i=1;i<pts.length;i++)L.push(L[i-1]+Math.hypot(...pts[i].map((v,j)=>v-pts[i-1][j])));
  const normals=pts.map((p,i)=>{const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)],d=b.map((v,j)=>v-a[j]),w=typeof acr==='function'?acr(i):acr,n=[d[1]*w[2]-d[2]*w[1],d[2]*w[0]-d[0]*w[2],d[0]*w[1]-d[1]*w[0]],len=Math.hypot(...n)||1;return n.map(v=>v/len*.001)});const tot=L[L.length-1]||1,W=p=>[cx+p[0],yT+p[1],cz+p[2]],uv=(t,s0)=>vert?[r[0]+(r[2]-r[0])*s0,r[1]+(r[3]-r[1])*t]:[r[0]+(r[2]-r[0])*((t*rep)%1.0001),r[1]+(r[3]-r[1])*s0];
  for(let i=0;i+1<pts.length;i++){const A0=typeof acr==='function'?acr(i):acr,A1=typeof acr==='function'?acr(i+1):acr,a=pts[i],b=pts[i+1],t0=L[i]/tot,t1=L[i+1]/tot;
   let u0=t0*rep,u1=t1*rep;if(!vert&&Math.floor(u0)!==Math.floor(u1-1e-6)){u0=u0%1;u1=u0+(t1-t0)*rep}
   const T0=vert?t0:u0/rep,T1=vert?t1:u1/rep;
   const P=[a.map((v,j)=>v-A0[j]*wd/2),b.map((v,j)=>v-A1[j]*wd/2),b.map((v,j)=>v+A1[j]*wd/2),a.map((v,j)=>v+A0[j]*wd/2)].map(W);
   const U=vert?[uv(t0,0),uv(t1,0),uv(t1,1),uv(t0,1)]:[[r[0]+(r[2]-r[0])*Math.min(1,u0),r[1]+(r[3]-r[1])],[r[0]+(r[2]-r[0])*Math.min(1,u1),r[1]+(r[3]-r[1])],[r[0]+(r[2]-r[0])*Math.min(1,u1),r[1]],[r[0]+(r[2]-r[0])*Math.min(1,u0),r[1]]];
   const n0=normals[i],n1=normals[i+1],ns=[n0,n1,n1,n0],front=P.map((p,j)=>p.map((v,k)=>v+ns[j][k])),back=P.map((p,j)=>p.map((v,k)=>v-ns[j][k]));tri(front,U,sh);tri(back.slice().reverse(),U.slice().reverse(),sh*.72);for(const [a,b] of [[0,1],[2,3],...(i===0?[[3,0]]:[]),...(i===pts.length-2?[[1,2]]:[])])q(front[a],back[a],back[b],front[b],'c_walnut',.65)}};
 // belt wound into a coil lying on its side (band upright): spiral from r0 inwards
 const coilT=(x,z,y0,r0,wd,turns,k,a0=0)=>{const P=[];for(let i=0;i<=turns*36;i++){const a=a0+i/36*6.2832,r=r0-i/36*.0075;P.push([x+Math.cos(a)*r,y0+wd/2,z+Math.sin(a)*r])}strip(P,wd,k,[0,1,0],false,turns*2.2,.92)};
 // belt rolled and standing on edge (roll axis along x)
 const rollT=(x,z,y0,r0,wd,turns,k)=>{const P=[];for(let i=0;i<=turns*36;i++){const a=i/36*6.2832,r=r0-i/36*.006;P.push([x,y0+r0+Math.sin(a)*r,z+Math.cos(a)*r])}strip(P,wd,k,[1,0,0],false,turns*2,.9)};
 const buckle=(t,u,v,w,bw,bh,col,th=.0032)=>{[[[-bw/2,0],[bw/2,0]],[[bw/2,0],[bw/2,bh]],[[bw/2,bh],[-bw/2,bh]],[[-bw/2,bh],[-bw/2,0]]].forEach(([p0,p1])=>tube(t([u+p0[0],v+p0[1],w],[0,0,1])[0],t([u+p1[0],v+p1[1],w],[0,0,1])[0],th,th,col,MET,6));
  tube(t([u,v,w],[0,0,1])[0],t([u,v+bh*.9,w+.004],[0,0,1])[0],th*.8,th*.8,col,MET,6)};
 const BRASS=[.68,.56,.3],GL=[.18,.09,.055],CH=[.40,.25,.145],TAN=[.62,.36,.16],DK=[.25,.20,.16];
 const print=(x,z,w,h,k,y=0,yaw=A)=>{box(F(x,z,yaw),[0,y,0],w+.025,.022,.045,{s:'c_walnut'});box(F(x,z,yaw,.08,y+.022),[0,0,0],w,h,.003,{f:k,b:k,s:'c_acrylic'})};
 const price=(x,z,k)=>print(x,z,.12,.043,k,.002);
 const plaque=(x,z,w=.14)=>{const f=F(x,z,A,-.25,.006);box(f,[0,0,0],w,.023,.006,{f:'brand',s:'c_chrome'})};
 const log=(x,z,r,h,y=0)=>{cyl(I,[x,y,z],[x,y+h,z],r,'bark_real',32);tdisc([cx+x,yT+y+h+.0007,cz+z],r,[1,0,0],[0,0,-1],'endgrain',1,48)};
 const standBag=(x,z,k,w,h,d,col,yaw=A,opt={})=>{
   const y=opt.y||.008,ft=F(x,z,yaw,0,y),t=T(x,z,yaw,y);
   prod(ft,rrect(w,h,Math.min(w*.15,.043),.025),w,h,d,'P_'+k+'_f','P_'+k+'_b',{r:.018,side:'S_'+k+'_f'});
   // The zips follow the curved top and are separate geometry on both compartments.
   for(const zz of (opt.double?[-d*.23,d*.23]:[0])){
     const path=[];for(let i=0;i<=24;i++){const u=-w*.46+i/24*w*.92;path.push([u,h-.025*Math.pow(Math.abs(u)/(w*.46),8),zz])}
     tb(t,path,.0028,[.10,.08,.065]);tb(t,path.map(p=>[p[0],p[1]+.002,p[2]]),.0011,[.63,.59,.47],MET,5);
     ln(t,[-w*.40,h-.01,zz],[-w*.43,h-.045,zz+.015],.009,.003,col,LEA,[1,0,0]);
   }
   // Side rings and the folded shoulder / wrist strap, including the return run.
   for(const sg of [-1,1]){const pp=[];for(let i=0;i<=16;i++){const a=i/16*Math.PI*2;pp.push([sg*(w/2+.003),h*.72+.012*Math.cos(a),.012*Math.sin(a)])}tb(t,pp,.002,SILVER,MET,5)}
   if(opt.shoulder){const pts=[];for(let i=0;i<=36;i++){const a=i/36*Math.PI*2;pts.push([w*.46*Math.cos(a),h+.008+.035*Math.pow(Math.sin(a),2),.018*Math.sin(a)-.012])}webbing(ft,pts,.028,col);tb(t,pts.map(p=>[p[0],p[1]+.002,p[2]-.011]),.0008,[.65,.45,.25]);
     webbing(ft,[[w*.50,h,.0],[w*.61,h*.72,-.015],[w*.57,h*.12,-.04],[w*.46,.01,-.03]],.03,col);
   }else if(opt.wrist){const pts=[];for(let i=0;i<=24;i++){const a=i/24*Math.PI*2;pts.push([-w/2-.04+.047*Math.cos(a),.030+.025*Math.sin(a),.055*Math.sin(a)])}webbing(ft,pts,.013,col)}
   if(opt.plaque)plaque(x+d/2+.015,z);
 };
 const sling=(x,z,col,key)=>{const w=.235,h=.38,d=.115,t=T(x,z,A,.006),f=F(x,z,A,0,.006);
   prod(f,rrect(w,h,.045,.024),w,h,d,'P_'+key,'S_'+key,{r:.022});
   // Raised upper zip pocket and projecting flap/closure give the sling real depth.
   const pf=F(x+d/2+.008,z,A,0,.225);prod(pf,rrect(.207,.15,.028,.026),.207,.15,.022,'P_'+key,'P_'+key,{r:.01,crop:[.06,.0,.94,.43]});
   zip(T(x,z,A+Math.PI,.006),-.075,.075,.24,d/2+.002,col);topZip(t,w,h,d,col);buckle(t,0,.095,d/2+.025,.033,.028,BRASS,.0022);
   webbing(f,[[0,.33,-d/2],[.06,.22,-.08],[.12,.02,-.05],[.05,.004,.04],[-.08,.004,.06]],.032,col);
 };
 // LEFT: six belts, hide sample board, two freestanding belts and the dark bag family.
 box(F(.34,1.12,A),[0,0,0],.48,.035,.28,{t:'P_hboard',s:'c_orangewood'});
 {const x=-.025,z=1.07,t=T(x,z,A),f=F(x,z,A),TR=[.27,.135,.09];
  rbox(t,[0,.012,0],[.255,.012,.17],.004,TR,LE);rbox(t,[0,.026,0],[.24,.003,.153],.002,[.87,.82,.70],null);
  for(const sg of [-1,1])rbox(t,[sg*.25,.045,0],[.007,.036,.17],.003,TR,LE);
  for(const sg of [-1,1])rbox(t,[0,.03,sg*.165],[.25,.018,.007],.003,TR,LE);
  const order=[1,2,3,4,5,6];for(let j=0;j<6;j++){const u=-.208+j*.083;
   for(let i=0;i<3;i++){const pts=[];for(let n=0;n<=30;n++){const a=n/30*Math.PI*2;pts.push([u,.065+(.037-i*.008)*Math.sin(a),-.07+(.037-i*.008)*Math.cos(a)])}webbing(f,pts,.061,j===3||j===5?[.07,.06,.05]:j===1?[.30,.08,.06]:[.55,.23,.09])}
   q(f([u-.033,.042,.155]),f([u+.033,.042,.155]),f([u+.033,.102,-.085]),f([u-.033,.102,-.085]),'P_belt'+order[j],1);
   buckle(t,u,.018,.17,.062,.044,j===1||j===4?BRASS:SILVER,.0026);
   if(j%2===0)box(F(x+.19,z-u,A,.1,.005),[0,0,0],.026,.042,.001,{s:'c_white'});
  }
 }
 [[.24,.87,.065,'badge1'],[.37,.87,.045,'badge2'],[.49,.87,.047,'badge3']].forEach(([x,z,r,k])=>tdisc([cx+x,yT+.037,cz+z],r,[1,0,0],[0,0,-1],k,1,32));
 rollT(.25,.72,.003,.057,.047,3,'P_brnband');strip([[.25,.09,.70],[.27,.06,.67],[.29,.008,.66]],.043,'P_bbelt',[1,0,0],true);buckle(T(.29,.67,A),0,.006,0,.055,.05,BRASS);
 log(.26,.48,.104,.052);coilT(.26,.48,.054,.091,.045,2.5,'P_redband');buckle(T(.36,.49,A,.057),0,0,0,.058,.043,BRASS,.0035);strip([[.351,.078,.48],[.357,.078,.43],[.344,.078,.39],[.321,.078,.365],[.298,.078,.355]],.041,'P_redband',[0,1,0],false,1,.95);
 strip([[.52,.006,1.00],[.51,.009,.78],[.52,.008,.56],[.51,.006,.32]],.041,'P_blkband',[1,0,0],false,3);
 {const t=T(.52,.67,A,.013);for(const u of [-.028,.028])rbox(t,[u,0,0],[.006,.005,.025],.002,SILVER,ME);rbox(t,[0,0,0],[.027,.005,.006],.002,SILVER,ME)}
 sling(-.45,.94,GL,'g_sling');
 standBag(-.25,1.10,'m_mb',.355,.26,.13,GL,A,{shoulder:true});
 standBag(-.20,.68,'w_wb',.29,.185,.10,GL,A,{double:true,plaque:true});print(-.17,.68,.12,.043,'price359',.195);
 standBag(-.015,.32,'s_sb',.25,.185,.095,GL,A,{wrist:true,plaque:true});
 print(.105,.65,.19,.105,'daily');
 {const x=-.55,t=T(x,.72,A);box(I,[x,.001,.72],.045,.018,.36,{s:'c_chrome'});cyl(I,[x,0,.72],[x,.47,.72],.008,'c_chrome',12);for(const yy of [.37,.405])cyl(I,[x,yy,.43],[x,yy,1.04],.007,'c_chrome',12);for(const z of [.49,.59,.85,.96]){const tt=T(x,z,A);rbox(tt,[0,.353,0],[.012,.026,.007],.004,SILVER,ME);disc(tt,[0,.369,.009],.004,.003,SILVER,MET);}}
 // Centre: iron-pipe lamp, tall owl backpack, main sign and hot foil press.
 {const x=-.41,z=.66,IRON=[.14,.13,.115];const t=T(x,z,A);
  for(const sg of [-1,1]){tb(t,[[sg*.105,.014,.09],[sg*.105,.033,.025],[0,.033,.025]],.013,IRON,MET);rbox(t,[sg*.105,.018,.09],[.02,.016,.023],.007,IRON,ME)}
  tb(t,[[0,.03,.025],[0,.58,.025],[.025,.68,.025]],.011,IRON,MET,10);
  tube(t([.025,.68,.025],[0,1,0])[0],t([.04,.62,.16],[0,1,0])[0],.035,.15,[.48,.48,.43],MET,40);
  tube(t([.04,.619,.161],[0,1,0])[0],t([.025,.675,.03],[0,1,0])[0],.145,.031,[.78,.77,.69],LEA,40);
  tube(t([.03,.66,.08],[0,1,0])[0],t([.04,.625,.13],[0,1,0])[0],.017,.017,[.08,.075,.065],LEA,12);
  const cable=[];for(let i=0;i<=45;i++){const a=i/45*Math.PI*5;cable.push([.07*Math.cos(a),.007,.06*Math.sin(a)])}tb(t,cable,.002,[.035,.03,.025]);
 }
 {const x=-.46,z=.35;box(I,[x,0,z],.16,.009,.20,{s:'c_chrome'});cyl(I,[x,0,z],[x,.86,z],.007,'c_chrome',12);
  prod(stand(x+.025,z,A,.40),dome(.325,.40,.105),.325,.40,.14,'P_owl_f','P_owl_b',{r:.024});
  const t=T(x+.025,z,A,.4);strapArc(t,.13,.40,.045,[.24,.15,.08],.014);
  for(const sg of [-1,1])webbing(F(x+.025,z,A,0,.4),[[sg*.09,.35,-.077],[sg*.11,.17,-.13],[sg*.09,-.08,-.11],[sg*.12,.03,-.075]],.026,[.29,.19,.11]);
 }
 print(-.245,.33,.30,.43,'sign');
 {const x=-.245,z=-.045,WN=[.40,.23,.13],AL=[.67,.69,.68],t=T(x,z,A),f=F(x,z,A);
  box(f,[0,0,0],.31,.16,.29,{s:'c_walnut',t:'timber'});
  rbox(t,[0,.08,.148],[.135,.061,.003],.003,WN,null);disc(t,[0,.085,.153],.009,.004,BRASS,MET);
  for(const sg of [-1,1])for(let j=0;j<3;j++)ln(t,[sg*.075-.029,.052+j*.014,-.146],[sg*.075+.029,.052+j*.014,-.146],.003,.001,[.12,.08,.05]);
  rbox(t,[0,.17,-.025],[.125,.008,.10],.003,AL,()=>[0,0]);
  for(const sg of [-1,1]){const P=[];for(let i=0;i<=18;i++){const a=-.62+i/18*2.63;P.push([sg*.087,.34+.20*Math.sin(a),-.055-.13*Math.cos(a)])}for(let i=0;i<P.length-1;i++)bar(t,P[i],P[i+1],[1,0,0],.016,.043,AL,[0,0]);
   for(const y of [.27,.40,.48])disc(t,[sg*.087,y,.0],.006,.005,SILVER,MET);
  }
  rbox(t,[0,.24,-.01],[.023,.07,.025],.003,AL,()=>[0,0]);rbox(t,[0,.30,.025],[.145,.008,.115],.003,AL,()=>[0,0]);
  for(let j=-6;j<=6;j++){ln(t,[j*.022,.309,-.08],[j*.022,.309,.135],.0008,.0005,[.25,.28,.27],LEA,[0,1,0]);ln(t,[-.14,.309,.025+j*.017],[.14,.309,.025+j*.017],.0008,.0005,[.25,.28,.27],LEA,[0,1,0])}
  rbox(t,[0,.44,-.025],[.058,.06,.052],.004,AL,()=>[0,0]);q(f([-.054,.382,.028]),f([.054,.382,.028]),f([.054,.498,.028]),f([-.054,.498,.028]),'pressplate',1.10);rbox(t,[0,.535,-.025],[.034,.035,.035],.003,[.58,.59,.57],()=>[0,0]);
  rbox(t,[0,.368,-.025],[.068,.012,.058],.002,[.40,.34,.25],ME);
  tb(t,[[.055,.48,-.025],[.24,.66,-.025]],.008,SILVER,MET);tb(t,[[.24,.66,-.025],[.28,.70,-.025]],.014,[.06,.06,.06]);
  const cord=[];for(let i=0;i<=64;i++){const a=i/64*Math.PI;cord.push([-.12-.045*Math.sin(a),.17+i/64*.27,-.025-.035*Math.sin(a)])}tb(t,cord,.007,[.48,.48,.44],MET,8);
  for(const sg of [-1,1])ln(t,[sg*.11,.311,-.07],[sg*.11,.311,.13],.01,.004,AL,[0,0],[1,0,0]);
 }
 // Right half: aged leather bag family with folded straps and individual stands.
 standBag(-.34,-.43,'m_mc',.35,.26,.13,CH,A,{shoulder:true});
 standBag(-.08,-.39,'s_sc',.25,.18,.095,CH,A,{wrist:true,plaque:true});
 sling(-.43,-.78,CH,'c_sling');
 standBag(-.05,-.79,'t_cd',.29,.17,.11,CH,A-.10,{double:true,wrist:true,plaque:true});
 standBag(-.075,-1.20,'s_sc',.25,.20,.09,CH,A-.18,{wrist:true});
 // Wallet positions from 145509/145513/145521: three long wallets behind two bifolds,
 // the separate orange long wallet offset left/front, stacked plum/orange at the right.
 lie(.24,.015,A-.10,.112,.225,.020,'wl1');
 [['ltan',-.20],['lbrown',-.36],['ldark',-.52]].forEach(([k,z])=>lie(.13,z,A,.11,.225,.020,k));
 lie(.34,-.16,A-.05,.125,.11,.024,'borange');
 lie(.35,-.34,A+.035,.125,.11,.024,'bplum');
 lie(.29,-.64,A-.04,.125,.11,.024,'borange');
 lie(.292,-.643,A+.015,.125,.11,.022,'wb6',{y:.024});
 lie(.297,-.648,A-.025,.125,.11,.021,'bplum',{y:.046});
 // The front three pieces are staggered/angled, not a continuation of the rear row.
 lie(.50,-.12,A-.08,.085,.15,.018,'bbrown');
 lie(.49,-.31,A+.30,.085,.16,.018,'bblack');
 lie(.465,-.50,A+.12,.095,.225,.020,'lplum');
 print(-.01,-.33,.12,.043,'price199');
 {const f=F(.40,.22,A-.12,0,.003),h=.12;q(f([-h,0,h*.65]),f([h,0,h*.65]),f([h,0,-h*.65]),f([-h,0,-h*.65]),'hide_tan',1)}
 // Dried sprig lies across the open foreground, between the hide and the front wallets.
 {let seed=5;const rnd=()=>(seed=seed*16807%2147483647)/2147483647;for(let j=0;j<90;j++){const z=.10-rnd()*.37,x=.405+(rnd()-.5)*.07;tb(T(0,0),[[x,.01,z],[x+.014,.02+rnd()*.012,z-.03]],.002,[.72+rnd()*.13,.47+rnd()*.10,.18],LEA,4)}tb(T(0,0),[[.405,.007,.11],[.48,.006,-.67]],.002,[.36,.43,.16])}
 // Card sleeves are on the log immediately to the right of the long-wallet row.
 log(.13,-.75,.105,.047);
 ['bbrown','ldark','ltan'].forEach((k,i)=>lie(.13,-.75+(1-i)*.065,A+.08,.068,.10,.005,k,{y:.048+i*.001}));
 // Four upright wallets run front-to-back in the wire rack; open orange sample in front/left.
 {const x=.16,z=-1.00,t=T(x,z,A);for(const sg of [-1,1])tb(t,[[sg*.065,0,-.08],[sg*.065,.08,-.075],[sg*.065,.08,.05],[sg*.065,0,.075]],.0025,[.06,.06,.055],MET,6);
  ['wb2','wb1','wb4','bblack'].forEach((k,i)=>{const f=F(x+i*.045-.06,z,A,.20,.008);prod(f,rrect(.13,.115,.008,.008),.13,.115,.017,'P_'+k,'P_'+k,{r:.004})});
  const hinge=[.385,-.86],leaf=(yaw,side)=>F(hinge[0]+side*.054*Math.cos(yaw),hinge[1]-side*.054*Math.sin(yaw),yaw,0,.003);const left=leaf(A-.65,-1),right=leaf(A+.65,1);prod(left,rrect(.105,.12,.006,.006),.105,.12,.009,'P_w11','P_borange',{r:.003});prod(right,rrect(.105,.12,.006,.006),.105,.12,.009,'P_w11','P_borange',{r:.003});
 }
 log(.405,-1.14,.105,.05);
 [[.045,'c_mclip1',.02],[-.015,'c_mclip2',-.025],[-.065,'c_mclip3',.015]].forEach(([z,k,dx])=>{const f=F(.405+dx,-1.14+z,A,0,.051);prod(p=>f([p[0],p[2],-p[1]+.038]),rrect(.045,.075,.018,.012),.045,.075,.005,k,k,{r:.002,side:k})});
 print(.045,-1.17,.16,.10,'daily');price(.17,-1.17,'price259');
 // End display: a two-hook chrome stand, the two suspended clutches, small owl and keychains.
 box(F(-.40,-1.04,A+.10),[0,0,0],.32,.045,.25,{s:'c_orangewood',t:'timber'});log(-.40,-1.04,.09,.065,.045);print(-.40,-1.04,.17,.13,'newarr',.11);
 {const x=-.43,z=-1.25,t=T(x,z,A);tdisc([cx+x,yT+.008,cz+z],.12,[1,0,0],[0,0,-1],'c_chrome',.95);cyl(I,[x,.008,z],[x,.82,z],.007,'c_chrome',16);
  const pts=[];for(let i=0;i<=32;i++){const u=-.20+i/32*.40;pts.push([u,.77+.08*Math.cos(u/.2*Math.PI),0])}tb(t,pts,.005,SILVER,MET,8);
  for(const [u,k,col] of [[-.13,'t_cc',TAN],[.13,'t_cd',DK]]){const f=F(x,z,A,0,0);prod(p=>f([p[1]-.155+u,p[0]+.46,p[2]]),rrect(.31,.17,.032,.025),.31,.17,.095,'P_'+k+'_f','P_'+k+'_b',{r:.018});
   webbing(f,[[u,.76,0],[u-.025,.66,.02],[u-.02,.59,.045]],.024,col);disc(t,[u-.02,.60,.052],.004,.002,SILVER,MET);
  }
 }
 {const x=-.22,z=-1.04,t=T(x,z,A,.015);rbox(t,[0,.062,0],[.043,.062,.035],.027,CH,LE);for(const sg of [-1,1]){disc(t,[sg*.019,.084,.037],.019,.002,[.52,.34,.17],LEA,24);disc(t,[sg*.019,.084,.040],.006,.002,[.07,.06,.045],MET,16)}ln(t,[0,.08,.041],[0,.047,.041],.012,.004,[.58,.38,.18]);strapArc(t,.075,.12,.04,CH,.01)}
 {const x=.18,z=-1.32,t=T(x,z,A-.12,.003,.22),f=F(x,z,A-.12,-.22,.003);box(f,[0,0,0],.21,.31,.018,{s:'pine',f:'pine',b:'pine'});
  tb(T(x,z,A),[[-.065,.20,-.045],[-.065,.006,-.13],[.065,.006,-.13],[.065,.20,-.045]],.004,[.69,.55,.36]);
  ['k1s','k2s','k3s'].forEach((k,j)=>{const u=-.065+j*.065;tb(t,[[u,.25,.005],[u,.25,.04]],.003,[.72,.59,.40]);const ring=[];for(let n=0;n<=16;n++){const a=n/16*Math.PI*2;ring.push([u+.012*Math.cos(a),.232+.012*Math.sin(a),.04])}tb(t,ring,.002,SILVER,MET,6);prod(p=>f([p[0]+u,p[1]+.07,p[2]+.025]),rrect(.037,.14,.005,.007),.037,.14,.007,'P_'+k,'P_'+k,{r:.002})});
 }
 for(const z of [-1.28,-1.385]){box(F(.435,z,A),[0,.002,0],.041,.045,.028,{s:'c_acrylic'});const cv=CHV.length,mv=MV.length;rollT(.49,z,.004,.055,.037,4,'P_blkband');
  // The two end belts lean on their acrylic support, instead of standing like upright rings.
  const ct=Math.cos(.65),st=Math.sin(.65);for(const [buf,start,stride] of [[CHV,cv,3],[MV,mv,13]])for(let j=start;j<buf.length;j+=stride){const ox=buf[j]-cx-.49,x=buf[j+2]-cz-z,y=buf[j+1]-yT;buf[j]=cx+.445+x*ct-y*st;buf[j+1]=yT+.045+x*st+y*ct;buf[j+2]=cz+z-ox;if(stride===13){const oxn=buf[j+3],nx=buf[j+5],ny=buf[j+4];buf[j+3]=nx*ct-ny*st;buf[j+4]=nx*st+ny*ct;buf[j+5]=-oxn}}
  strip([[.445,.12,z],[.50,.065,z],[.56,.008,z]],.037,'P_blkband',[0,0,1],false,1);
  const t=T(.555,z,A-.10,.005,.55);rbox(t,[0,.022,0],[.023,.026,.004],.002,SILVER,ME);rbox(t,[0,.022,.005],[.016,.020,.002],.002,[.17,.17,.16],ME);
 }
}

function craftHeritage(cx,cz){
 const S=1.15,L=2.90,DP=1.18,TH=.75*S,T=.05*S,front=cx+DP/2,back=cx-DP/2,y=TH;
 if(window.JS_CH){heritageItems(cx,cz,y,L,DP);for(const sz of [-1,1]){const lz=cz+sz*(L/2-.35*S);
  for(const x of [front-.07*S,back+.07*S])box(x,(y-T)/2,lz,.06*S,y-T,.06*S,'metal',1);
  box(cx,.03*S,lz,DP-.08*S,.06*S,.06*S,'metal',1);box(cx,y-T-.03*S,lz,DP-.08*S,.06*S,.06*S,'metal',.9)}return}
 box(cx,y-T/2,cz,DP,T,L,'wood',.48);                                   // dark walnut slab
 photoQuad('ch_top',[[front,y+.002,cz+L/2],[front,y+.002,cz-L/2],[back,y+.002,cz-L/2],[back,y+.002,cz+L/2]],1.0);
 for(const sz of [-1,1]){const lz=cz+sz*(L/2-.35*S);                     // U-frame legs at both ends
  for(const x of [front-.07*S,back+.07*S])box(x,(y-T)/2,lz,.06*S,y-T,.06*S,'metal',1);
  box(cx,.03*S,lz,DP-.08*S,.06*S,.06*S,'metal',1);box(cx,y-T-.03*S,lz,DP-.08*S,.06*S,.06*S,'metal',.9)}
 // standing products: lower in the photo = nearer the display side; viewer's left is +z
 for(const [k,m] of Object.entries(SP)){if(!k.startsWith('chp_'))continue;
  const t=Math.max(0,Math.min(1,(478-m.yb)/78)),ppm=316/(1+.6*t)/S,w=m.w/ppm,h=m.h/ppm,z=cz-(m.xc-558)/ppm,x=front-.06*S-t*(DP-.16*S);
  sprite(x,z,w/2,y+.002,y+.002+h,k,1.08,Math.PI);
  const Z=u=>z-(u-m.xc)/ppm,H=v=>y+(m.yb-v)/ppm;
  if(k==='chp_0'){box(x-.03,(y+H(300))/2,Z(372),.018,H(300)-y,.018,'metal',1);box(x-.03,y+.01,Z(372),.12,.02,.12,'metal',1)}   // desk-lamp stem
  if(k==='chp_1'){const top=H(277);box(x-.04,(y+top)/2,Z(783),.02,top-y,.02,'white',.9);box(x-.04,y+.008,Z(783),.16,.016,.16,'white',.85);
   for(const sz of [-1,1])line3([x-.04,top,Z(783)],[x-.04,top-.05,Z(783)+sz*.13],.014,'white')}   // chrome hanging stand
 }
}
// GIFTING / MAKE IT PERSONAL table at the back, from the store photos: a live-edge teak table on
// black U-frame legs, facing the entrance; everything on it (gift boxes, Just for You cards, sticker
// pack, MAKE IT PERSONAL and ENGRAVING signs, paper bag, keychain board, wrapping tray) is one
// cut-out from the straight-on photo, standing on the table.
function giftTable(cx,cz){
 const L=1.55,DP=.7,TH=.76,T=.045,front=cz+DP/2,y=TH;
 if(!window.JS_GIFT){box(cx,y-T/2,cz,L,T,DP,'wood',.9);box(cx,y-T-.006,cz,L-.04,.012,DP-.04,'wood',.55)}
 for(const sx of [-1,1]){const lx=cx+sx*(L/2-.22);
  for(const z of [front-.06,cz-DP/2+.06])box(lx,(y-T)/2,z,.05,y-T,.05,'metal',1);
  box(lx,.025,cz,.05,.05,DP-.08,'metal',1);box(lx,y-T-.025,cz,.05,.05,DP-.08,'metal',.9)}
 if(window.JS_GIFT)giftItems(cx,cz,y);
 else{const m=SP.gt_items;if(m){const w=1.58,h=w*m.aspect,zc=cz-.12;
  photoQuad('gt_items',[[cx-w/2+.02,y,zc],[cx+w/2+.02,y,zc],[cx+w/2+.02,y+h,zc],[cx-w/2+.02,y+h,zc]],1.08)}}
}
// Everything on the MAKE IT PERSONAL table as real objects (own texture atlas assets/gift-data.js):
// three leaning gift boxes, sage and copper card stacks, Just for You cards in wooden holders, the
// sticker pack on an easel, the two A4 signs in acrylic stands, the paper bag with rope handles and
// round ENGRAVING tag, the open gift box, the log slice, the keychain board with four keychains and
// the linen tray with grey paper rolls and the pine sprig. Sizes and positions from the photos.
var GV=[],GU=[],GS=[],giftMesh=null,giftTex=null;
function giftItems(cx,cz,yT){const R=window.JS_GIFT;
 const uvq=k=>{const r=R[k]||R.c_white;return [[r[0],r[3]],[r[2],r[3]],[r[2],r[1]],[r[0],r[1]]]};
 const tri=(P,T,sh)=>{for(const i of [0,1,2,0,2,3]){GV.push(...P[i]);GU.push(...T[i]);GS.push(sh)}};
 const q=(a,b,c,d,k,sh=1)=>tri([a,b,c,d],uvq(k),sh);
 // frame: origin (table-local x,z), yaw about y, tilt = lean back about x (top goes to -z)
 const F=(x,z,yaw=0,tilt=0,y0=0)=>{const cy=Math.cos(yaw),sy=Math.sin(yaw),ct=Math.cos(tilt),st=Math.sin(tilt);
  return p=>{const y1=p[1]*ct+p[2]*st,z1=-p[1]*st+p[2]*ct,x1=p[0];return [cx+x+x1*cy+z1*sy,yT+y0+y1,cz+z-x1*sy+z1*cy]}};
 // box with its bottom centre at o (frame coords); faces f,b,l,r,t,d -> texture keys
 const box=(T,o,w,h,d,fc)=>{const X=[o[0]-w/2,o[0]+w/2],Y=[o[1],o[1]+h],Z=[o[2]-d/2,o[2]+d/2],P=(i,j,k)=>T([X[i],Y[j],Z[k]]),g=k=>fc[k]||fc.s||'c_white';
  q(P(0,0,1),P(1,0,1),P(1,1,1),P(0,1,1),g('f'),.97);q(P(1,0,0),P(0,0,0),P(0,1,0),P(1,1,0),g('b'),.74);
  q(P(0,0,0),P(0,0,1),P(0,1,1),P(0,1,0),g('l'),.82);q(P(1,0,1),P(1,0,0),P(1,1,0),P(1,1,1),g('r'),.82);
  q(P(0,1,1),P(1,1,1),P(1,1,0),P(0,1,0),g('t'),1.04);q(P(0,0,0),P(1,0,0),P(1,0,1),P(0,0,1),g('d'),.6)};
 // cylinder between two frame points, side texture + caps
 const cyl=(T,a,b,r,side,cap,N=14,capK=null)=>{const d=b.map((v,i)=>v-a[i]),L=Math.hypot(...d),n=d.map(v=>v/L),u=Math.abs(n[1])<.9?[0,1,0]:[1,0,0];
  let e1=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];const l1=Math.hypot(...e1);e1=e1.map(v=>v/l1);const e2=[n[1]*e1[2]-n[2]*e1[1],n[2]*e1[0]-n[0]*e1[2],n[0]*e1[1]-n[1]*e1[0]];
  const ring=(c,t)=>c.map((v,i)=>v+r*(Math.cos(t)*e1[i]+Math.sin(t)*e2[i]));
  for(let i=0;i<N;i++){const t0=i/N*Math.PI*2,t1=(i+1)/N*Math.PI*2,sh=.72+.3*Math.max(0,Math.sin((t0+t1)/2)*.8+.2);
   q(T(ring(a,t0)),T(ring(a,t1)),T(ring(b,t1)),T(ring(b,t0)),side,sh);
   if(cap){const rc=R[capK||cap]||R.c_white,cu=(rc[0]+rc[2])/2,cv=(rc[1]+rc[3])/2,hu=(rc[2]-rc[0])/2,hv=(rc[3]-rc[1])/2;
    const P=[T(b),T(ring(b,t0)),T(ring(b,t1))],U=[[cu,cv],[cu+Math.cos(t0)*hu,cv-Math.sin(t0)*hv],[cu+Math.cos(t1)*hu,cv-Math.sin(t1)*hv]];
    for(let j=0;j<3;j++){GV.push(...P[j]);GU.push(...U[j]);GS.push(1.04)}}}};
 // flat disc with a round print: centre c (world), axes ex/ey (world unit vectors), texture key
 const disc=(c,r,ex,ey,k,sh=1.04,N=28)=>{const rc=R[k],cu=(rc[0]+rc[2])/2,cv=(rc[1]+rc[3])/2,hu=(rc[2]-rc[0])/2,hv=(rc[3]-rc[1])/2;
  for(let i=0;i<N;i++){const t0=i/N*Math.PI*2,t1=(i+1)/N*Math.PI*2,pt=t=>c.map((v,j)=>v+r*(Math.cos(t)*ex[j]+Math.sin(t)*ey[j]));
   for(const [P,U] of [[c,[cu,cv]],[pt(t0),[cu+Math.cos(t0)*hu,cv-Math.sin(t0)*hv]],[pt(t1),[cu+Math.cos(t1)*hu,cv-Math.sin(t1)*hv]]]){GV.push(...P);GU.push(...U);GS.push(sh)}}};
 const I=F(0,0);
 // walnut table top over the frame (grain from the photos)
 box(I,[0,-.045,0],1.56,.045,.71,{t:'walnut',s:'walnut',d:'walnut'});
 // textured roll: texture runs along the axis (u) and once around (v)
 const roll=(a,b,r,k,N=18)=>{const rc=R[k],d=b.map((v,i)=>v-a[i]),L=Math.hypot(...d),n=d.map(v=>v/L),e1=[0,1,0],e2=[n[1]*e1[2]-n[2]*e1[1],n[2]*e1[0]-n[0]*e1[2],n[0]*e1[1]-n[1]*e1[0]];
  const pt=(c,t)=>c.map((v,i)=>v+r*(Math.cos(t)*e2[i]+Math.sin(t)*e1[i]));
  for(let i=0;i<N;i++){const t0=i/N*Math.PI*2,t1=(i+1)/N*Math.PI*2,v0=rc[1]+(rc[3]-rc[1])*i/N,v1=rc[1]+(rc[3]-rc[1])*(i+1)/N,sh=.7+.36*Math.max(0,Math.sin((t0+t1)/2)*.7+.3);
   tri([pt(a,t0),pt(b,t0),pt(b,t1),pt(a,t1)].map(p=>[p[0]+cx,p[1]+yT,p[2]+cz]),[[rc[0],v0],[rc[2],v0],[rc[2],v1],[rc[0],v1]],sh)}
  cyl(I,a,a.map((v,i)=>v-n[i]*.001),r,'c_paper',null,N);cyl(I,b,b.map((v,i)=>v+n[i]*.001),r,'c_paper',null,N)};
 const wire=(T,p0,p1,r=.0025)=>cyl(T,p0,p1,r,'c_wire',null,6);
 // --- gift boxes leaning back on black wire racks (front: diagonal stripe, then mauve, then sage) ---
 for(const [x,z,lift,k,sk] of [[-.36,-.26,.07,'box_cream','c_cream'],[-.38,-.17,.035,'box_pink','c_pink'],[-.43,-.08,0,'box_diag','c_dcream']]){
  const T=F(x,z,0,.3,lift);box(T,[0,0,0],.33,.24,.045,{f:k,s:sk,t:sk});
  for(const dx of [-.12,.12]){wire(I,[x+dx,0,z+.02],[x+dx,lift+.004,z+.02]);wire(I,[x+dx,0,z+.02],[x+dx,0,z-.09]);
   wire(I,[x+dx,0,z-.09],[x+dx,lift+.2*Math.cos(.3),z+.02-.2*Math.sin(.3)-.03])}
  wire(I,[x-.12,lift+.004,z+.02],[x+.12,lift+.004,z+.02])}
 // --- copper and sage card stacks, fanned upright in clear L-stands ---
 for(const [x0,fk,bk] of [[-.53,'c_cucard','c_cucard'],[-.29,'c_sagecard','c_sagecard']]){
  box(I,[x0,0,-.005],.2,.004,.11,{s:'c_acrylic'});
  for(let i=0;i<14;i++)box(F(x0,-.05+i*.007,0,.18-i*.004,.004),[0,0,0],.2,.135,.0025,{f:fk,s:'c_paper',t:'c_paper',b:bk})}
 // --- Just for You: big wooden holder (copper left, sage right), small holder in front ---
 box(I,[-.47,0,.15],.5,.035,.06,{s:'pine_h',t:'pine_h'});
 for(let i=4;i>=0;i--){box(F(-.6,.148-i*.006,0,.1,.018),[0,0,0],.2,.135,.0025,{f:i?'c_cucard':'jfy_cu',s:'c_paper',t:'c_paper',b:'c_cucard'});
  box(F(-.38,.152-i*.006,0,.1,.018),[0,0,0],.2,.135,.0025,{f:i?'c_sagecard':'jfy_sg',s:'c_paper',t:'c_paper',b:'c_sagecard'})}
 box(I,[-.47,0,.255],.36,.025,.05,{s:'pine_h',t:'pine_h'});
 for(let i=2;i>=0;i--){box(F(-.55,.255-i*.005,0,.08,.012),[0,0,0],.095,.06,.002,{f:i?'c_sagecard':'jfy_sg_s',s:'c_paper',b:'c_sagecard'});
  box(F(-.40,.255-i*.005,0,.08,.012),[0,0,0],.095,.06,.002,{f:i?'c_cucard':'jfy_cu_s',s:'c_paper',b:'c_cucard'})}
 box(I,[-.47,0,.277],.36,.034,.008,{s:'pine_h',t:'pine_h'});
 // --- sticker pack on a small wooden easel ---
 {const E=F(-.12,-.02,0,.22,.035);box(E,[0,0,0],.2,.186,.003,{f:'st_pack',s:'c_white'});
  box(I,[-.12,.035,-.008],.11,.01,.018,{s:'pine'});
  for(const dx of [-.04,.04])box(F(-.12+dx,-.03,0,.22),[0,0,0],.009,.16,.006,{s:'pine'});
  box(F(-.12,-.06,0,-.35),[0,0,0],.009,.14,.006,{s:'pine'})}
 // --- MAKE IT PERSONAL on a dark wood block; ENGRAVING in a clear acrylic stand ---
 box(I,[-.06,0,-.16],.24,.03,.07,{s:'walnut',t:'walnut'});
 box(F(-.06,-.16,0,.12,.03),[0,0,0],.21,.297,.003,{f:'mp_sign',s:'c_white'});
 box(F(.15,-.08,-.06),[0,0,0],.225,.008,.08,{s:'c_acrylic'});
 box(F(.15,-.08,-.06,.16,.008),[0,0,0],.21,.30,.003,{f:'eg_sign',s:'c_white'});
 box(F(.15,-.08,-.06,.16,.008),[0,0,-.004],.215,.305,.003,{s:'c_acrylic',f:'c_acrylic'});
 // --- big sage paper bag on a black wire riser: front/back panels, side gussets folded inward,
 //     open top, twisted black rope handles standing off the face, round ENGRAVING tag ---
 {const bx=.33,bz=-.25,W=.5,H=.52,D=.16,y0=.075,G=.05,fz=bz+D/2,kz=bz-D/2;
  for(const sx of [-1,1])for(const sz of [-1,1])wire(I,[bx+sx*.2,0,bz+sz*.06],[bx+sx*.2,y0,bz+sz*.06],.004);
  for(const sz of [-1,1])wire(I,[bx-.2,y0,bz+sz*.06],[bx+.2,y0,bz+sz*.06],.004);
  for(const sx of [-1,1])wire(I,[bx+sx*.2,y0,bz-.06],[bx+sx*.2,y0,bz+.06],.004);
  const Wp=(x,y,z)=>[cx+x,yT+y,cz+z],x0=bx-W/2,x1=bx+W/2,yb=y0,yt=y0+H;
  q(Wp(x0,yb,fz),Wp(x1,yb,fz),Wp(x1,yt,fz),Wp(x0,yt,fz),'bag',1.0);                       // front
  q(Wp(x1,yb,kz),Wp(x0,yb,kz),Wp(x0,yt,kz),Wp(x1,yt,kz),'bag',.8);                        // back
  q(Wp(x0+.004,yb+.01,fz-.003),Wp(x1-.004,yb+.01,fz-.003),Wp(x1-.004,yt,fz-.003),Wp(x0+.004,yt,fz-.003),'c_bagin',.62); // inside faces
  q(Wp(x1-.004,yb+.01,kz+.003),Wp(x0+.004,yb+.01,kz+.003),Wp(x0+.004,yt,kz+.003),Wp(x1-.004,yt,kz+.003),'c_bagin',.55);
  q(Wp(x0,yb+.001,kz),Wp(x1,yb+.001,kz),Wp(x1,yb+.001,fz),Wp(x0,yb+.001,fz),'c_bagin',.5);  // bottom
  // gussets: each side folds in to a centre crease (texture: left half / right half of the side photo)
  {const r=R.bag_side,um=(r[0]+r[2])/2;
   for(const sx of [-1,1]){const xe=sx<0?x0:x1,xc=xe-sx*G;
    tri([Wp(xe,yb,fz),Wp(xc,yb,bz),Wp(xc,yt,bz),Wp(xe,yt,fz)],sx<0?[[r[0],r[3]],[um,r[3]],[um,r[1]],[r[0],r[1]]]:[[r[2],r[3]],[um,r[3]],[um,r[1]],[r[2],r[1]]],sx<0?.86:.8);
    tri([Wp(xc,yb,bz),Wp(xe,yb,kz),Wp(xe,yt,kz),Wp(xc,yt,bz)],sx<0?[[um,r[3]],[r[2],r[3]],[r[2],r[1]],[um,r[1]]]:[[um,r[3]],[r[0],r[3]],[r[0],r[1]],[um,r[1]]],sx<0?.72:.68)}}
  // twisted rope: smooth path through the photo points, standing off the face, two strands wound round it
  const rope=[[.299,.048],[.357,.122],[.428,.211],[.481,.291],[.513,.353],[.507,.397],[.481,.419],[.454,.396],[.445,.348],[.463,.299],[.516,.23],[.604,.129],[.687,.042]];
  const cr=(p0,p1,p2,p3,t)=>p1.map((_,i)=>.5*((2*p1[i])+(-p0[i]+p2[i])*t+(2*p0[i]-5*p1[i]+4*p2[i]-p3[i])*t*t+(-p0[i]+3*p1[i]-3*p2[i]+p3[i])*t*t*t));
  for(const side of [1,-1]){const pts=[];
   for(let i=0;i+1<rope.length;i++)for(let k=0;k<6;k++){const t=k/6,P=cr(rope[Math.max(0,i-1)],rope[i],rope[i+1],rope[Math.min(rope.length-1,i+2)],t);
    const u=side>0?P[0]:1-P[0],v=P[1],off=.004+.03*Math.sin(Math.min(1,v/.42)*Math.PI*.5);
    pts.push([bx-W/2+u*W,yt-v*H,side>0?fz+off:kz-off])}
   pts.push(side>0?[bx-W/2+.687*W,yt-.042*H,fz+.004]:[bx-W/2+.313*W,yt-.042*H,kz-.004]);
   for(let i=0;i+1<pts.length;i++){cyl(I,pts[i],pts[i+1],.0042,'c_rope',null,6);
    const d=pts[i+1].map((v,j)=>v-pts[i][j]),L=Math.hypot(...d);
    for(const ph of [0,Math.PI]){const a0=i*1.3+ph,a1=(i+1)*1.3+ph,o=(a)=>[Math.cos(a)*.0026*(-d[1]/L),Math.cos(a)*.0026*(d[0]/L),Math.sin(a)*.0026];
     const p0=pts[i].map((v,j)=>v+o(a0)[j]),p1=pts[i+1].map((v,j)=>v+o(a1)[j]);cyl(I,p0,p1,.0022,'c_rope2',null,4)}}
   for(const e of [rope[0],rope[rope.length-1]]){const u=side>0?e[0]:1-e[0];cyl(I,[bx-W/2+u*W,yt-e[1]*H,side>0?fz:kz],[bx-W/2+u*W,yt-e[1]*H,side>0?fz+.0015:kz-.0015],.007,'c_gun',null,10)}}
  const tc=Wp(bx-W/2+.33*W,yt-.77*H,fz+.03);cyl(p=>p,[tc[0],tc[1],tc[2]-.002],[tc[0],tc[1],tc[2]],.042,'c_white',null,24);disc([tc[0],tc[1],tc[2]+.0005],.042,[1,0,0],[0,1,0],'tag');
  cyl(p=>p,Wp(bx-W/2+.33*W,yt-.42*H,fz+.03),[tc[0],tc[1]+.042,tc[2]],.0006,'c_paper',null,3)}
 // --- open gift box (stickers inside) and the log slice with bark ---
 box(I,[.05,0,.03],.2,.012,.14,{s:'darkbox'});
 {const t=.05,ox=.05,oz=.03,w=.185,d=.125,h=.035;box(I,[ox,0,oz-d/2+t/10],w,h,.006,{s:'darkbox'});box(I,[ox,0,oz+d/2-.003],w,h,.006,{s:'darkbox'});
  for(const sx of [-1,1])box(I,[ox+sx*(w/2-.003),0,oz],.006,h,d,{s:'darkbox'});
  q([cx+ox-w/2,yT+.013,cz+oz+d/2],[cx+ox+w/2,yT+.013,cz+oz+d/2],[cx+ox+w/2,yT+.013,cz+oz-d/2],[cx+ox-w/2,yT+.013,cz+oz-d/2],'box_top',1.0)}
 cyl(I,[.25,0,.0],[.25,.05,.0],.1,'bark',null,28);disc([cx+.25,yT+.0505,cz],.1,[1,0,0],[0,0,-1],'slice',1.0);
 // --- keychain board (no price tag): four keychains as in the photo - gunmetal spring rings hung on
 //     angled pegs, swivel, chrome logo collar, folded leather loop (grey-brown, then three black) ---
 {const K=F(.58,-.03,-.1,.1);box(K,[0,0,0],.2,.31,.02,{f:'kc_board',s:'pine_h',t:'pine_h'});box(I,[.58,0,-.07],.2,.02,.07,{s:'pine_h',t:'pine_h'});
  for(let j=0;j<7;j++){const dx=-.075+j*.025;cyl(K,[dx,.27,.01],[dx+.004,.28,.03],.0025,'pine',null,6)}
  [-.069,-.023,.023,.069].forEach((dx,j)=>{const rc=.165,R0=.017;
   cyl(K,[dx-.012,rc+.014,.01],[dx-.004,rc+.018,.045],.003,'pine',null,6);                      // peg through the ring
   for(let i=0;i<16;i++){const a0=i/16*6.283,a1=(i+1)/16*6.283;
    cyl(K,[dx+Math.cos(a0)*R0,rc+Math.sin(a0)*R0,.032],[dx+Math.cos(a1)*R0,rc+Math.sin(a1)*R0,.032],.0029,i%4?'c_gun':'c_gun2',null,6)}
   cyl(K,[dx,rc-R0,.032],[dx,rc-R0-.012,.032],.0045,'c_gun',null,8);cyl(K,[dx,rc-R0-.012,.032],[dx,rc-R0-.016,.032],.006,'c_gun2',null,8);
   const yc=rc-R0-.016,ch=.018,sw=.032,top=yc-ch,bot=.022,th=.004;
   box(K,[dx,top,.032],sw+.002,ch,.013,{f:'cl'+(j+1),s:'c_gun2',t:'c_gun2',b:'c_gun'});        // collar
   box(K,[dx,bot+.004,.0365],sw,top-bot-.004,th,{f:'kc'+(j+1),s:'c_leather',t:'c_leather'});      // front of the loop
   box(K,[dx,bot+.004,.0275],sw-.002,top-bot-.004,th,{s:'c_leather',f:'c_leather'});               // back of the loop
   cyl(K,[dx-sw/2,bot+.004,.032],[dx+sw/2,bot+.004,.032],.0065,'c_leather',null,10)})}             // rounded fold
 // --- linen tray with wrapping-paper rolls and the pine sprig ---
 {const tx=.1,tz=.215,TW=.78,TD=.25,TH=.04,th=.014;box(I,[tx,0,tz],TW,.008,TD,{s:'linen'});
  box(I,[tx,0,tz+TD/2-th/2],TW,TH,th,{s:'linen'});box(I,[tx,0,tz-TD/2+th/2],TW,TH,th,{s:'linen'});
  for(const sx of [-1,1])box(I,[tx+sx*(TW/2-th/2),0,tz],th,TH,TD-2*th,{s:'linen'});
  roll([tx-.33,.008+.022,.13],[tx+.33,.008+.022,.13],.022,'roll_dark');
  roll([tx-.24,.008+.03,.18],[tx+.36,.008+.03,.18],.03,'roll_dark');
  roll([tx-.36,.008+.036,.25],[tx+.35,.008+.036,.25],.036,'roll_light');
  // pine sprig in 3D: twig stalk, bottle-brush branches with needles, berry cluster, pine cone
  {let sd=7;const rnd=()=>(sd=(sd*16807)%2147483647)/2147483647,P=(x,y,z)=>[tx+x,y,z];
   const sph=(c,r,k,k2)=>{const NA=8,NB=5;for(let i=0;i<NA;i++)for(let j=0;j<NB;j++){const a0=i/NA*6.283,a1=(i+1)/NA*6.283,b0=j/NB*3.1416-1.5708,b1=(j+1)/NB*3.1416-1.5708,
     v=(a,b)=>[cx+c[0]+r*Math.cos(b)*Math.cos(a),yT+c[1]+r*Math.sin(b),cz+c[2]+r*Math.cos(b)*Math.sin(a)];q(v(a0,b0),v(a1,b0),v(a1,b1),v(a0,b1),(j>2)?k:k2,.75+.35*(j/NB))}};
   const stalk=[P(-.52,.004,.36),P(-.36,.04,.31),P(-.2,.075,.27),P(-.08,.088,.24)];
   for(let i=0;i<3;i++)cyl(I,stalk[i],stalk[i+1],.0038,'c_twig',null,6);
   const bases=[[-.12,.086,.25],[-.1,.087,.25],[-.08,.088,.245],[-.06,.088,.24],[-.04,.089,.24],[-.02,.089,.235],[0,.09,.23],[.02,.09,.23],[-.05,.088,.25],[.03,.09,.235],[-.09,.087,.255],[.0,.09,.24]];
   const dirs=[[.22,.0,-.15],[.30,.0,-.11],[.36,.0,-.07],[.40,.0,-.02],[.34,.0,.05],[.24,.0,.08],[.18,.0,-.13],[.28,.0,-.1],[.14,.0,.09],[.30,.0,.0],[.12,.0,-.12],[.22,.0,.03]];
   for(let k=0;k<bases.length;k++){const b0=P(...bases[k]),d=dirs[k],L=Math.hypot(d[0],d[2]),e=[b0[0]+d[0],b0[1]+.004,b0[2]+d[2]];
    cyl(I,b0,e,.0022,'c_pine',null,4);
    const n=Math.round(L/.008);for(let s=1;s<=n;s++){const t=s/n,c=b0.map((v,i)=>v+(e[i]-v)*t),len=.036*(1-.5*t)+.006;
     for(let m=0;m<9;m++){const a=m/9*6.283+rnd()*.7,dx=d[0]/L,dz=d[2]/L,
       nx=-dz*Math.cos(a)*.9+dx*.45,ny=Math.sin(a)*.9,nz=dx*Math.cos(a)*.9+dz*.45;
       if(c[1]+ny*len<.068)continue;cyl(I,c,[c[0]+nx*len,c[1]+ny*len*.7,c[2]+nz*len],.0011,m%2?'c_pine':'c_pine2',null,3)}}}
   const ber=[[-.03,.1,.245],[-.01,.105,.235],[.01,.1,.25],[-.05,.095,.255],[.02,.108,.23],[.04,.1,.24],[-.02,.112,.22],[.0,.098,.265],[.06,.102,.225],[-.07,.094,.265],[.03,.096,.255],[-.04,.106,.23],[.05,.108,.212],[.08,.1,.21],[-.09,.092,.275],[.015,.115,.215],[-.06,.1,.24],[.07,.094,.24]];
   for(const c of ber){cyl(I,P(-.1,.088,.25),P(...c),.0012,'c_berry2',null,3);sph(P(...c),.0095+rnd()*.003,'c_berry','c_berry2')}
   {const c0=P(-.15,.092,.255),ax=[.05,.0,-.012];for(let r=0;r<9;r++){const t=r/8,rad=.022*Math.sin(.25+t*2.7),c=c0.map((v,i)=>v+ax[i]*t);
     for(let m=0;m<8;m++){const a=m/8*6.283+r*.4,p=[c[0],c[1]+Math.sin(a)*rad,c[2]+Math.cos(a)*rad];cyl(I,c,[p[0]+.006,p[1],p[2]],.005*(1-t*.4),r%2?'c_cone':'c_cone2',null,4)}}}}
  }
}
// Wallet counter behind the gifting table: light-wood top on a black frame with the black
// JACK STUDIO cloth hanging in front (photo), dressed like the wallet display photo - two linen
// trays (one raised on a black wire stand), black step racks of wallets, a chrome keychain spinner
// and a small easel card.
function walletCounter(cx,cz){
 const L=1.5,DP=.66,H=.9,front=cz+DP/2,back=cz-DP/2,y=H+.03,K='metal',lin='birch';
 box(cx,H+.015,cz,L+.04,.03,DP+.04,'birch',1.1);
 for(const sx of [-1,1])for(const z of [front-.02,back+.02])box(cx+sx*(L/2-.02),H/2,z,.04,H,.04,'metal',1);
 box(cx,H-.02,back+.02,L,.04,.04,'metal',1);box(cx,.03,back+.02,L,.04,.04,'metal',1);
 for(const sx of [-1,1])box(cx+sx*(L/2-.02),H/2,cz,.03,H-.05,DP-.04,'metal',.55);
 photoQuad('ct_front',[[cx-L/2,.0,front+.004],[cx+L/2,.0,front+.004],[cx+L/2,H,front+.004],[cx-L/2,H,front+.004]],.72);
 const tray=(x,yb,z,w,d)=>{box(x,yb+.004,z,w,.008,d,lin,.86);for(const [dx,dz,ww,dd] of [[0,d/2,w,.012],[0,-d/2,w,.012],[w/2,0,.012,d],[-w/2,0,.012,d]])box(x+dx,yb+.025,z+dz,ww,.05,dd,lin,.92)};
 const wallet=(x,yb,z,w,d,tex='darkleather')=>box(x,yb+.009,z,w,.018,d,tex,1);
 // front tray (on the counter) with wallets laid out in two rows
 const t1x=cx-.18,t1z=cz+.1;tray(t1x,y,t1z,.62,.3);
 for(let i=0;i<4;i++)wallet(t1x-.22+i*.12,y+.008,t1z-.07,.1,.12,i===1?'brownleather':'darkleather');
 for(let i=0;i<3;i++)wallet(t1x-.17+i*.16,y+.008,t1z+.07,.13,.1,i===1?'brownleather':'darkleather');
 // raised tray on a black wire stand, behind
 const t2x=cx-.05,t2z=cz-.13,t2y=y+.13;
 for(let i=0;i<5;i++)box(t2x-.26+i*.13,y+.065,t2z,.008,.13,.24,'metal',1);
 box(t2x,y+.004,t2z,.6,.008,.24,'metal',.9);tray(t2x,t2y,t2z,.62,.26);
 wallet(t2x+.12,t2y+.008,t2z+.03,.12,.09,'brownleather');wallet(t2x+.2,t2y+.008,t2z-.02,.12,.09,'darkleather');
 // keychain spinner + easel card on the raised tray
 const sx=t2x-.2,sz=t2z;box(sx,t2y+.15,sz,.01,.3,.01,'white',.95);
 for(let i=0;i<6;i++){const a=i/6*Math.PI*2;line3([sx,t2y+.27,sz],[sx+Math.cos(a)*.07,t2y+.25,sz+Math.sin(a)*.07],.006,'white');
  box(sx+Math.cos(a)*.07,t2y+.2,sz+Math.sin(a)*.07,.03,.08,.015,i%2?'darkleather':'brownleather',1)}
 box(t2x-.06,t2y+.07,t2z+.04,.08,.11,.006,'brownleather',1.15);line3([t2x-.06,t2y,t2z+.08],[t2x-.06,t2y+.12,t2z+.04],.006,'wood');
 // black step racks of standing wallets (left and right ends)
 const rack=(x,z,n,dir)=>{for(let i=0;i<n;i++){const zz=z-i*.05*dir,yy=y+.04+i*.025;box(x,yy+.05,zz,.11,.1,.016,'darkleather',.55-.02*i);box(x,yy,zz,.12,.004,.03,'metal',1)}
  line3([x-.06,y,z+.02*dir],[x-.06,y+.04+n*.025+.1,z-(n-1)*.05*dir],.006,'metal');line3([x+.06,y,z+.02*dir],[x+.06,y+.04+n*.025+.1,z-(n-1)*.05*dir],.006,'metal')};
 rack(cx-.6,cz+.18,5,1);rack(cx+.48,cz+.2,6,1);
 // price tags
 for(const [x,z] of [[cx-.6,cz+.25],[cx+.48,cz+.27],[t1x,t1z+.16]])box(x,y+.03,z,.08,.05,.006,'white',1.2);
}
// ESSENTIAL (left wall, by the entrance), from the store photo: lettering, MADE FOR EVERYDAY EASE
// poster, pegboard with belts and wallets (wall photo, mannequin painted out), the bust mannequin
// standing in front, and the tall black ladder shelf with its two rows of bags (photo cut-outs).
// Photo units: 350 px = 1 u, scaled by G; viewer faces -x, so photo-right is -z.
// ESSENTIAL corner (left wall, back), built from the straight-on store photo (500 px = 1 m at the
// shelf, 450 px = 1 m on the wall): ESSENTIAL lettering, framed poster, birch pegboard with ledges,
// wallets, waist bag and hanging belts, the bust mannequin on its red base, and the tall black
// ladder shelf (four birch shelves, LED strips, crossbar with the red JACK STUDIO sign, X bracing)
// with its three rows of bags standing on the shelves. Viewer faces -x, photo-right = -z.
function tube(p0,p1,r0,r1,col,mat=[0,0],N=12){const d=p1.map((v,i)=>v-p0[i]),L=Math.hypot(...d),n=d.map(v=>v/L);
 let u=Math.abs(n[1])<.9?[n[2],0,-n[0]]:[1,0,0];const ul=Math.hypot(...u);u=u.map(v=>v/ul);const w=crs(n,u);
 for(let i=0;i<N;i++){const a0=i/N*Math.PI*2,a1=(i+1)/N*Math.PI*2,R=(a,t)=>u.map((v,k)=>v*Math.cos(a)+w[k]*Math.sin(a));
  const P=(a,t,r)=>R(a).map((v,k)=>(t?p1[k]:p0[k])+v*r);const q=[[P(a0,0,r0),R(a0)],[P(a1,0,r0),R(a1)],[P(a1,1,r1),R(a1)],[P(a0,1,r1),R(a0)]];
  for(const id of [0,1,2,0,2,3])mpush(q[id][0],q[id][1],col,mat,[-1,-1])}}
function loft(cx,cz,rings,col,N=22){ // rings: [y, half-width (z), half-depth (x)]
 for(let j=0;j<rings.length-1;j++){const [y0,a0,b0]=rings[j],[y1,a1,b1]=rings[j+1];
  for(let i=0;i<N;i++){const t0=i/N*Math.PI*2,t1=(i+1)/N*Math.PI*2;
   const P=(y,a,b,t)=>[cx+Math.cos(t)*b,y,cz+Math.sin(t)*a],Nn=(a,b,t)=>{const v=[Math.cos(t)/b,0,Math.sin(t)/a],l=Math.hypot(...v);return v.map(x=>x/l)};
   const q=[[P(y0,a0,b0,t0),Nn(a0,b0,t0)],[P(y0,a0,b0,t1),Nn(a0,b0,t1)],[P(y1,a1,b1,t1),Nn(a1,b1,t1)],[P(y1,a1,b1,t0),Nn(a1,b1,t0)]];
   for(const id of [0,1,2,0,2,3])mpush(q[id][0],q[id][1],col,[0,0],[-1,-1])}}
 const [yt,at,bt]=rings[rings.length-1];for(let i=0;i<N;i++){const t0=i/N*Math.PI*2,t1=(i+1)/N*Math.PI*2;
  for(const p of [[cx,yt,cz],[cx+Math.cos(t0)*bt,yt,cz+Math.sin(t0)*at],[cx+Math.cos(t1)*bt,yt,cz+Math.sin(t1)*at]])mpush(p,[0,1,0],col,[0,0],[-1,-1])}}
// Bust mannequin modelled on the studio reference photo (sizes taken from it in px, 1310 px = full
// height): glossy mahogany two-step square base and turned baluster column, chrome pole, cream neck
// with an oval mahogany cap, boxy black long-sleeve with drop shoulders and ribbed cuffs, one arm
// hanging and one bent forward with jointed wooden hands, crossbody strap with buckle, a small black
// bag at the hip, tan leather tag, white chest print. Faces +x (the room); viewer's left is +z.
function dressForm(cx,cz,S,yaw=0){const c=Math.cos(yaw),sn=Math.sin(yaw),u=1.27*S/1310,Y=v=>(1440-v)*u,W=v=>v*u;
 const MAH=[.36,.07,.05],MAH2=[.42,.09,.06],CREAM=[.9,.87,.8],BLK=[.07,.07,.075],RIB=[.055,.055,.06],CH=[.82,.83,.85],HAND=[.2,.12,.09],TAN=[.85,.6,.38],id=(p,n)=>[p,n];
 XF=p=>{const dx=p[0]-cx,dz=p[2]-cz;return [cx+dx*c-dz*sn,p[1],cz+dx*sn+dz*c]};XFN=n=>[n[0]*c-n[2]*sn,n[1],n[0]*sn+n[2]*c];
 const P=(dx,y,dz)=>[cx+W(dx),Y(y),cz+W(dz)];
 // base: two square steps
 rbox(id,P(0,1418,0),[W(165),W(22),W(165)],W(6),MAH,null,[1,1,1]);rbox(id,P(0,1382,0),[W(128),W(15),W(128)],W(5),MAH2,null,[1,1,1]);
 // turned baluster column
 const col=[[1367,34],[1355,34],[1345,22],[1320,18],[1290,26],[1240,33],[1190,30],[1130,18],[1085,14],[1040,16],[1010,22],[995,22],[985,14],[968,12]];
 for(let i=0;i<col.length-1;i++)tube(P(0,col[i][0],0),P(0,col[i+1][0],0),W(col[i][1]),W(col[i+1][1]),MAH2,[0,0],16);
 tube(P(0,968,0),P(0,700,0),W(9),W(9),CH,[0,0],12);
 // torso in the sweatshirt: hem, boxy body, drop shoulders, neckline
 loft(cx,cz,[[Y(905),W(185),W(112)],[Y(895),W(188),W(114)],[Y(700),W(190),W(118)],[Y(480),W(195),W(122)],[Y(380),W(200),W(118)],[Y(330),W(185),W(100)],[Y(290),W(130),W(80)],[Y(262),W(68),W(55)]],BLK,28);
 for(let i=0;i<3;i++)loft(cx,cz,[[Y(905-i*4),W(186),W(113)],[Y(903-i*4),W(187),W(114)]],RIB,28);
 // neck and oval cap
 tube(P(0,265,0),P(0,178,0),W(52),W(50),CREAM,[0,0],18);
 loft(cx,cz,[[Y(182),W(72),W(48)],[Y(165),W(74),W(50)],[Y(150),W(70),W(47)],[Y(142),W(60),W(40)]],MAH,24);
 // arms: viewer-right (-z) hangs straight; viewer-left (+z) bends forward at the elbow
 const sleeve=(a,b,r0,r1)=>tube(a,b,r0,r1,BLK,[0,0],16);
 const shR=P(0,345,-185),elR=P(10,620,-215),wrR=P(25,870,-208);sleeve(shR,elR,W(56),W(50));sleeve(elR,wrR,W(50),W(42));
 tube(wrR,P(28,890,-207),W(43),W(40),RIB,[0,0],16);
 const shL=P(0,345,185),elL=P(-20,560,250),wrL=P(160,520,215);sleeve(shL,elL,W(56),W(50));sleeve(elL,wrL,W(50),W(42));
 tube(wrL,P(180,522,212),W(43),W(40),RIB,[0,0],16);
 // jointed wooden hands
 const hand=(base,dir,side)=>{const n=Math.hypot(...dir),d=dir.map(v=>v/n),L=W(95);
  const palm=base.map((v,i)=>v+d[i]*L*.55);tube(base,palm,W(26),W(30),HAND,[0,0],10);
  for(let f=0;f<4;f++){const off=(f-1.5)*W(15),q=[palm[0]+side[0]*off,palm[1]+side[1]*off,palm[2]+side[2]*off];
   tube(q,q.map((v,i)=>v+d[i]*L*.5),W(8),W(7),HAND,[0,0],6)}
  tube(base.map((v,i)=>v+d[i]*L*.2+side[i]*W(26)),base.map((v,i)=>v+d[i]*L*.55+side[i]*W(32)),W(8),W(7),HAND,[0,0],6)};
 hand(P(28,890,-207),[W(30),-W(100),W(5)],[0,0,1]);
 hand(P(180,522,212),[W(110),-W(10),-W(10)],[0,-1,0]);
 // crossbody strap, buckle, small bag at the hip, leather tag
 tube(P(70,300,-120),P(100,390,-150),W(10),W(10),[.05,.05,.055],[0,-1],6);
 tube(P(118,360,-150),P(125,640,170),W(11),W(11),[.05,.05,.055],[0,-1],6);
 rbox(id,P(108,335,-150),[W(4),W(16),W(26)],W(3),[.7,.7,.72],null,[1,1,1]);
 rbox(id,P(122,680,195),[W(30),W(55),W(42)],W(10),[.06,.06,.065],null,[1,1,1]);
 rbox(id,P(122,450,-105),[W(3),W(38),W(24)],W(4),TAN,null,[1,1,1]);
 XF=null;XFN=null;
 const q=SP.e3_print;if(q){const w=W(300),h=w*q.aspect,yc=Y(540),X0=W(127);const R=(dx,dz)=>[cx+dx*c-dz*sn,0,cz+dx*sn+dz*c];
  const pA=R(X0,w/2+W(10)),pB=R(X0,-w/2+W(10));photoQuad('e3_print',[[pA[0],yc-h/2,pA[2]],[pB[0],yc-h/2,pB[2]],[pB[0],yc+h/2,pB[2]],[pA[0],yc+h/2,pA[2]]],1)}}
function essentialZone(){
 const X=-5.43,K=228,zR=-8.8,Z=x=>zR+(1145-x)/K,Y=y=>(935-y)/K,id=(p,n)=>[p,n];
 const flat=(k,d,sh)=>{const m=SP[k];if(!m)return;const [x0,y0,x1,y1]=m.px;photoQuad(k,[[X+d,Y(y1),Z(x0)],[X+d,Y(y1),Z(x1)],[X+d,Y(y0),Z(x1)],[X+d,Y(y0),Z(x0)]],sh)};
 flat('tg_TEXT',.012,1.0);
 // poster in a black frame standing 25 mm off the wall
 {const zA=Z(430),zB=Z(612),yA=Y(476),yB=Y(233),b=.022,D=.025,zc=(zA+zB)/2,yc=(yA+yB)/2;
  box(X+.004,yc,zc,.008,yB-yA,zA-zB,'metal',.5);flat('tg_POSTER',.014,1.02);
  box(X+D/2,yB-b/2,zc,D,b,zA-zB,'metal',.9);box(X+D/2,yA+b/2,zc,D,b,zA-zB,'metal',.75);
  box(X+D/2,yc,zA-b/2,D,yB-yA,b,'metal',.85);box(X+D/2,yc,zB+b/2,D,yB-yA,b,'metal',.8)}
 // pegboard: birch ply on spacers, round holes, white ledges, card, wallets, waist bag, three belts
 {const zA=Z(338),zB=Z(692),yA=Y(607),yB=Y(490),zc=(zA+zB)/2,yc=(yA+yB)/2,F=X+.043;
  box(X+.034,yc,zc,.018,yB-yA,zA-zB,'birch',1.06);
  for(const z of [zA-.04,zB+.04])for(const y of [yA+.04,yB-.04])box(X+.015,y,z,.025,.03,.03,'birch',.8);
  const HS=(zA-zB)/22;for(let i=1;i<22;i++)for(let j=1;j*HS<yB-yA-.01;j++)disc((p,n)=>[[p[2],p[1],p[0]],[n[2],n[1],n[0]]],[zA-i*HS,yA+j*HS,F+.0003],.008,.001,[.16,.12,.08],[0,0]);
  const ledge=(a,b,y)=>{const z=(Z(a)+Z(b))/2,w=Z(a)-Z(b),yy=Y(y);box(X+.085,yy-.007,z,.085,.014,w,'white',1.05);
   for(const zz of [Z(a)-.02,Z(b)+.02])tube([F,yy-.03,zz],[F+.07,yy-.012,zz],.005,.005,[.85,.82,.75])};
  ledge(566,664,510);ledge(548,614,580);ledge(458,560,557);
  const prod=(k,x0,dep)=>{const m=SP[k];if(!m)return;const [a,b,c,d]=m.px,w=(c-a)/K,h=(d-b)/K,z=(Z(a)+Z(c))/2,y0=Y(d);
   if(dep>.02)rbox(id,[x0+dep/2,y0+h/2,z],[dep/2-.002,h/2*.8,w/2*.85],Math.min(.012,dep/3),m.col,null,[1,1,1]);
   photoQuad(k,[[x0+dep,y0,z+w/2],[x0+dep,y0,z-w/2],[x0+dep,y0+h,z-w/2],[x0+dep,y0+h,z+w/2]],1.0)};
  prod('tg_P1',F,.002);prod('tg_P2',X+.05,.07);prod('tg_P3',X+.06,.025);prod('tg_P4',X+.06,.025);prod('tg_P5',X+.06,.025);
  for(const k of ['tg_BL1','tg_BL2','tg_BL3']){const m=SP[k];if(!m)continue;const [a,b,c,d]=m.px;prod(k,F,.01);tube([F,Y(b)-.02,(Z(a)+Z(c))/2],[F+.05,Y(b)-.015,(Z(a)+Z(c))/2],.005,.005,[.8,.8,.8])}}
 // mannequin, facing the room
 MANQ={x:X+.85,z:Z(570),yaw:.12,h:1.47};   // GLB mannequin (assets/mannequin-data.js); dressForm() kept as fallback
 if(!window.JS_MAN)dressForm(X+.85,Z(570),1.16,.12);
 // tall shelf, 10 cm off the wall
 const D=.45,xb=X+.1,xf=xb+D,xm=(xf+xb)/2,zl=Z(722),zr=Z(1145),TOP=Y(45),BD=[235,425,680,905].map(Y);
 for(const z of [zl,zr])for(const x of [xf,xb])box(x,TOP/2,z,.04,TOP,.04,'metal',1);
 for(const x of [xf,xb])for(const y of [TOP-.02,Y(95)])box(x,y,(zl+zr)/2,.04,.04,zl-zr,'metal',1);
 for(const z of [zl,zr])for(const y of [TOP-.02,.08])box(xm,y,z,D,.035,.035,'metal',1);
 for(let y=.3;y<TOP-.2;y+=.3)box(xm,y,zr,D,.03,.03,'metal',1);            // ladder rungs on the right side
 for(const y of BD){box(xm,y-.018,(zl+zr)/2,D-.02,.036,zl-zr-.04,'birch',1.1)}
 for(const y of [BD[0],BD[1]])box(xf-.06,y-.04,(zl+zr)/2,.02,.008,zl-zr-.12,'white',1.7);
 const cb=Y(487);box(xf,cb,(zl+zr)/2,.035,.035,zl-zr,'metal',1);box(xb,cb,(zl+zr)/2,.035,.035,zl-zr,'metal',1);
 for(const [y0,y1] of [[cb,BD[2]],[BD[2],BD[3]]]){line3([xb+.01,y0-.02,zl-.03],[xb+.01,y1+.02,zr+.03],.014,'metal');line3([xb+.01,y1+.02,zl-.03],[xb+.01,y0-.02,zr+.03],.014,'metal')}
 {const m=SP.tg_SIGN;if(m){const [a,b,c,d]=m.px,zc=(Z(a)+Z(c))/2,w=(c-a)/K,h=(d-b)/K,yc=Y((b+d)/2);
  box(xf+.006,yc,zc,.006,h,w,'metal',.6);photoQuad('tg_SIGN',[[xf+.01,yc-h/2,zc+w/2],[xf+.01,yc-h/2,zc-w/2],[xf+.01,yc+h/2,zc-w/2],[xf+.01,yc+h/2,zc+w/2]],1.05)}}
 // products: each in its place from the reference; raised ones stand on chrome stands at the back
 for(const [k,m] of Object.entries(SP)){if(!k.startsWith('tg_')||!'ABC'.includes(m.lv))continue;if(k==='tg_SIGN')continue;
  const [a,b,c,d]=m.px,w=(c-a)/K,h=(d-b)/K,z=(Z(a)+Z(c))/2,board=BD['ABC'.indexOf(m.lv)+1],lift=Y(d)-board,raised=lift>.05,
   yb=raised?Y(d):board+.003,x=raised?xm+.05:xm-.09;
  if(k!=='tg_B1'){const dp=Math.min(.12,w*.4);rbox(id,[x-dp/2-.004,yb+h*.42,z],[dp/2,h*.32,w*.3],Math.min(.02,dp/3),m.col,null,[1,1,1])}
  sprite(x,z,w/2,yb,yb+h,k,1.04,Math.PI);
  if(raised){box(x+.03,(board+yb)/2,z,.012,yb-board,.012,'white',.95);box(x+.03,board+.004,z,.12,.008,.12,'white',1.1);box(x+.03,yb-.006,z,.012,.012,w*.5,'white',.95)}
  if(!raised&&k!=='tg_B1')box(xf-.012,board-.005,z,.004,.03,.07,'white',1.25);}
}
// Left wall from the entrance, built as real pieces (no photo rectangles):
// 1) BRAND PROMISE: wall lettering and the acrylic promise panel as cut-out graphics on the wall,
//    three wooden shelves in 3D with their products (photo cut-outs) standing on them, QR sign.
// 2) OUR STORY: wood-panelled wall under the staircase (3D stair mass), OUR STORY plaque, felt
//    panel, 185,249+ CUSTOMERS lettering, and three drawer units in 3D (no mannequins).
let LWX=-5.43;
function wallCard(k,zl,zr,yb,yt,sh=.86,off=.006){photoQuad(k,[[LWX+off,yb,zl],[LWX+off,yb,zr],[LWX+off,yt,zr],[LWX+off,yt,zl]],sh)}
function brandWalls(){
 LWX=-5.43+OS.SW;
 // ---- brand promise, laid out like the straight-on store photo (531 px = 1 m; middle shelf top 0.95 m)
 // raised black lettering (with a soft shadow), a 3D black OUR BRAND PROMISE plate, the clear acrylic
 // promise panel on four chrome stand-offs, QR card, three wooden floating shelves with the products.
 const P=450,z0=4.05,Z=x=>z0-(x-345)/P,Y=y=>.95+(1185-y)/P;
 const card=(k,off,sh)=>{const m=SP[k];if(!m)return;const [x0,y0,x1,y1]=m.px;wallCard(k,Z(x0),Z(x1),Y(y1),Y(y0),sh,off)};
 const shadow=(k)=>{const m=SP[k];if(!m)return;const [x0,y0,x1,y1]=m.px,d=.006;photoQuad(k,[[LWX+.004,Y(y1)-d,Z(x0)-d*.5],[LWX+.004,Y(y1)-d,Z(x1)-d*.5],[LWX+.004,Y(y0)-d,Z(x1)-d*.5],[LWX+.004,Y(y0)-d,Z(x0)-d*.5]],.62)};
 shadow('bw_logo');card('bw_logo',.012,1.0);card('bw_tag',.008,1.0);
 {const [x0,y0,x1,y1]=[760,328,1216,394];box(LWX+.012,(Y(y0)+Y(y1))/2,(Z(x0)+Z(x1))/2,.02,Y(y0)-Y(y1),Z(x0)-Z(x1),'metal',.55);
  card('bw_platetext',.024,1.05);for(const x of [770,1206])for(const y of [338,384])box(LWX+.024,Y(y),Z(x),.006,.008,.008,'white',.8)}
 {const [x0,y0,x1,y1]=[445,442,1560,852],zc=(Z(x0)+Z(x1))/2,yc=(Y(y0)+Y(y1))/2,w=Z(x0)-Z(x1),h=Y(y0)-Y(y1),PX=LWX+.045;
  // acrylic: only its polished edges and the stand-offs show; the print sits on the sheet
  for(const [dy,hh,dz,ww] of [[h/2,.006,0,w],[-h/2,.006,0,w],[0,h,w/2,.006],[0,h,-w/2,.006]])box(PX,yc+dy,zc+dz,.008,hh+.006,ww+.006,'glass',1.25);
  for(const x of [462,1532])for(const y of [452,842]){box(LWX+.024,Y(y),Z(x),.045,.022,.022,'white',.95);box(PX+.006,Y(y),Z(x),.006,.03,.03,'white',1.1)}
  card('bw_promise',.049,1.0)}
 {const [x0,y0,x1,y1]=[745,900,843,1040];box(LWX+.008,(Y(y0)+Y(y1))/2,(Z(x0)+Z(x1))/2,.006,Y(y0)-Y(y1),Z(x0)-Z(x1),'white',1.05);card('bw_qr',.012,1.02)}
 for(const [x0,x1,top] of [[345,612,1090],[657,1210,1188],[1230,1637,1010]]){const zc=(Z(x0)+Z(x1))/2,y=Y(top),w=Z(x0)-Z(x1);
  box(LWX+.13,y-.018,zc,.25,.036,w,'wood',1.08);box(LWX+.255,y-.018,zc,.004,.036,w,'wood',.82)}
 for(const [k,top] of [['bw_s1',1090],['bw_s2',1188],['bw_s3',1010]]){const m=SP[k];if(!m)continue;const [x0,y0,x1,y1]=m.px;
  sprite(LWX+.12,(Z(x0)+Z(x1))/2,(x1-x0)/P/2,Y(Math.max(y1,top)),Y(Math.max(y1,top))+(y1-y0)/P,k,1.04,Math.PI)}
 LWX=-5.43;
 { // ---- OUR STORY, built from the store photos (real-size metres; m = distance along the wall from
 // the wood panel's entrance-side edge). Under-stair wall with vertical wood planks, the white
 // staircase sloping over it, frosted acrylic OUR STORY plaque on stand-offs, 185,249+ CUSTOMERS
 // lettering, a 4x3 acoustic felt panel with alternating grooves, and the three drawer units.
 const {zs,W,m2,SW,d}=OS,ze=zs-W,Z=m=>zs-m,X=LWX;
 // wood planks: 0.32 m wide, vertical grain, varied by flipping, thin dark joints
 const PW=W/10,PH=.62;
 for(let i=0;i<10;i++){const m0=i*PW,m1=m0+PW,top0=d(m0),top1=d(m1),fl=i%2,vf=(i*7)%3;
  for(let y=0,j=0;y<top1-1e-3;y+=PH,j++){const yA=Math.min(y+PH,top0),yB=Math.min(y+PH,top1);if(y>=top0&&y>=top1)continue;
   const BL=[X+.012,y,Z(fl?m1:m0)],BR=[X+.012,y,Z(fl?m0:m1)],TR=[X+.012,fl?yA:yB,Z(fl?m0:m1)],TL=[X+.012,fl?yB:yA,Z(fl?m1:m0)];
   photoQuad('os_plank',(j+vf)%2?[TL,TR,BR,BL].map((p,k)=>[p[0],[BL,BR,TR,TL][k][1],p[2]]):[BL,BR,TR,TL],.92)}
  if(i>0)box(X+.013,d(m0)/2,Z(m0),.002,d(m0),.005,'wood',.42)}
 // the recess: sloped white stair underside across its depth, floor, end walls, dark storage at the low end
 // the stair: a white mass standing out SW from the wood, flush with the Brand Promise wall; its sloped
 // underside shows along the top of the wood; above the slope its face runs up to the ceiling
 for(let k=0;k<24;k++){const a=m2+(W-m2)*k/24,b=m2+(W-m2)*(k+1)/24;quad([X,d(a),Z(a)],[X,d(b),Z(b)],[X+SW,d(b),Z(b)],[X+SW,d(a),Z(a)],'white',.8)}
 quad([X+SW,d(m2),Z(m2)],[X+SW,d(W),Z(W)],[X+SW,4.06,Z(W)],[X+SW,4.06,Z(m2)],'wall',.865);
 quad([X,d(W),Z(W)],[X+SW,d(W),Z(W)],[X+SW,4.06,Z(W)],[X,4.06,Z(W)],'wall',.78);

 // OUR STORY: frosted acrylic, 0.64 x 0.66 m, 2 cm off the panel on four chrome stand-offs
 {const m0=1.12,m1=1.76,y0=1.15,y1=1.81,PX=X+.035;box(PX,(y0+y1)/2,Z((m0+m1)/2),.006,y1-y0,m1-m0,'white',.86);
  for(const m of [m0+.03,m1-.03])for(const y of [y0+.03,y1-.03]){box(X+.024,y,Z(m),.024,.018,.018,'white',1.0);box(PX+.005,y,Z(m),.006,.024,.024,'white',1.15)}
  photoQuad('os_plaque',[[PX+.004,y0,Z(m0)],[PX+.004,y0,Z(m1)],[PX+.004,y1,Z(m1)],[PX+.004,y1,Z(m0)]],1.0)}
 // WE'VE SERVED 185,249+ CUSTOMERS lettering
 {const q=SP.os_cust;if(q){const w=.62,h=w*q.aspect,mc=2.5,y0=2.06;photoQuad('os_cust',[[X+.016,y0,Z(mc-w/2)],[X+.016,y0,Z(mc+w/2)],[X+.016,y0+h,Z(mc+w/2)],[X+.016,y0+h,Z(mc-w/2)]],1.0)}}
 // acoustic felt panel: 4 x 3 tiles of 0.30 m, grooves alternate horizontal / vertical
 {const m0=1.9,y0=1.15,T=.3,F=X+.03;
  for(let r=0;r<3;r++)for(let c=0;c<4;c++){const mc=m0+c*T+T/2,yc=y0+(2-r)*T+T/2,horiz=(r+c)%2===0,zc=Z(mc);
   box(X+.02,yc,zc,.016,T-.004,T-.004,'white',.78);
   for(let k=0;k<9;k++){const o=-T/2+.012+k*(T-.024)/8;
    if(horiz)box(F,yc+o,zc,.01,.021,T-.008,'white',.9);else box(F,yc,zc-o,.01,T-.008,.021,'white',.86)}}}
 // drawer units: handle-less birch fronts with shadow gaps, black steel frames, mesh side, castors
 const D=.5,XF=X+.03+D,H=.9;
 const front=(m0,m1,y0,y1)=>{box(XF-.008,(y0+y1)/2,Z((m0+m1)/2),.016,y1-y0-.012,m1-m0-.012,'birch',1.08);box(XF-.017,y1-.004,Z((m0+m1)/2),.002,.008,m1-m0-.01,'metal',.55)};
 const castor=(m,xx)=>{box(xx,.045,Z(m),.035,.05,.018,'metal',.7);box(xx,.022,Z(m),.045,.045,.02,'metal',.45)};
 const top=(m0,m1)=>box(X+.03+D/2,H-.012,Z((m0+m1)/2),D+.01,.024,m1-m0,'birch',1.16);
 // 1) cabinet: two drawers over a pair of doors, solid to the floor
 {const m0=0,m1=.8;box(X+.03+D/2,(H+.08)/2,Z((m0+m1)/2),D-.02,H-.08,m1-m0,'birch',.98);top(m0,m1);
  front(m0,m1,.70,.86);front(m0,m1,.48,.70);front(m0,(m0+m1)/2,.08,.48);front((m0+m1)/2,m1,.08,.48);
  for(const m of [m0+.06,m1-.06])for(const xx of [X+.1,XF-.06])castor(m,xx)}
 // 2) & 3) desk units on black steel frames, open underneath
 for(const [m0,m1,fr] of [[.8,1.75,[[.66,.86],[.40,.66]]],[1.79,2.89,[[.70,.86],[.42,.68]]]]){const zc=Z((m0+m1)/2);
  box(X+.03+D/2,.63,zc,D-.04,.46,m1-m0-.04,'birch',.95);top(m0,m1);for(const [a,b] of fr)front(m0,m1,a,b);
  for(const m of [m0+.015,m1-.015])for(const xx of [X+.05,XF-.02]){box(xx,.45,Z(m),.03,.9,.03,'metal',1);castor(m,xx)}
  for(const m of [m0+.015,m1-.015])box(X+.03+D/2,.09,Z(m),D-.03,.025,.025,'metal',1);
  box(X+.05,.25,zc,.012,.3,m1-m0-.03,'metal',.5)}
 // mesh side panel on the right-hand unit
 box(X+.03+D/2,.48,Z(2.89-.012),D-.06,.78,.006,'metal',.45);

 }
}
// Ceiling, from the store walkthrough video: cream ceiling with a deep beam running along the top of
// each side wall and one cross beam, white conduit along the beams, black track lights (one track
// along each side about 0.9 m off the wall, cross tracks front and back) with round white spot heads,
// two white three-blade ceiling fans, and the big backlit JACK STUDIO / GENUINE LEATHER light box
// hanging on wires over the middle of the store.
function ceiling(){
 const C=4.054,BD=.42,BW=.38;
 for(const sx of [-1,1])box(sx*(5.43-BW/2),C-BD/2,(FRONT-10.22)/2,BW,BD,FRONT+10.22,'wall',.93);
 box(0,C-BD/2,.6,10.86,BD,.36,'wall',.93);
 quad([-5.43,C-BD-.002,.42],[5.43,C-BD-.002,.42],[5.43,C-BD-.002,.78],[-5.43,C-BD-.002,.78],'wall',.86);
 for(const sx of [-1,1]){const xa=sx*5.43,xb=sx*(5.43-BW);quad([xa,C-BD-.002,FRONT],[xb,C-BD-.002,FRONT],[xb,C-BD-.002,-10.22],[xa,C-BD-.002,-10.22],'wall',.86)}
 for(const sx of [-1,1])box(sx*(5.43-BW-.02),C-BD+.03,(FRONT-10.22)/2,.025,.025,FRONT+10.22,'white',1.05);
 const spot=(x,y,z,aim)=>{box(x,y-.03,z,.05,.06,.05,'metal',1);
  const h=[x+aim[0]*.08,y-.11,z+aim[2]*.08];tube([x,y-.06,z],h,.012,.012,[.08,.08,.09],[0,0],6);
  tube(h,[h[0]+aim[0]*.05,h[1]-.06,h[2]+aim[2]*.05],.045,.05,[.92,.92,.9],[0,0],12);
  disc((p,n)=>[[p[0],p[2],p[1]],[n[0],n[2],n[1]]],[h[0]+aim[0]*.05,h[2]+aim[2]*.05,h[1]-.061],.04,.002,[1.6,1.55,1.4],[0,0])};
 const track=(x0,z0,x1,z1,n,aim)=>{const y=C-.03;box((x0+x1)/2,y,(z0+z1)/2,Math.abs(x1-x0)+.035,.035,Math.abs(z1-z0)+.035,'metal',1);
  for(let i=0;i<n;i++){const t=(i+.5)/n;spot(x0+(x1-x0)*t,y,z0+(z1-z0)*t,aim)}};
 track(4.5,-9.6,4.5,FRONT-.6,16,[1,0,0]);track(-4.5,-9.6,-4.5,FRONT-.6,16,[-1,0,0]);
 track(-3.4,3.6,3.4,3.6,6,[0,0,-1]);track(-3.4,-8.6,3.4,-8.6,6,[0,0,-1]);
 // ceiling fans
 const fan=(x,z)=>{const W=[.93,.92,.88];tube([x,C,z],[x,C-.32,z],.018,.018,W,[0,0],8);
  loft(x,z,[[C-.4,.11,.11],[C-.34,.12,.12],[C-.31,.09,.09]],W,18);
  for(let k=0;k<3;k++){const a=k*2.094+.4,c=Math.cos(a),s=Math.sin(a);
   const P=(r,w)=>[x+c*r-s*w,C-.36,z+s*r+c*w];quad(P(.1,-.04),P(.68,-.07),P(.68,.07),P(.1,.04),'white',.95);quad(P(.1,.04),P(.68,.07),P(.68,-.07),P(.1,-.04),'white',.95)}};
 fan(2.3,1.9);fan(-2.0,-6.2);
 // backlit light box on four wires: centred over the middle of the store, long side across the room,
 // print reading the right way up for someone walking in from the entrance
 {const y=C-.5,cx=0,cz=-2.9,Wx=4.4,Lz=5.4;   // spans the ceiling between the side tracks
  box(cx,y+.012,cz,Wx-.02,.02,Lz-.02,'metal',.55);
  LBQ=[[cx-Wx/2,y-.004,cz-Lz/2],[cx+Wx/2,y-.004,cz-Lz/2],[cx+Wx/2,y-.004,cz+Lz/2],[cx-Wx/2,y-.004,cz+Lz/2]];   // HD print, own texture
  for(const dx of [-1,1])for(const dz of [-1,1])box(cx+dx*(Wx/2-.3),(y+.02+C)/2,cz+dz*(Lz/2-.3),.006,C-y-.02,.006,'metal',.6)}
}
function travelZone(){
const W=5.43,FR=W-.45;
const K=4.055/2.78,ZA=-10.06;XF=p=>[W+(p[0]-W)*K,p[1]*K,ZA+(p[2]-ZA)*K];
const BW=1.083,frames=[ZA,ZA+BW,ZA+2*BW];
const tops=[[2.55,2.4],[2.71,2.56],[2.55,2.4]];          // middle frame tallest, as in the photo
const post=(x,z,h)=>box(x,h/2,z,.035,h,.035,'metal',1);
frames.forEach((z,i)=>{const [hf,hb]=tops[i];post(FR,z,hf);post(W-.02,z,hb);line3([FR,hf,z],[W-.02,hb,z],.03,'metal');
 for(let y=.3;y<=2.42;y+=.27)box((FR+W)/2,y,z,.43,.025,.025,'metal',1)});
const cx=(FR+W)/2,DECK=.05,SH={A:.90,B:1.64,C:2.228};
for(let bay=0;bay<2;bay++){const z0=frames[bay],zc=z0+BW/2,len=BW-.04;
 box(cx,DECK,zc,.48,.04,len,'birch',1.05);box(cx+.22,.025,zc,.03,.05,len,'birch',.8);
 for(const y of [SH.A,SH.B,SH.C]){box(cx-.01,y-.014,zc,.48,.028,len,'birch',1.1);box(FR+.07,y-.036,zc,.02,.01,len-.08,'white',1.6)}
 line3([W-.03,SH.A+.04,z0+.03],[W-.03,SH.B-.06,z0+BW-.03],.012,'metal');line3([W-.03,SH.B-.06,z0+.03],[W-.03,SH.A+.04,z0+BW-.03],.012,'metal');
}
// deck: cabin cases in the same order as the photo
const cz=t=>frames[0]+t*BW*2,dy=DECK+.02;
[['white',.135],['lav',.365],['grey',.635],['orange',.865]].forEach(([c,f])=>suitcase(cx-.17,dy,cz(f),c));
// products: straight-on photo cut-outs, placed at their measured positions (metres from the
// left ladder frame). Items standing on a shelf are seated on it; raised/hanging ones keep their height.
for(const [k,m] of Object.entries(SP)){if(!m.shelf||k==='a_left2'||k==='a_left1'||k.startsWith('u'))continue;
 const zc=frames[0]+(m.z[0]+m.z[1])/2,hw=(m.z[1]-m.z[0])/2,h=m.y[1]-m.y[0],gap=m.y[0]-SH[m.shelf];
 const y0=Math.abs(gap)<.06?SH[m.shelf]:m.y[0],crate=k==='b_crate'||k==='b_olivecrate';
 sprite(crate?cx-.05:cx-.02-m.order*.002,zc,hw,y0,y0+h,k,1.05,!crate);
 if(k==='b_crate')box(cx+.15,y0+.15,zc,.2,.3,hw*1.9,'crate',.92);
 if(k==='b_olivecrate')box(cx+.15,y0+.14,zc,.2,.28,hw*1.8,'crate',.92);
}
// the three Daily Sling Bags on the right of the left bay
{const zb=frames[0];box(cx+.03,SH.A+.035,zb+.68,.10,.07,.17,'metal',.8);
 // one whole product photo per bag (front-facing card), sized from the photo: 28 cm wide
 const sb=(x,y,z,k)=>{const m=SP['sling_'+k];if(m)sprite(x,z,m.w/2,y,y+m.h,'sling_'+k,1.05,true)};
 // black bag hangs on the chrome stand: its strap goes up from both tabs and over the stand's top bar
 {const zc=zb+.84,top=SH.A+.506,m=SP.sling_black,bx=cx-.01,y0=top-.05-m.h,yt=y0+m.h-.012,id=(p,n)=>[p,n],K=[.12,.11,.10];
  sprite(bx,zc,m.w/2,y0,y0+m.h,'sling_black',1.05,false);
  const L=[bx+.004,yt,zc-.104],R=[bx+.004,yt,zc+.098],TL=[cx+.04,top+.012,zc-.014],TR=[cx+.04,top+.012,zc+.014];
  const st=(a,b)=>{const d=b.map((v,i)=>v-a[i]);bar(id,a,b,crs(d,[1,0,0]),.024,.004,K,LEA)};
  st(L,TL);st(TL,TR);st(TR,R);
  const mid=L.map((v,i)=>v+(TL[i]-v)*.45),d=n3(TL.map((v,i)=>v-L[i])),a=mid.map((v,i)=>v-d[i]*.013),b=mid.map((v,i)=>v+d[i]*.013);
  bar(id,a,b,crs(d,[1,0,0]),.032,.009,SILVER,MET);bar(id,a.map((v,i)=>v+d[i]*.003),b.map((v,i)=>v-d[i]*.003),crs(d,[1,0,0]),.034,.0095,K,LEA);}sb(cx+.03,SH.A+.07,zb+.68,'brown');sb(cx-.075,SH.A+.002,zb+.85,'dark');}
// the three hobo shoulder bags on the left of the left bay: one whole product photo each
{const zb=frames[0],id=(p,n)=>[p,n];
 box(cx+.045,SH.A+.035,zb+.405,.10,.07,.17,'metal',.8);
 const hb=(x,y,z,k,turn)=>{const m=SP['hobo_'+k];if(m)sprite(x,z,m.w/2,y,y+m.h,'hobo_'+k,1.05,turn);return m};
 hb(cx+.045,SH.A+.07,zb+.405,'brown',true);hb(cx-.075,SH.A+.002,zb+.225,'dark',true);
 // black one hangs on the stand: strap from both rings up and over the top bar
 const zc=zb+.17,top=SH.A+.486,m=SP.hobo_black;if(m){const bx=cx-.01,y0=top-.06-m.h;hb(bx,y0,zc,'metal',false);
  const rp=m.ring.map(([u,v])=>[bx+.004,y0+m.h*(1-v),zc-m.w/2+u*m.w]),TL=[cx+.04,top+.012,zc-.016],TR=[cx+.04,top+.012,zc+.016],K=[.12,.11,.10];
  const st=(a,b)=>{const d=b.map((v,i)=>v-a[i]);bar(id,a,b,crs(d,[1,0,0]),.03,.004,K,LEA)};st(rp[0],TL);st(TL,TR);st(TR,rp[1]);
  const mid=rp[1].map((v,i)=>v+(TR[i]-v)*.5),d=n3(TR.map((v,i)=>v-rp[1][i])),a=mid.map((v,i)=>v-d[i]*.014),b=mid.map((v,i)=>v+d[i]*.014);
  bar(id,a,b,crs(d,[1,0,0]),.038,.009,SILVER,MET);bar(id,a.map((v,i)=>v+d[i]*.003),b.map((v,i)=>v-d[i]*.003),crs(d,[1,0,0]),.04,.0095,K,LEA);}}
// chrome display stands behind the hanging bags (thin in the photo, so rebuilt in 3D)
for(const [z,t0] of [[.17,1.22],[.84,1.24],[1.24,1.2],[1.77,1.16]]){const top=t0-.734+SH.A;const zz=frames[0]+z;
 box(cx+.05,SH.A+.006,zz,.16,.012,.16,'metal',1.4);box(cx+.05,(SH.A+top)/2,zz,.014,top-SH.A,.014,'white',.9);box(cx+.05,top,zz,.014,.014,.2,'white',.9)}
// TRAVEL MOVEMENT wall: rectified photo of the lettering, cork map and pegboard
const ZP=frames[2]+.14,Y0=.36;
xpanel(W-.005,ZP-.11,ZP+1.29,Y0+1.0,Y0+2.2,'tm_upper',.76,1);
xpanel(W-.005,ZP-.11,ZP+1.29,Y0-.33,Y0+1.0,'tm_lower',.76,1);
suitcase(W-.31,0,ZP+.2,'orange');suitcase(W-.31,0,ZP+.72,'orange');
XF=null;
}
// ---------------------------------------------------------------------------------------------
// 29-inch UNBREAKABLE front-opening case, modelled in 3D (79 x 50 x 31 cm) and drawn with real
// lighting: rounded polycarbonate shell, moulded horizontal ribs, front lid standing proud on a
// black zip, expander zip round the waist, black wheel housings with 4 double spinner wheels,
// top carry handle, side feet and the logo badge. Only the white sticker print is a decal.
// ---------------------------------------------------------------------------------------------
const MV=[];   // lit mesh: pos3 normal3 colour3 rib2(v, strength) uv2  -> 13 floats per vertex
const LUGCOL={white:[.86,.85,.83],lav:[.74,.74,.80],grey:[.40,.42,.43],orange:[.80,.50,.37]};
let XFN=null;function mpush(p,n,c,rib,uv){if(XF)p=XF(p);if(XFN)n=XFN(n);MV.push(p[0],p[1],p[2],n[0],n[1],n[2],c[0],c[1],c[2],rib[0],rib[1],uv[0],uv[1])}
function arcAxis(h,r,mid,m=5){const a=[];for(let k=m;k>0;k--)a.push(-(h-r)-r*Math.tan(k/m*Math.PI/4));
 for(let k=0;k<=mid;k++)a.push(-(h-r)+2*(h-r)*k/mid);for(let k=1;k<=m;k++)a.push((h-r)+r*Math.tan(k/m*Math.PI/4));return a}
// rounded box in case-local coords (u across, v up, w toward the viewer); toW maps local -> world
function rbox(toW,c,h,r0,col,ribF,mids=[6,14,4]){
 // per-axis corner radius (an edge can't be rounder than the slab is thick)
 const r=h.map(v=>Math.min(r0,v*.98));
 // flat faces need no subdivision (rib shading is per pixel); corner segments scale with the radius
 const seg=v=>v>=.02?4:v>=.008?2:1,ax=[0,1,2].map(i=>arcAxis(h[i],r[i],1,seg(r[i])));
 const map=q=>{const inner=q.map((v,i)=>Math.max(-(h[i]-r[i]),Math.min(h[i]-r[i],v))),e=q.map((v,i)=>(v-inner[i])/r[i]),l=Math.hypot(...e)||1,u=e.map(v=>v/l);
  const nn=u.map((v,i)=>v/r[i]),nl=Math.hypot(...nn)||1;return [inner.map((v,i)=>c[i]+v+u[i]*r[i]),nn.map(v=>v/nl)]};
 for(let i=0;i<3;i++)for(const sg of [-1,1]){const j=(i+1)%3,k=(i+2)%3,A=ax[j],B=ax[k],G=[];
  for(const a of A){const row=[];for(const b of B){const q=[0,0,0];q[i]=sg*h[i];q[j]=a;q[k]=b;row.push(map(q))}G.push(row)}
  for(let x=0;x<A.length-1;x++)for(let y=0;y<B.length-1;y++){const t=[G[x][y],G[x+1][y],G[x+1][y+1],G[x][y+1]];
   for(const idx of [0,1,2,0,2,3]){const [pp,nn]=t[idx];const W=toW(pp,nn);mpush(W[0],W[1],col,ribF?ribF(pp,nn):[0,0],[-1,-1])}}}}
function cylU(toW,c,rad,len,col,seg=10){ // cylinder with its axle across the case (local u)
 for(let i=0;i<seg;i++){const a0=i/seg*Math.PI*2,a1=(i+1)/seg*Math.PI*2,P=(a,du)=>[c[0]+du,c[1]+Math.sin(a)*rad,c[2]+Math.cos(a)*rad],N=a=>[0,Math.sin(a),Math.cos(a)];
  const q=[[P(a0,-len/2),N(a0)],[P(a1,-len/2),N(a1)],[P(a1,len/2),N(a1)],[P(a0,len/2),N(a0)]];
  for(const idx of [0,1,2,0,2,3]){const W=toW(q[idx][0],q[idx][1]);mpush(W[0],W[1],col,[0,0],[-1,-1])}
  for(const du of [-len/2,len/2]){const hub=du>0?[.62,.63,.65]:[.55,.56,.58],cc=[c[0]+du,c[1],c[2]];
   const pts=[[cc,hub],[P(a0,du),col],[P(a1,du),col]];if(true){const ri=rad*.45;pts[0]=[cc,hub]}
   for(const [pp,cl] of [[cc,hub],[P(a0,du),col],[P(a1,du),col]]){const W=toW(pp,[Math.sign(du),0,0]);mpush(W[0],W[1],cl,[0,0],[-1,-1])}}}}
function suitcase(x,y,z,col,S=1){
 const W=.455*S,D=.28*S,H=.71*S,WH=.078*S,R=.034*S,bx=x+D/2,C=LUGCOL[col]||LUGCOL.orange,K=[.06,.06,.065],dk=[.12,.12,.13];
 const toW=(p,n)=>[[bx-p[2],y+p[1],z+p[0]],[-n[2],n[1],n[0]]];
 const LT=.03*S,FRONT=D/2,bodyF=FRONT-LT-.004*S;          // lid thickness, body front plane
 const ribs=(top,bot,edge)=>(p,n)=>{if(Math.abs(n[1])>.55)return [0,0];const v=p[1];
  const s=Math.min(1,Math.max(0,(v-bot)/.012),Math.max(0,(top-v)/.012));const e=edge?Math.min(1,Math.max(0,(edge-Math.abs(p[0]))/.008)):1;return [v,s*e]};
 // back shell + base (ribbed between a plain top band and a plain base band)
 const bH=(H-WH)/2,bC=WH+bH,bD=(bodyF+D/2)/2,bZc=(bodyF-D/2)/2;
 rbox(toW,[0,bC,bZc],[W/2,bH,bD],R,C,ribs(H-.045*S,WH+.055*S),[6,16,6]);
 // expander zip: black band round the waist of the shell
 rbox(toW,[0,bC,-.035*S],[W/2+.0025*S,bH+.0025*S,.006*S],R+.0025*S,K,null,[3,4,1]);
 // lid zip (black rubber rim) and the front lid itself
 const LW=W/2-.004*S,L0=.098*S,L1=H-.004*S,lC=(L0+L1)/2,lH=(L1-L0)/2;
 rbox(toW,[0,lC,bodyF+.006*S],[LW+.003*S,lH+.003*S,.008*S],R*.9,K,null,[3,4,1]);
 rbox(toW,[0,lC,FRONT-LT/2],[LW,lH,LT/2],R*.85,C,ribs(L1-.03*S,L0+.022*S,LW-.012*S),[8,18,2]);
 // logo badge (top right of the lid) and the sticker print decal
 rbox(toW,[LW-.075*S,L1-.12*S,FRONT+.002*S],[.016*S,.016*S,.003*S],.004*S,C.map(v=>v*.82),null,[1,1,1]);
 {const z0=FRONT+.0012*S,u0=-LW,u1=LW,v0=L0,v1=L1,c=[1,1,1],q=[[u0,v0,0,1],[u1,v0,1,1],[u1,v1,1,0],[u0,v1,0,0]];
  for(const idx of [0,1,2,0,2,3]){const [u,v,tu,tv]=q[idx],Wd=toW([u,v,z0],[0,0,1]);mpush(Wd[0],Wd[1],c,[0,0],[tu,tv])}}
 // base: front grip recess, black wheel housings, double spinner wheels
 rbox(toW,[0,WH+.03*S,bodyF+.004*S],[.075*S,.012*S,.006*S],.004*S,dk,null,[1,1,1]);
 for(const su of [-1,1])for(const sw of [-1,1]){const hu=su*(W/2-.047*S),hw=sw*(D/2-.055*S);
  rbox(toW,[hu,WH-.002*S,hw],[.042*S,.016*S,.045*S],.012*S,K,null,[2,1,2]);
  rbox(toW,[hu,.052*S,hw],[.016*S,.012*S,.016*S],.005*S,dk,null,[1,1,1]);
  for(const du of [-.0125,.0125])cylU(toW,[hu+du*S,.027*S,hw],.027*S,.016*S,[.08,.08,.09])}
 // top carry handle (towards the back) and the side feet
 rbox(toW,[0,H+.006*S,-D/2+.075*S],[.085*S,.01*S,.032*S],.008*S,K,null,[2,1,2]);
 for(const v of [.17,.6])for(const w of [-D/2+.06*S,bodyF-.05*S])rbox(toW,[-W/2-.004*S,v*S,w],[.006*S,.018*S,.012*S],.004*S,K,null,[1,1,1]);
}
// ---------------------------------------------------------------------------------------------
// Daily Sling Bag, modelled from the product photos (approx. 27 x 16 x 11.5 cm): rounded body,
// front flap with the diagonal lower edge wrapping over the top, diagonal zip pocket with metal
// teeth and puller, round JACK STUDIO badge, side zips with pullers, strap tabs with D-rings,
// adjustable strap with buckle. Colour per bag; leather grain and polished metal are shaded.
// ---------------------------------------------------------------------------------------------
const LEA=[0,-1],MET=[0,-2],SILVER=[.80,.81,.83];
const BAGCOL={black:[.16,.145,.13],brown:[.40,.24,.13],dark:[.29,.255,.235]};
function n3(a){const l=Math.hypot(...a)||1;return a.map(v=>v/l)}
function crs(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function prism(toW,ring,off,col,mat){const top=ring.map(p=>p.map((v,i)=>v+off[i])),all=ring.concat(top),C=[0,1,2].map(i=>all.reduce((s,p)=>s+p[i],0)/all.length);
 const tri=(a,b,c)=>{let n=n3(crs(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i])));const m=[0,1,2].map(i=>(a[i]+b[i]+c[i])/3-C[i]);if(n[0]*m[0]+n[1]*m[1]+n[2]*m[2]<0)n=n.map(v=>-v);for(const q of [a,b,c]){const W=toW(q,n);mpush(W[0],W[1],col,mat,[-1,-1])}};
 for(let i=1;i<ring.length-1;i++){tri(ring[0],ring[i],ring[i+1]);tri(top[0],top[i],top[i+1])}
 for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;tri(ring[i],ring[j],top[j]);tri(ring[i],top[j],top[i])}}
function bar(toW,a,b,wdir,wid,thk,col,mat){const d=b.map((v,i)=>v-a[i]),sv=n3(wdir).map(v=>v*wid/2),t=n3(crs(d,wdir)).map(v=>v*thk);
 const A=a.map((v,i)=>v-t[i]/2),B=b.map((v,i)=>v-t[i]/2);prism(toW,[A.map((v,i)=>v-sv[i]),A.map((v,i)=>v+sv[i]),B.map((v,i)=>v+sv[i]),B.map((v,i)=>v-sv[i])],t,col,mat)}
function disc(toW,c,rad,thk,col,mat,N=22){const ring=[];for(let i=0;i<N;i++){const a=i/N*Math.PI*2;ring.push([c[0]+Math.cos(a)*rad,c[1]+Math.sin(a)*rad,c[2]])}prism(toW,ring,[0,0,thk],col,mat)}
function slingBag(x,y,z,colName,opt={}){
 const C=BAGCOL[colName]||BAGCOL.black,W=.27,H=.16,D=.115,R=.024,e=.0035,toW=(p,n)=>[[x-p[2],y+p[1],z+p[0]],[-n[2],n[1],n[0]]];
 const U=px=>(px-405)/510*W,V=py=>(490-py)/305*H,F=D/2;
 rbox(toW,[0,H/2,0],[W/2,H/2,D/2],R,C,null,[6,6,4]);
 // flap: front panel with the diagonal lower edge, then wrapping over the top towards the back
 const ring=[[175,192],[615,192],[617,375],[600,412],[560,432],[530,428],[175,232]].map(([px,py])=>[U(px),Math.min(V(py),H-R),F+.0005]);
 prism(toW,ring,[0,0,e-.0005],C.map(v=>v*1.06),LEA);
 for(let i=6;i>2;i--){const a=ring[i],b=ring[i-1],d=b.map((v,k)=>v-a[k]),pn=n3(crs([0,0,1],d)).map(v=>-v*.003);
  bar(toW,a.map((v,k)=>k===2?F+.0003:v+pn[k]),b.map((v,k)=>k===2?F+.0003:v+pn[k]),crs(d,[0,0,1]),.006,.0004,C.map(v=>v*.3),LEA)}
 {const u0=U(175),u1=U(615),pr=[];for(let k=0;k<=8;k++){const t=k/8*Math.PI*.75;pr.push([H-R+(R+e)*Math.sin(t),(F-R)+(R+e)*Math.cos(t),Math.sin(t),Math.cos(t)])}
  for(let k=0;k<pr.length-1;k++){const [v0,w0,a0,b0]=pr[k],[v1,w1,a1,b1]=pr[k+1],w1b=k+1===pr.length-1?w1:w1;
   const q=[[u0,v0,w0,a0,b0],[u1,v0,w0,a0,b0],[u1,v1,w1b,a1,b1],[u0,v1,w1b,a1,b1]];
   for(const idx of [0,1,2,0,2,3]){const [uu,vv,ww,ny,nw]=q[idx],Wd=toW([uu,vv,ww],[0,ny,nw]);mpush(Wd[0],Wd[1],C.map(v=>v*1.06),LEA,[-1,-1])}}
  for(const uu of [u0,u1])for(let k=0;k<pr.length-1;k++){const [v0,w0]=pr[k],[v1,w1]=pr[k+1];const sgn=uu<0?-1:1;
   prism(toW,[[uu,v0,w0],[uu,v1,w1],[uu,H-R+(R)*Math.sin((k+1)/8*Math.PI*.75),(F-R)+R*Math.cos((k+1)/8*Math.PI*.75)],[uu,H-R+R*Math.sin(k/8*Math.PI*.75),(F-R)+R*Math.cos(k/8*Math.PI*.75)]],[sgn*.0015,0,0],C,LEA)}}
 // diagonal zip pocket: tape, metal teeth, slider and pull tab
 const za=[U(215),V(300),F],zb=[U(525),V(435),F];
 bar(toW,za,zb,[0,0,1].map((v,i)=>i===2?0:0).length?crs(zb.map((v,i)=>v-za[i]),[0,0,1]):[0,1,0],.011,.0016,C.map(v=>v*.55),LEA);
 bar(toW,za.map((v,i)=>i===2?v+.0012:v),zb.map((v,i)=>i===2?v+.0012:v),crs(zb.map((v,i)=>v-za[i]),[0,0,1]),.0035,.0018,SILVER,MET);
 bar(toW,[U(222),V(306),F+.002],[U(240),V(314),F+.002],[0,1,0],.009,.004,SILVER,MET);
 bar(toW,[U(230),V(318),F+.004],[U(230),V(386),F+.004],[1,0,0],.0105,.0018,SILVER,MET);
 bar(toW,[U(230),V(366),F+.0052],[U(230),V(378),F+.0052],[1,0,0],.005,.0008,[.05,.05,.05],LEA);
 // round JACK STUDIO badge on the flap
 disc(toW,[U(382),V(280),F+e],.0088,.0014,SILVER,MET);disc(toW,[U(382),V(280),F+e+.0014],.0068,.0006,[.07,.07,.075],MET);
 // side zips along the top of both side panels, pullers hanging at the front end
 for(const sg of [-1,1]){const uu=sg*(W/2+.0008),vv=H*.68;
  bar(toW,[uu,vv,-F+.025],[uu,vv,F-.02],[0,1,0],.009,.0016,C.map(v=>v*.55),LEA);
  bar(toW,[uu+sg*.001,vv,-F+.025],[uu+sg*.001,vv,F-.02],[0,1,0],.003,.0016,SILVER,MET);
  bar(toW,[uu+sg*.0025,vv+.004,F-.03],[uu+sg*.0025,vv-.034,F-.03],[0,0,1],.0105,.0018,SILVER,MET);}
 // strap tabs + D-rings, then the strap with an adjustable buckle
 const tab=[-.40*W,.36*W],ringV=H+.03,rings=[];
 for(const uu of tab){bar(toW,[uu,H-.012,0],[uu,H+.02,0],[1,0,0],.02,.004,C,LEA);
  for(const [a,b] of [[[uu-.013,ringV-.008,0],[uu+.013,ringV-.008,0]],[[uu-.013,ringV+.008,0],[uu+.013,ringV+.008,0]],[[uu-.013,ringV-.008,0],[uu-.013,ringV+.008,0]],[[uu+.013,ringV-.008,0],[uu+.013,ringV+.008,0]]])bar(toW,a,b,[0,0,1],.003,.003,SILVER,MET);
  rings.push([uu,ringV+.008,0])}
 let path;
 if(opt.hang!==undefined){const vt=opt.hang-y,wb=-.07;path=[[rings[0],[-.012,vt,wb]],[[.012,vt,wb],rings[1]]];}
 else{const p1=[-.07,H+.075,-.045],p2=[.07,H+.075,-.045];path=[[rings[0],p1],[p1,p2],[p2,rings[1]]];}
 const fw=(a,b)=>{const d=b.map((v,i)=>v-a[i]);return crs([d[0],d[1],0],[0,0,1])};
 for(const [a,b] of path)bar(toW,a,b,fw(a,b),.024,.004,C.map(v=>v*.9),LEA);
 {const [a,b]=path[0],m=a.map((v,i)=>v+(b[i]-v)*.55),d=n3(b.map((v,i)=>v-a[i])),s=[m.map((v,i)=>v-d[i]*.012),m.map((v,i)=>v+d[i]*.012)];
  bar(toW,s[0],s[1],fw(a,b),.031,.008,SILVER,MET);bar(toW,s[0].map((v,i)=>v+d[i]*.003),s[1].map((v,i)=>v-d[i]*.003),fw(a,b),.033,.0095,C.map(v=>v*.85),LEA);}
}
function bagZ(x,y,z,len,h,dep,tex){box(x,y+h/2,z,dep,h,len,tex,1);box(x-dep/2-.004,y+h*.62,z,.01,.018,len*.75,'brass',.9);
const t=y+h;line3([x,t,z-len*.25],[x,t+h*.6,z-len*.15],.016,tex);line3([x,t+h*.6,z-len*.15],[x,t+h*.6,z+len*.15],.016,tex);line3([x,t+h*.6,z+len*.15],[x,t,z+len*.25],.016,tex);}
function duffel(x,y,z,len,h,tex){box(x,y+h/2,z,h*.95,h,len,tex,1);box(x,y+h*.55,z,h*1.02,h*.7,len*.97,tex,.92);
box(x-h*.5,y+h*.55,z,.012,h*.42,len*.55,tex,.75);line3([x,y+h,z-.12],[x,y+h+.1,z],.02,tex);line3([x,y+h+.1,z],[x,y+h,z+.12],.02,tex);}
function backpack(x,y,z,w,h,tex){box(x,y+h/2,z,.2,h,w,tex,1);box(x-.12,y+h*.32,z,.06,h*.42,w*.78,tex,.9);box(x,y+h+.02,z,.12,.04,w*.82,tex,1.04);
line3([x,y+h+.03,z-.05],[x,y+h+.09,z],.014,tex);line3([x,y+h+.09,z],[x,y+h+.03,z+.05],.014,tex);}
function stand(x,y,z,h){box(x,y+.005,z,.12,.01,.12,'metal',1.2);box(x,y+h/2,z,.012,h,.012,'metal',1.3);}
function rack(side,z,photo,title){const x=side*5.13,front=side*4.71,W=3.08;
// wood wall backing and photo inset. The photos provide real bags, not a full-room illusion.
box(side*5.31,1.87,z,.13,3.62,3.56,'peg',1.0);
xpanel(x,z-W/2,z+W/2,.48,3.25,photo,1.08,side);
// Independent shelving geometry makes parallax visible when walking.
for(const zz of [z-1.57,z+1.57])box(front,1.83,zz,.49,3.25,.063,'metal',.79);
for(const yy of [.71,1.43,2.22,3.05])box(front,yy,z,.54,.095,3.2,'wood',.96);
box(front,3.52,z,.5,.06,3.2,'metal',.9);
// Branded category header above each shelving module.
const signTile='label_'+title.toLowerCase().replace(/ /g,'_');
xpanel(side*4.79,z-1.51,z+1.51,3.36,3.73,signTile,1.03,side);
// Side metal framing and suspended shelf lighting.
for(const zz of [z-1.55,z+1.55])box(side*4.48,2,zz,.055,3.5,.055,'metal',.84);
box(side*4.46,3.15,z,.23,.06,2.8,'white',1.2);
// Mesh product silhouettes in the foreground physically move relative to the photo texture.
for(let i=0;i<3;i++){
const dz=z-1.05+i*1.05;
let product=(title==='TRAVEL MOVEMENT'?'darkleather':i===1?'brownleather':'darkleather');
// Tiny depth-bearing handbags, intentionally spaced so the real photographed stock remains visible.
bag(side*4.4,1.07,dz,.34,.34,.22,product,true);
}
}
function bag(x,y,z,w,h,d,tex='darkleather',handle=true){
box(x,y,z,w,h,d,tex,.98);box(x,y+h*.26,z+d*.5+.018,w*.82,.03,.035,'brass',.92);
if(handle){const top=y+h/2;const a=[x-w*.23,top,z],b=[x-w*.22,top+.20,z],c=[x+w*.22,top+.20,z],end=[x+w*.23,top,z];line3(a,b,.026,tex);line3(b,c,.026,tex);line3(c,end,.026,tex)}
}
function island(x,z,title,variation){
const w=2.35,d=1.9;
// tabletop, legs, floating rack and two-sided composition.
box(x,.96,z,w,.14,d,'wood',1.09);
for(const xx of [-w/2+.15,w/2-.15])for(const zz of [-d/2+.12,d/2-.12])box(x+xx,.47,z+zz,.066,.87,.065,'metal',.87);
box(x,.65,z,1.75,.08,1.30,'wood',.84);
// High-end tabletop displays from bags and small leather goods, each spatial.
const items=[[-.76,-.54,.40,.45,'darkleather'],[-.1,-.5,.38,.38,'brownleather'],[.63,-.43,.48,.5,'darkleather'],[-.69,.48,.45,.45,'brownleather'],[.12,.44,.37,.35,'darkleather'],[.76,.41,.31,.33,'brownleather']];
for(const [xx,zz,ww,hh,tex] of items){const Y=1.05+hh/2;bag(x+xx,Y,z+zz,ww,hh,.22,tex,true)}
// Lower platform products visible from sides
for(const xx of [-.56,.52]){box(x+xx,.79,z,.62,.12,.43,'darkleather',.97)}
// side sign panel
const tex=variation===1?'label_craft_innovative':'label_craft_heritage';
zpanel(z+d/2+.03,x-1.08,x+1.08,.21,.48,tex,1.03);
}
buildWorld();
function mesh(V,U,S){const m={n:V.length/3};for(const [k,d,n] of [['p',V,3],['u',U,2],['s',S,1]]){m[k]=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,m[k]);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(d),gl.STATIC_DRAW)}return m}
function bindMesh(m){for(const [k,l,n] of [['p',loc.pos,3],['u',loc.uv,2],['s',loc.shade,1]]){gl.bindBuffer(gl.ARRAY_BUFFER,m[k]);gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,n,gl.FLOAT,false,0,0)}}
const worldMesh=mesh(verts,UVS,shades);
const litVS=`attribute vec3 aP,aN,aC;attribute vec2 aR,aT;uniform mat4 uVP;varying vec3 vW,vN,vC;varying vec2 vR,vT;void main(){gl_Position=uVP*vec4(aP,1.);vW=aP;vN=aN;vC=aC;vR=aR;vT=aT;}`;
const litFS=`precision highp float;varying vec3 vW,vN,vC;varying vec2 vR,vT;uniform vec3 uCam;uniform sampler2D uDec;uniform float uPer;
void main(){vec3 n=normalize(vN);float ao=1.;
 if(vR.y>.01){float ph=vR.x*6.2831853/uPer;n=normalize(n+vec3(0.,sin(ph)*.62*vR.y,0.));ao=1.-.16*vR.y*smoothstep(.55,1.,cos(ph));}
 float mat=vR.y<-1.5?2.:(vR.y<-.5?1.:0.);
 if(mat==1.){vec3 g=floor(vW*1700.);float h1=fract(sin(dot(g,vec3(12.9898,78.233,37.719)))*43758.5453),h2=fract(sin(dot(g,vec3(39.346,11.135,83.155)))*24634.6345);n=normalize(n+vec3(h1-.5,h2-.5,(h1+h2)*.5-.5)*.06);}
 vec3 V=normalize(uCam-vW),L1=normalize(vec3(.12,1.,.18)),L2=normalize(vec3(-1.,.45,.2)),H2=normalize(L2+V),H1=normalize(L1+V);
 float dif=.40+.40*max(dot(n,L1),0.)+.34*max(dot(n,L2),0.)+.06*max(-n.y,0.);
 float sp=.09*pow(max(dot(n,H2),0.),26.)+.06*pow(max(dot(n,H1),0.),40.);
 float rim=pow(1.-max(dot(n,V),0.),3.)*.08;
 vec3 col=vC*dif*ao+vec3(sp+rim);
 if(mat==1.)col=vC*dif+vec3(sp*1.8+rim*.6);
 if(mat==2.){float env=.55+.45*n.y;col=vC*(.30+.30*dif)*env+vec3(sp*9.+rim*2.5+.10*pow(max(dot(reflect(-V,n),L1),0.),6.));}
 if(vT.x>=0.){vec4 d=texture2D(uDec,vT);if(d.a<.5)discard;col=vec3(.95)*(.55+.45*dif)+vec3(sp*.6);}
 col=mix(col,vec3(.81,.78,.74),clamp((distance(vW,uCam)-10.)/24.,0.,.28));gl_FragColor=vec4(col,1.);}`;
const litProg=gl.createProgram();gl.attachShader(litProg,shader(gl.VERTEX_SHADER,litVS));gl.attachShader(litProg,shader(gl.FRAGMENT_SHADER,litFS));gl.linkProgram(litProg);
if(!gl.getProgramParameter(litProg,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(litProg));
const LL={P:gl.getAttribLocation(litProg,'aP'),N:gl.getAttribLocation(litProg,'aN'),C:gl.getAttribLocation(litProg,'aC'),R:gl.getAttribLocation(litProg,'aR'),T:gl.getAttribLocation(litProg,'aT'),
 vp:gl.getUniformLocation(litProg,'uVP'),cam:gl.getUniformLocation(litProg,'uCam'),dec:gl.getUniformLocation(litProg,'uDec'),per:gl.getUniformLocation(litProg,'uPer')};
const litBuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,litBuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(MV),gl.STATIC_DRAW);const litN=MV.length/13;let decTex=null;
function drawLit(){if(!litN)return;gl.useProgram(litProg);gl.bindBuffer(gl.ARRAY_BUFFER,litBuf);
 for(let i=0;i<8;i++)gl.disableVertexAttribArray(i);
 for(const [l,n,o] of [[LL.P,3,0],[LL.N,3,3],[LL.C,3,6],[LL.R,2,9],[LL.T,2,11]]){if(l<0)continue;gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,n,gl.FLOAT,false,52,o*4)}
 gl.uniformMatrix4fv(LL.vp,false,mvp);gl.uniform3f(LL.cam,cam.x,cam.y,cam.z);gl.uniform1f(LL.per,.0136);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,decTex);gl.uniform1i(LL.dec,0);
 gl.drawArrays(gl.TRIANGLES,0,litN);
 for(let i=0;i<8;i++)gl.disableVertexAttribArray(i);gl.useProgram(program)}
for(const s of SPR){const [U0,V0,U1,V1]=s.uv;for(const t of [[U0,V1],[U1,V1],[U1,V0],[U0,V1],[U1,V0],[U0,V0]]){sU.push(...t);sS.push(s.shade)}}
const spriteMesh=mesh(spriteGeometry(Math.PI/2),sU,sS);let lastSprCam='';
function updateSprites(){const k=cam.yaw.toFixed(3);if(k===lastSprCam)return;lastSprCam=k;gl.bindBuffer(gl.ARRAY_BUFFER,spriteMesh.p);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(spriteGeometry(cam.yaw)),gl.DYNAMIC_DRAW)}let atlasTex=null,spriteTex=null;
// Standard column-major camera/view matrix, all geometry positioned in world coordinates.
function perspective(fovy,aspect,near,far){const f=1/Math.tan(fovy/2),a=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*a,-1,0,0,2*far*near*a,0])}
function lookAt(eye,target){let z=[eye[0]-target[0],eye[1]-target[1],eye[2]-target[2]];let n=Math.hypot(...z);z=z.map(a=>a/n);let x=[z[2],0,-z[0]];n=Math.hypot(...x);x=x.map(a=>a/n);const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]),-(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]),-(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]),1])}
function mul(a,b){const o=new Float32Array(16);for(let col=0;col<4;col++)for(let row=0;row<4;row++){let v=0;for(let k=0;k<4;k++)v+=a[k*4+row]*b[col*4+k];o[col*4+row]=v}return o}
function project(m,x,y,z){const w=m[3]*x+m[7]*y+m[11]*z+m[15];if(w<=.01)return null;return {x:(m[0]*x+m[4]*y+m[8]*z+m[12])/w,y:(m[1]*x+m[5]*y+m[9]*z+m[13])/w,w};}
const cam={x:0,y:1.65,z:3.75,yaw:0,pitch:-.10};let mvp=null,last=performance.now(),keys=new Set(),auto=null,tour=false,tourPause=0,tourIndex=0,mouseDown=null,dragged=false,toastTimer=0,activeID='entrance';
const stops=[
 {id:'entrance',name:'Entrance',x:0,z:3.75,yaw:0,detail:'island',desc:'Welcome to the Jack Studio concept showroom.'},
 {id:'innovative',name:'Craft Innovative',x:-.9,z:1.7,yaw:.62,detail:'island',desc:'Walk around the central leather-goods display.'},
 {id:'urban',name:'Urban Carry',x:2.0,z:1.35,yaw:1.57,detail:'urban',desc:'Explore the everyday bag and backpack collection.'},
 {id:'craft',name:'Craft Heritage',x:1.55,z:-2.25,yaw:-1.57,detail:'heritage',desc:'Crazy Horse leather · made to age with character.'},
 {id:'professional',name:'Professional',x:2.2,z:-2.65,yaw:1.57,detail:'professional',desc:'Office-ready leather goods and work bags.'},
 {id:'travel',name:'Travel Movement',x:1.5,z:-7.0,yaw:1.57,detail:'travel',desc:'Travel bags, cabin luggage and accessories.'},
 {id:'counter',name:'Brand Wall',x:0,z:-8.7,yaw:0,detail:'counter',desc:'The JACK STUDiO brand wall.'},
 {id:'fashion',name:'Essential',x:-1.9,z:-7.0,yaw:-1.57,detail:'fashion',desc:'Discover the apparel and everyday collection.'},
 {id:'heritage',name:'Our Story',x:-2.3,z:-2.2,yaw:-1.57,detail:'heritage',desc:'How Jack Studio began, and the customers who are part of it.'},
 {id:'essential',name:'Brand Promise',x:-2.6,z:2.9,yaw:-1.57,detail:'essential',desc:'Our brand promise: more trust, more relevant, more personal.'},
];
const tourOrder=['entrance','innovative','urban','craft','professional','travel','counter','fashion','heritage','essential','entrance'];
function findStop(id){return stops.find(s=>s.id===id)||stops[0]}
function nearestStop(){let best=stops[0],d=Infinity;for(const s of stops){const d2=(cam.x-s.x)**2+(cam.z-s.z)**2;if(d2<d){d=d2;best=s}}return best}
function wrap(a){return Math.atan2(Math.sin(a),Math.cos(a))}
function updateArea(){if($('craftViews')&&!$('craftViews').hidden){$('areaTitle').textContent='Craft Heritage';return;}const s=nearestStop();if(s.id!==activeID){activeID=s.id;$('areaTitle').textContent=s.name;$('areaDescription').textContent=s.desc}}
function blocked(x,z,r=.32){if(Math.abs(x)>5.04-r||z< -9.52+r||z>FRONT-.25-r)return true;
// central island & service counter; white glass door not obstructed
for(const obj of [{x:.3,z:.35,w:.75,h:.62},{x:.3-.78,z:.31,w:.5,h:.42},{x:0,z:-2.25,w:1.22,h:2.92},{x:0,z:-5.8,w:1.6,h:.75},{x:0,z:-7.45,w:1.6,h:.75}])
if(Math.abs(x-obj.x)<obj.w/2+r&&Math.abs(z-obj.z)<obj.h/2+r)return true;
return false}
function moveSafely(dx,dz){const n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.045));for(let i=0;i<n;i++){if(!blocked(cam.x+dx/n,cam.z))cam.x+=dx/n;if(!blocked(cam.x,cam.z+dz/n))cam.z+=dz/n}}
function leaveCraftView(){if(!$('craftViews').hidden){$('craftViews').hidden=true;cam.pitch=-.12;}cam.y=1.65;}
function gridPath(tx,tz){tx=clamp(tx,-4.6,4.6);tz=clamp(tz,-9.04,FRONT-.6);const step=.4,nx=25,nz=46,x0=-4.8,z0=-9.1;
const ix=x=>Math.round(clamp((x-x0)/step,0,nx-1)),iz=z=>Math.round(clamp((z-z0)/step,0,nz-1));const cx=i=>x0+(i%nx)*step,cz=i=>z0+Math.floor(i/nx)*step;const nearestClear=(x,z)=>{let best=null,d=1e10;for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const px=x0+i*step,pz=z0+j*step;if(blocked(px,pz))continue;const v=(px-x)**2+(pz-z)**2;if(v<d){best=j*nx+i;d=v}}return best};
const start=nearestClear(cam.x,cam.z),goal=nearestClear(tx,tz);if(start===null||goal===null)return[];
const open=[start],came=new Int32Array(nx*nz).fill(-1),cost=new Float64Array(nx*nz).fill(Infinity),closed=new Set();cost[start]=0;
const score=i=>cost[i]+Math.hypot(cx(i)-cx(goal),cz(i)-cz(goal));
while(open.length){open.sort((a,b)=>score(b)-score(a));const c=open.pop();if(c===goal){const rev=[];let at=c;while(at!==-1){rev.push({x:cx(at),z:cz(at)});at=came[at]}rev.reverse();rev.shift();
// trim unnecessary grid corners with line-of-sight checks
const out=[];let base={x:cam.x,z:cam.z};for(let i=0;i<rev.length;){let j=rev.length-1;while(j>i&&!clearLine(base,rev[j]))j--;out.push(rev[j]);base=rev[j];i=j+1}
if(clearLine(base,{x:tx,z:tz}))out.push({x:tx,z:tz});return out;}
closed.add(c);const row=Math.floor(c/nx),col=c%nx;for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
const i=col+di,j=row+dj;if(i<0||i>=nx||j<0||j>=nz)continue;const id=j*nx+i;if(closed.has(id)||blocked(cx(id),cz(id)))continue;
if(di&&dj&&(blocked(x0+(col+di)*step,z0+row*step)||blocked(x0+col*step,z0+(row+dj)*step)))continue;
const newC=cost[c]+Math.hypot(di,dj);if(newC<cost[id]){cost[id]=newC;came[id]=c;if(!open.includes(id))open.push(id)}}}
return []}
function clearLine(a,b){const n=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/.11);for(let i=1;i<=n;i++){const t=i/n;if(blocked(lerp(a.x,b.x,t),lerp(a.z,b.z,t),.32))return false}return true}
function goTo(pos,opt={}){leaveCraftView();auto={path:gridPath(pos.x,pos.z),targetYaw:opt.yaw,forTour:!!opt.forTour};if(!auto.path.length){if(Number.isFinite(opt.yaw))cam.yaw=opt.yaw;auto=null;onArrive();}else if(!opt.forTour){tour=false;showTourButtons();$('status').innerHTML='<i></i> WALKING'} }
function stopAuto(){auto=null;tour=false;showTourButtons();$('status').innerHTML='<i></i> FREE WALK'}
function showTourButtons(){$('autoTour').hidden=tour;$('stopTour').hidden=!tour}
function beginTour(){tour=true;tourIndex=0;tourPause=0;showTourButtons();nextTour()}
function nextTour(){if(!tour)return;const id=tourOrder[++tourIndex];if(!id){stopAuto();return}const s=findStop(id);goTo(s,{yaw:s.yaw,forTour:true});$('status').innerHTML='<i></i> GUIDED WALK'}
function onArrive(){if(tour){tourPause=1.65;}else {$('status').innerHTML='<i></i> FREE WALK'} }
function setArea(id){const s=findStop(id);$('areaTitle').textContent=s.name;$('areaDescription').textContent=s.desc;activeID=s.id}
const spotNodes=[],mapStops=$('mapStops');
for(const s of stops){if(s.id==='entrance')continue;
 const spot=document.createElement('button');spot.className='navspot';spot.textContent='↑';spot.dataset.label=s.name;spot.title='Walk to '+s.name;spot.onclick=()=>{stopAuto();goTo(s,{yaw:s.yaw});setArea(s.id)};$('navspots').appendChild(spot);spotNodes.push({s,el:spot});
 const mp=document.createElementNS('http://www.w3.org/2000/svg','g');mp.classList.add('map-stop');mp.setAttribute('tabindex','0');mp.setAttribute('role','button');mp.setAttribute('aria-label','Walk to '+s.name);const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('cx',102+s.x*13.9);c.setAttribute('cy',130+s.z*11.7);c.setAttribute('r',6);mp.appendChild(c);mp.addEventListener('click',()=>{stopAuto();goTo(s,{yaw:s.yaw});setArea(s.id)});mp.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();mp.dispatchEvent(new Event('click'))}});mapStops.appendChild(mp)
}
function updateOverlay(){if(!mvp)return;const width=canvas.clientWidth,height=canvas.clientHeight;for(const {s,el} of spotNodes){const p=project(mvp,s.x,.06,s.z),dist=Math.hypot(cam.x-s.x,cam.z-s.z);if(!p||Math.abs(p.x)>1.05||Math.abs(p.y)>1.05||dist<.58||dist>12){el.hidden=true;continue}el.hidden=false;el.style.left=((p.x+1)*.5*width)+'px';el.style.top=((1-p.y)*.5*height)+'px';el.style.opacity=Math.min(1,3.2/dist).toFixed(2)}
const map=$('mapDot');map.setAttribute('transform',`translate(${102+cam.x*13.9} ${130+cam.z*11.7}) rotate(${-cam.yaw*180/Math.PI})`);
}
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2100)}
function openPhoto(){const focused=!$('craftViews').hidden,stop=focused?findStop('craft'):nearestStop();$('photoTitle').textContent=stop.name;$('realPhoto').src=stop.id==='craft'?'assets/craft-'+(focused?activeCraftView:'front')+'.jpg':'assets/'+stop.detail+'.jpg';$('photoModal').hidden=false;keys.clear();stopAuto();}
$('viewPhoto').onclick=openPhoto;$('closePhoto').onclick=$('returnRoom').onclick=()=>$('photoModal').hidden=true;
$('help').onclick=()=>{keys.clear();stopAuto();$('helpModal').hidden=false;};document.addEventListener('visibilitychange',()=>{if(document.hidden)keys.clear()});
$('closeHelp').onclick=$('startFromHelp').onclick=()=>$('helpModal').hidden=true;
$('autoTour').onclick=beginTour;$('stopTour').onclick=stopAuto;$('restart').onclick=()=>{stopAuto();goTo(stops[0],{yaw:0});cam.pitch=-.08;setArea('entrance')};
let mapVisible=true;$('mapToggle').onclick=()=>{mapVisible=!mapVisible;$('floorMap').hidden=!mapVisible;$('mapContainer').querySelector('.mapFooter').hidden=!mapVisible;$('mapToggle').textContent=mapVisible?'⌄':'⌃'};
function normalizedPoint(e){const r=canvas.getBoundingClientRect();return {x:((e.clientX-r.left)/r.width)*2-1,y:1-((e.clientY-r.top)/r.height)*2}}
function floorClick(e){const n=normalizedPoint(e),aspect=canvas.clientWidth/canvas.clientHeight,tf=Math.tan(Math.PI/3.1/2);const forward=[Math.sin(cam.yaw)*Math.cos(cam.pitch),Math.sin(cam.pitch),-Math.cos(cam.yaw)*Math.cos(cam.pitch)],right=[Math.cos(cam.yaw),0,Math.sin(cam.yaw)],up=[-Math.sin(cam.yaw)*Math.sin(cam.pitch),Math.cos(cam.pitch),Math.cos(cam.yaw)*Math.sin(cam.pitch)];
const dir=forward.map((v,i)=>v+n.x*tf*aspect*right[i]+n.y*tf*up[i]);if(dir[1]>-.055){toast('Click a point on the floor to walk');return}const t=-cam.y/dir[1];if(t>80){toast('Choose a closer spot on the floor');return}const x=cam.x+dir[0]*t,z=cam.z+dir[2]*t;if(x < -5.2||x>5.2||z< -9.7||z>FRONT-.2)return;
stopAuto();goTo({x,z});}
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);mouseDown={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY};dragged=false;canvas.classList.add('dragging')});
canvas.addEventListener('pointermove',e=>{if(!mouseDown)return;const dx=e.clientX-mouseDown.lastX,dy=e.clientY-mouseDown.lastY;if(Math.hypot(e.clientX-mouseDown.x,e.clientY-mouseDown.y)>6)dragged=true;if(dragged){cam.yaw+=dx*.0042;cam.pitch=clamp(cam.pitch-dy*.0034,-1.05,1.05);if(tour)stopAuto()}mouseDown.lastX=e.clientX;mouseDown.lastY=e.clientY});
canvas.addEventListener('pointerup',e=>{canvas.classList.remove('dragging');if(mouseDown&&!dragged)floorClick(e);mouseDown=null});canvas.addEventListener('pointercancel',()=>{mouseDown=null;canvas.classList.remove('dragging')});
function moveKey(e,pressed){const key=e.key.toLowerCase();const mapped=key==='arrowup'?'w':key==='arrowdown'?'s':key==='arrowleft'?'q':key==='arrowright'?'e':key;if(['w','a','s','d','q','e','shift'].includes(mapped)){e.preventDefault();if(pressed){leaveCraftView();keys.add(mapped);if(tour||auto)stopAuto()}else keys.delete(mapped)}}
document.addEventListener('keydown',e=>{if($('photoModal').hidden&&$('helpModal').hidden)moveKey(e,true);if(e.key==='Escape'){$('photoModal').hidden=true;$('helpModal').hidden=true;stopAuto()}});document.addEventListener('keyup',e=>moveKey(e,false));
for(const btn of document.querySelectorAll('[data-key]')){const k=btn.dataset.key;btn.addEventListener('pointerdown',e=>{e.preventDefault();btn.setPointerCapture(e.pointerId);leaveCraftView();keys.add(k);stopAuto()});for(const evt of ['pointerup','pointercancel','lostpointercapture'])btn.addEventListener(evt,()=>keys.delete(k))}
function animate(dt){if(!$('photoModal').hidden||!$('helpModal').hidden)return;
let manual=false;
if(keys.has('q')){cam.yaw-=1.45*dt;manual=true}if(keys.has('e')){cam.yaw+=1.45*dt;manual=true}
let f=(keys.has('w')?1:0)-(keys.has('s')?1:0),r=(keys.has('d')?1:0)-(keys.has('a')?1:0);const mag=Math.hypot(f,r);if(mag){f/=mag;r/=mag;const spd=keys.has('shift')?4.1:2.45;const dx=(Math.sin(cam.yaw)*f+Math.cos(cam.yaw)*r)*spd*dt,dz=(-Math.cos(cam.yaw)*f+Math.sin(cam.yaw)*r)*spd*dt;
moveSafely(dx,dz);manual=true}
if(auto&&!manual){const next=auto.path[0];if(next){const dx=next.x-cam.x,dz=next.z-cam.z,dist=Math.hypot(dx,dz);if(dist<.08){auto.path.shift()}else{const speed=Math.min(dist,2.15*dt);const desired=Math.atan2(dx,-dz);cam.yaw+=wrap(desired-cam.yaw)*Math.min(1,dt*4.5);const px=cam.x+dx/dist*speed,pz=cam.z+dz/dist*speed;if(!blocked(px,pz,.21)){cam.x=px;cam.z=pz}else auto.path.shift()}}
if(auto.path.length===0){if(Number.isFinite(auto.targetYaw)){const diff=wrap(auto.targetYaw-cam.yaw);cam.yaw+=diff*Math.min(1,dt*4.2);if(Math.abs(diff)<.055){auto=null;onArrive()}}else{auto=null;onArrive()}}}
if(tour&&tourPause>0){tourPause-=dt;if(tourPause<=0)nextTour()}
updateArea();}
let lastOverlay=0;
function render(now){const dt=Math.min(.055,(now-last)/1000||.016);last=now;animate(dt);const dpr=Math.min(window.devicePixelRatio||1,1.6);const w=Math.round(canvas.clientWidth*dpr),h=Math.round(canvas.clientHeight*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h)}
gl.clearColor(.81,.79,.73,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
const fw=[Math.sin(cam.yaw)*Math.cos(cam.pitch),Math.sin(cam.pitch),-Math.cos(cam.yaw)*Math.cos(cam.pitch)];const proj=perspective(Math.PI/3.1,w/h,.09,75),view=lookAt([cam.x,cam.y,cam.z],[cam.x+fw[0],cam.y+fw[1],cam.z+fw[2]]);mvp=mul(proj,view);
gl.uniformMatrix4fv(loc.mvp,false,mvp);gl.uniform3f(loc.camera,cam.x,cam.y,cam.z);bindMesh(worldMesh);gl.bindTexture(gl.TEXTURE_2D,atlasTex);gl.uniform1f(loc.cut,-1.);gl.drawArrays(gl.TRIANGLES,0,worldMesh.n);if(lbMesh){bindMesh(lbMesh);gl.bindTexture(gl.TEXTURE_2D,lbTex);gl.drawArrays(gl.TRIANGLES,0,6)}if(proMesh){bindMesh(proMesh);gl.bindTexture(gl.TEXTURE_2D,proTex);gl.uniform1f(loc.cut,.5);gl.drawArrays(gl.TRIANGLES,0,proMesh.n);gl.uniform1f(loc.cut,-1.)}if(ucMesh){bindMesh(ucMesh);gl.bindTexture(gl.TEXTURE_2D,ucTex);gl.uniform1f(loc.cut,.5);gl.drawArrays(gl.TRIANGLES,0,ucMesh.n);gl.uniform1f(loc.cut,-1.)}if(chMesh){gl.uniform1f(loc.heritage,1.);bindMesh(chMesh);gl.bindTexture(gl.TEXTURE_2D,chTex);gl.uniform1f(loc.cut,.5);gl.drawArrays(gl.TRIANGLES,0,chMesh.n);gl.uniform1f(loc.heritage,0.);gl.uniform1f(loc.cut,-1.)}if(giftMesh){bindMesh(giftMesh);gl.bindTexture(gl.TEXTURE_2D,giftTex);gl.uniform1f(loc.cut,.5);gl.drawArrays(gl.TRIANGLES,0,giftMesh.n);gl.uniform1f(loc.cut,-1.)}if(manParts){gl.bindTexture(gl.TEXTURE_2D,manTex);gl.uniform1f(loc.cut,.5);for(const m of manParts){bindMesh(m);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.i);gl.drawElements(gl.TRIANGLES,m.n,gl.UNSIGNED_SHORT,0)}gl.uniform1f(loc.cut,-1.)}if(decTex)drawLit();if(spriteTex&&spriteMesh.n){updateSprites();bindMesh(spriteMesh);gl.bindTexture(gl.TEXTURE_2D,spriteTex);gl.uniform1f(loc.cut,.5);gl.drawArrays(gl.TRIANGLES,0,spriteMesh.n)}if(now-lastOverlay>45){updateOverlay();lastOverlay=now}if(window.vsPaused){window.vsResume=()=>{window.vsResume=null;last=performance.now();requestAnimationFrame(render)};return}requestAnimationFrame(render)}
function buildMan(){const J=window.JS_MAN,Q=MANQ;if(!J||!Q)return null;const dec=(b,T)=>{const r=atob(b),u=new Uint8Array(r.length);for(let i=0;i<r.length;i++)u[i]=r.charCodeAt(i);return new T(u.buffer)};
 const sc=Q.h/(J.meta.ytop-J.meta.ybot),c=Math.cos(Q.yaw),sn=Math.sin(Q.yaw);
 return J.parts.map(P=>{const ip=dec(P.p,Int16Array),iu=dec(P.u,Uint16Array),is=dec(P.s,Uint8Array),n=P.n,V=new Float32Array(n*3),U=new Float32Array(n*2),S=new Float32Array(n);
  for(let k=0;k<n;k++){const mx=ip[k*3]/16000*sc,my=(ip[k*3+1]/16000-J.meta.ybot)*sc,mz=ip[k*3+2]/16000*sc;
   // model faces +z -> world +x (the room), then the small extra turn
   const wx=mz,wz=-mx;V[k*3]=Q.x+wx*c+wz*sn;V[k*3+1]=my;V[k*3+2]=Q.z-wx*sn+wz*c;U[k*2]=iu[k*2]/65535;U[k*2+1]=iu[k*2+1]/65535;S[k]=is[k]/100}
  const m={n:P.m};for(const [k,d] of [['p',V],['u',U],['s',S]]){m[k]=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,m[k]);gl.bufferData(gl.ARRAY_BUFFER,d,gl.STATIC_DRAW)}
  m.i=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.i);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,dec(P.i,Uint16Array),gl.STATIC_DRAW);return m})}
function loadTex(url,fmt){return new Promise((ok,bad)=>{const im=new Image();im.onload=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,fmt,fmt,gl.UNSIGNED_BYTE,im);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.generateMipmap(gl.TEXTURE_2D);ok(t)};im.onerror=bad;im.src=url})}
function launch(){gl.activeTexture(gl.TEXTURE0);gl.uniform1i(loc.sampler,0);
Promise.all([loadTex(window.JS_ATLAS_URL,gl.RGB),window.JS_SPRITE_URL?loadTex(window.JS_SPRITE_URL,gl.RGBA).catch(()=>null):Promise.resolve(null),window.JS_DECAL_URL?loadTex(window.JS_DECAL_URL,gl.RGBA).catch(()=>null):Promise.resolve(null),window.JS_LIGHTBOX_URL?loadTex(window.JS_LIGHTBOX_URL,gl.RGB).catch(()=>null):Promise.resolve(null),window.JS_MAN_URL?loadTex(window.JS_MAN_URL,gl.RGBA).catch(()=>null):Promise.resolve(null),window.JS_GIFT_URL?loadTex(window.JS_GIFT_URL,gl.RGBA).catch(()=>null):Promise.resolve(null),window.JS_CH_URL?loadTex(window.JS_CH_URL,gl.RGBA).catch(()=>null):Promise.resolve(null),window.JS_UC_URL?loadTex(window.JS_UC_URL,gl.RGBA).catch(()=>null):Promise.resolve(null),window.JS_PRO_URL?loadTex(window.JS_PRO_URL,gl.RGBA).catch(()=>null):Promise.resolve(null)]).then(([a,b,c,d,e,f,g,h,i9])=>{if(i9&&PRV.length){proTex=i9;proMesh=mesh(PRV,PRU,PRS)}if(h&&UCV.length){ucTex=h;ucMesh=mesh(UCV,UCU,UCS)}if(g&&CHV.length){chTex=g;chMesh=mesh(CHV,CHU,CHS)}if(f&&GV.length){giftTex=f;giftMesh=mesh(GV,GU,GS)}if(e){manTex=e;manParts=buildMan()}atlasTex=a;spriteTex=b;decTex=c;if(d&&LBQ){lbTex=d;const P=[];for(const i of [0,1,2,0,2,3])P.push(...LBQ[i]);lbMesh=mesh(P,[0,1,1,1,1,0,0,1,1,0,0,0],[1.12,1.12,1.12,1.12,1.12,1.12])}gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);$('loading').hidden=true;setArea('entrance');last=performance.now();requestAnimationFrame(render)}).catch(()=>{$('loading').innerHTML='<div class="loadbox">Unable to load 3D textures. Extract the whole ZIP first.</div>'})}
launch();
let activeCraftView='front';
const craftViews={front:{x:1.85,y:2.05,z:-2.25,yaw:-Math.PI/2,pitch:-.50},back:{x:-1.7,y:2.05,z:-2.25,yaw:Math.PI/2,pitch:-.50},left:{x:1.50,y:1.95,z:-.75,yaw:-.7854,pitch:-.40},right:{x:1.5,y:1.95,z:-3.8,yaw:-2.372,pitch:-.40}};
function craftView(view){activeCraftView=view;stopAuto();keys.clear();Object.assign(cam,craftViews[view]||craftViews.front);const fit=Math.min(2.3,Math.max(1,1.6/(canvas.clientWidth/canvas.clientHeight)));cam.x*=fit;cam.z=-2.25+(cam.z+2.25)*fit;cam.y=1.05+(cam.y-1.05)*fit;setArea('craft');$('craftViews').hidden=false;for(const el of document.querySelectorAll('[data-craft-view]'))el.setAttribute('aria-pressed',String(el.dataset.craftView===view));}
$('focusCraft').onclick=()=>craftView('front');for(const el of document.querySelectorAll('[data-craft-view]'))el.onclick=()=>craftView(el.dataset.craftView);
if(location.hash.startsWith('#craft'))craftView(location.hash.split('-')[1]||'front');
})();
