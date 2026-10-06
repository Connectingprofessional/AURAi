    geocode: function(value){ return tmApi('/api/integrations/geocode?q=' + encodeURIComponent(value)); },
    reverse: function(lat,lon){ return tmApi('/api/integrations/reverse?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon)); }
  };
  /* ───────── Live transport data ─────────
   * Authoritative path: real source -> server/API -> observation timestamp -> map.
   * The browser does not use GitHub snapshots as the transport source.
   * The map renders the latest authoritative source observation; it does not dead-reckon vehicles between observations.
   */
  const TP_API_BASE = window.TM_MOVEMENT_API_BASE || window.TM_API_BASE || 'https://wispy-bush-9aee.recreationeeraj.workers.dev';
  const TP = {
    kinds: {
      air: { label: 'AIR', noun: 'aircraft', layer: 'flights', icon: 'tm-air', color: '#58c8ff' },
      ships: { label: 'SHIPS', noun: 'vessels', layer: 'ships', icon: 'tm-ship', color: '#43e0a0' },
      transit: { label: 'TRANSIT', noun: 'vehicles', layer: 'transit', icon: 'tm-bus', color: '#ffb347' },
      rail: { label: 'RAIL', noun: 'trains', layer: 'rail', icon: 'tm-rail', color: '#ffcf66' },
      cells: { label: 'MOBILE', noun: 'tower cells', layer: 'cells', color: '#d28bff' }
    },
    on: { air: true, ships: true, transit: true, rail: true, cells: false },
    data: {}, err: {}, sel: null, follow: false, timer: null, refresh: null,
    lastFetch: 0, fetching: false, sources: []
  };

  function tpBbox() {
    if (!maplibre) return null;
    const b = maplibre.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
  }
  function tpLayers() {
    const layers = Object.keys(TP.on).filter(function(k){ return TP.on[k] && k !== 'cells'; })
      .map(function(k){ return TP.kinds[k].layer; });
    return Array.from(new Set(layers)).join(',');
  }
  function tpMovementUrl() {
    const bbox = tpBbox();
    if (!bbox) return null;
    return TP_API_BASE.replace(/\/$/, '') + '/api/movement?bbox=' + encodeURIComponent(bbox) +
      '&layers=' + encodeURIComponent(tpLayers() || 'flights,ships,rail,bus') + '&t=' + Date.now();
  }
  async function tpLoad() {
    if (!maplibre || TP.fetching) return;
    const url = tpMovementUrl(); if (!url) return;
    TP.fetching = true;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('movement API HTTP ' + r.status);
      const j = await r.json(), receivedAt = Date.now();
      const grouped = { air: [], ships: [], transit: [], rail: [] };
      (j.features || []).forEach(function(f) {
        const p = f.properties || {}, cat = String(p.category || p.kind || '').toLowerCase();
        const mode = String(p.mode || '').toLowerCase();
        const layer = String(p.layer || '').toLowerCase();
        const k = cat === 'flight' || cat === 'aircraft' || cat === 'air' || layer === 'flights' ? 'air'
          : cat === 'ship' || cat === 'vessel' || layer === 'ships' ? 'ships'
          : cat === 'rail' || mode === 'rail' || layer === 'rail' ? 'rail'
          : cat === 'public-transport' || cat === 'transit' || cat === 'bus' || mode === 'bus' || mode === 'transit' || layer === 'transit' || layer === 'public-transport' ? 'transit' : null;
        if (!k || !f.geometry || !Array.isArray(f.geometry.coordinates)) return;
        const c = f.geometry.coordinates;
        if (!Number.isFinite(Number(c[0])) || !Number.isFinite(Number(c[1]))) return;
        const props = Object.assign({}, p);
        props.i = grouped[k].length;
        props.h = Number(p.heading != null ? p.heading : p.bearing != null ? p.bearing : p.cog != null ? p.cog : 0) || 0;
        props.observedAt = p.observedAt || p.timestamp || p.last_contact || j.generatedAt || new Date(receivedAt).toISOString();
        props.sourceStatus = p.sourceStatus || p.status || 'LIVE';
        props.smoothing = 'none';
        grouped[k].push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [Number(c[0]), Number(c[1])] },
          properties: props
        });
      });
      TP.data = {};
      Object.keys(grouped).forEach(function(k) {
        TP.data[k] = {
          features: grouped[k],
          generatedAt: j.generatedAt || new Date(receivedAt).toISOString(),
          sources: j.sources || [],
          receivedAt: receivedAt
        };
      });
      TP.sources = j.sources || [];
      TP.err = {};
      TP.lastFetch = receivedAt;
    } catch(e) {
      TP.err.global = e.message || String(e);
    } finally { TP.fetching = false; }
    tpTick(); tpStatus();
  }
  function tpIcon(name, draw) {
    if (!maplibre || maplibre.hasImage(name)) return;
    const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
    x.fillStyle = TP.kinds[name === 'tm-air' ? 'air' : name === 'tm-ship' ? 'ships' : name === 'tm-rail' ? 'rail' : 'transit'].color;
    x.strokeStyle = 'rgba(0,10,20,.9)'; x.lineWidth = 1.6; x.lineJoin = 'round';
    x.beginPath(); draw.forEach(function(p,i){ i ? x.lineTo(p[0],p[1]) : x.moveTo(p[0],p[1]); }); x.closePath(); x.fill(); x.stroke();
    maplibre.addImage(name, x.getImageData(0,0,32,32));
  }
  let tpSimulationTimer = null, tpSimulationT0 = 0;
  function startTransportSimulation() {
    if (!maplibre) return;
    if (tpSimulationTimer) { clearInterval(tpSimulationTimer); tpSimulationTimer = null; }
    tpSimulationT0 = Date.now();
    const center = maplibre.getCenter();
    const seed = { air:[center.lng-8,center.lat+5], ships:[center.lng+6,center.lat-4], transit:[center.lng+1,center.lat+1], rail:[center.lng-1,center.lat-1] };
    const make = (k,i) => {
      const base=seed[k], tt=(Date.now()-tpSimulationT0)/1000, speed=(k==='air'?0.08:k==='ships'?0.025:k==='rail'?0.015:0.02);
      return {type:'Feature',geometry:{type:'Point',coordinates:[base[0]+Math.sin(tt*speed+i)*6,base[1]+Math.cos(tt*speed+i)*3]},properties:{i,h:(tt*speed*57.3+i*70)%360,name:'SIM-'+k.toUpperCase()+'-'+(i+1),observedAt:new Date().toISOString(),source:'SIMULATION',sourceStatus:'SIMULATION',simulation:true}};
    };
    Object.keys(seed).forEach(k=>{TP.on[k]=true;TP.data[k]={features:[make(k,0),make(k,1),make(k,2)],generatedAt:new Date().toISOString(),sources:[{layer:TP.kinds[k].layer,count:3,source:'SIMULATION',status:'simulation',observedAt:new Date().toISOString()}],receivedAt:Date.now()};});
    syncBar(); tpApply(); tpTick(); tpStatus();
    setStatus('TRANSPORT SIMULATION · clearly labelled SIMULATION · live feeds are not masked',true);
    tpSimulationTimer=setInterval(function(){
      Object.keys(seed).forEach(k=>{const d=TP.data[k];if(!d||!d.features)return;d.features.forEach((f,i)=>{const tt=(Date.now()-tpSimulationT0)/1000,speed=(k==='air'?0.08:k==='ships'?0.025:k==='rail'?0.015:0.02),base=seed[k];f.geometry.coordinates=[base[0]+Math.sin(tt*speed+i)*6,base[1]+Math.cos(tt*speed+i)*3];f.properties.h=(tt*speed*57.3+i*70)%360;f.properties.observedAt=new Date().toISOString();});d.receivedAt=Date.now();});
      tpTick(); tpStatus();
    },1000);
  }
  function tpSetup() {
    if (!maplibre) return;
    tpIcon('tm-air', [[16,2],[19,12],[30,19],[30,22],[19,19],[18,27],[23,30],[23,31],[16,29],[9,31],[9,30],[14,27],[13,19],[2,22],[2,19],[13,12]]);
    tpIcon('tm-ship', [[16,3],[23,13],[23,29],[9,29],[9,13]]);
    tpIcon('tm-bus', [[16,4],[27,28],[16,22],[5,28]]);
    tpIcon('tm-rail', [[6,8],[26,8],[26,25],[22,25],[20,29],[12,29],[10,25],[6,25]]);
    const empty = {type:'FeatureCollection',features:[]};
    ['air','ships','transit','rail'].forEach(function(k){
      if(!maplibre.getSource('tp-'+k)) maplibre.addSource('tp-'+k,{type:'geojson',data:empty});
      if(!maplibre.getLayer('tp-'+k)) maplibre.addLayer({id:'tp-'+k,type:'symbol',source:'tp-'+k,layout:{'icon-image':TP.kinds[k].icon,'icon-rotate':['get','h'],'icon-rotation-alignment':'map','icon-allow-overlap':true,'icon-ignore-placement':true,'icon-size':['interpolate',['linear'],['zoom'],1,.3,6,.55,11,.9]}});
      maplibre.on('click','tp-'+k,function(e){const f=e.features&&e.features[0];if(f)tpSelect(k,f.properties.i,false);});
      maplibre.on('mouseenter','tp-'+k,function(){maplibre.getCanvas().style.cursor='pointer';});
      maplibre.on('mouseleave','tp-'+k,function(){maplibre.getCanvas().style.cursor='';});
    });
    if(!maplibre.getSource('tp-cells')) maplibre.addSource('tp-cells',{type:'geojson',data:empty});
    if(!maplibre.getLayer('tp-cells')) maplibre.addLayer({id:'tp-cells',type:'circle',source:'tp-cells',layout:{visibility:'none'},paint:{'circle-radius':4,'circle-color':'#d28bff','circle-opacity':.5}});
    if(!maplibre.getSource('tp-sel')) maplibre.addSource('tp-sel',{type:'geojson',data:empty});
    if(!maplibre.getLayer('tp-sel')) maplibre.addLayer({id:'tp-sel',type:'circle',source:'tp-sel',paint:{'circle-radius':16,'circle-color':'rgba(0,0,0,0)','circle-stroke-width':2.5,'circle-stroke-color':'#fff'}});
    maplibre.on('dragstart',function(){if(TP.follow){TP.follow=false;tpCard();}});
    tpApply(); tpLoad();
    if(!TP.timer) TP.timer=setInterval(tpTick,1000);
    if(!TP.refresh) TP.refresh=setInterval(tpLoad,60000);
    maplibre.on('moveend',function(){tpLoad();});
  }
  function tpStop(){if(TP.timer)clearInterval(TP.timer);if(TP.refresh)clearInterval(TP.refresh);TP.timer=TP.refresh=null;TP.follow=false;const c=$('tm-tp-card');if(c)c.style.display='none';}
  function tpApply(){if(!maplibre)return;Object.keys(TP.on).forEach(function(k){if(maplibre.getLayer('tp-'+k))maplibre.setLayoutProperty('tp-'+k,'visibility',TP.on[k]?'visible':'none');});tpTick();tpStatus();}
  async function tpToggle(k){TP.on[k]=!TP.on[k];syncBar();if(TP.on[k]){setStatus('Loading '+TP.kinds[k].label.toLowerCase()+' from live movement API…',true);await tpLoad();}tpApply();}
  function tpStatus(){
    const act=Object.keys(TP.on).filter(function(k){return TP.on[k]&&k!=='cells';});if(!act.length)return;
    const parts=[],bad=[];
    function ageLabel(iso){
      if(!iso)return '—';
      const sec=Math.max(0,Math.round((Date.now()-Date.parse(iso))/1000));
      return sec<60?sec+'s':Math.floor(sec/60)+'m';
    }
    act.forEach(function(k){
      const d=TP.data[k],def=TP.kinds[k];
      if(d){
        const src=(d.sources||[]).find(function(x){return String(x.layer||'').toLowerCase()===String(def.layer||'').toLowerCase()||String(x.layer||'').toLowerCase()===k;});
        const observed=src&&src.observedAt ? src.observedAt : (d.features.reduce(function(m,f){const t=Date.parse(f.properties&&f.properties.observedAt||'');return Number.isFinite(t)&&t>m?t:m;},0)||null);
        const count=src&&Number.isFinite(Number(src.count))?Number(src.count):d.features.length;
        const source=src&&src.source?src.source:'server/API';
        const refreshAge=Math.max(0,Math.round((Date.now()-d.receivedAt)/1000));
        parts.push(def.label+' · '+count.toLocaleString()+' · '+source+' · OBS '+ageLabel(observed)+' · REF '+(refreshAge<60?refreshAge+'s':Math.floor(refreshAge/60)+'m'));
      } else bad.push(def.label+': '+(TP.err.global||'waiting for live API'));
    });
    setStatus(esc(parts.concat(bad).join(' · ')),!bad.length);
  }
  function tpPos(k,feature){const c=feature&&feature.geometry&&feature.geometry.coordinates;if(!c)return null;return [Number(c[0]),Number(c[1]),Number(feature.properties&&feature.properties.h||0)];}
  function tpTick(){
    if(!maplibre||!maplibre.isStyleLoaded||!maplibre.getSource('tp-sel'))return;
    ['air','ships','transit','rail'].forEach(function(k){const src=maplibre.getSource('tp-'+k),d=TP.data[k];if(!src)return;src.setData({type:'FeatureCollection',features:d&&TP.on[k]?d.features:[]});});
    const sel=maplibre.getSource('tp-sel'),cur=tpSelPos();
    sel.setData(cur?{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[cur[0],cur[1]]},properties:{}}]}:{type:'FeatureCollection',features:[]});
    if(cur&&TP.follow)maplibre.easeTo({center:[cur[0],cur[1]],duration:900,essential:true});
    if(cur)tpCard(true);