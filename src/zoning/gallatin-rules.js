// Gallatin County, MT zoning rules (unincorporated land only), in plain language, and how the
// county zoning layer's values map to them.
//
// Gallatin County has no single zoning code: each zoning district has its own regulation, listed
// at https://www.gallatinmt.gov/597/Zoning-Regulations (read 2026-11-17). Every regulation below
// was downloaded from that page on 2026-11-17 (gallatinmt.gov DocumentCenter PDFs) and read with
// pdftotext; each entry cites its section numbers. Districts marked part1 also adopt the Gallatin
// County "Part 1" Zoning Administrative Regulation (adopted May 21, 2019, amended August 10, 2021,
// Resolution 2021-103, https://www.gallatinmt.gov/DocumentCenter/View/1026): a use not listed as
// permitted or conditional is prohibited unless the Planning & Zoning Commission classifies it
// (§§3.2, 3.8), and the zoning does not apply to land used for agriculture, grazing, horticulture
// or timber (§3.7, §76-2-109 MCA).
//
// Layer values (County_Zoning_Districts/FeatureServer/42, every distinct DISTRICT_N + INNERZONE
// read 2026-11-17; src/counties/gallatin.js returns INNERZONE as zoning.code and DISTRICT_N as
// zoning.district, e.g. 'Hyalite zoning district'). A code means different things in different
// districts ('PL', 'C', 'R-5', 'AR'), so rules are looked up by district + code. Without a district
// a code is used only when exactly one district has it.
//
// Mapped: the residential, agricultural and rural zones of all 22 districts on the layer, plus
// Big Sky OSP/PL and South Gallatin PL. Not mapped (the answer says "rules not mapped" and links
// the district regulation): commercial, industrial, public-institution and resort zones (e.g. Big
// Sky CC/CF/CI/CR/MC/R/RB/TCC, Bozeman Area R-O/N-S/M-I/PLI, Four Corners MU/C/NC/PLI), Bozeman
// Area 'RMH' (one polygon; no such zone in the regulation), Trail Creek PUD, Bozeman Pass PL-640,
// Reese Creek PL and Springhill PL/CFI.

const DOC = id => `https://www.gallatinmt.gov/DocumentCenter/View/${id}`;
export const GALLATIN_REGULATIONS_URL = 'https://www.gallatinmt.gov/597/Zoning-Regulations';

const status = (state, label, note = '') => ({ label, status: state, note });
const P = (label, note) => status('permitted', label, note);
const L = (label, note) => status('limited', label, note);
const C = (label, note) => status('conditional', label, note);
const N = (label, note) => status('not_permitted', label, note);

const SFH = 'Single-family home';
const ADU = 'Accessory dwelling / guest house';
const MH = 'Manufactured home';
const AG = 'Agriculture';
const HO = 'Home occupation / home business';
const BB = 'Bed and breakfast';

// Part 1 §3.7 (districts that adopt Part 1).
const agPart1 = 'Land used for agriculture, grazing, horticulture or timber is exempt from this zoning (Part 1 §3.7; §76-2-109 MCA). A home or other non-farm use on it is not.';
const unlisted = (sections, part1) => part1
  ? `Not listed as a permitted or conditional use (${sections}); unlisted uses are not allowed unless the Planning & Zoning Commission classifies them (Part 1 §§3.2, 3.8).`
  : `Not listed as a permitted or conditional use (${sections}); ask Gallatin County Planning.`;
const mhSilent = sections => `The regulation does not address manufactured homes separately (${sections}); confirm with Gallatin County Planning that the home type qualifies as a single-family dwelling.`;

// ---- Districts. Key: the layer's DISTRICT_N, upper-cased. Each zone: name, family, density,
// setback, height, uses, section (the sections the entry cites).

const HYALITE = {
  title: 'Hyalite Zoning Regulation', dates: 'adopted March 21, 1988; amended January 26, 2021', url: DOC(1188), part1: true,
  aliases: { 'R-X': 'RX' },
  zones: {
    RX: {
      name: 'Residential (existing subdivisions)', family: 'Residential', section: '§§4, 9',
      density: 'One single-family home per existing lot; lots may not be made smaller except by boundary relocation (§§4.2, 4.4). Not for new subdivisions (§4.1).',
      setback: 'Front 25 ft, rear 25 ft, side 15 ft; watercourses 150 ft (§4.5)', height: '32 feet for homes (§9.7)',
      uses: [P(SFH, 'One per existing lot (§4.2).'), C(ADU, 'Accessory apartments and guest houses need a conditional use permit (§4.3; standards §§9.3, 9.9).'),
        L(MH, 'Homes built off-site must meet HUD code, sit on a permanent foundation and be at least 20 ft wide (§9.7).'), P(AG, 'Agriculture is a permitted use (§4.2).'),
        L(HO, 'Permitted within the home occupation standards; others need a conditional use permit (§§9.12–9.13).'), N(BB, unlisted('§§4.2–4.3', true))]
    },
    'RR-5': {
      name: 'Rural Residential (one home per 5 acres)', family: 'Rural Residential', section: '§§5, 9',
      density: 'Minimum lot 5 acres and 330 ft wide; not applied to land in agricultural production (§5.4).',
      setback: 'Front 25 ft, rear 25 ft, side 15 ft; ag water conveyances 100 ft; watercourses 150 ft (§5.5)', height: '32 feet for homes (§9.7)',
      uses: [P(SFH, 'Including homes for farm or ranch employees (§5.2).'), C(ADU, 'Accessory apartments and guest houses need a conditional use permit (§5.3; standards §§9.3, 9.9).'),
        L(MH, 'Homes built off-site must meet HUD code, sit on a permanent foundation and be at least 20 ft wide (§9.7).'), P(AG, 'Agriculture and on-site sale of crops grown there are permitted (§5.2).'),
        L(HO, 'Permitted within the home occupation standards; others need a conditional use permit (§§5.2, 9.12–9.13).'), C(BB, 'Bed and breakfast inns need a conditional use permit (§5.3).')]
    },
    'RR-10': {
      name: 'Rural Residential (one home per 10 acres)', family: 'Rural Residential', section: '§§6, 9',
      density: 'Minimum lot 10 acres and 330 ft wide (§6.4).',
      setback: 'Front 25 ft, rear 25 ft, side 15 ft; ag water conveyances 100 ft; watercourses 150 ft (§6.5)', height: '32 feet for homes (§9.7)',
      uses: [P(SFH, 'Permitted use (§6.2).'), C(ADU, 'Accessory apartments and guest houses need a conditional use permit (§6.3; standards §§9.3, 9.9).'),
        L(MH, 'Homes built off-site must meet HUD code, sit on a permanent foundation and be at least 20 ft wide (§9.7).'), P(AG, 'Agriculture is a permitted use (§6.2).'),
        L(HO, 'Permitted within the home occupation standards; others need a conditional use permit (§§6.2, 9.12–9.13).'), C(BB, 'Bed and breakfast inns need a conditional use permit (§6.3).')]
    }
  }
};

// Gallatin Canyon/Big Sky: the residential sub-districts share most of their use lists.
const bigSkyUses = (sec, { bb = '', multi = false, sfNote = 'Permitted use' } = {}) => [
  P(SFH, `${sfNote} (§${sec}).`),
  P(ADU, 'One per single-family home; up to 1,000 sq ft on lots under 10 acres, 2,000 sq ft on 10 acres or more (§23.1.c).'),
  L(MH, 'A HUD-code manufactured home is a dwelling unit (§3.40), so it can be the single-family home; mobile homes are listed only in R-MH-6,000.'),
  P(AG, agPart1),
  L(HO, 'Needs the Planning Department\'s written approval; ones that do not meet §23.6 need a conditional use permit.'),
  L('Short-term rental', 'Permitted, subject to permits, licenses and the §23.14 standards.'),
  ...(multi ? [P('Multi-family dwelling', `Permitted use (§${sec}).`)] : []),
  bb ? C(BB, `Bed and breakfast inns need a conditional use permit (§${bb}).`) : N(BB, unlisted(`§${sec.split('.')[0]}`, true))
];
const bigSkyCluster = acres => ({
  name: `Residential Cluster Single Family ${acres}`, family: acres >= 10 ? 'Rural Residential' : 'Residential', section: '§10',
  density: `One dwelling unit per ${acres === 1 ? 'acre' : `${acres} acres`} (gross density); no minimum lot size (§§10.2–10.3).`,
  setback: 'Front 25 ft, side 15 ft, rear 10 ft (§10.6)', height: 'Flat roof 30 ft; pitched roof 33 ft (§10.7)',
  uses: bigSkyUses('10.4', { sfNote: 'One single-family home per lot', bb: '10.5' })
});
const noHomeUses = (sec, part1, agNote) => [N(SFH, unlisted(sec, part1)), N(ADU, unlisted(sec, part1)), N(MH, unlisted(sec, part1)), P(AG, agNote), N(HO, unlisted(sec, part1))];

