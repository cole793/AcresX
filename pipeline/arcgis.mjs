// Bulk ArcGIS REST reads for the parcel list (docs/explore-index.md section 2, "Pull plan"):
// count, page by OBJECTID, and attribute/outline lookups by id list. Named fields only (never
// owner or mailing fields), form POSTs (id lists make long queries), retries with backoff, and a
// polite pause between pages. Requests go through globalThis.fetch, so pipeline/runtime.mjs adds
// the job's User-Agent and counts them.
import { PAGE_RETRIES, PAGE_RETRY_BACKOFF_MS, PAGE_DELAY_MS } from './config.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const retry = { retries: PAGE_RETRIES, backoffMs: PAGE_RETRY_BACKOFF_MS };
// Tests only: shorter retries.
export function setPageRetry({ retries, backoffMs }) { retry.retries = retries; retry.backoffMs = backoffMs; }

export async function queryJson(layerUrl, params, { retries = retry.retries, backoffMs = retry.backoffMs, timeoutMs = 60000, label = 'query' } = {}) {
  const body = new URLSearchParams({ f: 'json', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${layerUrl}/query`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`${label}: invalid JSON`); }
      if (data?.error) throw new Error(`${label}: ${data.error.message || 'query error'}${data.error.details?.length ? ` (${data.error.details.join('; ')})` : ''}`);
      return data;
    } catch (error) {
      lastError = error?.name === 'AbortError' ? new Error(`${label}: timed out after ${Math.round(timeoutMs / 1000)} s`) : error;
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

export async function countRows(layerUrl, where = '1=1', options = {}) {
  const data = await queryJson(layerUrl, { where, returnCountOnly: 'true' }, options);
  return Number(data?.count) || 0;
}

// Every row of the layer (attributes only unless returnGeometry), in OBJECTID order.
// onPage({ rows, offset }) is called per page.
export async function pageAll(layerUrl, { where = '1=1', outFields, pageSize = 2000, returnGeometry = false, outSR, delayMs = PAGE_DELAY_MS, label = 'page', onPage, maxRows = Infinity } = {}) {
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const data = await queryJson(layerUrl, {
      where, outFields, orderByFields: 'OBJECTID', resultOffset: offset, resultRecordCount: pageSize,
      returnGeometry: returnGeometry ? 'true' : 'false', ...(outSR ? { outSR } : {})
    }, { label: `${label} @${offset}` });
    const features = Array.isArray(data?.features) ? data.features : [];
    rows.push(...features);
    onPage?.({ rows: features, offset });
    if (features.length < pageSize && !data?.exceededTransferLimit) break;
    if (!features.length) break;
    if (delayMs) await sleep(delayMs);
  }
  return rows;
}

// SQL string literal for an id from a county layer (ids are digits and dots for Spokane; any
// quote is doubled anyway).
export const sqlString = v => `'${String(v).replace(/'/g, "''")}'`;
