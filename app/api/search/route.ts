import { NextRequest } from 'next/server';
import { createErrorResponse, createPaginatedResponse } from '@/lib/utils/errors';
import { validateQuery, validateBody } from '@/lib/security/validation';
import { searchQuerySchema, searchBodySchema } from '@/lib/security/validation';
import { PROPERTIES_QUERY_BY } from '@/lib/search/typesenseSchema';
import { typesenseSearch } from '@/lib/search/typesense';
import {
  buildFilterBy,
  buildSearchQuery,
  type SearchFilterState,
} from '@/lib/search/buildFilterQuery';
// GET/POST keys match SEARCH_FILTER_CONFIGS filter id (see lib/search/filterConfigToSearchKeys.ts; price→priceMin/priceMax, area→areaMin/areaMax; area always sqm)
import {
  parseNaturalLanguageQuery,
  mergeNaturalLanguageIntoState,
  PURPOSE_WORDS_SET,
  SEARCH_STOPWORDS,
} from '@/lib/search/naturalLanguageQuery';
import { getPropertyViewStatus } from '@/lib/db/queries/propertyViews';
import { verifyAccessToken } from '@/lib/auth/jwt';

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
  agent_email?: string;
  agent_phone?: string;
  agent_whatsapp?: string;
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

/** Parse comma-separated bedrooms/bathrooms; allows "6+" for 6 or more. */
function parseBedroomsBathsList(value: string | undefined): (number | string)[] | undefined {
  if (!value?.trim()) return undefined;
  const out: (number | string)[] = [];
  for (const s of value.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (/^\d+\+$/.test(s)) out.push(s);
    else {
      const n = parseInt(s, 10);
      if (Number.isFinite(n) && n >= 0) out.push(n);
    }
  }
  return out.length ? out : undefined;
}

/** Normalize keyword to a single search string: array -> join with space; string (comma-separated ok) -> trimmed. */
function normalizeKeyword(value: string | string[] | undefined): string | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const joined = value.map((s) => String(s).trim()).filter(Boolean).join(' ');
    return joined.length ? joined : undefined;
  }
  const s = String(value).trim();
  if (!s) return undefined;
  return s.includes(',') ? s.split(',').map((x) => x.trim()).filter(Boolean).join(' ') : s;
}

function getLanguageCode(request: NextRequest): 'en' | 'ar' {
  const acceptLanguage = request.headers.get('accept-language') || 'en';
  const first = acceptLanguage.split(',')[0]?.trim() || 'en';
  const lang = first.split('-')[0]?.trim().toLowerCase() || 'en';
  return lang === 'ar' ? 'ar' : 'en';
}

function getSessionId(request: NextRequest): string | null {
  const sessionId = request.headers.get('x-session-id');
  if (!sessionId?.trim()) return null;
  return sessionId.trim();
}

function tryGetUserIdFromAuthHeader(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  if (!token) return null;
  try {
    const payload = verifyAccessToken(token);
    return payload.userId;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const parsed = validateQuery(request, searchQuerySchema);

    // Normalize purpose: lowercase, spaces -> underscore (so "For Sale" / "for_sale" match Typesense)
    const normalizedPurpose = parsed.purpose?.trim().toLowerCase().replace(/\s+/g, '_') ?? '';

    const filterState: SearchFilterState = {
      purpose: normalizedPurpose,
      countryId: parsed.countryId ?? DEFAULT_COUNTRY_ID,
      location: parsed.location,
      completionStatus: parsed.completionStatus,
      mainPropertyTypeIds: parseOptionalIntList(parsed.mainPropertyTypeIds)?.filter((n) => n >= 1),
      propertyTypeIds: parseOptionalIntList(parsed.propertyTypeIds),
      bedrooms: parseBedroomsBathsList(parsed.bedrooms),
      bathrooms: parseBedroomsBathsList(parsed.bathrooms)?.filter(
        (v) => typeof v === 'string' || v >= 1
      ),
      priceMin: parsed.priceMin,
      priceMax: parsed.priceMax,
      areaMin: parsed.areaMin,
      areaMax: parsed.areaMax,
      keyword: normalizeKeyword(parsed.keyword),
      agentIds: parseOptionalIntList(parsed.agentIds)?.filter((n) => n >= 1),
      featureIds: parseOptionalIntList(parsed.featureIds)?.filter((n) => n >= 1),
    };

    // Natural language query mapping: parse "q" and merge into filter state (explicit params override)
    if (parsed.q?.trim()) {
      const nlMapped = parseNaturalLanguageQuery(parsed.q);
      mergeNaturalLanguageIntoState(filterState, nlMapped);
    }

    // If purpose still empty after NL merge (no param, no purpose word in q), default to for_sale
    if (!filterState.purpose?.trim()) {
      filterState.purpose = 'for_sale';
    }

    const page = parsed.page ?? DEFAULT_PAGE;
    const perPage = parsed.limit ?? DEFAULT_LIMIT;

    const { items, found } = await runSearch(filterState, page, perPage, request);
    return createPaginatedResponse(items, page, perPage, found);
  } catch (error) {
    return createErrorResponse(error);
  }
}

