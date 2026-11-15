// Address search building blocks for /api/address-search (src/services/address-search.js).
//
// An address source describes one county's (or state's) official address locator and parcel
// layer. The county-specific parts (URLs, field names, ID formats, placeholder values) live in
// the source's own adapter module (src/counties/*-address.js, src/states/*/address.js); this
// module only runs the steps the research settled on (2026-11-15):
//
//   suggest  the locator's /suggest while the user types (or, with no locator, a situs LIKE on
//            the parcel layer)
//   resolve  the locator's /findAddressCandidates (the picked suggestion's magicKey, or the typed
//            text) -> the best address point -> point-in-parcel on the parcel layer. When that
//            finds no parcel: a LIKE on the parcel layer's situs address field.
//   point    point-in-parcel for a map click (or a Census point, see src/services/census-geocoder.js)
//   byId     an exact parcel-number query (the "Did you mean <county>?" check)
//
// A source:
//   { key, state, county, agency, locator (GeocodeServer URL or null), parcelLayer, parcelFields,
//     situsField, scopeWhere (limits situs and id queries to the county, or ''), idWhere(id)
//     (where clause or null for an id that cannot be this county's), mapParcel(attrs) ({ parcelId,
//     address, city, county } or null for rows that are not real parcels), example (a parcel
//     number in the county's format), browserKind (set: the Worker never calls this host) }
//
// Personal fields: every parcel query names its outFields (the source's ID and situs fields
// only, never owner or mailing fields) and mapParcel copies named fields only.
//
// public/browser-fallback.js has a copy of the steps (kind 'kootenai-address'); change both
// together. test/address-search.test.js runs both on the same fixtures.

import { arcgisJson } from './upstream.js';

export const ADDRESS_TEXT_MAX = 120;
export const SUGGEST_MAX = 6;
export const PARCEL_CHOICES_MAX = 8;
// Candidate types that mark a real address location. StreetAddress is interpolated along the
// street, so its parcel needs the user's confirmation.
const POINT_TYPES = new Set(['PointAddress', 'Subaddress']);
const INTERPOLATED_TYPES = new Set(['StreetAddress', 'StreetAddressExt']);
const MIN_SCORE = 80;
// A point that falls in no parcel (a road, a gap) looks this far around it.
export const NEAR_METERS = 30;

const DIRECTIONS = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };
const DIRECTION_SET = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', ...Object.keys(DIRECTIONS)]);
const STREET_TYPES = { ROAD: 'RD', STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', DRIVE: 'DR', LANE: 'LN', TRAIL: 'TRL', TR: 'TRL', COURT: 'CT', HIGHWAY: 'HWY', PLACE: 'PL', BOULEVARD: 'BLVD', CIRCLE: 'CIR', PARKWAY: 'PKWY', TERRACE: 'TER', ROUTE: 'RTE' };
const STREET_TYPE_SET = new Set(['RD', 'ST', 'AVE', 'DR', 'LN', 'TRL', 'CT', 'HWY', 'PL', 'BLVD', 'CIR', 'PKWY', 'TER', 'LOOP', 'WAY', 'RTE', ...Object.keys(STREET_TYPES)]);

// ---- Input checks (shared with the browser copy)

// Letters, digits, spaces and the punctuation addresses use. Throws a 400-style error.
export function cleanAddressText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 3 || text.length > ADDRESS_TEXT_MAX || !/^[A-Za-z0-9 .,#'&/-]+$/.test(text)) {
    throw Object.assign(new Error('Enter a street address (letters, numbers and . , # \' & / - only).'), { status: 400 });
  }
  return text;
}
export function cleanMagicKey(value) {
  if (value === undefined || value === null || value === '') return '';
  const key = String(value);
  if (key.length > 1024 || !/^[A-Za-z0-9+/=_:.-]+$/.test(key)) throw Object.assign(new Error('Invalid suggestion key.'), { status: 400 });
  return key;
}
export function cleanPoint(lat, lon) {
  const y = Number(lat), x = Number(lon);
  if (lat === null || lat === undefined || lon === null || lon === undefined || lat === '' || lon === '' || !Number.isFinite(y) || !Number.isFinite(x) || Math.abs(y) > 90 || Math.abs(x) > 180) {
    throw Object.assign(new Error('A valid map point (lat, lon) is required.'), { status: 400 });
  }
  return { lat: y, lon: x };
}
export function cleanParcelId(value) {
  const id = String(value ?? '').trim();
  if (!id || id.length > 64 || !/^[A-Za-z0-9 ._-]+$/.test(id)) throw Object.assign(new Error('A parcel number is required.'), { status: 400 });
  return id;
}

