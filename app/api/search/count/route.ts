import { NextRequest } from 'next/server';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateQuery, validateBody } from '@/lib/security/validation';
import {
  searchQuerySchema,
  searchBodySchema,
  agentIdFilterEntrySchema,
} from '@/lib/security/validation';
import type { SearchFilterState } from '@/lib/search/buildFilterQuery';
import {
  parseNaturalLanguageQuery,
  mergeNaturalLanguageIntoState,
} from '@/lib/search/naturalLanguageQuery';
import {
  getPurposeLabel,
  runSearchCount,
  buildResultButtonLabel,
} from '@/lib/search/searchCount';

export const dynamic = 'force-dynamic';

const DEFAULT_COUNTRY_ID = 1;

function parseOptionalIntList(value: string | undefined): number[] | undefined {
  if (!value?.trim()) return undefined;
  const parsed = value
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length ? parsed : undefined;
}

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

/**
 * GET /api/search/count
 * Same query params as GET /api/search. Returns totalCount and resultButtonLabel for the current filters.
 */
export async function GET(request: NextRequest) {
  try {
    const parsed = validateQuery(request, searchQuerySchema);
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

    const useTypesenseNl =
      parsed.nl_query === true || (parsed.nl_query === undefined && !!parsed.q?.trim());
    if (!useTypesenseNl && parsed.q?.trim()) {
      const nlMapped = parseNaturalLanguageQuery(parsed.q);
      mergeNaturalLanguageIntoState(filterState, nlMapped);
    }
    if (!filterState.purpose?.trim()) {
      filterState.purpose = 'for_sale';
    }

    const nlModelId = process.env.TYPESENSE_NL_MODEL_ID?.trim() || undefined;
    const totalCount = await runSearchCount(filterState, {
      useNlQuery: useTypesenseNl && !!nlModelId,
      rawQ: parsed.q?.trim() || undefined,
      nlModelId,
    });
    const purposeLabel = getPurposeLabel(filterState.purpose);
    const resultButtonLabel = buildResultButtonLabel(purposeLabel, totalCount);

    return createSuccessResponse({ totalCount, resultButtonLabel });
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * POST /api/search/count
 * Same body as POST /api/search. Returns totalCount and resultButtonLabel for the current filters.
 */
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

    const useTypesenseNl =
      body.nl_query === true || (body.nl_query === undefined && !!body.q?.trim());
    if (!useTypesenseNl && body.q?.trim()) {
      const nlMapped = parseNaturalLanguageQuery(body.q);
      mergeNaturalLanguageIntoState(filterState, nlMapped);
    }
    if (!filterState.purpose?.trim()) {
      filterState.purpose = 'for_sale';
    }

    const nlModelId = process.env.TYPESENSE_NL_MODEL_ID?.trim() || undefined;
    const totalCount = await runSearchCount(filterState, {
      useNlQuery: useTypesenseNl && !!nlModelId,
      rawQ: body.q?.trim() || undefined,
      nlModelId,
    });
    const purposeLabel = getPurposeLabel(filterState.purpose);
    const resultButtonLabel = buildResultButtonLabel(purposeLabel, totalCount);

    return createSuccessResponse({ totalCount, resultButtonLabel });
  } catch (error) {
    return createErrorResponse(error);
  }
}
