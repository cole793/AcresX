// The inclusion rule (docs/explore-index.md section 1), county-agnostic. The county module
// supplies the code exclusion and the overlays; this file decides.
//
//   rural_acreage       outside city limits, acres >= min, vacant (or improvement unknown)
//   rural_improved      outside city limits, acres >= min, improved
//   rural_vacant_small  outside city limits, vacant, acres < min
//   city_acreage        inside city limits, acres >= min
// Excluded (counted per reason, not stored): no_id, condo, commercial_industrial, right_of_way,
// public_land, no_geometry, city_small, and the small parcels no reason includes:
// small_improved, small_unknown_improvement (improvement value unknown: "included only by the
// acreage test"), city_unknown_small (city-limits layer failed: acreage test only).
import { INCLUDE_MIN_ACRES } from './config.mjs';

export const INCLUSION_REASONS = Object.freeze(['rural_acreage', 'rural_improved', 'rural_vacant_small', 'city_acreage']);

// Before any outline is fetched: id and land use code. { excluded: reason } or null (go on).
export function preExclusion({ id, codeReason }) {
  if (!String(id ?? '').trim()) return { excluded: 'no_id' };
  if (codeReason) return { excluded: codeReason };
  return null;
}

// Whether a parcel can be included at all without its outline: small parcels that are improved
// (or of unknown improvement) are out whatever the city test says, so their outlines are never
// fetched. acres: the assessor acres when known (null: the outline decides).
export function needsOutline({ acres, improved }, minAcres = INCLUDE_MIN_ACRES) {
  if (acres == null || !(acres > 0)) return true;
  if (acres >= minAcres) return true;
  return improved === 0;
}
export function smallWithoutOutline({ improved }) {
  return improved === 1 ? 'small_improved' : 'small_unknown_improvement';
}

// The full decision. publicLand: { coversMost, touches } or null when not checked; publicHint:
// the parcel's code suggests public ownership (used only with a PAD-US touch).
// inCity: 1 | 0 | null (city-limits layer failed). improved: 1 | 0 | null.
// Returns { included: true, reason } or { included: false, reason }.
export function decide({ id, codeReason, hasGeometry, acres, inCity, improved, publicLand, publicHint = false }, minAcres = INCLUDE_MIN_ACRES) {
  const pre = preExclusion({ id, codeReason });
  if (pre) return { included: false, reason: pre.excluded };
  if (!hasGeometry) return { included: false, reason: 'no_geometry' };
  if (publicLand?.coversMost || (publicHint && publicLand?.touches)) return { included: false, reason: 'public_land' };
  const big = Number.isFinite(acres) && acres >= minAcres;
  if (inCity === 1) return big ? { included: true, reason: 'city_acreage' } : { included: false, reason: 'city_small' };
  if (inCity == null && !big) return { included: false, reason: 'city_unknown_small' };
  if (big) return { included: true, reason: improved === 1 ? 'rural_improved' : 'rural_acreage' };
  if (improved === 0) return { included: true, reason: 'rural_vacant_small' };
  return { included: false, reason: improved === 1 ? 'small_improved' : 'small_unknown_improvement' };
}
