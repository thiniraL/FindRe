import { z } from 'zod';

// Authentication schemas
export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
  deviceId: z.string().optional(),
  preferredLanguageCode: z.string().length(2, 'Language code must be 2 characters').optional(),
  sessionId: z.string().optional(), // For linking anonymous session
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  deviceId: z.string().optional(),
  sessionId: z.string().optional(), // For linking anonymous session
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const emailVerificationSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

// User management schemas
export const updateUserSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  twoFactorEnabled: z.boolean().optional(),
  preferredLanguageCode: z.string().length(2, 'Language code must be 2 characters').optional(),
}).strict();

export const updateLanguagePreferenceSchema = z.object({
  languageCode: z.string().length(2, 'Language code must be 2 characters'),
});

export const userIdSchema = z.object({
  id: z.string().uuid('Invalid user ID'),
});

// Role management schemas
export const createRoleSchema = z.object({
  name: z.string().min(1, 'Role name is required').max(100),
  description: z.string().optional(),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
});

export const roleIdSchema = z.object({
  id: z.string().uuid('Invalid role ID'),
});

export const assignRoleSchema = z.object({
  roleId: z.string().uuid('Invalid role ID'),
});

// Permission schemas
export const createPermissionSchema = z.object({
  resource: z.string().min(1, 'Resource is required').max(100),
  action: z.string().min(1, 'Action is required').max(100),
  description: z.string().optional(),
});

// Pagination schemas
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Query parameter schemas
export const queryParamsSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

/**
 * Validate request body against a schema
 */
export async function validateBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<T> {
  const body = await request.json();
  return schema.parse(body);
}

/**
 * Validate query parameters against a schema
 */
export function validateQuery<T>(
  request: Request,
  schema: z.ZodSchema<T>
): T {
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return schema.parse(params);
}

/**
 * Validate path parameters
 */
export function validateParams<T>(
  params: Record<string, string | string[] | undefined>,
  schema: z.ZodSchema<T>
): T {
  return schema.parse(params);
}

