-- Migration: Populate SEARCH_FILTER_CONFIGS with initial filter data
-- Date: 2026-01-29
-- Description: Insert default search filter configurations for Buy/Rent purposes
--              with filters matching the FindRE UI: location, completion, property type,
--              bedrooms, bathrooms, price, area, keyword, agent
--
-- Search API alignment: Each filter "id" must match the key used in GET /api/search
-- query params and POST body. See lib/search/filterConfigToSearchKeys.ts.
-- - Single-key filters: id = param/body key (e.g. id "mainPropertyTypeIds" -> mainPropertyTypeIds).
-- - Range filters: id "price" -> priceMin, priceMax; id "area" -> areaMin, areaMax (area always sqm).

BEGIN;

-- Clear existing configs if any (optional - comment out if you want to preserve)
-- DELETE FROM master.SEARCH_FILTER_CONFIGS WHERE purpose_key IN ('buy', 'rent');

-- Insert Buy filters configuration (English, Global/NULL country)
INSERT INTO master.SEARCH_FILTER_CONFIGS (purpose_key, country_id, currency_id, language_code, version, is_active, config_json)
VALUES (
    'for_sale',
    1,
    1,
    'en',
    1,
    TRUE,
    '{
        "filters": [
            {
                "id": "location",
                "name": "Location",
                "type": "location",
                "placeholder": "e.g., Costa Blanca",
                "required": false,
                "searchable": true,
                "order": 1
            },
            {
                "id": "completionStatus",
                "name": "Completion Status",
                "type": "checkbox-group",
                "options": [
                    {
                        "value": "all",
                        "label": "All"                    },
                    {
                        "value": "ready",
                        "label": "Ready"                    },
                    {
                        "value": "off_plan",
                        "label": "Off-plan"                    }
                ],
                "order": 2
            },
            {
                "id": "mainPropertyTypeIds",
                "name": "Property type",
                "type": "radio",
                "options": [],
                "order": 3
            },
            {
                "id": "propertyTypeIds",
                "name": "Property Type",
                "type": "checkbox-group",
                "options": [],
                "order": 4,
                "dependsOn": "mainPropertyTypeIds"
            },
            {
                "id": "bedrooms",
                "name": "Beds",
                "type": "checkbox-group",
                "options": [
                    { "value": 0, "label": "Studio" },
                    { "value": 1, "label": "1" },
                    { "value": 2, "label": "2" },
                    { "value": 3, "label": "3" },
                    { "value": 4, "label": "4" },
                    { "value": 5, "label": "5" },
                    { "value": "6+", "label": "6+" }
                ],
                "order": 6
            },
            {
                "id": "bathrooms",
                "name": "Baths",
                "type": "checkbox-group",
                "options": [
                    { "value": 1, "label": "1" },
                    { "value": 2, "label": "2" },
                    { "value": 3, "label": "3" },
                    { "value": 4, "label": "4" },
                    { "value": 5, "label": "5" },
                    { "value": "6+", "label": "6+" }
                ],
                "order": 7
            },
            {
                "id": "price",
                "name": "Price",
                "type": "range-slider",
                "currency": "USD",
                "min": 50000,
                "max": 800000,
                "defaultMin": 50000,
                "defaultMax": 800000,
                "order": 8
            },
            {
                "id": "area",
                "name": "Area",
                "type": "range",
                "unit": "sqm",
                "min": 0,
                "max": 10000,
                "defaultMin": 0,
                "defaultMax": 10000,
                "order": 9
            },
            {
                "id": "keyword",
                "name": "Keyword",
                "type": "checkbox-group",
                "options": [],
                "order": 10
            },
            {
                "id": "agentIds",
                "name": "Agent or Agency",
                "type": "dropdown",
                "placeholder": "Select an agent or agency",
                "searchable": true,
                "multiSelect": false,
                "order": 11
            },
            {
                "id": "featureIds",
                "name": "Features",
                "type": "checkbox-group",
                "options": [],
                "order": 12
            }
        ],
        "meta": {
            "totalResults": 4512,
            "resultButtonLabel": "See 4,512 Properties",
            "resetButtonLabel": "Reset"
        }
    }'::jsonb
) ON CONFLICT (purpose_key, country_id, currency_id, language_code, version) DO UPDATE
SET config_json = EXCLUDED.config_json, updated_at = NOW();

