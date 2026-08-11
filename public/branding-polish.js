(() => {
  function addBrandStyles() {
    if (document.getElementById('acresxBrandStyles')) return;
    const style = document.createElement('style');
    style.id = 'acresxBrandStyles';
    style.textContent = `
      .sidebar .brand{margin-bottom:34px;justify-content:flex-start}
      .sidebar .brand-logo-wrap{width:150px;background:transparent;border-radius:0;padding:0;box-shadow:none;display:flex;align-items:center;justify-content:flex-start}
      .sidebar .brand-logo{display:block!important;width:100%;height:auto;object-fit:contain;filter:brightness(0) invert(1);opacity:.98}
      .sidebar .brand-icon{display:none!important}
      .topbar-brand{display:flex!important;flex-direction:row!important;align-items:center!important;gap:10px;justify-content:flex-start;min-width:0}
      .topbar-icon{display:block;width:28px;height:28px;object-fit:contain}
      .topbar-logo{display:none!important}
      .topbar-brand .eyebrow{display:none!important}
      .topbar-brand h1{margin:0!important;font:800 20px Manrope;color:var(--ink)}
      @media(max-width:1050px){
        .sidebar .brand{justify-content:center}
        .sidebar .brand-logo-wrap{width:auto;justify-content:center}
        .sidebar .brand-logo{display:none!important}
        .sidebar .brand-icon{display:block!important;width:44px;height:44px;object-fit:contain;filter:brightness(0) invert(1);opacity:.98}
      }
      @media(max-width:700px){.topbar-icon{width:25px;height:25px}.topbar-brand h1{font-size:16px!important}}
    `;
    document.head.appendChild(style);
  }

  function updateBranding() {
    addBrandStyles();

    const topbar = document.querySelector('.topbar');
    if (topbar) {
      const left = topbar.firstElementChild;
      if (left) {
        left.classList.add('topbar-brand');
        left.querySelectorAll('.topbar-logo').forEach(el => el.remove());
        const eyebrow = left.querySelector('.eyebrow');
        if (eyebrow) eyebrow.remove();
        if (!left.querySelector('.topbar-icon')) {
          const icon = document.createElement('img');
          icon.className = 'topbar-icon';
          icon.src = 'assets/favicon.png';
          icon.alt = '';
          const heading = left.querySelector('h1');
          if (heading) left.insertBefore(icon, heading);
          else left.insertBefore(icon, left.firstChild);
        }
      }
    }

    document.querySelectorAll('.sidebar .version').forEach((el) => {
      const text = (el.textContent || '').trim();
      if (/washington\s+beta/i.test(text)) {
        el.textContent = text.replace(/washington\s+beta/ig, 'Beta');
      } else if (/washington/i.test(text) && /beta/i.test(text)) {
        el.textContent = 'Beta';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateBranding);
  else updateBranding();
})();
