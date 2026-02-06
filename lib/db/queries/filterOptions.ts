import { query } from '@/lib/db/client';

const DEFAULT_LANG = 'en';

/** Scope for filter options: purpose and optional country. */
export type FilterScope = {
  purposeKey: string;
  countryId?: number | null;
  currencyId?: number | null;
  languageCode?: string;
};

export type OptionItem = { value: string | number; label: string; enabled?: boolean };

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
  enabled: true,
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
    enabled: true,
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
 * Property types for property_type and property_subtype filters.
 * value = type_id for search API (propertyTypeIds).
 */
export async function getPropertyTypesForFilter(
  languageCode: string = DEFAULT_LANG
): Promise<OptionItem[]> {
  const res = await query<{ type_id: number; label: string }>(
    `
    SELECT
      type_id,
      COALESCE(name_translations->>$1, name_translations->>'en') AS label
    FROM property.PROPERTY_TYPES
    ORDER BY type_key
    `,
    [languageCode]
  );
  return res.rows.map((r) => ({
    value: r.type_id,
    label: r.label || String(r.type_id),
    enabled: true,
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
 * Distinct feature keys from PROPERTY_DETAILS.features (scoped by purpose), with labels from FEATURES.
 */
export async function getFeaturesForFilter(
  scope: FilterScope
): Promise<OptionItem[]> {
  const { purposeKey, countryId, languageCode } = scope;
  const lang = languageCode ?? DEFAULT_LANG;
  const res = await query<{ feature_key: string; label: string | null }>(
    `
    SELECT DISTINCT elem AS feature_key,
      COALESCE(f.name_translations->>$3, f.name_translations->>'en') AS label
    FROM property.PROPERTY_DETAILS pd
    JOIN property.PROPERTIES p ON pd.property_id = p.property_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    JOIN property.LOCATIONS l ON p.location_id = l.location_id
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(pd.features, '[]'::jsonb)) AS elem
    LEFT JOIN property.FEATURES f ON f.feature_key = elem AND f.is_active = TRUE
    WHERE pur.purpose_key = $1
      AND ($2::int IS NULL OR l.country_id = $2)
    ORDER BY label NULLS LAST, feature_key
    `,
    [purposeKey, countryId ?? null, lang]
  );
  return res.rows.map((r) => ({
    value: r.feature_key,
    label: r.label || humanizeCompletionStatus(r.feature_key),
    enabled: true,
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
      enabled: true,
    };
  });
}
