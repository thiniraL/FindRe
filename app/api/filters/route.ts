import { NextRequest } from 'next/server';
import {
  AppError,
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/utils/errors';
import { filtersQuerySchema, validateQuery } from '@/lib/security/validation';
import { getFilterConfigByPurpose } from '@/lib/db/queries/filters';

export const dynamic = 'force-dynamic';

const DEFAULT_COUNTRY_ID = 1;
const DEFAULT_CURRENCY_ID = 1;
const DEFAULT_LANGUAGE_CODE = 'en';

export async function GET(request: NextRequest) {
  try {
    const parsed = validateQuery(request, filtersQuerySchema);
    const { purpose, countryId, currencyId, languageCode } = parsed;

    const config = await getFilterConfigByPurpose({
      purposeKey: purpose,
      countryId: countryId ?? DEFAULT_COUNTRY_ID,
      currencyId: currencyId ?? DEFAULT_CURRENCY_ID,
      languageCode: languageCode ?? DEFAULT_LANGUAGE_CODE,
    });

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