const BIG_SKY = {
  title: 'Gallatin Canyon/Big Sky Zoning Regulation', dates: 'adopted July 30, 1996; updated November 13, 2025 (Resolution 2025-095)', url: DOC(1172), part1: true,
  aliases: { 'R-MF-3,500': 'R-MF-3500', 'R-MF-6,500': 'R-MF-6500', 'R-SF-7,500': 'R-SF-7500', 'R-SF-11,000': 'R-SF-11000' },
  zones: {
    'R-MF-3500': {
      name: 'Residential Multi-Family 3,500', family: 'Residential', section: '§5',
      density: 'Up to 12 dwelling units per acre (gross); community water and sewer areas (§§5.1–5.2).',
      setback: 'Front 25 ft, side 10 ft, rear 10 ft (§5.5)', height: '40 feet (§5.7)',
      uses: bigSkyUses('5.3', { multi: true })
    },
    'R-MF-6500': {
      name: 'Residential Multi-Family 6,500', family: 'Residential', section: '§7',
      density: 'Up to 6.7 dwelling units per acre (gross); community water and sewer areas (§§7.1–7.2).',
      setback: 'Front 25 ft, side 10 ft, rear 10 ft (§7.5)', height: '40 feet (§7.7)',
      uses: bigSkyUses('7.3', { multi: true })
    },
    'R-SF-7500': {
      name: 'Residential Single-Family 7,500', family: 'Residential', section: '§8',
      density: 'Minimum lot 7,500 sq ft and 70 ft wide; community water and sewer areas (§§8.1–8.2, 8.6).',
      setback: 'Front 25 ft, side 15 ft, rear 10 ft (§8.5)', height: 'Flat roof 40 ft; pitched roof 33 ft (§8.7)',
      uses: bigSkyUses('8.3')
    },
    'R-SF-11000': {
      name: 'Residential Single-Family 11,000', family: 'Residential', section: '§9',
      density: 'Minimum lot 11,000 sq ft and 85 ft wide; community water and sewer areas (§§9.1–9.2, 9.6).',
      setback: 'Front 25 ft, side 15 ft, rear 10 ft (§9.5)', height: 'Flat roof 30 ft; pitched roof 33 ft (§9.7)',
      uses: bigSkyUses('9.3', { bb: '9.4' })
    },
    'RC-SF-1': bigSkyCluster(1), 'RC-SF-2.5': bigSkyCluster(2.5), 'RC-SF-5': bigSkyCluster(5),
    'RC-SF-10': bigSkyCluster(10), 'RC-SF-20': bigSkyCluster(20), 'RC-SF-40': bigSkyCluster(40),
    TCR: {
      name: 'Town Center Residential', family: 'Residential', section: '§15',
      density: 'Minimum lot 5,000 sq ft; a mix of housing types served by community water and sewer (§§15.1–15.2).',
      setback: 'Front 10 ft, side 10 ft, rear 10 ft (§15.5)', height: 'Single-family 33 ft; other structures 40 ft (§15.6)',
      uses: bigSkyUses('15.3', { multi: true, bb: '15.4' })
    },
    OSP: {
      name: 'Open Space Preserve', family: 'Open Space', section: '§20',
      density: 'No dwellings: agriculture, timber and trails only; the land can count toward a PUD or cluster development on the same ownership (§§20.2–20.3).',
      uses: noHomeUses('§§20.3–20.4', true, 'Agriculture and timber harvest are permitted (§20.3).')
    },
    PL: {
      name: 'Public Lands', family: 'Public Lands', section: '§21',
      density: 'No dwellings. If the land becomes private, these limits apply until it is rezoned (§21.2).',
      uses: noHomeUses('§§21.3–21.4', true, 'Agriculture and timber harvest are permitted (§21.3).')
    }
  }
};

const bozemanAreaHeight = '34 ft (roof pitch over 6:12); 30 ft (3:12 to 6:12); 24 ft (under 3:12)';
const bozemanAreaMh = sec => L(MH, `Allowed as the single-family dwelling when HUD-certified, with a pitched roof (at least 1:4) and siding to the ground (§§${sec}, 15.15).`);
const BOZEMAN_AREA = {
  title: 'Gallatin County/Bozeman Area Zoning Regulation', dates: 'adopted July 1999; last amended March 2026', url: DOC(1179), part1: false,
  aliases: { AS: 'A-S', RS: 'R-S', RMH: '' },
  zones: {
    'A-S': {
      name: 'Agriculture Suburban', family: 'Agricultural / Rural', section: '§6',
      density: 'One dwelling per 20 acres with a minimum lot of 1 acre; a cluster option needs 40% open space; more through a PUD or transfer of development rights (§6.05).',
      setback: 'Front 35 ft, rear 25 ft, side 25 ft (§6.06)', height: `${bozemanAreaHeight} (§6.07)`,
      uses: [P(SFH, 'One dwelling unit per parcel of record (§6.02).'), P(ADU, 'One accessory dwelling per parcel, within the size limits of §15.02 (§6.03).'), bozemanAreaMh('6.02'),
        P(AG, 'Agricultural activities are a principal use (§6.02).'), L(HO, 'Allowed under the §15.14 standards (§6.03).'), C(BB, 'Bed and breakfast homes need a conditional use permit (§6.04).')]
    },
    'R-S': {
      name: 'Residential Suburban', family: 'Rural Residential', section: '§7',
      density: 'Minimum lot 1 acre and 150 ft wide (§7.05).',
      setback: 'Front 35 ft, rear 25 ft, side 25 ft (§7.06)', height: `${bozemanAreaHeight} (§7.07)`,
      uses: [P(SFH, 'One dwelling unit per parcel of record (§7.02).'), P(ADU, 'One accessory dwelling per parcel, within the size limits of §15.02 (§7.03).'), bozemanAreaMh('7.02'),
        L(AG, 'Permitted on 2 acres or more; a conditional use under 2 acres (§§7.02, 7.04).'), L(HO, 'Allowed under the §15.14 standards (§7.03).'), C(BB, 'Bed and breakfast homes need a conditional use permit (§7.04).')]
    },
    'RX-MD': {
      name: 'Residential Existing Medium Density', family: 'Residential', section: '§8',
      density: 'Lot area and width as on the recorded plat; lots may not be made smaller except by boundary relocation; lot coverage up to 40% (§§8.05–8.06).',
      setback: 'Front 25 ft, rear 20 ft, side 8 ft (§8.07)', height: '32 ft (roof pitch over 6:12); 28 ft (3:12 to 6:12); 24 ft (under 3:12) (§8.08)',
      uses: [P(SFH, 'One dwelling unit per parcel of record (§8.02).'), P(ADU, 'One accessory dwelling per parcel, within the size limits of §15.02 (§8.03).'), bozemanAreaMh('8.02'),
        N(AG, unlisted('§§8.02–8.04', false)), L(HO, 'Allowed under the §15.14 standards (§8.03).'), C(BB, 'Bed and breakfast homes need a conditional use permit (§8.04).')]
    },
    'RX-HD': {
      name: 'Residential Existing High Density', family: 'Residential', section: '§9',
      density: 'Lot area and width as on the recorded plat; one single-family, two-family or multi-family building per existing parcel; lot coverage up to 40% (§§9.02, 9.05–9.06).',
      setback: 'Front 25 ft, rear 20 ft, side 8 ft (zero on townhouse common walls) (§9.07)', height: '38 ft (roof pitch 3:12 or more); 32 ft (flatter) (§9.08)',
      uses: [P(SFH, 'One dwelling unit per parcel of record (§9.02).'), P('Duplex / multi-family / townhouse', 'One two-family or multi-family dwelling per existing parcel; townhouses (§9.02).'),
        P(ADU, 'One accessory dwelling per parcel, within the size limits of §15.02 (§9.03).'), bozemanAreaMh('9.02'),
        N(AG, unlisted('§§9.02–9.04', false)), L(HO, 'Allowed under the §15.14 standards (§9.03).'), C(BB, 'Bed and breakfast homes need a conditional use permit (§9.04).')]
    },
    'R-MH': {
      name: 'Residential Mobile Home', family: 'Residential', section: '§10',
      density: 'Mobile home parks and subdivisions on sites of 10 acres or more; subdivision lots at least 5,500 sq ft and 55 ft wide with community water and sewer (§§10.02, 10.05).',
      setback: 'Mobile home subdivision lots: front 20 ft, rear 8 ft, side 8 ft (§10.06)', height: '30 ft (roof pitch 3:12 or more); 24 ft (flatter) (§10.07)',
      uses: [P(SFH, 'One dwelling per parcel of record or park space (§10.02).'), P(MH, 'Single-family mobile and manufactured homes are principal uses (§10.02).'),
        P(ADU, 'One accessory dwelling per parcel (§§10.03, 15.02).'), N(AG, unlisted('§§10.02–10.04', false)), L(HO, 'Allowed under the §15.14 standards (§10.03).')]
    }
  }
};

