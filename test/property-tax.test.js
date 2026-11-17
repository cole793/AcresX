// Offline tests for /api/property-tax (src/services/property-tax.js and src/counties/*-tax.js).
// Network is stubbed: the treasurer pages are sanitized fixtures in test/fixtures/tax/ (only the
// tax labels and tables AcresX reads, no personal details), GIS answers are canned objects.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { isChallengePage, money, TAX_USER_AGENT } from '../src/shared/tax-page.js';
import { parseSpokaneTax, spokaneTaxUrl } from '../src/counties/spokane-tax.js';
import { parseStevensTax } from '../src/counties/stevens-tax.js';
import { parseYellowstoneTax, montanaBillYear, yellowstoneTaxUrl } from '../src/counties/yellowstone-tax.js';
import { parseGallatinTax, gallatinTaxId, GALLATIN_TAX_LABELS } from '../src/counties/gallatin-tax.js';
import { estimateKootenaiTax, KOOTENAI_TAX_NOTE } from '../src/counties/kootenai-tax.js';
import { KOOTENAI_LEVY_RATES_2026, kootenaiTagKey, kootenaiLevyRate } from '../src/counties/kootenai-levy-2026.js';
import { PROPERTY_TAX_CACHE_PREFIX, TAX_LINK_HOSTS, taxLinkUrl, taxAnswer } from '../src/services/property-tax.js';

