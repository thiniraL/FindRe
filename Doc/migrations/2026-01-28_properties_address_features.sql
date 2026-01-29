-- Incremental migration: add address to PROPERTIES and features JSONB to PROPERTY_DETAILS
-- Date: 2026-01-28
--
-- Adds:
-- - property.PROPERTIES.address TEXT
-- - property.PROPERTY_DETAILS.features JSONB DEFAULT '[]'
--
-- Notes:
-- - Safe to run multiple times (guards included).

BEGIN;

ALTER TABLE property.PROPERTIES
  ADD COLUMN IF NOT EXISTS address TEXT;

ALTER TABLE property.PROPERTY_DETAILS
  ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '[]'::JSONB;

-- Backfill NULLs defensively
UPDATE property.PROPERTY_DETAILS
SET features = '[]'::JSONB
WHERE features IS NULL;

-- If PROPERTIES.features exists from an earlier run, copy into PROPERTY_DETAILS then drop it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'property'
      AND table_name = 'properties'
      AND column_name = 'features'
  ) THEN
    -- Move any existing data
    UPDATE property.PROPERTY_DETAILS pd
    SET features = COALESCE(p.features, pd.features, '[]'::jsonb)
    FROM property.PROPERTIES p
    WHERE p.property_id = pd.property_id;

    -- Drop old index/constraint if present
    DROP INDEX IF EXISTS property.idx_property_features_gin;
    ALTER TABLE property.PROPERTIES DROP CONSTRAINT IF EXISTS chk_property_features_jsonb;

    -- Drop the column
    ALTER TABLE property.PROPERTIES DROP COLUMN IF EXISTS features;
  END IF;
END $$;

-- Constraint: features must be JSON array (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_property_details_features_jsonb'
  ) THEN
    ALTER TABLE property.PROPERTY_DETAILS
      ADD CONSTRAINT chk_property_details_features_jsonb
      CHECK (features IS NULL OR jsonb_typeof(features) = 'array');
  END IF;
END $$;

-- Helpful index for contains/exists queries
CREATE INDEX IF NOT EXISTS idx_property_details_features_gin
  ON property.PROPERTY_DETAILS USING GIN (features);

COMMIT;

