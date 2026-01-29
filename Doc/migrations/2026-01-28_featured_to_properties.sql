-- Incremental migration: move featured flags into property.PROPERTIES
-- Date: 2026-01-28
--
-- New model:
-- - property.PROPERTIES.is_featured (boolean)
-- - property.PROPERTIES.featured_rank (int)
-- FEATURED_PROPERTIES table becomes obsolete and is dropped.
--
-- Notes:
-- - Safe to run multiple times (guards included).
-- - If FEATURED_PROPERTIES exists, this migration backfills into PROPERTIES
--   using currently-active featured rows (time window respected).

BEGIN;

-- ---------------------------------------------------------------------------
-- Add columns to property.PROPERTIES
-- ---------------------------------------------------------------------------
ALTER TABLE property.PROPERTIES
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;

ALTER TABLE property.PROPERTIES
  ADD COLUMN IF NOT EXISTS featured_rank INT;

-- Constraints (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_featured_rank_nonnegative'
  ) THEN
    ALTER TABLE property.PROPERTIES
      ADD CONSTRAINT chk_featured_rank_nonnegative
      CHECK (featured_rank IS NULL OR featured_rank >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_featured_requires_rank'
  ) THEN
    ALTER TABLE property.PROPERTIES
      ADD CONSTRAINT chk_featured_requires_rank
      CHECK (is_featured = FALSE OR featured_rank IS NOT NULL);
  END IF;
END $$;

-- Helpful index for featured sorting
CREATE INDEX IF NOT EXISTS idx_properties_featured_rank
  ON property.PROPERTIES(is_featured, featured_rank)
  WHERE is_featured = TRUE;

-- ---------------------------------------------------------------------------
-- Backfill from FEATURED_PROPERTIES if it exists
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'property'
      AND table_name = 'featured_properties'
  ) THEN
    -- Mark properties as featured if currently active in their own location country.
    -- If duplicates exist, pick the lowest rank.
    WITH active_featured AS (
      SELECT
        fp.property_id,
        MIN(fp.rank) AS rank
      FROM property.FEATURED_PROPERTIES fp
      JOIN property.PROPERTIES p ON p.property_id = fp.property_id
      JOIN property.LOCATIONS l ON l.location_id = p.location_id
      WHERE fp.is_active = TRUE
        AND fp.country_id = l.country_id
        AND (fp.start_at IS NULL OR fp.start_at <= NOW() AT TIME ZONE 'UTC')
        AND (fp.end_at IS NULL OR fp.end_at > NOW() AT TIME ZONE 'UTC')
      GROUP BY fp.property_id
    )
    UPDATE property.PROPERTIES p
    SET is_featured = TRUE,
        featured_rank = af.rank,
        updated_at = NOW() AT TIME ZONE 'UTC'
    FROM active_featured af
    WHERE p.property_id = af.property_id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Drop FEATURED_PROPERTIES (obsolete)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'property'
      AND table_name = 'featured_properties'
  ) THEN
    -- Drop trigger if present
    IF EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'update_featured_properties_updated_at'
    ) THEN
      DROP TRIGGER update_featured_properties_updated_at ON property.FEATURED_PROPERTIES;
    END IF;

    -- Drop indexes if present (names from earlier migrations)
    DROP INDEX IF EXISTS property.idx_featured_properties_country_active_rank;
    DROP INDEX IF EXISTS property.uq_featured_properties_country_rank_active;
    DROP INDEX IF EXISTS property.idx_featured_properties_property_id;
    DROP INDEX IF EXISTS property.idx_featured_properties_country_window;

    -- Drop table
    DROP TABLE IF EXISTS property.FEATURED_PROPERTIES;
  END IF;
END $$;

COMMIT;