const FIXTURES = new URL('./fixtures/tax/', import.meta.url);
const page = name => readFileSync(new URL(name, FIXTURES), 'utf8');
const env = { ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
const ctx = { waitUntil() {} };
const html = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const features = list => new Response(JSON.stringify({ features: list.map(attributes => ({ attributes })) }), { headers: { 'Content-Type': 'application/json' } });

const realFetch = globalThis.fetch, realWarn = console.warn, realCaches = globalThis.caches;
let requested = [], restoreUpstream;
function stubFetch(handler) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    requested.push({ url, headers: new Headers(init.headers || {}) });
    return handler(url, init);
  };
}
beforeEach(() => {
  requested = [];
  globalThis.fetch = async () => { throw new Error('network disabled in tests'); };
  console.warn = () => {};
  restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} });
});
afterEach(() => {
  globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream();
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

async function tax(body) {
  const response = await worker.fetch(new Request('https://acresx.test/api/property-tax', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }), env, ctx);
  return { status: response.status, body: await response.json() };
}

// Upstream answers per host for the six sample parcels.
const STEVENS_LINK = 'http://propertysearch.trueautomation.com/PropertyAccess/Property.aspx?cid=0&year=2026&prop_id=16030';
function upstream(pages = {}) {
  return url => {
    if (url.hostname === 'cp.spokanecounty.org') return pages.spokane ? pages.spokane(url) : html(page(`spokane-${url.searchParams.get('PID')}.html`));
    if (url.hostname === 'gis.stevenscountywa.gov') return features([{ PARCELN: '0434200', prop_id: 16030, year: 2026, taxable_va: 589375, Propertyinformation: STEVENS_LINK }]);
    if (url.hostname === 'propertysearch.trueautomation.com') return pages.stevens ? pages.stevens(url) : html(page('stevens-16030.html'));
    if (url.hostname === 'map.kcgov.us') {
      const layer = Number(url.pathname.split('/').at(-2));
      if (layer !== 9) return features([]);
      const fields = url.searchParams.get('outFields');
      return features([fields.includes('TAG')
        ? { PIN: '50N04W323200', TAG: '2490000', AssessValue_Net: 6893, AssessValue_Date: 20260101 }
        : { PIN: '50N04W323200', AIN: '195322', AssessValue_Net: 6893, AssessValue_Land: 399422, AssessValue_Imp: 0, AssessValue_Date: 20260101 }]);
    }
    if (url.hostname === 'gis.yellowstonecountymt.gov') return features([{ GEOCODE: '03072527101010000', TAX_ID: 'D03781' }]);
    if (url.hostname === 'www.yellowstonecountymt.gov') return pages.yellowstone ? pages.yellowstone(url) : html(page(`yellowstone-D03781-${url.searchParams.get('lyear')}.html`));
    if (url.hostname === 'gis.dnrc.mt.gov') return features([{ PARCELID: '06069905302080000', AssessmentCode: '00RHH41234' }]);
    if (url.hostname === 'itax.gallatin.mt.gov') return pages.gallatin ? pages.gallatin(url) : html(page('gallatin-RHH41234.html'));
    throw new Error(`unexpected host ${url.hostname}`);
  };
}

// ---- Parsers

test('Spokane: SCOUT total, levy and date for 23123.9051', () => {
  assert.deepEqual(parseSpokaneTax(page('spokane-23123.9051.html')), { taxYear: 2026, total: 1877.65, adValorem: 1838.1, levyRate: 8.17, asOf: '2026-11-14' });
  assert.equal(spokaneTaxUrl('23123-9051'), 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=23123.9051');
  assert.equal(spokaneTaxUrl('../x'), null);
});

test('Spokane: exempt parcel 35204.2729 pays only the aquifer assessment', () => {
  const parsed = parseSpokaneTax(page('spokane-35204.2729.html'));
  assert.equal(parsed.total, 15);
  assert.equal(parsed.adValorem, 0);
  assert.equal(parsed.levyRate, 10.14);
});

test('Stevens: newest statement halves and total', () => {
  assert.deepEqual(parseStevensTax(page('stevens-16030.html')), {
    taxYear: 2026, total: 4146.04, asOf: '2026-11-14',
    installments: [{ label: 'First half', amount: 2073.04 }, { label: 'Second half', amount: 2073 }]
  });
});

test('Yellowstone: Totals row for the requested tax ID and year only', () => {
  assert.deepEqual(parseYellowstoneTax(page('yellowstone-D03781-2026.html'), { taxId: 'D03781', year: 2026 }), {
    taxYear: 2026, total: 178.82, asOf: '2026-11-14',
    installments: [{ label: 'First half', amount: 89.42 }, { label: 'Second half', amount: 89.4 }]
  });
  assert.equal(parseYellowstoneTax(page('yellowstone-D03781-2025.html'), { taxId: 'D03781', year: 2025 }).total, 178.28);
  assert.equal(parseYellowstoneTax(page('yellowstone-D03781-2026.html'), { taxId: 'D03781', year: 2025 }), null, 'year must match');
  assert.equal(parseYellowstoneTax(page('yellowstone-D03781-2026.html'), { taxId: 'D99999', year: 2026 }), null, 'tax ID must match');
  assert.equal(yellowstoneTaxUrl('D03781&x=1', 2026), null);
});

test('Montana bill year: the current year from November, else the previous one', () => {
  assert.equal(montanaBillYear(new Date('2026-11-15T00:00:00Z')), 2026);
  assert.equal(montanaBillYear(new Date('2026-10-31T00:00:00Z')), 2025);
  assert.equal(montanaBillYear(new Date('2027-03-01T00:00:00Z')), 2026);
});

test('Gallatin: only the listed labels are read', () => {
  assert.deepEqual(parseGallatinTax(page('gallatin-RHH41234.html')), {
    taxYear: 2026, total: 9208.96, taxableValue: 23341, levyDistrict: '2350-36, 7R Bozeman(R)HF', asOf: '2026-11-13',
    installments: [{ label: 'First half', amount: 4604.5 }, { label: 'Second half', amount: 4604.46 }]
  });
  assert.equal(gallatinTaxId('00RHH41234'), 'RHH41234');
  assert.equal(gallatinTaxId('00rhh41234'), 'RHH41234');
  assert.equal(gallatinTaxId('RHH41234'), null);
  for (const forbidden of ['lblOwners', 'lblMailing', 'lblReceipt']) assert.ok(!GALLATIN_TAX_LABELS.includes(forbidden));
  const source = readFileSync(new URL('../src/counties/gallatin-tax.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source.replace(/^\/\/.*$/gm, ''), /lblOwners|lblMailing|lblReceipt/, 'the code never names the owner labels outside comments');
});

test('Kootenai: TAG mapping, 2026 rate table and estimate', () => {
  assert.equal(Object.keys(KOOTENAI_LEVY_RATES_2026).length, 188);
  assert.equal(kootenaiTagKey('2490000'), '249-0000');
  assert.equal(kootenaiTagKey('249-0000'), '249-0000');
  assert.equal(kootenaiTagKey('24900'), null);
  assert.equal(kootenaiLevyRate('2490000'), 0.003641236);
  assert.equal(kootenaiLevyRate('1070000'), 0.003337443);
  assert.equal(kootenaiLevyRate('9990000'), null);
  assert.deepEqual(estimateKootenaiTax({ TAG: '2490000', AssessValue_Net: 6893, AssessValue_Date: 20260101 }), {
    taxYear: 2026, total: 25.1, levyRate: 3.641236, taxableValue: 6893, taxArea: '249-0000', valueYear: 2026
  });
  assert.equal(estimateKootenaiTax({ TAG: '1070000', AssessValue_Net: 93115 }).total, 310.77);
  assert.equal(estimateKootenaiTax({ TAG: '9990000', AssessValue_Net: 1000 }), null);
  assert.equal(estimateKootenaiTax({ TAG: '2490000', AssessValue_Net: null }), null);
});

test('helpers: money and challenge detection are strict', () => {
  assert.equal(money('$1,877.65'), 1877.65);
  assert.equal(money('1877.65 P'), null);
  assert.equal(money(''), null);
  assert.ok(isChallengePage('<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x"></script>'));
  assert.ok(isChallengePage('<div class="g-recaptcha" data-sitekey="x"></div>'));
  for (const name of readdirSync(FIXTURES)) assert.ok(!isChallengePage(page(name)), `${name} is not a challenge`);
});

// ---- Route

const SAMPLES = [
  [{ state: 'WA', county: 'Spokane', parcelId: '23123.9051' }, { basis: 'billed', taxYear: 2026, total: 1877.65, levyRate: 8.17 }],
  [{ state: 'WA', county: 'Spokane', parcelId: '35204.2729' }, { basis: 'billed', taxYear: 2026, total: 15, exempt: true }],
  [{ state: 'WA', county: 'Stevens', parcelId: '0434200' }, { basis: 'billed', taxYear: 2026, total: 4146.04 }],
  [{ state: 'ID', county: 'Kootenai', parcelId: '50N04W323200' }, { basis: 'estimate', taxYear: 2026, total: 25.1, note: KOOTENAI_TAX_NOTE }],
  [{ state: 'MT', county: 'Yellowstone', parcelId: '03072527101010000' }, { basis: 'billed', taxYear: 2026, total: 178.82 }],
  [{ state: 'MT', county: 'Gallatin', parcelId: '06069905302080000' }, { basis: 'billed', taxYear: 2026, total: 9208.96 }]
];

for (const [request, want] of SAMPLES) {
  test(`route: ${request.county} ${request.parcelId}`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-15T12:00:00Z') });
    stubFetch(upstream());
    const { status, body } = await tax(request);
    assert.equal(status, 200);
    assert.equal(body.available, true);
    assert.equal(body.status, 'found');
    for (const [k, v] of Object.entries(want)) assert.deepEqual(body[k], v, k);
    assert.ok(body.source?.url.startsWith('https://'));
    assert.ok(body.link?.url.startsWith('https://'));
    assert.match(body.label, /^(Billed|Estimated) 2026 property tax$/);
    // Each treasurer page is asked for once, with the honest User-Agent.
    const pages = requested.filter(r => !/arcgis|\/server\/rest\//.test(r.url.pathname));
    assert.ok(pages.length <= 1, `${pages.length} page requests`);
    for (const r of pages) assert.equal(r.headers.get('User-Agent'), TAX_USER_AGENT);
  });
}

for (const [label, reply] of [
  ['a 403', () => html('<html>Forbidden</html>', 403)],
  ['a bot challenge', () => html('<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget"></div></body></html>')],
  ['a captcha', () => html('<html><body><div class="h-captcha"></div><script src="https://hcaptcha.com/1/api.js"></script></body></html>')]
]) {
  for (const county of ['spokane', 'stevens', 'yellowstone', 'gallatin']) {
    test(`route: ${county} degrades to the tax bill link on ${label}, asked once`, async t => {
      t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-15T12:00:00Z') });
      stubFetch(upstream({ [county]: reply }));
      const request = SAMPLES.find(([r]) => r.county.toLowerCase() === county)[0];
      const { status, body } = await tax(request);
      assert.equal(status, 200);
      assert.equal(body.available, false);
      assert.equal(body.status, 'unavailable');
      assert.equal(body.total, null);
      assert.match(body.note, /did not answer automated lookups/);
      assert.match(body.link.label, /^View tax bill/);
      const pageHost = { spokane: 'cp.spokanecounty.org', stevens: 'propertysearch.trueautomation.com', yellowstone: 'www.yellowstonecountymt.gov', gallatin: 'itax.gallatin.mt.gov' }[county];
      assert.equal(requested.filter(r => r.url.hostname === pageHost).length, 1, 'no retry, no workaround');
    });
  }
}

test('route: a timeout or 500 degrades this layer only', async () => {
  stubFetch(upstream({ spokane: () => html('oops', 500) }));
  const { status, body } = await tax({ state: 'WA', county: 'Spokane', parcelId: '23123.9051' });
  assert.equal(status, 200);
  assert.equal(body.status, 'unavailable');
  assert.equal(body.link.url, 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=23123.9051');
  assert.equal(body.note, undefined);
});

test('route: Kootenai assessor down -> unavailable with the treasurer link', async () => {
  stubFetch(() => { throw new Error('connection reset'); });
  const { body } = await tax({ state: 'ID', county: 'Kootenai', parcelId: '50N04W323200' });
  assert.equal(body.status, 'unavailable');
  assert.equal(body.link.url, 'https://id-kootenai.publicaccessnow.com/Treasurer/TaxSearch.aspx');
});

test('route: limited-coverage counties say not available, with a county lookup link where known', async () => {
  stubFetch(() => { throw new Error('no upstream call expected'); });
  const mt = (await tax({ state: 'MT', county: 'Missoula', parcelId: '04220012345670000' })).body;
  assert.equal(mt.status, 'not_supported');
  assert.equal(mt.available, false);
  assert.match(mt.link.url, /^https:\/\/revenue\.mt\.gov\//);
  const id = (await tax({ state: 'ID', county: 'Ada', parcelId: 'R1234' })).body;
  assert.equal(id.status, 'not_supported');
  assert.equal(id.link, null);
  assert.equal(requested.length, 0);
  assert.equal((await tax({ state: 'WA', county: 'Spokane' })).status, 400);
});

test('route: found answers are cached 7 days per parcel; failures are not', async () => {
  const store = new Map(), writes = [];
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? new Response(hit) : undefined; },
    async put(req, res) { const text = await res.text(); store.set(req.url, text); writes.push({ key: req.url, cacheControl: res.headers.get('Cache-Control'), text }); }
  } };
  stubFetch(upstream({ gallatin: () => html('', 503) }));
  await tax({ state: 'MT', county: 'Gallatin', parcelId: '06069905302080000' });
  assert.equal(writes.filter(w => w.key.startsWith(PROPERTY_TAX_CACHE_PREFIX)).length, 0, 'unavailable is not cached');
  await tax({ state: 'WA', county: 'Spokane', parcelId: '23123.9051' });
  const written = writes.filter(w => w.key.startsWith(PROPERTY_TAX_CACHE_PREFIX));
  assert.equal(written.length, 1);
  assert.equal(written[0].cacheControl, `public, max-age=${7 * 24 * 60 * 60}`);
  const before = requested.length;
  const again = (await tax({ state: 'WA', county: 'Spokane', parcelId: '23123.9051' })).body;
  assert.equal(again.total, 1877.65);
  assert.equal(requested.length, before, 'served from the cache');
});

// ---- Personal data

const OWNER_LABELS = /owner|taxpayer|mailing|receipt|grantor|grantee|statement id|excise|lblOwners|lblMailing/i;

test('fixtures hold no owner, taxpayer, mailing, receipt, statement or sale details', () => {
  const names = readdirSync(FIXTURES);
  assert.equal(names.length, 6);
  for (const name of names) assert.doesNotMatch(page(name), OWNER_LABELS, name);
});

test('pages carrying owner data: the answer holds none of it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-15T12:00:00Z') });
  const planted = '<span id="MainContent_OwnerName_dlOwner_txtNameLabel_0">PLACEHOLDER OWNER</span><span id="MainContent_Taxpayer_dlTaxpayer_addressLabel_0">1 PLACEHOLDER MAIL ST</span>'
    + '<span id="_ctl0_ContentPlaceHolder1_lblOwners">PLACEHOLDER OWNER</span><span id="_ctl0_ContentPlaceHolder1_lblMailing">1 PLACEHOLDER MAIL ST</span><span id="_ctl0_ContentPlaceHolder1_lblReceipt">PLACEHOLDER 999</span>'
    + '<table><tr><td>Name:</td><td>PLACEHOLDER OWNER</td><td>Owner ID:</td><td>PLACEHOLDER 1</td></tr><tr><td>Grantor</td><td>PLACEHOLDER SELLER</td></tr></table>';
  const withOwner = name => () => html(page(name).replace('<body>', `<body>${planted}`));
  stubFetch(upstream({
    spokane: url => withOwner(`spokane-${url.searchParams.get('PID')}.html`)(),
    stevens: withOwner('stevens-16030.html'),
    yellowstone: withOwner('yellowstone-D03781-2026.html'),
    gallatin: withOwner('gallatin-RHH41234.html')
  }));
  for (const [request] of SAMPLES) {
    const { body } = await tax(request);
    assert.equal(body.available, true, request.county);
    assert.doesNotMatch(JSON.stringify(body), /PLACEHOLDER|owner|mailing|receipt|grantor/i, request.county);
  }
});

