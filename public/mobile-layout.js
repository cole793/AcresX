// Phone layout (<= 700px): the top bar scrolls away with the page instead of floating over the
// content (it was sticky, two lines tall at 390px, and covered cards mid-scroll); the bottom nav
// leaves room for itself and the iOS home indicator (safe-area inset); and tap targets are at
// least 44px tall. Tablet (768) and desktop are unchanged: every rule is inside the phone query.
// Scoped to the app shell, dashboard cards and map controls; the search form is not touched.
(() => {
  if (document.getElementById('mobileLayoutStyles')) return;
  const NAV = 64; // bottom nav height (index.html)
  const style = document.createElement('style');
  style.id = 'mobileLayoutStyles';
  style.textContent = `
    @media(max-width:700px){
      .topbar{position:relative!important;top:auto!important;height:auto!important;min-height:60px;padding:8px 16px!important;gap:10px;z-index:auto!important}
      .topbar-brand,.topbar>div:first-child{min-width:0;flex:1 1 auto}
      .topbar-brand h1,.topbar h1{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .top-actions{flex:0 0 auto;gap:6px!important}
      .top-actions .ghost,.top-actions .primary{min-height:44px;padding:0 12px!important;font-size:12px!important;white-space:nowrap;display:inline-flex;align-items:center}
      .app{padding-bottom:calc(${NAV + 16}px + env(safe-area-inset-bottom, 0px))!important}
      .sidebar{height:calc(${NAV}px + env(safe-area-inset-bottom, 0px))!important;padding-bottom:calc(6px + env(safe-area-inset-bottom, 0px))!important}
      .sidebar .nav button{min-height:48px}
      main{padding-left:16px!important;padding-right:16px!important}
      .property-quick-action,.snapshot-details-btn,.map-tool,.tab,#closeDetails,.property-overview-map-btn,.buildable-area-card button{min-height:44px}
      .snapshot-details-btn{display:inline-flex;align-items:center}
      .map-card.fullscreen-map{bottom:calc(${NAV + 12}px + env(safe-area-inset-bottom, 0px))!important}
      .map-card.fullscreen-map #map{height:calc(100vh - ${NAV + 160}px)!important}
      #propertyActionToast{bottom:calc(${NAV + 16}px + env(safe-area-inset-bottom, 0px))!important;right:16px!important;left:16px!important}
    }
    @media(max-width:400px){
      .topbar-brand h1,.topbar h1{display:none}
    }
  `;
  document.head.appendChild(style);
})();
