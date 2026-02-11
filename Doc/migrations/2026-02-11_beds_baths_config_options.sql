-- Migration: Set beds and baths filter options from config (no table lookup)
-- Date: 2026-02-11
-- Description: Update SEARCH_FILTER_CONFIGS so bedrooms and bathrooms filters use
--              fixed count options (1,2,3,4,5,6+; beds also Studio/0) from config.
--              mergeFilterOptions will use these when present and skip DB range queries.

BEGIN;

WITH beds_options AS (
  SELECT '[{"value":0,"label":"Studio"},{"value":1,"label":"1"},{"value":2,"label":"2"},{"value":3,"label":"3"},{"value":4,"label":"4"},{"value":5,"label":"5"},{"value":"6+","label":"6+"}]'::jsonb AS opts
),
baths_options AS (
  SELECT '[{"value":1,"label":"1"},{"value":2,"label":"2"},{"value":3,"label":"3"},{"value":4,"label":"4"},{"value":5,"label":"5"},{"value":"6+","label":"6+"}]'::jsonb AS opts
),
updated AS (
  SELECT
    c.config_id,
    c.config_json
      || jsonb_build_object(
           'filters',
           (
             SELECT jsonb_agg(
               CASE
                 WHEN elem->>'id' = 'bedrooms' THEN jsonb_set(elem, '{options}', (SELECT opts FROM beds_options))
                 WHEN elem->>'id' = 'bathrooms' THEN jsonb_set(elem, '{options}', (SELECT opts FROM baths_options))
                 ELSE elem
               END
             )
             FROM jsonb_array_elements(c.config_json->'filters') AS elem
           )
        ) AS new_config
  FROM master.SEARCH_FILTER_CONFIGS c
)
UPDATE master.SEARCH_FILTER_CONFIGS t
SET config_json = u.new_config,
    updated_at = NOW() AT TIME ZONE 'UTC'
FROM updated u
WHERE t.config_id = u.config_id;

COMMIT;
