-- Fix main_property_type_ids so Residential (1) and Commercial (2) filter separately.
-- Subtypes were incorrectly tagged as both [1,2]; listings were left empty so Typesense
-- could not distinguish them.

BEGIN;

-- Current catalog is residential dwellings (villa, apartment, …). Tag as Residential only.
-- Keep any type that is already commercial-only ([2]) unchanged.
UPDATE property.PROPERTY_TYPES
SET
  main_property_type_ids = ARRAY[
    (SELECT main_type_id FROM property.MAIN_PROPERTY_TYPES WHERE main_type_key = 'residential')
  ],
  updated_at = NOW() AT TIME ZONE 'UTC'
WHERE main_property_type_ids IS NULL
   OR main_property_type_ids = '{}'
   OR (
     main_property_type_ids @> ARRAY[1]
     AND main_property_type_ids @> ARRAY[2]
   );

-- Backfill empty listing arrays from the (now-correct) subtype mapping.
UPDATE property.PROPERTIES p
SET
  main_property_type_ids = (
    SELECT COALESCE(ARRAY_AGG(DISTINCT m ORDER BY m), '{}')
    FROM property.PROPERTY_TYPES pt
    CROSS JOIN LATERAL unnest(COALESCE(pt.main_property_type_ids, '{}')) AS m
    WHERE pt.type_id = ANY(COALESCE(p.property_type_ids, '{}'))
  ),
  updated_at = NOW() AT TIME ZONE 'UTC'
WHERE (p.main_property_type_ids IS NULL OR p.main_property_type_ids = '{}')
  AND cardinality(COALESCE(p.property_type_ids, '{}')) > 0;

COMMIT;
