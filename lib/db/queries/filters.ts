import { query } from '@/lib/db/client';

export type SearchFilterConfigRow = {
  config_id: number;
  purpose_key: string;
  country_id: number | null;
  currency_id: number | null;
  language_code: string | null;
  version: number;
  config_json: Record<string, unknown>;
};

/**
 * Get the active search filter config for a given purpose and optional scope.
 * Returns the latest version for the scope (country_id, currency_id, language_code).
 * Null scope params use DB NULL (global/default).
 */
export async function getFilterConfigByPurpose(options: {
  purposeKey: string;
  countryId?: number;
  currencyId?: number;
  languageCode?: string;
}): Promise<SearchFilterConfigRow | null> {
  const { purposeKey, countryId, currencyId, languageCode } = options;
  const res = await query<SearchFilterConfigRow>(
    `
    SELECT config_id, purpose_key, country_id, currency_id, language_code, version, config_json
    FROM master.SEARCH_FILTER_CONFIGS
    WHERE is_active = TRUE
      AND purpose_key = $1
      AND (country_id IS NOT DISTINCT FROM $2)
      AND (currency_id IS NOT DISTINCT FROM $3)
      AND (language_code IS NOT DISTINCT FROM $4)
    ORDER BY version DESC
    LIMIT 1
    `,
    [
      purposeKey,
      countryId ?? null,
      currencyId ?? null,
      languageCode ?? null,
    ]
  );
  return res.rows[0] ?? null;
}
