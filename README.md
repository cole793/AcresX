# AcresX v0.3.1 — Utility & Listing Evidence

Changes in this release:

- Removed mapped power-distance estimates and power-map overlays.
- Retained the likely electric utility from Washington utility territory data.
- Added automatic public-web listing evidence for statements such as “power at the road,” “power onsite,” “meter installed,” and “off-grid.”
- Added source links, extracted evidence text, confidence labels, and a utility-verification disclaimer.
- Updated the beta Buildability Score so it no longer uses mapped power distance.

## Activate automatic listing evidence

The dashboard is ready to call a Netlify Function, but the web-search API requires credentials. In Netlify, open **Site configuration → Environment variables** and add:

- `GOOGLE_SEARCH_API_KEY` — Google Custom Search JSON API key
- `GOOGLE_SEARCH_ENGINE_ID` — Programmable Search Engine ID configured to search the entire web

Then trigger a new Netlify deploy. The keys stay server-side and are not exposed in `index.html`. Without these variables, every other dashboard feature works and the listing-evidence panel displays “Search not configured.”

## Important

Listing evidence is unverified seller/broker language. AcresX does not confirm that service is actually available, that a transformer is usable, or what an extension will cost. Confirm directly with the likely serving utility.
