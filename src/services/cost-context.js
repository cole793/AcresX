// POST /api/cost-context: parcel facts the development-cost estimate needs that no other route
// returns (public/local-cost-model.js; Spokane and Kootenai only).
//   Request: { state, county, lat, lon }  (the parcel interior point)
//   Answer:  { roadAccess: <src/services/road-access.js answer>,
//              watershed: <src/states/washington/wria.js answer> (Washington only) }
// Each part degrades on its own; the route itself always answers 200 with both keys.

import { json } from '../shared/http.js';
import { lookupRoadAccess } from './road-access.js';
import { lookupWria } from '../states/washington/wria.js';

export async function lookupCostContext(body = {}) {
  const wa = String(body.state || '').toUpperCase().trim() === 'WA';
  const [roadAccess, watershed] = await Promise.all([
    lookupRoadAccess(body),
    wa ? lookupWria(body) : Promise.resolve({ available: false, status: 'not_applicable' })
  ]);
  return { roadAccess, watershed };
}

export async function handleCostContext(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON body required.' }, 400, 'no-store'); }
  const answer = await lookupCostContext(body || {});
  const complete = answer.roadAccess.available && (answer.watershed.available || answer.watershed.status === 'not_applicable');
  return json(answer, 200, complete ? 'public, max-age=3600, s-maxage=86400' : 'no-store');
}
