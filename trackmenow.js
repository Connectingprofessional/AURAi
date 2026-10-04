/* TrackMeNow — MapLibre Global Intelligence entry (same-origin API, no Render). */
const API=(typeof location!=='undefined'&&location.origin&&!location.origin.startsWith('file:')?location.origin:'');
(async function loadTrackMeNowCore(){
  try{
    const base=new URL('.', location.href).href;
    const parts=await Promise.all([0,1,2].map(i=>fetch(base+'trackmenow.part'+i+'.js?v=20261004').then(r=>{if(!r.ok)throw new Error('part'+i+' HTTP '+r.status);return r.text()})));
    let src=parts.join('');
    src=src.replace(/^const API=[^;]*;/m,'');
    (0,eval)(src);
  }catch(e){
    console.error('[TrackMeNow] failed to load core', e);
    const el=document.getElementById('status');
    if(el) el.innerHTML='<span style="color:#ff6672">●</span> FAILED TO LOAD MAP CORE';
  }
})();
