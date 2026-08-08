const SOURCE_URL = 'https://www.spokanecounty.gov/DocumentCenter/View/47247';

const status = (label, state, note = '') => ({ label, status: state, note });
const P = (label, note = '') => status(label, 'permitted', note);
const L = (label, note = '') => status(label, 'limited', note);
const CU = (label, note = '') => status(label, 'conditional', note);
const N = (label, note = '') => status(label, 'not_permitted', note);

const manufacturedNote = 'Manufactured/mobile homes are treated as single-family dwellings under the Spokane County Zoning Code and must meet the residential and manufactured-home standards of the zone.';

const urbanResidential = {
  LDR: {
    name: 'Low Density Residential', family: 'Urban Residential', chapter: '14.606', density: '1–8 dwelling units per acre',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Row housing'), L('Attached ADU'), CU('Detached ADU'), L('Small-scale multifamily infill'), L('Manufactured home park')]
  },
  'LDR-P': {
    name: 'Low Density Residential Plus', family: 'Urban Residential', chapter: '14.606', density: '1 dwelling unit per acre',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), N('Duplex'), N('Row housing'), L('Attached ADU'), CU('Detached ADU'), L('Manufactured home park')]
  },
  MDR: {
    name: 'Medium Density Residential', family: 'Urban Residential', chapter: '14.606', density: 'Over 6–15 dwelling units per acre',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), P('Row housing'), P('Multifamily dwelling'), L('Attached ADU'), CU('Detached ADU'), L('Manufactured home park')]
  },
  HDR: {
    name: 'High Density Residential', family: 'Urban Residential', chapter: '14.606', density: 'Over 15 dwelling units per acre',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), P('Row housing'), L('Multifamily dwelling'), CU('Multifamily over 30 units/acre'), L('Attached ADU'), CU('Detached ADU'), L('Manufactured home park')]
  }
};

const rural = {
  'R-5': {
    name: 'Rural-5', family: 'Rural', chapter: '14.618', density: 'Maximum 1 dwelling unit per 5 acres',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Attached ADU'), L('Detached ADU'), N('Manufactured home park'), L('Rural cluster development'), P('General agriculture / grazing / crops')]
  },
  RT: {
    name: 'Rural Traditional', family: 'Rural', chapter: '14.618', density: 'Maximum 1 dwelling unit per 10 acres',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Attached ADU'), L('Detached ADU'), N('Manufactured home park'), L('Rural cluster development'), P('General agriculture / grazing / crops'), CU('Home industry'), L('Home profession')]
  },
  RAC: {
    name: 'Rural Activity Center', family: 'Rural', chapter: '14.618', density: 'Maximum 3.5 dwelling units per acre',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Attached ADU'), L('Detached ADU'), L('Manufactured home park'), N('Rural cluster development'), CU('Home industry'), L('Home profession')]
  },
  UR: {
    name: 'Urban Reserve', family: 'Rural', chapter: '14.618', density: 'Maximum 1 dwelling unit per 20 acres',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Attached ADU'), L('Detached ADU'), N('Manufactured home park'), L('Rural cluster development'), P('General agriculture / grazing / crops')]
  },
  RCV: {
    name: 'Rural Conservation', family: 'Rural', chapter: '14.618', density: 'Maximum 1 dwelling unit per 20 acres',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Attached ADU'), L('Detached ADU'), N('Manufactured home park'), L('Rural cluster development'), P('General agriculture / grazing / crops'), CU('Home industry'), L('Home profession')]
  }
};

const commercial = {
  NC: {
    name: 'Neighborhood Commercial', family: 'Commercial', chapter: '14.612', density: 'Residential uses allowed subject to commercial-zone development standards',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Multifamily dwelling'), L('General retail / services'), L('Office / professional / medical'), L('Restaurant'), L('Convenience store / gas station')]
  },
  CC: {
    name: 'Community Commercial', family: 'Commercial', chapter: '14.612', density: 'Residential uses allowed subject to commercial-zone development standards',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Multifamily dwelling'), P('Office / professional / medical'), P('Restaurant'), L('General retail / services'), L('Convenience store / gas station'), P('Self-service storage')]
  },
  RC: {
    name: 'Regional Commercial', family: 'Commercial', chapter: '14.612', density: 'Residential uses allowed subject to commercial-zone development standards',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Multifamily dwelling'), P('General retail / services'), P('Office / professional / medical'), P('Restaurant'), P('Hotel / motel'), P('Warehouse'), P('Motor vehicle sales / repair')]
  },
  LDAC: {
    name: 'Limited Development Area Commercial', family: 'Commercial', chapter: '14.612', density: 'Residential uses allowed; commercial intensity is limited by zone-specific standards',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), N('Multifamily dwelling'), L('General retail / services'), P('Office / professional / medical'), P('Restaurant'), L('Convenience store / gas station')]
  }
};

