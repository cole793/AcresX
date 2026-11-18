// POST /api/recorded-restrictions { state, county, parcelId, geometry?, lat?, lon?, legal? }
//   -> what free official data says about recorded restrictions on the parcel.
//
// New, additive route (owner-approved 2026-11-18). No free source extracts easement, covenant
// (CC&R) or HOA content for these counties; they exist only as recorded document images. So the
// answer says what CAN be read from official GIS, and points to the documents:
//   plat         recorded subdivision plat, short plat, certificate of survey (COS), or "not in a
//                recorded plat" (metes and bounds / deed), with its name, record or recording
//                number, block, lot, tract, dates and plat image or property record links.
//                Matched by parcel ID where the layer has one, else by ONE interior point of the
//                parcel (never the whole outline: neighbours' plats touch the boundary).
//                Spokane     Plats + Lots layers (interior point)            src/counties/spokane-restrictions.js
//                Stevens     parcel legal_desc (ID) + Subdivisions (point)   src/counties/stevens-restrictions.js
//                Kootenai    PIN pattern + the Legal the browser already has (no Kootenai request)
//                Gallatin    Parcel_Platview by GEOCODE, else Montana Cadastral
//                Yellowstone Montana Cadastral (ID) + Tax_and_Legal_Parcels/1 (point)
//                other MT    Montana Cadastral by parcel ID                  src/states/montana/restrictions.js
//   agreements   Spokane recorded development agreements overlapping the parcel.
//   conservationEasements  PAD-US 4.1 (all states) + Montana State Library (MT) + Stevens County
//                layer 21, by overlap with the parcel outline, with the share of the parcel covered.
//   recorder     the county's free recorder/auditor search; title: the preliminary title report line.
//   notes        plain-language lines; never a claim that no restrictions exist.
//   sources      each source with status ok | unavailable | skipped.
// The browser adds the flags it already has (private road, transmission line crossing, wetland
// buffers) and the MLS association fields (unverified); none of this feeds the score.
//
// Answer (HTTP 200 for every lookup; 400 only for a missing or oversized request):
//   { available, state, county, parcelId, status: 'found' | 'partial' | 'unavailable' | 'not_supported',
//     matchedOn: 'parcel_outline' | 'point' | 'parcel_id', plat, agreements, conservationEasements,
//     recorder, title, notes, sources, asOf }
// Each source degrades on its own. Owner fields are never requested from any layer, the answer is
// rebuilt from named fields here, and withoutPersonalFields() is the last guard. Complete answers
// (every source answered, plat known) are cached 30 days per parcel; nothing else is.
import { json } from '../shared/http.js';
import { cachedJson } from '../shared/upstream.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { parcelRings, interiorPoint, httpsOn, text, isoDate } from '../shared/restrictions.js';
import { getSpokaneRestrictions } from '../counties/spokane-restrictions.js';
import { getStevensRestrictions } from '../counties/stevens-restrictions.js';
import { getKootenaiRestrictions } from '../counties/kootenai-restrictions.js';
import { getGallatinRestrictions } from '../counties/gallatin-restrictions.js';
import { getYellowstoneRestrictions } from '../counties/yellowstone-restrictions.js';
import { findCadastralPlat, findMontanaEasements, MT_EASEMENTS_SOURCE } from '../states/montana/restrictions.js';
import { findPadusEasements, PADUS_SOURCE, PADUS_EASEMENTS } from './padus-easements.js';

// Bump the version whenever the answer shape or an adapter's mapping changes.
export const RESTRICTIONS_CACHE_PREFIX = 'https://acresx.internal/cache/recorded-restrictions/v2/';
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MAX_BODY_BYTES = 300_000;

export const TITLE_LINE = 'Order a preliminary title report — it lists recorded easements, covenants (CC&Rs) and HOA.';
export const PLATTED_NOTE = 'Platted subdivision: likely has recorded covenants (CC&Rs) and plat easements; review the plat and covenants.';
export const NOT_CHECKED_NOTE = 'AcresX does not read recorded easement, covenant (CC&R) or HOA documents, so this section cannot show that none exist.';