// ---- Address text helpers

// "510 Fairmont Road, Kalispell, MT" -> { number: '510', words: ['FAIRMONT'] }: the street part
// (before the first comma), upper case, without directionals and street types.
export function streetParts(text) {
  const street = String(text ?? '').split(',')[0].toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = street ? street.split(' ') : [];
  const number = tokens.length && /^\d+[A-Z]?$/.test(tokens[0]) ? tokens.shift() : '';
  const words = tokens.filter(t => !DIRECTION_SET.has(t) && !STREET_TYPE_SET.has(t) && t.length >= 2);
  return { number, words };
}

// The LIKE clause for a situs field, or null when the text is too thin to search
// (a house number alone, or one short word). Tokens are [A-Z0-9] only, so nothing needs escaping.
export function situsWhere(field, text) {
  const { number, words } = streetParts(text);
  if (!words.length) return null;
  if (number) return `UPPER(${field}) LIKE '${number} %${words.join('%')}%'`;
  if (!words.some(w => w.length >= 4)) return null;
  return `UPPER(${field}) LIKE '%${words.join(' ')}%'`;
}

// "3572 South Moose Canyon Road" and "3572 S MOOSE CANYON RD" -> the same string.
export function normalizeStreet(text) {
  return String(text ?? '').split(',')[0].toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map(t => DIRECTIONS[t] || STREET_TYPES[t] || t).join(' ');
}

// ---- Locator steps

const LOCATOR_OPTS = { timeoutMs: 6000, retries: 0 };
const FIND_OPTS = { timeoutMs: 8000, retryTimeoutMs: 6000 };
const PARCEL_OPTS = { timeoutMs: 8000, retryTimeoutMs: 6000 };

export async function locatorSuggest(source, text) {
  const data = await arcgisJson(`${source.locator}/suggest`, { text, maxSuggestions: SUGGEST_MAX, ...(source.suggestParams || {}) }, { ...LOCATOR_OPTS, label: `${source.key}-suggest`, agency: `${source.agency} address locator` });
  const seen = new Set();
  return (Array.isArray(data?.suggestions) ? data.suggestions : [])
    .map(s => ({ text: String(s?.text ?? '').trim(), magicKey: String(s?.magicKey ?? '') }))
    .filter(s => s.text && !seen.has(s.text.toUpperCase()) && seen.add(s.text.toUpperCase()))
    .slice(0, SUGGEST_MAX);
}

// Point candidates first, then interpolated ones, each by score; nothing under MIN_SCORE and no
// street-name or place candidates (they are not one property).
export function bestCandidate(candidates) {
  const usable = (Array.isArray(candidates) ? candidates : [])
    .map(c => ({ address: String(c?.address ?? '').trim(), score: Number(c?.score), type: String(c?.attributes?.Addr_type ?? ''), lon: Number(c?.location?.x), lat: Number(c?.location?.y) }))
    .filter(c => Number.isFinite(c.lon) && Number.isFinite(c.lat) && Number.isFinite(c.score) && c.score >= MIN_SCORE && (POINT_TYPES.has(c.type) || INTERPOLATED_TYPES.has(c.type)));
  usable.sort((a, b) => (POINT_TYPES.has(b.type) - POINT_TYPES.has(a.type)) || (b.score - a.score));
  const best = usable[0];
  return best ? { address: best.address, score: best.score, type: best.type, interpolated: !POINT_TYPES.has(best.type), point: { lat: best.lat, lon: best.lon } } : null;
}

export async function locatorFind(source, { text, magicKey }) {
  const params = { SingleLine: text, outSR: 4326, outFields: 'Addr_type,Loc_name', maxLocations: 5, ...(magicKey ? { magicKey } : {}) };
  const data = await arcgisJson(`${source.locator}/findAddressCandidates`, params, { ...FIND_OPTS, label: `${source.key}-find`, agency: `${source.agency} address locator` });
  return bestCandidate(data?.candidates);
}

// ---- Parcel layer steps

function mapRows(source, features) {
  const seen = new Set(), out = [];
  for (const f of Array.isArray(features) ? features : []) {
    const p = source.mapParcel(f?.attributes || {});
    if (!p || !p.parcelId || seen.has(p.parcelId)) continue;
    seen.add(p.parcelId);
    out.push({ parcelId: p.parcelId, address: p.address || '', city: p.city || '', county: p.county || source.county, state: source.state });
  }
  return out;
}

