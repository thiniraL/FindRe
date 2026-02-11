/**
 * Build Typesense filter_by and q from filter UI values (aligned with SEARCH_FILTER_CONFIGS).
 * Used by GET /api/search to integrate filter values into Typesense search.
 */

export type SearchFilterState = {
  /** Purpose key: for_sale | for_rent */
  purpose: string;
  /** Scope */
  countryId?: number;
  /** Location text → full-text query on property.address (and city/area/community when present) */
  location?: string;
  /** Completion: 'all' = no filter; any other value filters by completion_status (from PROPERTIES.completion_status) */
  completionStatus?: string;
  /** Completion: multiple values for POST body, filter by completion_status */
  completionStatuses?: string[];
  /** Main property type IDs (Residential, Commercial); filter by main_property_type_ids */
  mainPropertyTypeIds?: number[];
  /** Property type IDs (sub types; Typesense property_type_id or property_type_ids) */
  propertyTypeIds?: number[];
  /** Beds: discrete values (0=Studio, 1,2,3...) or "6+" for 6 or more */
  bedrooms?: (number | string)[];
  /** Baths: discrete values or "6+" for 6 or more */
  bathrooms?: (number | string)[];
  /** Price range */
  priceMin?: number;
  priceMax?: number;
  /** Area range (always sqm) */
  areaMin?: number;
  areaMax?: number;
  /** Keyword → appended to full-text q */
  keyword?: string;
  /** Agent IDs (one or more) */
  agentIds?: number[];
  /** Feature IDs from PROPERTY_DETAILS.feature_ids */
  featureIds?: number[];
};

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** True if value is a "plus" option (e.g. "6+" means 6 or more). */
function isPlusValue(v: number | string): v is string {
  return typeof v === 'string' && /^\d+\+$/.test(v);
}

/** Parse "6+" -> 6 for use in field:>=N. Returns null if not a valid plus string. */
function parsePlusMin(v: string): number | null {
  const n = parseInt(v.replace(/\+$/, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Build filter parts for a count field (bedrooms/bathrooms): exact values in =[], plus values as >=N. */
function buildCountFilterParts(
  values: (number | string)[] | undefined,
  field: string
): string[] {
  if (!values?.length) return [];
  const exact: number[] = [];
  const plusMins: number[] = [];
  for (const v of values) {
    if (isPlusValue(v)) {
      const n = parsePlusMin(v);
      if (n != null && !plusMins.includes(n)) plusMins.push(n);
    } else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      exact.push(v);
    }
  }
  const parts: string[] = [];
  if (exact.length > 0) parts.push(`${field}:=[${exact.join(',')}]`);
  for (const n of plusMins) parts.push(`${field}:>=${n}`);
  return parts;
}

/**
 * Build Typesense filter_by expression from filter state.
 * Returns undefined if no filters (caller can pass to typesenseSearch as-is).
 */
export function buildFilterBy(state: SearchFilterState): string | undefined {
  const parts: string[] = [];

  if (state.purpose) {
    parts.push(`purpose_key:=${escapeFilterValue(state.purpose)}`);
  }
  if (state.countryId != null) {
    parts.push(`country_id:=${state.countryId}`);
  }
  if (state.completionStatuses?.length) {
    const statusParts = state.completionStatuses.map(
      (s) => `completion_status:=${escapeFilterValue(s)}`
    );
    parts.push(`(${statusParts.join(' || ')})`);
  } else if (state.completionStatus && state.completionStatus !== 'all') {
    parts.push(`completion_status:=${escapeFilterValue(state.completionStatus)}`);
  }
  if (state.mainPropertyTypeIds?.length) {
    parts.push(`main_property_type_ids:=[${state.mainPropertyTypeIds.join(',')}]`);
  }
  if (state.propertyTypeIds?.length) {
    parts.push(`property_type_id:=[${state.propertyTypeIds.join(',')}]`);
  }
  const bedroomParts = buildCountFilterParts(state.bedrooms, 'bedrooms');
  if (bedroomParts.length === 1) parts.push(bedroomParts[0]);
  else if (bedroomParts.length > 1) parts.push(`(${bedroomParts.join(' || ')})`);
  const bathroomParts = buildCountFilterParts(state.bathrooms, 'bathrooms');
  if (bathroomParts.length === 1) parts.push(bathroomParts[0]);
  else if (bathroomParts.length > 1) parts.push(`(${bathroomParts.join(' || ')})`);
  if (state.priceMin != null && state.priceMin > 0) {
    parts.push(`price:>=${state.priceMin}`);
  }
  if (state.priceMax != null) {
    parts.push(`price:<=${state.priceMax}`);
  }
  if (state.areaMin != null && state.areaMin > 0) {
    parts.push(`area_sqm:>=${state.areaMin}`);
  }
  if (state.areaMax != null) {
    parts.push(`area_sqm:<=${state.areaMax}`);
  }
  if (state.agentIds?.length) {
    parts.push(`agent_id:=[${state.agentIds.join(',')}]`);
  }
  if (state.featureIds?.length) {
    parts.push(`feature_ids:=[${state.featureIds.join(',')}]`);
  }

  if (parts.length === 0) return undefined;
  return parts.join(' && ');
}

/**
 * Build full-text q from location + keyword.
 * Returns '*' if nothing to search (Typesense wildcard).
 */
export function buildSearchQuery(state: SearchFilterState): string {
  const terms: string[] = [];
  if (state.location?.trim()) {
    terms.push(state.location.trim());
  }
  if (state.keyword?.trim()) {
    terms.push(state.keyword.trim());
  }
  if (terms.length === 0) return '*';
  return terms.join(' ');
}