const DISPLAY = { spokane: 'Spokane', stevens: 'Stevens', kootenai: 'Kootenai', yellowstone: 'Yellowstone', gallatin: 'Gallatin' };
const ADAPTERS = {
  'WA:spokane': getSpokaneRestrictions,
  'WA:stevens': getStevensRestrictions,
  'ID:kootenai': getKootenaiRestrictions,
  'MT:gallatin': getGallatinRestrictions,
  'MT:yellowstone': getYellowstoneRestrictions
};
// Any other Montana county: the statewide cadastral record.
async function getMontanaRestrictions({ parcelId, signal }) {
  try {
    const plat = await findCadastralPlat(parcelId, { signal });
    return { plat, sources: [{ key: 'mt-cadastral', name: 'Montana Cadastral', url: 'https://svc.mt.gov/msl/cadastral/', status: 'ok' }], recorder: null };
  } catch {
    return { plat: null, sources: [{ key: 'mt-cadastral', name: 'Montana Cadastral', url: 'https://svc.mt.gov/msl/cadastral/', status: 'unavailable' }], recorder: null };
  }
}

export const KIND_LABELS = Object.freeze({
  subdivision: 'Platted subdivision', major_subdivision: 'Major subdivision (platted)', minor_subdivision: 'Minor subdivision (platted)',
  short_plat: 'Short plat', binding_site_plan: 'Binding site plan', certificate_of_survey: 'Certificate of survey (COS)',
  mining_claim: 'Patented mining claim (not a plat)', deed: 'Described by deed (not platted)',
  metes_and_bounds: 'Not in a recorded plat (metes and bounds)', unknown: 'Plat status not determined'
});
const PLAT_STATUSES = new Set(['platted', 'surveyed', 'unplatted', 'unknown']);
const LINK_HOSTS = ['ftp.gallatin.mt.gov', 'svc.mt.gov'];
const RECORDER_HOSTS = ['recording.spokanecounty.org', 'selfservice.stevenscountywa.gov', 'recorder.kcgov.us', 'crdocs.yellowstonecountymt.gov', 'eagleweb.gallatin.mt.gov'];
const SOURCE_HOSTS = ['gismo.spokanecounty.org', 'gis.stevenscountywa.gov', 'www.kcgov.us', 'services3.arcgis.com', 'gis.yellowstonecountymt.gov',
  'svc.mt.gov', 'gis.dnrc.mt.gov', 'mslgis.mt.gov', 'services.arcgis.com'];

const link = (value, hosts) => {
  const url = httpsOn(value?.url, hosts), label = text(value?.label, 120);
  return url && label ? { label, url } : null;
};
const sourceRef = value => {
  const name = text(value?.name, 160);
  return name ? { name, url: httpsOn(value?.url, SOURCE_HOSTS) } : null;
};

// Adapter plat -> the public plat, named fields only.
export function publicPlat(plat) {
  if (!plat || typeof plat !== 'object') return null;
  const status = PLAT_STATUSES.has(plat.status) ? plat.status : 'unknown';
  const kind = KIND_LABELS[plat.kind] ? plat.kind : 'unknown';
  const out = { status, kind, label: KIND_LABELS[kind] };
  for (const [key, max] of [['name', 120], ['record', 40], ['recordingNumber', 50], ['platBook', 50], ['block', 20], ['lot', 40], ['tract', 40], ['amended', 120], ['legalDescription', 254]]) {
    const value = text(plat[key], max);
    if (value) out[key] = value;
  }
  for (const key of ['recordedDate', 'surveyDate']) { const d = isoDate(plat[key]); if (d) out[key] = d; }
  const images = (Array.isArray(plat.imageLinks) ? plat.imageLinks : []).map(l => link(l, LINK_HOSTS)).filter(Boolean).slice(0, 3);
  if (images.length) out.imageLinks = images;
  const card = link(plat.propertyCard, LINK_HOSTS);
  if (card) out.propertyCard = card;
  out.source = sourceRef(plat.source);
  out.matchedBy = ['parcel_id', 'interior_point', 'legal_description'].includes(plat.matchedBy) ? plat.matchedBy : null;
  return out;
}

