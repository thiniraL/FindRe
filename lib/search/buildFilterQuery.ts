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
  /** Free-text residual (e.g. from NL). Appended to q when no keywords[] chips. */
  keyword?: string;
  /**
   * Keyword chip values (beach, golf, …). Multiple values are OR'd via multi-search.
   * Single value is appended to full-text q.
   */
  keywords?: string[];
  /** Agent/agency filter: [{"id", "type": "agent"|"agency"}, ...]. OR across agents and agencies in Typesense. */
  agentIds?: { id: number; type: 'agency' | 'agent' }[];
  /** Feature IDs from PROPERTY_DETAILS.feature_ids */
  featureIds?: number[];
  /**
   * Feature keys from Typesense `features` facet (e.g. golf, beachfront).
   * Used when NL maps amenity words without resolving numeric IDs yet.
   */
  featureKeys?: string[];
  /** Override default sort (e.g. price:asc for "cheapest"). */
  sortBy?: string;
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
    // "all" means no completion filter — drop it from multi-select payloads
    const statuses = state.completionStatuses.filter(
      (s) => s?.trim() && s.trim().toLowerCase() !== 'all'
    );
    if (statuses.length) {
      const statusParts = statuses.map(
        (s) => `completion_status:=${escapeFilterValue(s)}`
      );
      parts.push(
        statusParts.length === 1
          ? statusParts[0]
          : `(${statusParts.join(' || ')})`
      );
    }
  } else if (state.completionStatus && state.completionStatus !== 'all') {
    parts.push(`completion_status:=${escapeFilterValue(state.completionStatus)}`);
  }
  if (state.mainPropertyTypeIds?.length) {
    parts.push(`main_property_type_ids:=[${state.mainPropertyTypeIds.join(',')}]`);
  }
  if (state.propertyTypeIds?.length) {
    const ids = state.propertyTypeIds.join(',');
    parts.push(`(property_type_id:=[${ids}] || property_type_ids:=[${ids}])`);
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
    // Multi-select is OR: match any selected agent OR any selected agency
    const byAgent = state.agentIds.filter((e) => e.type === 'agent').map((e) => e.id);
    const byAgency = state.agentIds.filter((e) => e.type === 'agency').map((e) => e.id);
    const agentOrAgency: string[] = [];
    if (byAgent.length) agentOrAgency.push(`agent_id:=[${byAgent.join(',')}]`);
    if (byAgency.length) agentOrAgency.push(`agency_id:=[${byAgency.join(',')}]`);
    if (agentOrAgency.length === 1) parts.push(agentOrAgency[0]);
    else if (agentOrAgency.length > 1) parts.push(`(${agentOrAgency.join(' || ')})`);
  }
  if (state.featureIds?.length) {
    parts.push(`feature_ids:=[${state.featureIds.join(',')}]`);
  } else if (state.featureKeys?.length) {
    const keys = state.featureKeys.map((k) => escapeFilterValue(k));
    parts.push(`features:=[${keys.join(',')}]`);
  }

  if (parts.length === 0) return undefined;
  return parts.join(' && ');
}

/**
 * Normalize API keyword (string | comma-separated | string[]) to a string array.
 */
export function normalizeKeywords(
  value: string | string[] | undefined
): string[] | undefined {
  if (value == null) return undefined;
  const list = Array.isArray(value)
    ? value.map((s) => String(s).trim()).filter(Boolean)
    : String(value)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
  // Dedupe while preserving order
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const k of list) {
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(k);
  }
  return unique.length ? unique : undefined;
}

/** True when multiple keyword chips should be OR'd (multi-search union). */
export function needsKeywordOrSearch(state: SearchFilterState): boolean {
  return (state.keywords?.length ?? 0) > 1;
}

/**
 * One Typesense q per keyword for OR multi-search.
 * Combines location with each keyword: (loc+kw1) OR (loc+kw2) …
 */
export function buildKeywordOrQueries(state: SearchFilterState): string[] {
  const loc = state.location?.trim();
  const kws = state.keywords ?? [];
  return kws.map((kw) => {
    const parts = [loc, kw].filter((p): p is string => !!p?.trim());
    return parts.length ? parts.join(' ') : '*';
  });
}

/**
 * Build full-text q from location + keyword(s).
 * - 0 keywords: location or '*'
 * - 1 keyword: location + that keyword
 * - 2+ keywords: location only (keywords OR'd separately via multi-search)
 * Returns '*' if nothing to search (Typesense wildcard).
 */
export function buildSearchQuery(state: SearchFilterState): string {
  const terms: string[] = [];
  if (state.location?.trim()) {
    terms.push(state.location.trim());
  }
  if (state.keywords?.length === 1) {
    terms.push(state.keywords[0]);
  } else if (!state.keywords?.length && state.keyword?.trim()) {
    terms.push(state.keyword.trim());
  }
  // Multiple keywords: do not AND into q — caller uses multi-search OR
  if (terms.length === 0) return '*';
  return terms.join(' ');
}
