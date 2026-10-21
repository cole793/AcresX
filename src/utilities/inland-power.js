// Official Inland Power residential new-service guidance. Screening only.
export function isInlandPowerProvider(provider = '') {
  return /\binland\s+(?:power|power\s*(?:&|and)\s*light)\b/i.test(String(provider));
}

export function getInlandPowerIntelligence({ provider, parcelId, address } = {}) {
  return {
    available: true,
    adapter: 'inland-power-v1',
    provider: provider || 'Inland Power & Light',
    territory: {
      confirmed: false,
      confidence: 'moderate',
      basis: 'Mapped utility service-territory screening; provider and availability require direct confirmation'
    },
    publicInfrastructure: {
      available: false,
      note: 'Inland Power has not supplied parcel-level distribution facilities or a confirmed service point.'
    },
    costEstimate: {
      available: false,
      status: 'utility_quote_required',
      note: 'Inland Power offers a residential service estimator, but its inputs require a credible route and electrical design. Mapped power proximity alone is not sufficient to calculate a connection quote.',
      estimatorUrl: 'https://www.inlandpower.com/residential-service-estimator',
      engineeringFeeUsd: 500,
      engineeringFeeNote: 'Published nonrefundable engineering fee for low-density new residential service; confirm applicability and current fee with Inland Power.'
    },
    newService: {
      applicationUrl: 'https://www.inlandpower.com/residential-applications',
      requirementsUrl: 'https://www.inlandpower.com/new-construction-step-by-step',
      phone: '(509) 747-7151',
      email: 'newservice@inlandpower.com',
      projectTypes: ['Single-family home', 'Manufactured/mobile home', 'Accessory dwelling unit', 'Outbuilding'],
      requirements: ['Submit residential low-density application and new-member information', 'Provide service address and property sketch showing proposed improvements and existing power', 'Pay applicable engineering fee', 'Meet staking engineer on site before beginning utility job preparation', 'Complete required easements, site work, electrical permits and inspections']
    },
    verification: {
      required: true,
      recommendation: 'Contact Inland Power with the parcel number and site plan to verify territory, available capacity, route, easements and the official line-extension charge.'
    },
    parcel: { parcelId: parcelId || '', address: address || '' }
  };
}
