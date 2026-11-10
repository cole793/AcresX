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
  const context = vm.createContext({ window, document, console, URL, URLSearchParams, alert() {}, setTimeout, requestAnimationFrame: fn => fn() });
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

// ---- Stevens County WA (src/counties/stevens-assessor.js): same countyRecords shape as Kootenai.

// The API's answer for 2342700 (test/fixtures/stevens-assessor.json, see test/stevens-assessor.test.js).
const stevens = {
  available: true, state: 'WA', county: 'Stevens', parcelId: '2342700', countySource: 'Stevens County Assessor (RealPropertyParcels_Public)',
  countyRecords: [{
    parcelNumber: '2342700', propertyId: 43102, landValue: 12794, improvementValue: 14000, totalValue: 26794, taxableValue: 26794,
    marketLandValue: 336000, marketValue: 350000, netValue: 26794, taxYear: 2026, assessorAcres: 280, taxCodeArea: '021-115',
    propertyClass: '88', propertyClassDescription: 'Designated forest land under chapter 84.33 RCW', propertyClassNote: 'Tax category, not zoning',
    landSchedule: '88-DFL', currentUse: { status: 'classified', program: 'Designated forest land (RCW 84.33)' }
  }]
};

test('overview: Stevens fills assessed, land and year, the land use code as a tax category, market value and current use', () => {
  const { A, fact, document } = page();
  A.renderAssessment(A.normalize(stevens));
  assert.equal(fact('overviewAssessorValue'), '$26,794');
  assert.equal(fact('overviewLandValue'), '$12,794');
  assert.equal(fact('overviewAssessmentYear'), '2026');
  assert.equal(fact('overviewAssessorClass'), '88 – Designated forest land under chapter 84.33 RCW');
  assert.equal(document.getElementById('overviewAssessorClassWrap').querySelector('small.assessor-class-note').textContent, 'Tax category, not zoning');
  assert.equal(document.getElementById('propertyAssessmentSource').innerHTML,
    '<strong>Assessment source:</strong> Stevens County Assessor · Improvements $14,000 · Net taxable $26,794 · Market value $350,000 · Designated forest land (RCW 84.33). Assessor values are informational and are not the current tax bill.');
});

test('overview: a Stevens record with no values shows "Not available" and the note, never $0', () => {
  const { A, fact, document } = page();
  const empty = { ...stevens, countyRecords: [{ ...stevens.countyRecords[0], landValue: null, improvementValue: null, totalValue: null, taxableValue: null, marketLandValue: null, marketValue: null, netValue: null, propertyClass: '99', propertyClassDescription: 'Other undeveloped land', currentUse: { status: 'not_classified', program: null }, valuesNote: 'The assessor record for this parcel carries no values. Check with the Stevens County Assessor.' }] };
  A.renderAssessment(A.normalize(empty));
  assert.equal(fact('overviewAssessorValue'), 'Not available');
  assert.equal(fact('overviewLandValue'), 'Not available');
  assert.equal(fact('overviewAssessorClass'), '99 – Other undeveloped land');
  const source = document.getElementById('propertyAssessmentSource').innerHTML;
  assert.ok(!source.includes('$0'), source);
  assert.match(source, /Not in a current-use program\. The assessor record for this parcel carries no values\./);
});

const SEARCH_URL = 'https://propertysearch.trueautomation.com/PropertyAccess/Property.aspx?cid=0&year=2026&prop_id=43102';
const withLink = url => ({ ...stevens, countyRecords: [{ ...stevens.countyRecords[0], propertySearchUrl: url }] });

test('overview: Stevens shows the property search link after the source line, opening with rel="noopener"', () => {
  const { A, document } = page();
  A.renderAssessment(A.normalize(withLink(SEARCH_URL)));
  const html = document.getElementById('propertyAssessmentSource').innerHTML;
  assert.ok(html.endsWith(' Assessor values are informational and are not the current tax bill. <a href="https://propertysearch.trueautomation.com/PropertyAccess/Property.aspx?cid=0&amp;year=2026&amp;prop_id=43102" target="_blank" rel="noopener">View on the Stevens County property search (hosted by True Automation) ↗</a>'), html);
});

