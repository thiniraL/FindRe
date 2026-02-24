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

export const googleLoginSchema = z.object({
  idToken: z.string().min(1, 'ID token is required'),
  deviceId: z.string().optional(),
  sessionId: z.string().optional(), // For linking anonymous session
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const emailVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'Verification code must be 6 digits').regex(/^\d{6}$/, 'Verification code must be 6 digits'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
  code: z.string().length(6, 'Reset code must be 6 digits').regex(/^\d{6}$/, 'Reset code must be 6 digits'),
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

// Featured / onboarding / views schemas
export const featuredQuerySchema = z.object({
  countryId: z.coerce.number().int().min(1),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).transform(({ countryId, page, limit }) => ({
  countryId,
  page: page ?? 1,
  limit: limit ?? 25,
}));

// Filters by purpose (search filter config)
export const filtersQuerySchema = z.object({
  purpose: z.string().min(1, 'purpose is required'),
  countryId: z.coerce.number().int().min(1).optional(),
  currencyId: z.coerce.number().int().min(1).optional(),
  languageCode: z.string().max(5).optional(),
});

// Search with filter values (Typesense). Purpose optional: can be inferred from q (e.g. "selling" → for_sale, "rent" → for_rent).
export const searchQuerySchema = z.object({
  purpose: z.string().min(1).optional(),
  /** Natural language query: parsed into purpose, location, beds, baths, price, features, etc. */
  q: z.string().optional(),
  countryId: z.coerce.number().int().min(1).optional(),
  location: z.string().optional(),
  /** 'all' = no filter; any other value filters by completion_status (distinct from property table) */
  completionStatus: z.string().optional(),
  mainPropertyTypeIds: z.string().optional(), // comma-separated main type IDs
  propertyTypeIds: z.string().optional(), // comma-separated IDs (sub/property types)
  bedrooms: z.string().optional(), // comma-separated, e.g. "1,2,3"
  bathrooms: z.string().optional(), // comma-separated, e.g. "2,3"
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  areaMin: z.coerce.number().min(0).optional(),
  areaMax: z.coerce.number().min(0).optional(),
    /** Single string or comma-separated keywords, e.g. "beach,golf,marina" */
    keyword: z.string().optional(),
    /** JSON array of { id: number, type: "agent"|"agency" } e.g. [{"id":1,"type":"agent"},{"id":2,"type":"agency"}] */
    agentIds: z.string().optional(),
    featureIds: z.string().optional(), // comma-separated feature IDs
  /** Use Typesense Natural Language Search (LLM parses q into filters/sorts). */
  nl_query: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** One agent/agency entry for agentIds filter. */
export const agentIdFilterEntrySchema = z.object({
  id: z.number().int().min(1),
  type: z.enum(['agency', 'agent']),
});
export type AgentIdFilterEntry = z.infer<typeof agentIdFilterEntrySchema>;

/** Search request body for POST. Supports arrays for multi-select filters. */
export const searchBodySchema = z
  .object({
    purpose: z.string().min(1).optional(),
    q: z.string().optional(),
    countryId: z.coerce.number().int().min(1).optional(),
    location: z.string().optional(),
    completionStatus: z.array(z.string()).optional(),
    mainPropertyTypeIds: z.array(z.number().int().min(1)).optional(),
    propertyTypeIds: z.array(z.number().int().min(1)).optional(),
    bedrooms: z.array(z.union([z.number().int().min(0), z.string().regex(/^\d+\+$/)])).optional(),
    bathrooms: z.array(z.union([z.number().int().min(1), z.string().regex(/^\d+\+$/)])).optional(),
    /** Price range: [min, max], index 0 = min, index 1 = max */
    price: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
    /** Area range (sqm): [min, max], index 0 = min, index 1 = max */
    area: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
    /** Keywords: string or array e.g. ["beach", "golf", "marina"]; joined to one search string */
    keyword: z.union([z.string(), z.array(z.string())]).optional(),
    /** Agent/agency filter: [{"id": number, "type": "agent"|"agency"}, ...]. Maps to Typesense agent_id and agency_id. */
    agentIds: z.array(agentIdFilterEntrySchema).optional(),
    featureIds: z.array(z.number().int().min(1)).optional(),
    /** Use Typesense Natural Language Search (LLM parses q into filters/sorts). */
    nl_query: z.boolean().optional(),
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const onboardingPreferencesSchema = z
  .object({
    preferredBedroomsMin: z.number().int().min(0).optional(),
    preferredBedroomsMax: z.number().int().min(0).optional(),
    preferredBathroomsMin: z.number().int().min(0).optional(),
    preferredBathroomsMax: z.number().int().min(0).optional(),
    preferredPriceMin: z.number().min(0).optional(),
    preferredPriceMax: z.number().min(0).optional(),

    preferredPropertyTypeIds: z.array(z.number().int().min(1)).optional(),
    preferredLocationIds: z.array(z.number().int().min(1)).optional(),
    preferredPurposeIds: z.array(z.number().int().min(1)).optional(),
    preferredFeatureIds: z.array(z.number().int().min(1)).optional(),
  })
  .strict();

export const propertyIdSchema = z.object({
  id: z.coerce.number().int().min(1, 'Property ID must be a positive integer'),
});

export const propertyViewSchema = z
  .object({
    propertyId: z.number().int().min(1),
    viewDurationSeconds: z.number().int().min(0).optional(),
    viewedAt: z.string().datetime().optional(),
    is_like: z.boolean().optional(),
    analyzeNow: z.boolean().optional(),
  })
  .strict();

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

