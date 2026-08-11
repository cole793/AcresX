(() => {
  function addBrandStyles() {
    if (document.getElementById('acresxBrandStyles')) return;
    const style = document.createElement('style');
    style.id = 'acresxBrandStyles';
    style.textContent = `
      .sidebar .brand{margin-bottom:34px;justify-content:flex-start}
      .sidebar .brand-logo-wrap{width:auto;background:transparent;border-radius:0;padding:0;box-shadow:none;display:flex;align-items:center;justify-content:flex-start}
      .sidebar .brand-logo{display:none!important}
      .sidebar .brand-icon{display:block!important;width:52px;height:52px;object-fit:contain;filter:brightness(0) invert(1);opacity:.98}
      .topbar-brand{display:flex;flex-direction:column;justify-content:center;min-width:0}
      .topbar-logo{display:block;width:92px;max-height:25px;object-fit:contain;object-position:left center;margin-bottom:2px}
      .topbar-brand h1{margin:0!important;font:800 20px Manrope;color:var(--ink)}
      @media(max-width:1050px){
        .sidebar .brand{justify-content:center}
        .sidebar .brand-logo-wrap{justify-content:center}
        .sidebar .brand-icon{width:44px;height:44px}
      }
      @media(max-width:700px){.topbar-logo{width:78px;max-height:22px}.topbar-brand h1{font-size:16px!important}}
    `;
    document.head.appendChild(style);
  }

  function updateBranding() {
    addBrandStyles();

    const topbar = document.querySelector('.topbar');
    if (topbar) {
      const left = topbar.firstElementChild;
      if (left && !left.classList.contains('topbar-brand')) {
        left.classList.add('topbar-brand');
      }
      if (left) {
        const eyebrow = left.querySelector('.eyebrow');
        if (eyebrow) {
          const logo = document.createElement('img');
          logo.className = 'topbar-logo';
          logo.src = 'assets/acresx-logo.png';
          logo.alt = 'AcresX';
          eyebrow.replaceWith(logo);
        } else if (!left.querySelector('.topbar-logo')) {
          const logo = document.createElement('img');
          logo.className = 'topbar-logo';
          logo.src = 'assets/acresx-logo.png';
          logo.alt = 'AcresX';
          left.insertBefore(logo, left.firstChild);
        }
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateBranding);
  else updateBranding();
})();
