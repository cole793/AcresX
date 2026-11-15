// U.S. Census geocoder, the last resort for /api/address-search (action 'census'): a typed
// address the county locator and parcel situs field could not match.
//
// Census interpolates along TIGER road centerlines, so its point sits on or beside the road and
// often falls in a neighbour or a right-of-way polygon (research 2026-11-15: right parcel for 1 of
// 6 test addresses). It is therefore only ever an approximate map location: the page shows it on
// the map, labelled "Approximate location - confirm the parcel", and never selects a parcel
// without the user's click. It sends no CORS header, so the Worker calls it. Free, no key.
import { upstreamJson } from '../shared/upstream.js';

export const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const STATE_NAMES = { WA: 'Washington', ID: 'Idaho', MT: 'Montana' };

// The address with its state appended when the text does not already end in it.
export function censusAddress(text, state) {
  const t = String(text).trim();
  return new RegExp(`(,|\\s)(${state}|${STATE_NAMES[state] || state})(\\s+\\d{5})?$`, 'i').test(t) ? t : `${t}, ${state}`;
}

// { point, matchedAddress } for the first match in `state`, or null.
export async function censusGeocode(text, state) {
  const data = await upstreamJson(CENSUS_GEOCODER, {
    params: { address: censusAddress(text, state), benchmark: 'Public_AR_Current', format: 'json' },
    timeoutMs: 10000, retryTimeoutMs: 8000, label: 'census-geocoder', agency: 'U.S. Census geocoder'
  });
  const match = (Array.isArray(data?.result?.addressMatches) ? data.result.addressMatches : [])
    .find(m => String(m?.addressComponents?.state || '').toUpperCase() === state && Number.isFinite(Number(m?.coordinates?.x)) && Number.isFinite(Number(m?.coordinates?.y)));
  return match ? { point: { lat: Number(match.coordinates.y), lon: Number(match.coordinates.x) }, matchedAddress: String(match.matchedAddress || '') } : null;
}
