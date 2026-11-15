// Dashboard overview fact "Property tax (<year>)" from /api/property-tax (src/services/property-tax.js).
// Billed amounts come from the county treasurer pages; Kootenai is an estimate from the levy
// rate. The fact always says which (basis label) and links to the county's own tax page.
// The answer is kept in last.propertyTax for the printable report (public/property-report-v2.js).
// Screening info only: it never affects the buildability score.
(() => {
  let requestId = 0;

  const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const usd = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Links are shown only for https pages on the county hosts the Worker reads.
  const HOSTS = new Set(['cp.spokanecounty.org', 'propertysearch.trueautomation.com', 'id-kootenai.publicaccessnow.com', 'www.kcgov.us',
    'www.yellowstonecountymt.gov', 'itax.gallatin.mt.gov', 'revenue.mt.gov']);
  function safeUrl(value) {
    try { const u = new URL(String(value || '')); return u.protocol === 'https:' && HOSTS.has(u.hostname) && !u.username && !u.port ? u.href : ''; } catch { return ''; }
  }

  // Answer -> { heading, value, basis, linkUrl, linkLabel } (also used by the report).
  function describe(data) {
    const linkUrl = safeUrl(data?.link?.url);
    const linkLabel = linkUrl ? String(data.link.label || 'View tax bill') : '';
    if (data?.available && Number.isFinite(Number(data.total))) {
      const year = Number.isInteger(data.taxYear) ? data.taxYear : '';
      const estimate = data.basis === 'estimate';
      const basis = estimate
        ? (data.note || 'Estimated from the levy rate; excludes fees and special assessments.')
        : `Billed amount from the county treasurer${data.asOf ? `, as of ${data.asOf}` : ''}${data.exempt ? '. Exempt: special assessments only' : ''}`;
      return { heading: `Property tax${year ? ` (${year})` : ''}`, value: `${estimate ? '≈ ' : ''}${usd(data.total)}`, basis, estimate, linkUrl, linkLabel };
    }
    const why = data?.status === 'not_supported' ? 'Not connected for this county yet' : data?.note || 'County tax site did not answer';
    return { heading: 'Property tax', value: 'Not available', basis: why, estimate: false, linkUrl, linkLabel };
  }

  function currentSearch() {
    const state = document.getElementById('state')?.value || '';
    const county = document.getElementById('county')?.value || '';
    const parcelId = document.getElementById('parcel')?.value?.trim() || document.getElementById('overviewParcelId')?.textContent?.trim() || '';
    return state && county && parcelId ? { state, county, parcelId } : null;
  }

  function ensureStyles() {
    if (document.getElementById('propertyTaxStyles')) return;
    const style = document.createElement('style');
    style.id = 'propertyTaxStyles';
    style.textContent = '.property-overview-fact small.property-tax-basis{display:block;font-size:10px;color:var(--muted);margin-top:1px;line-height:1.3}.property-overview-fact small.property-tax-basis a{color:inherit;text-decoration:underline}';
    document.head.appendChild(style);
  }

  function factEl() {
    const grid = document.querySelector('.property-overview-facts');
    if (!grid) return null;
    let wrap = document.getElementById('overviewPropertyTaxWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'overviewPropertyTaxWrap';
      wrap.className = 'property-overview-fact';
      wrap.innerHTML = '<span id="overviewPropertyTaxLabel">Property tax</span><strong id="overviewPropertyTax">Checking…</strong><small class="property-tax-basis" id="overviewPropertyTaxBasis"></small>';
      const source = document.getElementById('propertyAssessmentSource');
      if (source && source.parentNode === grid) grid.insertBefore(wrap, source); else grid.appendChild(wrap);
    }
    return wrap;
  }

  function render(data) {
    ensureStyles();
    const wrap = factEl();
    if (!wrap) return;
    const d = describe(data);
    document.getElementById('overviewPropertyTaxLabel').textContent = d.heading;
    document.getElementById('overviewPropertyTax').textContent = d.value;
    const link = d.linkUrl ? ` <a href="${esc(d.linkUrl)}" target="_blank" rel="noopener">${esc(d.linkLabel)} ↗</a>` : '';
    document.getElementById('overviewPropertyTaxBasis').innerHTML = `${esc(String(d.basis).replace(/\.$/, ""))}.${link}`;
  }

  async function load() {
    const search = currentSearch();
    if (!search) return;
    const sections = window.AcresXSections;
    if (sections && !sections.claim('tax')) return;
    const searchId = sections?.searchId;
    const stale = () => (sections && !sections.isCurrent(searchId));
    const id = ++requestId;
    ensureStyles();
    const wrap = factEl();
    if (wrap) { document.getElementById('overviewPropertyTaxLabel').textContent = 'Property tax'; document.getElementById('overviewPropertyTax').textContent = 'Checking…'; document.getElementById('overviewPropertyTaxBasis').textContent = ''; }
    try {
      const response = await fetch('/api/property-tax', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(search) });
      const data = await response.json();
      if (id !== requestId || stale()) return;
      if (typeof last !== 'undefined' && last) last.propertyTax = data;
      render(data);
      sections?.settle('tax');
    } catch (error) {
      if (id !== requestId || stale()) return;
      console.warn('Property tax lookup failed', error?.message);
      render(null);
      sections?.settle('tax', 'failed');
    }
  }

  window.AcresXPropertyTax = { describe, render, safeUrl };

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      requestAnimationFrame(() => load());
      return result;
    };
  }
})();
