// Runs browser scripts from public/ in a node:vm context with a lazy fake DOM: every
// getElementById(id) returns an element (created on first use), so a script can write into
// elements the page would normally have. Enough for public/parcel-preview.js (overview acreage),
// public/property-report-v2.js (printable report) and renderSummary() from public/index.html.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const SQ_M_PER_ACRE = 4046.8564224;
const publicDir = new URL('../public/', import.meta.url);
export const readPublic = (name, dir = publicDir) => readFileSync(new URL(name, dir), 'utf8');

function fakeElement(id, registry) {
  const el = {
    id, textContent: '', innerHTML: '', className: '', hidden: false, value: undefined, listeners: {}, style: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    insertAdjacentElement() {}, appendChild(c) { return c; }, scrollIntoView() {},
    cloneNode() { return fakeElement(this.id, registry); },
    replaceWith(other) { registry.set(other.id || this.id, other); }
  };
  return el;
}

// mappedSqm: what turf.area returns (null -> outline area unavailable).
export function makeContext({ mappedSqm = null, last = null } = {}) {
  const registry = new Map();
  const getElementById = id => { if (!registry.has(id)) registry.set(id, fakeElement(id, registry)); return registry.get(id); };
  const document = {
    readyState: 'complete', head: fakeElement('head', registry), body: fakeElement('body', registry),
    addEventListener() {}, createElement: () => fakeElement('', registry), getElementById, querySelector: () => null, querySelectorAll: () => []
  };
  const layer = { addTo() { return this; }, removeFrom() {}, getBounds: () => ({ isValid: () => false }) };
  const L = { map: () => ({ fitBounds() {}, invalidateSize() {} }), tileLayer: () => layer, geoJSON: () => layer };
  const turf = { area: () => (mappedSqm == null ? 0 : mappedSqm), centroid: () => ({ geometry: { coordinates: [-116.6, 47.3] } }) };
  const opened = [];
  const context = vm.createContext({
    document, L, turf, last, console, alert() {}, setTimeout: fn => fn(), requestAnimationFrame: fn => fn(),
    prompt: () => 'Test property', open: () => ({ document: { write: html => opened.push(html), close() {} } })
  });
  context.window = context;
  return { context, run: source => vm.runInContext(source, context), el: getElementById, opened };
}

export function acresToSqm(acres) { return acres * SQ_M_PER_ACRE; }

// Overview acreage: renderSummary (stubbed) -> parcel-preview.js renderPropertyOverview.
export function renderOverview({ parcel, mappedSqm, dir }) {
  const h = makeContext({ mappedSqm, last: { parcel, wells: [], utility: [] } });
  h.run('function renderSummary(){}');
  try { h.run(readPublic('acreage.js', dir)); } catch (e) { if (e.code !== 'ENOENT') throw e; } // absent before this change
  h.run(readPublic('parcel-preview.js', dir));
  h.run('renderSummary()');
  const note = h.el('overviewAcreageNote');
  return { acres: h.el('overviewAcres').textContent, detail: h.el('overviewSqFt').textContent, note: note.hidden ? '' : note.textContent };
}

// Printable report HTML for `data` (what window.__acresxLast holds).
export function renderReport({ data, mappedSqm, dir }) {
  const h = makeContext({ mappedSqm, last: data });
  try { h.run(readPublic('acreage.js', dir)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  h.run(readPublic('property-report-v2.js', dir));
  h.context.__acresxLast = data;
  h.el('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
  return h.opened.at(-1);
}

// renderSummary from public/index.html (plus the two helpers it calls), with `last` as given.
export function renderScore({ last, dir }) {
  const lines = readPublic('index.html', dir).split('\n');
  const pick = name => lines.find(l => l.startsWith(`function ${name}(`));
  const h = makeContext({ last });
  h.run(`const $=id=>document.getElementById(id);\n${pick('gradeWellDepth')}\n${pick('setTraffic')}\n${pick('renderSummary')}`);
  h.run('renderSummary(last.parcel)');
  return { score: h.el('scoreMetric').textContent, dataDot: h.el('dataGrade').textContent, evidence: h.el('evidenceMetric').textContent, listing: h.el('listingGrade').textContent };
}
