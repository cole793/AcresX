# Findings

Verified facts, decisions and gotchas, each with its source. Newest first.

## Oct 2026: project handoff from ChatGPT

- Most frontend modules are injected at request time by `maybeInjectUiPolish()` in
  `src/index.js:43`, not by `public/index.html`. A new `public/*.js` file must be added to that
  list to load.
- `src/index.js` handles new routes and falls back to the legacy `src/worker.js` router
  (`src/worker.js:464-476`) for anything else.
- The Worker modules import cleanly in Node 22, which is how the offline tests run.
- `.github/workflows/restore-index.yml` overwrites `public/index.html` from commit `bf6f4c4`. Not
  run since the handoff, and proposed for deletion.
- The repo contains no Netlify configuration. The Netlify checks on PRs come from a GitHub app
  installed on the account.
