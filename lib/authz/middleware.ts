import { NextRequest } from 'next/server';
import { hasPermission, hasAnyPermission, hasAllPermissions } from '@/lib/authz/permissions';
import { withAuth } from '@/lib/auth/middleware';
import { AppError } from '@/lib/utils/errors';
import { JWTPayload } from '@/lib/types/auth';

export type PermissionCheck =
  | { type: 'single'; resource: string; action: string }
  | { type: 'any'; permissions: Array<{ resource: string; action: string }> }
  | { type: 'all'; permissions: Array<{ resource: string; action: string }> };

/**
 * Authorization middleware that checks permissions
 */
export function withAuthorization(
  permissionCheck: PermissionCheck
) {
  return function <T extends unknown[]>(
    handler: (request: NextRequest, user: JWTPayload, ...args: T) => Promise<Response>
  ) {
    return withAuth(async (request: NextRequest, user: JWTPayload, ...args: T) => {
      let hasAccess = false;

      switch (permissionCheck.type) {
        case 'single':
          hasAccess = await hasPermission(
            user.userId,
            permissionCheck.resource,
            permissionCheck.action
          );
          break;
        case 'any':
          hasAccess = await hasAnyPermission(
            user.userId,
            permissionCheck.permissions
          );
          break;
        case 'all':
          hasAccess = await hasAllPermissions(
            user.userId,
            permissionCheck.permissions
          );
          break;
      }

      if (!hasAccess) {
        throw new AppError('Insufficient permissions', 403, 'FORBIDDEN');
      }

      return handler(request, user, ...args);
    });
  };
}

/**
 * Helper to create permission check for single permission
 */
export function requirePermission(resource: string, action: string): PermissionCheck {
  return { type: 'single', resource, action };
}

/**
 * Helper to create permission check for any of multiple permissions
 */
export function requireAnyPermission(
  permissions: Array<{ resource: string; action: string }>
): PermissionCheck {
  return { type: 'any', permissions };
}

/**
 * Helper to create permission check for all of multiple permissions
 */
export function requireAllPermissions(
  permissions: Array<{ resource: string; action: string }>
): PermissionCheck {
  return { type: 'all', permissions };
}




