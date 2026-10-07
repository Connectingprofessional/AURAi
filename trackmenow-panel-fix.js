/* Panel expand fix */
(function(){
  function expand(){
    var panel=document.getElementById("tm-panel");
    if(!panel)return;
    var activeSub=document.querySelector("#tm-subbar .tm-sub.active");
    if(activeSub){
      panel.classList.add("open");
      panel.style.setProperty("display","block","important");
      panel.style.setProperty("max-height","min(42vh,360px)","important");
      panel.style.setProperty("min-height","140px","important");
      panel.style.setProperty("overflow","auto","important");
      panel.style.setProperty("visibility","visible","important");
      var body=panel.querySelector(".tm-panel-body");
      if(!body||body.children.length===0){try{activeSub.click();}catch(e){}}
    }
    var shell=document.getElementById("tm-shell");
    if(shell)document.documentElement.style.setProperty("--tm-dock-h",(shell.offsetHeight||120)+"px");
  }
  document.addEventListener("click",function(e){
    var t=e.target;if(!t||!t.closest)return;
    if(t.closest("#tm-subbar .tm-sub")||t.closest("#tm-main-tabs .tm-tab")){
      setTimeout(expand,30);setTimeout(expand,150);setTimeout(expand,400);
    }
  },true);
  setInterval(expand,2000);
  console.log("[TM] panel expand fix armed");
})();
