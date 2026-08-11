import { NextRequest } from 'next/server';
import { getRoleById, updateRole, deleteRole } from '@/lib/db/queries/roles';
import { AppError, createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateParams, validateBody } from '@/lib/security/validation';
import { roleIdSchema, updateRoleSchema } from '@/lib/security/validation';
import { withAuthorization, requirePermission } from '@/lib/authz/middleware';
import { JWTPayload } from '@/lib/types/auth';

async function getHandler(
  request: NextRequest,
  user: JWTPayload,
  { params }: { params: { id: string } }
) {
  try {
    void request;
    void user;
    const { id } = validateParams(params, roleIdSchema);
    const role = await getRoleById(id);

    if (!role) {
      throw new AppError('Role not found', 404, 'ROLE_NOT_FOUND');
    }

    return createSuccessResponse({ role });
  } catch (error) {
    return createErrorResponse(error);
  }
}

async function updateHandler(
  request: NextRequest,
  user: JWTPayload,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = validateParams(params, roleIdSchema);
    const body = await validateBody(request, updateRoleSchema);

    const role = await updateRole(id, body);

    return createSuccessResponse({ role });
  } catch (error) {
    return createErrorResponse(error);
  }
}

async function deleteHandler(
  request: NextRequest,
  user: JWTPayload,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = validateParams(params, roleIdSchema);
    await deleteRole(id);

    return createSuccessResponse({ message: 'Role deleted successfully' });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const GET = withAuthorization(requirePermission('role', 'read'))(getHandler);
export const PATCH = withAuthorization(requirePermission('role', 'update'))(updateHandler);
export const DELETE = withAuthorization(requirePermission('role', 'delete'))(deleteHandler);










