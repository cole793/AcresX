// Independent, read-only diagnostic for matched MLS infrastructure remarks.
// This file never calls the listing API, changes listing state, or updates cards.
(() => {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  function scan(remarks) {
    const text = normalize(remarks);
    const out = { well: [], septic: [], power: [] };
    if (!text) return out;
    const rules = {
      well: [
        ['well_count', /\b(?:property (?:has|includes|features) )?(one|two|three|four|five|[1-5]) (?:existing |private |drilled )?wells?\b/i],
        ['well_existing', /\b(?:existing|private|drilled|domestic) well\b|\bwell (?:is )?(?:installed|drilled|on (?:the )?property)\b/i],
        ['well_shared', /\b(?:shared|community) well\b/i],
        ['well_needed', /\b(?:buyer to drill|well (?:is )?needed|needs? (?:a )?well)\b/i]
      ],
      septic: [
        ['septic_installed', /\b(?:existing septic|septic (?:system )?(?:is )?(?:installed|in place)|installed septic)\b/i],
        ['perc_test', /\b(?:perc(?:olation)? test (?:is )?(?:approved|completed|done|passed)|approved perc|perc approved)\b/i],
        ['septic_needed', /\b(?:buyer to install septic|septic (?:is )?needed|needs? (?:a )?septic(?: system)?)\b/i]
      ],
      power: [
        ['power_connected', /\b(?:power|electric(?:ity)?) (?:is )?(?:connected|installed|hooked up|on (?:the )?property)|\bmeter (?:is )?installed\b/i],
        ['power_nearby', /\b(?:power|electric(?:ity)?) (?:is )?(?:at (?:the )?road|at (?:the )?property line|nearby|available nearby)\b/i],
        ['provider_inland', /\bInland Power(?:\s*(?:&|and)\s*Light)?\b/i],
        ['provider_avista', /\bAvista(?: Utilities)?\b/i],
        ['provider_vera', /\bVera (?:Water (?:and|&) )?Power\b/i]
      ]
    };
    for (const [category, patterns] of Object.entries(rules)) {
      for (const [claim, regex] of patterns) {
        const match = text.match(regex);
        if (match) out[category].push({ claim, phrase: match[0], source: 'MLS PublicRemarks', confidence: 'listing_reported' });
      }
    }
    return out;
  }
  let seen = null;
  function inspect() {
    try {
      const data = window.__acresxLast;
      const listing = data?.resoListings;
      if (!listing || listing === seen) return;
      seen = listing;
      const best = listing.best;
      const remarks = best?.publicRemarks || best?.PublicRemarks || '';
      const result = {
        status: best ? (remarks ? 'scanned' : 'matched_without_remarks') : 'no_match',
        listingId: best?.listingId || null,
        remarksLength: normalize(remarks).length,
        evidence: best ? scan(remarks) : { well: [], septic: [], power: [] }
      };
      window.__acresxMlsScannerDiagnostic = result;
      console.info('[AcresX MLS scanner diagnostic]', result);
    } catch (error) {
      console.warn('[AcresX MLS scanner diagnostic] scan failed', error);
    }
  }
  // Read-only Well detail annotation. Do not wrap listing lookup or dashboard renderers.
  function showWellEvidence() {
    try {
      const detail = document.getElementById('detailCard');
      const root = detail?.querySelector('.results-scroll');
      if (!root) return;
      const existing = root.querySelector('[data-mls-well-note]');
      const isWellOpen = detail.classList.contains('show') &&
        typeof activeTab !== 'undefined' && activeTab === 'wells';
      const data = window.__acresxLast;
      const listing = data?.resoListings;
      const remarks = listing?.best?.publicRemarks || listing?.best?.PublicRemarks || '';
      const claims = isWellOpen && remarks ? scan(remarks).well : [];
      if (!claims.length) {
        existing?.remove();
        return;
      }
      // Avoid presenting a listing statement as a verified on-parcel well.
      const signature = String(listing.best.listingId || '') + ':' + remarks;
      if (existing?.dataset.signature === signature) return;
      existing?.remove();
      const notice = document.createElement('div');
      notice.className = 'notice';
      notice.dataset.mlsWellNote = 'true';
      notice.dataset.signature = signature;
      const heading = document.createElement('strong');
      heading.textContent = 'LISTING REPORTED · Well';
      notice.appendChild(heading);
      const description = document.createElement('p');
      description.textContent = 'Matched listing description mentions: ' +
        claims.map(item => '“' + item.phrase + '”').join('; ') +
        '. Seller/broker statement only; confirm the well location, ownership, yield and records independently.';
      notice.appendChild(description);
      root.prepend(notice);
    } catch (error) {
      console.warn('[AcresX MLS scanner] Well note unavailable', error);
    }
  }
  window.__acresxScanMlsRemarks = scan;
  window.setInterval(() => { inspect(); showWellEvidence(); }, 750);
  inspect();
  showWellEvidence();
})();
