/* TrackMeNow — map + live intelligence UI.
 * Map engine: MapLibre GL JS (WebGL). Basemaps are free raster tiles, live objects are
 * GPU-drawn GeoJSON layers. Only real source observations are drawn; the animation between
 * two polls is visual interpolation between two real positions, never invented movement. */
const API=(typeof location!=='undefined'&&location.origin&&!location.origin.startsWith('file:')?location.origin:'');
