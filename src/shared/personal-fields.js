// Owner names and mailing addresses are never requested, returned, shown or written to the
// Cache API (owner decision, 2026-10-29). Queries name the fields they need where the layer's
// fields are known; anything that still passes upstream attributes through (outFields '*'
// layers, legacy src/worker.js routes) goes through withoutPersonalFields() before it is stored
// AND before it is returned, so a cache hit and a fresh answer look the same.
//
// The pattern matches owner, taxpayer and mailing-address field names seen on the county and
// state layers AcresX reads (statewide Idaho OWNER1/OWNER2/PUBLIC_STD/MAIL_*, IDWR OWNER,
// Montana OwnerName/OwnerAddress*/CareOfTaxpayer, Yellowstone OWNER/OWNER_NAME/MAILADDRESS*,
// WA Ecology wells OwnerName, Kootenai Owner_*/Recipient_*/
// DeliveryAddr_*/LastLine_*, Spokane owner_name/taxpayer_name). It is case-insensitive and
// anchored at the start, so it does not match zoning fields such as NAME or ZONE_NAME.
export const PERSONAL_FIELD = /^(owner|own_|ownr|taxpayer|careof|mail|public_std|recipient|attentionline|deliveryaddr|lastline|(first|last|middle)name_|legalpartytype)/i;

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

// A JSON Response with personal fields removed from its body; same status and headers.
// Anything that is not JSON is returned unchanged.
export async function responseWithoutPersonalFields(response, pattern = PERSONAL_FIELD) {
  if (!/application\/json/i.test(response.headers.get('Content-Type') || '')) return response;
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { return new Response(text, response); }
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(JSON.stringify(withoutPersonalFields(body, pattern)), { status: response.status, statusText: response.statusText, headers });
}
