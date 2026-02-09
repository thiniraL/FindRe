import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { AppError, createErrorResponse, createPaginatedResponse } from '@/lib/utils/errors';
import { validateQuery } from '@/lib/security/validation';
import { getLikedPropertyIds } from '@/lib/db/queries/propertyViews';
import { PROPERTIES_QUERY_BY } from '@/lib/search/typesenseSchema';
import { typesenseSearch } from '@/lib/search/typesense';
import { verifyAccessToken } from '@/lib/auth/jwt';

const favouritesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

type TypesensePropertyDoc = {
  property_id: string;
  country_id: number;
  purpose_id?: number;
  purpose_key?: string;
  property_type_id?: number;
  price?: number;
  bedrooms?: number;
  bathrooms?: number;
  address?: string;
  agent_id?: number;
  agent_name?: string;
  agent_email?: string;
  agent_phone?: string;
  agent_whatsapp?: string;
  is_featured?: boolean;
  featured_rank?: number;
  title_en?: string;
  title_ar?: string;
  city_en?: string;
  area_en?: string;
  community_en?: string;
  primary_image_url?: string;
  additional_image_urls?: string[];
};

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

type FavouriteItem = {
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
    isLiked: true;
  };
};

function docToFavouriteItem(d: TypesensePropertyDoc, lang: 'en' | 'ar'): FavouriteItem {
  const locationParts = [d.address, d.community_en, d.area_en, d.city_en].filter(Boolean);
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
      isFeatured: Boolean(d.is_featured),
      featuredRank: d.featured_rank ?? null,
      additionalImageUrls: d.additional_image_urls ?? [],
      purposeKey: d.purpose_key ?? null,
      isLiked: true,
    },
  };
}

/**
 * GET /api/favourites
 * Returns the list of properties the user has liked (favourites), in search/feed response shape.
 * Requires x-session-id. Optional Authorization for user-scoped favourites.
 * Query: page (default 1), limit (default 25, max 100).
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = getSessionId(request);
    const userId = tryGetUserIdFromAuthHeader(request);
    const { page: pageRaw, limit: limitRaw } = validateQuery(request, favouritesQuerySchema);
    const page = pageRaw ?? 1;
    const perPage = limitRaw ?? 25;
    const lang = getLanguageCode(request);

    const offset = (page - 1) * perPage;
    const { propertyIds, total } = await getLikedPropertyIds(sessionId, userId, perPage, offset);

    if (propertyIds.length === 0) {
      return createPaginatedResponse([], page, perPage, total);
    }

    const filterBy = `property_id:=[${propertyIds.join(',')}]`;
    const resp = await typesenseSearch<TypesensePropertyDoc>({
      collection: 'properties',
      q: '*',
      queryBy: PROPERTIES_QUERY_BY,
      filterBy,
      sortBy: 'updated_at:desc',
      page: 1,
      perPage: propertyIds.length,
    });

    const byId = new Map(resp.hits.map((h) => [Number(h.document.property_id), h.document]));
    const orderedDocs = propertyIds
      .map((id) => byId.get(id))
      .filter((d): d is TypesensePropertyDoc => d != null);

    const items = orderedDocs.map((d) => docToFavouriteItem(d, lang));

    return createPaginatedResponse(items, page, perPage, total);
  } catch (error) {
    return createErrorResponse(error);
  }
}
