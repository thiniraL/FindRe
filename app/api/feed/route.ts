import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { AppError, createErrorResponse, createPaginatedResponse } from '@/lib/utils/errors';
import { validateQuery } from '@/lib/security/validation';
import { getPreferencesForFeed } from '@/lib/db/queries/preferences';
import { PROPERTIES_QUERY_BY } from '@/lib/search/typesenseSchema';
import { typesenseSearch } from '@/lib/search/typesense';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { getPropertyViewStatus } from '@/lib/db/queries/propertyViews';

const feedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  countryId: z.coerce.number().int().min(1).optional(),
  q: z.string().optional(),
  featureKeys: z.string().optional(), // comma-separated feature keys
});

function getSessionId(request: NextRequest): string {
  const sessionId = request.headers.get('x-session-id');
  if (!sessionId || !sessionId.trim()) {
    throw new AppError('Missing x-session-id header', 400, 'SESSION_ID_REQUIRED');
  }
  return sessionId.trim();
}

function getLanguageCode(request: NextRequest): 'en' | 'ar' {
  const acceptLanguage = request.headers.get('accept-language') || 'en';
  const first = acceptLanguage.split(',')[0]?.trim() || 'en';
  const lang = first.split('-')[0]?.trim().toLowerCase() || 'en';
  return lang === 'ar' ? 'ar' : 'en';
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

type PreferenceCounters = {
  bedrooms?: Record<string, number>;
  bathrooms?: Record<string, number>;
  price_buckets?: Record<string, number>;
  property_types?: Record<string, number>;
  features?: Record<string, number>;
};

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function bucketPrice(price: number | null | undefined): string | null {
  if (price == null) return null;
  if (price < 1_000_000) return '0-1000000';
  if (price < 2_000_000) return '1000000-2000000';
  if (price < 5_000_000) return '2000000-5000000';
  return '5000000+';
}

function scorePropertyByPreferences(
  doc: TypesensePropertyDoc,
  counters: PreferenceCounters | null
): number {
  if (!counters) return 0;
  let score = 0;

  // Bedrooms
  if (doc.bedrooms != null && counters.bedrooms) {
    score += counters.bedrooms[String(doc.bedrooms)] ?? 0;
  }

  // Bathrooms
  if (doc.bathrooms != null && counters.bathrooms) {
    score += counters.bathrooms[String(doc.bathrooms)] ?? 0;
  }

  // Price bucket
  const bucket = bucketPrice(doc.price ?? null);
  if (bucket && counters.price_buckets) {
    score += counters.price_buckets[bucket] ?? 0;
  }

  // Property type
  if (doc.property_type_id != null && counters.property_types) {
    score += counters.property_types[String(doc.property_type_id)] ?? 0;
  }

  // Features
  if (doc.features && counters.features) {
    for (const f of doc.features) {
      score += counters.features[f] ?? 0;
    }
  }

  return score;
}

/** Get total count of featured properties matching base filters (e.g. country_id). */
async function getFeaturedCount(filterBy: string): Promise<number> {
  const resp = await typesenseSearch<TypesensePropertyDoc>({
    collection: 'properties',
    q: '*',
    queryBy: PROPERTIES_QUERY_BY,
    filterBy: filterBy ? `${filterBy} && is_featured:=true` : 'is_featured:=true',
    sortBy: 'featured_rank:asc',
    page: 1,
    perPage: 1,
  });
  return resp.found;
}

type FeedItem = {
  property: {
    id: number;
    title: string | null;
    location: string | null;
    price: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    primaryImageUrl: string | null;
    agent: { id: number; name: string | null; email: string | null; phone: string | null; whatsapp: string | null } | null;
    isFeatured: boolean;
    featuredRank: number | null;
    additionalImageUrls: string[];
    purposeKey: string | null;
    isLiked: boolean;
  };
};

function docToFeedItem(
  d: TypesensePropertyDoc,
  lang: 'en' | 'ar',
  isFeatured: boolean
): FeedItem {
  const locationParts = isFeatured
    ? [d.address].filter(Boolean)
    : [d.address, d.community_en, d.area_en, d.city_en].filter(Boolean);
  const location = locationParts.length ? locationParts.join(', ') : null;
  return {
    property: {
      id: Number(d.property_id),
      title: lang === 'ar' ? d.title_ar ?? d.title_en ?? null : d.title_en ?? d.title_ar ?? null,
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
      isFeatured,
      featuredRank: isFeatured ? (d.featured_rank ?? null) : null,
      additionalImageUrls: d.additional_image_urls ?? [],
      purposeKey: d.purpose_key ?? null,
      isLiked: false,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = getSessionId(request);
    const userId = tryGetUserIdFromAuthHeader(request);
    const { page: pageRaw, limit: limitRaw, countryId, q, featureKeys } = validateQuery(request, feedQuerySchema);
    const page = pageRaw ?? 1;
    const perPage = limitRaw ?? 25;
    const lang = getLanguageCode(request);

    const prefs = await getPreferencesForFeed(sessionId);
    const ready = Boolean(prefs?.is_ready_for_recommendations);

    // Base filters (country, optional featureKeys)
    const baseFilters: string[] = [];
    if (countryId) baseFilters.push(`country_id:=${countryId}`);
    if (featureKeys) {
      const keys = featureKeys
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (keys.length) {
        baseFilters.push(`features:=[${keys.join(',')}]`);
      }
    }
    const baseFilterBy = baseFilters.length ? baseFilters.join(' && ') : '';

    // 1) Featured count
    const featuredFilterBy = baseFilterBy ? `${baseFilterBy} && is_featured:=true` : 'is_featured:=true';
    const totalFeatured = await getFeaturedCount(baseFilterBy);

    // 2) Rest filters: non-featured; if preferences ready, add preference filters
    const restFilters: string[] = [...baseFilters, 'is_featured:=false'];
    if (ready && prefs) {
      const minPrice = toNumber(prefs.preferred_price_min);
      const maxPrice = toNumber(prefs.preferred_price_max);
      if (minPrice !== null) restFilters.push(`price:>=${minPrice}`);
      if (maxPrice !== null) restFilters.push(`price:<=${maxPrice}`);
      if (prefs.preferred_bedrooms_min !== null) restFilters.push(`bedrooms:>=${prefs.preferred_bedrooms_min}`);
      if (prefs.preferred_bedrooms_max !== null) restFilters.push(`bedrooms:<=${prefs.preferred_bedrooms_max}`);
      if (prefs.preferred_bathrooms_min !== null) restFilters.push(`bathrooms:>=${prefs.preferred_bathrooms_min}`);
      if (prefs.preferred_bathrooms_max !== null) restFilters.push(`bathrooms:<=${prefs.preferred_bathrooms_max}`);
      if (prefs.preferred_purpose_ids?.length) {
        restFilters.push(`purpose_id:=[${prefs.preferred_purpose_ids.join(',')}]`);
      }
      if (prefs.preferred_property_type_ids?.length) {
        restFilters.push(`property_type_id:=[${prefs.preferred_property_type_ids.join(',')}]`);
      }
    }
    const restFilterBy = restFilters.join(' && ');

    const searchQ = q && q.trim() ? q.trim() : '*';

    // Get rest count (one search with perPage: 1)
    const restCountResp = await typesenseSearch<TypesensePropertyDoc>({
      collection: 'properties',
      q: searchQ,
      queryBy: PROPERTIES_QUERY_BY,
      filterBy: restFilterBy,
      sortBy: 'updated_at:desc',
      page: 1,
      perPage: 1,
    });
    const totalRest = restCountResp.found;
    const total = totalFeatured + totalRest;

    const offset = (page - 1) * perPage;

    // 3) Pagination: Case A (featured only), Case B (rest only), Case C (transition)
    let items: FeedItem[];

    if (offset + perPage <= totalFeatured) {
      // Case A: full page of featured
      const featuredPage = Math.floor(offset / perPage) + 1;
      const resp = await typesenseSearch<TypesensePropertyDoc>({
        collection: 'properties',
        q: searchQ,
        queryBy: PROPERTIES_QUERY_BY,
        filterBy: featuredFilterBy,
        sortBy: 'featured_rank:asc',
        page: featuredPage,
        perPage,
      });
      items = resp.hits.map((h) => docToFeedItem(h.document, lang, true));
    } else if (offset >= totalFeatured) {
      // Case B: full page of rest
      const restOffset = offset - totalFeatured;
      const restPage = Math.floor(restOffset / perPage) + 1;
      const resp = await typesenseSearch<TypesensePropertyDoc>({
        collection: 'properties',
        q: searchQ,
        queryBy: PROPERTIES_QUERY_BY,
        filterBy: restFilterBy,
        sortBy: 'updated_at:desc',
        page: restPage,
        perPage,
      });
      let hits = resp.hits;
      if (ready && prefs) {
        const counters = (prefs.preference_counters ?? null) as PreferenceCounters | null;
        hits = resp.hits
          .map((h) => ({ hit: h, personalScore: scorePropertyByPreferences(h.document, counters) }))
          .sort((a, b) => b.personalScore - a.personalScore)
          .map((x) => x.hit);
      }
      items = hits.map((h) => docToFeedItem(h.document, lang, false));
    } else {
      // Case C: transition (featured slice + rest slice)
      const featuredCount = Math.min(perPage, totalFeatured - offset);
      const restCount = perPage - featuredCount;

      const featuredPage = Math.floor(offset / perPage) + 1;
      const featuredResp = await typesenseSearch<TypesensePropertyDoc>({
        collection: 'properties',
        q: searchQ,
        queryBy: PROPERTIES_QUERY_BY,
        filterBy: featuredFilterBy,
        sortBy: 'featured_rank:asc',
        page: featuredPage,
        perPage,
      });
      const sliceStart = offset - (featuredPage - 1) * perPage;
      const featuredSlice = featuredResp.hits.slice(sliceStart, sliceStart + featuredCount);
      let restHits: Array<{ document: TypesensePropertyDoc }> = [];
      if (restCount > 0) {
        const restResp = await typesenseSearch<TypesensePropertyDoc>({
          collection: 'properties',
          q: searchQ,
          queryBy: PROPERTIES_QUERY_BY,
          filterBy: restFilterBy,
          sortBy: 'updated_at:desc',
          page: 1,
          perPage: restCount,
        });
        restHits = restResp.hits;
        if (ready && prefs) {
          const counters = (prefs.preference_counters ?? null) as PreferenceCounters | null;
          restHits = restResp.hits
            .map((h) => ({ hit: h, personalScore: scorePropertyByPreferences(h.document, counters) }))
            .sort((a, b) => b.personalScore - a.personalScore)
            .map((x) => x.hit);
        }
      }
      items = [
        ...featuredSlice.map((h) => docToFeedItem(h.document, lang, true)),
        ...restHits.map((h) => docToFeedItem(h.document, lang, false)),
      ];
    }

    const propertyIds = items.map((i) => i.property.id);
    const viewStatusMap = await getPropertyViewStatus(propertyIds, sessionId, userId);
    items.forEach((item) => {
      const status = viewStatusMap.get(item.property.id);
      if (status) {
        item.property.isLiked = status.isLiked;
      }
    });

    return createPaginatedResponse(items, page, perPage, total);
  } catch (error) {
    return createErrorResponse(error);
  }
}

