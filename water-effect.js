/* TrackMeNow Agua2D-inspired ocean renderer.
 * Independent implementation using Leaflet + WebGL2. No third-party proprietary
 * runtime or credentials. Ocean is animated procedurally and land is masked by
 * public country polygons.
 */
(function(){
  if(window.TrackMeNowWater) return;
  const state={canvas:null,gl:null,program:null,mask:null,maskCtx:null,raf:0,land:null,ready:false};
  const VS=`#version 300 es
  in vec2 p; out vec2 uv;
  void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
  const FS=`#version 300 es
  precision highp float; in vec2 uv; out vec4 outColor;
  uniform float t; uniform sampler2D mask;
  float n(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  void main(){
    float land=texture(mask,uv).r;
    vec2 p=uv*vec2(900.,500.);
    float a=sin(p.x*.055+t*.65)+sin(p.y*.075-t*.45);
    float b=sin((p.x+p.y)*.025+t*.32)+sin((p.x-p.y)*.018-t*.25);
    float wave=smoothstep(.15,.85,(a+b+4.)/8.);
    vec3 deep=vec3(.015,.10,.16), hi=vec3(.035,.24,.31);
    vec3 c=mix(deep,hi,wave);
    float glint=pow(max(0.,sin(p.x*.08+p.y*.035+t*1.4)),18.)*.22;
    c+=vec3(glint);
    float edge=1.-smoothstep(.0,.16,land);
    outColor=vec4(c,.20*edge);
  }`;
  function compile(gl,type,src){
    const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)||'shader');
    return s;
  }
  function resize(){
    if(!state.canvas)return;
    const d=devicePixelRatio||1,w=innerWidth*d,h=innerHeight*d;
    if(state.canvas.width!==w||state.canvas.height!==h){state.canvas.width=w;state.canvas.height=h;state.gl.viewport(0,0,w,h);state.mask.width=w;state.mask.height=h;renderMask();}
  }
  function project(lat,lon){
    if(!window.map)return null;
    const p=window.map.latLngToContainerPoint([lat,lon]);
    return [p.x,p.y];
  }
  function ring(ctx,coords){
    if(!coords.length)return;
    let started=false;
    for(const xy of coords){
      const p=project(xy[1],xy[0]); if(!p)continue;
      if(!started){ctx.moveTo(p[0],p[1]);started=true}else ctx.lineTo(p[0],p[1]);
    }
  }
  function renderMask(){
    if(!state.maskCtx||!state.land)return;
    const c=state.maskCtx;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,state.mask.width,state.mask.height);
    c.fillStyle='#fff';c.beginPath();
    for(const f of state.land.features||[]){
      const g=f.geometry;if(!g)continue;
      if(g.type==='Polygon')for(const r of g.coordinates){ring(c,r);c.closePath();}
      else if(g.type==='MultiPolygon')for(const poly of g.coordinates)for(const r of poly){ring(c,r);c.closePath();}
    }
    c.fill('nonzero');
    state.gl.bindTexture(state.gl.TEXTURE_2D,state.tex);
    state.gl.texImage2D(state.gl.TEXTURE_2D,0,state.gl.R8,state.gl.RED,state.gl.UNSIGNED_BYTE,state.mask);
  }
  function frame(ms){
    if(!state.ready)return;
    resize();
    const gl=state.gl;gl.useProgram(state.program);
    gl.uniform1f(state.ut,ms/1000);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,state.tex);
    gl.drawArrays(gl.TRIANGLES,0,3);
    state.raf=requestAnimationFrame(frame);
  }
  async function init(){
    if(!window.map||!window.L)return;
    const c=document.createElement('canvas');c.id='trackmenow-water-webgl';Object.assign(c.style,{position:'fixed',inset:'0',width:'100%',height:'100%',zIndex:'2',pointerEvents:'none',opacity:'.9'});
    document.body.appendChild(c);state.canvas=c;
    const gl=c.getContext('webgl2',{alpha:true,antialias:false});if(!gl){c.remove();return}state.gl=gl;
    const p=gl.createProgram();gl.attachShader(p,compile(gl,gl.VERTEX_SHADER,VS));gl.attachShader(p,compile(gl,gl.FRAGMENT_SHADER,FS));gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){c.remove();return}state.program=p;
    const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    state.ut=gl.getUniformLocation(p,'t');state.mask=document.createElement('canvas');state.maskCtx=state.mask.getContext('2d');
    state.tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,state.tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.uniform1i(gl.getUniformLocation(p,'mask'),0);
    try{const r=await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',{cache:'force-cache'});state.land=await r.json();resize();renderMask();state.ready=true;window.addEventListener('resize',resize);map.on('move zoom resize',renderMask);state.raf=requestAnimationFrame(frame);}
    catch(e){console.warn('[TrackMeNow water] land mask unavailable',e);c.remove();}
  }
  window.TrackMeNowWater={init};
  window.addEventListener('load',()=>setTimeout(init,1200));
})();