function publicAgreement(a) {
  const out = { kind: 'development_agreement', label: 'Development agreement' };
  for (const [key, max] of [['fileNumber', 50], ['recordingNumber', 50], ['zoneClass', 40], ['source', 160]]) { const v = text(a?.[key], max); if (v) out[key] = v; }
  const d = isoDate(a?.recordingDate); if (d) out.recordingDate = d;
  if (Number.isFinite(a?.sharePct)) out.sharePct = a.sharePct;
  return out;
}

function publicEasement(e) {
  const out = { name: text(e?.name, 120) || 'Conservation easement' };
  for (const [key, max] of [['holder', 120], ['holderType', 60], ['deedRef', 40], ['source', 160]]) { const v = text(e?.[key], max); if (v) out[key] = v; }
  const d = isoDate(e?.date); if (d) out.date = d;
  out.sharePct = Number.isFinite(e?.sharePct) ? e.sharePct : null;
  return out;
}

// Plain-language lines for the card and report. Never says there are no restrictions.
export function restrictionNotes({ plat, agreements, easements }) {
  const notes = [];
  if (plat?.status === 'platted') notes.push(PLATTED_NOTE);
  else if (plat?.status === 'surveyed') notes.push('Certificate of survey: recorded surveys often show access and utility easements; review the survey.');
  else if (plat?.kind === 'mining_claim') notes.push('Patented mining claim, not a subdivision plat: reservations and access rights, if any, are in the patent and deeds; check a title report.');
  else if (plat?.status === 'unplatted') notes.push('Not in a recorded plat: access and utility easements, if any, are in deeds; check a title report.');
  if (agreements?.length) notes.push('A recorded development agreement maps over this parcel: its conditions run with the land; read the recorded agreement.');
  if (easements?.items?.length) notes.push('A conservation easement is mapped over this parcel: it can limit building and dividing the land; read the recorded easement deed.');
  else if (easements?.status === 'none') notes.push('No conservation easement is mapped here (PAD-US withholds about 5% of easements, and mapped data is not for legal use).');
  notes.push(NOT_CHECKED_NOTE);
  return notes;
}

const countyKeyOf = county => String(county || '').replace(/\s+County$/i, '').trim().toLowerCase();
const finiteCoord = (v, lim) => { const n = Number(v); return Number.isFinite(n) && Math.abs(n) <= lim ? n : null; };

export async function getRecordedRestrictions(body = {}, { ctx, now = new Date() } = {}) {
  const st = String(body.state || '').toUpperCase().trim();
  const key = countyKeyOf(body.county);
  const parcelId = String(body.parcelId || '').trim();
  const county = DISPLAY[key] || String(body.county || '').replace(/\s+County$/i, '').trim();
  const rings = parcelRings(body.geometry);
  const lat = finiteCoord(body.lat, 90), lon = finiteCoord(body.lon, 180);
  const point = interiorPoint(rings) || (lat !== null && lon !== null ? { lat, lon } : null);
  const adapter = ADAPTERS[`${st}:${key}`] || (st === 'MT' ? getMontanaRestrictions : null);
  const legal = text(body.legal, 250);
  const ids = { state: st, county, parcelId };
  const produce = () => buildAnswer({ ...ids, adapter, rings, point, legal, now });
  if (!adapter && !point) return { available: false, ...ids, status: 'not_supported', plat: null, agreements: null, conservationEasements: null, recorder: null, title: TITLE_LINE, notes: [NOT_CHECKED_NOTE], sources: [], asOf: now.toISOString().slice(0, 10) };
  const cacheKey = `${st}:${key}:${parcelId.toUpperCase()}${key === 'kootenai' && legal ? ':legal' : ''}`;
  return cachedJson(RESTRICTIONS_CACHE_PREFIX, cacheKey, CACHE_TTL_SECONDS, produce, {
    ctx,
    isValid: a => a?.status === 'found' && a.matchedOn === 'parcel_outline' && a.plat && a.plat.status !== 'unknown' && (a.plat.status !== 'platted' || Boolean(a.plat.name))
  });
}

