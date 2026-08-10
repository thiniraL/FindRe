export type TypesenseField =
  | {
    name: string;
    type:
    | 'string'
    | 'string[]'
    | 'int32'
    | 'int32[]'
    | 'int64'
    | 'float'
    | 'bool'
    | 'geopoint';
    facet?: boolean;
    optional?: boolean;
    index?: boolean;
    sort?: boolean;
  }
  | {
    name: string;
    type: 'auto';
  };

export type TypesenseCollectionSchema = {
  name: string;
  fields: TypesenseField[];
  default_sorting_field?: string;
};

/**
 * Typesense `properties` collection.
 *
 * Notes:
 * - `property_id` is used as the Typesense document `id`.
 * - Facets are enabled for filterable fields.
 * - We sort featured lists by `featured_rank`, and fallback feed by `updated_at`.
 */
export const PROPERTIES_COLLECTION_SCHEMA: TypesenseCollectionSchema = {
  name: 'properties',
  default_sorting_field: 'updated_at',
  fields: [
    // Identity
    { name: 'property_id', type: 'string' },

    // Scoping
    { name: 'country_id', type: 'int32', facet: true },

    // Core facets
    // IDs for filter_by; matching *_key / *_keys / *_en strings for NL / query_by
    { name: 'purpose_id', type: 'int32', facet: true, optional: true },
    { name: 'purpose_key', type: 'string', facet: true, optional: true },
    { name: 'property_type_id', type: 'int32', facet: true, optional: true },
    { name: 'property_type_ids', type: 'int32[]', facet: true, optional: true },
    { name: 'property_type_key', type: 'string', facet: true, optional: true },
    { name: 'property_type_keys', type: 'string[]', facet: true, optional: true },
    { name: 'property_type_en', type: 'string', optional: true },
    { name: 'property_type_names_en', type: 'string[]', optional: true },
    { name: 'main_property_type_ids', type: 'int32[]', facet: true, optional: true },
    { name: 'main_property_type_keys', type: 'string[]', facet: true, optional: true },
    { name: 'main_property_type_names_en', type: 'string[]', optional: true },
    { name: 'price', type: 'float', facet: true, optional: true },
    { name: 'price_str', type: 'string', optional: true },
    { name: 'currency_id', type: 'int32', facet: true, optional: true },
    { name: 'currency_code', type: 'string', facet: true, optional: true },
    { name: 'currency_en', type: 'string', optional: true },
    { name: 'currency_symbol', type: 'string', optional: true },
    { name: 'bedrooms', type: 'int32', facet: true, optional: true },
    { name: 'bedrooms_str', type: 'string', optional: true },
    { name: 'bathrooms', type: 'int32', facet: true, optional: true },
    { name: 'bathrooms_str', type: 'string', optional: true },
    { name: 'area_sqft', type: 'float', facet: true, optional: true },
    { name: 'area_sqft_str', type: 'string', optional: true },
    { name: 'area_sqm', type: 'float', facet: true, optional: true },
    { name: 'area_sqm_str', type: 'string', optional: true },
    // Location search uses `address` (text) instead of location_id filtering
    { name: 'address', type: 'string', optional: true },
    // Feature IDs (filter by feature_ids); keys kept for display if needed
    { name: 'feature_ids', type: 'int32[]', facet: true, optional: true },
    { name: 'features', type: 'string[]', facet: true, optional: true },
    { name: 'agent_id', type: 'int32', facet: true, optional: true },
    { name: 'agency_id', type: 'int32', facet: true, optional: true },
    { name: 'agency_name', type: 'string', optional: true },
    { name: 'profile_image_url', type: 'string', optional: true },
    { name: 'status', type: 'string', facet: true, optional: true },
    { name: 'completion_status', type: 'string', facet: true, optional: true },
    { name: 'is_off_plan', type: 'bool', facet: true, optional: true },

    // Featured
    { name: 'is_featured', type: 'bool', facet: true, optional: true },
    // Ensure this is always present (use large value when not featured).
    { name: 'featured_rank', type: 'int32', optional: true },

    // Sort fields
    { name: 'created_at', type: 'int64', sort: true, optional: true },
    // Must be non-optional because it's the default_sorting_field
    { name: 'updated_at', type: 'int64', sort: true },

    // Searchable text (multi-language) and agent metadata
    { name: 'title_en', type: 'string', optional: true },
    { name: 'title_ar', type: 'string', optional: true },
    { name: 'city_en', type: 'string', optional: true },
    { name: 'area_en', type: 'string', optional: true },
    { name: 'community_en', type: 'string', optional: true },
    { name: 'agent_name', type: 'string', optional: true },
    { name: 'agent_email', type: 'string', optional: true },
    { name: 'agent_phone', type: 'string', optional: true },
    { name: 'agent_whatsapp', type: 'string', optional: true },

    // Media (URLs may be image or video; parallel *_media_types is "image" | "video")
    { name: 'primary_image_url', type: 'string', optional: true },
    { name: 'primary_media_type', type: 'string', optional: true },
    { name: 'additional_image_urls', type: 'string[]', optional: true },
    { name: 'additional_media_types', type: 'string[]', optional: true },
    { name: 'all_image_urls', type: 'string[]', optional: true },
    { name: 'all_media_types', type: 'string[]', optional: true },
    { name: 'image_is_featured', type: 'int32[]', optional: true },

    // Optional geo
    { name: 'geo', type: 'geopoint', optional: true },
  ],
};

/**
 * NL / LLM `query_by` — string / string[] only.
 * Keep int/float facets for filter_by; *_str mirrors are for text / NL query_by.
 */
export const PROPERTIES_QUERY_BY =
  'title_en,title_ar,address,city_en,area_en,community_en,purpose_key,property_type_en,property_type_keys,property_type_names_en,main_property_type_keys,main_property_type_names_en,features,currency_code,currency_en,currency_symbol,bedrooms_str,bathrooms_str,area_sqm_str,area_sqft_str,price_str,agent_name,agency_name';

