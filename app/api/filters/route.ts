import { NextRequest } from 'next/server';
import {
  AppError,
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/utils/errors';
import { filtersQuerySchema, validateQuery } from '@/lib/security/validation';
import { getFilterConfigByPurpose } from '@/lib/db/queries/filters';
import { filterConfigCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const DEFAULT_COUNTRY_ID = 1;
const DEFAULT_CURRENCY_ID = 1;
const DEFAULT_LANGUAGE_CODE = 'en';

function filterConfigCacheKey(
  purposeKey: string,
  countryId: number,
  currencyId: number,
  languageCode: string
): string {
  return `filters:${purposeKey}:${countryId}:${currencyId}:${languageCode}`;
}

/**
 * GET /api/filters returns stored config_json (options already in JSONB).
 * Options are kept up to date by the filter-config-refresh Edge Function;
 * no merge at request time for faster response.
 * Results are cached to reduce DB load.
 */
export async function GET(request: NextRequest) {
  try {
    const parsed = validateQuery(request, filtersQuerySchema);
    const { purpose, countryId, currencyId, languageCode } = parsed;
    const cid = countryId ?? DEFAULT_COUNTRY_ID;
    const curId = currencyId ?? DEFAULT_CURRENCY_ID;
    const lang = languageCode ?? DEFAULT_LANGUAGE_CODE;

    const cacheKey = filterConfigCacheKey(purpose, cid, curId, lang);
    let config = filterConfigCache.get<Awaited<ReturnType<typeof getFilterConfigByPurpose>>>(cacheKey);
    if (!config) {
      config = await getFilterConfigByPurpose({
        purposeKey: purpose,
        countryId: cid,
        currencyId: curId,
        languageCode: lang,
      });
      if (config) filterConfigCache.set(cacheKey, config);
    }

    if (!config) {
      throw new AppError(
        `No filter config found for purpose "${purpose}"`,
        404,
        'FILTER_CONFIG_NOT_FOUND'
      );
    }

    return createSuccessResponse({
      purposeKey: config.purpose_key,
      countryId: config.country_id,
      currencyId: config.currency_id,
      languageCode: config.language_code,
      version: config.version,
      config: config.config_json,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
