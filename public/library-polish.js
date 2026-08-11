(() => {
  function searchCard(){ return document.querySelector('.search-card'); }
  function libraryView(){ return document.getElementById('propertyLibraryView'); }
  function hideSearch(){ const card=searchCard(); if(card) card.style.display='none'; }
  function showSearch(){ const card=searchCard(); if(card) card.style.removeProperty('display'); }

  function wire(){
    document.querySelectorAll('.sidebar .nav button').forEach(btn => {
      const label=(btn.textContent||'').trim();
      if(label.includes('Saved Properties') || label.includes('Reports')){
        btn.addEventListener('click', () => setTimeout(hideSearch, 0));
      } else if(label.includes('Property Dashboard')){
        btn.addEventListener('click', () => setTimeout(showSearch, 0));
      }
    });

    document.addEventListener('click', e => {
      const target=e.target.closest?.('button');
      if(!target) return;
      if(target.id==='libraryBack' || target.classList.contains('open-item')) setTimeout(showSearch, 0);
    });

    const observer=new MutationObserver(() => {
      const view=libraryView();
      if(view && view.style.display!=='none') hideSearch();
    });
    observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['style']});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire); else wire();
})();