const bridgerAe = pud => ({
  name: `Agriculture Exclusive (PUD ${pud})`, family: 'Agricultural / Rural', section: '§§4, 11, 12',
  density: `Minimum parcel 40 acres (§4.4.a). The map's "PUD ${pud}" designation is the density for a Planned Unit Development: about one dwelling per ${pud} acres (§11).`,
  setback: 'Property lines 25 ft; public roads and road easements 125 ft; watercourses 150 ft (§4.4.b)', height: '35 ft (roof pitch 1:4 or steeper); 25 ft (flatter) (§4.4.c)',
  uses: [P(SFH, 'One principal single-family home per conforming parcel (§4.2.b).'),
    P(ADU, 'One per parcel, up to 1,200 sq ft, within 150 ft of the home, not rented or sold separately (§§4.2.c, 12.2).'),
    L(MH, 'Every dwelling, including mobile and pre-fabricated homes, needs a permanent mortar or concrete foundation (§12.8).'),
    P(AG, 'Agriculture and on-site sale and processing of its products are permitted (§4.2.a).'), L(HO, 'Permitted under the §12.11 standards (§4.2.h).'),
    C(BB, 'Bed and breakfast inns and guest ranches need a conditional use permit (§4.3).')]
});
const BRIDGER_CANYON = {
  title: 'Bridger Canyon Zoning Regulation', dates: 'adopted October 26, 1971; amended February 8, 2024', url: DOC(1164), part1: true,
  aliases: { 'AE-PD-10': 'AEPD10', 'AE-PD-20': 'AEPD20', RFPD20: 'RF-PD-20' },
  zones: {
    AEPD10: bridgerAe(10), AEPD20: bridgerAe(20),
    'RF-PD-20': {
      name: 'Recreation and Forestry (PUD 20)', family: 'Rural / Forest', section: '§§5, 11, 12',
      density: 'Minimum parcel 40 acres (§5.4.a). The map\'s "PUD 20" designation is the density for a Planned Unit Development: about one dwelling per 20 acres (§11).',
      setback: 'Property lines 25 ft; public roads and road easements 125 ft; watercourses 150 ft (§5.4.b)', height: '35 ft (roof pitch 1:4 or steeper); 25 ft (flatter) (§5.4.c)',
      uses: [P(SFH, 'One principal single-family home per conforming parcel (§5.2.a).'),
        N(ADU, 'Accessory dwelling units are listed in the AE district but not in RF (§§5.2–5.3); ask Gallatin County Planning.'),
        L(MH, 'Every dwelling, including mobile and pre-fabricated homes, needs a permanent mortar or concrete foundation (§12.8).'),
        P(AG, 'Agriculture and personal lumber milling are permitted (§5.2).'), L(HO, 'Permitted under the §12.11 standards (§5.2.h).'),
        C('Guest ranch', 'Guest ranches need a conditional use permit (§5.3.f).')]
    }
  }
};

const bozemanPass = (acres, sec, split) => ({
  name: `Agricultural and Rural Residential (one home per ${acres} acres)`, family: 'Agricultural / Rural', section: `§§${sec}, 6`,
  density: `One single-family home per ${acres} acres or per parcel of record; no minimum lot size; parcels must be ${split} acres or larger to subdivide (§${sec}.6).`,
  setback: `None for uses allowed by right, except perennial stream setbacks (§§${sec}.7, 6.6)`, height: `No limit for uses allowed by right (§${sec}.8)`,
  uses: [P(SFH, `One residential dwelling, no land use permit needed (§${sec}.2).`),
    P(ADU, `One accessory dwelling such as a caretaker residence or non-commercial guesthouse (§${sec}.3).`),
    L(MH, mhSilent(`§${sec}.2`) + ` Mobile homes are allowed as farm employee housing (§${sec}.3).`),
    P(AG, `Agriculture, including farm buildings and selling products grown there (§${sec}.2).`), P(HO, `Allowed by right if incidental and not a nuisance (§§${sec}.3, 6.5).`),
    C('Rentals / bed and breakfast', `Licensed or commercial residential rentals, vacation rentals, guest ranches and bed and breakfasts need a conditional use permit (§${sec}.4).`)]
});
const BOZEMAN_PASS = {
  title: 'Bozeman Pass Zoning Regulation', dates: 'adopted May 16, 2006; amended August 3, 2021 (Resolution 2021-102)', url: DOC(1160), part1: true,
  aliases: { AR40: 'AR-40', AR80: 'AR-80' },
  zones: { 'AR-40': bozemanPass(40, '3', 72), 'AR-80': bozemanPass(80, '4', 144) }
};

const reeseMh = 'Mobile, modular and manufactured homes qualify as single-family dwellings, with foundation, utility and appearance standards (§3.01.14).';
const reeseCreek = ({ name, sec, density, water, setbackSec, heightSec }) => ({
  name, family: 'Rural Residential', section: `§${sec}`,
  density,
  setback: `Property lines 25 ft; Springhill, Rocky Mountain, Gee Norman, Reese Creek and Bear Creek roads 50 ft; streams, ditches and springs ${water} ft; wetlands 50 ft (§${setbackSec})`,
  height: `32 ft; 35 ft in naturally wooded sites (§${heightSec})`,
  uses: [P(SFH, `Use by right (§${sec}).`), P(ADU, `One accessory dwelling per lot by right; it does not use a development right (§${sec}).`),
    L(MH, reeseMh), P(AG, `Use by right (§${sec}).`), L(HO, `Home occupations are by right; home-based businesses need a conditional use permit (§${sec}).`),
    C(BB, `Bed and breakfasts need a conditional use permit (§${sec}).`)]
});
const REESE_CREEK = {
  title: 'Reese Creek Zoning District Regulations', dates: 'adopted June 21, 2006; amended February 10, 2026', url: DOC(1195), part1: false,
  aliases: {},
  zones: {
    'RR-40': reeseCreek({ name: 'Rural Residential (one dwelling per 40 acres)', sec: '2.01', water: 50, setbackSec: '2.01.8', heightSec: '2.01.9',
      density: 'Minimum new lot 40 acres; each parcel of record at adoption has one development right (§2.01.6).' }),
    'AR-80': reeseCreek({ name: 'Agricultural and Rural Residential (one dwelling per 80 acres)', sec: '2.02', water: 100, setbackSec: '2.02.9', heightSec: '2.02.10',
      density: 'Minimum new lot 80 acres (smaller only through a cluster subdivision); 80-acre parcels get one extra development right for a cluster or transfer (§§2.02.3, 2.02.7).' }),
    'RW-160': reeseCreek({ name: 'Rural Residential and Wildlife Corridor (one dwelling per 160 acres)', sec: '2.03', water: 100, setbackSec: '2.03.9', heightSec: '2.03.10',
      density: 'Minimum new lot 160 acres (smaller only through a cluster subdivision); 160-acre parcels get three extra development rights for a cluster or transfer (§§2.03.3, 2.03.7).' })
  }
};

