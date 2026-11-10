// Ranks the electric utilities HIFLD lists at a point, so the site can name the most likely one
// first instead of "KOOTENAI ELECTRIC COOPERATIVE / AVISTA CORP".
//
// Why ranking is needed. The HIFLD retail territory polygons overlap, and the state layers say
// overlaps are expected:
//   - WA UTC, "UTC Regulated Electric Service Areas" (ArcGIS item 9977fdf9961a445cb0cdae7585484b3d,
//     layer https://services2.arcgis.com/lXwA5ckdH5etcXUm/arcgis/rest/services/UTC_Regulated_Electric_Service_Areas/FeatureServer/2):
//     "It should be noted that Electric Service Area boundaries are unspecific, and multiple
//     utilities may be available to service the same location." Its one Avista polygon covers
//     every Spokane and Stevens validation parcel, so it cannot separate Avista from a co-op.
//   - Montana, "Montana Rural Electric Cooperative Service Areas" (item ba0648df3ce94af78865f10d0c583451):
//     agrees with HIFLD at all 24 Gallatin/Yellowstone validation parcels (Yellowstone Valley
//     Electric covers Billings), so it does not separate NorthWestern from the co-ops either.
//
// Rules, in order. Nothing else reorders the list.
//
// 1. Wholesale is not retail. Federal power marketing administrations (HIFLD TYPE "FEDERAL":
//    Bonneville, Western Area Power Administration) sell wholesale and run transmission; HIFLD's
//    own layer description says the layer is "areas serviced by electric power utilities
//    responsible for the retail sale of electric power to local customers". They are listed last
//    in `providers` (the browser already drops them, public/index.html WHOLESALE_POWER) and never
//    become primary.
//
// 2. Avista's own published distribution lines (src/utilities/avista-distribution.js). Idaho law
//    decides a new service by existing lines within a quarter mile. Idaho Code 61-332C(1),
//    https://legislature.idaho.gov/statutesrules/idstat/title61/t61ch3/sect61-332C/ :
//      "(b) If only one (1) electric supplier has an existing service line within one thousand
//      three hundred twenty (1,320) feet of the new service entrance that electric supplier shall
//      have the right to serve the consumer at the new service entrance.
//       (c) If more than one (1) electric supplier has an existing service line within one
//      thousand three hundred twenty (1,320) feet of the new service entrance the electric
//      supplier whose existing service line is nearest the new service entrance shall have the
//      right to serve the consumer at the new service entrance."
//    Avista and Kootenai Electric apply it to each other (Avista-KEC letter agreement,
//    2024-01-03, Idaho PUC case AVU-E-24-01, Exhibit A, https://puc.idaho.gov/Fileroom/PublicFiles/ELEC/AVU/AVUE2401/CaseFiles/20240108Exhibit%20A.pdf :
//    "Both Avista and KEC have existing facilities in the area of the Development and, at least at
//    this time, it cannot be determined by proof whether Avista's or KEC's service line is nearest
//    the new service entrances. See Idaho Code § 61-332C(d).").
//    So: an Avista-published line within 1,320 ft of the parcel point puts Avista first (and adds
//    Avista when HIFLD missed it: HIFLD shows only Modern Electric at a South Hill Spokane lot
//    with 8 Avista sections within 400 ft, 2026-11-10). No Avista line within 1,320 ft while another retail
//    utility is listed puts the other utility first. Washington has no such statute; there the
//    same 1,320 ft distance is used as a screening distance only, and the note says so.
//    We only see Avista's lines, never the co-op's, so this ranks; it never resolves an overlap:
//    `resolved` stays false and the note says to confirm with both.
//
// 3. Otherwise (no Avista evidence, e.g. NorthWestern Energy and Yellowstone Valley Electric in
//    Billings): no official source separates them. They keep the order HIFLD returned and the
//    note says the order is not a likelihood.
//
// Not used, on purpose:
//   - "The smaller polygon wins" (nesting). At Coeur d'Alene the Kootenai Electric polygon
//     (8.5e9 m2) is far smaller than Avista's (9.7e10 m2, HIFLD Shape__Area) yet Avista has lines
//     throughout the city, so area says nothing about who serves a point.
//   - City franchises. Avista's Idaho Schedule 58 lists the City of Coeur d'Alene (Ord. No. 2517)
//     and Post Falls, but franchises are nonexclusive and Kootenai Electric also serves inside
//     Post Falls (the letter agreement above), so a franchise alone does not rank.

