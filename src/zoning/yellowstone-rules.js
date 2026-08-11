const BILLINGS_SOURCE = 'https://www.billingsmt.gov/3344/2026-Ordinances';
const COUNTY_SOURCE = 'https://www.billingsmt.gov/755/Zoning-Information';

const status = (label, state, note = '') => ({ label, status: state, note });
const P = (label, note = '') => status(label, 'permitted', note);
const L = (label, note = '') => status(label, 'limited', note);
const SR = (label, note = '') => status(label, 'conditional', note);
const N = (label, note = '') => status(label, 'not_permitted', note);

const residentialNote = 'Development remains subject to dimensional standards, building permits, utilities, sanitation, access, subdivision rules and any applicable overlay or special zoning district.';
const manufacturedNote = 'Manufactured-home eligibility can depend on the specific zoning district, current code standards, building classification and private covenants. Confirm the proposed home type with the Planning Division before purchase.';

const BILLINGS = {
  N1: { name: 'First Neighborhood Residential', family: 'Neighborhood Residential', density: 'Traditional urban neighborhood; verify current lot, density and dimensional standards.', uses: [P('Single-family dwelling'), L('Accessory dwelling unit'), L('Duplex / small residential infill'), L('Manufactured home', manufacturedNote), SR('Community / institutional use'), N('General commercial use')] },
  N2: { name: 'Mid-Century Neighborhood', family: 'Neighborhood Residential', density: 'Established residential neighborhood; verify current lot, density and dimensional standards.', uses: [P('Single-family dwelling'), L('Accessory dwelling unit'), L('Duplex / small residential infill'), L('Manufactured home', manufacturedNote), SR('Community / institutional use'), N('General commercial use')] },
  N3: { name: 'Suburban Neighborhood', family: 'Neighborhood Residential', density: 'Suburban residential development; lot and dimensional standards apply.', uses: [P('Single-family dwelling'), L('Accessory dwelling unit'), L('Additional residential forms where allowed by the primary-use table'), L('Manufactured home', manufacturedNote), SR('Community / institutional use'), N('General commercial use')] },
  N4: { name: 'Large Lot Suburban Neighborhood', family: 'Neighborhood Residential', density: 'Large-lot suburban residential development; verify minimum lot and density standards.', uses: [P('Single-family dwelling'), L('Accessory dwelling unit'), L('Manufactured home', manufacturedNote), L('Home occupation'), SR('Community / institutional use'), N('General commercial use')] },
  N5: { name: 'Residential', family: 'Neighborhood Residential', density: 'Residential development subject to the current Billings zoning table and dimensional standards.', uses: [P('Residential dwelling'), L('Accessory dwelling unit'), L('Manufactured home', manufacturedNote), SR('Community / institutional use'), N('General industrial use')] },
  NX1: { name: 'Neighborhood Mixed Residential 1', family: 'Mixed Residential', density: 'Residential infill / neighborhood housing; project-specific density standards apply.', uses: [P('Single-family dwelling'), P('Duplex / small multifamily'), L('Accessory dwelling unit'), L('Manufactured home', manufacturedNote), SR('Neighborhood-serving nonresidential use'), N('Heavy commercial / industrial use')] },
  NX2: { name: 'Neighborhood Mixed Residential 2', family: 'Mixed Residential', density: 'Moderate residential intensity; verify unit count and dimensional standards.', uses: [P('Single-family dwelling'), P('Duplex / multifamily housing'), L('Accessory dwelling unit'), L('Manufactured home', manufacturedNote), SR('Neighborhood-serving nonresidential use'), N('Heavy industrial use')] },
  NX3: { name: 'Neighborhood Mixed Residential 3', family: 'Mixed Residential', density: 'Higher neighborhood residential intensity; verify current density and design standards.', uses: [P('Single-family dwelling'), P('Duplex / multifamily housing'), L('Accessory dwelling unit'), L('Manufactured home', manufacturedNote), SR('Neighborhood-serving nonresidential use'), N('Heavy industrial use')] },
  NMU: { name: 'Neighborhood Mixed Use', family: 'Mixed Use', density: 'Neighborhood-scale residential and commercial mix; design and use limitations apply.', uses: [P('Residential dwelling'), P('Multifamily housing'), L('Neighborhood retail / service'), L('Office / professional use'), SR('Higher-impact commercial use'), N('Heavy industrial use')] },
  CMU1: { name: 'Corridor Mixed Use 1', family: 'Mixed Use', density: 'Mixed residential / commercial corridor development; primary-use-table restrictions apply.', uses: [P('Residential / multifamily housing'), P('Office / professional use'), P('Retail / service'), L('Restaurant / vehicle-oriented commercial'), SR('Vehicle sales and other special-review uses'), N('Heavy industrial use')] },
  CMU2: { name: 'Corridor Mixed Use 2', family: 'Mixed Use', density: 'Higher-intensity mixed-use corridor; current primary-use-table and dimensional standards apply.', uses: [P('Residential / multifamily housing'), P('Office / professional use'), P('Retail / service'), P('Restaurant / commercial use'), L('Vehicle-oriented use'), SR('Higher-impact use')] },
  CX: { name: 'Heavy Commercial', family: 'Commercial', density: 'Commercial development is the primary intent; residential eligibility must be verified in the current primary-use table.', uses: [P('General commercial / retail'), P('Service / office'), L('Vehicle-oriented commercial'), L('Residential use'), SR('Higher-impact commercial use'), N('Heavy industrial use unless specifically allowed')] },
  NO: { name: 'Neighborhood Office', family: 'Office / Mixed Use', density: 'Low-intensity office and compatible neighborhood uses.', uses: [P('Office / professional use'), L('Residential dwelling'), L('Small-scale neighborhood service'), SR('Institutional / community use'), N('Heavy commercial use'), N('Industrial use')] },
  P1: { name: 'Public / Civic', family: 'Public / Institutional', density: 'Public, civic and institutional development; private residential/commercial development is limited.', uses: [P('Public / civic use'), P('Institutional use'), L('Accessory support uses'), SR('Other compatible public-serving use'), N('General residential subdivision'), N('General commercial use')] },
  P2: { name: 'Public, Civic and Institutions', family: 'Public / Institutional', density: 'Public, civic and institutional development; private development requires use-table verification.', uses: [P('Public / civic use'), P('Institutional use'), L('Accessory support uses'), SR('Other compatible public-serving use'), N('General residential subdivision'), N('General commercial use')] },
  I1: { name: 'Light Industrial', family: 'Industrial', density: 'Employment / industrial development; residential development is generally not the primary intent.', uses: [P('Light industrial / production'), P('Warehouse / distribution'), L('Commercial support use'), SR('Higher-impact industrial use'), N('General residential dwelling')] },
  I2: { name: 'Heavy Industrial', family: 'Industrial', density: 'Heavy industrial development; residential development is generally incompatible.', uses: [P('Industrial / production'), P('Warehouse / distribution'), L('Commercial support use'), SR('High-impact / regulated industrial use'), N('General residential dwelling')] },
  PD: { name: 'Planned Development', family: 'Planned Development', density: 'Development is controlled by the approved planned-development documents rather than the base code alone.', uses: [L('Residential development', 'Verify the adopted PD plan.'), L('Commercial development', 'Verify the adopted PD plan.'), L('Industrial / employment development', 'Verify the adopted PD plan.'), SR('Changes from the approved plan')] }
};

