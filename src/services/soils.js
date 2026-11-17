// Soil screening at the parcel center (POST /api/land-analysis -> soil).
//
// Primary: USDA NRCS Soil Data Access (SDA), the dominant component of the SSURGO map unit.
// Backup: Esri Living Atlas "USA Soils Map Units", a hosted copy of USDA gSSURGO, asked only when
// SDA gave no answer (HTTP 5xx, timeout, network error, or a non-JSON outage page). An SDA "no map
// unit" answer or a 4xx is not an outage, so the backup is not asked then. Both answers have the
// same shape (below), so the septic card, score, cost model and report treat them alike; the
// backup's `source` says it is the backup, and it adds backup: true and fallbackFrom (SDA's error).
//   { available, mapUnit, component, componentPct, drainage, hydrologicGroup, soilSlopePct,
//     feasibility, source }  (+ backup answers: backup, fallbackFrom, septicRating, slopeRangePct,
//     sourceUrl, vintage)
// If both fail, soilAt throws (the soil layer only; land-analysis.js reports it unavailable).
// Caching (Cache API, keyed by the point rounded to 5 decimals, about 1 m): an SDA answer is kept
// for 30 days, like the terrain and canopy answers (SSURGO changes yearly). A backup answer is
// kept for a day only, under its own prefix, so an SDA outage does not send every repeat lookup to
// Esri; on an SDA cache miss SDA is always asked before the backup cache, so a recovery shows at
// once. Failures (outages, "no map unit", 4xx) are never cached.
import { upstreamJson, cachedJson } from '../shared/upstream.js';

const USDA_SOIL_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
export const SDA_SOURCE = 'USDA NRCS Soil Data Access';

// Esri Living Atlas "USA Soils Map Units" (item d4c54647dd4c4405a9f4f0bc9fd351e9, owner
// esri_landscapes, public, no key; the same ArcGIS Online org as the flood backup). Built from
// USDA gSSURGO, "Publication Date: December 2025", update frequency annual; data last edited
// 2026-09. Checked live 2026-11-17 while SDA answered 502: a point query at the Gallatin parcel
// 06069905302080000 returned Bavdark loam, 8 to 25 percent slopes, Well drained, group C, slope
// 17, the same values SDA gave in the 2026-11-15 validation run. Fields: muname, compname and
// comppct_r (dominant component), slopegraddcp (dominant component slope; slope_r is a weighted
// average), slope_l/slope_h, drclassdcd and hydgrpdcd (dominant condition, from muaggatt; SDA
// reads the dominant component's own drainagecl/hydgrp, which is the same class unless the
// minor components outweigh it), engstafdcd (septic tank absorption fields rating).
export const ESRI_SSURGO_LAYER = 'https://services5.arcgis.com/7weheFjxuNkGGiZi/arcgis/rest/services/USA_Soils_Map_Units/FeatureServer/0';
export const SOIL_BACKUP_SOURCE = 'USDA SSURGO via Esri Living Atlas (backup; USDA Soil Data Access unavailable)';
export const SOIL_BACKUP_VINTAGE = 'gSSURGO, published December 2025';
const BACKUP_FIELDS = 'MUKEY,muname,compname,comppct_r,drclassdcd,hydgrpdcd,slopegraddcp,slope_r,slope_l,slope_h,engstafdcd';
// A point answer is one feature (two on a map unit line; ~8 KB with the field descriptions ArcGIS
// Online adds). No resultRecordCount: with it, this layer took over 25 s to answer a point query
// (2026-11-17), against under 2 s without it.
export const SOIL_BACKUP_MAX_BYTES = 256 * 1024;
export const SOIL_BACKUP_TIMEOUT_MS = 8000;
export const SOIL_BACKUP_RETRY_TIMEOUT_MS = 4000;
// SDA's worst case is about 20.3 s; the backup gets what is left of this (the client and the
// validator wait 30 s), and is skipped when less than SOIL_BACKUP_MIN_MS is left.
export const SOIL_TOTAL_BUDGET_MS = 26000;
export const SOIL_BACKUP_MIN_MS = 2000;
export const SOIL_BACKUP_CACHE_PREFIX = 'https://acresx.internal/cache/soil-backup/v1/';
export const SOIL_BACKUP_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const SOIL_CACHE_PREFIX = 'https://acresx.internal/cache/soil/v1/';
export const SOIL_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
// ~1 m: the same parcel center gives the same key.
const pointKey = (x, y) => ({ x: Math.round(x * 1e5) / 1e5, y: Math.round(y * 1e5) / 1e5 });
// Was one 20 s attempt (headers only). Now 12 s + one retry at 8 s, both covering the body, so the
// worst case stays about 20 s.
export const SOIL_TIMEOUT_MS = 12000;
export const SOIL_RETRY_TIMEOUT_MS = 8000;

