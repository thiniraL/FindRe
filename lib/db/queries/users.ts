import { User, UserWithPassword } from '@/lib/types/auth';
import { hashPassword, generateToken } from '@/lib/auth/password';
import { isPgUniqueViolation, query, queryOne } from '@/lib/db/pg';

export type CreateUserResult = {
  user: User;
  emailVerificationToken: string;
};

/**
 * Create a new user
 */
export async function createUser(
  email: string,
  password: string,
  preferredLanguageCode?: string
): Promise<CreateUserResult> {
  const passwordHash = await hashPassword(password);
  const emailVerificationToken = generateToken();

  try {
    const user = await queryOne<User>(
      `INSERT INTO login.users (
        email,
        password_hash,
        email_verification_token,
        preferred_language_code
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at`,
      [
        email.toLowerCase().trim(),
        passwordHash,
        emailVerificationToken,
        preferredLanguageCode || 'en',
      ]
    );

    if (!user) {
      throw new Error('Failed to create user');
    }

    return { user, emailVerificationToken };
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new Error('Email already exists');
    }
    throw err instanceof Error
      ? new Error(`Failed to create user: ${err.message}`)
      : new Error('Failed to create user');
  }
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  const user = await queryOne<User>(
    `SELECT id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at
     FROM login.users
     WHERE id = $1`,
    [userId]
  );
  return user;
}

/**
 * Get user by email (with password hash for authentication)
 */
export async function getUserByEmail(email: string): Promise<UserWithPassword | null> {
  const user = await queryOne<UserWithPassword>(
    `SELECT *
     FROM login.users
     WHERE email = $1`,
    [email.toLowerCase().trim()]
  );
  return user;
}

/**
 * Update user
 */
export async function updateUser(
  userId: string,
  updates: Partial<User>
): Promise<User> {
  const keys = (Object.keys(updates) as Array<keyof User>).filter(
    (k): k is
      | 'email'
      | 'email_verified'
      | 'two_factor_enabled'
      | 'last_login'
      | 'is_active'
      | 'preferred_language_code' =>
      k === 'email' ||
      k === 'email_verified' ||
      k === 'two_factor_enabled' ||
      k === 'last_login' ||
      k === 'is_active' ||
      k === 'preferred_language_code'
  );
  if (keys.length === 0) {
    throw new Error('No valid fields to update');
  }

  const sets = keys.map((k, idx) => `"${k}" = $${idx + 1}`);
  const values = keys.map((k) => (updates as Record<string, unknown>)[k]);
  values.push(userId);

  const user = await queryOne<User>(
    `UPDATE login.users
     SET ${sets.join(', ')}
     WHERE id = $${values.length}
     RETURNING id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at`,
    values
  );

  if (!user) throw new Error('Failed to update user');
  return user;
}

/**
 * Verify user email
 */
export async function verifyUserEmail(token: string): Promise<User> {
  const user = await queryOne<User>(
    `UPDATE login.users
     SET email_verified = TRUE,
         email_verification_token = NULL
     WHERE email_verification_token = $1
     RETURNING id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at`,
    [token]
  );

  if (!user) throw new Error('Invalid or expired verification token');
  return user;
}

/**
 * Set email verification token (for resends)
 */
export async function setEmailVerificationToken(email: string, token: string): Promise<void> {
  await query(
    `UPDATE login.users
     SET email_verification_token = $1
     WHERE email = $2 AND email_verified = FALSE`,
    [token, email.toLowerCase().trim()]
  );
}

/**
 * Set password reset token
 */
export async function setPasswordResetToken(
  email: string,
  token: string,
  expiresAt: Date
): Promise<void> {
  await query(
    `UPDATE login.users
     SET password_reset_token = $1,
         password_reset_expires = $2
     WHERE email = $3`,
    [token, expiresAt.toISOString(), email.toLowerCase().trim()]
  );
}

/**
 * Reset password using token
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<User> {
  const passwordHash = await hashPassword(newPassword);

  const user = await queryOne<User>(
    `UPDATE login.users
     SET password_hash = $1,
         password_reset_token = NULL,
         password_reset_expires = NULL
     WHERE password_reset_token = $2
       AND password_reset_expires >= (NOW() AT TIME ZONE 'UTC')
     RETURNING id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at`,
    [passwordHash, token]
  );

  if (!user) throw new Error('Invalid or expired reset token');
  return user;
}

/**
 * Update last login timestamp
 */
export async function updateLastLogin(userId: string): Promise<void> {
  await query(
    `UPDATE login.users
     SET last_login = $1
     WHERE id = $2`,
    [new Date().toISOString(), userId]
  );
}

/**
 * Update user language preference
 */
export async function updateUserLanguagePreference(
  userId: string,
  languageCode: string
): Promise<User> {
  const user = await queryOne<User>(
    `UPDATE login.users
     SET preferred_language_code = $1
     WHERE id = $2
     RETURNING id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at`,
    [languageCode, userId]
  );

  if (!user) throw new Error('Failed to update language preference');
  return user;
}

export type ListUsersResult = {
  users: Array<Pick<User, 'id' | 'email' | 'email_verified' | 'two_factor_enabled' | 'last_login' | 'is_active' | 'created_at' | 'updated_at'>>;
  total: number;
};

export async function listUsers(options: {
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit: number;
  offset: number;
}): Promise<ListUsersResult> {
  const allowedSort = new Set([
    'created_at',
    'updated_at',
    'email',
    'last_login',
    'is_active',
  ]);

  const sortBy = allowedSort.has(options.sortBy || '') ? (options.sortBy as string) : 'created_at';
  const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';

  const search = options.search?.trim() ? options.search.trim() : null;

  // NOTE: sortBy/sortOrder are whitelisted above (safe to interpolate).
  const rows = await query<
    Pick<User, 'id' | 'email' | 'email_verified' | 'two_factor_enabled' | 'last_login' | 'is_active' | 'created_at' | 'updated_at'> & {
      total_count: number;
    }
  >(
    `WITH filtered AS (
        SELECT id, email, email_verified, two_factor_enabled, last_login, is_active, created_at, updated_at
        FROM login.users
        WHERE ($1::text IS NULL OR email ILIKE '%' || $1 || '%')
      )
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM filtered
      ORDER BY "${sortBy}" ${sortOrder}
      LIMIT $2 OFFSET $3`,
    [search, options.limit, options.offset]
  );

  const total = rows[0]?.total_count ?? 0;
  const users = rows.map((r) => {
    const { total_count, ...u } = r;
    void total_count;
    return u;
  });
  return { users, total };
}

