import { NextRequest, NextResponse } from 'next/server';

// Simple in-memory rate limiter (for production, use Redis/Vercel KV)
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }

  check(
    identifier: string,
    limit: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const entry = this.store.get(identifier);

    if (!entry || now > entry.resetTime) {
      // Create new entry
      const resetTime = now + windowMs;
      this.store.set(identifier, { count: 1, resetTime });
      return { allowed: true, remaining: limit - 1, resetTime };
    }

    // Increment count
    entry.count++;
    const allowed = entry.count <= limit;

    return {
      allowed,
      remaining: Math.max(0, limit - entry.count),
      resetTime: entry.resetTime,
    };
  }

  reset(identifier: string): void {
    this.store.delete(identifier);
  }
}

const rateLimiter = new RateLimiter();

export interface RateLimitOptions {
  limit: number; // Number of requests
  windowMs: number; // Time window in milliseconds
  identifier?: (request: NextRequest) => string; // Custom identifier function
}

/**
 * Get client identifier (IP address or user ID)
 */
function getClientIdentifier(request: NextRequest, userId?: string): string {
  if (userId) {
    return `user:${userId}`;
  }

  // Try to get IP from various headers (Vercel, Cloudflare, etc.)
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = forwarded?.split(',')[0] || realIp || 'unknown';

  return `ip:${ip}`;
}

/**
 * Rate limiting middleware
 */
export function withRateLimit(options: RateLimitOptions) {
  return function <T extends unknown[]>(
    handler: (request: NextRequest, ...args: T) => Promise<Response>
  ) {
    return async (request: NextRequest, ...args: T): Promise<Response> => {
      const identifier = options.identifier
        ? options.identifier(request)
        : getClientIdentifier(request);

      const result = rateLimiter.check(
        identifier,
        options.limit,
        options.windowMs
      );

      if (!result.allowed) {
        return NextResponse.json(
          {
            error: {
              message: 'Too many requests',
              code: 'RATE_LIMIT_EXCEEDED',
            },
          },
          {
            status: 429,
            headers: {
              'X-RateLimit-Limit': options.limit.toString(),
              'X-RateLimit-Remaining': result.remaining.toString(),
              'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
              'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString(),
            },
          }
        );
      }

      const response = await handler(request, ...args);

      // Add rate limit headers to response
      response.headers.set('X-RateLimit-Limit', options.limit.toString());
      response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
      response.headers.set('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

      return response;
    };
  };
}

/**
 * Predefined rate limit configurations
 */
export const rateLimits = {
  // Authentication endpoints - stricter limits
  auth: { limit: 5, windowMs: 15 * 60 * 1000 }, // 5 requests per 15 minutes
  login: { limit: 5, windowMs: 15 * 60 * 1000 }, // 5 requests per 15 minutes
  register: { limit: 3, windowMs: 60 * 60 * 1000 }, // 3 requests per hour
  passwordReset: { limit: 3, windowMs: 60 * 60 * 1000 }, // 3 requests per hour

  // General API endpoints
  default: { limit: 100, windowMs: 60 * 1000 }, // 100 requests per minute
  strict: { limit: 20, windowMs: 60 * 1000 }, // 20 requests per minute
};