-- Insert Rent filters configuration (English, Global/NULL country)
INSERT INTO master.SEARCH_FILTER_CONFIGS (purpose_key, country_id, currency_id, language_code, version, is_active, config_json)
VALUES (
    'for_rent',
    1,
    1,
    'en',
    1,
    TRUE,
    '{
        "filters": [
            {
                "id": "location",
                "name": "Location",
                "type": "location",
                "placeholder": "e.g., Costa Blanca",
                "required": false,
                "searchable": true,
                "order": 1
            },
            {
                "id": "completionStatus",
                "name": "Availability",
                "type": "checkbox-group",
                "options": [
                    {
                        "value": "available_now",
                        "label": "Available Now"                    },
                    {
                        "value": "upcoming",
                        "label": "Upcoming"                    }
                ],
                "order": 2
            },
            {
                "id": "mainPropertyTypeIds",
                "name": "Main Type",
                "type": "radio",
                "options": [],
                "order": 3
            },
            {
                "id": "propertyTypeIds",
                "name": "Property Type",
                "type": "checkbox-group",
                "options": [],
                "order": 4,
                "dependsOn": "mainPropertyTypeIds"
            },
            {
                "id": "bedrooms",
                "name": "Bedrooms",
                "type": "checkbox-group",
                "options": [
                    { "value": 0, "label": "Studio" },
                    { "value": 1, "label": "1" },
                    { "value": 2, "label": "2" },
                    { "value": 3, "label": "3" },
                    { "value": 4, "label": "4" },
                    { "value": 5, "label": "5" },
                    { "value": "6+", "label": "6+" }
                ],
                "order": 6
            },
            {
                "id": "bathrooms",
                "name": "Baths",
                "type": "checkbox-group",
                "options": [
                    { "value": 1, "label": "1" },
                    { "value": 2, "label": "2" },
                    { "value": 3, "label": "3" },
                    { "value": 4, "label": "4" },
                    { "value": 5, "label": "5" },
                    { "value": "6+", "label": "6+" }
                ],
                "order": 7
            },
            {
                "id": "price",
                "name": "Monthly Rent",
                "type": "range-slider",
                "currency": "USD",
                "min": 500,
                "max": 5000,
                "defaultMin": 500,
                "defaultMax": 5000,
                "order": 8
            },
            {
                "id": "area",
                "name": "Area",
                "type": "range",
                "unit": "sqm",
                "min": 0,
                "max": 10000,
                "defaultMin": 0,
                "defaultMax": 10000,
                "order": 9
            },
            {
                "id": "keyword",
                "name": "Keyword",
                "type": "checkbox-group",
                "options": [],
                "order": 10
            },
            {
                "id": "agentIds",
                "name": "Agent or Agency",
                "type": "dropdown",
                "placeholder": "Select an agent or agency",
                "searchable": true,
                "multiSelect": false,
                "order": 11
            },
            {
                "id": "featureIds",
                "name": "Features",
                "type": "checkbox-group",
                "options": [],
                "order": 12
            }
        ],
        "meta": {
            "totalResults": 1205,
            "resultButtonLabel": "See Rental Properties",
            "resetButtonLabel": "Reset"
        }
    }'::jsonb
) ON CONFLICT (purpose_key, country_id, currency_id, language_code, version) DO UPDATE
SET config_json = EXCLUDED.config_json, updated_at = NOW();

-- Ensure config_json has a "filters" array (structure check)
-- relname may be lowercase (unquoted) or mixed case (quoted); match case-insensitively
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'chk_search_filter_config_has_filters'
      AND LOWER(t.relname) = 'search_filter_configs'
      AND n.nspname = 'master'
  ) THEN
    ALTER TABLE master.SEARCH_FILTER_CONFIGS
    ADD CONSTRAINT chk_search_filter_config_has_filters
    CHECK (
      config_json ? 'filters'
      AND jsonb_typeof(config_json->'filters') = 'array'
    );
  END IF;
END $$;

COMMIT;
