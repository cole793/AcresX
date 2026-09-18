// Read-only extraction of property infrastructure claims from matched MLS remarks.
// This module does not query MLS/D1, select listings, or alter Listing Context.

function cleanRemarks(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function evidence(type, claim, match, extra = {}) {
  return {
    type,
    claim,
    source: "MLS PublicRemarks",
    confidence: "listing_reported",
    phrase: match?.[0]?.trim() || null,
    ...extra,
  };
}

export function extractMlsInfrastructureEvidence(publicRemarks) {
  const text = cleanRemarks(publicRemarks);
  const out = { well: [], septic: [], power: [] };
  if (!text) return out;

  let m;

  // WELL — require language that describes an existing/reported property feature.
  const wellCount = text.match(/\b(?:property\s+(?:has|includes|features)\s+)?(one|two|three|four|five|[1-5])\s+(?:existing\s+|private\s+|drilled\s+)?wells?\b/i);
  if (wellCount) {
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const raw = wellCount[1].toLowerCase();
    out.well.push(evidence("well", "existing_well_reported", wellCount, {
      count: words[raw] || Number(raw) || null,
    }));
  } else if ((m = text.match(/\b(?:existing|private|drilled|domestic)\s+well\b|\bwell\s+(?:is\s+)?(?:installed|drilled|on\s+(?:the\s+)?property)\b/i))) {
    out.well.push(evidence("well", "existing_well_reported", m));
  }

  if ((m = text.match(/\b(?:shared|community)\s+well\b/i))) {
    out.well.push(evidence("well", "shared_or_community_well_reported", m));
  }
  if ((m = text.match(/\b(?:buyer\s+to\s+drill|well\s+(?:is\s+)?needed|needs?\s+(?:a\s+)?well)\b/i))) {
    out.well.push(evidence("well", "well_needed_reported", m));
  }

  // SEPTIC — keep installed systems separate from perc/approval claims.
  if ((m = text.match(/\b(?:existing\s+septic|septic\s+(?:system\s+)?(?:is\s+)?(?:installed|in\s+place)|installed\s+septic)\b/i))) {
    out.septic.push(evidence("septic", "septic_installed_reported", m));
  }
  if ((m = text.match(/\b(?:perc(?:olation)?\s+test\s+(?:is\s+)?(?:approved|completed|done|passed)|approved\s+perc|perc\s+approved)\b/i))) {
    out.septic.push(evidence("septic", "perc_evidence_reported", m));
  }
  if ((m = text.match(/\b(?:buyer\s+to\s+install\s+septic|septic\s+(?:is\s+)?needed|needs?\s+(?:a\s+)?septic(?:\s+system)?)\b/i))) {
    out.septic.push(evidence("septic", "septic_needed_reported", m));
  }

  // POWER — distinguish connected/on-property from merely nearby.
  if ((m = text.match(/\b(?:power|electric(?:ity)?)\s+(?:is\s+)?(?:connected|installed|hooked\s+up|on\s+(?:the\s+)?property)|\bmeter\s+(?:is\s+)?installed\b/i))) {
    out.power.push(evidence("power", "power_on_property_reported", m));
  } else if ((m = text.match(/\b(?:power|electric(?:ity)?)\s+(?:is\s+)?(?:at\s+(?:the\s+)?road|at\s+(?:the\s+)?property\s+line|nearby|available\s+nearby)\b/i))) {
    out.power.push(evidence("power", "power_nearby_reported", m));
  }

  const providers = [
    ["Inland Power", /\bInland\s+Power(?:\s*(?:&|and)\s*Light)?\b/i],
    ["Avista Utilities", /\bAvista(?:\s+Utilities)?\b/i],
    ["Vera Water and Power", /\bVera\s+(?:Water\s+(?:and|&)\s+)?Power\b/i],
  ];
  for (const [provider, re] of providers) {
    const pm = text.match(re);
    if (pm) {
      out.power.push(evidence("power", "power_provider_reported", pm, { provider }));
      break;
    }
  }

  return out;
}
