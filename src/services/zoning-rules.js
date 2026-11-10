import { getSpokaneZoneDevelopmentPotential } from '../zoning/spokane-rules.js';
import { getSpokaneCityZoneRules } from '../zoning/spokane-city-rules.js';
import { getYellowstoneZoneDevelopmentPotential } from '../zoning/yellowstone-rules.js';
import { getKootenaiZoneDevelopmentPotential } from '../zoning/kootenai-rules.js';
import { getStevensZoneRules } from '../zoning/stevens-rules.js';
import { json } from '../shared/http.js';

export async function handleZoningRules(request) {
  const body = await request.json();
  const county = String(body.county || '').replace(/\s+County$/i, '').trim();
  const zoneCode = String(body.zoneCode || '').trim();

  if (!county || !zoneCode) return json({ error: 'County and zoneCode are required.' }, 400, 'no-store');

  if (/^spokane$/i.test(county)) {
    // City zones share letters with county zones (Spokane Valley 'R-3', Cheney 'I-1') but not
    // their rules. A jurisdiction other than the county gets its own city's table
    // (src/zoning/spokane-city-rules.js) or "rules not mapped", never Spokane County rules.
    const jurisdiction = String(body.jurisdiction || '').trim();
    if (jurisdiction && !/^spokane county$/i.test(jurisdiction)) {
      const city = getSpokaneCityZoneRules(jurisdiction, zoneCode);
      return city.available
        ? json(city, 200, 'public, max-age=86400, s-maxage=604800')
        : json(city, 200, 'public, max-age=3600');
    }
    const potential = getSpokaneZoneDevelopmentPotential(zoneCode, {
      uga: Boolean(body.uga),
      developmentAgreement: body.developmentAgreement || ''
    });
    if (!potential) return json({ available: false, county: 'Spokane', zoneCode, status: 'zone_not_mapped' }, 200, 'public, max-age=3600');
    return json({ available: true, county: 'Spokane', ...potential }, 200, 'public, max-age=86400, s-maxage=604800');
  }


  if (/^stevens$/i.test(county)) {
    // Rules and layer-value aliases: src/zoning/stevens-rules.js. City zones ('R-1' in Colville,
    // 'I' in Kettle Falls) share letters with county zones but not their rules, so a jurisdiction
    // other than the county never gets Stevens County rules.
    const jurisdiction = String(body.jurisdiction || '').trim();
    if (jurisdiction && !/^stevens county\b/i.test(jurisdiction)) return json({ available: false, county: 'Stevens', jurisdiction, zoneCode, status: 'zone_not_mapped', note: "City zoning rules aren't mapped in AcresX yet; see the city's zoning code." }, 200, 'public, max-age=3600');
    return json(getStevensZoneRules(zoneCode), 200, 'public, max-age=3600');
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
    // City zones share letters with county zones (CdA 'M', Post Falls 'LI') but not their rules.
    const jurisdiction = String(body.jurisdiction || '').trim();
    if (jurisdiction && !/^kootenai county$/i.test(jurisdiction)) return json({ available: false, county: 'Kootenai', jurisdiction, zoneCode, status: 'zone_not_mapped', note: "City zoning rules aren't mapped in AcresX yet; see the city's zoning code." }, 200, 'public, max-age=3600');
    const potential = getKootenaiZoneDevelopmentPotential(zoneCode);
    if (!potential) return json({ available: false, county: 'Kootenai', zoneCode, status: 'zone_not_mapped' }, 200, 'public, max-age=3600');
    return json({ available: true, county: 'Kootenai', jurisdiction: body.jurisdiction || 'Kootenai County', ...potential }, 200, 'public, max-age=86400, s-maxage=604800');
  }

  return json({ available: false, county, zoneCode, status: 'adapter_not_built' }, 200, 'public, max-age=3600');
}