function stripStopwords(s: string | undefined): string | undefined {
  if (!s?.trim()) return s;
  const cleaned = s
    .split(/\s+/)
    .filter((w) => !PURPOSE_WORDS_SET.has(w.toLowerCase()) && !SEARCH_STOPWORDS.has(w.toLowerCase()))
    .join(' ')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

async function runSearch(
  filterState: SearchFilterState,
  page: number,
  perPage: number,
  request: NextRequest
): Promise<{ items: Array<{ property: object }>; found: number }> {
  const lang = getLanguageCode(request);
  if (filterState.location) filterState.location = stripStopwords(filterState.location);
  if (filterState.keyword) filterState.keyword = stripStopwords(filterState.keyword);

  const q = buildSearchQuery(filterState);
  const filterBy = buildFilterBy(filterState);

  const resp = await typesenseSearch<TypesensePropertyDoc>({
    collection: 'properties',
    q,
    queryBy: PROPERTIES_QUERY_BY,
    filterBy: filterBy ?? undefined,
    sortBy: 'updated_at:desc',
    page,
    perPage,
  });

  const sessionId = getSessionId(request);
  const userId = tryGetUserIdFromAuthHeader(request);

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
            ? {
                id: d.agent_id,
                name: d.agent_name ?? null,
                email: d.agent_email ?? null,
                phone: d.agent_phone ?? null,
                whatsapp: d.agent_whatsapp ?? null,
              }
            : null,
        additionalImageUrls: d.additional_image_urls ?? [],
        purposeKey: d.purpose_key ?? null,
          isLiked: false,
      },
    };
  });

  if (sessionId) {
    const propertyIds = items.map((i) => i.property.id);
    const viewStatusMap = await getPropertyViewStatus(propertyIds, sessionId, userId);
    items.forEach((item) => {
      const status = viewStatusMap.get(item.property.id);
      if (status) {
        item.property.isLiked = status.isLiked;
      }
    });
  }

  return { items, found: resp.found };
}

export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(request, searchBodySchema);

    const normalizedPurpose = body.purpose?.trim().toLowerCase().replace(/\s+/g, '_') ?? '';

    const filterState: SearchFilterState = {
      purpose: normalizedPurpose,
      countryId: body.countryId ?? DEFAULT_COUNTRY_ID,
      location: body.location,
      completionStatuses: body.completionStatus?.length ? body.completionStatus : undefined,
      mainPropertyTypeIds: body.mainPropertyTypeIds?.length ? body.mainPropertyTypeIds : undefined,
      propertyTypeIds: body.propertyTypeIds,
      bedrooms: body.bedrooms?.length ? body.bedrooms : undefined,
      bathrooms: body.bathrooms?.length ? body.bathrooms : undefined,
      priceMin: body.priceMin,
      priceMax: body.priceMax,
      areaMin: body.areaMin,
      areaMax: body.areaMax,
      keyword: normalizeKeyword(body.keyword),
      agentIds: body.agentIds?.length ? body.agentIds : undefined,
      featureIds: body.featureIds?.length ? body.featureIds : undefined,
    };

    if (body.q?.trim()) {
      const nlMapped = parseNaturalLanguageQuery(body.q);
      mergeNaturalLanguageIntoState(filterState, nlMapped);
    }
    if (!filterState.purpose?.trim()) {
      filterState.purpose = 'for_sale';
    }

    const page = body.page ?? DEFAULT_PAGE;
    const perPage = body.limit ?? DEFAULT_LIMIT;

    const { items, found } = await runSearch(filterState, page, perPage, request);
    return createPaginatedResponse(items, page, perPage, found);
  } catch (error) {
    return createErrorResponse(error);
  }
}