const southGallatinMh = L(MH, 'Homes built off-site must meet HUD guidelines and sit on a permanent mortared block or concrete foundation (§9.3.b).');
const SOUTH_GALLATIN = {
  title: 'South Gallatin Zoning Regulation', dates: 'adopted February 10, 1994; amended September 11, 2025', url: DOC(1204), part1: true,
  aliases: {},
  zones: {
    RF: {
      name: 'Recreation and Forestry', family: 'Rural / Forest', section: '§§4, 9',
      density: 'One single-family home per 100 acres or per parcel of record; minimum parcel 100 acres; clustered homes up to 2 per 100 acres with a conditional use permit (§§4.4–4.6, 4.8).',
      setback: 'Front 35 ft, rear 25 ft, side 25 ft; Highway 191 per §9.8 (§4.11.b)', height: '32 feet for homes; at least 1,000 sq ft of floor area (§4.11)',
      uses: [P(SFH, 'One per 100 acres or per parcel of record (§4.6.q).'), C(ADU, 'One guest house per home, or a caretaker\'s residence, with a conditional use permit (§4.8).'), southGallatinMh,
        P(AG, 'Timber, crop farming, grazing and livestock are permitted (§4.6).'), L(HO, 'Inside buildings of a permitted use; separate buildings for it need a conditional use permit (§§4.6.j, 4.8.b).'),
        C(BB, 'Bed and breakfasts need a conditional use permit (§4.8.j).')]
    },
    CR: {
      name: 'Canyon Residential', family: 'Rural Residential', section: '§§8, 9',
      density: 'One single-family home per 3 acres; minimum lot 3 acres unless clustered; lots of 1 to 3 acres need a conditional use permit (§§8.2, 8.4.g, 8.6).',
      setback: 'Front 100 ft, rear 25 ft, side 25 ft; Highway 191 per §9.8 (§8.7)', height: '32 feet for homes (§8.9)',
      uses: [P(SFH, 'One per 3 acres or per parcel of record (§8.3.g).'), C(ADU, 'Guest houses need a conditional use permit (§8.4.c).'), southGallatinMh,
        P(AG, 'Timber, crop farming, grazing and keeping animals for family use are permitted (§8.3).'), L(HO, 'Inside buildings of a permitted use; separate buildings for it need a conditional use permit (§§8.3.k, 8.4.b).'),
        C(BB, 'One bed and breakfast inn, with a conditional use permit (§8.4.d).')]
    },
    PL: {
      name: 'Public Lands', family: 'Public Lands', section: '§7',
      density: 'No dwellings. If the land becomes private, these limits apply until it is rezoned (§7.2).',
      uses: noHomeUses('§§7.3–7.4', true, 'Timber, crop farming and grazing are permitted (§7.3).')
    }
  }
};

const hebgenMh = L(MH, 'A HUD-code home on a permanent foundation that meets the dwelling standards is a single-family dwelling; one that does not is a mobile home (§§3.42, 18.7).');
const hebgenSetback = (sec, side) => `Front 35 ft, rear 25 ft, side ${side} ft; watercourses 35 ft (§${sec})`;
const hebgenExisting = (sec, extra = {}) => [
  P(SFH, `One per existing lot (§${sec}.2).`), C(ADU, `Guest houses need a conditional use permit (§${sec}.3).`), hebgenMh, P(AG, agPart1),
  L(HO, 'Permitted within the home occupation standards; others need a conditional use permit (§§18.8–18.9).'),
  P('Long-term renting (30+ days)', `Residential renting is a permitted use (§${sec}.2).`), ...(extra.more || [])
];
const hebgenRural = (acres, sec) => ({
  name: `Residential (one home per ${acres} acres)`, family: 'Rural Residential', section: `§§${sec}, 18`,
  density: `One dwelling unit per ${acres} acres (not a minimum lot size); open-space developments of 60+ acres can earn up to 25% more units with a conditional use permit (§§${sec}.4, ${sec}.8).`,
  setback: hebgenSetback(`${sec}.5`, 25), height: `32 feet; homes at least 1,000 sq ft (§§${sec}.6–${sec}.7)`,
  uses: [P(SFH, `One per lot (§${sec}.2).`), C(ADU, `Guest houses need a conditional use permit (§${sec}.3).`), hebgenMh, P(AG, `Agriculture is a permitted use (§${sec}.2).`),
    L(HO, 'Permitted within the home occupation standards; others need a conditional use permit (§§18.8–18.9).'),
    P('Long-term renting (30+ days)', `Residential renting is a permitted use (§${sec}.2).`), C('Townhomes / condominiums', `Only in open-space developments, with a conditional use permit (§${sec}.3).`)]
});
const HEBGEN_LAKE = {
  title: 'Hebgen Lake Zoning Regulation', dates: 'adopted November 13, 1975; amended October 1, 2019', url: DOC(1184), part1: true,
  aliases: { COSX: 'COS-X', PUDX: 'PUD-X' },
  zones: {
    RX: {
      name: 'Existing Residential', family: 'Residential', section: '§§4, 18',
      density: 'One home per existing lot in subdivisions platted before zoning; lots may not be divided (§§4.1–4.4).',
      setback: hebgenSetback('4.5', 12), height: '32 feet; homes at least 1,000 sq ft (§§4.6–4.7)', uses: hebgenExisting('4')
    },
    'COS-X': {
      name: 'Existing Residential Certificate of Survey', family: 'Residential', section: '§§5, 18',
      density: 'One dwelling unit per 3 acres; lot area and width as approved on the certificate of survey (§§5.4–5.5).',
      setback: hebgenSetback('5.6', 12), height: '32 feet; homes at least 1,000 sq ft (§§5.7–5.8)', uses: hebgenExisting('5')
    },
    'R-5': hebgenRural(5, '7'), 'R-10': hebgenRural(10, '8'),
    HLE: {
      name: 'Hebgen Lake Estates', family: 'Residential', section: '§§9, 18',
      density: 'Existing Hebgen Lake Estates lots; no further division; duplexes and multi-family only on the lots listed in §9.2 (§§9.2, 9.4).',
      setback: hebgenSetback('9.5', 12), height: '32 feet (§9.7)',
      uses: [P(SFH, 'Permitted use (§9.2).'), L('Duplex / multi-family', 'Only on the specific lots listed in §9.2.'), C(ADU, 'Guest houses need a conditional use permit (§9.3).'), hebgenMh,
        P(AG, agPart1), L(HO, 'Permitted within the home occupation standards; others need a conditional use permit (§§18.8–18.9).'), P('Long-term renting (30+ days)', 'Residential renting is a permitted use (§9.2).')]
    },
    RP: {
      name: 'Rainbow Point', family: 'Residential', section: '§§13, 18',
      density: 'One dwelling plus either a guest house or a caretaker unit of up to 1,000 sq ft per parcel; existing lots may not be divided (§§13.4–13.5).',
      setback: hebgenSetback('13.6', 5), height: '32 feet (§13.8)',
      uses: [P(SFH, 'One per existing lot (§13.2).'), C(ADU, 'A guest house or caretaker unit up to 1,000 sq ft needs a conditional use permit (§13.3).'), hebgenMh, P(AG, agPart1),
        L(HO, 'Permitted within the home occupation standards; others need a conditional use permit (§§18.8–18.9).'), C('Short-term rental', 'Needs a conditional use permit (§13.3.e).'), C(BB, 'Needs a conditional use permit (§13.3.f).')]
    },
    'PUD-X': {
      name: 'Existing Planned Unit Development', family: 'Planned Development', section: '§6',
      density: 'Without an approved PUD plan: agriculture, forestry and one family or guest dwelling per 160 acres (land stays undivided). An approved PUD plan allows up to 3 single-family or 5 multi-family units per acre with 35% open space (§§6.2, 6.4).',
      height: '32 feet for homes (§6.4.e)',
      uses: [L(SFH, 'One family or guest dwelling per 160 acres without a PUD plan; more only through a PUD plan approved as a conditional use (§§6.2–6.5).'),
        C('Multi-family / mobile home park', 'Only as part of a PUD plan approved as a conditional use (§§6.3, 6.5).'), hebgenMh,
        P(AG, 'Agriculture and forest products are uses by right (§6.2).'), C(HO, 'Only as part of an approved PUD plan (§6.3).')]
    }
  }
};

