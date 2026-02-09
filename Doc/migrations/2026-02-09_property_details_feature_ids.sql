-- Migration: PROPERTY_DETAILS feature_ids (multi ints) from features JSONB
-- Date: 2026-02-09
-- Add feature_ids INT[] to property.PROPERTY_DETAILS; map current features (JSON list of keys) to FEATURES.feature_id and set.

BEGIN;

-- Add column
ALTER TABLE property.PROPERTY_DETAILS
  ADD COLUMN IF NOT EXISTS feature_ids INT[] DEFAULT '{}';

COMMENT ON COLUMN property.PROPERTY_DETAILS.feature_ids IS 'Feature IDs from property.FEATURES; derived from features JSONB (keys -> feature_id).';

-- Backfill: map features JSONB array (feature keys) to feature_id via FEATURES, set feature_ids (only if features column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'property' AND table_name = 'property_details'
      AND column_name = 'features'
  ) THEN
    UPDATE property.PROPERTY_DETAILS pd
    SET feature_ids = (
      SELECT COALESCE(ARRAY_AGG(f.feature_id ORDER BY f.feature_id), '{}')
      FROM jsonb_array_elements_text(COALESCE(pd.features, '[]'::jsonb)) AS elem(fkey)
      JOIN property.FEATURES f ON f.feature_key = elem.fkey
    )
    WHERE COALESCE(jsonb_array_length(pd.features), 0) > 0;
  END IF;
END $$;

-- Index for array overlap / containment queries
CREATE INDEX IF NOT EXISTS idx_property_details_feature_ids
  ON property.PROPERTY_DETAILS USING GIN (feature_ids);

-- Drop legacy features column (filter config and queries use feature_ids)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'property' AND table_name = 'property_details'
      AND column_name = 'features'
  ) THEN
    ALTER TABLE property.PROPERTY_DETAILS DROP COLUMN features;
  END IF;
END $$;

-- Drop constraint/index that referenced features (if present)
ALTER TABLE property.PROPERTY_DETAILS DROP CONSTRAINT IF EXISTS chk_property_details_features_jsonb;
DROP INDEX IF EXISTS property.idx_property_details_features_gin;

COMMIT;
