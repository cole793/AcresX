// Kootenai County (ID) plat status for /api/recorded-restrictions, inferred from data AcresX
// already has. No request goes to a Kootenai server here: map.kcgov.us blocks Cloudflare, and the
// recorder site's robots.txt disallows automated access.
//
// Inputs: the parcel number (PIN) and, when the browser has it, the parcel's `Legal` from the
// zoning answer it already loaded (/api/zoning-permits source.parcelAttributes.Legal, read from
// the county's Ownership_Display layer). Rules, checked against live rows on 2026-11-18:
//   - Township/range PINs (50N04W323200, 47N03W052200) are section tax lots described by metes
//     and bounds or aliquot parts ("W400 FT-N2-NW EX TX#S & EX RW"): not in a recorded plat.
//   - Platted parcels have non-township PINs (081900010030, 0L8210010030, C72150030040) and a
//     Legal that starts with the plat name: "HUMBIRD ACRES, LT 3 BLK 1  1052N04W",
//     "PARK PLACE, LT 4 BLK 3", "ABBOTT DELLS SUB, LT 1 BLK 1 0752N03W".
//   - Other PINs (P00000032775, personal property / tax-number legals) are left unknown.
export const KOOTENAI_RECORDER = { label: 'Kootenai County Recorder document search', url: 'https://recorder.kcgov.us/RealEstate/SearchEntry.aspx' };
export const KOOTENAI_SOURCE = 'Kootenai County GIS parcel record (PIN and legal description)';
const TRS_PIN = /^\d{2}N\d{2}W\d{6}$/;

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

export function parseKootenaiLegal(legal) {
  const s = clean(legal);
  // "<PLAT NAME>, LT 3 BLK 1 ..." (also LTS, TR, TRACT, UNIT)
  const m = s.match(/^([^,]{3,80}),\s*(?:LTS?|LOTS?|TRS?|TRACTS?|UNIT|BLK)\b/i);
  if (!m || /\bTAX\s*#|\bTX\s*#/i.test(m[1])) return null;
  return {
    name: m[1].trim(),
    lot: s.match(/\bLTS?\s+([A-Z0-9-]+(?:\s*&\s*[A-Z0-9-]+)*)/i)?.[1] || null,
    block: s.match(/\bBLK\s+([A-Z0-9-]+)/i)?.[1] || null,
    tract: s.match(/\b(?:TRS?|TRACTS?)\s+([A-Z0-9-]+)/i)?.[1] || null
  };
}

export function kootenaiPlat(parcelId, legal) {
  const pin = clean(parcelId).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const legalText = clean(legal).slice(0, 250) || null;
  const source = { name: KOOTENAI_SOURCE, url: 'https://www.kcgov.us/' };
  if (TRS_PIN.test(pin)) return { status: 'unplatted', kind: 'metes_and_bounds', legalDescription: legalText, source, matchedBy: 'parcel_id' };
  const parsed = legalText ? parseKootenaiLegal(legalText) : null;
  if (parsed) return { status: 'platted', kind: /\bSHORT\s+PLAT\b/i.test(parsed.name) ? 'short_plat' : 'subdivision', ...parsed, legalDescription: legalText, source, matchedBy: 'legal_description' };
  if (/^0[0-9A-Z]{11}$/.test(pin) && !legalText) {
    // Platted-style PIN without a legal description: platted, name unknown.
    return { status: 'platted', kind: 'subdivision', name: null, legalDescription: null, source, matchedBy: 'parcel_id' };
  }
  return null;
}

export async function getKootenaiRestrictions({ parcelId, legal }) {
  const plat = kootenaiPlat(parcelId, legal);
  return { plat, sources: [{ key: 'kootenai-parcel', name: KOOTENAI_SOURCE, url: 'https://www.kcgov.us/', status: plat ? 'ok' : 'skipped' }], recorder: KOOTENAI_RECORDER };
}