const COUNTY = {
  A: { name: 'Agriculture', family: 'Agricultural / Rural', density: 'Agricultural and rural development; verify minimum lot size and sanitation requirements.', uses: [P('Agriculture / grazing / crops'), L('Single-family dwelling'), L('Manufactured home', manufacturedNote), L('Accessory dwelling / structures'), SR('Commercial or institutional use'), SR('Industrial / extraction use')] },
  AG: { name: 'Agriculture', family: 'Agricultural / Rural', density: 'Agricultural and rural development; verify minimum lot size and sanitation requirements.', uses: [P('Agriculture / grazing / crops'), L('Single-family dwelling'), L('Manufactured home', manufacturedNote), L('Accessory dwelling / structures'), SR('Commercial or institutional use'), SR('Industrial / extraction use')] },
  RR1: { name: 'Rural Residential 1', family: 'Rural Residential', density: 'Rural residential; approximately one-acre development pattern where current standards allow.', uses: [P('Single-family dwelling'), L('Manufactured home', manufacturedNote), L('Accessory dwelling / structures'), L('Home occupation'), SR('Community / institutional use'), N('Heavy industrial use')] },
  RR2: { name: 'Rural Residential 2', family: 'Rural Residential', density: 'Rural residential; verify current minimum lot size and subdivision standards.', uses: [P('Single-family dwelling'), L('Manufactured home', manufacturedNote), L('Accessory dwelling / structures'), L('Home occupation'), SR('Community / institutional use'), N('Heavy industrial use')] },
  RR3: { name: 'Rural Residential 3', family: 'Rural Residential', density: 'Rural residential; approximately three-acre development pattern where current standards allow.', uses: [P('Single-family dwelling'), L('Manufactured home', manufacturedNote), L('Accessory dwelling / structures'), L('Home occupation'), SR('Community / institutional use'), N('Heavy industrial use')] },
  RMH: { name: 'Residential Manufactured Home', family: 'Residential', density: 'Residential district intended to accommodate manufactured-home development subject to applicable standards.', uses: [P('Manufactured home', manufacturedNote), P('Residential dwelling'), L('Accessory structures'), L('Home occupation'), SR('Community / institutional use'), N('Heavy commercial / industrial use')] },
  RT: { name: 'Residential Tracts', family: 'Residential', density: 'Residential tract development; verify minimum lot area, sanitation and dimensional standards.', uses: [P('Single-family dwelling'), L('Manufactured home', manufacturedNote), L('Accessory structures'), L('Home occupation'), SR('Community / institutional use'), N('Heavy industrial use')] },
  HC: { name: 'Highway Commercial', family: 'Commercial', density: 'Highway-oriented commercial development; residential eligibility should be verified.', uses: [P('Highway-oriented commercial'), P('Retail / service'), L('Office / lodging / restaurant'), L('Residential use'), SR('Higher-impact commercial use'), N('Heavy industrial use unless specifically allowed')] },
  I1: { name: 'Light Industrial', family: 'Industrial', density: 'Industrial / employment development; residential use is not the primary intent.', uses: [P('Light industrial / production'), P('Warehouse / distribution'), L('Commercial support use'), SR('Higher-impact industrial use'), N('General residential dwelling')] },
  I2: { name: 'Heavy Industrial', family: 'Industrial', density: 'Heavy industrial development; residential use is generally incompatible.', uses: [P('Industrial / production'), P('Warehouse / distribution'), L('Commercial support use'), SR('High-impact / regulated industrial use'), N('General residential dwelling')] }
};

function cleanCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function fallbackProfile(code, jurisdiction, zoneName = '') {
  const c = cleanCode(code);
  const name = zoneName || code || 'Mapped zoning district';
  if (/^(N\d|NX\d|RR\d|RMH|RT)/.test(c)) return { name, family: 'Residential', density: 'Residential zoning; verify current density, lot and dimensional standards.', uses: [L('Single-family dwelling'), L('Manufactured home', manufacturedNote), L('Accessory dwelling / structures'), SR('Nonresidential use'), N('Heavy industrial use')] };
  if (/^(CMU|NMU|MU|NO)/.test(c)) return { name, family: 'Mixed Use', density: 'Mixed-use zoning; verify current primary-use-table and dimensional standards.', uses: [L('Residential development'), L('Retail / service'), L('Office / professional use'), SR('Higher-impact use')] };
  if (/^(C|HC|CX)/.test(c)) return { name, family: 'Commercial', density: 'Commercial zoning; verify residential eligibility and use limitations.', uses: [L('Commercial / retail'), L('Office / service'), L('Residential use'), SR('Higher-impact commercial use')] };
  if (/^I/.test(c)) return { name, family: 'Industrial', density: 'Industrial zoning; residential development is generally not the primary intent.', uses: [L('Industrial / employment use'), L('Warehouse / distribution'), SR('Higher-impact industrial use'), N('General residential dwelling')] };
  return { name, family: 'Special / Other', density: 'Project-specific zoning standards apply. Review the controlling jurisdiction code before relying on development eligibility.', uses: [L('Proposed development', 'Use eligibility requires verification in the controlling zoning code.')] };
}

export function getYellowstoneZoneDevelopmentPotential(zoneCode, context = {}) {
  const code = cleanCode(zoneCode);
  if (!code) return null;
  const jurisdiction = String(context.jurisdiction || '').toLowerCase();
  const isBillings = jurisdiction.includes('billings');
  const source = isBillings ? BILLINGS_SOURCE : COUNTY_SOURCE;
  const table = isBillings ? BILLINGS : COUNTY;
  const profile = table[code] || fallbackProfile(code, context.jurisdiction, context.zoneName);
  return {
    code,
    name: profile.name,
    family: profile.family,
    density: profile.density,
    uses: profile.uses,
    jurisdiction: context.jurisdiction || 'Yellowstone County',
    sourceChapter: isBillings ? 'BMCC Chapter 27 / Primary Use Table' : 'Yellowstone County zoning regulations',
    sourceUrl: source,
    disclaimer: `${residentialNote} AcresX is a screening tool. Billings and Yellowstone County classify some uses as permitted, limited/restricted, or subject to Special Review; confirm the specific proposal with the responsible Planning Division.`
  };
}
