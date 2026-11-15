// One product label that follows the selected state. Before this, the sidebar note said
// "<State> beta" (state-selector.js), the version line said "AcresX Northwest Beta" or
// "AcresX v0.13 Feasibility Engine" depending on which script ran last, and the page title said
// "Washington" for every state. Now every place reads label():
//   no state chosen -> "Northwest beta"; WA/ID/MT -> "Washington beta" / "Idaho beta" / "Montana beta".
// Writes run on load, after the state select changes (this listener is added after
// state-selector.js's, so it runs last) and after each dashboard render.
(function (root) {
  const NAMES = { WA: 'Washington', ID: 'Idaho', MT: 'Montana' };
  const stateName = code => NAMES[String(code || '').toUpperCase()] || '';
  const label = code => `${stateName(code) || 'Northwest'} beta`;

  function apply() {
    const doc = root.document; if (!doc) return;
    const code = doc.getElementById('state')?.value || '';
    const text = label(code);
    const note = doc.querySelector('.sidebar .side-note strong, .sidebar .side-note b');
    if (note && note.textContent !== text) note.textContent = text;
    doc.querySelectorAll('.sidebar .version').forEach(el => { const v = `AcresX ${text}`; if (el.textContent !== v) el.textContent = v; });
    doc.querySelectorAll('.topbar .eyebrow').forEach(el => { if (el.textContent !== text) el.textContent = text; });
    const title = `AcresX | ${stateName(code) || 'Northwest'} Land Intelligence`;
    if (doc.title !== title) doc.title = title;
  }

  root.AcresXBetaLabel = { label, stateName, apply };
  const doc = root.document;
  if (!doc) return;
  apply();
  doc.getElementById('state')?.addEventListener('change', apply);
  if (typeof root.renderSummary === 'function') {
    const base = root.renderSummary;
    root.renderSummary = function (...args) { const out = base.apply(this, args); try { apply(); } catch (_) {} return out; };
  }
})(typeof window !== 'undefined' ? window : globalThis);
