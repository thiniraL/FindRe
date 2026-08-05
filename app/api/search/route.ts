import { NextRequest } from 'next/server';
import { createErrorResponse, createPaginatedResponse } from '@/lib/utils/errors';
import { validateQuery, validateBody } from '@/lib/security/validation';
import { searchQuerySchema, searchBodySchema, agentIdFilterEntrySchema } from '@/lib/security/validation';
import { PROPERTIES_QUERY_BY } from '@/lib/search/typesenseSchema';
import { typesenseSearch } from '@/lib/search/typesense';
import {
  buildFilterBy,
  buildSearchQuery,
  type SearchFilterState,
} from '@/lib/search/buildFilterQuery';
// GET/POST keys match SEARCH_FILTER_CONFIGS filter id (see lib/search/filterConfigToSearchKeys.ts; price→priceMin/priceMax, area→areaMin/areaMax; area always sqm)
import {
  applyNaturalLanguageQuery,
  getTypesenseNlQuery,
  resolveNaturalLanguageSearchMode,
  PURPOSE_WORDS_SET,
  SEARCH_STOPWORDS,
} from '@/lib/search/naturalLanguageQuery';
import { getPropertyViewStatus } from '@/lib/db/queries/propertyViews';
import { verifyAccessToken } from '@/lib/auth/jwt';

export const dynamic = 'force-dynamic';

/**
 * Search pipeline:
 *   nl_query=true + nl_model_id only when q is non-empty and TYPESENSE_NL_MODEL_ID is set.
 *   Empty/missing q → normal Typesense search (no NL params).
 *   Explicit nl_query=false opts out even when q is set.
 *   Rule-based parse still merges beds/baths/price/purpose/property type into filter_by
 *     as a reliability assist alongside the LLM when NL is on.
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
  agency_id?: number;
  agency_name?: string;
  profile_image_url?: string;
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
  all_image_urls?: string[];
  image_is_featured?: number[];
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

/** Parse agentIds from GET query (JSON string). Expects [{"id": number, "type": "agent"|"agency"}, ...]. */
function parseAgentIdsFromQuery(value: string | undefined): { id: number; type: 'agency' | 'agent' }[] | undefined {
  if (!value?.trim()) return undefined;
  try {
    const raw = JSON.parse(value) as unknown;
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    const out: { id: number; type: 'agency' | 'agent' }[] = [];
    for (const item of raw) {
      const r = agentIdFilterEntrySchema.safeParse(item);
      if (r.success) out.push(r.data);
    }
    return out.length ? out : undefined;
  } catch {
    return undefined;
  }
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
      agentIds: parseAgentIdsFromQuery(parsed.agentIds),
      featureIds: parseOptionalIntList(parsed.featureIds)?.filter((n) => n >= 1),
    };

    // Non-empty q → Typesense NL (nl_query=true). Explicit nl_query=false opts out.
    const nlModelId = process.env.TYPESENSE_NL_MODEL_ID?.trim() || undefined;
    const { qValue, willUseNl } = resolveNaturalLanguageSearchMode(
      parsed.q,
      nlModelId,
      parsed.nl_query === false
    );

    if (qValue) {
      applyNaturalLanguageQuery(filterState, qValue, { structuredOnly: willUseNl });
    }

    // Default purpose only for non-NL search. NL lets the model set purpose_key (e.g. for_rent).
    if (!willUseNl && !filterState.purpose?.trim()) {
      filterState.purpose = 'for_sale';
    }

    const page = parsed.page ?? DEFAULT_PAGE;
    const perPage = parsed.limit ?? DEFAULT_LIMIT;

    const { items, found } = await runSearch(filterState, page, perPage, request, {
      useNlQuery: willUseNl,
      rawQ: qValue || undefined,
      nlModelId,
    });
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

type RunSearchNlOptions = {
  useNlQuery: boolean;
  rawQ?: string;
  nlModelId?: string;
};

