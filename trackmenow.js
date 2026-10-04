/* TrackMeNow — self-hosted compressed MapLibre core (GitHub Pages safe) */
(async function(){
  const el=document.getElementById('status');
  function fail(e){
    console.error('[TrackMeNow]',e);
    if(el) el.innerHTML='<span style="color:#ff6672">●</span> FAILED TO LOAD MAP CORE · '+String(e&&e.message||e);
  }
  try{
    const base=new URL('./',location.href).href;
    const [a,b]=await Promise.all([
      fetch(base+'trackmenow.core.a?v=1').then(r=>{if(!r.ok)throw new Error('core.a '+r.status);return r.text()}),
      fetch(base+'trackmenow.core.b?v=1').then(r=>{if(!r.ok)throw new Error('core.b '+r.status);return r.text()})
    ]);
    const bin=Uint8Array.from(atob(a+b),c=>c.charCodeAt(0));
    let src;
    if(typeof DecompressionStream!=='undefined'){
      const ds=new DecompressionStream('gzip');
      const stream=new Blob([bin]).stream().pipeThrough(ds);
      src=await new Response(stream).text();
    }else{
      throw new Error('Gzip decompress not supported in this browser');
    }
    (0,eval)(src);
  }catch(e){fail(e);}
})();
