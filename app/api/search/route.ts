import { NextRequest } from 'next/server';
import { createErrorResponse, createPaginatedResponse } from '@/lib/utils/errors';
import { validateQuery } from '@/lib/security/validation';
import { searchQuerySchema } from '@/lib/security/validation';
import { PROPERTIES_QUERY_BY } from '@/lib/search/typesenseSchema';
import { typesenseSearch } from '@/lib/search/typesense';
import {
  buildFilterBy,
  buildSearchQuery,
  type SearchFilterState,
} from '@/lib/search/buildFilterQuery';
import {
  parseNaturalLanguageQuery,
  mergeNaturalLanguageIntoState,
} from '@/lib/search/naturalLanguageQuery';

export const dynamic = 'force-dynamic';

/**
 * Search pipeline (achieved):
 *   User text (q + explicit params)
 *     → NLP / Rule parser (parseNaturalLanguageQuery + mergeNaturalLanguageIntoState)
 *     → Structured query + filters (buildSearchQuery + buildFilterBy)
 *     → Typesense
 *     → Results
 */

const DEFAULT_COUNTRY_ID = 1;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;

type TypesensePropertyDoc = {
  property_id: string;
  country_id: number;
  purpose_id?: number;
  purpose_key?: string;
  property_type_id?: number;
  price?: number;
  currency_id?: number;
  bedrooms?: number;
  bathrooms?: number;
  area_sqft?: number;
  area_sqm?: number;
  address?: string;
  features?: string[];
  agent_id?: number;
  agent_name?: string;
  status?: string;
  is_off_plan?: boolean;
  is_featured?: boolean;
  featured_rank?: number;
  created_at?: number;
  updated_at?: number;
  title_en?: string;
  title_ar?: string;
  city_en?: string;
  area_en?: string;
  community_en?: string;
  primary_image_url?: string;
  additional_image_urls?: string[];
};

function parseOptionalIntList(value: string | undefined): number[] | undefined {
  if (!value?.trim()) return undefined;
  const parsed = value
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length ? parsed : undefined;
}

function parseOptionalStringList(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

function getLanguageCode(request: NextRequest): 'en' | 'ar' {
  const acceptLanguage = request.headers.get('accept-language') || 'en';
  const first = acceptLanguage.split(',')[0]?.trim() || 'en';
  const lang = first.split('-')[0]?.trim().toLowerCase() || 'en';
  return lang === 'ar' ? 'ar' : 'en';
}

export async function GET(request: NextRequest) {
  try {
    const parsed = validateQuery(request, searchQuerySchema);
    const lang = getLanguageCode(request);

    const filterState: SearchFilterState = {
      purpose: parsed.purpose,
      countryId: parsed.countryId ?? DEFAULT_COUNTRY_ID,
      location: parsed.location,
      completionStatus: parsed.completionStatus,
      propertyTypeIds: parseOptionalIntList(parsed.propertyTypeIds),
      bedroomsMin: parsed.bedroomsMin,
      bedroomsMax: parsed.bedroomsMax,
      bathroomsMin: parsed.bathroomsMin,
      bathroomsMax: parsed.bathroomsMax,
      priceMin: parsed.priceMin,
      priceMax: parsed.priceMax,
      areaMin: parsed.areaMin,
      areaMax: parsed.areaMax,
      areaUnit: parsed.areaUnit ?? 'sqm',
      keyword: parsed.keyword,
      agentId: parsed.agentId,
      featureKeys: parseOptionalStringList(parsed.featureKeys),
    };

    // Natural language query mapping: parse "q" and merge into filter state (explicit params override)
    if (parsed.q?.trim()) {
      const nlMapped = parseNaturalLanguageQuery(parsed.q);
      mergeNaturalLanguageIntoState(filterState, nlMapped);
    }

    // Use location + keyword for full-text q so Typesense matches place/terms, not the whole sentence
    const q = buildSearchQuery(filterState);
    const filterBy = buildFilterBy(filterState);

    const page = parsed.page ?? DEFAULT_PAGE;
    const perPage = parsed.limit ?? DEFAULT_LIMIT;

    const resp = await typesenseSearch<TypesensePropertyDoc>({
      collection: 'properties',
      q,
      queryBy: PROPERTIES_QUERY_BY,
      filterBy: filterBy ?? undefined,
      sortBy: 'updated_at:desc',
      page,
      perPage,
    });

    const items = resp.hits.map((h) => {
      const d = h.document;
      const locationParts = [d.address].filter(Boolean);
      const location = locationParts.length ? locationParts.join(', ') : null;
      return {
        property: {
          id: Number(d.property_id),
          title:
            lang === 'ar'
              ? d.title_ar ?? d.title_en ?? null
              : d.title_en ?? d.title_ar ?? null,
          location,
          price: d.price ?? null,
          bedrooms: d.bedrooms ?? null,
          bathrooms: d.bathrooms ?? null,
          primaryImageUrl: d.primary_image_url ?? null,
          agent: d.agent_id
            ? { id: d.agent_id, name: d.agent_name ?? null }
            : null,
          additionalImageUrls: d.additional_image_urls ?? [],
        },
      };
    });

    return createPaginatedResponse(items, page, perPage, resp.found);
  } catch (error) {
    return createErrorResponse(error);
  }
}
