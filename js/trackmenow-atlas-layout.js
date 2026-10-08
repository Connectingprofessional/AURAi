/* TrackMeNow Atlas navigation. UI only; data toggles are dispatched to existing map/runtime. */
(function(){
  const transit=[
    ['✈','Airplane','flights','Live aircraft'],
    ['▤','Railway','railway','Live rail where source exists'],
    ['⚓','Ships','ships','AIS vessels'],
    ['▰','Bus','bus','Public buses'],
    ['🚕','Taxi','taxi','Available live feeds']
  ];
  const cameras=[
    ['●','Live','live','Public live streams'],
    ['▶','Recorded Feed','recorded','Recorded/archived feeds'],
    ['↗','Shared Feed','shared','User/shared camera links'],
    ['▧','Images','images','Still imagery']
  ];
  function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
  function cards(items,type){return items.map(x=>'<button class="tmx-card" data-tmx-type="'+type+'" data-tmx-layer="'+esc(x[2])+'"><div class="tmx-icon">'+x[0]+'</div><div class="tmx-name">'+esc(x[1])+'</div><div class="tmx-meta">'+esc(x[3])+'</div></button>').join('')}
  function panel(title,body){return '<div class="tmx-head"><div><div class="tmx-title">'+esc(title)+'</div><div class="tmx-kicker">MAP-FIRST INTELLIGENCE</div></div><button class="tmx-close" aria-label="Close">×</button></div><div class="tmx-content">'+body+'</div>'}
  function open(kind){
    const d=document.getElementById('tmx-detail'), c=document.querySelector('.tmx-content');
    d.classList.add('open');
    if(kind==='transit') d.innerHTML=panel('TRANSIT','<div class="tmx-section"><div class="tmx-sectionTitle">TRANSPORT</div><div class="tmx-grid">'+cards(transit,'transit')+'</div></div>');
    else if(kind==='cameras') d.innerHTML=panel('CAMERAS','<div class="tmx-section"><div class="tmx-sectionTitle">VISUAL SOURCES</div><div class="tmx-grid">'+cards(cameras,'camera')+'</div></div>');
    else d.innerHTML=panel(kind.toUpperCase(),'<div class="tmx-section"><div class="tmx-sectionTitle">LAYERS</div><div class="tmx-kicker">Select a layer to view available real data on the map.</div></div>');
    bind();
  }
  function dispatch(el){
    const detail={type:el.dataset.tmxType,layer:el.dataset.tmxLayer};
    window.dispatchEvent(new CustomEvent('trackmenow:layer-select',{detail}));
    document.querySelectorAll('.tmx-card').forEach(x=>x.classList.remove('active')); el.classList.add('active');
  }
  function bind(){
    document.querySelector('.tmx-close')?.addEventListener('click',()=>document.getElementById('tmx-detail').classList.remove('open'));
    document.querySelectorAll('.tmx-card').forEach(x=>x.addEventListener('click',()=>dispatch(x)));
  }
  function mount(){
    document.body.insertAdjacentHTML('afterbegin',
      '<div id="tmx-top"><strong>TRACK<span style="color:var(--tmx-cyan)">ME</span>NOW</strong><input class="tmx-search" placeholder="Search place, aircraft, ship, station, camera…" aria-label="Global search"><span class="tmx-status"><i></i>REAL DATA</span></div>'+
      '<div id="tmx-nav"><div id="tmx-navRail"><div class="tmx-logo">TRACK<b>ME</b>NOW</div>'+
      '<button class="tmx-railBtn" data-panel="space" title="Space">◎</button>'+
      '<button class="tmx-railBtn" data-panel="map" title="Map">◉</button>'+
      '<button class="tmx-railBtn" data-panel="weather" title="Weather">☁</button>'+
      '<button class="tmx-railBtn" data-panel="transit" title="Transit">✈</button>'+
      '<button class="tmx-railBtn" data-panel="cameras" title="Cameras">▣</button>'+
      '<button class="tmx-railBtn" data-panel="track" title="Track">⌖</button></div><div id="tmx-detail"></div></div>'+
      '<div id="tmx-bottom"><button class="tmx-mode active">MAP</button><button class="tmx-mode">SATELLITE</button><button class="tmx-mode">3D</button><button class="tmx-mode">RADAR</button><button class="tmx-mode">DAY / NIGHT</button></div>');
    document.querySelectorAll('.tmx-railBtn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tmx-railBtn').forEach(x=>x.classList.remove('active'));b.classList.add('active');open(b.dataset.panel)}));
    document.querySelectorAll('.tmx-mode').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tmx-mode').forEach(x=>x.classList.remove('active'));b.classList.add('active');window.dispatchEvent(new CustomEvent('trackmenow:map-mode',{detail:{mode:b.textContent.trim()}}))}));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();