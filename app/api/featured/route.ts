import { NextRequest } from 'next/server';
import {
  AppError,
  createErrorResponse,
  createPaginatedResponse,
} from '@/lib/utils/errors';
import { featuredQuerySchema, validateQuery } from '@/lib/security/validation';
import { PROPERTIES_QUERY_BY } from '@/lib/search/typesenseSchema';
import { typesenseSearch } from '@/lib/search/typesense';

function getLanguageCode(request: NextRequest): string {
  const acceptLanguage = request.headers.get('accept-language') || 'en';
  const first = acceptLanguage.split(',')[0]?.trim() || 'en';
  const lang = first.split('-')[0]?.trim().toLowerCase() || 'en';
  return lang.length ? lang : 'en';
}

export async function GET(request: NextRequest) {
  try {
    const parsed = validateQuery(request, featuredQuerySchema);
    const countryId = parsed.countryId;
    const page = parsed.page ?? 1;
    if (countryId === undefined) {
      throw new AppError('countryId is required', 400, 'COUNTRY_ID_REQUIRED');
    }
    const limit = parsed.limit || 25;
    const languageCode = getLanguageCode(request);
    const lang = languageCode === 'ar' ? 'ar' : 'en';

    type TypesensePropertyDoc = {
      property_id: string;
      price?: number;
      bedrooms?: number;
      bathrooms?: number;
      primary_image_url?: string;
      agent_id?: number;
      agent_name?: string;
      agent_profile_image_url?: string;
      agent_profile_slug?: string;
      title_en?: string;
      title_ar?: string;
      is_featured?: boolean;
      featured_rank?: number;
    };

    const resp = await typesenseSearch<TypesensePropertyDoc>({
      collection: 'properties',
      q: '*',
      queryBy: PROPERTIES_QUERY_BY,
      filterBy: `is_featured:=true && country_id:=${countryId}`,
      sortBy: 'featured_rank:asc',
      page,
      perPage: limit,
    });

    const items = resp.hits.map((h) => {
      const d = h.document;
      return {
        rank: d.featured_rank ?? null,
        property: {
          id: Number(d.property_id),
          title: lang === 'ar' ? d.title_ar ?? d.title_en ?? null : d.title_en ?? d.title_ar ?? null,
          description: null,
          price: d.price ?? null,
          currency: null,
          status: null,
          completionStatus: null,
          furnishingStatus: null,
          bedrooms: d.bedrooms ?? null,
          bathrooms: d.bathrooms ?? null,
          primaryImageUrl: d.primary_image_url ?? null,
          agent: d.agent_id
            ? {
              id: d.agent_id,
              name: d.agent_name ?? null,
              profileImageUrl: d.agent_profile_image_url ?? null,
              profileSlug: d.agent_profile_slug ?? null,
            }
            : null,
        },
      };
    });

    return createPaginatedResponse(items, page, limit, resp.found);
  } catch (error) {
    return createErrorResponse(error);
  }
}