const mixedUse = {
  MU: {
    name: 'Mixed Use', family: 'Mixed Use', chapter: '14.608', density: 'Higher-intensity mixed residential and commercial development; project-specific design standards apply',
    uses: [P('Single-family through multifamily residential'), P('Manufactured home as single-family dwelling', manufacturedNote), P('Retail / financial / personal services'), P('Professional / medical offices'), P('Hospital'), P('Child day-care center'), P('Self-service storage'), L('Manufacturing / production subject to limits')]
  }
};

const industrial = {
  LI: {
    name: 'Light Industrial', family: 'Industrial', chapter: '14.614', density: 'Industrial employment zone; general residential development is not the primary use',
    uses: [P('Contractor yard'), P('Machine shop'), P('Light manufacturing / production subject to standards'), P('Lumberyard'), P('Commercial uses generally allowed from Regional Commercial, with listed exceptions'), L('Caretaker residence'), N('General residential subdivision')]
  },
  HI: {
    name: 'Heavy Industrial', family: 'Industrial', chapter: '14.614', density: 'Heavy industrial zone; general residential development is not the primary use',
    uses: [P('Heavy manufacturing'), P('Contractor yard'), P('Machine shop'), P('Lumber / sawmill'), P('Chemical manufacturing'), L('Caretaker residence'), CU('Certain high-impact industrial uses'), N('General residential subdivision')]
  }
};

const resource = {
  LTA: {
    name: 'Large Tract Agricultural', family: 'Resource Lands', chapter: '14.616', density: 'Maximum 1 dwelling unit per 40 acres',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Attached ADU'), P('General agriculture / grazing / crops'), P('Forestry'), L('Agricultural processing'), CU('Home industry')]
  },
  STA: {
    name: 'Small Tract Agricultural', family: 'Resource Lands', chapter: '14.616', density: 'Maximum 1 dwelling unit per 10 acres',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Attached ADU'), P('General agriculture / grazing / crops'), P('Forestry'), L('Agricultural processing'), CU('Home industry')]
  },
  FZ: {
    name: 'Forest Lands', family: 'Resource Lands', chapter: '14.616', density: 'Maximum 1 dwelling unit per 20 acres',
    uses: [P('Single-family dwelling'), P('Manufactured home', manufacturedNote), P('Duplex'), L('Attached ADU'), P('Forestry'), P('General agriculture / grazing / crops'), L('Agricultural processing'), CU('Home industry')]
  }
};

const mineral = {
  MZ: {
    name: 'Mineral Lands', family: 'Mineral Lands', chapter: '14.620', density: 'Mineral-resource zone; residential development is not the primary purpose',
    uses: [P('Mining / quarrying subject to Mineral Lands standards'), P('Mineral processing related to permitted extraction'), N('General residential subdivision'), N('General commercial development unless specifically authorized')]
  }
};

export const SPOKANE_ZONE_RULES = {
  ...urbanResidential,
  ...mixedUse,
  ...commercial,
  ...industrial,
  ...resource,
  ...rural,
  ...mineral
};

export function getSpokaneZoneDevelopmentPotential(zoneCode, { uga = false, developmentAgreement = '' } = {}) {
  const code = String(zoneCode || '').trim().toUpperCase();
  const rule = SPOKANE_ZONE_RULES[code];
  if (!rule) return null;

  return {
    code,
    name: rule.name,
    family: rule.family,
    density: rule.density,
    uses: rule.uses,
    uga: Boolean(uga),
    developmentAgreement: developmentAgreement || '',
    source: 'Spokane County Zoning Code, 2025 Printing',
    sourceChapter: rule.chapter,
    sourceUrl: SOURCE_URL,
    disclaimer: 'Screening summary only. Overlay zones, development agreements, critical areas, subdivision standards, utilities, access, public-health requirements and project-specific review can change what may actually be approved.'
  };
}
