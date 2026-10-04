/* TrackMeNow — map + live intelligence UI.
 * Map engine: MapLibre GL JS (WebGL). Basemaps are free raster tiles, live objects are
 * GPU-drawn GeoJSON layers. Only real source observations are drawn; the animation between
 * two polls is visual interpolation between two real positions, never invented movement. */
const API=(typeof location!=='undefined'&&location.origin&&!location.origin.startsWith('file:')?location.origin:'');
const $=id=>document.getElementById(id);
const search=$('search'), status=$('status'), coords=$('coords'), rightPanel=$('rightPanel');
function safe(v){return String(v??'—').replace(/[<>]/g,'')}

/* ───────────────────────── state ───────────────────────── */
const selected=new Set(['flights','ships','public-transport','cameras','cells','infrastructure','intelligence']);
const intelFilters=new Set(['power:nuclear','power:solar','power:wind','power:hydro','power:gas','power:coal','power:oil','power:biomass','power:geothermal','power:waste','power:other','datacenter:ai','datacenter:hyperscale','datacenter:other','dam:hydro','dam:supply','dam:irrigation','dam:flood','dam:other','network:ports','network:railway','network:cables','network:substation','network:line','network:tower','network:pole','resource:mining','resource:energy','resource:agro','resource:tech','resource:choke','resource:industry','hq:company','poi:embassy','poi:military','poi:hospital']);
const MOVING=new Set(['flights','ships','public-transport']);
let lastData=null, searchMarker=null, gpsMarker=null, sessionId=null, watchId=null;
let mapReady=false, baseIndex=1, globeOn=false, selKey=null;
const gpsTrack=[], fences=[];
try{globeOn=window.TrackMeNowGlobeEngine?.readEngine()==='globe'}catch(e){globeOn=false}
try{globeOn=localStorage.getItem('tm-globe')==='1'||globeOn}catch(e){}

/* ───────────────────────── map ───────────────────────── */
const BASES=[
  {name:'Satellite',layers:['base-satellite','base-labels']},
  {name:'Dark',layers:['base-dark','base-labels']},
  {name:'Terrain',layers:['base-terrain']}
];
const MAP_STYLE={version:8,
  projection:{type:'globe'},
  fog:{color:'#08131a','high-color':'#0a2230','space-color':'#02050b','horizon-blend':.16,range:[.5,10]},
  sources:{
    ocean:{type:'geojson',data:'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_ocean.geojson'},
    land:{type:'geojson',data:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson'},
    countries:{type:'geojson',data:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'},
    'solar-terminator':{type:'geojson',data:{type:'FeatureCollection',features:[]}},
    satellite:{type:'raster',tileSize:256,maxzoom:19,tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],attribution:'Esri World Imagery'},
    labels:{type:'raster',tileSize:256,maxzoom:19,tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],attribution:'Esri'},
    dark:{type:'raster',tileSize:256,maxzoom:19,tiles:['https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],attribution:'Esri World Dark Gray Base'},
    streets:{type:'raster',tileSize:256,maxzoom:19,tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],attribution:'© OpenStreetMap contributors'},
    terrain:{type:'raster',tileSize:256,maxzoom:17,tiles:['https://a.tile.opentopomap.org/{z}/{y}/{x}.png','https://b.tile.opentopomap.org/{z}/{y}/{x}.png','https://c.tile.opentopomap.org/{z}/{y}/{x}.png'],attribution:'© OpenTopoMap (CC-BY-SA)'}
  },
  layers:[
    {id:'bg',type:'background',paint:{'background-color':'#05070b'}},
    {id:'globe-ocean',type:'fill',source:'ocean',paint:{'fill-color':'#078eaa','fill-opacity':.88}},
    {id:'globe-land',type:'fill',source:'land',paint:{'fill-color':'#c7cfbd','fill-opacity':.86}},
    {id:'globe-borders',type:'line',source:'countries',paint:{'line-color':'#18262a','line-width':1.15,'line-opacity':.96}},
    {id:'base-satellite',type:'raster',source:'satellite',paint:{'raster-opacity':.24}},
    {id:'base-dark',type:'raster',source:'dark',layout:{visibility:'none'},paint:{'raster-opacity':.96}},
    {id:'base-labels',type:'raster',source:'labels',paint:{'raster-opacity':.92}},
    {id:'base-streets',type:'raster',source:'streets',layout:{visibility:'none'}},
    {id:'base-terrain',type:'raster',source:'terrain',layout:{visibility:'none'}},
    {id:'solar-night',type:'fill',source:'solar-terminator',paint:{'fill-color':'#02050b','fill-opacity':.38}},
    {id:'solar-terminator-line',type:'line',source:'solar-terminator',paint:{'line-color':'#8fd9ff','line-width':1.15,'line-opacity':.7}}
  ]};
