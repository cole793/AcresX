# AcresX v0.6 — Automatic Listing Context

## Files
Replace the deployed versions of:
- `index.html`
- `worker.js`

Keep your existing `zoning-counties.js` and `assets/` directory.

## Search provider configuration
Set one of the following in Cloudflare Worker/Pages environment variables.

### Recommended: Serper
Secret:
- `SERPER_API_KEY`

### Existing Google Custom Search setup
Secrets:
- `GOOGLE_SEARCH_API_KEY`
- `GOOGLE_SEARCH_ENGINE_ID`

The worker tries Serper first and falls back to Google Custom Search.

## What changed
- Parcel number remains the only property input.
- The situs address returned by the parcel record is searched automatically.
- Results are ranked using parcel number, street number, street name, ZIP and county signals.
- Weak matches are rejected.
- Claims are categorized as Power, Water, Septic, Access, Site work, Survey, Restrictions, Financing, Improvements or Utilities.
- Listing claims are clearly separated from official/public data and do not affect the buildability score.

## Deployment
After replacing the files, redeploy the site and Worker. Test with:
1. an actively listed parcel;
2. a recently sold parcel;
3. a parcel with no listing;
4. a parcel without a situs address;
5. an address with multiple nearby listings.