const MIDDLE_COTTONWOOD = {
  title: 'Middle Cottonwood Zoning Regulation', dates: 'adopted February 1, 1996; amended September 7, 2010, August 11, 2015 and March 10, 2026', url: DOC(1190), part1: false,
  aliases: {},
  zones: {
    AR: {
      name: 'Agriculture and Rural Residential', family: 'Agricultural / Rural', section: '§7',
      density: 'One home per 20 acres or per parcel of record on February 1, 1994; one per 40 acres inside the Deer Winter Range overlay (§§7.3–7.4). Homes up to 7,000 sq ft or 500 sq ft per acre, whichever is larger (§7.11).',
      setback: 'Property lines 50 ft; listed main roads 125 ft and other public roads 80 ft from the centerline; streams 50 ft (§7.9)', height: '35 feet (§7.10)',
      uses: [P(SFH, 'One per parcel of record or per 20 (or 40) acres, with a land use permit (§7.6).'), P(ADU, 'One accessory dwelling per home, with a land use permit; it does not count toward density (§§7.2.c, 7.6.c).'),
        L(MH, mhSilent('§§7.5–7.7')), P(AG, 'Farming, grazing, livestock and on-site sales are uses by right (§7.5).'), P(HO, 'Use by right (§7.5.g); separate buildings for it need a conditional use permit (§7.7.g).'),
        C(BB, 'One bed and breakfast inn per qualifying parcel, in the owner\'s residence, with a conditional use permit (§7.7.f).')]
    },
    NR: {
      name: 'Natural Resources', family: 'Public Lands / Resource', section: '§§6, 7.9',
      density: 'One single-family home per 160 acres; these rules apply when public land becomes private (§§6.1–6.2).',
      setback: 'Property lines 50 ft; listed main roads 125 ft and other public roads 80 ft from the centerline; streams 50 ft (§§6.5, 7.9)',
      uses: [P(SFH, 'One per 160 acres, with a land use permit (§6.4.a).'), P(ADU, 'One accessory dwelling per home, with a land use permit (§6.4.b).'), L(MH, mhSilent('§§6.3–6.4')),
        P(AG, 'Farming, grazing, timber and on-site sales are uses by right (§6.3).'), N(HO, 'Not listed; all other uses are prohibited in the NR zone (§6.6).')]
    }
  }
};

const SOUTH_COTTONWOOD = {
  title: 'South Cottonwood Canyon Zoning Regulation', dates: 'adopted June 21, 2005', url: DOC(1199), part1: false,
  aliases: {},
  zones: {
    AR: {
      name: 'Agricultural and Rural Residential', family: 'Agricultural / Rural', section: '§§2.01, 3.01',
      density: 'One single-family home per 20-acre parcel, and one accessory dwelling per 20 acres (§§2.01.5–2.01.6).',
      setback: 'Property lines 25 ft; Cottonwood Road and Cottonwood Canyon Road 50 ft; Cottonwood Creek 100 ft; irrigation ditches 35 ft (§2.01.7)', height: '36 feet (§2.01.8)',
      uses: [P(SFH, 'Principal use (§2.01.2).'), P(ADU, 'Accessory use, one per 20 acres; same parcel as the home (§§2.01.3, 2.01.6, 3.01.2).'), L(MH, reeseMh),
        P(AG, 'Principal use (§2.01.2).'), L(HO, 'Home occupations are accessory uses; home-based businesses need a conditional use permit (§§2.01.3–2.01.4).'),
        C(BB, 'Five or fewer rooms, with a conditional use permit (§§2.01.4, 3.01.4).')]
    }
  }
};

const SPRINGHILL = {
  title: 'Springhill Zoning Regulation', dates: 'adopted July 20, 1992; amended December 21, 2021', url: DOC(1209), part1: true,
  aliases: {},
  zones: {
    AR: {
      name: 'Agricultural and Rural Residential', family: 'Agricultural / Rural', section: '§§4, 7, 8',
      density: 'One home per 160 acres or per parcel of record; extra development rights (one per 80 acres) only with a conditional use permit, on 15% of the parcel with lots of at least 1 acre (§§4.2.7, 7.2–7.5).',
      setback: 'Property lines 50 ft; listed roads 125 ft and other public roads 80 ft from the centerline; streams 50 ft (§4.4)', height: '30 feet (§8.11.2)',
      uses: [P(SFH, 'One per 160 acres or per parcel of record, subject to development rights (§4.2.7).'), C(ADU, 'One guest house or caretaker\'s residence per parcel, with a conditional use permit (§4.3.10).'),
        L(MH, 'Mobile homes and manufactured housing must meet HUD code (§8.11.4).'), P(AG, 'Farming, grazing and livestock are uses by right (§4.2).'),
        L(HO, 'Use by right; a conditional use permit if run from an accessory building (§§4.2.11, 4.3.12).'), C(BB, 'Bed and breakfast inns and guest ranches need a conditional use permit (§4.3.11).')]
    }
  }
};

const TRAIL_CREEK = {
  title: 'Trail Creek Zoning Regulation', dates: 'adopted April 17, 1990; amended May 26, 2020', url: DOC(1222), part1: true,
  aliases: { AR20: 'AR-20' },
  zones: {
    'AR-20': {
      name: 'Agricultural Residential (one home per 20 acres)', family: 'Agricultural / Rural', section: '§§4, 6',
      density: 'Minimum lot 20 acres and 660 ft wide (§4.4).',
      setback: 'Front, rear and side 50 ft; Trail Creek Road 100 ft (§4.6)', height: '32 feet (§4.7)',
      uses: [P(SFH, 'Permitted use (§4.2.a).'), L(ADU, 'Permitted under 1,000 sq ft (and for farm employees); larger ones need a conditional use permit (§§4.2.f–g, 4.3.d).'),
        L(MH, 'Homes built off-site must meet HUD code; natural wood siding required (§6.9).'), P(AG, 'Agricultural uses are permitted (§4.2.e).'),
        L(HO, 'Home occupations are permitted; home businesses need a conditional use permit (§§4.2.b, 4.3.h).'), C(BB, 'Bed and breakfasts and guest ranches need a conditional use permit (§4.3).')]
    }
  }
};

const EAST_GALLATIN = {
  title: 'East Gallatin Zoning Regulation', dates: 'adopted June 20, 2006 (Resolution 2006-062)', url: DOC(2034), part1: false,
  aliases: {},
  zones: {
    AR: {
      name: 'Agricultural and Rural Residential', family: 'Agricultural / Rural', section: '§§3.1–3.6, 4',
      density: 'One single-family home per 20 acres or per tract of record by right; up to one per 5 acres through a conditional use permit (clustered) (§3.3).',
      setback: 'East Gallatin River 300 ft or outside the 100-year floodplain; other streams 150 ft; irrigation ditches 50 ft; county roads 100 ft (§4.8)', height: 'Non-agricultural structures over 36 ft need a conditional use permit (§3.4.s)',
      uses: [P(SFH, 'One per existing lot or per 20 acres; no conditional use permit needed (§§3.2, 3.6).'), C(ADU, 'Guest houses and caretaker\'s residences need a conditional use permit (§3.4.v–w).'),
        L(MH, mhSilent('§§3.2–3.6') + ' Mobile home parks need a conditional use permit (§3.4.f).'), P(AG, 'Agriculture and selling products grown there need no permit (§3.6).'),
        L(HO, 'Home occupations under the §4.7 standards need no permit; home-based businesses need a conditional use permit (§§3.4.u, 3.6).'), C(BB, 'Bed and breakfast inns need a conditional use permit (§3.4.b).')]
    }
  }
};