function classifyFeasibility({ drainage, hydrologicGroup, slopePct }) {
  const drainageText = String(drainage || '').toLowerCase();
  const hyd = String(hydrologicGroup || '').toUpperCase();
  const slope = Number(slopePct);

  if (/very poorly|poorly/.test(drainageText) || hyd.includes('D') || (Number.isFinite(slope) && slope > 15)) {
    return 'limited';
  }

  if (/well drained|somewhat excessively|excessively/.test(drainageText) && !hyd.includes('D') && (!Number.isFinite(slope) || slope <= 8)) {
    return 'favorable';
  }

  return 'moderate';
}

function parseSoilTable(table) {
  if (!Array.isArray(table) || table.length < 2 || !Array.isArray(table[0]) || !Array.isArray(table[1])) {
    throw new Error('No USDA soil map unit was returned.');
  }

  return Object.fromEntries(table[0].map((column, index) => [column, table[1][index]]));
}

// SDA failures the backup may answer for: the service is down or unreachable, not "no soil here".
export function isSdaOutage(error) {
  if (!error) return false;
  if (error.kind === 'timeout' || error.kind === 'network' || error.kind === 'json') return true;
  return error.kind === 'http' && Number(error.status) >= 500;
}

export async function soilAt(lon, lat, { ctx } = {}) {
  const x = Number(lon);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Valid longitude and latitude are required for USDA soil screening.');
  const started = Date.now();
  try {
    return await cachedJson(SOIL_CACHE_PREFIX, pointKey(x, y), SOIL_CACHE_TTL_SECONDS, () => sdaSoilAt(x, y), {
      isValid: answer => answer?.available === true && answer.backup !== true && answer.source === SDA_SOURCE, ctx
    });
  } catch (error) {
    if (!isSdaOutage(error?.upstream || error)) throw error;
    const remaining = SOIL_TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining < SOIL_BACKUP_MIN_MS) throw error;
    try {
      const answer = await backupSoilAt(x, y, remaining, ctx);
      return { ...answer, fallbackFrom: error.message };
    } catch (backupError) {
      throw new Error(`${error.message}; backup (Esri SSURGO copy): ${backupError?.message || backupError}`);
    }
  }
}

