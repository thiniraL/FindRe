import { query } from '@/lib/db/client';

const DEFAULT_LANG = 'en';

/** Scope for filter options: purpose and optional country. */
export type FilterScope = {
  purposeKey: string;
  countryId?: number | null;
  currencyId?: number | null;
  languageCode?: string;
};

export type OptionItem = { value: string | number; label: string };

/** Option with main type ids; used for property type options so client can filter by selected main type. */
export type OptionItemWithMainTypes = OptionItem & { mainPropertyTypeIds?: number[] };

export type PropertyCountResult = { count: number; purpose_label: string };

export type RangeResult = { min: number; max: number } | null;

/**
 * Property count and purpose label for meta.resultButtonLabel.
 * Scoped by purpose_key and optional country (via location).
 * Returns one row even when no properties match (count 0, label from PURPOSES).
 */
export async function getPropertyCountByPurpose(
  scope: FilterScope
): Promise<PropertyCountResult> {
  const { purposeKey, countryId } = scope;
  const lang = scope.languageCode ?? DEFAULT_LANG;
  const res = await query<{ count: string; purpose_label: string }>(
    `
    SELECT
      COALESCE(SUM(c.cnt), 0)::text AS count,
      COALESCE(pur.name_translations->>$2, pur.name_translations->>'en') AS purpose_label
    FROM property.PURPOSES pur
    LEFT JOIN (
      SELECT p.purpose_id, COUNT(*)::bigint AS cnt
      FROM property.PROPERTIES p
      JOIN property.LOCATIONS l ON p.location_id = l.location_id
      WHERE ($3::int IS NULL OR l.country_id = $3)
      GROUP BY p.purpose_id
    ) c ON c.purpose_id = pur.purpose_id
    WHERE pur.purpose_key = $1
    GROUP BY pur.purpose_id, pur.name_translations
    `,
    [purposeKey, lang, countryId ?? null]
  );
  const row = res.rows[0];
  if (!row) return { count: 0, purpose_label: '' };
  return {
    count: parseInt(row.count, 10) || 0,
    purpose_label: row.purpose_label || '',
  };
}

const COMPLETION_STATUS_ALL_OPTION: OptionItem = {
  value: 'all',
  label: 'All',
};

/**
 * Completion status options from distinct PROPERTIES.completion_status, scoped by purpose (and optional country).
 * "All" means no filter (show all). Other options use raw completion_status column so future values appear automatically.
 */
export async function getCompletionStatusOptions(
  scope: FilterScope
): Promise<OptionItem[]> {
  const { purposeKey, countryId } = scope;
  const res = await query<{ completion_status: string }>(
    `
    SELECT DISTINCT p.completion_status
    FROM property.PROPERTIES p
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    JOIN property.LOCATIONS l ON p.location_id = l.location_id
    WHERE pur.purpose_key = $1
      AND p.completion_status IS NOT NULL
      AND ($2::int IS NULL OR l.country_id = $2)
    ORDER BY p.completion_status
    `,
    [purposeKey, countryId ?? null]
  );
  const dbOptions = res.rows.map((r) => ({
    value: r.completion_status,
    label: humanizeCompletionStatus(r.completion_status),
  }));
  return [COMPLETION_STATUS_ALL_OPTION, ...dbOptions];
}

