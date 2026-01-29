-- Migration: Populate SEARCH_FILTER_CONFIGS with initial filter data
-- Date: 2026-01-29
-- Description: Insert default search filter configurations for Buy/Rent purposes
--              with filters matching the FindRE UI: location, completion, property type,
--              bedrooms, bathrooms, price, area, keyword, agent

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
                "id": "completion_status",
                "name": "Completion Status",
                "type": "checkbox-group",
                "options": [
                    {
                        "value": "all",
                        "label": "All",
                        "enabled": true
                    },
                    {
                        "value": "ready",
                        "label": "Ready",
                        "enabled": true
                    },
                    {
                        "value": "off_plan",
                        "label": "Off-plan",
                        "enabled": true
                    }
                ],
                "order": 2
            },
            {
                "id": "property_type",
                "name": "Property Type",
                "type": "checkbox-group",
                "options": [
                    {
                        "value": "residential",
                        "label": "Residential",
                        "enabled": true
                    },
                    {
                        "value": "commercial",
                        "label": "Commercial",
                        "enabled": true
                    },
                    {
                        "value": "land",
                        "label": "Land",
                        "enabled": true
                    },
                    {
                        "value": "mixed_use",
                        "label": "Mixed Use",
                        "enabled": true
                    }
                ],
                "order": 3
            },
            {
                "id": "property_subtype",
                "name": "Property Subtype",
                "type": "checkbox-group",
                "options": [
                    {
                        "value": "apartment",
                        "label": "Apartment",
                        "parentType": "residential",
                        "enabled": true
                    },
                    {
                        "value": "villa",
                        "label": "Villa",
                        "parentType": "residential",
                        "enabled": true
                    },
                    {
                        "value": "townhouse",
                        "label": "Townhouse",
                        "parentType": "residential",
                        "enabled": true
                    },
                    {
                        "value": "penthouse",
                        "label": "Penthouse",
                        "parentType": "residential",
                        "enabled": true
                    },
                    {
                        "value": "office",
                        "label": "Office",
                        "parentType": "commercial",
                        "enabled": true
                    },
                    {
                        "value": "retail",
                        "label": "Retail",
                        "parentType": "commercial",
                        "enabled": true
                    },
                    {
                        "value": "warehouse",
                        "label": "Warehouse",
                        "parentType": "commercial",
                        "enabled": true
                    }
                ],
                "order": 4,
                "conditional": true,
                "dependsOn": "property_type"
            },
            {
                "id": "bedrooms",
                "name": "Beds",
                "type": "range",
                "min": 0,
                "max": 5,
                "step": 1,
                "defaultMin": 0,
                "defaultMax": 5,
                "options": [
                    {"value": 0, "label": "Studio"},
                    {"value": 1, "label": "1"},
                    {"value": 2, "label": "2"},
                    {"value": 3, "label": "3"},
                    {"value": 4, "label": "4"},
                    {"value": 5, "label": "5"},
                    {"value": 6, "label": "6+", "isPlus": true}
                ],
                "order": 5
            },
            {
                "id": "bathrooms",
                "name": "Baths",
                "type": "range",
                "min": 1,
                "max": 5,
                "step": 1,
                "defaultMin": 1,
                "defaultMax": 5,
                "options": [
                    {"value": 1, "label": "1"},
                    {"value": 2, "label": "2"},
                    {"value": 3, "label": "3"},
                    {"value": 4, "label": "4"},
                    {"value": 5, "label": "5"},
                    {"value": 6, "label": "6+", "isPlus": true}
                ],
                "order": 6
            },
            {
                "id": "price",
                "name": "Price",
                "type": "range-slider",
                "currency": "USD",
                "currencyOptions": ["USD", "EUR"],
                "min": 50000,
                "max": 800000,
                "step": 5000,
                "defaultMin": 50000,
                "defaultMax": 800000,
                "displayFormat": "currency",
                "order": 7
            },
            {
                "id": "area",
                "name": "Area",
                "type": "range",
                "unit": "sqm",
                "unitOptions": ["sqm", "sqft"],
                "min": 0,
                "max": 10000,
                "step": 100,
                "defaultMin": 0,
                "defaultMax": 10000,
                "order": 8
            },
            {
                "id": "keyword",
                "name": "Keyword",
                "type": "text",
                "placeholder": "Add relevant keywords",
                "searchable": true,
                "order": 9
            },
            {
                "id": "agent_or_agency",
                "name": "Agent or Agency",
                "type": "select",
                "placeholder": "Select an agent or agency",
                "searchable": true,
                "multiSelect": false,
                "order": 10
            },
            {
                "id": "features",
                "name": "Features",
                "type": "checkbox-group",
                "options": [
                    {"value": "pool", "label": "Pool", "enabled": true},
                    {"value": "garden", "label": "Garden", "enabled": true},
                    {"value": "garage", "label": "Garage", "enabled": true},
                    {"value": "balcony", "label": "Balcony", "enabled": true},
                    {"value": "elevator", "label": "Elevator", "enabled": true},
                    {"value": "ac", "label": "Air Conditioning", "enabled": true},
                    {"value": "fireplace", "label": "Fireplace", "enabled": true},
                    {"value": "security", "label": "Security System", "enabled": true}
                ],
                "order": 11
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
                "id": "completion_status",
                "name": "Availability",
                "type": "checkbox-group",
                "options": [
                    {
                        "value": "available_now",
                        "label": "Available Now",
                        "enabled": true
                    },
                    {
                        "value": "upcoming",
                        "label": "Upcoming",
                        "enabled": true
                    }
                ],
                "order": 2
            },
            {
                "id": "property_type",
                "name": "Property Type",
                "type": "checkbox-group",
                "options": [
                    {
                        "value": "apartment",
                        "label": "Apartment",
                        "enabled": true
                    },
                    {
                        "value": "villa",
                        "label": "Villa",
                        "enabled": true
                    },
                    {
                        "value": "townhouse",
                        "label": "Townhouse",
                        "enabled": true
                    },
                    {
                        "value": "house",
                        "label": "House",
                        "enabled": true
                    }
                ],
                "order": 3
            },
            {
                "id": "bedrooms",
                "name": "Bedrooms",
                "type": "range",
                "min": 1,
                "max": 5,
                "step": 1,
                "defaultMin": 1,
                "defaultMax": 5,
                "options": [
                    {"value": 1, "label": "1"},
                    {"value": 2, "label": "2"},
                    {"value": 3, "label": "3"},
                    {"value": 4, "label": "4"},
                    {"value": 5, "label": "5"},
                    {"value": 6, "label": "5+", "isPlus": true}
                ],
                "order": 4
            },
            {
                "id": "bathrooms",
                "name": "Baths",
                "type": "range",
                "min": 1,
                "max": 5,
                "step": 1,
                "defaultMin": 1,
                "defaultMax": 5,
                "options": [
                    {"value": 1, "label": "1"},
                    {"value": 2, "label": "2"},
                    {"value": 3, "label": "3"},
                    {"value": 4, "label": "4"},
                    {"value": 5, "label": "5"},
                    {"value": 6, "label": "6+", "isPlus": true}
                ],
                "order": 5
            },
            {
                "id": "price",
                "name": "Monthly Rent",
                "type": "range-slider",
                "currency": "USD",
                "currencyOptions": ["USD", "EUR"],
                "min": 500,
                "max": 5000,
                "step": 100,
                "defaultMin": 500,
                "defaultMax": 5000,
                "displayFormat": "currency",
                "order": 6
            },
            {
                "id": "area",
                "name": "Area",
                "type": "range",
                "unit": "sqm",
                "unitOptions": ["sqm", "sqft"],
                "min": 0,
                "max": 10000,
                "step": 100,
                "defaultMin": 0,
                "defaultMax": 10000,
                "order": 7
            },
            {
                "id": "keyword",
                "name": "Keyword",
                "type": "text",
                "placeholder": "Add relevant keywords",
                "searchable": true,
                "order": 8
            },
            {
                "id": "agent_or_agency",
                "name": "Agent or Agency",
                "type": "select",
                "placeholder": "Select an agent or agency",
                "searchable": true,
                "multiSelect": false,
                "order": 9
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
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'chk_search_filter_config_has_filters'
      AND t.relname = 'SEARCH_FILTER_CONFIGS'
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