test('tax links: the Worker keeps only https links on the county tax hosts (same list as the page)', () => {
  const page = readFileSync(new URL('../public/property-tax.js', import.meta.url), 'utf8');
  const pageHosts = [...page.match(/const HOSTS = new Set\(\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual([...TAX_LINK_HOSTS].sort(), pageHosts.sort(), 'public/property-tax.js HOSTS and the server list agree');
  for (const host of TAX_LINK_HOSTS) assert.equal(taxLinkUrl(`https://${host}/x?y=1`), `https://${host}/x?y=1`, host);
  for (const bad of ['http://cp.spokanecounty.org/SCOUT', 'https://evil.example/SCOUT', 'https://cp.spokanecounty.org.evil.example/', 'https://user:pw@cp.spokanecounty.org/',
    'https://cp.spokanecounty.org:8443/', 'javascript:alert(1)', 'not a url', '', null, undefined]) assert.equal(taxLinkUrl(bad), undefined, String(bad));
  const ids = { state: 'WA', county: 'Spokane', parcelId: '23123.9051' };
  assert.equal(taxAnswer(ids, { status: 'not_found', link: { label: 'View tax bill', url: 'https://evil.example/bill' } }).link, null);
  assert.deepEqual(taxAnswer(ids, { status: 'not_found', link: { label: 'View tax bill on Spokane County SCOUT', url: 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=23123.9051' } }).link,
    { label: 'View tax bill on Spokane County SCOUT', url: 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=23123.9051' });
});
