CREATE TABLE IF NOT EXISTS mls_listings (
  listing_key TEXT PRIMARY KEY,
  listing_id TEXT,
  originating_system_name TEXT NOT NULL,
  parcel_number TEXT,
  parcel_number_normalized TEXT,
  standard_status TEXT,
  list_price REAL,
  original_list_price REAL,
  close_price REAL,
  listing_contract_date TEXT,
  days_on_market INTEGER,
  close_date TEXT,
  modification_timestamp TEXT NOT NULL,
  property_type TEXT,
  property_sub_type TEXT,
  lot_size_acres REAL,
  street_number TEXT,
  street_dir_prefix TEXT,
  street_name TEXT,
  street_suffix TEXT,
  unit_number TEXT,
  city TEXT,
  state_or_province TEXT,
  postal_code TEXT,
  latitude REAL,
  longitude REAL,
  public_remarks TEXT,
  list_agent_full_name TEXT,
  list_office_name TEXT,
  internet_address_display_yn INTEGER,
  internet_entire_listing_display_yn INTEGER,
  mlg_can_view INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mls_parcel ON mls_listings(originating_system_name, parcel_number_normalized);
CREATE INDEX IF NOT EXISTS idx_mls_listing_id ON mls_listings(originating_system_name, listing_id);
CREATE INDEX IF NOT EXISTS idx_mls_modified ON mls_listings(originating_system_name, modification_timestamp);
CREATE TABLE IF NOT EXISTS mls_sync_state (
  originating_system_name TEXT PRIMARY KEY,
  last_modification_timestamp TEXT,
  initial_sync_complete INTEGER NOT NULL DEFAULT 0,
  records_synced INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