async function buildAnswer({ state, county, parcelId, adapter, rings, point, legal, now }) {
  const where = { rings, point };
  const tasks = [
    adapter ? adapter({ parcelId, point, rings, legal }).catch(() => ({ plat: null, sources: [{ key: 'county', name: `${county} County records`, url: null, status: 'unavailable' }] })) : Promise.resolve(null),
    point || rings ? findPadusEasements(where).then(items => ({ items }), () => ({ error: true })) : Promise.resolve({ skipped: true }),
    state === 'MT' && (point || rings) ? findMontanaEasements(where).then(items => ({ items }), () => ({ error: true })) : Promise.resolve({ skipped: true })
  ];
  const [county_, padus, mt] = await Promise.all(tasks);
  const sources = [...(county_?.sources || [])];
  sources.push({ key: 'padus', name: PADUS_SOURCE, url: PADUS_EASEMENTS, status: padus.skipped ? 'skipped' : padus.error ? 'unavailable' : 'ok' });
  if (state === 'MT') sources.push({ key: 'mt-easements', name: MT_EASEMENTS_SOURCE, url: 'https://mslgis.mt.gov/arcgishosting/rest/services/GEOINFO/DigitalAtlas_Admin/MapServer/1', status: mt.skipped ? 'skipped' : mt.error ? 'unavailable' : 'ok' });

  const easementSets = [padus, mt, county_?.countyEasements === undefined ? { skipped: true } : county_.countyEasements === null ? { error: true } : { items: county_.countyEasements }];
  const items = easementSets.flatMap(s => s.items || []).map(publicEasement);
  const asked = easementSets.filter(s => !s.skipped);
  const conservationEasements = {
    status: items.length ? 'found' : asked.length && asked.every(s => !s.error) ? 'none' : asked.some(s => !s.error) ? 'none_partial' : 'unavailable',
    items
  };
  const plat = publicPlat(county_?.plat) || (adapter ? { status: 'unknown', kind: 'unknown', label: KIND_LABELS.unknown, source: null, matchedBy: null } : null);
  const agreements = Array.isArray(county_?.agreements) ? county_.agreements.map(publicAgreement) : null;
  const recorder = link(county_?.recorder, RECORDER_HOSTS);
  const used = sources.filter(s => s.status !== 'skipped');
  const ok = used.filter(s => s.status === 'ok').length;
  const status = !adapter ? (ok ? 'not_supported' : 'unavailable') : !ok ? 'unavailable' : ok === used.length ? 'found' : 'partial';
  const answer = {
    available: ok > 0,
    state, county, parcelId, status,
    matchedOn: rings ? 'parcel_outline' : point ? 'point' : 'parcel_id',
    plat, agreements, conservationEasements, recorder, title: TITLE_LINE,
    notes: restrictionNotes({ plat, agreements, easements: conservationEasements }),
    sources: sources.map(s => ({ key: text(s.key, 60), name: text(s.name, 160), url: httpsOn(s.url, SOURCE_HOSTS), status: ['ok', 'unavailable', 'skipped'].includes(s.status) ? s.status : 'unavailable' })),
    asOf: now.toISOString().slice(0, 10)
  };
  if (status !== 'found') console.warn('Recorded restrictions partial', state, county, sources.filter(s => s.status === 'unavailable').map(s => s.key).join(','));
  return withoutPersonalFields(answer);
}

export async function handleRecordedRestrictions(request, env, ctx) {
  let raw = '';
  try { raw = await request.text(); } catch { return json({ error: 'JSON body required' }, 400, 'no-store'); }
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Request is too large' }, 400, 'no-store');
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { return json({ error: 'JSON body required' }, 400, 'no-store'); }
  const parcelId = String(body?.parcelId || '').trim();
  if (!parcelId) return json({ error: 'parcelId is required' }, 400, 'no-store');
  if (parcelId.length > 40) return json({ error: 'parcelId is too long' }, 400, 'no-store');
  const answer = await getRecordedRestrictions({ ...body, parcelId }, { ctx });
  return json(withoutPersonalFields(answer), 200, 'no-store');
}