async function parcelQuery(source, params, label) {
  const data = await arcgisJson(`${source.parcelLayer}/query`, { returnGeometry: 'false', outFields: source.parcelFields, ...params }, { ...PARCEL_OPTS, label: `${source.key}-${label}`, agency: `${source.agency} parcel layer` });
  return mapRows(source, data?.features);
}

// Parcels under the point; when none (a road, a right-of-way polygon), the ones within NEAR_METERS
// (marked near: true, so the user confirms).
export async function parcelsAt(source, point) {
  const base = { geometry: `${point.lon},${point.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', where: '1=1' };
  const under = await parcelQuery(source, base, 'point');
  if (under.length) return { parcels: under.slice(0, PARCEL_CHOICES_MAX), near: false };
  const near = await parcelQuery(source, { ...base, distance: String(NEAR_METERS), units: 'esriSRUnit_Meter', resultRecordCount: String(PARCEL_CHOICES_MAX) }, 'near');
  return { parcels: near.slice(0, PARCEL_CHOICES_MAX), near: near.length > 0 };
}

const scoped = (source, where) => (source.scopeWhere ? `(${source.scopeWhere}) AND ${where}` : where);

// Situs LIKE: rows whose street matches the typed one exactly come first.
export async function parcelsBySitus(source, text, count = PARCEL_CHOICES_MAX) {
  const like = situsWhere(source.situsField, text);
  if (!like) return [];
  const rows = await parcelQuery(source, { where: scoped(source, like), resultRecordCount: String(Math.max(count * 3, 20)) }, 'situs');
  const typed = normalizeStreet(text);
  const { number } = streetParts(text);
  const rank = r => (normalizeStreet(r.address) === typed ? 0 : number && normalizeStreet(r.address).startsWith(`${number} `) ? 1 : 2);
  return rows.filter(r => r.address).sort((a, b) => rank(a) - rank(b) || a.address.localeCompare(b.address)).slice(0, count);
}

export async function parcelsById(source, parcelId) {
  const where = source.idWhere(parcelId);
  if (!where) return [];
  return parcelQuery(source, { where: scoped(source, where), resultRecordCount: '5' }, 'id');
}

// ---- The actions

export async function suggestAddresses(source, text) {
  if (source.locator) return { suggestions: await locatorSuggest(source, text), method: 'locator' };
  const rows = await parcelsBySitus(source, text, SUGGEST_MAX);
  return { suggestions: rows.map(r => ({ text: [r.address, r.city].filter(Boolean).join(', '), parcelId: r.parcelId })), method: 'situs' };
}

// { method, point, matchedAddress, interpolated, exact, parcels }. method: 'address-point'
// (locator point inside the parcel), 'address-near' (locator point outside every parcel; nearby
// ones listed), 'situs' (parcel situs field), or 'none'.
export async function resolveAddress(source, { text, magicKey }) {
  let candidate = null;
  if (source.locator) {
    try { candidate = await locatorFind(source, { text, magicKey }); }
    catch (error) { if (!source.situsField) throw error; console.warn(`${source.agency} locator failed; trying the parcel situs field`, error?.message || error); }
  }
  if (candidate) {
    const { parcels, near } = await parcelsAt(source, candidate.point);
    if (parcels.length && !near) return { method: 'address-point', point: candidate.point, matchedAddress: candidate.address, interpolated: candidate.interpolated, exact: !candidate.interpolated && parcels.length === 1, parcels };
    if (parcels.length) return { method: 'address-near', point: candidate.point, matchedAddress: candidate.address, interpolated: candidate.interpolated, exact: false, parcels };
  }
  const situs = source.situsField ? await parcelsBySitus(source, text) : [];
  if (situs.length) {
    // One parcel whose situs is the typed street is a match; anything else is a choice.
    const typed = normalizeStreet(text);
    const same = situs.filter(r => normalizeStreet(r.address) === typed);
    const exact = same.length === 1;
    return { method: 'situs', point: candidate?.point || null, matchedAddress: candidate?.address || '', interpolated: false, exact, parcels: exact ? same : situs };
  }
  return { method: 'none', point: candidate?.point || null, matchedAddress: candidate?.address || '', interpolated: Boolean(candidate?.interpolated), exact: false, parcels: [] };
}