const fourCorners = (sec, density) => ({
  name: sec === '3' ? 'Rural Residential and Agricultural' : 'Low Density Rural Residential and Agricultural', family: 'Rural Residential', section: `§§${sec}, 9`,
  density,
  setback: `No minimum property-line setbacks; landscaped buffers apply to larger projects (§§${sec}.4, 9.2.5)`, height: `50 feet; agricultural structures exempt (§${sec}.5)`,
  uses: [P(SFH, `"Residential" by right covers single-family homes up to four-plexes, with a land use permit (§${sec}.2).`),
    P('Duplex to four-plex', `Allowed by right; more than four units need a conditional use permit (§§${sec}.2–${sec}.3).`),
    P(ADU, `Up to two accessory dwelling units (§${sec}.2).`), L(MH, mhSilent(`§${sec}.2`) + ` Mobile home parks are allowed by right (§${sec}.2).`),
    P(AG, `Agriculture, including its structures and employee housing (§${sec}.2).`),
    L(HO, `Home occupations by right under §9.2.7; home-based businesses need a conditional use permit (§§${sec}.2–${sec}.3).`),
    C('Short-term rental', `Needs a conditional use permit (§${sec}.3; standards §9.2.9).`)]
});
const FOUR_CORNERS = {
  title: 'Four Corners Zoning Regulation', dates: 'adopted September 16, 2009; amended March 31, 2026 (Resolution 2026-022)', url: DOC(1167), part1: false,
  aliases: { 'RR-A': 'RR/A', RRA: 'RR/A', 'LDRR-A': 'LDRR/A', LDRRA: 'LDRR/A' },
  zones: {
    'RR/A': fourCorners('3', 'Base density 1.75 units per acre (gross average); no minimum lot size; up to 2.5 or 3.5 units per acre with transferred development credits or rights (§3.6).'),
    'LDRR/A': fourCorners('4', 'Base density one lot per 10 acres; no minimum lot size; up to one per 5 acres if 75% stays open space (§4.6).')
  }
};

const bearCanyon = (acres, sec, extra = '') => ({
  name: `Residential (one home per ${acres === 1 ? 'acre' : `${acres} acres`})${extra}`, family: 'Rural Residential', section: `§§${sec}, 10`,
  density: `One single-family home per ${acres === 1 ? 'acre' : `${acres} acres`}; minimum lot ${acres} acre${acres === 1 ? '' : 's'}${acres === 5 ? ' and 150 ft wide' : ''} (§§${sec}.2.f, ${sec}.6).${extra ? ' R-5s is applied on slopes over 15% (§6.1).' : ''}`,
  setback: `Front 35 ft, rear 25 ft, side 25 ft; 65 ft from the centerline of county roads (§${sec}.7)`, height: `32 feet; homes at least 800 sq ft (§§${sec}.8–${sec}.9)`,
  uses: [P(SFH, `Permitted use (§${sec}.2.f).`), N(ADU, unlisted(`§§${sec}.2–${sec}.3`, true)),
    L(MH, `Mobile homes are a permitted use (§${sec}.2.n); homes built off-site must meet HUD code, be at least 14 ft wide and sit on a permanent foundation (§10.3).`),
    P(AG, `Agriculture and livestock are permitted (§${sec}.2).`), L(HO, `Inside buildings of a permitted use; separate buildings for it need a conditional use permit (§§${sec}.2.k, ${sec}.3.h).`),
    C(BB, `Bed and breakfast inns and guest ranches need a conditional use permit (§${sec}.3).`)]
});
const BEAR_CANYON = {
  title: 'Bear Canyon Zoning Regulation', dates: 'adopted May 28, 1987; last updated July 14, 2020', url: DOC(1023), part1: true,
  aliases: {},
  zones: { 'R-1': bearCanyon(1, '5'), 'R-5': bearCanyon(5, '6'), 'R-5S': bearCanyon(5, '6', ', slopes over 15%') }
};

// Sypes Canyon No. 1 and No. 2 have the same text; the number after R-S / A-S is the minimum lot.
const sypesUses = (sec, sfLabel) => [P(SFH, `${sfLabel} (§${sec}.2).`), N(ADU, unlisted(`§§${sec}.2–${sec}.3`, true)),
  L(MH, mhSilent(`§${sec}.2`) + ' A mobile home without a permanent foundation (§3.25) is not a listed use.'),
  P(AG, `Agriculture is a permitted use (§${sec}.2).`), L(HO, 'Permitted under §10.15; others need a conditional use permit (§10.16).'), N(BB, unlisted(`§§${sec}.2–${sec}.3`, true))];
const sypesRs = acres => ({
  name: `Residential Suburban (${acres}-acre minimum)`, family: 'Rural Residential', section: '§6',
  density: `Minimum lot ${acres} acre${acres === 1 ? '' : 's'} (the number after R-S on the map), never under 1 acre or 150 ft wide; buildings may cover up to 15% of the lot; homes at least 1,000 sq ft (§§6.4–6.5).`,
  setback: 'Front 35 ft, rear 25 ft, side 25 ft; animal pens 100 ft from homes and roads (§6.6)', height: '24 feet (§6.7)',
  uses: sypesUses('6', 'Newly constructed one-family dwellings')
});
const sypesAs = acres => ({
  name: `Agriculture Suburban (${acres}-acre minimum)`, family: 'Agricultural / Rural', section: '§5',
  density: `Minimum lot ${acres} acres and 330 ft wide; buildings may cover up to 5% of the lot (§§5.4–5.5).`,
  setback: 'Front 35 ft, rear 25 ft, side 25 ft (§5.6)', height: '24 feet for buildings people live or work in (§5.7)',
  uses: sypesUses('5', 'Single-family dwellings')
});
const sypes = (n, id, date) => ({
  title: `Sypes Canyon No. ${n} Zoning Regulation`, dates: `dated ${date}`, url: DOC(id), part1: true,
  aliases: { 'R-S-1': 'RS-1', 'R-S-2.5': 'RS-2.5', 'R-S-10': 'RS-10', 'A-S-10': 'AS-10' },
  zones: { 'RS-1': sypesRs(1), 'RS-2.5': sypesRs(2.5), 'RS-10': sypesRs(10), 'AS-10': sypesAs(10) }
});

const WHEATLAND = {
  title: 'Wheatland Zoning Regulation', dates: 'adopted March 22, 1979; amended September 29, 2020', url: DOC(1224), part1: true,
  aliases: { 'R-S-1': 'RS-1', 'RS1': 'RS-1' },
  zones: {
    'RS-1': {
      name: 'Residential Suburban 1', family: 'Residential', section: '§§C, D, E',
      density: 'One dwelling per acre: one single-family home or one two-family dwelling; lots at least 1 acre; buildings may cover up to 15% of the lot; homes at least 1,000 sq ft (§§C.4–C.5, D.1).',
      setback: 'Front 35 ft, rear 25 ft, side 25 ft (§E.1)', height: '24 feet (§C.3)',
      uses: [P(SFH, 'One per acre (§D.1.1.a).'), P('Two-family dwelling', 'One two-family dwelling instead of a single-family home (§D.1.1.a).'), N(ADU, unlisted('§D.1', true)),
        L(MH, mhSilent('§D.1')), P(AG, agPart1), L(HO, 'Residents only, no more than 25% of the living area (§D.1.1.c).')]
    }
  }
};

