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

function bucketPrice(price: number | null | undefined): string | null {
  if (price == null) return null;
  if (price < 1_000_000) return '0-1000000';
  if (price < 2_000_000) return '1000000-2000000';
  if (price < 5_000_000) return '2000000-5000000';
  return '5000000+';
}

/** Typesense filter for a price bucket (same buckets as bucketPrice). */
function priceBucketToFilter(bucket: string): string {
  switch (bucket) {
    case '0-1000000':
      return 'price:[0..1000000]';
    case '1000000-2000000':
      return 'price:[1000000..2000000]';
    case '2000000-5000000':
      return 'price:[2000000..5000000]';
    case '5000000+':
      return 'price:>=5000000';
    default:
      return '';
  }
}

/**
 * Build Typesense sort_by using _eval (boost by preference conditions).
 * Returns null if no clauses. Syntax: _eval([ (expr):score, ... ]):desc,updated_at:desc
 */
function buildSortByEval(counters: PreferenceCounters | null): string | null {
  if (!counters) return null;
  const clauses: string[] = [];

  if (counters.bedrooms) {
    for (const [k, score] of Object.entries(counters.bedrooms)) {
      const s = Math.min(127, Math.max(0, Math.floor(score)));
      if (s > 0) clauses.push(`(bedrooms:=${k}):${s}`);
    }
  }
  if (counters.bathrooms) {
    for (const [k, score] of Object.entries(counters.bathrooms)) {
      const s = Math.min(127, Math.max(0, Math.floor(score)));
      if (s > 0) clauses.push(`(bathrooms:=${k}):${s}`);
    }
  }
  if (counters.price_buckets) {
    for (const [bucket, score] of Object.entries(counters.price_buckets)) {
      const s = Math.min(127, Math.max(0, Math.floor(score)));
      const filter = priceBucketToFilter(bucket);
      if (s > 0 && filter) clauses.push(`(${filter}):${s}`);
    }
  }
  if (counters.property_types) {
    for (const [k, score] of Object.entries(counters.property_types)) {
      const s = Math.min(127, Math.max(0, Math.floor(score)));
      if (s > 0) clauses.push(`(property_type_id:=${k}):${s}`);
    }
  }
  if (counters.features) {
    for (const [key, score] of Object.entries(counters.features)) {
      const s = Math.min(127, Math.max(0, Math.floor(score)));
      if (s > 0 && key) clauses.push(`(features:=${key}):${s}`);
    }
  }

  if (clauses.length === 0) return null;
  return `_eval([${clauses.join(',')}]):desc,updated_at:desc`;
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

function rerankHitsByPreferences(
  hits: Array<{ document: TypesensePropertyDoc }>,
  counters: PreferenceCounters | null
): Array<{ document: TypesensePropertyDoc }> {
  if (!counters) return hits;
  return hits
    .map((h) => ({
      hit: h,
      personalScore: scorePropertyByPreferences(h.document, counters),
      updatedAt: h.document.updated_at ?? 0,
      propertyId: Number(h.document.property_id) || 0,
    }))
    .sort((a, b) => {
      // Higher personal score first
      if (b.personalScore !== a.personalScore) return b.personalScore - a.personalScore;
      // Then newer updates first (stable-ish pagination)
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
      // Finally, deterministic tie-breaker
      return b.propertyId - a.propertyId;
    })
    .map((x) => x.hit);
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = getSessionId(request);
    const userId = tryGetUserIdFromAuthHeader(request);
    const { page: pageRaw, limit: limitRaw, countryId } = validateQuery(request, feedQuerySchema);
    const page = pageRaw ?? 1;
    const perPage = limitRaw ?? 25;
    const lang = getLanguageCode(request);

    const prefs = await getPreferencesForFeed(sessionId);
    const counters =
      prefs?.is_ready_for_recommendations && prefs
        ? ((prefs.preference_counters ?? null) as PreferenceCounters | null)
        : null;

    const filterBy = countryId ? `country_id:=${countryId}` : undefined;
    // Use pre-computed sort from DB when present; else build from counters; else featured then updated_at.
    const sortByEval =
      prefs?.is_ready_for_recommendations && prefs.typesense_feed_sort_by
        ? prefs.typesense_feed_sort_by
        : buildSortByEval(counters);
    const sortBy = sortByEval ?? 'is_featured:desc,featured_rank:asc,updated_at:desc';

    const resp = await typesenseSearch<TypesensePropertyDoc>({
      collection: 'properties',
      q: '*',
      queryBy: PROPERTIES_QUERY_BY,
      filterBy,
      sortBy,
      page,
      perPage,
    });

    // When we used _eval, Typesense already ranked by preferences; no app rerank. Otherwise keep order.
    const hits = sortByEval ? resp.hits : rerankHitsByPreferences(resp.hits, counters);
    const items: FeedItem[] = hits.map((h) =>
      docToFeedItem(h.document, lang, h.document.is_featured ?? false)
    );

    const propertyIds = items.map((i) => i.property.id);
    const viewStatusMap = await getPropertyViewStatus(propertyIds, sessionId, userId);
    items.forEach((item) => {
      const status = viewStatusMap.get(item.property.id);
      if (status) {
        item.property.isLiked = status.isLiked;
      }
    });

    // No total: pagination uses only page + limit
    return createPaginatedResponse(items, page, perPage);
  } catch (error) {
    return createErrorResponse(error);
  }
}

