/* TrackMeNow globe engine bootstrap.
 * Follows the supplied Vite architecture: persisted engine selection, URL view
 * preservation, WebGL capability check, async engine activation and flat fallback.
 * The repository uses its existing MapLibre/WebGL engine instead of importing
 * proprietary/unknown bundled assets.
 */
(function(){
  const ENGINE_KEY='atlas_engine_v1';
  const BETA_NOTE='atlas_globe_beta_note';

  function webglAvailable(){
    try{
      const c=document.createElement('canvas');
      return !!(c.getContext('webgl2')||c.getContext('webgl'));
    }catch(_){return false}
  }

  function readEngine(){
    try{return localStorage.getItem(ENGINE_KEY)==='globe'?'globe':'flat'}catch(_){return 'flat'}
  }

  function saveEngine(globe){
    try{localStorage.setItem(ENGINE_KEY,globe?'globe':'flat')}catch(_){}
    try{
      globe?sessionStorage.setItem(BETA_NOTE,'1'):sessionStorage.removeItem(BETA_NOTE);
    }catch(_){}
  }

  function preserveView(map){
    try{
      if(!map)return;
      const c=map.getCenter(), z=map.getZoom();
      if(Number.isFinite(c.lat)&&Number.isFinite(c.lng)&&Number.isFinite(z)){
        const u=new URL(location.href);
        u.searchParams.delete('globe');
        const hash=u.hash.replace(/^#/,'');
        const key=hash.includes('=')?hash.slice(0,hash.indexOf('=')):'';
        if(!key||key==='view')u.hash='view='+c.lat.toFixed(5)+','+c.lng.toFixed(5)+','+z.toFixed(2);
        history.replaceState(history.state,'',u.toString());
      }
    }catch(_){}
  }

  function switchEngine(globe,map){
    saveEngine(globe);
    preserveView(map);
    try{window.at&&window.at('engine_switch',{to:globe?'globe':'flat'})}catch(_){}
    if(!map)return;
    if(!webglAvailable()&&globe){
      console.warn('[globe] WebGL unavailable; keeping flat map');
      return false;
    }
    try{
      map.setProjection({type:globe?'globe':'mercator'});
      if(globe){
        try{sessionStorage.setItem(BETA_NOTE,'1')}catch(_){}
      }
      return true;
    }catch(e){
      console.error('[globe] engine switch failed:',e);
      return false;
    }
  }

  window.TrackMeNowGlobeEngine={
    key:ENGINE_KEY,
    webglAvailable,
    readEngine,
    saveEngine,
    preserveView,
    switchEngine
  };
})();