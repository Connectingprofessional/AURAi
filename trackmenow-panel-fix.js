/* Panel expand/collapse fix v12
 * Subtab click  → expand content panel
 * Main tab click → collapse panel (dock returns to normal height)
 * Close (×)     → collapse
 */
(function () {
  "use strict";

  var style = document.createElement("style");
  style.id = "tm-panel-expand-css";
  style.textContent = [
    "#tm-panel{display:none;}",
    "#tm-panel.open{",
    "  display:block!important;",
    "  max-height:min(42vh,360px)!important;",
    "  min-height:120px!important;",
    "  overflow:auto!important;",
    "  visibility:visible!important;",
    "  opacity:1!important;",
    "}",
    "#tm-panel:not(.open){",
    "  display:none!important;",
    "  max-height:0!important;",
    "  min-height:0!important;",
    "  overflow:hidden!important;",
    "  padding:0!important;",
    "  margin:0!important;",
    "  border:0!important;",
    "}"
  ].join("");
  document.head.appendChild(style);

  function syncDockHeight() {
    var shell = document.getElementById("tm-shell");
    if (shell) {
      document.documentElement.style.setProperty(
        "--tm-dock-h",
        (shell.offsetHeight || 74) + "px"
      );
    }
  }

  function collapsePanel() {
    var panel = document.getElementById("tm-panel");
    if (!panel) return;
    panel.classList.remove("open");
    panel.style.setProperty("display", "none", "important");
    panel.style.setProperty("max-height", "0", "important");
    panel.style.setProperty("min-height", "0", "important");
    panel.style.setProperty("overflow", "hidden", "important");
    var bodies = panel.querySelectorAll(".tm-panel-body");
    bodies.forEach(function (b) { b.remove(); });
    syncDockHeight();
  }

  function expandPanel() {
    var panel = document.getElementById("tm-panel");
    if (!panel) return;
    panel.classList.add("open");
    panel.style.setProperty("display", "block", "important");
    panel.style.setProperty("max-height", "min(42vh,360px)", "important");
    panel.style.setProperty("min-height", "120px", "important");
    panel.style.setProperty("overflow", "auto", "important");
    panel.style.setProperty("visibility", "visible", "important");
    syncDockHeight();
    requestAnimationFrame(syncDockHeight);
    setTimeout(syncDockHeight, 100);
  }

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      if (t.closest("#tm-main-tabs .tm-tab")) {
        setTimeout(collapsePanel, 40);
        setTimeout(syncDockHeight, 80);
        setTimeout(syncDockHeight, 200);
        return;
      }

      if (t.closest("#tm-subbar .tm-sub")) {
        setTimeout(expandPanel, 40);
        setTimeout(expandPanel, 150);
        setTimeout(syncDockHeight, 200);
        return;
      }

      if (t.closest("#tm-panel .tm-close")) {
        setTimeout(collapsePanel, 30);
        setTimeout(syncDockHeight, 80);
      }
    },
    true
  );

  window.__tmPanelCollapse = collapsePanel;
  window.__tmPanelExpand = expandPanel;

  console.log("[TM] panel: main tab collapses, subtab expands");
})();
