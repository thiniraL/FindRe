// @ts-nocheck
// Supabase Edge Function: filter-config-refresh
// - Called by a separate cron schedule (e.g. every 15 min)
// - Loads all active SEARCH_FILTER_CONFIGS, merges live options from DB into config_json, writes back
// - GET /api/filters can then return stored JSONB without merging at request time
//
// Required env: SUPABASE_DB_URL (direct Postgres connection string)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { Pool } from 'https://deno.land/x/postgres@v0.17.0/mod.ts';

const DEFAULT_COUNTRY_ID = 1;
const DEFAULT_CURRENCY_ID = 1;
const DEFAULT_LANG = 'en';

function mustGetEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v || !v.trim()) throw new Error(`Missing env: ${key}`);
  return v.trim();
}

type ConfigRow = {
  config_id: number;
  purpose_key: string;
  country_id: number | null;
  currency_id: number | null;
  language_code: string | null;
  config_json: Record<string, unknown>;
};

type OptionItem = { value: string | number; label: string };
type OptionItemWithMain = OptionItem & { mainPropertyTypeIds?: number[] };
type RangeResult = { min: number; max: number } | null;

function humanizeCompletionStatus(v: string): string {
  if (!v) return v;
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getAllActiveConfigs(pool: Pool): Promise<ConfigRow[]> {
  const client = await pool.connect();
  try {
    const res = await client.queryObject<ConfigRow>(
      `SELECT config_id, purpose_key, country_id, currency_id, language_code, config_json
       FROM master.SEARCH_FILTER_CONFIGS WHERE is_active = TRUE ORDER BY config_id`
    );
    return res.rows;
  } finally {
    client.release();
  }
}

async function getPropertyCount(
  client: any,
  purposeKey: string,
  countryId: number | null,
  lang: string
): Promise<{ count: number; purpose_label: string }> {
  const res = await client.queryObject<{ count: string; purpose_label: string }>(
    `SELECT COALESCE(SUM(c.cnt), 0)::text AS count,
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
     GROUP BY pur.purpose_id, pur.name_translations`,
    [purposeKey, lang, countryId]
  );
  const row = res.rows[0];
  if (!row) return { count: 0, purpose_label: '' };
  return { count: parseInt(row.count, 10) || 0, purpose_label: row.purpose_label || '' };
}

async function getCompletionOptions(
  client: any,
  purposeKey: string,
  countryId: number | null
): Promise<OptionItem[]> {
  const res = await client.queryObject<{ completion_status: string }>(
    `SELECT DISTINCT p.completion_status FROM property.PROPERTIES p
     JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
     JOIN property.LOCATIONS l ON p.location_id = l.location_id
     WHERE pur.purpose_key = $1 AND p.completion_status IS NOT NULL
       AND ($2::int IS NULL OR l.country_id = $2)
     ORDER BY p.completion_status`,
    [purposeKey, countryId]
  );
  const all: OptionItem = { value: 'all', label: 'All' };
  const rest = res.rows.map((r) => ({
    value: r.completion_status,
    label: humanizeCompletionStatus(r.completion_status),
  }));
  return [all, ...rest];
}

async function getMainPropertyTypes(client: any, lang: string): Promise<OptionItem[]> {
  const res = await client.queryObject<{ main_type_id: number; label: string }>(
    `SELECT main_type_id, COALESCE(name_translations->>$1, name_translations->>'en') AS label
     FROM property.MAIN_PROPERTY_TYPES ORDER BY main_type_key`,
    [lang]
  );
  return res.rows.map((r) => ({ value: r.main_type_id, label: r.label || String(r.main_type_id) }));
}

async function getPropertyTypes(
  client: any,
  lang: string
): Promise<OptionItemWithMain[]> {
  const res = await client.queryObject<{
    type_id: number;
    label: string;
    main_property_type_ids: number[] | null;
  }>(
    `SELECT type_id, COALESCE(name_translations->>$1, name_translations->>'en') AS label, main_property_type_ids
     FROM property.PROPERTY_TYPES ORDER BY type_key`,
    [lang]
  );
  return res.rows.map((r) => ({
    value: r.type_id,
    label: r.label || String(r.type_id),
    mainPropertyTypeIds: r.main_property_type_ids ?? undefined,
  }));
}

async function getPriceRange(
  client: any,
  purposeKey: string,
  countryId: number | null,
  currencyId: number | null
): Promise<RangeResult> {
  const res = await client.queryObject<{ min_val: string; max_val: string }>(
    `SELECT MIN(LEAST(COALESCE(p.price, 2147483647), COALESCE(p.price_min, 2147483647), COALESCE(p.price_max, 2147483647)))::text AS min_val,
            MAX(GREATEST(COALESCE(p.price, 0), COALESCE(p.price_min, 0), COALESCE(p.price_max, 0)))::text AS max_val
     FROM property.PROPERTIES p
     JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
     JOIN property.LOCATIONS l ON p.location_id = l.location_id
     WHERE pur.purpose_key = $1 AND (p.price IS NOT NULL OR p.price_min IS NOT NULL OR p.price_max IS NOT NULL)
       AND ($2::int IS NULL OR l.country_id = $2) AND ($3::int IS NULL OR p.currency_id = $3)`,
    [purposeKey, countryId, currencyId]
  );
  const row = res.rows[0];
  if (!row || row.min_val == null || row.max_val == null) return null;
  const min = Math.floor(parseFloat(row.min_val));
  const max = Math.ceil(parseFloat(row.max_val));
  if (Number.isNaN(min) || Number.isNaN(max) || min > max) return null;
  return { min, max };
}

async function getAreaRange(
  client: any,
  purposeKey: string,
  countryId: number | null
): Promise<RangeResult> {
  const res = await client.queryObject<{ min_val: string; max_val: string }>(
    `SELECT MIN(pd.area_sqm)::text AS min_val, MAX(pd.area_sqm)::text AS max_val
     FROM property.PROPERTY_DETAILS pd
     JOIN property.PROPERTIES p ON pd.property_id = p.property_id
     JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
     JOIN property.LOCATIONS l ON p.location_id = l.location_id
     WHERE pur.purpose_key = $1 AND pd.area_sqm IS NOT NULL
       AND ($2::int IS NULL OR l.country_id = $2)`,
    [purposeKey, countryId]
  );
  const row = res.rows[0];
  if (!row || row.min_val == null || row.max_val == null) return null;
  const min = Math.floor(parseFloat(row.min_val));
  const max = Math.ceil(parseFloat(row.max_val));
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  return { min, max };
}

async function getFeatures(
  client: any,
  purposeKey: string,
  countryId: number | null,
  lang: string
): Promise<OptionItem[]> {
  const res = await client.queryObject<{ feature_id: number; label: string | null }>(
    `SELECT DISTINCT f.feature_id, COALESCE(f.name_translations->>$3, f.name_translations->>'en') AS label
     FROM property.PROPERTY_DETAILS pd
     JOIN property.PROPERTIES p ON pd.property_id = p.property_id
     JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
     JOIN property.LOCATIONS l ON p.location_id = l.location_id
     CROSS JOIN LATERAL unnest(COALESCE(pd.feature_ids, '{}')) AS fid
     JOIN property.FEATURES f ON f.feature_id = fid AND f.is_active = TRUE
     WHERE pur.purpose_key = $1 AND ($2::int IS NULL OR l.country_id = $2)
     ORDER BY label NULLS LAST, f.feature_id`,
    [purposeKey, countryId, lang]
  );
  return res.rows.map((r) => ({
    value: r.feature_id,
    label: r.label || String(r.feature_id),
  }));
}

async function getKeywords(client: any): Promise<OptionItem[]> {
  const res = await client.queryObject<{ keyword_key: string; display_label: string | null }>(
    `SELECT keyword_key, display_label FROM property.KEYWORDS WHERE is_active = TRUE ORDER BY display_order ASC, keyword_key`
  );
  return res.rows.map((r) => ({
    value: r.keyword_key,
    label: r.display_label || r.keyword_key,
  }));
}

async function fetchOptionsForScope(
  client: any,
  purposeKey: string,
  countryId: number,
  currencyId: number,
  lang: string
) {
  const [
    countResult,
    completionOptions,
    mainPropertyTypeOptions,
    propertyTypeOptions,
    priceRange,
    areaRange,
    featureOptions,
    keywordOptions,
  ] = await Promise.all([
    getPropertyCount(client, purposeKey, countryId, lang),
    getCompletionOptions(client, purposeKey, countryId),
    getMainPropertyTypes(client, lang),
    getPropertyTypes(client, lang),
    getPriceRange(client, purposeKey, countryId, currencyId),
    getAreaRange(client, purposeKey, countryId),
    getFeatures(client, purposeKey, countryId, lang),
    getKeywords(client),
  ]);

  return {
    countResult,
    completionOptions,
    mainPropertyTypeOptions,
    propertyTypeOptions,
    priceRange,
    areaRange,
    featureOptions,
    keywordOptions,
  };
}

type MergedOpts = {
  countResult: { count: number; purpose_label: string };
  completionOptions: OptionItem[];
  mainPropertyTypeOptions: OptionItem[];
  propertyTypeOptions: OptionItemWithMain[];
  priceRange: RangeResult;
  areaRange: RangeResult;
  featureOptions: OptionItem[];
  keywordOptions: OptionItem[];
};

/** Build nested options: main types first, then under each main type the property types whose main_property_type_ids contains that main id (inner options only label + value). */
function buildNestedPropertyTypeOptions(
  mainPropertyTypeOptions: OptionItem[],
  propertyTypeOptions: OptionItemWithMain[]
): { label: string; value: number; options: { label: string; value: number }[] }[] {
  return mainPropertyTypeOptions.map((main) => ({
    label: main.label,
    value: main.value as number,
    options: propertyTypeOptions
      .filter((pt) => (pt.mainPropertyTypeIds ?? []).includes(main.value as number))
      .map((pt) => ({ label: pt.label, value: pt.value as number })),
  }));
}

function mergeOptionsIntoConfig(
  config: Record<string, unknown>,
  opts: MergedOpts,
  purposeKey: string
): Record<string, unknown> {
  const cfg = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const filtersIn = (cfg.filters as Record<string, unknown>[] | undefined) ?? [];
  const meta = cfg.meta as Record<string, unknown> | undefined;
  const { countResult, completionOptions, mainPropertyTypeOptions, propertyTypeOptions, priceRange, areaRange, featureOptions, keywordOptions } = opts;
  const totalCount = countResult.count;
  const purposeLabel = countResult.purpose_label || purposeKey;
  if (meta && typeof meta === 'object') {
    meta.totalResults = totalCount;
    meta.resultButtonLabel =
      totalCount === 0
        ? `${purposeLabel} – 0 properties`
        : `${purposeLabel} – ${totalCount.toLocaleString()} ${totalCount === 1 ? 'property' : 'properties'}`;
  }
  const nestedPropertyTypeOptions = buildNestedPropertyTypeOptions(mainPropertyTypeOptions, propertyTypeOptions);
  const filters: Record<string, unknown>[] = [];
  for (const filter of filtersIn) {
    const id = filter.id as string | undefined;
    if (!id) continue;
    if (id === 'mainPropertyTypeIds') continue;
    switch (id) {
      case 'completionStatus':
        filter.options = completionOptions;
        break;
      case 'propertyTypeIds':
        (filter as Record<string, unknown>).type = 'checkbox-group-property';
        filter.options = nestedPropertyTypeOptions;
        delete (filter as Record<string, unknown>).dependsOn;
        break;
      case 'bedrooms':
      case 'bathrooms':
        break;
      case 'price':
        if (priceRange) {
          filter.min = priceRange.min;
          filter.max = priceRange.max;
          filter.defaultMin = priceRange.min;
          filter.defaultMax = priceRange.max;
          (filter as Record<string, unknown>).apiSample = [priceRange.min, priceRange.max];
        }
        break;
      case 'area':
        if (areaRange) {
          filter.min = areaRange.min;
          filter.max = areaRange.max;
          filter.defaultMin = areaRange.min;
          filter.defaultMax = areaRange.max;
          (filter as Record<string, unknown>).apiSample = [areaRange.min, areaRange.max];
        }
        break;
      case 'featureIds':
        filter.options = featureOptions;
        break;
      case 'agentIds':
        (filter as Record<string, unknown>).type = 'multi-select';
        (filter as Record<string, unknown>).searchable = true;
        delete (filter as Record<string, unknown>).options;
        (filter as Record<string, unknown>).apiSample = [
          { id: 1, type: 'agent' },
          { id: 2, type: 'agency' },
        ];
        break;
      case 'keyword':
        filter.options = keywordOptions;
        break;
      default:
        break;
    }
    filters.push(filter);
  }
  cfg.filters = filters;
  return cfg as Record<string, unknown>;
}

async function updateConfigJson(
  client: any,
  configId: number,
  configJson: Record<string, unknown>
): Promise<void> {
  await client.queryArray(
    `UPDATE master.SEARCH_FILTER_CONFIGS SET config_json = $1::jsonb, updated_at = NOW() AT TIME ZONE 'UTC' WHERE config_id = $2`,
    [JSON.stringify(configJson), configId]
  );
}

serve(async (req) => {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const dbUrl = mustGetEnv('SUPABASE_DB_URL');
    const pool = new Pool(dbUrl, 2, true);
    const configs = await getAllActiveConfigs(pool);
    let updated = 0;
    const client = await pool.connect();
    try {
      for (const row of configs) {
        const countryId = row.country_id ?? DEFAULT_COUNTRY_ID;
        const currencyId = row.currency_id ?? DEFAULT_CURRENCY_ID;
        const lang = row.language_code ?? DEFAULT_LANG;
        const opts = await fetchOptionsForScope(
          client,
          row.purpose_key,
          countryId,
          currencyId,
          lang
        );
        const merged = mergeOptionsIntoConfig(
          row.config_json,
          opts,
          row.purpose_key
        );
        await updateConfigJson(client, row.config_id, merged);
        updated += 1;
      }
    } finally {
      client.release();
    }
    await pool.end();
    return new Response(
      JSON.stringify({ ok: true, updated }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('filter-config-refresh error:', message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
