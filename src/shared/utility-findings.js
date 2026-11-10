// Small helpers the county public-utility tables (src/counties/*-utilities.js) use to turn layer
// attributes into findings for src/services/public-utilities.js:
//   { service: 'water' | 'sewer', status: 'served' | 'likely', provider, basis, asOf? }

const text = value => (value == null ? '' : String(value).replace(/\s+/g, ' ').trim());

export const SERVICE_LABEL = { water: 'water', sewer: 'sewer' };

// Inside city/town limits where that city publishes no map for a utility: "likely" for each
// service in `unmapped`. Cities that publish one are decided by their own map instead. Every
// call also returns a { service: null, inCity } marker: a district polygon counts as served only
// inside city limits (src/services/public-utilities.js cityLimitsRule).
export function cityLimitsFindings(cityName, unmapped) {
  if (!cityName) return [];
  return [
    { service: null, inCity: cityName },
    ...unmapped.map(service => ({
      service, status: 'likely', provider: cityName,
      basis: `inside ${cityName} limits; no ${service} utility map published`
    }))
  ];
}

// A district / service-area polygon: "served" for each service, named.
export function districtFindings(services, provider, basis, extra = {}) {
  const name = text(provider);
  if (!name) return [];
  return services.map(service => ({ service, status: 'served', provider: name, basis, ...extra }));
}

// A polygon layer's date (DataSourceDate, LastUpdate) is reported as asOf once it is older than this.
export const STALE_AFTER_DAYS = 730;

// Date (ms or 'YYYY-MM-DD') -> 'YYYY-MM-DD' when older than STALE_AFTER_DAYS, else undefined.
export function staleDate(value, now = Date.now()) {
  const ms = typeof value === 'number' ? value : Date.parse(text(value));
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return now - ms > STALE_AFTER_DAYS * 86400000 ? new Date(ms).toISOString().slice(0, 10) : undefined;
}

export const titleCase = value => text(value).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
export { text };
