// Offline tests for how the page shows /api/property-assessment answers: the overview facts
// (public/property-assessment.js) and the printable report (public/property-report-v2.js).
// The scripts run in a vm with a tiny fake DOM (just what these two modules touch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const assessmentSource = read('public/property-assessment.js');
const reportSource = read('public/property-report-v2.js');

class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.id = ''; this.className = ''; this._text = ''; this._html = ''; this.listeners = {}; }
  get parentNode() { return this.parent; }
  appendChild(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
  insertBefore(child, ref) { if (!ref) return this.appendChild(child); child.remove(); child.parent = this; this.children.splice(this.children.indexOf(ref), 0, child); return child; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }
  replaceWith(other) { const p = this.parent; if (!p) return; const i = p.children.indexOf(this); other.remove(); other.parent = p; p.children[i] = other; this.parent = null; }
  cloneNode() { const c = new El(this.tagName); c.id = this.id; c.className = this.className; c._text = this._text; return c; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  // Flat markup only: <tag id=".." class="..">text</tag> siblings.
  set innerHTML(html) {
    this._html = html; this.children = []; this._text = '';
    for (const m of html.matchAll(/<(\w+)((?:\s+[\w-]+="[^"]*")*)>([^<]*)<\/\1>/g)) {
      const c = new El(m[1]);
      for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) { if (a[1] === 'id') c.id = a[2]; if (a[1] === 'class') c.className = a[2]; }
      c._text = m[3]; this.appendChild(c);
    }
  }
  get innerHTML() { return this._html; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; this._html = ''; }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  matches(sel) {
    const m = /^(\w+)?(?:\.([\w-]+))?$/.exec(sel.trim()); if (!m) return false;
    return (!m[1] || this.tagName === m[1].toUpperCase()) && (!m[2] || this.className.split(/\s+/).includes(m[2]));
  }
  querySelector(sel) { for (const e of this.walk()) if (sel.split(',').some(s => e.matches(s))) return e; return null; }
  querySelectorAll(sel) { return [...this.walk()].filter(e => sel.split(',').some(s => e.matches(s))); }
}

function page() {
  const head = new El('head'), body = new El('body');
  const grid = body.appendChild(new El('div')); grid.className = 'property-overview-facts';
  const button = body.appendChild(new El('button')); button.id = 'generateReportBtn';
  const document = {
    head, body, readyState: 'complete', addEventListener() {},
    createElement: tag => new El(tag),
    getElementById: id => [...head.walk(), ...body.walk()].find(e => e.id === id) || null,
    querySelector: sel => body.querySelector(sel)
  };
  const opened = [];
  const window = {
    prompt: () => 'Test property',
    open: () => ({ document: { write: html => opened.push(html), close() {} } })
  };
  const context = vm.createContext({ window, document, console, alert() {}, setTimeout, requestAnimationFrame: fn => fn() });
  vm.runInContext(assessmentSource, context);
  vm.runInContext(reportSource, context);
  const fact = id => document.getElementById(id)?.textContent;
  const report = data => {
    window.__acresxLast = data;
    document.getElementById('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
    return opened.at(-1);
  };
  return { window, document, fact, report, A: window.AcresXAssessment };
}

// The API's answer for PIN 47N03W052200 (see test/property-assessment.test.js).
const kootenai = {
  available: true, state: 'ID', county: 'Kootenai', parcelId: '47N03W052200', countySource: 'Kootenai County Assessor (Assessor_Layers)',
  countyRecords: [{ pin: '47N03W052200', landValue: 99654, improvementValue: 0, totalValue: 99654, homeownerExemption: 0, netValue: 99654, assessmentDate: '2026-01-01', taxYear: 2026, assessorAcres: 2.888, propertyClass: '512', propertyClassDescription: 'Rural residential tract' }]
};
const spokane = { available: true, state: 'WA', county: 'Spokane', parcelId: '47174.9017', records: [{ land_value: 120000, tax_year: 2026 }] };
const parcel = { type: 'Feature', properties: { ORIG_PARCEL_ID: '47N03W052200', ACRES: 2.888 }, geometry: null };

test('overview: Kootenai fills assessor value, land value and year, plus the assessor class with its note', () => {
  const { A, fact, document } = page();
  A.renderAssessment(A.normalize(kootenai));
  assert.equal(fact('overviewAssessorValue'), '$99,654');
  assert.equal(fact('overviewLandValue'), '$99,654');
  assert.equal(fact('overviewAssessmentYear'), '2026');
  const wrap = document.getElementById('overviewAssessorClassWrap');
  assert.equal(wrap.querySelector('span').textContent, 'Assessor class');
  assert.equal(fact('overviewAssessorClass'), '512 – Rural residential tract');
  assert.equal(wrap.querySelector('small.assessor-class-note').textContent, 'Tax category, not zoning');
  assert.match(document.getElementById('propertyAssessmentSource').innerHTML, /Kootenai County Assessor · Improvements \$0 · Net taxable \$99,654\./);
});

test('overview: counties without an assessor class show no class fact, and a stale one is removed', () => {
  const { A, fact, document } = page();
  A.renderAssessment(A.normalize(kootenai));
  assert.ok(document.getElementById('overviewAssessorClassWrap'));
  A.renderAssessment(A.normalize(spokane));
  assert.equal(document.getElementById('overviewAssessorClassWrap'), null);
  assert.equal(fact('overviewLandValue'), '$120,000');
  assert.equal(document.getElementById('propertyAssessmentSource').innerHTML, '<strong>Assessment source:</strong> Spokane County Assessor. Assessor values are informational and are not the current tax bill.');
  A.renderAssessment(A.normalize(kootenai));
  A.renderAssessment(null);
  assert.equal(document.getElementById('overviewAssessorClassWrap'), null);
  assert.equal(fact('overviewAssessorValue'), 'Not available');
});

test('overview: missing Kootenai values show "Not available", never $0', () => {
  const { A, fact, document } = page();
  const nulls = { ...kootenai, countyRecords: [{ ...kootenai.countyRecords[0], landValue: null, improvementValue: null, totalValue: null, homeownerExemption: null, netValue: null }] };
  A.renderAssessment(A.normalize(nulls));
  assert.equal(fact('overviewAssessorValue'), 'Not available');
  assert.equal(fact('overviewLandValue'), 'Not available');
  assert.equal(fact('overviewAssessorClass'), '512 – Rural residential tract');
  const source = document.getElementById('propertyAssessmentSource').innerHTML;
  assert.ok(!source.includes('$0'), source);
  assert.equal(source, '<strong>Assessment source:</strong> Kootenai County Assessor. Assessor values are informational and are not the current tax bill.');
});

test('overview: the assessor class fact stays above the source line across repeated searches', () => {
  const { A, document } = page();
  const grid = document.querySelector('.property-overview-facts');
  const order = () => grid.children.map(c => c.id);
  for (let i = 0; i < 3; i++) {
    document.getElementById('overviewAssessorClassWrap')?.remove(); // what loadAssessment() does on each search
    A.renderAssessment(A.normalize(kootenai));
    assert.deepEqual(order(), ['overviewAssessorValueWrap', 'overviewLandValueWrap', 'overviewAssessmentYearWrap', 'overviewAssessorClassWrap', 'propertyAssessmentSource']);
  }
});

test('overview: class text formatting', () => {
  const { A } = page();
  assert.equal(A.classText({ propertyClass: '512', propertyClassDescription: 'Rural residential tract' }), '512 – Rural residential tract');
  assert.equal(A.classText({ propertyClass: '512' }), '512');
  assert.equal(A.classText({}), '');
});

test('report: Kootenai shows the assessor class next to zoning, labeled as a tax category', () => {
  const { report } = page();
  const html = report({ parcel, propertyAssessment: kootenai, zoningPermits: { zoning: { code: 'AGRICULTURE' } } });
  assert.match(html, /<div class="identity has-assessor-class">/);
  assert.match(html, /<span>Zoning<\/span><strong>AGRICULTURE<\/strong><\/div><div class="assessor-class"><span>Assessor Class<\/span><strong>512 – Rural residential tract<\/strong><small>Tax category, not zoning<\/small><\/div><div><span>Assessor Value<\/span><strong>\$99,654<\/strong>/);
  assert.match(html, /<span>Assessed Value<\/span><strong>\$99,654<\/strong><\/div><div><span>Land Value<\/span><strong>\$99,654<\/strong><\/div><div><span>Assessment Year<\/span><strong>2026<\/strong>/);
});

test('report: other counties keep the four-column identity row with no assessor class', () => {
  const { report } = page();
  const html = report({ parcel, propertyAssessment: spokane });
  assert.match(html, /<div class="identity">/);
  assert.ok(!html.includes('Assessor Class'));
  assert.match(html, /<span>Assessed Value<\/span><strong>\$120,000<\/strong>/);
});