test('overview: the page checks the link again; another host, path, prop_id or http is not shown', () => {
  const { A, document } = page();
  for (const url of [
    SEARCH_URL.replace('propertysearch.trueautomation.com', 'evil.example'),
    SEARCH_URL.replace('/PropertyAccess/Property.aspx', '/PropertyAccess/Other.aspx'),
    SEARCH_URL.replace('prop_id=43102', 'prop_id=13056'),
    SEARCH_URL.replace('https:', 'http:'),
    'javascript:alert(1)',
    // Lookalike hosts: a loosened host check (endsWith / includes) shows these.
    SEARCH_URL.replace('propertysearch.trueautomation.com', 'evil-trueautomation.com'),
    SEARCH_URL.replace('propertysearch.trueautomation.com', 'propertysearch.trueautomation.com.evil.com'),
    // Only cid, year and prop_id, all numeric.
    `${SEARCH_URL}&redirect=//evil.com`,
    SEARCH_URL.replace('cid=0', 'cid=x'),
    SEARCH_URL.replace('year=2026', 'year=2026a'),
    `${SEARCH_URL}&cid=1`
  ]) {
    A.renderAssessment(A.normalize(withLink(url)));
    assert.ok(!document.getElementById('propertyAssessmentSource').innerHTML.includes('<a '), url);
  }
});

test('overview: the shown link is rebuilt from cid, year and prop_id only', () => {
  const { A, document } = page();
  A.renderAssessment(A.normalize(withLink('https://propertysearch.trueautomation.com/PropertyAccess/Property.aspx?prop_id=43102&year=2026&cid=0#frag')));
  assert.match(document.getElementById('propertyAssessmentSource').innerHTML, /<a href="https:\/\/propertysearch\.trueautomation\.com\/PropertyAccess\/Property\.aspx\?cid=0&amp;year=2026&amp;prop_id=43102" target="_blank" rel="noopener">/);
});

test('report: Stevens shows the assessor class next to zoning and the assessed value', () => {
  const { report } = page();
  const html = report({ parcel: { type: 'Feature', properties: { ORIG_PARCEL_ID: '2342700' }, geometry: null }, propertyAssessment: stevens, zoningPermits: { zoning: { code: 'AR-10' } } });
  assert.match(html, /<span>Zoning<\/span><strong>AR-10<\/strong><\/div><div class="assessor-class"><span>Assessor Class<\/span><strong>88 – Designated forest land under chapter 84.33 RCW<\/strong><small>Tax category, not zoning<\/small>/);
  assert.match(html, /<span>Assessed Value<\/span><strong>\$26,794<\/strong><\/div><div><span>Land Value<\/span><strong>\$12,794<\/strong>/);
});

// ---- Spokane County WA (src/counties/spokane-assessor.js): countyRecords like Stevens, plus the
// older raw `records` row. Records as the API returns them for 35234.0602 and 48136.9052
// (test/fixtures/spokane-assessor.json, see test/spokane-assessor.test.js).
const SCOUT = pid => `https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=${pid}`;
const spokaneRecord = {
  parcelNumber: '35234.0602', propertySearchUrl: SCOUT('35234.0602'), propertySearchLabel: 'View on Spokane County SCOUT',
  landValue: 110000, improvementValue: 479000, improvementValueNote: 'Assessed total minus land value',
  totalValue: 589000, taxableValue: 76466, netValue: 76466, marketLandValue: 110000, marketValue: 589000,
  exemption: { code: null, description: 'Personal exemption applied (details on SCOUT)', value: 512534, personal: true },
  taxYear: 2027, taxAmount: null, taxAmountNote: 'Not published in the county GIS. The SCOUT page lists the tax bill.',
  assessorAcres: 0.42, taxCodeArea: '0140', segStatus: 'Active-Complete',
  propertyClass: '11', propertyClassDescription: 'Single Unit', propertyClassNote: 'Tax category, not zoning',
  currentUse: { status: 'not_classified', program: null }
};
const spokaneForest = {
  ...spokaneRecord, parcelNumber: '48136.9052', propertySearchUrl: SCOUT('48136.9052'),
  landValue: null, improvementValue: null, improvementValueNote: null, totalValue: 99910, taxableValue: 99910, netValue: 99910,
  marketLandValue: 283740, marketValue: null, exemption: null, assessorAcres: 50.23, taxCodeArea: '3520',
  propertyClass: '88', propertyClassDescription: 'Designated Forest Lnd', currentUse: { status: 'classified', program: 'Designated forest land (RCW 84.33)' },
  valuesNote: 'The land is assessed at its current-use value, so the assessed total is below market. The county GIS does not split it into land and improvements; SCOUT has the full breakdown.'
};
const spokaneCounty = record => ({ available: true, state: 'WA', county: 'Spokane', parcelId: record.parcelNumber, records: [{ PID_NUM: record.parcelNumber, land_value: record.marketLandValue }], countyRecords: [record] });

