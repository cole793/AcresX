import legacyWorker from './worker.js';
import { getZoningProfile } from './zoning-counties.js';
import { getSpokaneCountyIntelligence } from './counties/spokane.js';
import { getYellowstoneCountyIntelligence } from './counties/yellowstone.js';
import { findYellowstoneParcel } from './states/montana/parcels.js';
import { findMontanaWells } from './states/montana/wells.js';
import { handleLandAnalysis } from './services/land-analysis.js';
import { handleSlopeGrid } from './services/slope-grid.js';
import { handleWetlands } from './services/wetlands.js';
import { handlePowerIntelligence } from './services/power-intelligence.js';
import { handleUtilityTerritory } from './services/utility-territory.js';
import { handleZoningRules } from './services/zoning-rules.js';
import { handlePropertyTaxTest } from './services/property-tax-test.js';
import { json } from './shared/http.js';

async function handleParcelSearch(request) {
  const body = await request.json();
  const state = String(body.state || '').toUpperCase().trim();
  const county = String(body.county || '').replace(/\s+County$/i, '').trim();
  const parcelId = String(body.parcelId || '').trim();
  if (state === 'MT' && /^yellowstone$/i.test(county)) {
    const parcel = await findYellowstoneParcel(parcelId);
    return json({ available: true, state: 'MT', county: 'Yellowstone', parcel }, 200, 'public, max-age=300, s-maxage=3600');
  }
  return json({ available: false, error: 'This state/county parcel adapter is not supported by the new router yet.' }, 400, 'no-store');
}

async function handleWellSearch(request) {
  const body = await request.json();
  const state = String(body.state || '').toUpperCase().trim();
  if (state !== 'MT') return json({ available: false, error: 'New well-search router currently supports Montana only.' }, 400, 'no-store');
  const result = await findMontanaWells({ lat: body.lat, lon: body.lon });
  return json(result, 200, 'public, max-age=3600, s-maxage=86400');
}

async function handleZoningPermits(request) {
  const body = await request.clone().json();
  const county = String(body.county || '').replace(/\s+County$/i, '').trim();
  const hasPoint = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lon));
  if (!hasPoint) return null;
  if (/^spokane$/i.test(county)) {
    const profile = getZoningProfile(county);
    const result = await getSpokaneCountyIntelligence(body, profile);
    return json(result, 200, 'public, max-age=3600, s-maxage=86400');
  }
  if (/^yellowstone$/i.test(county)) {
    const result = await getYellowstoneCountyIntelligence(body);
    return json(result, 200, 'public, max-age=3600, s-maxage=86400');
  }
  return null;
}

async function runPropertyTaxBrowserTest(request) {
  const tests = [
    { state: 'WA', county: 'Spokane', parcelId: '47174.9017' },
    { state: 'MT', county: 'Yellowstone', parcelId: '03092727411010000' }
  ];
  const results = [];
  for (const test of tests) {
    const testRequest = new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(test)
    });
    const response = await handlePropertyTaxTest(testRequest);
    results.push(await response.json());
  }
  return json({ test: 'AcresX property tax / assessment sources', results }, 200, 'no-store');
}

async function maybeInjectUiPolish(request, response) {
  if (request.method !== 'GET') return response;
  const url = new URL(request.url);
  if (url.pathname !== '/' && url.pathname !== '/index.html') return response;
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  const scripts = [];
  if (!html.includes('/ui-polish.js')) scripts.push('<script src="/ui-polish.js"></script>');
  if (!html.includes('/parcel-preview.js')) scripts.push('<script src="/parcel-preview.js"></script>');
  if (!html.includes('/score-cost.js')) scripts.push('<script src="/score-cost.js"></script>');
  if (!html.includes('/zoning-potential.js')) scripts.push('<script src="/zoning-potential.js"></script>');
  if (!html.includes('/snapshot-accordion.js')) scripts.push('<script src="/snapshot-accordion.js"></script>');
  if (!html.includes('/state-selector.js')) scripts.push('<script src="/state-selector.js"></script>');
  if (!html.includes('/slope-map.js')) scripts.push('<script src="/slope-map.js"></script>');
  if (!html.includes('/screening-refinements.js')) scripts.push('<script src="/screening-refinements.js"></script>');
  if (!html.includes('/branding-polish.js')) scripts.push('<script src="/branding-polish.js"></script>');
  if (!html.includes('/library-polish.js')) scripts.push('<script src="/library-polish.js"></script>');
  if (!html.includes('/loading-modal.js')) scripts.push('<script src="/loading-modal.js"></script>');
  if (!html.includes('/property-assessment.js')) scripts.push('<script src="/property-assessment.js"></script>');
  if (!scripts.length) return new Response(html, response);
  const polished = html.replace('</body>', `${scripts.join('\n')}\n</body>`);
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(polished, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/property-tax-test' && request.method === 'GET') return await runPropertyTaxBrowserTest(request);
      if (url.pathname === '/api/property-tax-test' && request.method === 'POST') return await handlePropertyTaxTest(request);
      if (url.pathname === '/api/property-assessment' && request.method === 'POST') return await handlePropertyTaxTest(request);
      if (request.method === 'POST' && url.pathname === '/api/parcel-search') return await handleParcelSearch(request);
      if (request.method === 'POST' && url.pathname === '/api/well-search') return await handleWellSearch(request);
      if (request.method === 'POST' && url.pathname === '/api/utility-territory') return await handleUtilityTerritory(request);
      if (request.method === 'POST' && url.pathname === '/api/land-analysis') return await handleLandAnalysis(request);
      if (request.method === 'POST' && url.pathname === '/api/slope-grid') return await handleSlopeGrid(request);
      if (request.method === 'POST' && url.pathname === '/api/hazards') {
        const clone = request.clone();
        try {
          const body = await clone.json();
          if (body?.kind === 'wetlands') return await handleWetlands(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(body) }));
        } catch (_) {}
      }
      if (request.method === 'POST' && url.pathname === '/api/power-intelligence') return await handlePowerIntelligence(request);
      if (request.method === 'POST' && url.pathname === '/api/zoning-rules') return await handleZoningRules(request);
      if (request.method === 'POST' && url.pathname === '/api/zoning-permits') {
        try {
          const response = await handleZoningPermits(request);
          if (response) return response;
        } catch (error) { console.warn('Modular county zoning adapter failed; using legacy fallback.', error); }
      }
      const response = await legacyWorker.fetch(request, env, ctx);
      return await maybeInjectUiPolish(request, response);
    } catch (error) {
      return json({ error: error?.message || 'Request failed' }, 502, 'no-store');
    }
  }
};
