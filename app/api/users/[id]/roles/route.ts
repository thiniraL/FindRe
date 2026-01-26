import { NextRequest } from 'next/server';
import { assignRoleToUser, removeRoleFromUser } from '@/lib/db/queries/roles';
import { invalidateUserPermissionsCache } from '@/lib/authz/rbac';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateParams, validateBody } from '@/lib/security/validation';
import { userIdSchema, assignRoleSchema } from '@/lib/security/validation';
import { withAuthorization, requirePermission } from '@/lib/authz/middleware';
import { JWTPayload } from '@/lib/types/auth';

async function assignHandler(
  request: NextRequest,
  user: JWTPayload,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = validateParams(params, userIdSchema);
    const body = await validateBody(request, assignRoleSchema);

    await assignRoleToUser(id, body.roleId, user.userId);

    // Invalidate permissions cache
    invalidateUserPermissionsCache(id);

    return createSuccessResponse({
      message: 'Role assigned successfully',
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

async function removeHandler(
  request: NextRequest,
  user: JWTPayload,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = validateParams(params, userIdSchema);

    await removeRoleFromUser(id);

    // Invalidate permissions cache
    invalidateUserPermissionsCache(id);

    return createSuccessResponse({
      message: 'Role removed successfully',
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = withAuthorization(requirePermission('role', 'update'))(assignHandler);
export const DELETE = withAuthorization(requirePermission('role', 'update'))(removeHandler);

