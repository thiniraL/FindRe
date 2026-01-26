import { NextRequest } from 'next/server';
import { getAllPermissions } from '@/lib/db/queries/permissions';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { withAuthorization, requirePermission } from '@/lib/authz/middleware';
import { JWTPayload } from '@/lib/types/auth';

async function handler(_request: NextRequest, _user: JWTPayload) {
  try {
    void _request;
    void _user;
    const permissions = await getAllPermissions();
    return createSuccessResponse({ permissions });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const GET = withAuthorization(requirePermission('permission', 'read'))(handler);