export const QUARTER_MILE_FT = 1320;
const AVISTA = /\bavista\b/i;
const AVISTA_NAME = 'AVISTA CORP';

// "A", "A and B", "A, B and C".
function listText(names) {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function isWholesale(match) {
  return /^federal$/i.test(String(match?.type || '').trim()) || /\b(?:bonneville|western area|southwestern|southeastern) power administration\b|^(?:bpa|wapa)\b/i.test(String(match?.name || ''));
}

// matches: [{ name, type, state }] from HIFLD (any order, duplicates allowed).
// avista: nearestAvistaLine() result, or null when not looked up.
// state: 'WA' | 'ID' | 'MT' | '' (only changes the wording of the Avista note).
export function rankProviders(matches = [], { avista = null, state = '' } = {}) {
  const seen = new Set();
  const retail = [];
  const wholesale = [];
  for (const match of matches) {
    const name = String(match?.name || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    (isWholesale(match) ? wholesale : retail).push({ name, type: match.type || '' });
  }

  const idaho = String(state).toUpperCase() === 'ID';
  const law = idaho
    ? 'Idaho Code 61-332C gives a new service to the supplier with the nearest existing line within 1,320 ft'
    : 'Washington has no nearest-line statute; 1,320 ft (the Idaho Code 61-332C distance) is used as a screening distance';
  const avistaKnown = avista?.available === true;
  const avistaNear = avistaKnown && Number.isFinite(avista.nearestFt) && avista.nearestFt <= QUARTER_MILE_FT;
  const evidence = avistaKnown
    ? { source: avista.source, sourceUrl: avista.sourceUrl, nearestAvistaLineFt: Number.isFinite(avista.nearestFt) ? avista.nearestFt : null, searchedFt: avista.searchedFt }
    : null;

  let ordered = retail.slice();
  let basis = 'single_territory';
  let note = '';
  let added = false;
  const others = list => list.filter(item => !AVISTA.test(item.name));
  const avistaItem = retail.find(item => AVISTA.test(item.name));

  if (avistaNear && (retail.length > 1 || !avistaItem)) {
    if (!avistaItem) { ordered = [{ name: AVISTA_NAME, type: 'INVESTOR OWNED', addedFrom: 'avista_distribution' }, ...retail]; added = true; }
    else ordered = [avistaItem, ...others(retail)];
    basis = 'avista_line_nearby';
    const rest = ordered.slice(1).map(item => item.name);
    note = `Avista is most likely: Avista's published distribution map shows a line about ${avista.nearestFt.toLocaleString('en-US')} ft from the parcel point (${law}).`
      + (added ? ` The federal territory layer lists only ${listText(rest)} here.` : '')
      + ` ${listText(rest)} also ${rest.length === 1 ? 'has' : 'have'} mapped territory here — confirm with ${rest.length === 1 ? 'both' : 'each'}.`;
  } else if (avistaKnown && avistaItem && retail.length > 1) {
    ordered = [...others(retail), avistaItem];
    basis = 'avista_line_not_nearby';
    const first = ordered.slice(0, -1).map(item => item.name);
    note = `${listText(first)} ${first.length === 1 ? 'is' : 'are'} more likely: Avista's published distribution map shows no Avista line within 1,320 ft of the parcel point (${law}). Avista also has mapped territory here — confirm with ${first.length === 1 ? 'both' : 'each'}.`;
  } else if (retail.length > 1) {
    basis = 'unresolved_overlap';
    note = `${listText(retail.map(item => item.name))} ${retail.length === 2 ? 'both' : 'all'} have mapped territory here and no official source available to AcresX separates them, so the order shown is not a likelihood — confirm with ${retail.length === 2 ? 'both' : 'each'}.`;
  } else if (retail.length === 1) {
    note = 'One retail electric territory intersected the parcel point.';
  }

  const ranked = ordered.map((item, index) => ({ name: item.name, type: item.type, rank: index + 1, ...(item.addedFrom ? { addedFrom: item.addedFrom } : {}) }));
  const primary = ranked.length ? {
    name: ranked[0].name,
    rank: 1,
    basis,
    // Only a single mapped retail territory counts as resolved; a ranked overlap never does.
    resolved: ranked.length === 1,
    confidence: ranked.length === 1 ? 'moderate' : 'low',
    note,
    ...(evidence ? { evidence } : {})
  } : null;

  return {
    ranked,
    primary,
    alsoListed: ranked.slice(1).map(item => item.name),
    wholesale: wholesale.map(item => item.name),
    providers: [...ranked.map(item => item.name), ...wholesale.map(item => item.name)]
  };
}
