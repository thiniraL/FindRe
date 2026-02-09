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
  /** Beds: discrete values (0=Studio, 1,2,3...) */
  bedrooms?: number[];
  /** Baths: discrete values */
  bathrooms?: number[];
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
  if (state.bedrooms?.length) {
    parts.push(`bedrooms:=[${state.bedrooms.join(',')}]`);
  }
  if (state.bathrooms?.length) {
    parts.push(`bathrooms:=[${state.bathrooms.join(',')}]`);
  }
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
