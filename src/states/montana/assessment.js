// Montana assessor record for /api/property-assessment, mapped from one Montana Cadastral
// (DNRC Cadastral FeatureServer/0, the Department of Revenue ORION data) record.
//
// The answer's statewideRecords stay the raw cadastral attributes (unchanged for older readers);
// cadastralRecords holds this mapped record, the same field names as the Kootenai, Stevens and
// Spokane countyRecords where they overlap (totalValue, landValue, improvementValue, taxYear,
// assessorAcres, propertyClass, propertyClassDescription, propertySearchUrl), plus the Montana
// extras: the assessed land-use acreage, levy district and short legal description.
//
// Named fields only are copied, so owner names and mailing addresses (OwnerName, OwnerAddress*,
// OwnerCity/State/ZipCode, CareOfTaxpayer) can never reach the record, even if the layer sends
// them. Results are screening info: the Department of Revenue record is the authority.

export const MONTANA_ASSESSMENT_SOURCE = 'Montana Cadastral (Department of Revenue ORION)';

function num(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function str(value) { const s = String(value ?? '').replace(/\s+/g, ' ').trim(); return s || null; }

// PropType on the layer is the Department of Revenue property type. On 2026-11-19 the layer's
// distinct values were mostly plain labels ("Vacant Land", "Improved Property", "Exempt Property",
// "Non-Valued Property", ...) and a few "CODE - Label" values ("VAC_R - Vacant Land - Rural",
// "CA - Centrally Assessed", "IR - Industrial Rural"). The ORION property record shows the
// "CODE - Label" form. Bare codes are labelled only where the code's meaning is certain
// (VAC/IMP = vacant land / improved property, _R/_U = rural/urban); any other value is shown as
// the source wrote it, never guessed.
const PROPERTY_TYPE_CODES = {
  VAC_R: 'Vacant Land - Rural',
  VAC_U: 'Vacant Land - Urban',
  IMP_R: 'Improved Property - Rural',
  IMP_U: 'Improved Property - Urban'
};

// Plain-language notes for the common types (what the label means for a buyer). Keyed by the
// label without its rural/urban suffix, lower case.
const PROPERTY_TYPE_NOTES = {
  'vacant land': 'The assessor lists no taxable buildings.',
  'improved property': 'The assessor lists buildings or other improvements.',
  'improved - deed restricted': 'The assessor lists improvements under a deed restriction.',
  'exempt property': 'Exempt from property tax (e.g. public or nonprofit owner).',
  'partial exempt property': 'Partly exempt from property tax.',
  'non-valued property': 'The assessor carries no value for this record.',
  'non-valued with specials': 'No assessed value, but special assessments may be billed.',
  'centrally assessed': 'Utility, railroad or similar property valued as part of a statewide system.',
  'on leased land': 'Improvements on land owned by someone else.'
};

// "VAC_R - Vacant Land - Rural" -> { code: 'VAC_R', label: 'Vacant Land - Rural' };
// "Vacant Land" -> { code: '', label: 'Vacant Land' }; "IMP_U" -> the table label.
export function montanaPropertyType(value) {
  const raw = str(value);
  if (!raw) return { code: '', label: '', note: '' };
  const coded = /^([A-Z][A-Z0-9_]{0,9})\s+-\s+(.+)$/.exec(raw);
  let code = '', label = raw;
  if (coded) { code = coded[1]; label = coded[2].trim(); }
  else if (PROPERTY_TYPE_CODES[raw.toUpperCase()]) { code = raw.toUpperCase(); label = PROPERTY_TYPE_CODES[code]; }
  const base = label.toLowerCase().replace(/\s+-\s+(rural|urban)$/, '').trim();
  return { code, label, note: PROPERTY_TYPE_NOTES[base] || '' };
}

// Assessed land use, in the order the Department of Revenue lists it. Farmsite is the homesite
// acre on agricultural land; non-qualified agricultural land is 20-160 acres that does not meet
// the agricultural income test (taxed at a higher rate than grazing land).
export const MONTANA_LAND_USE = [
  { key: 'ContinuousCropAcres', label: 'Continuous crop', ag: true },
  { key: 'FallowAcres', label: 'Summer fallow', ag: true },
  { key: 'IrrigatedAcres', label: 'Irrigated', ag: true },
  { key: 'WildHayAcres', label: 'Wild hay', ag: true },
  { key: 'GrazingAcres', label: 'Grazing', ag: true },
  { key: 'ForestAcres', label: 'Forest', ag: false, forest: true },
  { key: 'FarmsiteAcres', label: 'Farmsite (homesite)', ag: false },
  { key: 'NonQualAcres', label: 'Non-qualified agricultural', ag: false }
];

export const MONTANA_AG_NOTE = 'Part of this parcel is assessed by use as agricultural or forest land. Montana values that land on what it produces, usually well below market value. A change of use (for example building a home or splitting the parcel) can change the classification and the taxes. Screening info: verify with the Montana Department of Revenue.';

// [{ key, label, acres }] for every land-use class with acres > 0, plus whether any of it is
// agricultural or forest land (the classes valued on productivity).
export function montanaLandUse(attrs = {}) {
  const rows = [];
  for (const use of MONTANA_LAND_USE) {
    const acres = num(attrs[use.key]);
    if (acres != null && acres > 0) rows.push({ key: use.key, label: use.label, acres: Math.round(acres * 1000) / 1000 });
  }
  const productive = rows.some(row => MONTANA_LAND_USE.find(use => use.key === row.key && (use.ag || use.forest)));
  return { rows, agricultural: productive };
}

// The state cadastral property page: https, exactly svc.mt.gov/msl/cadastral/, only
// page=PropertyDetails and geocode, the geocode equal to the record's 17-digit PARCELID; rebuilt
// from the geocode. The browser checks it again (public/property-assessment.js cadastralUrl).
export function montanaPropertyCardUrl(value, parcelId) {
  const geocode = String(parcelId ?? '').replace(/[^0-9A-Za-z]/g, '');
  if (!/^\d{17}$/.test(geocode)) return null;
  let url;
  try { url = new URL(String(value ?? '')); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'svc.mt.gov' || url.port || url.username || url.password) return null;
  if (url.pathname !== '/msl/cadastral/' && url.pathname !== '/msl/cadastral') return null;
  if ([...url.searchParams.keys()].sort().join(',') !== 'geocode,page' || url.searchParams.get('page') !== 'PropertyDetails') return null;
  if (url.searchParams.get('geocode').replace(/[^0-9A-Za-z]/g, '') !== geocode) return null;
  return `https://svc.mt.gov/msl/cadastral/?page=PropertyDetails&geocode=${geocode}`;
}

export function mapMontanaAssessment(attrs = {}) {
  const a = attrs || {};
  const parcelNumber = str(a.PARCELID) || str(String(a.Geocode ?? '').replace(/[^0-9A-Za-z]/g, ''));
  const type = montanaPropertyType(a.PropType);
  const landUse = montanaLandUse(a);
  return {
    parcelNumber,
    geocode: str(a.Geocode),
    taxYear: num(a.TaxYear),
    totalValue: num(a.TotalValue),
    landValue: num(a.TotalLandValue),
    improvementValue: num(a.TotalBuildingValue),
    assessorAcres: num(a.TotalAcres),
    propertyClass: type.code || null,
    propertyClassDescription: type.label || null,
    propertyTypeNote: type.note || null,
    landUse: landUse.rows,
    agricultural: landUse.agricultural,
    agriculturalNote: landUse.agricultural ? MONTANA_AG_NOTE : null,
    levyDistrict: str(a.LevyDistrict),
    legalDescription: str(a.LegalDescriptionShort),
    subdivision: str(a.Subdivision),
    certificateOfSurvey: str(a.CertificateOfSurvey),
    propertySearchUrl: montanaPropertyCardUrl(a.PropertyCardLink, parcelNumber)
  };
}
