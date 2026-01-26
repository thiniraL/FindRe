import { NextRequest } from 'next/server';
import { grantPermissionToUser, revokePermissionFromUser } from '@/lib/db/queries/roles';
import { invalidateUserPermissionsCache } from '@/lib/authz/rbac';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateParams, validateBody } from '@/lib/security/validation';
import { userIdSchema } from '@/lib/security/validation';
import { withAuthorization, requirePermission } from '@/lib/authz/middleware';
import { JWTPayload } from '@/lib/types/auth';
import { z } from 'zod';

const grantPermissionSchema = z.object({
  permissionId: z.string().uuid('Invalid permission ID'),
});

async function grantHandler(
  request: NextRequest,
  user: JWTPayload,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = validateParams(params, userIdSchema);
    const body = await validateBody(request, grantPermissionSchema);

    await grantPermissionToUser(id, body.permissionId, user.userId);

    // Invalidate permissions cache
    invalidateUserPermissionsCache(id);

    return createSuccessResponse({
      message: 'Permission granted successfully',
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

async function revokeHandler(
  request: NextRequest,
  user: JWTPayload,
  { params }: { params: { id: string; permissionId: string } }
) {
  try {
    const { id, permissionId } = params;
    validateParams({ id }, userIdSchema);
    validateParams({ id: permissionId }, userIdSchema);

    await revokePermissionFromUser(id, permissionId);

    // Invalidate permissions cache
    invalidateUserPermissionsCache(id);

    return createSuccessResponse({
      message: 'Permission revoked successfully',
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = withAuthorization(requirePermission('user', 'update'))(grantHandler);
export const DELETE = withAuthorization(requirePermission('user', 'update'))(revokeHandler);







