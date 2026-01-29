-- Incremental migration: move SEARCH_FILTER_CONFIGS into master schema
-- Date: 2026-01-28
--
-- Rationale:
-- SEARCH_FILTER_CONFIGS is configuration/reference data, better aligned with master schema.

BEGIN;

CREATE SCHEMA IF NOT EXISTS master;

DO $$
BEGIN
  -- If the table exists in property schema, move it to master schema.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'property'
      AND table_name = 'search_filter_configs'
  ) THEN
    -- If a master copy already exists, do nothing (avoid collision).
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'master'
        AND table_name = 'search_filter_configs'
    ) THEN
      ALTER TABLE property.SEARCH_FILTER_CONFIGS SET SCHEMA master;
    END IF;
  END IF;
END $$;

-- Ensure expected indexes exist on master.SEARCH_FILTER_CONFIGS (no-ops if already moved with indexes)
CREATE INDEX IF NOT EXISTS idx_search_filter_configs_lookup
  ON master.SEARCH_FILTER_CONFIGS(is_active, purpose_key, country_id, currency_id, language_code, version DESC);
CREATE INDEX IF NOT EXISTS idx_search_filter_configs_active
  ON master.SEARCH_FILTER_CONFIGS(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_search_filter_configs_purpose
  ON master.SEARCH_FILTER_CONFIGS(purpose_key);
CREATE INDEX IF NOT EXISTS idx_search_filter_configs_config_json_gin
  ON master.SEARCH_FILTER_CONFIGS USING GIN (config_json);

-- Ensure updated_at trigger exists (after move it should still be present, but this is defensive)
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

