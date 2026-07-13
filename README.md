# AcresX v0.4.1 — Parcel & Hazard Layers

Washington land-intelligence dashboard with:

- Statewide parcel lookup and highlighted parcel geometry
- Nearby Washington Ecology well records
- Likely electric utility territory
- FEMA National Flood Hazard Layer screening and map overlay
- U.S. Fish & Wildlife Service National Wetlands Inventory screening and map overlay
- Street and satellite basemaps
- Beta buildability score incorporating water, flood, wetlands, utility evidence, and data confidence

## Deployment

Upload the contents of this folder to the root of the GitHub repository. Netlify should deploy automatically.

## Important limitations

AcresX provides preliminary screening only. Flood, wetland, parcel, utility, and well records may be incomplete or outdated. A mapped absence is not proof that a hazard or restriction is absent. Confirm findings with the responsible agency, county, utility, surveyor, wetland professional, and other qualified professionals before purchasing or developing land.


## v0.4.2 water-score update

The Water component of the beta Buildability Score now uses the average completed depth reported for up to the five closest recorded wells. Distances remain visible for each individual well in the results list and map popups. Wells without a reported completed depth are excluded from the average.


## v0.4.3 reliability fix
FEMA and NWI parcel screening now runs through a Netlify Function. This avoids browser cross-origin failures and converts GeoJSON parcel geometry into the Esri polygon format required by the agency services. The nearby-well result set now retains five wells for the five-well average.

## v0.5 zoning and permit intelligence

- Adds a county zoning-source panel and verification workflow.
- Adds a likely permit checklist covering building, septic, well/water, driveway access and critical-area review.
- Spokane County includes direct agency links; other counties use county-specific official-source searches until direct integrations are added.
- Zoning and permit results are screening guidance, not legal determinations or permit approvals.
