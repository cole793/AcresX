import { getSpokaneZoneDevelopmentPotential } from '../zoning/spokane-rules.js';
import { json } from '../shared/http.js';

export async function handleZoningRules(request) {
  const body = await request.json();
  const county = String(body.county || '').replace(/\s+County$/i, '').trim();
  const zoneCode = String(body.zoneCode || '').trim();

  if (!county || !zoneCode) return json({ error: 'County and zoneCode are required.' }, 400, 'no-store');

  if (!/^spokane$/i.test(county)) {
    return json({ available: false, county, zoneCode, status: 'adapter_not_built' }, 200, 'public, max-age=3600');
  }

  const potential = getSpokaneZoneDevelopmentPotential(zoneCode, {
    uga: Boolean(body.uga),
    developmentAgreement: body.developmentAgreement || ''
  });

  if (!potential) {
    return json({ available: false, county: 'Spokane', zoneCode, status: 'zone_not_mapped' }, 200, 'public, max-age=3600');
  }

  return json({ available: true, county: 'Spokane', ...potential }, 200, 'public, max-age=86400, s-maxage=604800');
}
