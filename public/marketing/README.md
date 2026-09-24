# AcresX marketing website draft

This folder contains a first-pass public marketing homepage at `public/marketing/index.html`. It uses the existing AcresX logo at `public/assets/acresx-logo.png` and favicon at `public/assets/favicon.png`. It does not alter the application homepage, Worker routing, database, scheduled jobs, or Cloudflare Access.

## Safe review
The marketing page is currently **only source code on the feature branch**. Do not change the production domain or remove Cloudflare Access to view it. The existing Cloudflare non-production branch build setting may trigger builds, so verify deployment history and keep any branch preview protected. A separate marketing-only Cloudflare project can later serve this page using an isolated static asset directory containing the marketing HTML and copies of the approved logo and favicon; do not point a new marketing project at the existing Worker entrypoint or D1 binding.

## Before launch
Replace the illustrative preview with a real approved app screenshot; supply approved sample report and testimonials; confirm beta access request destination; review data accuracy, geographic coverage and disclaimers; test mobile layout; configure separate marketing hostname and app hostname with explicit Access policies; confirm beta tester storage and links before any app hostname migration. The public marketing site must not expose app API endpoints or production D1 bindings.
