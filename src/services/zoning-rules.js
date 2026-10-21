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
    // The official county GIS uses numeric renderer values for some districts.
    // Value 5 denotes RA-5, not a district named "5".
    const codes = { '5':'RA-5', '10':'RA-10', '20':'RA-20', '100':'NR-Forest', '101':'NR-Ag', '103':'AR-10' };
    const code = codes[zoneCode] || zoneCode.toUpperCase();
    const residential = ['R-1','R-2','RA-5','RA-10','RA-20','AR-10','NR-FOREST','NR-AG'];
    if (!residential.includes(code.toUpperCase())) return json({available:false,county:'Stevens',zoneCode:code,status:'zone_not_mapped'},200,'public, max-age=3600');
    const uses = [
      {label:'Single-family dwelling (including manufactured housing)',status:'permitted',note:'Listed as allowed in SCC 3.03.020; building, siting and other standards still apply.'},
      {label:'Accessory dwelling unit',status:'permitted',note:'Subject to SCC 3.06.010 and applicable development standards.'},
      {label:'Accessory structures',status:'permitted'},
      {label:'Home occupation',status:'permitted'},
      {label:'Multifamily residence',status:'limited',note:'Administrative conditional use review and zone density restrictions apply.'}
    ];
    if (['R-1','R-2','RA-5','RA-10','RA-20','AR-10'].includes(code)) uses.push({label:'Mobile/manufactured home park',status:'permitted',note:'Allowed in residential-use matrix; must meet applicable density and other standards.'});
    return json({available:true,county:'Stevens',code,name:({'RA-5':'Rural Area — 5-acre designation','RA-10':'Rural Area — 10-acre designation','RA-20':'Rural Area — 20-acre designation','AR-10':'Agricultural Resource — 10-acre designation','NR-Forest':'Natural Resource — Forest','NR-Ag':'Natural Resource — Agriculture','R-1':'Residential R-1','R-2':'Residential R-2'})[code]||code,family:'Stevens County zoning',density:'Verify parcel-specific minimum lot area, existing-lot status and residential density with Stevens County Land Services. The district name alone is not an approval.',uses,source:'Stevens County Code Title 3 (December 2022), §3.03.020',sourceChapter:'3.03.020',sourceUrl:'https://www.stevenscountywa.gov/20903/Development-Zoning-and-Subdivision-Regulations',disclaimer:'Preliminary land-use screening from the county residential use matrix. Verify current amendments, overlays, shoreline/critical-area rules, access, septic, setbacks, minimum lot size and permit requirements with Stevens County. A permitted use does not establish that a particular parcel is buildable.'},200,'public, max-age=3600');
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
