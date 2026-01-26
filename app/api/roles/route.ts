import { NextRequest } from 'next/server';
import { getAllRoles, createRole } from '@/lib/db/queries/roles';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { createRoleSchema } from '@/lib/security/validation';
import { withAuthorization, requirePermission } from '@/lib/authz/middleware';
import { JWTPayload } from '@/lib/types/auth';

async function listHandler(_request: NextRequest, _user: JWTPayload) {
  try {
    void _request;
    void _user;
    const roles = await getAllRoles();

    return createSuccessResponse({ roles });
  } catch (error) {
    return createErrorResponse(error);
  }
}

async function createHandler(request: NextRequest, _user: JWTPayload) {
  try {
    void _user;
    const body = await validateBody(request, createRoleSchema);
    const role = await createRole(body.name, body.description);

    return createSuccessResponse({ role }, 201);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const GET = withAuthorization(requirePermission('role', 'read'))(listHandler);
export const POST = withAuthorization(requirePermission('role', 'create'))(createHandler);




