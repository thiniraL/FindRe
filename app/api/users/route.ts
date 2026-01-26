import { NextRequest } from 'next/server';
import { createErrorResponse, createPaginatedResponse } from '@/lib/utils/errors';
import { validateQuery } from '@/lib/security/validation';
import { queryParamsSchema } from '@/lib/security/validation';
import { withAuthorization, requirePermission } from '@/lib/authz/middleware';
import type { JWTPayload } from '@/lib/types/auth';
import { listUsers } from '@/lib/db/queries/users';

async function handler(request: NextRequest, _user: JWTPayload) {
  try {
    void _user;
    const query = validateQuery(request, queryParamsSchema);
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    const result = await listUsers({
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      limit,
      offset,
    });

    return createPaginatedResponse(result.users, page, limit, result.total);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const GET = withAuthorization(requirePermission('user', 'read'))(handler);




