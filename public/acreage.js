// Assessor vs mapped acreage, shared by the overview (parcel-preview.js) and the printable report
// (property-report-v2.js). Both call window.AcresXAcreage at render time and keep their older
// behaviour if this file has not loaded.
//
// Assessor acreage is the acreage on the county record, from /api/parcel-search properties:
// ACRES (Idaho statewide ASR_ACRES; Kootenai county layer Acres) or Montana cadastral TotalAcres.
// Mapped acreage is computed from the parcel outline with turf.area. The two can differ a lot
// (Kootenai 47N03W052200: 2.89 assessor, 1.98 mapped), so both are shown when both exist.
(function (root) {
  const SQ_M_PER_ACRE = 4046.8564224;
  const SQ_FT_PER_SQ_M = 10.7639104167;
  const DIFF_RATIO = 0.10; // flag differences larger than 10% of the assessor acreage
  const NOTE = 'Assessor and mapped acreage differ; verify with the county.';
  const ASSESSOR_FIELDS = ['ACRES', 'ACREAGE', 'TotalAcres', 'Acres', 'acres'];

  function positive(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function assessorAcres(properties) {
    for (const key of ASSESSOR_FIELDS) { const n = positive(properties?.[key]); if (n != null) return n; }
    return null;
  }
  function mappedSquareMeters(parcel) {
    try {
      if (!parcel?.geometry || typeof turf === 'undefined' || typeof turf.area !== 'function') return null;
      return positive(turf.area(parcel));
    } catch { return null; }
  }
  const format = acres => acres >= 100 ? acres.toFixed(1) : acres.toFixed(2);

  // Everything a display needs. `official` is the figure to reason with (assessor when present).
  function describe(parcel) {
    const assessor = assessorAcres(parcel?.properties);
    const sqm = mappedSquareMeters(parcel);
    const mapped = sqm != null ? sqm / SQ_M_PER_ACRE : null;
    const differs = assessor != null && mapped != null && Math.abs(assessor - mapped) / assessor > DIFF_RATIO;
    const official = assessor ?? mapped;
    const officialSource = assessor != null ? 'assessor' : mapped != null ? 'mapped' : null;
    let text = '';
    if (assessor != null && mapped != null) text = `${format(assessor)} ac (assessor) · ${format(mapped)} ac mapped`;
    else if (assessor != null) text = `${format(assessor)} ac (assessor)`;
    else if (mapped != null) text = `${format(mapped)} ac mapped`;
    return {
      assessor, mapped, mappedSquareFeet: sqm != null ? sqm * SQ_FT_PER_SQ_M : null,
      official, officialSource, officialText: official != null ? `${format(official)} acres (${officialSource})` : '',
      text, differs, note: differs ? NOTE : ''
    };
  }

  root.AcresXAcreage = { describe, assessorAcres, format, NOTE, DIFF_RATIO };
})(typeof window !== 'undefined' ? window : globalThis);
