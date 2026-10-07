/* Panel CSS-only v15 — no click hijack, no resize loop */
(function () {
  "use strict";
  if (window.__tmPanelCssOnly) return;
  window.__tmPanelCssOnly = true;

  var s = document.createElement("style");
  s.id = "tm-panel-css-only";
  s.textContent = [
    "#tm-panel.open{",
    "  display:block!important;",
    "  max-height:min(36vh,300px)!important;",
    "  overflow-y:auto!important;",
    "  overflow-x:hidden!important;",
    "  visibility:visible!important;",
    "  opacity:1!important;",
    "}",
    "#tm-panel:not(.open){",
    "  display:none!important;",
    "}",
    "#tm-shell{max-height:68vh}",
    "#tm-panel .tm-panel-body{max-height:min(30vh,260px);overflow:auto}"
  ].join("");
  document.head.appendChild(s);

  var lastH = 0;
  var ticking = false;
  function sync() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var shell = document.getElementById("tm-shell");
      if (!shell) return;
      var h = Math.round(shell.getBoundingClientRect().height);
      if (!h) return;
      if (Math.abs(h - lastH) < 2) return;
      lastH = h;
      if (h > window.innerHeight * 0.68) h = Math.round(window.innerHeight * 0.68);
      document.documentElement.style.setProperty("--tm-dock-h", h + "px");
    });
  }

  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    var shell = document.getElementById("tm-shell");
    if (shell && !shell.__tmSync) {
      shell.__tmSync = true;
      try { new ResizeObserver(sync).observe(shell); } catch (e) {}
      sync();
    }
    if (shell || tries > 30) clearInterval(iv);
  }, 300);

  console.log("[TM] panel css-only v15");
})();
