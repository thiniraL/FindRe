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

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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

    // Fallback: featured-only if preferences missing or not ready
    const filters: string[] = [];
    if (countryId) filters.push(`country_id:=${countryId}`);

    // Optional explicit feature filtering from query params
    if (featureKeys) {
      const keys = featureKeys
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (keys.length) {
        filters.push(`features:=[${keys.join(',')}]`);
      }
    }

    if (!prefs || !ready) {
      filters.push(`is_featured:=true`);

      const resp = await typesenseSearch<TypesensePropertyDoc>({
        collection: 'properties',
        q: q && q.trim() ? q.trim() : '*',
        queryBy: PROPERTIES_QUERY_BY,
        filterBy: filters.join(' && '),
        sortBy: 'featured_rank:asc',
        page,
        perPage,
      });

      const items = resp.hits.map((h) => {
        const d = h.document;
        return {
          property: {
            id: Number(d.property_id),
            title: lang === 'ar' ? d.title_ar ?? d.title_en ?? null : d.title_en ?? d.title_ar ?? null,
            price: d.price ?? null,
            bedrooms: d.bedrooms ?? null,
            bathrooms: d.bathrooms ?? null,
            primaryImageUrl: d.primary_image_url ?? null,
            agent: d.agent_id
              ? { id: d.agent_id, name: d.agent_name ?? null }
              : null,
            isFeatured: Boolean(d.is_featured),
            featuredRank: d.featured_rank ?? null,
            additionalImageUrls: d.additional_image_urls ?? [],
            isLiked: false,
            isDisliked: false,
          }
        };
      });

      const propertyIds = items.map((i) => i.property.id);
      const viewStatusMap = await getPropertyViewStatus(propertyIds, sessionId, userId);
      items.forEach((item) => {
        const status = viewStatusMap.get(item.property.id);
        if (status) {
          item.property.isLiked = status.isLiked;
          item.property.isDisliked = status.isDisliked;
        }
      });

      return createPaginatedResponse(items, page, perPage, resp.found);
    }

    // Preference-based search
    const minPrice = toNumber(prefs.preferred_price_min);
    const maxPrice = toNumber(prefs.preferred_price_max);
    if (minPrice !== null) filters.push(`price:>=${minPrice}`);
    if (maxPrice !== null) filters.push(`price:<=${maxPrice}`);
    if (prefs.preferred_bedrooms_min !== null) filters.push(`bedrooms:>=${prefs.preferred_bedrooms_min}`);
    if (prefs.preferred_bedrooms_max !== null) filters.push(`bedrooms:<=${prefs.preferred_bedrooms_max}`);
    if (prefs.preferred_bathrooms_min !== null) filters.push(`bathrooms:>=${prefs.preferred_bathrooms_min}`);
    if (prefs.preferred_bathrooms_max !== null) filters.push(`bathrooms:<=${prefs.preferred_bathrooms_max}`);

    if (prefs.preferred_purpose_ids?.length) {
      filters.push(`purpose_id:=[${prefs.preferred_purpose_ids.join(',')}]`);
    }
    if (prefs.preferred_property_type_ids?.length) {
      filters.push(`property_type_id:=[${prefs.preferred_property_type_ids.join(',')}]`);
    }
    // Location is searched via `q` + `address` instead of filtering by location_id.
    // Feature IDs from preferences are not used here because `properties.features` is now string[] (feature keys).

    const resp = await typesenseSearch<TypesensePropertyDoc>({
      collection: 'properties',
      q: q && q.trim() ? q.trim() : '*',
      queryBy: PROPERTIES_QUERY_BY,
      filterBy: filters.length ? filters.join(' && ') : undefined,
      sortBy: 'updated_at:desc',
      page,
      perPage,
    });

    const items = resp.hits.map((h) => {
      const d = h.document;
      return {
        property: {
          id: Number(d.property_id),
          title: lang === 'ar' ? d.title_ar ?? d.title_en ?? null : d.title_en ?? d.title_ar ?? null,
          price: d.price ?? null,
          bedrooms: d.bedrooms ?? null,
          bathrooms: d.bathrooms ?? null,
          primaryImageUrl: d.primary_image_url ?? null,
          agent: d.agent_id
            ? { id: d.agent_id, name: d.agent_name ?? null }
            : null,
          additionalImageUrls: d.additional_image_urls ?? [],
          isLiked: false,
          isDisliked: false,
        },
      };
    });

    const propertyIds = items.map((i) => i.property.id);
    const viewStatusMap = await getPropertyViewStatus(propertyIds, sessionId, userId);
    items.forEach((item) => {
      const status = viewStatusMap.get(item.property.id);
      if (status) {
        item.property.isLiked = status.isLiked;
        item.property.isDisliked = status.isDisliked;
      }
    });

    return createPaginatedResponse(items, page, perPage, resp.found);
  } catch (error) {
    return createErrorResponse(error);
  }
}

