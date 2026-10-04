/* TrackMeNow — MapLibre Global Intelligence (same-origin API, no Render). */
const API=(typeof location!=='undefined'&&location.origin&&!location.origin.startsWith('file:')?location.origin:'');
(async function loadTrackMeNowCore(){
  try{
    const base=new URL('.', location.href).href;
    const parts=await Promise.all([0,1,2,3,4,5].map(i=>
      fetch(base+'trackmenow.p'+i+'.js?v=20261004b').then(r=>{if(!r.ok)throw new Error('p'+i+' '+r.status);return r.text()})
    ));
    let src=parts.join('');
    src=src.replace(/^const API=[^;]*;/m,'');
    (0,eval)(src);
  }catch(e){
    console.error('[TrackMeNow] core load failed', e);
    const el=document.getElementById('status');
    if(el) el.innerHTML='<span style="color:#ff6672">●</span> FAILED TO LOAD MAP CORE';
  }
})();
