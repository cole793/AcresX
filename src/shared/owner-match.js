// Owner-name comparison for the existing-well match (src/services/existing-well.js for Spokane,
// src/services/existing-well-montana.js for Montana). Names are compared here and only the result
// (a similarity, a yes/no) leaves; the names themselves are never returned, logged or cached
// (owner rule, 2026-11-18: owner names may be used internally to improve accuracy, never shown).

export function normName(value) {
  return String(value || '').toUpperCase()
    .replace(/\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|CO|TRUST|TRUSTEE|ET AL|ESTATE)\b/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function nameTokens(value) { return normName(value).split(' ').filter(token => token.length > 1); }

// Shared tokens over all tokens, plus 0.15 when the first token of `a` (usually the surname on
// assessor records) appears in `b`. 0..1.
export function nameSimilarity(a, b) {
  const aa = nameTokens(a), bb = nameTokens(b); if (!aa.length || !bb.length) return 0;
  const setA = new Set(aa), setB = new Set(bb); const shared = [...setA].filter(token => setB.has(token)).length; const union = new Set([...aa, ...bb]).size;
  const surnameBoost = aa[0] && bb.includes(aa[0]) ? 0.15 : 0; return Math.min(1, (union ? shared / union : 0) + surnameBoost);
}
