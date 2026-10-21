import { getSpokaneZoneDevelopmentPotential } from '../zoning/spokane-rules.js';
import { getYellowstoneZoneDevelopmentPotential } from '../zoning/yellowstone-rules.js';
import { getKootenaiZoneDevelopmentPotential } from '../zoning/kootenai-rules.js';
import { json } from '../shared/http.js';

export async function handleZoningRules(request) {
  const body = await request.json();
  const county = String(body.county || '').replace(/\s+County$/i, '').trim();
  const zoneCode = String(body.zoneCode || '').trim();

  if (!county || !zoneCode) return json({ error: 'County and zoneCode are required.' }, 400, 'no-store');

  if (/^spokane$/i.test(county)) {
    const potential = getSpokaneZoneDevelopmentPotential(zoneCode, {
      uga: Boolean(body.uga),
      developmentAgreement: body.developmentAgreement || ''
    });
    if (!potential) return json({ available: false, county: 'Spokane', zoneCode, status: 'zone_not_mapped' }, 200, 'public, max-age=3600');
    return json({ available: true, county: 'Spokane', ...potential }, 200, 'public, max-age=86400, s-maxage=604800');
  }


  if (/^stevens$/i.test(county)) {
    // GIS layer 1 renderer values: https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/FeatureServer/1
    const aliases = {'5':'RA-5','10':'RA-10','20':'RA-20','100':'F','101':'A','103':'AR-10',
      'NR-FOREST':'F','NR-AG':'A','R-1 RESIDENTIAL':'R-1','R-2 RESIDENTIAL':'R-2',
      'BUSINESS':'B','INDUSTRIAL':'I','OPEN SPACE':'UO'};
    const raw = zoneCode.toUpperCase();
    const code = aliases[raw] || raw;
    // SCC Title 3 §3.04.010 (effective December 8, 2022).
    const standards = {
      'RA-5':['Rural Area — 5','Rural','Maximum 1 dwelling unit per 5 acres','10 feet','35 feet'],
      'RA-10':['Rural Area — 10','Rural','Maximum 1 dwelling unit per 10 acres; clustering bonus may apply','10 feet','35 feet'],
      'RA-20':['Rural Area — 20','Rural','Maximum 1 dwelling unit per 20 acres; clustering bonus may apply','10 feet','35 feet'],
      'AR-10':['Rural Agriculture','Resource','Maximum 1 dwelling unit per 10 acres; clustering bonus may apply','10 feet','35 feet'],
      F:['Forest','Resource','Maximum 1 dwelling unit per 20 acres','10 feet','35 feet'],
      A:['Agriculture','Resource','Maximum 1 dwelling unit per 20 acres; clustering bonus may apply','10 feet','35 feet'],
      'R-1':['Residential 1','Residential','UGA: up to 4 dwellings/acre; rural community: up to 3 dwellings/acre (subject to services and §3.05.010)','10 feet','35 feet'],
      'R-2':['Residential 2','Residential','Up to 12 dwellings per acre; target 4–12 dwellings/acre','5 feet','35 feet'],
      UO:['Urban Open Space','Open Space','Up to 4 dwellings/acre, or 3 dwellings/acre without necessary urban services','10 feet','35 feet'],
      B:['Business','Commercial','UGA: up to 12 parcels/acre; rural community: up to 3 parcels/acre (not residential entitlement)','0 feet in UGA; 10 feet in rural community','45 feet UGA; 35 feet rural community'],
      I:['Industrial','Industrial','UGA: up to 12 parcels/acre; rural community: up to 3 parcels/acre (not residential entitlement)','0 feet in UGA; 10 feet in rural community','65 feet UGA; 35 feet rural community']
    };
    const item = standards[code];
    if (!item) return json({available:false,county:'Stevens',zoneCode:code,status:'zone_not_mapped'},200,'public, max-age=3600');
    const [name,family,density,setback,height] = item;
    // §3.03.020: statuses intentionally conservative for categories that vary by zone.
    const uses = [
      {label:'Single-family dwelling (including manufactured housing)',status:code==='B'?'limited':code==='I'?'limited':'permitted',note:code==='B'?'Only as part of a mixed-use structure under the residential-use matrix.':code==='I'?'Verify with Land Services; industrial residential permissions are restricted.':'Allowed use under §3.03.020; site development and permits still required.'},
      {label:'Accessory dwelling unit (ADU)',status:['I','B'].includes(code)?'limited':'permitted',note:'Subject to §3.06.010 and parcel-specific eligibility.'},
      {label:'Accessory structures',status:'permitted',note:'Subject to applicable site and building standards.'},
      {label:'Home occupation',status:'limited',note:'Verify activity-specific standards and district eligibility.'},
      {label:'Multifamily residence',status:['R-1','R-2'].includes(code)?'permitted':'conditional',note:'The county use matrix distinguishes allowed and administrative conditional uses by district; density restrictions apply.'},
      {label:'Manufactured/mobile home park',status:'limited',note:'District-specific use matrix and residential density must be confirmed before treating a park as permitted.'}
    ];
    return json({available:true,county:'Stevens',code,name,family,density,
      setback,buildingHeight:height,
      uses,source:'Stevens County Code Title 3 (effective December 8, 2022), §§3.03.020 and 3.04.010',
      sourceChapter:'3.03.020 / 3.04.010',
      sourceUrl:'https://www.stevenscountywa.gov/20903/Development-Zoning-and-Subdivision-Regulations',
      disclaimer:'Preliminary county zoning screening, not a building permit or lot-size determination. Density is a maximum, not a guarantee of a dwelling on a smaller existing legal lot. Structural setback is the general property-line minimum; road/utility easement setbacks are generally 3 feet from the easement/right-of-way line. Overlays, city jurisdiction, current amendments, critical areas, water, septic and access may alter approvals. Confirm manufactured home parks, multifamily uses and any conditional use with Stevens County Land Services.'},200,'public, max-age=3600');
  }

  if (/^yellowstone$/i.test(county)) {
    const potential = getYellowstoneZoneDevelopmentPotential(zoneCode, {
      jurisdiction: body.jurisdiction || '',
      zoneName: body.zoneName || ''
    });
    if (!potential) return json({ available: false, county: 'Yellowstone', zoneCode, status: 'zone_not_mapped' }, 200, 'public, max-age=3600');
    return json({ available: true, county: 'Yellowstone', ...potential }, 200, 'public, max-age=86400, s-maxage=604800');
  }

  if (/^kootenai$/i.test(county)) {
    const potential = getKootenaiZoneDevelopmentPotential(zoneCode);
    if (!potential) return json({ available: false, county: 'Kootenai', zoneCode, status: 'zone_not_mapped' }, 200, 'public, max-age=3600');
    return json({ available: true, county: 'Kootenai', jurisdiction: body.jurisdiction || 'Kootenai County', ...potential }, 200, 'public, max-age=86400, s-maxage=604800');
  }

  return json({ available: false, county, zoneCode, status: 'adapter_not_built' }, 200, 'public, max-age=3600');
}
