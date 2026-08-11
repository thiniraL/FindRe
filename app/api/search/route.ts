import { NextRequest } from 'next/server';
import { createErrorResponse, createPaginatedResponse } from '@/lib/utils/errors';
import { validateQuery, validateBody } from '@/lib/security/validation';
import { searchQuerySchema, searchBodySchema, agentIdFilterEntrySchema, normalizeAgentIds } from '@/lib/security/validation';
import { PROPERTIES_QUERY_BY } from '@/lib/search/typesenseSchema';
import { zipMediaUrls, toMediaItem, imageMediaUrls, withTempTestVideo } from '@/lib/search/propertyMedia';
import { pickLocalizedTitle } from '@/lib/search/unwrapTitle';
import {
  buildFilterBy,
  buildSearchQuery,
  buildKeywordOrQueries,
  needsKeywordOrSearch,
  normalizeKeywords,
  type SearchFilterState,
} from '@/lib/search/buildFilterQuery';
import {
  getTypesenseNlQuery,
  resolveNaturalLanguageSearchMode,
} from '@/lib/search/naturalLanguageQuery';
import { getPropertyViewStatus } from '@/lib/db/queries/propertyViews';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { typesenseSearch, typesenseMultiSearchUnion } from '@/lib/search/typesense';

export const dynamic = 'force-dynamic';

/**
 * Search pipeline:
 *   When q is non-empty and TYPESENSE_NL_MODEL_ID is set (and caller did not pass
 *   nl_query=false), send q to Typesense with nl_query=true + nl_model_id.
 *   Explicit filter params still become filter_by. Empty q → normal Typesense search.
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
  property_type_ids?: number[];
  property_type_en?: string;
  property_type_keys?: string[];
  property_type_names_en?: string[];
  main_property_type_ids?: number[];
  main_property_type_keys?: string[];
  main_property_type_names_en?: string[];
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
  primary_media_type?: string;
  additional_image_urls?: string[];
  additional_media_types?: string[];
  all_image_urls?: string[];
  all_media_types?: string[];
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

/** When Typesense NL is off, treat free-text q as full-text keyword. */
function applyQAsKeywordFallback(filterState: SearchFilterState, qValue: string, willUseNl: boolean) {
  if (!qValue || willUseNl) return;
  filterState.keyword = filterState.keyword ? `${filterState.keyword} ${qValue}` : qValue;
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
      keyword: undefined,
      keywords: normalizeKeywords(parsed.keyword ?? parsed.keywords),
      agentIds: parseAgentIdsFromQuery(parsed.agentIds),
      featureIds: parseOptionalIntList(parsed.featureIds)?.filter((n) => n >= 1),
    };

    const nlModelId = process.env.TYPESENSE_NL_MODEL_ID?.trim() || undefined;
    const { qValue, willUseNl } = resolveNaturalLanguageSearchMode(
      parsed.q,
      nlModelId,
      parsed.nl_query === false
    );
    applyQAsKeywordFallback(filterState, qValue, willUseNl);

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
  const useNl = !!(nlOptions?.useNlQuery && nlOptions?.nlModelId);
  const filterBy = buildFilterBy(filterState);

  // Multiple keyword chips → OR via multi-search union (skip NL for this path)
  if (!useNl && needsKeywordOrSearch(filterState)) {
    const qs = buildKeywordOrQueries(filterState);
    const sortBy = filterState.sortBy?.trim() || 'updated_at:desc';
    const resp = await typesenseMultiSearchUnion<TypesensePropertyDoc>(
      qs.map((q) => ({
        collection: 'properties',
        q,
        queryBy: PROPERTIES_QUERY_BY,
        filterBy: filterBy ?? undefined,
        sortBy,
        page,
        perPage,
      }))
    );
    return mapHitsToItems(resp, lang, request);
  }

  // NL mode: map currency symbols → ISO codes, then send to Typesense (nl_query + nl_model_id).
  const q = useNl
    ? getTypesenseNlQuery(nlOptions!.rawQ?.trim() || '')
    : buildSearchQuery(filterState);

  const sortBy = useNl
    ? undefined
    : filterState.sortBy?.trim() || 'updated_at:desc';

  const resp = await typesenseSearch<TypesensePropertyDoc>({
    collection: 'properties',
    q,
    queryBy: PROPERTIES_QUERY_BY,
    filterBy: filterBy ?? undefined,
    sortBy,
    page,
    perPage,
    ...(useNl && {
      nlQuery: true,
      nlModelId: nlOptions!.nlModelId,
    }),
  });

  return mapHitsToItems(resp, lang, request);
}

async function mapHitsToItems(
  resp: { hits: Array<{ document: TypesensePropertyDoc }>; found: number },
  lang: 'en' | 'ar',
  request: NextRequest
): Promise<{ items: Array<{ property: object }>; found: number }> {
  const sessionId = getSessionId(request);
  const userId = tryGetUserIdFromAuthHeader(request);
  const propertyIds = resp.hits.map((h) => Number(h.document.property_id));

  const items = resp.hits.map((h) => {
    const d = h.document;
    const pid = Number(d.property_id);
    const locationParts = [d.address].filter(Boolean);
    const location = locationParts.length ? locationParts.join(', ') : null;
    const primaryMedia = toMediaItem(d.primary_image_url, d.primary_media_type);
    const additionalMedia = withTempTestVideo(
      zipMediaUrls(d.additional_image_urls, d.additional_media_types)
    );
    return {
      property: {
        id: pid,
        title: pickLocalizedTitle(lang, d.title_en, d.title_ar),
        location,
        price: d.price ?? null,
        area: d.area_sqm ?? null,
        areaSqft: d.area_sqft ?? null,
        areaSqm: d.area_sqm ?? null,
        bedrooms: d.bedrooms ?? null,
        bathrooms: d.bathrooms ?? null,
        primaryImageUrl: primaryMedia?.url ?? d.primary_image_url ?? null,
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
        additionalImageUrls: imageMediaUrls(additionalMedia),
        primaryMedia,
        additionalMedia,
        purposeKey: d.purpose_key ?? null,
        mainPropertyTypeIds: d.main_property_type_ids ?? [],
        mainPropertyTypeKeys: d.main_property_type_keys ?? [],
        propertyTypeIds: d.property_type_ids?.length
          ? d.property_type_ids
          : d.property_type_id != null
            ? [d.property_type_id]
            : [],
        propertyType: d.property_type_en ?? null,
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
      keyword: undefined,
      keywords: normalizeKeywords(body.keyword ?? body.keywords),
      agentIds: normalizeAgentIds(body.agentIds),
      featureIds: body.featureIds?.length ? body.featureIds : undefined,
    };

    const nlModelId = process.env.TYPESENSE_NL_MODEL_ID?.trim() || undefined;
    const { qValue, willUseNl } = resolveNaturalLanguageSearchMode(
      body.q,
      nlModelId,
      body.nl_query === false
    );
    applyQAsKeywordFallback(filterState, qValue, willUseNl);

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
