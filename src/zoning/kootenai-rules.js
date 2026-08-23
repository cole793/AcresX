const SOURCE_URL = 'https://codelibrary.amlegal.com/codes/kootenaicountyid/latest/kootenaicounty_id/0-0-0-3664';

function normalize(zoneRaw) {
  const z = String(zoneRaw || '').toUpperCase().replace(/^COUNTY[-\s]*/, '').trim();
  const aliases = {
    AG:'A', AGRICULTURE:'A', AGRICULTURAL:'A', A:'A',
    RU:'R', RURAL:'R', R:'R',
    AS:'AS', 'AG-SUBURBAN':'AS', 'AG SUBURBAN':'AS', 'AGRICULTURAL-SUBURBAN':'AS',
    RR:'RR', 'RURAL RESIDENTIAL':'RR', 'RURAL-RESIDENTIAL':'RR',
    HDR:'HDR', 'HIGH DENSITY RESIDENTIAL':'HDR', 'HIGH-DENSITY RESIDENTIAL':'HDR',
    C:'C', COMMERCIAL:'C', M:'M', MINING:'M', LI:'LI', 'LIGHT INDUSTRIAL':'LI', I:'I', INDUSTRIAL:'I'
  };
  return aliases[z] || z;
}

const matrix = {
  A:{single:'P',duplex:'P',multi:'',manufactured:'P',adu:'A',accessory:'P',storage:'P'},
  R:{single:'P',duplex:'P',multi:'',manufactured:'P',adu:'A',accessory:'P',storage:'P'},
  AS:{single:'P',duplex:'P',multi:'S',manufactured:'S',adu:'A',accessory:'P',storage:'P'},
  RR:{single:'P',duplex:'P',multi:'',manufactured:'S',adu:'A',accessory:'P',storage:'P'},
  HDR:{single:'P',duplex:'P',multi:'P',manufactured:'P',adu:'A',accessory:'P',storage:'C'},
  C:{single:'P',duplex:'P',multi:'P',manufactured:'',adu:'',accessory:'P',storage:''},
  M:{single:'',duplex:'',multi:'',manufactured:'',adu:'',accessory:'',storage:''},
  LI:{single:'',duplex:'',multi:'',manufactured:'',adu:'',accessory:'',storage:''},
  I:{single:'',duplex:'',multi:'',manufactured:'',adu:'',accessory:'',storage:''}
};

const names = {A:'Agriculture',R:'Rural',AS:'Agricultural Suburban',RR:'Rural Residential',HDR:'High Density Residential',C:'Commercial',M:'Mining',LI:'Light Industrial',I:'Industrial'};
const families = {A:'Resource Lands',R:'Rural Lands',AS:'Rural Residential',RR:'Rural Residential',HDR:'Residential',C:'Commercial',M:'Resource / Industrial',LI:'Industrial',I:'Industrial'};
const density = {
  A:'Residential development subject to Agriculture district lot, frontage and use standards',
  R:'Residential development subject to Rural district lot, frontage and use standards',
  AS:'Residential development subject to Agricultural Suburban district standards',
  RR:'Residential development subject to Rural Residential district standards',
  HDR:'Higher-density residential uses may be allowed subject to district and project standards',
  C:'Residential uses are limited to those allowed by the Commercial district use table',
  M:'Residential development is generally not listed as a permitted primary use',
  LI:'Residential development is generally not listed as a permitted primary use',
  I:'Residential development is generally not listed as a permitted primary use'
};

function status(code) {
  if (code === 'P') return 'permitted';
  if (code === 'A' || code === 'S') return 'limited';
  if (code === 'C') return 'conditional';
  return 'not_permitted';
}

export function getKootenaiZoneDevelopmentPotential(zoneCode) {
  const zone = normalize(zoneCode);
  const m = matrix[zone];
  if (!m) return null;
  const use = (key, label, note='') => ({label,status:status(m[key]),note});
  return {
    code: zone,
    name: names[zone] || String(zoneCode || zone),
    family: families[zone] || 'Zoning',
    density: density[zone] || 'Verify project-specific development standards',
    sourceChapter: 'Table 2-1101',
    sourceUrl: SOURCE_URL,
    uses: [
      use('single','Single-family dwelling'),
      use('manufactured','Manufactured home', m.manufactured ? 'Subject to Kootenai County manufactured-home and zone-specific standards.' : ''),
      use('duplex','Duplex', zone === 'RR' ? 'Minimum parcel-size standards apply.' : ''),
      use('multi','Multi-family dwelling', zone === 'HDR' ? 'Lot area, frontage and land-per-unit standards apply.' : ''),
      use('adu','Accessory living unit / ADU', m.adu ? 'Accessory-use and approval standards apply.' : ''),
      use('accessory','Accessory building / shop', m.accessory ? 'Generally accessory to an established primary use; use-specific standards may apply.' : ''),
      use('storage','Personal storage building', ['A','R','AS','RR'].includes(zone) ? 'Special approval and size standards may apply when established before a primary use.' : '')
    ],
    disclaimer:'Screening summary only. Parcel size, frontage, overlays, nonconforming status, septic, access, fire/building code and project-specific review can change what may actually be approved.'
  };
}
