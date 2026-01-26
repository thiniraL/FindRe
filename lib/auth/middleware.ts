import { NextRequest } from 'next/server';
import { verifyAccessToken, JWTPayload } from '@/lib/auth/jwt';
import { AppError } from '@/lib/utils/errors';

export interface AuthenticatedRequest extends NextRequest {
  user?: JWTPayload;
}

/**
 * Extract token from Authorization header
 */
function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Authenticate request and attach user to request object
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<JWTPayload> {
  const token = extractToken(request);

  if (!token) {
    throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  }

  try {
    const payload = verifyAccessToken(token);
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message === 'Token expired') {
      throw new AppError('Token expired', 401, 'TOKEN_EXPIRED');
    }
    throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
  }
}

/**
 * Middleware wrapper for authenticated routes
 */
export function withAuth<T extends unknown[]>(
  handler: (request: NextRequest, user: JWTPayload, ...args: T) => Promise<Response>
) {
  return async (request: NextRequest, ...args: T): Promise<Response> => {
    const user = await authenticateRequest(request);
    return handler(request, user, ...args);
  };
}