const DISTRICT_6 = {
  title: 'Zoning District No. 6 Zoning Regulation', dates: 'adopted April 8, 1979; amended August 25, 2020', url: DOC(1263), part1: true,
  aliases: { 'R-S-10': 'RS-10' },
  zones: {
    'RS-10': {
      name: 'Residential Suburban (10-acre minimum)', family: 'Rural Residential', section: '§6',
      density: 'Minimum lot 10 acres (the number after RS on the map), never under 1 acre or 150 ft wide; buildings may cover up to 15% of the lot; homes at least 1,000 sq ft (§§6.4–6.5).',
      setback: 'Front 35 ft, rear 25 ft, side 25 ft; animal pens 100 ft from homes and roads (§6.6)', height: '24 feet (§6.7)',
      uses: [P(SFH, 'Newly constructed one-family dwelling (§6.2.f).'), N(ADU, unlisted('§§6.2–6.3', true)), L(MH, mhSilent('§6.2')),
        P(AG, 'Agriculture is a permitted use (§6.2.b).'), P(HO, 'Permitted use (§6.2.d).')]
    }
  }
};

const district1Mh = L(MH, 'Allowed on a permanent foundation if it meets HUD code, is at least 24 ft wide and has at least 1,300 sq ft of living area (§9.2.1).');
const DISTRICT_1 = {
  title: 'Zoning District No. 1 Zoning Regulation', dates: 'adopted May 18, 1970; amended December 24, 2019', url: DOC(1260), part1: true,
  aliases: {},
  zones: {
    SRR: {
      name: 'Semi-Rural Residential', family: 'Residential', section: '§§4, 9',
      density: 'One single-family home per half acre (lots at least 1/2 acre, 90 ft wide); one duplex per acre; lot coverage up to 30% (§§4.2, 4.4).',
      setback: 'Front 25 ft, rear 12 ft, side 12 ft; 40 ft next to existing agriculture (§4.4.2)', height: '32 feet (§4.4.3)',
      uses: [P(SFH, 'With a land use permit (§4.2).'), P('Duplex', 'One per acre (§4.2); triplexes and fourplexes need a conditional use permit (§4.3).'), N(ADU, unlisted('§§4.2–4.3', true)),
        district1Mh, P(AG, agPart1), L(HO, 'Under §9.7.A; others need a conditional use permit (§§4.2, 4.3).')]
    },
    R: {
      name: 'General Residential', family: 'Residential', section: '§§5, 9',
      density: 'One single-family home per half acre (lots at least 1/2 acre, 90 ft wide); one duplex per acre; townhomes and condominiums up to 12 units per acre with a conditional use permit; lot coverage up to 30% (§§5.2–5.4).',
      setback: 'Front 25 ft; rear and side 12 ft (25 ft for two stories or more) (§5.4.2)', height: '24 feet (§5.4.3)',
      uses: [P(SFH, 'With a land use permit (§5.2).'), P('Duplex', 'One per acre (§5.2).'), C('Townhomes / condominiums / mobile home parks', 'Need a conditional use permit (§5.3).'),
        N(ADU, unlisted('§§5.2–5.3', true)), district1Mh, P(AG, agPart1), L(HO, 'Under §9.7.A; others need a conditional use permit (§§5.2, 5.3).'),
        C(BB, 'Bed and breakfast inns need a conditional use permit (§5.3).')]
    }
  }
};

const riverRockMh = L(MH, 'New homes on a permanent foundation, including modular and manufactured homes, meeting HUD code (§§3.2.c, 3.10).');
const RIVER_ROCK = {
  title: 'River Rock Zoning Regulation', dates: 'adopted June 21, 1978; amended July 21, 2020', url: DOC(1197), part1: true,
  aliases: {},
  zones: {
    'R-2': {
      name: 'Residential Single Family Medium Density', family: 'Residential', section: '§3',
      density: 'Lots at least 7,500 sq ft and 70 ft wide (4,500 sq ft for duplex townhouses and traditional single family); buildings may cover up to 40%; homes at least 900 sq ft (§§3.4–3.5).',
      setback: 'Detached single family: front 25 ft, rear 15 ft, side 8 ft (§3.6)', height: '24 feet (§3.7)',
      uses: [P(SFH, 'Permitted use (§3.2).'), P('Duplex townhouse', 'Permitted use (§3.2.d).'), N(ADU, unlisted('§§3.2–3.3', true)), riverRockMh, P(AG, agPart1), P(HO, 'Permitted use (§3.2.b).')]
    },
    'R-MH': {
      name: 'Residential Manufactured Home', family: 'Residential', section: '§4',
      density: 'Lots at least 5,000 sq ft and 50 ft wide; buildings may cover up to 50%; homes at least 14 ft wide and 750 sq ft (§§4.4–4.5).',
      setback: 'Front 15 ft, rear 8 ft, side 8 ft; street side 15 ft (§4.6)', height: '24 feet (§4.7)',
      uses: [L(SFH, 'Listed as one-family manufactured and modular homes (§4.2.a).'), P(MH, 'One-family manufactured and modular homes and mobile home parks; HUD code (§§4.2, 4.11).'),
        N(ADU, unlisted('§§4.2–4.3', true)), P(AG, agPart1), N(HO, unlisted('§§4.2–4.3', true))]
    },
    'R-TH': {
      name: 'Residential Medium Density Townhouse', family: 'Residential', section: '§5',
      density: 'Single-family lots 5,000 sq ft; townhouse units 1,600 sq ft; other buildings 5,000 sq ft plus 1,000 sq ft per extra unit; buildings may cover up to 40% (§§5.4–5.5).',
      setback: 'Front 25 ft, rear 20 ft, side 8 ft (none for interior townhouse units) (§5.6)', height: '32 feet (§5.7)',
      uses: [P(SFH, 'R-2 uses are permitted (§5.2.c).'), P('Townhouses / up to four-plex', 'Permitted, up to 4 units per building (§5.2).'), N(ADU, unlisted('§§5.2–5.3', true)), riverRockMh,
        P(AG, agPart1), P(HO, 'Permitted use (§5.2.e).')]
    },
    APT: {
      name: 'Apartments', family: 'Residential', section: '§6',
      density: 'Up to 16 dwelling units per gross acre; lots at least 10,000 sq ft; buildings may cover up to 50% (§§6.3–6.4, 6.9).',
      setback: 'Front 20 ft, rear 10 ft, side 10 ft (§6.5)', height: '36 feet (§6.6)',
      uses: [P(SFH, 'R-2 and R-TH uses are permitted (§6.2.b).'), P('Apartments / multi-family', 'Permitted use (§6.2.a).'), N(ADU, unlisted('§6.2', true)), riverRockMh, P(AG, agPart1)]
    }
  }
};

const NORTH_GALLATIN = {
  title: 'North Gallatin Canyon Zoning Regulations', dates: 'adopted December 16, 2009 (Resolution 2009-166); amended February 26, 2019 (Resolution 2019-022)', url: DOC(1192), part1: false,
  aliases: {},
  zones: {
    NGC: {
      name: 'North Gallatin Canyon', family: 'Mixed (all uses allowed)', section: '§3',
      density: 'The regulation sets no density; new lots go through county subdivision review (§3.3).',
      setback: '5 ft from property lines and outside recorded easements (§3.4.1.B)', height: '40 feet; agricultural structures exempt (§3.4.1.A)',
      uses: [P(SFH, 'All land uses are allowed in this district (§3.2.1).'), P(ADU, 'All land uses are allowed (§3.2.1).'), P(MH, 'All land uses are allowed (§3.2.1).'),
        P(AG, 'All land uses are allowed (§3.2.1).'), P(HO, 'All land uses are allowed (§3.2.1); signs are limited (§3.4.2).')]
    }
  }
};

