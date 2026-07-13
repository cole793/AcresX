# AcresX v0.4 — Interactive Property Map

Washington land-intelligence screening dashboard.

## New in v0.4

- Interactive parcel map with highlighted parcel boundary
- Street and satellite basemaps
- Toggle selected parcel and nearby recorded wells
- Click parcel or well markers for details
- Fit-to-parcel control
- Full-screen map mode
- Responsive mobile map controls
- Existing parcel, well, likely utility-provider, and listing-evidence tools retained

## Deploy on GitHub + Netlify

Upload the contents of this folder to the root of the AcresX GitHub repository, preserving this structure:

```
index.html
README.md
netlify.toml
assets/
  acresx-logo.png
  favicon.png
netlify/
  functions/
    listing-evidence.js
```

Netlify should redeploy automatically after the GitHub commit.

## Important

AcresX is a preliminary public-record screening tool. Parcel boundaries, well records, utility territories, and listing statements must be verified with the applicable county, agency, utility, seller, or licensed professional before purchasing or developing land.
