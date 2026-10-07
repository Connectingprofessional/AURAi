/* TrackMeNow panel stability v14 — no thrash, no stuck dock */
(function () {
  "use strict";
  if (window.__tmPanelStable) return;
  window.__tmPanelStable = true;

  var busy = false;
  var open = false;
  var dockTimer = null;

  var css = document.createElement("style");
  css.id = "tm-panel-stable-css";
  css.textContent = [
    "#tm-panel{transition:none!important}",
    "#tm-panel.open{",
    "  display:block!important;",
    "  max-height:min(38vh,320px)!important;",
    "  min-height:100px!important;",
    "  overflow:auto!important;",
    "  visibility:visible!important;",
    "  opacity:1!important;",
    "  margin:7px 8px 8px!important;",
    "  padding:10px!important;",
    "  border:1px solid rgba(150,190,220,.2)!important;",
    "}",
    "#tm-panel:not(.open){",
    "  display:none!important;",
    "  max-height:0!important;",
    "  min-height:0!important;",
    "  margin:0!important;",
    "  padding:0!important;",
    "  border:0!important;",
    "  overflow:hidden!important;",
    "  visibility:hidden!important;",
    "}",
    "#tm-shell{max-height:70vh;overflow:visible}",
    "#tm-subbar{flex-shrink:0}",
    "#tm-main-tabs{flex-shrink:0}"
  ].join("");
  document.head.appendChild(css);

  function syncDock() {
    if (dockTimer) clearTimeout(dockTimer);
    dockTimer = setTimeout(function () {
      var shell = document.getElementById("tm-shell");
      if (!shell) return;
      var h = shell.getBoundingClientRect().height;
      if (!h || h < 40) h = open ? 220 : 76;
      if (h > window.innerHeight * 0.65) h = window.innerHeight * 0.65;
      document.documentElement.style.setProperty("--tm-dock-h", Math.round(h) + "px");
      try {
        var m = window.maplibre || window.map;
        if (m && m.resize) m.resize();
      } catch (e) {}
    }, 60);
  }

  function setOpen(want) {
    if (busy && want === open) return;
    var panel = document.getElementById("tm-panel");
    if (!panel) return;
    busy = true;
    open = !!want;
    if (open) {
      panel.classList.add("open");
      panel.style.removeProperty("display");
      panel.style.removeProperty("max-height");
      panel.style.removeProperty("min-height");
    } else {
      panel.classList.remove("open");
    }
    syncDock();
    setTimeout(function () { busy = false; syncDock(); }, 120);
  }

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      if (t.closest("#tm-panel .tm-close")) {
        setTimeout(function () { setOpen(false); }, 0);
        return;
      }

      if (t.closest("#tm-main-tabs .tm-tab")) {
        setTimeout(function () { setOpen(false); }, 50);
        setTimeout(function () { setOpen(false); }, 180);
        return;
      }

      if (t.closest("#tm-subbar .tm-sub")) {
        setTimeout(function () { setOpen(true); }, 50);
        setTimeout(function () { setOpen(true); }, 180);
        return;
      }
    },
    true
  );

  function watchShell() {
    var shell = document.getElementById("tm-shell");
    if (!shell || shell.__tmRO) return;
    shell.__tmRO = true;
    try {
      var ro = new ResizeObserver(function () {
        if (!busy) syncDock();
      });
      ro.observe(shell);
    } catch (e) {}
    syncDock();
  }

  var tries = 0;
  var boot = setInterval(function () {
    tries++;
    watchShell();
    if (document.getElementById("tm-shell") || tries > 40) clearInterval(boot);
  }, 250);

  window.__tmPanelCollapse = function () { setOpen(false); };
  window.__tmPanelExpand = function () { setOpen(true); };
  console.log("[TM] panel stable v14");
})();