async function runSearch(
  filterState: SearchFilterState,
  page: number,
  perPage: number,
  request: NextRequest,
  nlOptions?: RunSearchNlOptions
): Promise<{ items: Array<{ property: object }>; found: number }> {
  const lang = getLanguageCode(request);
  if (filterState.location) filterState.location = stripStopwords(filterState.location);
  if (filterState.keyword) filterState.keyword = stripStopwords(filterState.keyword);

  const useNl = !!(nlOptions?.useNlQuery && nlOptions?.nlModelId);
  // NL mode: send the original natural-language sentence to Typesense (nl_query + nl_model_id).
  const q = useNl
    ? getTypesenseNlQuery(nlOptions!.rawQ?.trim() || '')
    : buildSearchQuery(filterState);
  const filterBy = buildFilterBy(filterState);

  const resp = await typesenseSearch<TypesensePropertyDoc>({
    collection: 'properties',
    q,
    queryBy: PROPERTIES_QUERY_BY,
    filterBy: filterBy ?? undefined,
    // When NL is on, omit sort_by so LLM can apply "cheapest first" etc.
    sortBy: useNl ? undefined : 'updated_at:desc',
    page,
    perPage,
    ...(useNl && {
      nlQuery: true,
      nlModelId: nlOptions!.nlModelId,
    }),
  });

  const sessionId = getSessionId(request);
  const userId = tryGetUserIdFromAuthHeader(request);
  const propertyIds = resp.hits.map((h) => Number(h.document.property_id));

  const items = resp.hits.map((h) => {
    const d = h.document;
    const pid = Number(d.property_id);
    const locationParts = [d.address].filter(Boolean);
    const location = locationParts.length ? locationParts.join(', ') : null;
    return {
      property: {
        id: pid,
        title:
          lang === 'ar'
            ? d.title_ar ?? d.title_en ?? null
            : d.title_en ?? d.title_ar ?? null,
        location,
        price: d.price ?? null,
        area: d.area_sqm ?? null,
        areaSqft: d.area_sqft ?? null,
        areaSqm: d.area_sqm ?? null,
        bedrooms: d.bedrooms ?? null,
        bathrooms: d.bathrooms ?? null,
        primaryImageUrl: d.primary_image_url ?? null,
        profileImageUrl: d.profile_image_url ?? null,
        agent: d.agent_id
          ? {
              id: d.agent_id,
              name: d.agent_name ?? null,
              email: d.agent_email ?? null,
              phone: d.agent_phone ?? null,
              whatsapp: d.agent_whatsapp ?? null,
              profileImageUrl: d.profile_image_url ?? null,
              agency: d.agency_id
                ? { id: d.agency_id, name: d.agency_name ?? null }
                : null,
            }
          : null,
        additionalImageUrls: d.additional_image_urls ?? [],
        purposeKey: d.purpose_key ?? null,
        isLiked: false,
      },
    };
  });

  if (sessionId) {
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
      priceMin: body.price?.[0],
      priceMax: body.price?.[1],
      areaMin: body.area?.[0],
      areaMax: body.area?.[1],
      keyword: normalizeKeyword(body.keyword),
      agentIds: body.agentIds?.length ? body.agentIds : undefined,
      featureIds: body.featureIds?.length ? body.featureIds : undefined,
    };

    const nlModelId = process.env.TYPESENSE_NL_MODEL_ID?.trim() || undefined;
    const { qValue, willUseNl } = resolveNaturalLanguageSearchMode(
      body.q,
      nlModelId,
      body.nl_query === false
    );

    if (qValue) {
      applyNaturalLanguageQuery(filterState, qValue, { structuredOnly: willUseNl });
    }
    if (!willUseNl && !filterState.purpose?.trim()) {
      filterState.purpose = 'for_sale';
    }

    const page = body.page ?? DEFAULT_PAGE;
    const perPage = body.limit ?? DEFAULT_LIMIT;

    const { items, found } = await runSearch(filterState, page, perPage, request, {
      useNlQuery: willUseNl,
      rawQ: qValue || undefined,
      nlModelId,
    });
    return createPaginatedResponse(items, page, perPage, found);
  } catch (error) {
    return createErrorResponse(error);
  }
}
