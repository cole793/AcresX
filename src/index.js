import legacyWorker from './worker.js';
import { getZoningProfile } from './zoning-counties.js';
import { getSpokaneCountyIntelligence } from './counties/spokane.js';
import { handleLandAnalysis } from './services/land-analysis.js';
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (request.method === 'POST' && url.pathname === '/api/land-analysis') {
        return await handleLandAnalysis(request);
      }

      if (request.method === 'POST' && url.pathname === '/api/zoning-permits') {
        try {
          const response = await handleZoningPermits(request);
          if (response) return response;
        } catch (error) {
          console.warn('Modular Spokane adapter failed; using legacy fallback.', error);
        }
      }

      return await legacyWorker.fetch(request, env, ctx);
    } catch (error) {
      return json({ error: error?.message || 'Request failed' }, 502, 'no-store');
    }
  }
};
