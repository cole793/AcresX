// POST /api/address-search: address autocomplete, address -> parcel, map click -> parcel and the
// "Parcel not found" checks for public/address-search.js. Additive; no existing route changes.
//
// Body: { action, state, county, text?, magicKey?, lat?, lon?, parcelId? }
//   suggest         { suggestions: [{ text, magicKey? | parcelId? }] }
//   resolve         { method, point, matchedAddress, interpolated, exact, parcels: [...] }
//   point           { point, near, parcels: [...] }
//   census          { approximate: true, point, matchedAddress }  (no parcel: the page asks the
//                   user to confirm one on the map with action 'point')
//   other-counties  { parcelId, matches: [{ county, parcelId, address, city }], example }
// Each parcel is { parcelId, address, city, county, state }: ID and situs fields only, never
// owner or mailing fields (src/shared/address-locator.js). Every answer has available, state,
// county, action and source { agency }; failures are available:false with error (400 for bad
// input, 502 for an upstream failure, so the page degrades only the address search).
//
// Why a Worker route (and not browser calls to each county): the field allowlists, the
// right-of-way filter and the county mappings stay in one tested place (src/counties/, src/states/),
// the shared upstream client applies its timeouts, per-host cap and logs, and the Census
// geocoder has no CORS. Kootenai is the exception: map.kcgov.us blocks Cloudflare, so its
// actions answer at once with a browser fallback hint (public/browser-fallback.js runs them).
import { json } from '../shared/http.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { fallbackHint } from '../shared/fallback.js';
import { cleanAddressText, cleanMagicKey, cleanParcelId, cleanPoint, parcelsAt, parcelsById, resolveAddress, suggestAddresses } from '../shared/address-locator.js';
import { spokaneAddressSource } from '../counties/spokane-address.js';
import { stevensAddressSource } from '../counties/stevens-address.js';
import { kootenaiAddressSource } from '../counties/kootenai-address.js';
import { montanaAddressSource } from '../states/montana/address.js';
import { washingtonAddressSource } from '../states/washington/address.js';
import { idahoAddressSource } from '../states/idaho/address.js';
import { censusGeocode } from './census-geocoder.js';

const ACTIONS = new Set(['suggest', 'resolve', 'point', 'census', 'other-counties']);
const CENSUS_SOURCE = { agency: 'U.S. Census geocoder (approximate)' };
export const APPROXIMATE_LABEL = 'Approximate location — confirm the parcel';

export function addressSourceFor(state, county) {
  const c = String(county || '').toLowerCase();
  if (state === 'WA') return c === 'spokane' ? spokaneAddressSource : c === 'stevens' ? stevensAddressSource : washingtonAddressSource(county);
  if (state === 'ID') return c === 'kootenai' ? kootenaiAddressSource : idahoAddressSource(county);
  if (state === 'MT') return montanaAddressSource(county);
  return null;
}

// Supported counties in the same state that have their own parcel layer to check a number on.
function otherCountySources(state, county) {
  const c = String(county || '').toLowerCase();
  if (state === 'WA') return [spokaneAddressSource, stevensAddressSource].filter(s => s.county.toLowerCase() !== c);
  if (state === 'MT') return [montanaAddressSource('')]; // statewide: any county but the chosen one
  if (state === 'ID') return c === 'kootenai' ? [] : [kootenaiAddressSource];
  return [];
}

// The minimum the action needs, checked (also the browser hint's input).
function actionInput(action, body) {
  if (action === 'suggest' || action === 'census') return { action, text: cleanAddressText(body.text) };
  if (action === 'resolve') return { action, text: cleanAddressText(body.text), magicKey: cleanMagicKey(body.magicKey) };
  if (action === 'point') return { action, ...cleanPoint(body.lat, body.lon) };
  return { action, parcelId: cleanParcelId(body.parcelId) };
}

// Runs one action on one source (the Worker's own sources; Kootenai's run in the browser).
export async function runAddressAction(source, input) {
  if (input.action === 'suggest') return suggestAddresses(source, input.text);
  if (input.action === 'resolve') return resolveAddress(source, input);
  if (input.action === 'point') { const point = { lat: input.lat, lon: input.lon }; return { point, ...(await parcelsAt(source, point)) }; }
  throw new Error(`Unsupported address action ${input.action}`);
}

async function otherCounties(state, county, input, source) {
  const base = { parcelId: input.parcelId, example: source?.example || '' };
  const others = otherCountySources(state, county);
  const browser = others.find(s => s.browserKind);
  if (browser) return { ...base, browser };
  const settled = await Promise.allSettled(others.map(s => parcelsById(s, input.parcelId)));
  const matches = settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []))
    .filter(p => p.county && p.county.toLowerCase() !== String(county).toLowerCase())
    .map(({ county: c, parcelId, address, city }) => ({ county: c, parcelId, address, city }));
  return { ...base, matches, checked: others.map(s => s.county || 'statewide'), unavailable: settled.some(r => r.status === 'rejected') };
}

export async function handleAddressSearch(request) {
  let body;
  try { body = await request.json(); } catch { return json({ available: false, error: 'Invalid JSON body.' }, 400, 'no-store'); }
  const action = String(body?.action || '');
  const state = String(body?.state || '').toUpperCase().trim();
  const county = String(body?.county || '').replace(/\s+County$/i, '').trim();
  const head = { state, county, action };
  if (!ACTIONS.has(action)) return json({ available: false, ...head, error: 'Unknown address search action.' }, 400, 'no-store');
  const source = addressSourceFor(state, county);
  if (!source) return json({ available: false, ...head, error: 'Address search covers Washington, Idaho and Montana.' }, 400, 'no-store');
  let input;
  try { input = actionInput(action, body || {}); } catch (error) { return json({ available: false, ...head, error: error.message }, 400, 'no-store'); }
  try {
    if (action === 'census') {
      const found = await censusGeocode(input.text, state);
      return json({ available: true, ...head, approximate: true, label: APPROXIMATE_LABEL, point: found?.point || null, matchedAddress: found?.matchedAddress || '', source: CENSUS_SOURCE }, 200, 'no-store');
    }
    if (action === 'other-counties') {
      const answer = await otherCounties(state, county, input, source);
      if (answer.browser) return json({ available: false, ...head, parcelId: answer.parcelId, example: answer.example, matches: [], source: { agency: answer.browser.agency }, fallback: fallbackHint(answer.browser.browserKind, { ...input, county }) }, 200, 'no-store');
      return json(withoutPersonalFields({ available: true, ...head, ...answer, source: { agency: 'county parcel layers' } }), 200, 'no-store');
    }
    if (source.browserKind) {
      return json({ available: false, ...head, error: `${source.agency} answers browsers only; loading it from your browser.`, source: { agency: source.agency }, fallback: fallbackHint(source.browserKind, input) }, 200, 'no-store');
    }
    const result = await runAddressAction(source, input);
    return json(withoutPersonalFields({ available: true, ...head, example: source.example, ...result, source: { agency: source.agency } }), 200, 'no-store');
  } catch (error) {
    console.warn('address search failed', action, source.key, error?.message || error);
    return json({ available: false, ...head, error: `${action === 'census' ? 'Census geocoder' : source.agency} unavailable: ${error?.message || 'request failed'}` }, 502, 'no-store');
  }
}