async function sdaSoilAt(x, y) {
  const point = `POINT(${x} ${y})`;
  const query = `
    SELECT TOP 1
      mu.mukey,
      mu.muname,
      c.compname,
      c.comppct_r,
      c.drainagecl,
      c.hydgrp,
      c.slope_r
    FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${point}') AS spatial
    INNER JOIN mapunit mu ON mu.mukey = spatial.mukey
    INNER JOIN component c ON c.mukey = mu.mukey
    ORDER BY c.comppct_r DESC
  `;

  let data;
  try {
    data = await upstreamJson(USDA_SOIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'query',
        request: 'query',
        query,
        format: 'JSON+COLUMNNAME'
      }),
      timeoutMs: SOIL_TIMEOUT_MS,
      retryTimeoutMs: SOIL_RETRY_TIMEOUT_MS,
      label: 'usda-sda-soil',
      agency: 'USDA soil service'
    });
  } catch (error) {
    // Same messages as before; `upstream` keeps the shared client's error for isSdaOutage().
    const fail = message => Object.assign(new Error(message), { upstream: error });
    if (error.kind === 'json') throw fail(`USDA soil service returned ${error.status} with an invalid response.`);
    if (error.kind === 'http') {
      const body = error.body;
      if (!body || typeof body !== 'object') throw fail(`USDA soil service returned ${error.status} with an invalid response.`);
      const upstream = body.error || body.message || body.Error || body.Messages?.[0];
      throw fail(upstream ? `USDA soil service: ${upstream}` : `USDA soil service returned ${error.status}.`);
    }
    throw error;
  }

  const row = parseSoilTable(data.Table);
  const slopePct = Number(row.slope_r);
  const drainage = row.drainagecl || '';
  const hydrologicGroup = row.hydgrp || '';

  return {
    available: true,
    mapUnit: row.muname || '',
    component: row.compname || '',
    componentPct: Number(row.comppct_r) || null,
    drainage,
    hydrologicGroup,
    soilSlopePct: Number.isFinite(slopePct) ? slopePct : null,
    feasibility: classifyFeasibility({ drainage, hydrologicGroup, slopePct }),
    source: SDA_SOURCE
  };
}

const numberOrNull = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

// Maps one Esri USA Soils Map Units feature to soilAt's shape.
export function mapBackupSoil(attributes) {
  const a = attributes || {};
  const slopePct = numberOrNull(a.slopegraddcp) ?? numberOrNull(a.slope_r);
  const drainage = a.drclassdcd || '';
  const hydrologicGroup = a.hydgrpdcd || '';
  const low = numberOrNull(a.slope_l), high = numberOrNull(a.slope_h);
  return {
    available: true,
    mapUnit: a.muname || '',
    component: a.compname || '',
    componentPct: numberOrNull(a.comppct_r) || null,
    drainage,
    hydrologicGroup,
    soilSlopePct: slopePct,
    feasibility: classifyFeasibility({ drainage, hydrologicGroup, slopePct }),
    source: SOIL_BACKUP_SOURCE,
    backup: true,
    // Context only: the grade above uses the same rule as the SDA answer.
    septicRating: a.engstafdcd || null,
    slopeRangePct: low !== null || high !== null ? { low, high } : null,
    sourceUrl: ESRI_SSURGO_LAYER,
    vintage: SOIL_BACKUP_VINTAGE
  };
}

async function queryBackup(x, y, remaining) {
  const timeoutMs = Math.min(SOIL_BACKUP_TIMEOUT_MS, remaining);
  const left = remaining - timeoutMs - 300;
  const retries = left >= SOIL_BACKUP_MIN_MS ? 1 : 0;
  const data = await upstreamJson(`${ESRI_SSURGO_LAYER}/query`, {
    params: {
      f: 'json', where: '1=1', geometry: `${x},${y}`, geometryType: 'esriGeometryPoint', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: BACKUP_FIELDS, returnGeometry: 'false'
    },
    arcgis: true, timeoutMs, retries, retryTimeoutMs: Math.min(SOIL_BACKUP_RETRY_TIMEOUT_MS, Math.max(left, 0)),
    maxBytes: SOIL_BACKUP_MAX_BYTES, label: 'esri-ssurgo-soil', agency: 'Esri SSURGO soil layer'
  });
  const attributes = data?.features?.[0]?.attributes;
  if (!attributes || !attributes.muname) throw new Error('No SSURGO map unit was returned.');
  return mapBackupSoil(attributes);
}

function backupSoilAt(x, y, remaining, ctx) {
  return cachedJson(SOIL_BACKUP_CACHE_PREFIX, pointKey(x, y), SOIL_BACKUP_CACHE_TTL_SECONDS, () => queryBackup(x, y, remaining), {
    isValid: answer => answer?.available === true && answer.backup === true, ctx
  });
}
