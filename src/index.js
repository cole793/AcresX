import legacyWorker from './worker.js';
import { getZoningProfile } from './zoning-counties.js';
import { getSpokaneCountyIntelligence } from './counties/spokane.js';
import { handleLandAnalysis } from './services/land-analysis.js';
import { handlePowerIntelligence } from './services/power-intelligence.js';
import { handleZoningRules } from './services/zoning-rules.js';
import { json } from './shared/http.js';

async function handleZoningPermits(request) {
  const body = await request.clone().json();
  const county = String(body.county || '').replace(/\s+County$/i, '').trim();
  const hasPoint = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lon));
  if (!/^spokane$/i.test(county) || !hasPoint) return null;
  const profile = getZoningProfile(county);
  const result = await getSpokaneCountyIntelligence(body, profile);
  return json(result, 200, 'public, max-age=3600, s-maxage=86400');
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
      if (request.method === 'POST' && url.pathname === '/api/land-analysis') return await handleLandAnalysis(request);
      if (request.method === 'POST' && url.pathname === '/api/power-intelligence') return await handlePowerIntelligence(request);
      if (request.method === 'POST' && url.pathname === '/api/zoning-rules') return await handleZoningRules(request);
      if (request.method === 'POST' && url.pathname === '/api/zoning-permits') {
        try {
          const response = await handleZoningPermits(request);
          if (response) return response;
        } catch (error) {
          console.warn('Modular Spokane adapter failed; using legacy fallback.', error);
        }
      }
      const response = await legacyWorker.fetch(request, env, ctx);
      return await maybeInjectUiPolish(request, response);
    } catch (error) {
      return json({ error: error?.message || 'Request failed' }, 502, 'no-store');
    }
  }
};
