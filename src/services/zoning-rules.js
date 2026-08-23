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
