import { NextRequest } from 'next/server';
import {
  AppError,
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/utils/errors';
import { validateParams } from '@/lib/security/validation';
import { propertyIdSchema } from '@/lib/security/validation';
import {
  getPropertyById,
  type PropertyImageJson,
  type PropertyVideoJson,
} from '@/lib/db/queries/propertyDetails';
import { getPropertyViewStatus } from '@/lib/db/queries/propertyViews';
import { propertyDetailCache } from '@/lib/cache';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { unwrapTitle } from '@/lib/search/unwrapTitle';
import { imageMediaUrls } from '@/lib/search/propertyMedia';

export const dynamic = 'force-dynamic';

type PropertyMediaItem =
  | {
      url: string;
      mediaType: 'image';
      displayOrder: number | null;
      isFeatured: boolean;
    }
  | {
      url: string;
      mediaType: 'video';
      displayOrder: number | null;
      isFeatured: boolean;
      durationSeconds?: number;
      thumbnailUrl?: string;
    };

function parseJsonArray<T>(value: T[] | string | null | undefined): T[] {
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as T[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function orderKey(displayOrder: number | null | undefined): number {
  return displayOrder == null || Number.isNaN(Number(displayOrder))
    ? Number.MAX_SAFE_INTEGER
    : Number(displayOrder);
}

/**
 * Merge images + videos into one gallery ordered by the shared displayOrder
 * written by the admin Media tab (featured + other, mixed types).
 */
function buildOrderedMedia(
  images: PropertyImageJson[],
  videos: PropertyVideoJson[]
): PropertyMediaItem[] {
  type Ranked = {
    displayOrder: number;
    tie: number;
    item: PropertyMediaItem;
  };

  const ranked: Ranked[] = [];

  images.forEach((img, index) => {
    if (typeof img?.url !== 'string' || !img.url) return;
    ranked.push({
      displayOrder: orderKey(img.displayOrder),
      tie: index,
      item: {
        url: img.url,
        mediaType: 'image',
        displayOrder: img.displayOrder ?? null,
        isFeatured: Boolean(img.isFeatured),
      },
    });
  });

  videos.forEach((video, index) => {
    if (typeof video?.url !== 'string' || !video.url) return;
    ranked.push({
      displayOrder: orderKey(video.displayOrder),
      // Keep stable ordering when an image and video share the same displayOrder.
      tie: 1_000_000 + index,
      item: {
        url: video.url,
        mediaType: 'video',
        displayOrder: video.displayOrder ?? null,
        isFeatured: Boolean(video.isFeatured),
        ...(video.durationSeconds != null
          ? { durationSeconds: Number(video.durationSeconds) }
          : {}),
        ...(typeof video.thumbnailUrl === 'string' && video.thumbnailUrl.trim()
          ? { thumbnailUrl: video.thumbnailUrl.trim() }
          : {}),
      },
    });
  });

  ranked.sort((a, b) => a.displayOrder - b.displayOrder || a.tie - b.tie);
  return ranked.map((entry) => entry.item);
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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: propertyId } = validateParams(params, propertyIdSchema);
    const lang = getLanguageCode(request);

    // v4: mixed image/video gallery sorted by shared displayOrder
    const cacheKey = `property:${propertyId}:${lang}:v5`;
    let row = propertyDetailCache.get<Awaited<ReturnType<typeof getPropertyById>>>(cacheKey);
    if (!row) {
      row = await getPropertyById(propertyId, lang);
      if (row) propertyDetailCache.set(cacheKey, row);
    }

    if (!row) {
      throw new AppError(
        `Property ${propertyId} not found`,
        404,
        'PROPERTY_NOT_FOUND'
      );
    }

    const isActive =
      row.status != null &&
      String(row.status).trim().toLowerCase() === 'active';
    if (!isActive) {
      throw new AppError(
        'Property is no longer available',
        404,
        'PROPERTY_NOT_ACTIVE'
      );
    }

    const region =
      row.state_province ?? row.emirate ?? row.country_name ?? null;
    const addressLine1 =
      row.community ?? row.address_line ?? row.area ?? row.city ?? null;
    const addressLine2 = [row.community, row.area, row.city]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', ') || null;

    const userId = tryGetUserIdFromAuthHeader(request);
    const sessionId = request.headers.get('x-session-id')?.trim() ?? '';
    let isLiked = false;
    if (userId || sessionId) {
      const viewStatusMap = await getPropertyViewStatus(
        [row.property_id],
        sessionId,
        userId ?? null
      );
      const status = viewStatusMap.get(row.property_id);
      if (status) isLiked = status.isLiked;
    }

    const images = parseJsonArray<PropertyImageJson>(row.images_json);
    const videos = parseJsonArray<PropertyVideoJson>(row.videos_json);
    const orderedMedia = buildOrderedMedia(images, videos);
    const hasFeatured = orderedMedia.some((item) => item.isFeatured);
    const featuredPool = hasFeatured
      ? orderedMedia.filter((item) => item.isFeatured)
      : orderedMedia;
    const primary =
      featuredPool[0] ??
      orderedMedia[0] ??
      null;
    const primaryMedia = primary
      ? {
          url: primary.url,
          mediaType: primary.mediaType,
          displayOrder: primary.displayOrder,
          isFeatured: primary.isFeatured,
          ...(primary.mediaType === 'video' && primary.durationSeconds != null
            ? { durationSeconds: primary.durationSeconds }
            : {}),
          ...(primary.mediaType === 'video' && primary.thumbnailUrl
            ? { thumbnailUrl: primary.thumbnailUrl }
            : {}),
        }
      : null;
    const additionalMedia = primary
      ? orderedMedia.filter(
          (item) =>
            !(item.mediaType === primary.mediaType && item.url === primary.url)
        )
      : orderedMedia;

    const payload = {
      id: row.property_id,
      title: unwrapTitle(row.title),
      description: row.description ?? null,
      price: row.price ?? null,
      currency: {
        code: row.currency_code ?? null,
        symbol: row.currency_symbol ?? null,
      },
      referenceNumber: row.reference_number ?? null,
      status: row.status ?? null,
      purposeKey: row.purpose_key ?? null,
      propertyType: row.property_type_name ?? null,
      furnishingStatus: row.furnishing_status ?? null,
      completionStatus: row.completion_status ?? null,
      isOffPlan: row.is_off_plan ?? false,
      location: {
        addressLine1,
        addressLine2: addressLine2 || (row.city ? `${row.city}` : null),
        city: row.city ?? null,
        area: row.area ?? null,
        community: row.community ?? null,
        region,
        countryCode: row.country_code ?? null,
        countryName: row.country_name ?? null,
      },
      bedrooms: row.bedrooms ?? null,
      bathrooms: row.bathrooms ?? null,
      areaSqm: row.area_sqm ?? null,
      areaSqft: row.area_sqft ?? null,
      profileImageUrl: row.agent_profile_image_url ?? null,
      features: Array.isArray(row.features_jsonb) ? row.features_jsonb : [],
      images: {
        // Legacy string fields (unchanged for old clients)
        primaryImageUrl: primaryMedia?.url ?? null,
        additionalImageUrls: imageMediaUrls(additionalMedia),
        // New media objects with mediaType
        primaryMedia,
        additionalMedia,
      },
      agentBy:
        row.agent_id != null
          ? {
              id: row.agent_id,
              name: row.agent_name ?? null,
              profileImageUrl: row.agent_profile_image_url ?? null,
              profileSlug: row.agent_profile_slug ?? null,
              email: row.agent_email ?? null,
              phone: row.agent_phone ?? null,
              whatsapp: row.agent_whatsapp ?? null,
              agency:
                row.agency_id != null
                  ? {
                      id: row.agency_id,
                      name: row.agency_name ?? null,
                      logoUrl: row.agency_logo_url ?? null,
                    }
                  : null,
            }
          : null,
      isLiked,
    };

    return createSuccessResponse(payload);
  } catch (error) {
    return createErrorResponse(error);
  }
}
