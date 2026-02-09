/**
 * Mapping from SEARCH_FILTER_CONFIGS filter id to search API keys.
 * Use these exact keys when building GET query params and POST body for /api/search.
 *
 * Rule: filter config "id" = search param/body key, except range filters:
 * - id "price" → request uses priceMin, priceMax
 * - id "area"  → request uses areaMin, areaMax (always sqm)
 */

/** Filter ids that map 1:1 to a single GET param and POST body key (same name). */
export const FILTER_IDS_AS_SEARCH_KEYS = [
  'location',
  'completionStatus',
  'mainPropertyTypeIds',
  'propertyTypeIds',
  'bedrooms',
  'bathrooms',
  'keyword',
  'agentIds',
  'featureIds',
] as const;

/** Range filter ids and their corresponding search keys. */
export const FILTER_ID_TO_SEARCH_KEYS: Record<string, readonly string[]> = {
  price: ['priceMin', 'priceMax'],
  area: ['areaMin', 'areaMax'],
} as const;

/** All filter config ids that affect search (single-key + range). */
export const ALL_SEARCH_FILTER_IDS = [
  ...FILTER_IDS_AS_SEARCH_KEYS,
  ...Object.keys(FILTER_ID_TO_SEARCH_KEYS),
] as const;

/**
 * Get the search API key(s) for a filter config id.
 * - For most filters: returns [id].
 * - For "price": returns ["priceMin", "priceMax"].
 * - For "area": returns ["areaMin", "areaMax"] (always sqm).
 */
export function getSearchKeysForFilterId(filterId: string): string[] {
  const rangeKeys = FILTER_ID_TO_SEARCH_KEYS[filterId];
  if (rangeKeys) return [...rangeKeys];
  return [filterId];
}
