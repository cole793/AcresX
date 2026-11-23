-- Parcel search index ("Explore"), database acresx-index, binding INDEX_DB.
-- Design: docs/explore-index.md. Not the MLS database (migrations/ is acresx-mls).
-- Written by the scheduled GitHub Actions index job only; the Worker reads it.
-- Every column filled from an upstream layer is NULL when that layer did not answer
-- (degraded-layer rule); parcel_layers says why. Booleans are 0/1, NULL = unknown.
-- Owner names, mailing addresses and other personal free text are never stored here.

-- One row per index run (or per county shard of a run).
CREATE TABLE IF NOT EXISTS index_runs (
  run_id TEXT PRIMARY KEY,                 -- e.g. '2026-12-01T08:00Z-spokane-0of4'
  county_key TEXT NOT NULL,                -- 'spokane' | 'stevens' | 'kootenai' | 'yellowstone' | 'gallatin'
  shard TEXT,                              -- '0/4'; NULL for an unsharded run
  mode TEXT NOT NULL CHECK (mode IN ('full', 'incremental', 'rescore', 'pull_only')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'stopped')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  git_sha TEXT NOT NULL,
  score_version TEXT NOT NULL,             -- SCORE_RULES_VERSION of the score core used
  rules_json TEXT,                         -- every rules/cache version used (well terrain, zoning tables, ...)
  min_acres REAL NOT NULL,                 -- INCLUDE_MIN_ACRES used by the inclusion rule
  pulled_count INTEGER,                    -- parcels read from the county parcel layer
  included_count INTEGER,
  scored_count INTEGER,
  partial_count INTEGER,                   -- scored with at least one layer missing
  removed_count INTEGER,
  excluded_json TEXT,                      -- {"city_small":123,"condo":4,...}
  layer_failures_json TEXT,                -- {"flood":3,"wetlands":0,...}
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_county ON index_runs(county_key, started_at);

-- One row per included parcel: the typed columns Explore filters and sorts on.
CREATE TABLE IF NOT EXISTS parcels (
  county_key TEXT NOT NULL,
  parcel_id TEXT NOT NULL,                 -- as the county writes it (35204.2729, C72150030040)
  parcel_id_norm TEXT NOT NULL,            -- upper case, letters and digits only
  state TEXT NOT NULL CHECK (state IN ('WA', 'ID', 'MT')),
  index_status TEXT NOT NULL DEFAULT 'active' CHECK (index_status IN ('active', 'removed')),
  stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
  stale_reason TEXT,                       -- 'age' | 'score_version' | 'rules_version' | 'source_changed'
  inclusion_reason TEXT NOT NULL CHECK (inclusion_reason IN ('rural_acreage', 'rural_improved', 'rural_vacant_small', 'city_acreage')),

  -- Location: interior point (the report's zoningPoint) for pins, and the outline's bbox.
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  bbox_min_lat REAL,
  bbox_min_lng REAL,
  bbox_max_lat REAL,
  bbox_max_lng REAL,
  situs_city TEXT,                         -- site address city/locality from the parcel layer

  -- Size and jurisdiction
  acres REAL NOT NULL,                     -- the acres the report headlines
  acres_source TEXT,                       -- 'assessor' | 'gis_outline'
  in_city INTEGER CHECK (in_city IN (0, 1)),
  city_name TEXT,

  -- Zoning
  zoning_code TEXT,
  zoning_name TEXT,
  zoning_jurisdiction TEXT,
  zoning_status TEXT,                      -- the adapter's status: gis_match, no_match, city_jurisdiction, unavailable, ...
  home_allowed INTEGER CHECK (home_allowed IN (0, 1)),
  home_allowed_status TEXT CHECK (home_allowed_status IN ('permitted', 'limited', 'conditional', 'not_permitted', 'not_mapped')),
  manufactured_home_allowed INTEGER CHECK (manufactured_home_allowed IN (0, 1)),
  manufactured_home_status TEXT CHECK (manufactured_home_status IN ('permitted', 'limited', 'conditional', 'not_permitted', 'not_mapped')),

  -- Hazards
  flood_share_pct REAL,                    -- SFHA share of the parcel (flood-share.js sfhaSharePct)
  flood_high INTEGER CHECK (flood_high IN (0, 1)),
  flood_zones TEXT,                        -- comma list, largest first ('AE,X')
  wetlands_pct REAL,
  wetlands_category TEXT,                  -- present | nearby | none | unmeasured

  -- Terrain and buildable area
  slope_mean_pct REAL,                     -- the score's gradePct
  slope_median_pct REAL,
  slope_p90_pct REAL,
  slope_max_pct REAL,
  buildable_acres REAL,
  buildable_status TEXT,                   -- measured | partial | unavailable
  homesite_slope_pct REAL,

  -- Septic, water, utilities, access
  septic_grade TEXT CHECK (septic_grade IN ('favorable', 'moderate', 'limited')),
  soil_drainage TEXT,
  soil_hydro_group TEXT,
  well_depth_ft REAL,
  well_depth_low_ft REAL,
  well_depth_high_ft REAL,
  well_confidence TEXT,                    -- moderate | low
  well_count INTEGER,
  public_water TEXT,                       -- served | likely | none | unavailable
  public_sewer TEXT,
  power_provider TEXT,
  power_territory_confirmed INTEGER CHECK (power_territory_confirmed IN (0, 1)),
  power_line_distance_ft REAL,
  power_line_source TEXT,
  road_distance_ft REAL,
  road_public INTEGER CHECK (road_public IN (0, 1)),

  -- Assessment and tax (values only)
  property_class TEXT,
  improved INTEGER CHECK (improved IN (0, 1)),
  assessed_land REAL,
  assessed_improvements REAL,
  assessed_total REAL,
  assessment_year INTEGER,
  tax_total REAL,
  tax_year INTEGER,
  tax_basis TEXT,                          -- billed | estimate

  -- Score: the report's AcresXScore.calculate on the same inputs. Never fed by listing data.
  score REAL,                              -- 0-10, NULL when not scored
  score_band TEXT,                         -- Excellent | Good | Moderate | Challenging
  score_rating TEXT,                       -- band, 'Provisional' or 'Not scored'
  score_factors_measured INTEGER,          -- of 7
  score_provisional INTEGER CHECK (score_provisional IN (0, 1)),
  score_why TEXT,
  score_factors_json TEXT,                 -- {"water":{"score":92,"measured":true},...}
  score_version TEXT,
  layers_missing TEXT,                     -- comma list of layer keys not ok/none ('flood,wetlands')

  -- Optional cost estimate (AcresXCostModel.estimate)
  cost_low REAL,
  cost_central REAL,
  cost_high REAL,

  -- Listing context, copied from acresx-mls. Filter/display only, never a score input.
  listing_key TEXT,
  listing_status TEXT,
  list_price REAL,
  listing_synced_at TEXT,

  -- Bookkeeping
  source_hash TEXT NOT NULL,               -- hash of id, acres, outline, assessor values: change detection
  first_seen_at TEXT NOT NULL,
  pulled_at TEXT NOT NULL,                 -- last time the parcel layer listed it
  scored_at TEXT,
  run_id TEXT,                             -- the run that last scored it

  PRIMARY KEY (county_key, parcel_id)
);
CREATE INDEX IF NOT EXISTS idx_parcels_norm ON parcels(county_key, parcel_id_norm);
CREATE INDEX IF NOT EXISTS idx_parcels_acres ON parcels(county_key, acres);
CREATE INDEX IF NOT EXISTS idx_parcels_buildable ON parcels(county_key, buildable_acres);
CREATE INDEX IF NOT EXISTS idx_parcels_slope_max ON parcels(county_key, slope_max_pct);
CREATE INDEX IF NOT EXISTS idx_parcels_slope_median ON parcels(county_key, slope_median_pct);
CREATE INDEX IF NOT EXISTS idx_parcels_flood ON parcels(county_key, flood_share_pct);
CREATE INDEX IF NOT EXISTS idx_parcels_mh ON parcels(county_key, manufactured_home_allowed, acres);
CREATE INDEX IF NOT EXISTS idx_parcels_improved ON parcels(county_key, improved, acres);
CREATE INDEX IF NOT EXISTS idx_parcels_score ON parcels(county_key, score);
CREATE INDEX IF NOT EXISTS idx_parcels_price ON parcels(county_key, list_price) WHERE list_price IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parcels_latlng ON parcels(lat, lng);
CREATE INDEX IF NOT EXISTS idx_parcels_refresh ON parcels(county_key, stale, scored_at);

-- Simplified outline per parcel (GeoJSON Polygon/MultiPolygon text, ~5 m tolerance, 6 decimals),
-- read only to draw parcels or compare; kept out of `parcels` so filter queries stay narrow.
CREATE TABLE IF NOT EXISTS parcel_shapes (
  county_key TEXT NOT NULL,
  parcel_id TEXT NOT NULL,
  geojson TEXT NOT NULL,
  tolerance_m REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (county_key, parcel_id),
  FOREIGN KEY (county_key, parcel_id) REFERENCES parcels(county_key, parcel_id) ON DELETE CASCADE
);

-- Status of each data layer per parcel (the degraded-layer rule and source timestamps).
CREATE TABLE IF NOT EXISTS parcel_layers (
  county_key TEXT NOT NULL,
  parcel_id TEXT NOT NULL,
  layer TEXT NOT NULL,                     -- parcel, city_limits, zoning, zoning_rules, flood, wetlands, land, slope,
                                           -- buildable, wells, well_terrain, public_utilities, utility, power, road,
                                           -- assessment, tax, listing
  status TEXT NOT NULL CHECK (status IN ('ok', 'none', 'unavailable', 'timeout', 'not_configured', 'not_checked')),
  source TEXT,                             -- source name the answer carried (e.g. 'FEMA NFHL', Esri backup)
  source_version TEXT,                     -- cache/rules version or bulk file vintage
  backup INTEGER CHECK (backup IN (0, 1)), -- answered by a backup source
  error TEXT,                              -- short reason, no URLs with query strings
  fetched_at TEXT NOT NULL,
  run_id TEXT,
  PRIMARY KEY (county_key, parcel_id, layer),
  FOREIGN KEY (county_key, parcel_id) REFERENCES parcels(county_key, parcel_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_layers_retry ON parcel_layers(layer, status, fetched_at);

-- Optional: the trimmed score inputs (only what the score core reads), so a score-rules change can
-- be re-run without the network. Personal fields are stripped before storing.
CREATE TABLE IF NOT EXISTS parcel_inputs (
  county_key TEXT NOT NULL,
  parcel_id TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  inputs_version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (county_key, parcel_id),
  FOREIGN KEY (county_key, parcel_id) REFERENCES parcels(county_key, parcel_id) ON DELETE CASCADE
);

-- Small key/value table: current published state per county (last good run, counts) for /api/explore.
CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
