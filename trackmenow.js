/* TrackMeNow entry — self-hosted MapLibre core (no external CDN) */
(async function(){
  const el=document.getElementById('status');
  try{
    const base=new URL('./',location.href).href;
    const parts=await Promise.all([0,1,2,3].map(async i=>{
      const r=await fetch(base+'trackmenow.core'+i+'.js?v=20261004c');
      if(!r.ok) throw new Error('core'+i+' HTTP '+r.status);
      return r.text();
    }));
    (0,eval)(parts.join(''));
  }catch(e){
    console.error('[TrackMeNow]',e);
    if(el) el.innerHTML='<span style="color:#ff6672">●</span> FAILED TO LOAD MAP CORE · '+String(e.message||e);
  }
})();
