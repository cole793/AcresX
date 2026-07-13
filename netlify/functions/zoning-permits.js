const countyProfiles = {
  Spokane: {
    planningAgency: 'Spokane County Building & Planning',
    healthAgency: 'Spokane Regional Health District',
    planningUrl: 'https://www.spokanecounty.org/194/Building-Planning',
    zoningMapUrl: 'https://www.spokanecounty.org/1362/Maps-GIS',
    permitUrl: 'https://www.spokanecounty.org/194/Building-Planning',
    septicUrl: 'https://srhd.org/programs-and-services/environmental-health/onsite-sewage',
    roadAgency: 'Spokane County Public Works'
  }
};

function fallbackProfile(county) {
  const q = encodeURIComponent(`${county} County Washington planning building permits zoning map official`);
  const septicQ = encodeURIComponent(`${county} County Washington onsite sewage septic permit official`);
  return {
    planningAgency: `${county} County planning or community development`,
    healthAgency: `${county} County environmental health`,
    planningUrl: `https://www.google.com/search?q=${q}`,
    zoningMapUrl: `https://www.google.com/search?q=${encodeURIComponent(`${county} County Washington official zoning map GIS`)}`,
    permitUrl: `https://www.google.com/search?q=${encodeURIComponent(`${county} County Washington official building permit portal`)}`,
    septicUrl: `https://www.google.com/search?q=${septicQ}`,
    roadAgency: `${county} County public works or roads department`
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  try {
    const body = JSON.parse(event.body || '{}');
    const county = String(body.county || '').trim();
    const parcelId = String(body.parcelId || '').trim();
    const address = String(body.address || '').trim();
    if (!county) return { statusCode: 400, body: JSON.stringify({ error: 'County is required' }) };
    const profile = countyProfiles[county] || fallbackProfile(county);
    const permits = [
      { name: 'Land-use / zoning verification', agency: profile.planningAgency, status: 'Verify', reason: 'Confirm allowed use, setbacks, minimum lot size and overlays before design.', url: profile.zoningMapUrl },
      { name: 'Building permit', agency: profile.planningAgency, status: 'Likely', reason: 'Normally required for a new residence, shop or other permitted structure.', url: profile.permitUrl },
      { name: 'On-site septic approval', agency: profile.healthAgency, status: 'Likely', reason: 'Needed when the parcel is not served by public sewer. Site and soil evaluation may be required.', url: profile.septicUrl },
      { name: 'Well notice / water review', agency: 'Washington Department of Ecology and local health authority', status: 'Possible', reason: 'Well construction, water availability and drinking-water requirements vary by project and location.', url: 'https://ecology.wa.gov/Water-Shorelines/Water-supply/Wells' },
      { name: 'Driveway / road approach permit', agency: profile.roadAgency, status: 'Possible', reason: 'Often required for a new or modified connection to a county or state road.', url: profile.planningUrl },
      { name: 'Critical-areas review', agency: profile.planningAgency, status: 'Possible', reason: 'Floodplain, wetlands, shorelines, steep slopes or habitat areas can trigger additional review.', url: profile.planningUrl }
    ];
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      body: JSON.stringify({
        available: true,
        county,
        parcelId,
        address,
        jurisdiction: `${county} County`,
        zoning: {
          status: 'verification_required',
          code: null,
          label: 'County zoning lookup',
          note: 'Washington does not provide one authoritative statewide zoning layer. Open the county zoning source and confirm the parcel designation.',
          url: profile.zoningMapUrl
        },
        agencies: profile,
        permits
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Zoning and permit lookup failed' }) };
  }
};