function humanizeCompletionStatus(v: string): string {
  if (!v) return v;
  return v
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Main property types (e.g. Residential, Commercial) for filter options.
 */
export async function getMainPropertyTypesForFilter(
  languageCode: string = DEFAULT_LANG
): Promise<OptionItem[]> {
  const res = await query<{ main_type_id: number; label: string }>(
    `
    SELECT
      main_type_id,
      COALESCE(name_translations->>$1, name_translations->>'en') AS label
    FROM property.MAIN_PROPERTY_TYPES
    ORDER BY main_type_key
    `,
    [languageCode]
  );
  return res.rows.map((r) => ({
    value: r.main_type_id,
    label: r.label || String(r.main_type_id),
  }));
}

/**
 * Property types (sub types) for propertyTypeIds filter.
 * Each option includes mainPropertyTypeIds so client can filter options by selected main type(s).
 * value = type_id for search API (propertyTypeIds).
 */
export async function getPropertyTypesForFilter(
  languageCode: string = DEFAULT_LANG
): Promise<OptionItemWithMainTypes[]> {
  const res = await query<{ type_id: number; label: string; main_property_type_ids: number[] | null }>(
    `
    SELECT
      type_id,
      COALESCE(name_translations->>$1, name_translations->>'en') AS label,
      main_property_type_ids
    FROM property.PROPERTY_TYPES
    ORDER BY type_key
    `,
    [languageCode]
  );
  return res.rows.map((r) => ({
    value: r.type_id,
    label: r.label || String(r.type_id),
    mainPropertyTypeIds: r.main_property_type_ids ?? undefined,
  }));
}

/**
 * Min/max bedrooms from PROPERTY_DETAILS, scoped by purpose (and optional country).
 */
export async function getBedroomsRange(scope: FilterScope): Promise<RangeResult> {
  const { purposeKey, countryId } = scope;
  const res = await query<{ min_val: string; max_val: string }>(
    `
    SELECT MIN(pd.bedrooms)::text AS min_val, MAX(pd.bedrooms)::text AS max_val
    FROM property.PROPERTY_DETAILS pd
    JOIN property.PROPERTIES p ON pd.property_id = p.property_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    JOIN property.LOCATIONS l ON p.location_id = l.location_id
    WHERE pur.purpose_key = $1
      AND pd.bedrooms IS NOT NULL
      AND ($2::int IS NULL OR l.country_id = $2)
    `,
    [purposeKey, countryId ?? null]
  );
  const row = res.rows[0];
  if (!row || row.min_val == null || row.max_val == null) return null;
  const min = parseInt(row.min_val, 10);
  const max = parseInt(row.max_val, 10);
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  return { min, max };
}

/**
 * Min/max bathrooms from PROPERTY_DETAILS, scoped by purpose (and optional country).
 */
export async function getBathroomsRange(scope: FilterScope): Promise<RangeResult> {
  const { purposeKey, countryId } = scope;
  const res = await query<{ min_val: string; max_val: string }>(
    `
    SELECT MIN(pd.bathrooms)::text AS min_val, MAX(pd.bathrooms)::text AS max_val
    FROM property.PROPERTY_DETAILS pd
    JOIN property.PROPERTIES p ON pd.property_id = p.property_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    JOIN property.LOCATIONS l ON p.location_id = l.location_id
    WHERE pur.purpose_key = $1
      AND pd.bathrooms IS NOT NULL
      AND ($2::int IS NULL OR l.country_id = $2)
    `,
    [purposeKey, countryId ?? null]
  );
  const row = res.rows[0];
  if (!row || row.min_val == null || row.max_val == null) return null;
  const min = parseInt(row.min_val, 10);
  const max = parseInt(row.max_val, 10);
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  return { min, max };
}

/**
 * Min/max price from PROPERTIES (price, price_min, price_max), scoped by purpose (and optional country, currency).
 */
export async function getPriceRange(scope: FilterScope): Promise<RangeResult> {
  const { purposeKey, countryId, currencyId } = scope;
  const res = await query<{ min_val: string; max_val: string }>(
    `
    SELECT
      MIN(LEAST(
        COALESCE(p.price, 2147483647),
        COALESCE(p.price_min, 2147483647),
        COALESCE(p.price_max, 2147483647)
      ))::text AS min_val,
      MAX(GREATEST(
        COALESCE(p.price, 0),
        COALESCE(p.price_min, 0),
        COALESCE(p.price_max, 0)
      ))::text AS max_val
    FROM property.PROPERTIES p
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    JOIN property.LOCATIONS l ON p.location_id = l.location_id
    WHERE pur.purpose_key = $1
      AND (p.price IS NOT NULL OR p.price_min IS NOT NULL OR p.price_max IS NOT NULL)
      AND ($2::int IS NULL OR l.country_id = $2)
      AND ($3::int IS NULL OR p.currency_id = $3)
    `,
    [purposeKey, countryId ?? null, currencyId ?? null]
  );
  const row = res.rows[0];
  if (!row || row.min_val == null || row.max_val == null) return null;
  const min = Math.floor(parseFloat(row.min_val));
  const max = Math.ceil(parseFloat(row.max_val));
  if (Number.isNaN(min) || Number.isNaN(max) || min > max) return null;
  return { min, max };
}

/**
 * Min/max area (area_sqm) from PROPERTY_DETAILS, scoped by purpose (and optional country).
 */
export async function getAreaRange(scope: FilterScope): Promise<RangeResult> {
  const { purposeKey, countryId } = scope;
  const res = await query<{ min_val: string; max_val: string }>(
    `
    SELECT MIN(pd.area_sqm)::text AS min_val, MAX(pd.area_sqm)::text AS max_val
    FROM property.PROPERTY_DETAILS pd
    JOIN property.PROPERTIES p ON pd.property_id = p.property_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    JOIN property.LOCATIONS l ON p.location_id = l.location_id
    WHERE pur.purpose_key = $1
      AND pd.area_sqm IS NOT NULL
      AND ($2::int IS NULL OR l.country_id = $2)
    `,
    [purposeKey, countryId ?? null]
  );
  const row = res.rows[0];
  if (!row || row.min_val == null || row.max_val == null) return null;
  const min = Math.floor(parseFloat(row.min_val));
  const max = Math.ceil(parseFloat(row.max_val));
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  return { min, max };
}

/**
 * Distinct feature IDs from PROPERTY_DETAILS.feature_ids (scoped by purpose), with labels from FEATURES.
 * Used by filter config (featureIds); value = feature_id for search body.
 */
export async function getFeaturesForFilter(
  scope: FilterScope
): Promise<OptionItem[]> {
  const { purposeKey, countryId, languageCode } = scope;
  const lang = languageCode ?? DEFAULT_LANG;
  const res = await query<{ feature_id: number; label: string | null }>(
    `
    SELECT DISTINCT f.feature_id,
      COALESCE(f.name_translations->>$3, f.name_translations->>'en') AS label
    FROM property.PROPERTY_DETAILS pd
    JOIN property.PROPERTIES p ON pd.property_id = p.property_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    JOIN property.LOCATIONS l ON p.location_id = l.location_id
    CROSS JOIN LATERAL unnest(COALESCE(pd.feature_ids, '{}')) AS fid
    JOIN property.FEATURES f ON f.feature_id = fid AND f.is_active = TRUE
    WHERE pur.purpose_key = $1
      AND ($2::int IS NULL OR l.country_id = $2)
    ORDER BY label NULLS LAST, f.feature_id
    `,
    [purposeKey, countryId ?? null, lang]
  );
  return res.rows.map((r) => ({
    value: r.feature_id,
    label: r.label || String(r.feature_id),
  }));
}

/**
 * Keywords from property.KEYWORDS for filter config.
 * value = keyword_key (pass as search body "keyword" string); label = display_label or keyword_key.
 */
export async function getKeywordsForFilter(): Promise<OptionItem[]> {
  const res = await query<{ keyword_key: string; display_label: string | null }>(
    `
    SELECT keyword_key, display_label
    FROM property.KEYWORDS
    WHERE is_active = TRUE
    ORDER BY display_order ASC, keyword_key
    `
  );
  return res.rows.map((r) => ({
    value: r.keyword_key,
    label: r.display_label || r.keyword_key,
  }));
}

/**
 * Distinct agents that list properties for this purpose (and optional country).
 * Label: agent_name; if agency_id set, append agency name from AGENCIES.translations.
 */
export async function getAgentsForFilter(
  scope: FilterScope
): Promise<OptionItem[]> {
  const { purposeKey, countryId, languageCode } = scope;
  const lang = languageCode ?? DEFAULT_LANG;
  const res = await query<{ agent_id: number; agent_name: string; agency_name: string | null }>(
    `
    SELECT DISTINCT ON (a.agent_id)
      a.agent_id,
      a.agent_name,
      (ag.translations->$3)->>'name' AS agency_name
    FROM business.AGENTS a
    LEFT JOIN business.AGENCIES ag ON a.agency_id = ag.agency_id
    JOIN property.PROPERTIES p ON p.agent_id = a.agent_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    JOIN property.LOCATIONS l ON p.location_id = l.location_id
    WHERE pur.purpose_key = $1
      AND ($2::int IS NULL OR l.country_id = $2)
    ORDER BY a.agent_id, a.agent_name
    `,
    [purposeKey, countryId ?? null, lang]
  );
  return res.rows.map((r) => {
    const label = r.agency_name
      ? `${r.agent_name} (${r.agency_name})`
      : r.agent_name;
    return {
      value: r.agent_id,
      label: label || String(r.agent_id),
    };
  });
}

export type AgencyAgentSearchItem = {
  label: string;
  value: number;
  type: 'agency' | 'agent';
};

/**
 * Search agencies and agents by text; returns dropdown options with label, value, type.
 * Only active agencies and agents (status = 'active' case-insensitive).
 * Limit per type (default 10 each). Use searchAgenciesAndAgentsPaginated for page/limit/total.
 */
export async function searchAgenciesAndAgents(
  searchTerm: string,
  options?: { languageCode?: string; limitPerType?: number }
): Promise<AgencyAgentSearchItem[]> {
  const result = await searchAgenciesAndAgentsPaginated(searchTerm, {
    languageCode: options?.languageCode,
    page: 1,
    limit: Math.min(Math.max(options?.limitPerType ?? 10, 1), 50),
  });
  return result.items;
}

export type AgencyAgentSearchPaginatedResult = {
  items: AgencyAgentSearchItem[];
  total: number;
  page: number;
  limit: number;
};

/**
 * Search agencies and agents by text with pagination. Returns items, total, page, limit.
 * Only active agencies and agents (status = 'active' case-insensitive).
 */
export async function searchAgenciesAndAgentsPaginated(
  searchTerm: string,
  options?: { languageCode?: string; page?: number; limit?: number }
): Promise<AgencyAgentSearchPaginatedResult> {
  const lang = options?.languageCode === 'ar' ? 'ar' : 'en';
  const page = Math.max(options?.page ?? 1, 1);
  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
  const offset = (page - 1) * limit;
  const term = searchTerm.trim();

  if (!term) {
    return { items: [], total: 0, page, limit };
  }

  const agencyWhere = `LOWER(TRIM(COALESCE(status, ''))) = 'active'
    AND (COALESCE(translations->'en'->>'name', '') ILIKE '%' || $1 || '%'
         OR COALESCE(translations->'ar'->>'name', '') ILIKE '%' || $1 || '%')`;
  const agentWhere = `LOWER(TRIM(COALESCE(a.status, ''))) = 'active'
    AND (a.agent_name ILIKE '%' || $1 || '%' OR COALESCE(a.email, '') ILIKE '%' || $1 || '%')`;

  const [countRes, dataRes] = await Promise.all([
    query<{ count: string }>(
      `
      SELECT (
        (SELECT COUNT(*) FROM business.AGENCIES WHERE ${agencyWhere})
        + (SELECT COUNT(*) FROM business.AGENTS a LEFT JOIN business.AGENCIES ag ON ag.agency_id = a.agency_id WHERE ${agentWhere})
      )::text AS count
      `,
      [term]
    ),
    query<{ value: number; label: string; type: string }>(
      `
      (SELECT agency_id AS value, COALESCE(translations->$2->>'name', translations->'en'->>'name') AS label, 'agency' AS type
       FROM business.AGENCIES
       WHERE LOWER(TRIM(COALESCE(status, ''))) = 'active'
         AND (COALESCE(translations->'en'->>'name', '') ILIKE '%' || $1 || '%'
              OR COALESCE(translations->'ar'->>'name', '') ILIKE '%' || $1 || '%'))
      UNION ALL
      (SELECT a.agent_id AS value,
              CASE WHEN (ag.translations->$2->>'name') IS NOT NULL AND (ag.translations->$2->>'name') <> ''
                   THEN a.agent_name || ' (' || (ag.translations->$2->>'name') || ')'
                   ELSE COALESCE(a.agent_name, a.agent_id::text) END AS label,
              'agent' AS type
       FROM business.AGENTS a
       LEFT JOIN business.AGENCIES ag ON ag.agency_id = a.agency_id
       WHERE LOWER(TRIM(COALESCE(a.status, ''))) = 'active'
         AND (a.agent_name ILIKE '%' || $1 || '%' OR COALESCE(a.email, '') ILIKE '%' || $1 || '%'))
      ORDER BY label
      LIMIT $3 OFFSET $4
      `,
      [term, lang, limit, offset]
    ),
  ]);

  const total = parseInt(countRes.rows[0]?.count ?? '0', 10) || 0;
  const items: AgencyAgentSearchItem[] = dataRes.rows.map((r) => ({
    label: r.label || String(r.value),
    value: r.value,
    type: r.type === 'agency' ? ('agency' as const) : ('agent' as const),
  }));

  return { items, total, page, limit };
}
