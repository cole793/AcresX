// Owner and mailing data must never be written to the Cache API (src/shared/upstream.js
// cachedJson). Layers queried with outFields '*' can carry it, so values that are cached are
// passed through withoutPersonalFields() before they are stored AND before they are returned,
// so a cache hit and a fresh answer look the same.
//
// The pattern matches owner, taxpayer and mailing-address field names seen on the county and
// state layers AcresX reads (statewide Idaho OWNER1/OWNER2/PUBLIC_STD/MAIL_*, IDWR OWNER,
// Montana OwnerName/OwnerAddress*, Yellowstone OWNER, Kootenai Owner_*/Recipient_*/
// DeliveryAddr_*/LastLine_*, Spokane owner_name/taxpayer_name). It is case-insensitive and
// anchored at the start, so it does not match zoning fields such as NAME or ZONE_NAME.
export const PERSONAL_FIELD = /^(owner|own_|ownr|taxpayer|mail|public_std|recipient|attentionline|deliveryaddr|lastline|(first|last|middle)name_|legalpartytype)/i;

// Deep copy of `value` with every object key matching PERSONAL_FIELD removed.
export function withoutPersonalFields(value, pattern = PERSONAL_FIELD) {
  if (Array.isArray(value)) return value.map(item => withoutPersonalFields(item, pattern));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) if (!pattern.test(key)) out[key] = withoutPersonalFields(item, pattern);
    return out;
  }
  return value;
}
