/* TrackMeNow — MapLibre Global Intelligence entry (same-origin API, no Render). */
const API=(typeof location!=='undefined'&&location.origin&&!location.origin.startsWith('file:')?location.origin:'');
(async function loadTrackMeNowCore(){
  try{
    const r=await fetch(new URL('trackmenow.full.js', location.href).href+'?v=20261004');
    if(!r.ok) throw new Error('HTTP '+r.status);
    let src=await r.text();
    src=src.replace(/^const API=[^;]*;/m,'');
    (0,eval)(src);
  }catch(e){
    console.error('[TrackMeNow] failed to load core', e);
    const el=document.getElementById('status');
    if(el) el.innerHTML='<span style="color:#ff6672">●</span> FAILED TO LOAD MAP CORE';
  }
})();