test('overview: Spokane fills assessed, land, year and the property class as a tax category, with exemption, tax amount and the SCOUT link', () => {
  const { A, fact, document } = page();
  A.renderAssessment(A.normalize(spokaneCounty(spokaneRecord)));
  assert.equal(fact('overviewAssessorValue'), '$589,000');
  assert.equal(fact('overviewLandValue'), '$110,000');
  assert.equal(fact('overviewAssessmentYear'), '2027');
  assert.equal(fact('overviewAssessorClass'), '11 – Single Unit');
  assert.equal(document.getElementById('overviewAssessorClassWrap').querySelector('small.assessor-class-note').textContent, 'Tax category, not zoning');
  assert.equal(document.getElementById('propertyAssessmentSource').innerHTML,
    '<strong>Assessment source:</strong> Spokane County Assessor · Improvements $479,000 (assessed total minus land value) · Exemption: Personal exemption applied (details on SCOUT) ($512,534 exempt) · Net taxable $76,466 · Market value $589,000 · Not in a current-use program · Tax amount Not available (Not published in the county GIS. The SCOUT page lists the tax bill). Assessor values are informational and are not the current tax bill. <a href="https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=35234.0602" target="_blank" rel="noopener">View on Spokane County SCOUT ↗</a>');
});

test('overview: Spokane current-use land shows "Not available" for land value and the market land value instead, never $0', () => {
  const { A, fact, document } = page();
  A.renderAssessment(A.normalize(spokaneCounty(spokaneForest)));
  assert.equal(fact('overviewAssessorValue'), '$99,910');
  assert.equal(fact('overviewLandValue'), 'Not available');
  assert.equal(fact('overviewAssessorClass'), '88 – Designated Forest Lnd');
  const source = document.getElementById('propertyAssessmentSource').innerHTML;
  assert.ok(!source.includes('$0'), source);
  assert.match(source, /Spokane County Assessor · Market land value \$283,740 · Net taxable \$99,910 · Designated forest land \(RCW 84\.33\) · Tax amount Not available/);
  assert.match(source, /does not split it into land and improvements/);
});

test('overview: the page checks the SCOUT link again; another host, path, PID or extra parameter is not shown', () => {
  const { A, document } = page();
  const url = SCOUT('35234.0602');
  for (const bad of [
    url.replace('cp.spokanecounty.org', 'evil.example'),
    url.replace('cp.spokanecounty.org', 'cp.spokanecounty.org.evil.com'),
    url.replace('cp.spokanecounty.org', 'evil-spokanecounty.org'),
    url.replace('https:', 'http:'),
    url.replace('Summary.aspx', 'Other.aspx'),
    url.replace('35234.0602', '35234.0603'),
    `${url}&redirect=//evil.com`,
    'javascript:alert(1)'
  ]) {
    A.renderAssessment(A.normalize(spokaneCounty({ ...spokaneRecord, propertySearchUrl: bad })));
    assert.ok(!document.getElementById('propertyAssessmentSource').innerHTML.includes('<a '), bad);
  }
  // The label comes from the page, not the answer.
  A.renderAssessment(A.normalize(spokaneCounty({ ...spokaneRecord, propertySearchLabel: '<img src=x onerror=alert(1)>' })));
  assert.match(document.getElementById('propertyAssessmentSource').innerHTML, />View on Spokane County SCOUT ↗<\/a>$/);
});

test('report: Spokane shows the assessor class next to zoning and the assessed value', () => {
  const { report } = page();
  const html = report({ parcel: { type: 'Feature', properties: { ORIG_PARCEL_ID: '35234.0602' }, geometry: null }, propertyAssessment: spokaneCounty(spokaneRecord), zoningPermits: { zoning: { code: 'R-3' } } });
  assert.match(html, /<span>Zoning<\/span><strong>R-3<\/strong><\/div><div class="assessor-class"><span>Assessor Class<\/span><strong>11 – Single Unit<\/strong><small>Tax category, not zoning<\/small>/);
  assert.match(html, /<span>Assessed Value<\/span><strong>\$589,000<\/strong><\/div><div><span>Land Value<\/span><strong>\$110,000<\/strong>/);
});
