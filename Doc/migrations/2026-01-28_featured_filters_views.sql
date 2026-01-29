-- Incremental migration: featured properties + filter configs + views idempotency
-- Date: 2026-01-28
--
-- Notes:
-- - This migration is written for PostgreSQL.
-- - It is safe to run multiple times (guards included where possible).

BEGIN;

-- ---------------------------------------------------------------------------
-- Fix PROPERTY_VIEWS feedback_at typo (if it exists in an older DB)
-- Older broken schema might have created a column named feedback_attimestamp
-- (because feedback_atTIMESTAMP had no space and no type).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'property'
      AND table_name = 'property_views'
      AND column_name = 'feedback_attimestamp'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'property'
      AND table_name = 'property_views'
      AND column_name = 'feedback_at'
  ) THEN
    ALTER TABLE property.PROPERTY_VIEWS RENAME COLUMN feedback_attimestamp TO feedback_at;
    ALTER TABLE property.PROPERTY_VIEWS ALTER COLUMN feedback_at TYPE TIMESTAMP USING feedback_at::timestamp;
  END IF;
END $$;

-- If feedback_at exists but is missing, add it (won't overwrite existing)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'property'
      AND table_name = 'property_views'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'property'
      AND table_name = 'property_views'
      AND column_name = 'feedback_at'
  ) THEN
    ALTER TABLE property.PROPERTY_VIEWS
      ADD COLUMN feedback_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- De-duplicate rows so partial unique indexes can be added safely.
-- Keep the most recent view per key.
-- ---------------------------------------------------------------------------
-- Logged-in duplicates: (property_id, user_id) where user_id IS NOT NULL
DELETE FROM property.PROPERTY_VIEWS pv
USING (
  SELECT ctid,
         row_number() OVER (
           PARTITION BY property_id, user_id
           ORDER BY viewed_at DESC NULLS LAST, view_id DESC
         ) AS rn
  FROM property.PROPERTY_VIEWS
  WHERE user_id IS NOT NULL
) d
WHERE pv.ctid = d.ctid
  AND d.rn > 1;

-- Anonymous duplicates: (property_id, session_id) where user_id IS NULL
DELETE FROM property.PROPERTY_VIEWS pv
USING (
  SELECT ctid,
         row_number() OVER (
           PARTITION BY property_id, session_id
           ORDER BY viewed_at DESC NULLS LAST, view_id DESC
         ) AS rn
  FROM property.PROPERTY_VIEWS
  WHERE user_id IS NULL
) d
WHERE pv.ctid = d.ctid
  AND d.rn > 1;

-- ---------------------------------------------------------------------------
-- Add idempotency constraints via partial unique indexes
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_views_property_user
  ON property.PROPERTY_VIEWS(property_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_property_views_property_session_anonymous
  ON property.PROPERTY_VIEWS(property_id, session_id)
  WHERE user_id IS NULL;

-- ---------------------------------------------------------------------------
-- FEATURED_PROPERTIES (country-scoped)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property.FEATURED_PROPERTIES (
  featured_id BIGSERIAL PRIMARY KEY,
  country_id INT NOT NULL,
  property_id INT NOT NULL,
  rank INT NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  start_at TIMESTAMP NULL,
  end_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),

  CONSTRAINT chk_featured_rank_nonnegative CHECK (rank >= 0),
  CONSTRAINT chk_featured_window CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at),
  CONSTRAINT uq_featured_country_property UNIQUE (country_id, property_id),

  FOREIGN KEY (country_id) REFERENCES master.COUNTRIES(country_id) ON DELETE RESTRICT,
  FOREIGN KEY (property_id) REFERENCES property.PROPERTIES(property_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_featured_properties_country_active_rank
  ON property.FEATURED_PROPERTIES(country_id, is_active, rank);
CREATE UNIQUE INDEX IF NOT EXISTS uq_featured_properties_country_rank_active
  ON property.FEATURED_PROPERTIES(country_id, rank)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_featured_properties_property_id
  ON property.FEATURED_PROPERTIES(property_id);
CREATE INDEX IF NOT EXISTS idx_featured_properties_country_window
  ON property.FEATURED_PROPERTIES(country_id, start_at, end_at);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_featured_properties_updated_at'
  ) THEN
    CREATE TRIGGER update_featured_properties_updated_at
      BEFORE UPDATE ON property.FEATURED_PROPERTIES
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- SEARCH_FILTER_CONFIGS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS master.SEARCH_FILTER_CONFIGS (
  config_id BIGSERIAL PRIMARY KEY,
  purpose_key VARCHAR(50) NOT NULL,
  country_id INT NULL,
  currency_id INT NULL,
  language_code VARCHAR(5) NULL,
  version INT NOT NULL DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  config_json JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),

  CONSTRAINT chk_search_filter_version CHECK (version >= 1),
  CONSTRAINT chk_search_filter_config_json CHECK (jsonb_typeof(config_json) = 'object'),
  CONSTRAINT uq_search_filter_config_scope_version UNIQUE (purpose_key, country_id, currency_id, language_code, version),

  FOREIGN KEY (purpose_key) REFERENCES property.PURPOSES(purpose_key) ON DELETE RESTRICT,
  FOREIGN KEY (country_id) REFERENCES master.COUNTRIES(country_id) ON DELETE SET NULL,
  FOREIGN KEY (currency_id) REFERENCES master.CURRENCIES(currency_id) ON DELETE SET NULL,
  FOREIGN KEY (language_code) REFERENCES master.LANGUAGES(language_code) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_search_filter_configs_lookup
  ON master.SEARCH_FILTER_CONFIGS(is_active, purpose_key, country_id, currency_id, language_code, version DESC);
CREATE INDEX IF NOT EXISTS idx_search_filter_configs_active
  ON master.SEARCH_FILTER_CONFIGS(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_search_filter_configs_purpose
  ON master.SEARCH_FILTER_CONFIGS(purpose_key);
CREATE INDEX IF NOT EXISTS idx_search_filter_configs_config_json_gin
  ON master.SEARCH_FILTER_CONFIGS USING GIN (config_json);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_search_filter_configs_updated_at'
  ) THEN
    CREATE TRIGGER update_search_filter_configs_updated_at
      BEFORE UPDATE ON master.SEARCH_FILTER_CONFIGS
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMIT;

