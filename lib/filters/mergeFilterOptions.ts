import type { SearchFilterConfigRow } from '@/lib/db/queries/filters';
import type { FilterScope } from '@/lib/db/queries/filterOptions';
import {
  getPropertyCountByPurpose,
  getCompletionStatusOptions,
  getPropertyTypesForFilter,
  getBedroomsRange,
  getBathroomsRange,
  getPriceRange,
  getAreaRange,
  getFeaturesForFilter,
  getAgentsForFilter,
} from '@/lib/db/queries/filterOptions';

type ConfigFilter = Record<string, unknown> & { id?: string; options?: unknown[]; min?: number; max?: number; defaultMin?: number; defaultMax?: number };
type ConfigWithFilters = Record<string, unknown> & {
  filters?: ConfigFilter[];
  meta?: Record<string, unknown> & { resultButtonLabel?: string; totalResults?: number };
};

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Merges live filter options and ranges from the DB into the stored filter config.
 * Sets meta.resultButtonLabel (purpose + property count), meta.totalResults,
 * and per-filter options or min/max/defaultMin/defaultMax where applicable.
 */
export async function mergeFilterOptions(
  configRow: SearchFilterConfigRow,
  scope: FilterScope
): Promise<Record<string, unknown>> {
  const config = deepClone(configRow.config_json) as ConfigWithFilters;
  const lang = scope.languageCode ?? 'en';

  const [
    countResult,
    completionOptions,
    propertyTypeOptions,
    bedroomsRange,
    bathroomsRange,
    priceRange,
    areaRange,
    featureOptions,
    agentOptions,
  ] = await Promise.all([
    getPropertyCountByPurpose(scope),
    getCompletionStatusOptions(scope),
    getPropertyTypesForFilter(lang),
    getBedroomsRange(scope),
    getBathroomsRange(scope),
    getPriceRange(scope),
    getAreaRange(scope),
    getFeaturesForFilter(scope),
    getAgentsForFilter(scope),
  ]);

  const totalCount = countResult.count;
  const purposeLabel = countResult.purpose_label || configRow.purpose_key;
  if (config.meta && typeof config.meta === 'object') {
    config.meta.totalResults = totalCount;
    config.meta.resultButtonLabel =
      totalCount === 0
        ? `${purposeLabel} – 0 properties`
        : `${purposeLabel} – ${totalCount.toLocaleString()} ${totalCount === 1 ? 'property' : 'properties'}`;
  }

  const filters = Array.isArray(config.filters) ? config.filters : [];
  for (const filter of filters) {
    const id = filter.id as string | undefined;
    if (!id) continue;

    switch (id) {
      case 'completion_status':
        filter.options = completionOptions;
        break;
      case 'property_type':
      case 'property_subtype':
        filter.options = propertyTypeOptions;
        break;
      case 'bedrooms':
        if (bedroomsRange) {
          filter.min = bedroomsRange.min;
          filter.max = bedroomsRange.max;
          filter.defaultMin = bedroomsRange.min;
          filter.defaultMax = bedroomsRange.max;
        }
        break;
      case 'bathrooms':
        if (bathroomsRange) {
          filter.min = bathroomsRange.min;
          filter.max = bathroomsRange.max;
          filter.defaultMin = bathroomsRange.min;
          filter.defaultMax = bathroomsRange.max;
        }
        break;
      case 'price':
        if (priceRange) {
          filter.min = priceRange.min;
          filter.max = priceRange.max;
          filter.defaultMin = priceRange.min;
          filter.defaultMax = priceRange.max;
        }
        break;
      case 'area':
        if (areaRange) {
          filter.min = areaRange.min;
          filter.max = areaRange.max;
          filter.defaultMin = areaRange.min;
          filter.defaultMax = areaRange.max;
        }
        break;
      case 'features':
        filter.options = featureOptions;
        break;
      case 'agent_or_agency':
        filter.options = agentOptions;
        break;
      default:
        break;
    }
  }

  return config as Record<string, unknown>;
}
