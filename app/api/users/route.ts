import { NextRequest } from 'next/server';
import { dbLogin as supabase } from '@/lib/db/client';
import { createErrorResponse, createPaginatedResponse } from '@/lib/utils/errors';
import { validateQuery } from '@/lib/security/validation';
import { queryParamsSchema } from '@/lib/security/validation';
import { withAuthorization, requirePermission } from '@/lib/authz/middleware';
import type { JWTPayload } from '@/lib/types/auth';

async function handler(request: NextRequest, _user: JWTPayload) {
  try {
    void _user;
    const query = validateQuery(request, queryParamsSchema);
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    let queryBuilder = supabase
      .from('users')
      .select('id, email, email_verified, two_factor_enabled, last_login, is_active, created_at, updated_at', { count: 'exact' });

    // Apply search filter
    if (query.search) {
      queryBuilder = queryBuilder.ilike('email', `%${query.search}%`);
    }

    // Apply sorting
    const sortBy = query.sortBy || 'created_at';
    const sortOrder = query.sortOrder || 'desc';
    queryBuilder = queryBuilder.order(sortBy, { ascending: sortOrder === 'asc' });

    // Apply pagination
    queryBuilder = queryBuilder.range(offset, offset + limit - 1);

    const { data, error, count } = await queryBuilder;

    if (error) {
      throw new Error(`Failed to fetch users: ${error.message}`);
    }

    return createPaginatedResponse(
      data || [],
      page,
      limit,
      count || 0
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const GET = withAuthorization(requirePermission('user', 'read'))(handler);




