import { NextRequest } from 'next/server';
import { getUserById } from '@/lib/db/queries/users';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateParams } from '@/lib/security/validation';
import { userIdSchema } from '@/lib/security/validation';
import { withAuth } from '@/lib/auth/middleware';
import { hasPermission } from '@/lib/authz/permissions';
import { JWTPayload } from '@/lib/types/auth';

async function handler(
  request: NextRequest,
  user: JWTPayload,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = validateParams(params, userIdSchema);

    // Users can view their own profile, or need user:read permission
    if (id !== user.userId) {
      const hasAccess = await hasPermission(user.userId, 'user', 'read');
      if (!hasAccess) {
        return createErrorResponse(new Error('Insufficient permissions'));
      }
    }

    const targetUser = await getUserById(id);
    if (!targetUser) {
      return createErrorResponse(new Error('User not found'));
    }

    return createSuccessResponse({
      user: {
        id: targetUser.id,
        email: targetUser.email,
        emailVerified: targetUser.email_verified,
        twoFactorEnabled: targetUser.two_factor_enabled,
        lastLogin: targetUser.last_login,
        isActive: targetUser.is_active,
        createdAt: targetUser.created_at,
        updatedAt: targetUser.updated_at,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const GET = withAuth(handler);

