import { NextRequest } from 'next/server';
import { getAllUsers } from '@/lib/db/queries/users';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { withAuthorization, requirePermission } from '@/lib/authz/middleware';
import { JWTPayload } from '@/lib/types/auth';

async function handler(_request: NextRequest, _user: JWTPayload) {
  try {
    void _request;
    void _user;
    const users = await getAllUsers();

    return createSuccessResponse({ users });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const GET = withAuthorization(requirePermission('user', 'read'))(handler);
