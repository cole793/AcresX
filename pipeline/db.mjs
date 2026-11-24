// The local SQLite copy of the index (node:sqlite), with the D1 schema as is:
// migrations-index/0001_parcel_index.sql. Writing to D1 comes later (docs/explore-index.md
// section 5); every write here is an upsert keyed like the D1 tables, and rows whose content did
// not change are not written again (change hash), so the same logic carries over to D1's
// rows-written budget.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const MIGRATION = new URL('../migrations-index/0001_parcel_index.sql', import.meta.url);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

export const PARCEL_COLUMNS = [
  'county_key', 'parcel_id', 'parcel_id_norm', 'state', 'index_status', 'stale', 'stale_reason', 'inclusion_reason',
  'lat', 'lng', 'bbox_min_lat', 'bbox_min_lng', 'bbox_max_lat', 'bbox_max_lng', 'situs_city',
  'acres', 'acres_source', 'in_city', 'city_name',
  'zoning_code', 'zoning_name', 'zoning_jurisdiction', 'zoning_status', 'home_allowed', 'home_allowed_status', 'manufactured_home_allowed', 'manufactured_home_status',
  'flood_share_pct', 'flood_high', 'flood_zones', 'wetlands_pct', 'wetlands_category',
  'slope_mean_pct', 'slope_median_pct', 'slope_p90_pct', 'slope_max_pct', 'buildable_acres', 'buildable_status', 'homesite_slope_pct',
  'septic_grade', 'soil_drainage', 'soil_hydro_group', 'well_depth_ft', 'well_depth_low_ft', 'well_depth_high_ft', 'well_confidence', 'well_count',
  'public_water', 'public_sewer', 'power_provider', 'power_territory_confirmed', 'power_line_distance_ft', 'power_line_source', 'road_distance_ft', 'road_public',
  'property_class', 'improved', 'assessed_land', 'assessed_improvements', 'assessed_total', 'assessment_year', 'tax_total', 'tax_year', 'tax_basis',
  'score', 'score_band', 'score_rating', 'score_factors_measured', 'score_provisional', 'score_why', 'score_factors_json', 'score_version', 'layers_missing',
  'cost_low', 'cost_central', 'cost_high', 'listing_key', 'listing_status', 'list_price', 'listing_synced_at',
  'source_hash', 'first_seen_at', 'pulled_at', 'scored_at', 'run_id'
];
// Bookkeeping columns left out of the content hash.
const BOOKKEEPING = new Set(['first_seen_at', 'pulled_at', 'scored_at', 'run_id']);
export const contentHash = row => hash(PARCEL_COLUMNS.filter(c => !BOOKKEEPING.has(c)).map(c => row[c] ?? null));

export function openIndexDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(MIGRATION, 'utf8'));
  return wrap(db);
}

