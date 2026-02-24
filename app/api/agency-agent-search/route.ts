import { NextRequest } from 'next/server';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { searchAgenciesAndAgentsPaginated } from '@/lib/db/queries/filterOptions';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().max(200).optional(),
  lang: z.enum(['en', 'ar']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** Body schema for POST: same parameters as GET (q, lang, page, limit). */
const bodySchema = z.object({
  q: z.string().max(200).optional(),
  lang: z.enum(['en', 'ar']).optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

async function runSearch(
  q: string | undefined,
  lang: string | undefined,
  page: number | undefined,
  limit: number | undefined
) {
  const result = await searchAgenciesAndAgentsPaginated(q ?? '', {
    languageCode: lang === 'ar' ? 'ar' : 'en',
    page: page ?? 1,
    limit: limit ?? 10,
  });
  return createSuccessResponse({
    items: result.items,
    total: result.total,
    page: result.page,
    limit: result.limit,
  });
}

/**
 * GET /api/agency-agent-search?q=text&lang=en&page=1&limit=10
 * Returns matching agencies and agents for dropdown: { items, total, page, limit }.
 * items: { label, value, type }[]; type is 'agency' or 'agent'; value is agency_id or agent_id.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get('q') ?? undefined,
      lang: url.searchParams.get('lang') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });

    if (!parsed.success) {
      return createErrorResponse(parsed.error);
    }

    return runSearch(parsed.data.q, parsed.data.lang, parsed.data.page, parsed.data.limit);
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * POST /api/agency-agent-search
 * Body: { q?: string, lang?: "en" | "ar", page?: number, limit?: number }
 * Response: { items, total, page, limit }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return createErrorResponse(parsed.error);
    }

    return runSearch(parsed.data.q, parsed.data.lang, parsed.data.page, parsed.data.limit);
  } catch (error) {
    return createErrorResponse(error);
  }
}
