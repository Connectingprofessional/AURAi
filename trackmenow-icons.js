/* TrackMeNow icon registry — supplied SVG icon architecture. */
(function(){
const t=c=>'<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+c+'</svg>';
const M={
pin:t('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
eye:t('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
camera:t('<path d="M23 7l-7 5 7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
plane:t('<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>'),
ship:t('<path d="M3 17.5l1.7 3.1a1 1 0 0 0 .9.5h11a1 1 0 0 0 .9-.5L21 17.5"/><path d="M5 17.5V9h8l4 4.5v4"/><path d="M9 9V4.5h3.5"/>'),
sun:t('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>'),
moon:t('<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>'),
fence:t('<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><circle cx="12" cy="12" r="2.2"/>'),
search:t('<circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/>'),
globe3d:t('<circle cx="12" cy="12" r="9"/><path d="M3.3 13.8c3.3 2.6 14.1 2.6 17.4 0"/><path d="M12 3c-3.1 2.4-4.4 5.6-4.4 9s1.3 6.6 4.4 9"/><path d="M12 3c1.6 2.4 2.3 5.6 2.3 9s-.7 6.6-2.3 9"/>'),
globe:t('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18"/>'),
sat:t('<rect x="9.7" y="9.7" width="4.6" height="4.6" rx=".8" transform="rotate(45 12 12)"/><path d="M6.7 6.7 3.4 3.4M17.3 17.3l3.3 3.3"/><rect x="2.6" y="6.7" width="4" height="2.8" rx=".5" transform="rotate(45 4.6 8.1)"/>'),
ov_layers:t('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
ov_airport:t('<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 4.8c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>'),
ov_port:t('<circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>'),
ov_power:t('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
ov_rail:t('<path d="M9 2v20M15 2v20M5 7h14M5 12h14M5 17h14"/>'),
ov_datacenter:t('<rect x="4" y="3" width="16" height="5" rx="1"/><rect x="4" y="10" width="16" height="5" rx="1"/><rect x="4" y="17" width="16" height="4" rx="1"/><path d="M7.5 5.5h.01M7.5 12.5h.01M7.5 19h.01"/>'),
ov_dam:t('<path d="M14 3v18M14 3l5 18M14 21H3"/><path d="M3 9c1.4-1 2.8-1 4.2 0s2.8 1 4.2 0"/>'),
filter:t('<path d="M3 5h18M6 12h12M10 19h4"/>'),
sliders:t('<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>'),
star:t('<polygon points="12 2.6 15 9 22 9.6 16.6 14.2 18.4 21 12 17.2 5.6 21 7.4 14.2 2 9.6 9 9"/>'),
bell:t('<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10.5 20a2 2 0 0 0 3 0"/>')
};
function n(c,r,i,d,l=22){if(!c||c.hasImage(r))return;const x=String(i).replace(/currentColor/g,d).replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" width="'+(l*2)+'" height="'+(l*2)+'" '),e=new Image;e.onload=()=>{if(c.hasImage(r))return;const a=l*2,h=document.createElement('canvas');h.width=h.height=a;h.getContext('2d').drawImage(e,0,0,a,a);try{c.addImage(r,h.getContext('2d').getImageData(0,0,a,a),{pixelRatio:2});c.triggerRepaint()}catch{}};e.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(x)}
window.TrackMeNowIcons={I:M,r:n};window.TrackMeNowIcon=M;
})();