function wrap(db) {
  const placeholders = n => Array.from({ length: n }, () => '?').join(', ');
  const upsertParcel = db.prepare(`INSERT INTO parcels (${PARCEL_COLUMNS.join(', ')}) VALUES (${placeholders(PARCEL_COLUMNS.length)})
    ON CONFLICT(county_key, parcel_id) DO UPDATE SET ${PARCEL_COLUMNS.filter(c => !['county_key', 'parcel_id', 'first_seen_at'].includes(c)).map(c => `${c} = excluded.${c}`).join(', ')}`);
  const touchParcel = db.prepare('UPDATE parcels SET pulled_at = ?, scored_at = ?, run_id = ?, stale = 0, stale_reason = NULL, index_status = \'active\' WHERE county_key = ? AND parcel_id = ?');
  const getParcel = db.prepare('SELECT * FROM parcels WHERE county_key = ? AND parcel_id = ?');
  const getInputs = db.prepare('SELECT * FROM parcel_inputs WHERE county_key = ? AND parcel_id = ?');
  const getLayers = db.prepare('SELECT * FROM parcel_layers WHERE county_key = ? AND parcel_id = ?');
  const getShape = db.prepare('SELECT geojson FROM parcel_shapes WHERE county_key = ? AND parcel_id = ?');
  const upsertLayer = db.prepare(`INSERT INTO parcel_layers (county_key, parcel_id, layer, status, source, source_version, backup, error, fetched_at, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(county_key, parcel_id, layer) DO UPDATE SET status = excluded.status, source = excluded.source,
    source_version = excluded.source_version, backup = excluded.backup, error = excluded.error, fetched_at = excluded.fetched_at, run_id = excluded.run_id`);
  const upsertShape = db.prepare(`INSERT INTO parcel_shapes (county_key, parcel_id, geojson, tolerance_m, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(county_key, parcel_id) DO UPDATE SET geojson = excluded.geojson, tolerance_m = excluded.tolerance_m, updated_at = excluded.updated_at`);
  const upsertInputs = db.prepare(`INSERT INTO parcel_inputs (county_key, parcel_id, inputs_json, inputs_version, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(county_key, parcel_id) DO UPDATE SET inputs_json = excluded.inputs_json, inputs_version = excluded.inputs_version, updated_at = excluded.updated_at`);
  const insertRun = db.prepare(`INSERT INTO index_runs (run_id, county_key, shard, mode, status, started_at, git_sha, score_version, rules_json, min_acres)
    VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`);
  const finishRun = db.prepare(`UPDATE index_runs SET status = ?, finished_at = ?, pulled_count = ?, included_count = ?, scored_count = ?, partial_count = ?,
    removed_count = ?, excluded_json = ?, layer_failures_json = ?, notes = ? WHERE run_id = ?`);
  const setMeta = db.prepare(`INSERT INTO index_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);

  const writes = { parcels: 0, parcelsTouched: 0, layers: 0, layersUnchanged: 0, shapes: 0, shapesUnchanged: 0, inputs: 0, inputsUnchanged: 0 };
  const layerKey = l => hash([l.status, l.source ?? null, l.sourceVersion ?? null, l.backup ?? null, l.error ?? null]);

  return {
    raw: db, writes,
    getParcel: (county, id) => getParcel.get(county, id) || null,
    getInputs: (county, id) => getInputs.get(county, id) || null,
    getLayers: (county, id) => getLayers.all(county, id),
    // Everything for one parcel in one transaction; unchanged rows are not rewritten.
    writeParcel({ row, layers, shape, inputs, inputsVersion, now, runId }) {
      db.exec('BEGIN');
      try {
        const existing = getParcel.get(row.county_key, row.parcel_id);
        if (existing && contentHash(existing) === contentHash(row)) { touchParcel.run(row.pulled_at, row.scored_at, runId, row.county_key, row.parcel_id); writes.parcelsTouched++; }
        else { upsertParcel.run(...PARCEL_COLUMNS.map(c => (c === 'first_seen_at' && existing ? existing.first_seen_at : row[c] ?? null))); writes.parcels++; }

        const before = new Map(getLayers.all(row.county_key, row.parcel_id).map(l => [l.layer, layerKey({ status: l.status, source: l.source, sourceVersion: l.source_version, backup: l.backup, error: l.error })]));
        // A layer row whose status, source and error are unchanged keeps its fetched_at (the
        // first time that answer was seen) and is not written again.
        for (const [layer, l] of Object.entries(layers)) {
          if (before.get(layer) === layerKey(l)) { writes.layersUnchanged++; continue; }
          upsertLayer.run(row.county_key, row.parcel_id, layer, l.status, l.source ?? null, l.sourceVersion ?? null, l.backup ?? null, l.error ?? null, now, runId);
          writes.layers++;
        }

        if (shape) {
          const old = getShape.get(row.county_key, row.parcel_id);
          if (old?.geojson === shape.geojson) writes.shapesUnchanged++;
          else { upsertShape.run(row.county_key, row.parcel_id, shape.geojson, shape.toleranceM, now); writes.shapes++; }
        }
        if (inputs) {
          const json = JSON.stringify(inputs);
          const old = getInputs.get(row.county_key, row.parcel_id);
          if (old?.inputs_json === json && old.inputs_version === inputsVersion) writes.inputsUnchanged++;
          else { upsertInputs.run(row.county_key, row.parcel_id, json, inputsVersion, now); writes.inputs++; }
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    // Score-only update (mode 'rescore'): the stored inputs through a newer score core.
    updateScore(county, id, columns, now, runId) {
      const sets = Object.keys(columns).map(c => `${c} = ?`).join(', ');
      db.prepare(`UPDATE parcels SET ${sets}, scored_at = ?, run_id = ? WHERE county_key = ? AND parcel_id = ?`).run(...Object.values(columns), now, runId, county, id);
    },
    startRun({ runId, county, shard, mode, startedAt, gitSha, scoreVersion, rulesJson, minAcres }) {
      insertRun.run(runId, county, shard ?? null, mode, startedAt, gitSha, scoreVersion, rulesJson, minAcres);
    },
    finishRun({ runId, status, finishedAt, pulled, included, scored, partial, removed, excluded, layerFailures, notes }) {
      finishRun.run(status, finishedAt, pulled ?? null, included ?? null, scored ?? null, partial ?? null, removed ?? null, JSON.stringify(excluded || {}), JSON.stringify(layerFailures || {}), notes ?? null, runId);
    },
    lastRun: county => db.prepare("SELECT * FROM index_runs WHERE county_key = ? AND status IN ('succeeded','partial') ORDER BY started_at DESC LIMIT 1").get(county) || null,
    activeIds: county => db.prepare("SELECT parcel_id FROM parcels WHERE county_key = ? AND index_status = 'active'").all(county).map(r => r.parcel_id),
    markRemoved(county, ids, now) {
      const stmt = db.prepare("UPDATE parcels SET index_status = 'removed', pulled_at = ? WHERE county_key = ? AND parcel_id = ?");
      db.exec('BEGIN'); try { for (const id of ids) stmt.run(now, county, id); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    setMeta: (key, value, now) => setMeta.run(key, JSON.stringify(value), now),
    sample(county, n, where = '') {
      return db.prepare(`SELECT parcel_id FROM parcels WHERE county_key = ? AND index_status = 'active' AND score IS NOT NULL ${where} ORDER BY random() LIMIT ?`).all(county, n).map(r => r.parcel_id);
    },
    close: () => db.close()
  };
}
