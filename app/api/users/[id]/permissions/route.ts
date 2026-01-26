import { NextRequest } from 'next/server';
import { getUserPermissions, getUserRole } from '@/lib/authz/permissions';
import { getUserDirectPermissions } from '@/lib/db/queries/roles';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateParams } from '@/lib/security/validation';
import { userIdSchema } from '@/lib/security/validation';
import { withAuth } from '@/lib/auth/middleware';
import { JWTPayload } from '@/lib/types/auth';

async function handler(
  request: NextRequest,
  user: JWTPayload,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = validateParams(params, userIdSchema);

    // Users can view their own permissions
    if (id !== user.userId) {
      return createErrorResponse(new Error('Forbidden'));
    }

    const [allPermissions, role, directPermissions] = await Promise.all([
      getUserPermissions(id),
      getUserRole(id),
      getUserDirectPermissions(id),
    ]);

    return createSuccessResponse({
      userId: id,
      role,
      permissions: allPermissions,
      directPermissions,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const GET = withAuth(handler);

