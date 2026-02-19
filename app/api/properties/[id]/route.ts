import { NextRequest } from 'next/server';
import {
  AppError,
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/utils/errors';
import { validateParams } from '@/lib/security/validation';
import { propertyIdSchema } from '@/lib/security/validation';
import { getPropertyById } from '@/lib/db/queries/propertyDetails';
import { propertyDetailCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';

function getLanguageCode(request: NextRequest): 'en' | 'ar' {
  const acceptLanguage = request.headers.get('accept-language') || 'en';
  const first = acceptLanguage.split(',')[0]?.trim() || 'en';
  const lang = first.split('-')[0]?.trim().toLowerCase() || 'en';
  return lang === 'ar' ? 'ar' : 'en';
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: propertyId } = validateParams(params, propertyIdSchema);
    const lang = getLanguageCode(request);

    const cacheKey = `property:${propertyId}:${lang}`;
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

    const payload = {
      id: row.property_id,
      title: row.title ?? null,
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
      features: Array.isArray(row.features_jsonb) ? row.features_jsonb : [],
      images: {
        primaryImageUrl: row.primary_image_url ?? (Array.isArray(row.image_urls) ? row.image_urls[0] ?? null : null),
        additionalImageUrls: Array.isArray(row.image_urls) && row.image_urls.length > 0 ? row.image_urls.slice(1) : [],
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
            }
          : null,
    };

    return createSuccessResponse(payload);
  } catch (error) {
    return createErrorResponse(error);
  }
}
