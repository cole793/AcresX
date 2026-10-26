// Shared reading of the /api/hazards flood result for the page's labels and scores.
// Injected first by maybeInjectUiPolish() in src/index.js; index.html, parcel-preview.js,
// score-cost.js and screening-refinements.js call window.AcresXFlood at render time.
//
// source.emptyResult: FEMA was unreachable and the backup source (Esri USA Flood Hazard Areas,
// which only maps high- and moderate-risk areas) found nothing. That is not "no flood zone", so
// it is shown as limited data and scored like an unavailable result.
(function (root) {
  const BACKUP_PROVIDER = 'Esri USA Flood Hazard Areas';
  const LIMITED_LABEL = 'Limited flood data';
  const LIMITED_TEXT = 'Not in a mapped high- or moderate-risk flood area (backup source; FEMA unavailable). Verify with FEMA.';

  const isLimited = flood => flood?.available === true && flood?.source?.emptyResult === true;
  const isBackup = flood => flood?.source?.provider === BACKUP_PROVIDER;
  const backupSuffix = flood => (isBackup(flood) ? ' (backup source)' : '');

  // scores: { high, mapped, clear } for that consumer's scale; unavailable and limited give 50.
  function score(flood, scores) {
    if (!flood?.available || isLimited(flood)) return 50;
    return flood.high ? scores.high : flood.intersects ? scores.mapped : scores.clear;
  }

  root.AcresXFlood = { BACKUP_PROVIDER, LIMITED_LABEL, LIMITED_TEXT, isLimited, isBackup, backupSuffix, score };
})(typeof window !== 'undefined' ? window : globalThis);