const DISTRICTS = {
  HYALITE, 'BIG SKY': BIG_SKY, 'GALLATIN COUNTY / BOZEMAN AREA': BOZEMAN_AREA, 'BRIDGER CANYON': BRIDGER_CANYON,
  'BOZEMAN PASS': BOZEMAN_PASS, 'REESE CREEK': REESE_CREEK, 'SOUTH GALLATIN': SOUTH_GALLATIN, 'HEBGEN LAKE': HEBGEN_LAKE,
  'MIDDLE COTTONWOOD': MIDDLE_COTTONWOOD, 'SOUTH COTTONWOOD CANYON': SOUTH_COTTONWOOD, SPRINGHILL, 'TRAIL CREEK': TRAIL_CREEK,
  'EAST GALLATIN': EAST_GALLATIN, 'FOUR CORNERS': FOUR_CORNERS, 'BEAR CANYON': BEAR_CANYON,
  'SYPES CANYON 1': sypes(1, 1213, 'October 1, 2019'), 'SYPES CANYON 2': sypes(2, 1219, 'February 4, 2020'),
  'WHEATLAND HILLS': WHEATLAND, 'ZONING DISTRICT 6': DISTRICT_6, 'ZONING DISTRICT 1': DISTRICT_1,
  'RIVER ROCK': RIVER_ROCK, 'NORTH GALLATIN': NORTH_GALLATIN
};

// Spellings other than the layer's DISTRICT_N (the regulation titles, the website list).
const DISTRICT_ALIASES = {
  'GALLATIN CANYON/BIG SKY': 'BIG SKY', 'GALLATIN CANYON / BIG SKY': 'BIG SKY', 'BOZEMAN AREA': 'GALLATIN COUNTY / BOZEMAN AREA',
  'GALLATIN COUNTY/BOZEMAN AREA': 'GALLATIN COUNTY / BOZEMAN AREA', 'GALLATIN COUNTY/BOZEMAN AREA DONUT': 'GALLATIN COUNTY / BOZEMAN AREA',
  'NORTH GALLATIN CANYON': 'NORTH GALLATIN', 'SOUTH COTTONWOOD': 'SOUTH COTTONWOOD CANYON', WHEATLAND: 'WHEATLAND HILLS',
  'SYPES CANYON #1': 'SYPES CANYON 1', 'SYPES CANYON NO. 1': 'SYPES CANYON 1', 'SYPES CANYON #2': 'SYPES CANYON 2', 'SYPES CANYON NO. 2': 'SYPES CANYON 2',
  'ZONING DISTRICT #1': 'ZONING DISTRICT 1', 'ZONING DISTRICT NO. 1': 'ZONING DISTRICT 1', 'ZONING DISTRICT #6': 'ZONING DISTRICT 6', 'ZONING DISTRICT NO. 6': 'ZONING DISTRICT 6',
  'RIVER ROCK (ROYAL VILLAGE)': 'RIVER ROCK'
};

// 'Hyalite zoning district' (src/counties/gallatin.js districtLabel) or 'HYALITE' -> 'HYALITE'.
export function gallatinDistrictKey(district) {
  let d = String(district ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!/^ZONING DISTRICT\b/.test(d)) d = d.replace(/\s+ZONING DISTRICT$/, '');
  d = d.replace(/\s*\/\s*/g, ' / ');
  if (DISTRICTS[d]) return d;
  const alias = DISTRICT_ALIASES[d] || DISTRICT_ALIASES[d.replace(/ \/ /g, '/')];
  return alias || d;
}

const cleanCode = code => String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');

function zoneIn(districtKey, code) {
  const district = DISTRICTS[districtKey];
  if (!district) return null;
  const c = cleanCode(code);
  const key = Object.prototype.hasOwnProperty.call(district.aliases, c) ? district.aliases[c] : c;
  return key && district.zones[key] ? { districtKey, district, key, zone: district.zones[key] } : null;
}

// The rules entry for a zone, by district + code; a code alone only when one district has it.
export function findGallatinZone(zoneCode, district = '') {
  const dk = gallatinDistrictKey(district);
  if (dk) return zoneIn(dk, zoneCode);
  const hits = Object.keys(DISTRICTS).map(k => zoneIn(k, zoneCode)).filter(Boolean);
  return hits.length === 1 ? hits[0] : null;
}

const UNZONED_DISCLAIMER = 'Screening summary only. No county zoning district covers this parcel, so no county zoning use list, density or setback applies. Other rules still do: subdivision review for new lots, septic and well permits (Gallatin City-County Health Department, Montana DEQ), floodplain permits, road access permits and any recorded covenants. Confirm with Gallatin County Planning (406-582-3130).';
const DISCLAIMER = 'Screening summary of the district regulation, not a land use permit. Overlays, conditional-use review, nonconforming lots, recorded covenants, septic, water, access, floodplain and building codes can change what may be built. Confirm with Gallatin County Planning (406-582-3130) before relying on a listed use.';

function unzoned() {
  return {
    available: true, county: 'Gallatin', jurisdiction: 'Gallatin County', code: 'UNZONED', name: 'No county zoning (unzoned area)', family: 'Unzoned',
    density: 'No county zoning: no zoning density, minimum lot size or setbacks apply here. Lot sizes come from subdivision review and septic and water rules.',
    uses: [
      P(SFH, 'No county zoning rule limits this; septic, water, access and any covenants still apply.'),
      L(ADU, 'No county zoning rule limits this, but a second home needs its own septic capacity and may need Montana subdivision review (for example homes for rent or lease); ask Gallatin County Planning.'),
      P(MH, 'No county zoning rule limits the home type; covenants may.'),
      P(AG, 'No county zoning rule limits agriculture.'),
      P(HO, 'No county zoning rule limits a home business; state licensing and covenants may.')
    ],
    source: 'Gallatin County GIS County Zoning Districts layer (unzoned area); Gallatin County zoning regulations list',
    sourceChapter: 'Unzoned', sourceUrl: GALLATIN_REGULATIONS_URL, disclaimer: UNZONED_DISCLAIMER
  };
}

// The /api/zoning-rules answer body for a Gallatin County zone (county land only; the caller keeps
// city zones away). `district` is the layer district ('Hyalite zoning district' or 'HYALITE').
export function getGallatinZoneRules(zoneCode, district = '') {
  const code = cleanCode(zoneCode);
  if (code === 'UNZONED' || code === 'UNZ') return unzoned();
  const hit = findGallatinZone(code, district);
  const dk = gallatinDistrictKey(district);
  if (!hit) {
    const reg = DISTRICTS[dk];
    return {
      available: false, county: 'Gallatin', zoneCode: String(zoneCode ?? '').trim(), ...(district ? { district: String(district) } : {}), status: 'zone_not_mapped',
      note: reg ? `Plain-language rules for ${String(zoneCode ?? '').trim()} in the ${reg.title} aren't mapped in AcresX yet; see the district regulation and verify with Gallatin County Planning.`
        : "Rules for this zone aren't mapped in AcresX yet; see the district's zoning regulation and verify with Gallatin County Planning.",
      codeUrl: reg ? reg.url : GALLATIN_REGULATIONS_URL, codeLabel: reg ? reg.title : 'Gallatin County zoning regulations'
    };
  }
  const { district: reg, key, zone } = hit;
  const docLabel = `${reg.title} (${reg.dates})`;
  return {
    available: true, county: 'Gallatin', jurisdiction: 'Gallatin County', district: reg.title.replace(/ Zoning Regulations?$/, '').replace(/ Zoning District Regulations$/, ''),
    code: key, name: zone.name, family: zone.family, density: zone.density,
    ...(zone.setback ? { setback: zone.setback } : {}), ...(zone.height ? { buildingHeight: zone.height } : {}),
    uses: zone.uses.map(u => ({ ...u })),
    source: docLabel, sourceChapter: zone.section, sourceUrl: reg.url, codeLabel: reg.title,
    ...(reg.part1 ? { administrativeRegulation: 'Gallatin County "Part 1" Zoning Administrative Regulation (adopted May 21, 2019; amended August 10, 2021)' } : {}),
    disclaimer: DISCLAIMER
  };
}

// For tests and the coverage notes: every mapped district key and zone key.
export function gallatinMappedZones() {
  return Object.fromEntries(Object.entries(DISTRICTS).map(([k, d]) => [k, Object.keys(d.zones)]));
}
