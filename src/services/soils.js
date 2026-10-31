import { upstreamJson } from '../shared/upstream.js';

const USDA_SOIL_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
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

export async function soilAt(lon, lat) {
  const x = Number(lon);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Valid longitude and latitude are required for USDA soil screening.');

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
    if (error.kind === 'json') throw new Error(`USDA soil service returned ${error.status} with an invalid response.`);
    if (error.kind === 'http') {
      const body = error.body;
      if (!body || typeof body !== 'object') throw new Error(`USDA soil service returned ${error.status} with an invalid response.`);
      const upstream = body.error || body.message || body.Error || body.Messages?.[0];
      throw new Error(upstream ? `USDA soil service: ${upstream}` : `USDA soil service returned ${error.status}.`);
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
    source: 'USDA NRCS Soil Data Access'
  };
}
