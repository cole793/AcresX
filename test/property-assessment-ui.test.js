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
const taxSource = read('public/property-tax.js');

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
  // What the in-page report view (property-report-v2.js) touches.
  setAttribute() {} focus() {}
  get classList() { const el = this; const list = () => el.className.split(/\s+/).filter(Boolean); return { add: (...c) => { el.className = [...new Set([...list(), ...c])].join(' '); }, remove: (...c) => { el.className = list().filter(x => !c.includes(x)).join(' '); }, contains: c => list().includes(c), toggle: (c, on) => { el.className = (on ? [...new Set([...list(), c])] : list().filter(x => x !== c)).join(' '); } }; }
  // The view writes the report into a shadow root; each write is recorded.
  attachShadow() { const writes = this.shadowWrites = []; return { set innerHTML(html) { if (html) writes.push(String(html)); }, querySelectorAll: () => [] }; }
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
  const window = {
    prompt: () => { throw new Error('window.prompt must not be used'); },
    open: () => { throw new Error('window.open must not be used for the report'); }
  };
  const context = vm.createContext({ window, document, console, URL, URLSearchParams, alert() {}, setTimeout, requestAnimationFrame: fn => fn() });
  vm.runInContext(assessmentSource, context);
  vm.runInContext(taxSource, context);
  vm.runInContext(reportSource, context);
  const fact = id => document.getElementById(id)?.textContent;
  const report = data => {
    window.__acresxLast = data;
    document.getElementById('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
    document.getElementById('acresxReportCreate').listeners.click({ preventDefault() {} });
    return document.getElementById('acresxReportPages').shadowWrites.at(-1);
  };
  return { window, document, fact, report, A: window.AcresXAssessment, T: window.AcresXPropertyTax };
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

// The redesigned report (2026-11-13) shows each assessor value once, in the page-2 assessor record,
// with the property class labeled as a tax category, not zoning.
const once = (html, text) => html.split(text).length - 1;

test('report: Kootenai shows the assessor class as a tax category and the land-only value once', () => {
  const { report } = page();
  const html = report({ parcel, propertyAssessment: kootenai, zoningPermits: { zoning: { code: 'AGRICULTURE' } } });
  assert.match(html, /<div class="zone-code">AGRICULTURE<\/div>/);
  assert.match(html, /<span>Tax category<\/span><strong>512 – Rural residential tract<\/strong><small>Tax category, not zoning<\/small>/);
  assert.match(html, /<span>Assessed value \(2026\)<\/span><strong>\$99,654<\/strong><small>Land only; no assessed improvements<\/small>/);
  assert.equal(once(html, '$99,654'), 1, 'land equal to the total is not repeated');
});

test('report: a county with no assessor class says so instead of leaving it blank', () => {
  const { report } = page();
  const html = report({ parcel, propertyAssessment: spokane });
  assert.match(html, /<span>Tax category<\/span><strong>Not available<\/strong>/);
  assert.match(html, /<span>Assessed value \(2026\)<\/span><strong>\$120,000<\/strong>/);
  assert.doesNotMatch(html, /undefined|NaN/);
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
  assert.match(html, /<div class="zone-code">AR-10<\/div>/);
  assert.match(html, /<span>Tax category<\/span><strong>88 – Designated forest land under chapter 84.33 RCW<\/strong><small>Tax category, not zoning<\/small>/);
  assert.match(html, /<span>Assessed value \(2026\)<\/span><strong>\$26,794<\/strong><\/div><div><span>Land<\/span><strong>\$12,794<\/strong><\/div><div><span>Improvements<\/span><strong>\$14,000<\/strong>/);
  assert.match(html, /<span>Assessor acres<\/span><strong>280\.00 ac<\/strong>/);
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

test('overview: Spokane fills assessed, land, year and the property class as a tax category, with exemption and the SCOUT link (no stale tax-amount note)', () => {
  const { A, fact, document } = page();
  A.renderAssessment(A.normalize(spokaneCounty(spokaneRecord)));
  assert.equal(fact('overviewAssessorValue'), '$589,000');
  assert.equal(fact('overviewLandValue'), '$110,000');
  assert.equal(fact('overviewAssessmentYear'), '2027');
  assert.equal(fact('overviewAssessorClass'), '11 – Single Unit');
  assert.equal(document.getElementById('overviewAssessorClassWrap').querySelector('small.assessor-class-note').textContent, 'Tax category, not zoning');
  assert.equal(document.getElementById('propertyAssessmentSource').innerHTML,
    '<strong>Assessment source:</strong> Spokane County Assessor · Improvements $479,000 (assessed total minus land value) · Exemption: Personal exemption applied (details on SCOUT) ($512,534 exempt) · Net taxable $76,466 · Market value $589,000 · Not in a current-use program. Assessor values are informational and are not the current tax bill. <a href="https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=35234.0602" target="_blank" rel="noopener">View on Spokane County SCOUT ↗</a>');
});

test('overview: Spokane current-use land shows "Not available" for land value and the market land value instead, never $0', () => {
  const { A, fact, document } = page();
  A.renderAssessment(A.normalize(spokaneCounty(spokaneForest)));
  assert.equal(fact('overviewAssessorValue'), '$99,910');
  assert.equal(fact('overviewLandValue'), 'Not available');
  assert.equal(fact('overviewAssessorClass'), '88 – Designated Forest Lnd');
  const source = document.getElementById('propertyAssessmentSource').innerHTML;
  assert.ok(!source.includes('$0'), source);
  assert.match(source, /Spokane County Assessor · Market land value \$283,740 · Net taxable \$99,910 · Designated forest land \(RCW 84\.33\)\. The land is assessed/);
  assert.doesNotMatch(source, /Tax amount|Not published in the county GIS/, 'the Property tax card covers the tax bill');
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
  assert.match(html, /<div class="zone-code">R-3<\/div>/);
  assert.match(html, /<span>Tax category<\/span><strong>11 – Single Unit<\/strong><small>Tax category, not zoning<\/small>/);
  assert.match(html, /<span>Assessed value \(2027\)<\/span><strong>\$589,000<\/strong><\/div><div><span>Land<\/span><strong>\$110,000<\/strong><\/div><div><span>Improvements<\/span><strong>\$479,000<\/strong>/);
  assert.equal(once(html, '$589,000'), 1);
});

// ---- Property tax (/api/property-tax, src/services/property-tax.js; public/property-tax.js)

const billedTax = {
  available: true, state: 'MT', county: 'Gallatin', parcelId: '06069905302080000', status: 'found', basis: 'billed', taxYear: 2026, total: 9208.96,
  installments: [{ label: 'First half', amount: 4604.5 }, { label: 'Second half', amount: 4604.46 }], label: 'Billed 2026 property tax',
  source: { name: 'Gallatin County Treasurer (iTax)', url: 'https://itax.gallatin.mt.gov/detail.aspx?taxid=RHH41234' }, asOf: '2026-11-13',
  link: { label: 'View tax bill on Gallatin County iTax', url: 'https://itax.gallatin.mt.gov/detail.aspx?taxid=RHH41234' }
};
const estimatedTax = {
  available: true, state: 'ID', county: 'Kootenai', parcelId: '50N04W323200', status: 'found', basis: 'estimate', taxYear: 2026, total: 25.1, levyRate: 3.641236,
  note: 'Estimated from the 2026 levy rate; excludes fees and special assessments.', label: 'Estimated 2026 property tax',
  source: { name: 'Kootenai County, Rates for the Year 2026 (levy rate by tax area group)', url: 'https://www.kcgov.us/DocumentCenter/View/17378' }, asOf: '2026-11-02',
  link: { label: 'View tax bill on the Kootenai County Treasurer site', url: 'https://id-kootenai.publicaccessnow.com/Treasurer/TaxSearch.aspx' }
};
const blockedTax = { available: false, status: 'unavailable', basis: null, taxYear: null, total: null, note: 'The county tax site did not answer automated lookups. Open the tax bill on the county site.', source: null, asOf: null,
  link: { label: 'View tax bill on Spokane County SCOUT', url: 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=23123.9051' } };

test('overview: property tax fact shows the billed amount, its basis and the county link', () => {
  const { T, fact, document } = page();
  T.render(billedTax);
  assert.equal(fact('overviewPropertyTaxLabel'), 'Property tax (2026)');
  assert.equal(fact('overviewPropertyTax'), '$9,208.96');
  const basis = document.getElementById('overviewPropertyTaxBasis').innerHTML;
  assert.match(basis, /^Billed amount from the county treasurer, as of 2026-11-13\. <a href="https:\/\/itax\.gallatin\.mt\.gov\/detail\.aspx\?taxid=RHH41234" target="_blank" rel="noopener">View tax bill on Gallatin County iTax ↗<\/a>$/);
});

test('overview: an estimate is labeled as one; a blocked site shows Not available with the bill link', () => {
  const { T, fact, document } = page();
  T.render(estimatedTax);
  assert.equal(fact('overviewPropertyTax'), '≈ $25.10');
  assert.match(document.getElementById('overviewPropertyTaxBasis').innerHTML, /^Estimated from the 2026 levy rate; excludes fees and special assessments\. <a href="https:\/\/id-kootenai/);
  T.render(blockedTax);
  assert.equal(fact('overviewPropertyTaxLabel'), 'Property tax');
  assert.equal(fact('overviewPropertyTax'), 'Not available');
  assert.match(document.getElementById('overviewPropertyTaxBasis').innerHTML, /did not answer automated lookups\. Open the tax bill on the county site\. <a href="https:\/\/cp\.spokanecounty\.org/);
});

test('overview: links to hosts other than the county tax sites are dropped', () => {
  const { T, document } = page();
  T.render({ ...billedTax, link: { label: 'View tax bill', url: 'https://evil.example/x' } });
  assert.doesNotMatch(document.getElementById('overviewPropertyTaxBasis').innerHTML, /<a /);
  assert.equal(T.safeUrl('javascript:alert(1)'), '');
});

test('report: page 2 assessor record gains the property tax line', () => {
  const { report } = page();
  const billed = report({ parcel, propertyAssessment: kootenai, propertyTax: estimatedTax });
  assert.match(billed, /<span>Property tax \(2026\)<\/span><strong>≈ \$25\.10<sup class="ref">\[\d+\]<\/sup><\/strong><small>Estimated from the 2026 levy rate; excludes fees and special assessments\.<\/small>/);
  const none = report({ parcel, propertyAssessment: kootenai, propertyTax: blockedTax });
  assert.match(none, /<span>Property tax<\/span><strong>Not available<sup class="ref">/);
  const without = report({ parcel, propertyAssessment: kootenai });
  assert.doesNotMatch(without, /Property tax/);
});

// ---- Montana (Yellowstone, Gallatin): the mapped state cadastral record (cadastralRecords,
// src/states/montana/assessment.js). The answers come from the Worker itself, with the DNRC and
// Yellowstone layers stubbed from test/fixtures/mt-cadastral-assessment.json (records recorded
// 2026-11-19, fake PLACEHOLDER_* owner fields added).
const mtFixture = JSON.parse(read('test/fixtures/mt-cadastral-assessment.json'));
async function mtAnswer(county, parcelId) {
  const { default: worker } = await import('../src/index.js');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const where = url.searchParams.get('where') || '';
    const id = (/'([^']+)'/.exec(where) || [])[1] || '';
    const hit = [...where.matchAll(/'([^']+)'/g)].map(m => m[1]).find(i => mtFixture.records[i]);
    const list = url.hostname === 'gis.dnrc.mt.gov' ? (/^PARCELID IN \(/.test(where) && hit ? [mtFixture.records[hit]] : [])
      : url.hostname === 'gis.yellowstonecountymt.gov' ? (mtFixture.yellowstoneTaxParcel[id] ? [mtFixture.yellowstoneTaxParcel[id]] : []) : null;
    if (!list) throw new Error(`unexpected upstream ${url.hostname}`);
    return new Response(JSON.stringify({ features: list.map(attributes => ({ attributes })) }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const response = await worker.fetch(new Request('https://acresx.test/api/property-assessment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'MT', county, parcelId }) }), { ASSETS: { fetch: async () => new Response('', { status: 404 }) } }, { waitUntil() {} });
    return await response.json();
  } finally { globalThis.fetch = realFetch; }
}
const mtParcel = pid => ({ type: 'Feature', properties: { ORIG_PARCEL_ID: pid, _stateCode: 'MT', _stateDisplay: 'Montana' }, geometry: null });
const AG = /assessed by use as agricultural or forest land\. Montana values that land on what it produces/;

test('overview: Yellowstone vacant parcel shows the property type as a tax category, the land use with the ag note, levy, legal and the record link', async () => {
  const data = await mtAnswer('Yellowstone', '03092732390050000');
  const { A, fact, document } = page();
  A.renderAssessment(A.normalize(data));
  assert.equal(fact('overviewAssessorValue'), '$12,666');
  assert.equal(fact('overviewLandValue'), '$12,666');
  assert.equal(fact('overviewAssessmentYear'), '2026');
  assert.equal(fact('overviewAssessorClass'), 'Vacant Land');
  assert.equal(document.getElementById('overviewAssessorClassWrap').querySelector('small.assessor-class-note').textContent, 'Tax category, not zoning. The assessor lists no taxable buildings.');
  assert.equal(fact('overviewAssessorLandUse'), '38.6 ac wild hay · 14.4 ac grazing');
  assert.match(document.getElementById('overviewAssessorLandUseWrap').querySelector('small.assessor-class-note').textContent, AG);
  const source = document.getElementById('propertyAssessmentSource').innerHTML;
  assert.equal(source, '<strong>Assessment source:</strong> Montana Cadastral / ORION (Department of Revenue) · Improvements $0 · Assessor acres 53.09 ac · Levy district 03-0968-3 · Legal: HARVEY SUBD, S32, T01 S, R26 E, BLOCK 1, Lot 5A, AMD (25). Montana Department of Revenue appraisal for the tax year. Assessor values are informational and are not the current tax bill. <a href="https://svc.mt.gov/msl/cadastral/?page=PropertyDetails&amp;geocode=03092732390050000" target="_blank" rel="noopener">View on the Montana Cadastral property record ↗</a>');
  assert.doesNotMatch(JSON.stringify(document.body.textContent) + source, /PLACEHOLDER/);
});

test('overview: Yellowstone improved parcel shows the building value; Gallatin with no land-use classes shows no land-use fact', async () => {
  const { A, fact, document } = page();
  A.renderAssessment(A.normalize(await mtAnswer('Yellowstone', '03113503101110000')));
  assert.equal(fact('overviewAssessorValue'), '$98,204');
  assert.equal(fact('overviewAssessorClass'), 'Improved Property');
  assert.equal(fact('overviewAssessorLandUse'), '32.7 ac irrigated · 3.85 ac grazing · 1 ac farmsite (homesite)');
  assert.match(document.getElementById('propertyAssessmentSource').innerHTML, / · Improvements \$55,720 · Assessor acres 37\.58 ac · Levy district 03-0982-24 · /);
  // A later Gallatin search removes the stale land-use fact.
  A.renderAssessment(A.normalize(await mtAnswer('Gallatin', '06069905302080000')));
  assert.equal(document.getElementById('overviewAssessorLandUseWrap'), null);
  assert.equal(fact('overviewAssessorValue'), '$1,228,455');
  assert.equal(fact('overviewAssessorClass'), 'Vacant Land');
  assert.match(document.getElementById('propertyAssessmentSource').innerHTML, /Legal: S05, T03 S, R06 E, C\.O\.S\. 1103K, PARCEL 8A-2, ACRES 10\.001\./);
});

test('overview: Montana with no state record (DNRC down) shows "Not available", never $0; missing values stay missing', async () => {
  const { A, fact, document } = page();
  const county = { available: true, state: 'MT', county: 'Yellowstone', parcelId: '03092732390050000', countyRecords: [{ GEOCODE: '03092732390050000' }], statewideRecords: [], cadastralRecords: [] };
  assert.equal(A.normalize(county), null);
  A.renderAssessment(A.normalize(county));
  assert.equal(fact('overviewAssessorValue'), 'Not available');
  const sparse = { ...county, cadastralRecords: [{ parcelNumber: '03092732390050000', totalValue: 5000, landValue: null, improvementValue: null, taxYear: null, landUse: [], propertyClass: null, propertyClassDescription: null }] };
  A.renderAssessment(A.normalize(sparse));
  assert.equal(fact('overviewAssessorValue'), '$5,000');
  assert.equal(fact('overviewLandValue'), 'Not available');
  assert.equal(document.getElementById('overviewAssessorClassWrap'), null);
  assert.equal(document.getElementById('overviewAssessorLandUseWrap'), null);
  const source = document.getElementById('propertyAssessmentSource').innerHTML;
  assert.doesNotMatch(source, /\$0|Improvements|Levy|Legal|<a /);
});

test('report: Yellowstone assessor record reads the state record (not the value-less county layer), with land use, levy and legal', async () => {
  const data = await mtAnswer('Yellowstone', '03092732390050000');
  const { report } = page();
  const html = report({ parcel: mtParcel('03092732390050000'), propertyAssessment: data });
  assert.match(html, /<span>Assessed value \(2026\)<\/span><strong>\$12,666<\/strong><small>Land only; no assessed improvements<\/small>/);
  assert.match(html, /<span>Tax category<\/span><strong>Vacant Land<\/strong><small>Tax category, not zoning\. The assessor lists no taxable buildings\.<\/small>/);
  assert.match(html, /<span>Assessor acres<\/span><strong>53\.09 ac<\/strong>/);
  assert.match(html, /<span>Assessed land use<\/span><strong>38\.6 ac wild hay · 14\.4 ac grazing<\/strong><small>Part of this parcel is assessed by use/);
  assert.match(html, /<span>Levy district<\/span><strong>03-0968-3<\/strong>/);
  assert.match(html, /<span>Legal description<\/span><strong>HARVEY SUBD, S32, T01 S, R26 E, BLOCK 1, Lot 5A, AMD \(25\)<\/strong>/);
  assert.match(html, /Montana Cadastral \(Department of Revenue ORION\), tax year 2026 <span class="url">svc\.mt\.gov<\/span>/);
  assert.doesNotMatch(html, /PLACEHOLDER|undefined|NaN/);
  const improved = report({ parcel: mtParcel('03113503101110000'), propertyAssessment: await mtAnswer('Yellowstone', '03113503101110000') });
  assert.match(improved, /<span>Land<\/span><strong>\$42,484<\/strong><\/div><div><span>Improvements<\/span><strong>\$55,720<\/strong>/);
  assert.match(improved, /<span>Tax category<\/span><strong>Improved Property<\/strong>/);
});

test('report: Gallatin has no land-use row; a saved/shared snapshot renders the same Montana assessor record', async () => {
  const { window } = page();
  const R = window.AcresXReport;
  const model = R.buildModel('Gallatin test', { parcel: mtParcel('06069905302080000'), propertyAssessment: await mtAnswer('Gallatin', '06069905302080000') });
  model.generatedAt = '2026-11-19T00:00:00.000Z';
  const live = R.renderHtml(model, { brand: null, date: model.generatedAt });
  assert.match(live, /<span>Assessed value \(2026\)<\/span><strong>\$1,228,455<\/strong>/);
  assert.match(live, /<span>Assessor acres<\/span><strong>10\.00 ac<\/strong>/);
  assert.match(live, /<span>Levy district<\/span><strong>06-235036-7R 36<\/strong>/);
  assert.doesNotMatch(live, /Assessed land use/);
  const snap = JSON.parse(JSON.stringify(R.snapshot(model)));
  assert.equal(snap.f.assess.levyDistrict, '06-235036-7R 36');
  assert.doesNotMatch(JSON.stringify(snap), /PLACEHOLDER/);
  assert.equal(R.renderHtml(snap, { brand: null, date: snap.generatedAt }), live);
  // Yellowstone (land use + ag note) survives the snapshot too.
  const y = R.buildModel('Yellowstone test', { parcel: mtParcel('03092732390050000'), propertyAssessment: await mtAnswer('Yellowstone', '03092732390050000') });
  y.generatedAt = model.generatedAt;
  const ySnap = JSON.parse(JSON.stringify(R.snapshot(y)));
  assert.match(R.renderHtml(ySnap, { brand: null, date: ySnap.generatedAt }), /<span>Assessed land use<\/span><strong>38\.6 ac wild hay · 14\.4 ac grazing<\/strong><small>Part of this parcel/);
});

test('Montana state record missing: Yellowstone county legal description is still shown on the dashboard and the report', () => {
  const data = { available: true, state: 'MT', county: 'Yellowstone', parcelId: '03092732390050000', countyRecords: [{ GEOCODE: '03092732390050000', SHORTLEGAL: 'HARVEY SUBD, S32, T01 S, R26 E, BLOCK 1, Lot 5A, AMD (25)' }], statewideRecords: [], cadastralRecords: [], countyLegalDescription: 'HARVEY SUBD, S32, T01 S, R26 E, BLOCK 1, Lot 5A, AMD (25)' };
  const { A, fact, document, report } = page();
  A.renderAssessment(A.normalize(data));
  assert.equal(fact('overviewAssessorValue'), 'Not available');
  assert.equal(fact('overviewLandValue'), 'Not available');
  assert.equal(document.getElementById('overviewAssessorClassWrap'), null);
  assert.equal(document.getElementById('propertyAssessmentSource').innerHTML, '<strong>Assessment source:</strong> Yellowstone County tax parcel record · Legal: HARVEY SUBD, S32, T01 S, R26 E, BLOCK 1, Lot 5A, AMD (25). The Montana Cadastral values did not load; try again later. Assessor values are informational and are not the current tax bill.');
  const html = report({ parcel: mtParcel('03092732390050000'), propertyAssessment: data });
  assert.match(html, /<span>Assessed value<\/span><strong>Not available<\/strong>/);
  assert.match(html, /<span>Legal description<\/span><strong>HARVEY SUBD, S32, T01 S, R26 E, BLOCK 1, Lot 5A, AMD \(25\)<\/strong>/);
  assert.match(html, /Yellowstone County tax parcel record \(Montana Cadastral values did not load\)/);
  assert.doesNotMatch(html, /undefined|NaN|\$0/);
});
