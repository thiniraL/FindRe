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
  /** Completion: all | ready | off_plan → is_off_plan filter (single, GET) */
  completionStatus?: 'all' | 'ready' | 'off_plan';
  /** Completion: multiple values for POST body (e.g. ["ready", "off_plan"]) */
  completionStatuses?: ('ready' | 'off_plan')[];
  /** Property type IDs (Typesense property_type_id) */
  propertyTypeIds?: number[];
  /** Beds: discrete values (0=Studio, 1,2,3...); when set, overrides min/max */
  bedrooms?: number[];
  /** Beds: min (0 = Studio), max (range, GET) */
  bedroomsMin?: number;
  bedroomsMax?: number;
  /** Baths: discrete values; when set, overrides min/max */
  bathrooms?: number[];
  /** Baths: min, max (range, GET) */
  bathroomsMin?: number;
  bathroomsMax?: number;
  /** Price range */
  priceMin?: number;
  priceMax?: number;
  /** Area range; unit determines field (area_sqm | area_sqft) */
  areaMin?: number;
  areaMax?: number;
  areaUnit?: 'sqm' | 'sqft';
  /** Keyword → appended to full-text q */
  keyword?: string;
  /** Agent ID (single, GET) */
  agentId?: number;
  /** Agent IDs (multiple, POST) */
  agentIds?: number[];
  /** Feature keys from PROPERTY_DETAILS.features, e.g. ["pool", "garden"] */
  featureKeys?: string[];
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
    const statusParts = state.completionStatuses.map((s) =>
      s === 'ready' ? 'is_off_plan:=false' : 'is_off_plan:=true'
    );
    parts.push(`(${statusParts.join(' || ')})`);
  } else if (state.completionStatus && state.completionStatus !== 'all') {
    if (state.completionStatus === 'ready') {
      parts.push('is_off_plan:=false');
    } else if (state.completionStatus === 'off_plan') {
      parts.push('is_off_plan:=true');
    }
  }
  if (state.propertyTypeIds?.length) {
    parts.push(`property_type_id:=[${state.propertyTypeIds.join(',')}]`);
  }
  if (state.bedrooms?.length) {
    parts.push(`bedrooms:=[${state.bedrooms.join(',')}]`);
  } else {
    if (state.bedroomsMin != null && state.bedroomsMin > 0) {
      parts.push(`bedrooms:>=${state.bedroomsMin}`);
    }
    if (state.bedroomsMax != null) {
      parts.push(`bedrooms:<=${state.bedroomsMax}`);
    }
  }
  if (state.bathrooms?.length) {
    parts.push(`bathrooms:=[${state.bathrooms.join(',')}]`);
  } else {
    if (state.bathroomsMin != null && state.bathroomsMin > 0) {
      parts.push(`bathrooms:>=${state.bathroomsMin}`);
    }
    if (state.bathroomsMax != null) {
      parts.push(`bathrooms:<=${state.bathroomsMax}`);
    }
  }
  if (state.priceMin != null && state.priceMin > 0) {
    parts.push(`price:>=${state.priceMin}`);
  }
  if (state.priceMax != null) {
    parts.push(`price:<=${state.priceMax}`);
  }
  const areaField = state.areaUnit === 'sqft' ? 'area_sqft' : 'area_sqm';
  if (state.areaMin != null && state.areaMin > 0) {
    parts.push(`${areaField}:>=${state.areaMin}`);
  }
  if (state.areaMax != null) {
    parts.push(`${areaField}:<=${state.areaMax}`);
  }
  if (state.agentIds?.length) {
    parts.push(`agent_id:=[${state.agentIds.join(',')}]`);
  } else if (state.agentId != null) {
    parts.push(`agent_id:=${state.agentId}`);
  }
  if (state.featureKeys?.length) {
    const safe = state.featureKeys.map((k) => /^[a-z0-9_]+$/i.test(k) ? k : `"${escapeFilterValue(k)}"`).join(',');
    parts.push(`features:=[${safe}]`);
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
