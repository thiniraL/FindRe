-- Migration: Main property type table + property/type multiselect
-- Date: 2026-02-09
-- 1) New table MAIN_PROPERTY_TYPES with seed: Residential, Commercial
-- 2) PROPERTY_TYPES gets main_property_type_ids INT[] (multi main type per type; no extra table)
-- 3) PROPERTIES gets main_property_type_ids INT[] and property_type_ids INT[] for multiselect

BEGIN;

-- ============================================
-- 1. MAIN_PROPERTY_TYPES table + seed
-- ============================================
CREATE TABLE IF NOT EXISTS property.MAIN_PROPERTY_TYPES (
    main_type_id SERIAL PRIMARY KEY,
    main_type_key VARCHAR(50) NOT NULL UNIQUE,
    name_translations JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT chk_main_property_type_translations CHECK (
        name_translations ? 'en' AND jsonb_typeof(name_translations) = 'object'
    )
);

INSERT INTO property.MAIN_PROPERTY_TYPES (main_type_key, name_translations) VALUES
    ('residential', '{"en": "Residential", "ar": "سكني"}'::JSONB),
    ('commercial', '{"en": "Commercial", "ar": "تجاري"}'::JSONB)
ON CONFLICT (main_type_key) DO NOTHING;

-- ============================================
-- 2. PROPERTY_TYPES: add main_property_type_ids INT[] (multi main type per type)
--    Allowed types for main type X: SELECT * FROM property.PROPERTY_TYPES WHERE main_property_type_ids @> ARRAY[X]
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'property' AND table_name = 'property_types'
          AND column_name = 'main_property_type_ids'
    ) THEN
        ALTER TABLE property.PROPERTY_TYPES ADD COLUMN main_property_type_ids INT[] DEFAULT '{}';
    END IF;
END $$;

-- If junction table existed (old migration): copy into PROPERTY_TYPES.main_property_type_ids then drop it
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'property' AND table_name = 'main_property_type_allowed_types') THEN
        UPDATE property.PROPERTY_TYPES pt
        SET main_property_type_ids = (SELECT ARRAY_AGG(DISTINCT a.main_type_id) FROM property.MAIN_PROPERTY_TYPE_ALLOWED_TYPES a WHERE a.type_id = pt.type_id)
        WHERE EXISTS (SELECT 1 FROM property.MAIN_PROPERTY_TYPE_ALLOWED_TYPES a WHERE a.type_id = pt.type_id);
        DROP TABLE IF EXISTS property.MAIN_PROPERTY_TYPE_ALLOWED_TYPES;
    END IF;
END $$;

-- Migrate from old single main_property_type_id if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'property' AND table_name = 'property_types'
          AND column_name = 'main_property_type_id'
    ) THEN
        UPDATE property.PROPERTY_TYPES
        SET main_property_type_ids = ARRAY[main_property_type_id]
        WHERE main_property_type_id IS NOT NULL AND (main_property_type_ids IS NULL OR main_property_type_ids = '{}');
        ALTER TABLE property.PROPERTY_TYPES DROP COLUMN main_property_type_id;
    END IF;
END $$;

-- Seed: all existing property types belong to Residential
UPDATE property.PROPERTY_TYPES
SET main_property_type_ids = ARRAY[(SELECT main_type_id FROM property.MAIN_PROPERTY_TYPES WHERE main_type_key = 'residential')]
WHERE main_property_type_ids IS NULL OR main_property_type_ids = '{}';

COMMENT ON COLUMN property.PROPERTY_TYPES.main_property_type_ids IS 'Main categories this type belongs to (e.g. Residential, Commercial). Query allowed types: WHERE main_property_type_ids @> ARRAY[main_type_id].';

-- ============================================
-- 3. PROPERTIES: add main_property_type_ids and property_type_ids (multiselect)
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'property' AND table_name = 'properties'
          AND column_name = 'main_property_type_ids'
    ) THEN
        ALTER TABLE property.PROPERTIES ADD COLUMN main_property_type_ids INT[] DEFAULT '{}';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'property' AND table_name = 'properties'
          AND column_name = 'property_type_ids'
    ) THEN
        ALTER TABLE property.PROPERTIES ADD COLUMN property_type_ids INT[] DEFAULT '{}';
    END IF;
END $$;

-- Backfill property_type_ids from existing property_type_id (only if column still exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'property' AND table_name = 'properties'
          AND column_name = 'property_type_id'
    ) THEN
        UPDATE property.PROPERTIES
        SET property_type_ids = ARRAY[property_type_id]
        WHERE (property_type_ids IS NULL OR property_type_ids = '{}') AND property_type_id IS NOT NULL;
    END IF;
END $$;

-- Backfill main_property_type_ids from PROPERTY_TYPES.main_property_type_ids (for each property's type ids)
UPDATE property.PROPERTIES p
SET main_property_type_ids = (
    SELECT COALESCE(ARRAY_AGG(DISTINCT m), '{}')
    FROM property.PROPERTY_TYPES pt, unnest(pt.main_property_type_ids) m
    WHERE pt.type_id = ANY(NULLIF(p.property_type_ids, '{}'))
)
WHERE (main_property_type_ids IS NULL OR main_property_type_ids = '{}')
  AND cardinality(p.property_type_ids) > 0;

-- Drop legacy single property_type_id column (use property_type_ids only)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'property' AND table_name = 'properties'
          AND column_name = 'property_type_id'
    ) THEN
        ALTER TABLE property.PROPERTIES DROP COLUMN property_type_id;
    END IF;
END $$;

-- Optional: CHECK that array elements reference valid ids (PostgreSQL 12+)
-- ALTER TABLE property.PROPERTIES ADD CONSTRAINT chk_property_type_ids_reference
--   CHECK (property_type_ids <@ (SELECT ARRAY_AGG(type_id) FROM property.PROPERTY_TYPES));
-- ALTER TABLE property.PROPERTIES ADD CONSTRAINT chk_main_property_type_ids_reference
--   CHECK (main_property_type_ids <@ (SELECT ARRAY_AGG(main_type_id) FROM property.MAIN_PROPERTY_TYPES));

COMMENT ON COLUMN property.PROPERTIES.main_property_type_ids IS 'Multiselect: main categories (e.g. Residential, Commercial). Derivable from property_type_ids via PROPERTY_TYPES.main_property_type_ids.';
COMMENT ON COLUMN property.PROPERTIES.property_type_ids IS 'Multiselect: property type IDs. Use for filtering and display.';

-- Indexes for array containment / overlap queries (e.g. WHERE property_type_ids && ARRAY[1,2])
CREATE INDEX IF NOT EXISTS idx_properties_property_type_ids ON property.PROPERTIES USING GIN (property_type_ids);
CREATE INDEX IF NOT EXISTS idx_properties_main_property_type_ids ON property.PROPERTIES USING GIN (main_property_type_ids);

COMMIT;
