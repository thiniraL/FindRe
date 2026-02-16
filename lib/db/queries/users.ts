import { query } from '@/lib/db/client';
import { User, UserWithPassword } from '@/lib/types/auth';
import { hashPassword, generateToken } from '@/lib/auth/password';
import { AppError } from '@/lib/utils/errors';

const USER_COLUMNS =
  'id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at';

/**
 * Create a new user
 */
export async function createUser(
  email: string,
  password: string,
  preferredLanguageCode?: string
): Promise<User> {
  const passwordHash = await hashPassword(password);
  const emailVerificationToken = generateToken();
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const result = await query<User>(
      `INSERT INTO login.users (email, password_hash, email_verification_token, preferred_language_code)
       VALUES ($1, $2, $3, $4)
       RETURNING ${USER_COLUMNS}`,
      [normalizedEmail, passwordHash, emailVerificationToken, preferredLanguageCode || 'en']
    );

    return result.rows[0];
  } catch (error: unknown) {
    const pgError = error as { code?: string; message?: string };
    if (pgError?.code === '23505') {
      throw new AppError('Email already exists', 409, 'EMAIL_ALREADY_EXISTS');
    }
    throw new Error(`Failed to create user: ${pgError?.message || 'Unknown error'}`);
  }
}

/**
 * Create user and return verification token for email sending
 */
export async function createUserWithVerificationToken(
  email: string,
  password: string,
  preferredLanguageCode?: string
): Promise<{ user: User; emailVerificationToken: string }> {
  const passwordHash = await hashPassword(password);
  const emailVerificationToken = generateToken();
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const result = await query<User>(
      `INSERT INTO login.users (email, password_hash, email_verification_token, preferred_language_code)
       VALUES ($1, $2, $3, $4)
       RETURNING ${USER_COLUMNS}`,
      [normalizedEmail, passwordHash, emailVerificationToken, preferredLanguageCode || 'en']
    );

    return { user: result.rows[0], emailVerificationToken };
  } catch (error: unknown) {
    const pgError = error as { code?: string; message?: string };
    if (pgError?.code === '23505') {
      throw new AppError('Email already exists', 409, 'EMAIL_ALREADY_EXISTS');
    }
    throw new Error(`Failed to create user: ${pgError?.message || 'Unknown error'}`);
  }
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  const result = await query<User>(
    `SELECT ${USER_COLUMNS}
     FROM login.users
     WHERE id = $1`,
    [userId]
  );

  return result.rows[0] || null;
}

/**
 * Get user by email (with password hash for authentication)
 */
export async function getUserByEmail(email: string): Promise<UserWithPassword | null> {
  const normalizedEmail = email.toLowerCase().trim();
  const result = await query<UserWithPassword>(
    'SELECT * FROM login.users WHERE email = $1',
    [normalizedEmail]
  );

  return result.rows[0] || null;
}

/**
 * Update user
 */
export async function updateUser(
  userId: string,
  updates: Partial<User>
): Promise<User> {
  const fields: Array<keyof User> = [
    'email',
    'email_verified',
    'two_factor_enabled',
    'last_login',
    'is_active',
    'preferred_language_code',
  ];

  const setParts: string[] = [];
  const values: Array<string | boolean | Date | null> = [];

  fields.forEach((field) => {
    const value = updates[field];
    if (value !== undefined) {
      setParts.push(`${field} = $${values.length + 1}`);
      values.push(value as string | boolean | Date | null);
    }
  });

  if (setParts.length === 0) {
    throw new Error('No valid fields to update');
  }

  values.push(userId);

  const result = await query<User>(
    `UPDATE login.users
     SET ${setParts.join(', ')}
     WHERE id = $${values.length}
     RETURNING ${USER_COLUMNS}`,
    values
  );

  return result.rows[0];
}

/**
 * Verify user email
 */
export async function verifyUserEmail(token: string): Promise<User> {
  const result = await query<User>(
    `UPDATE login.users
     SET email_verified = true,
         email_verification_token = NULL
     WHERE email_verification_token = $1
     RETURNING ${USER_COLUMNS}`,
    [token]
  );

  if (!result.rows[0]) {
    throw new Error('Invalid or expired verification token');
  }

  return result.rows[0];
}

/**
 * Set password reset token
 */
export async function setPasswordResetToken(
  email: string,
  token: string,
  expiresAt: Date
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  await query(
    `UPDATE login.users
     SET password_reset_token = $1,
         password_reset_expires = $2
     WHERE email = $3`,
    [token, expiresAt.toISOString(), normalizedEmail]
  );
}

/**
 * Set email verification token (for resend verification)
 */
export async function setEmailVerificationToken(
  email: string,
  token: string
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  await query(
    `UPDATE login.users
     SET email_verification_token = $1,
         email_verified = false
     WHERE email = $2`,
    [token, normalizedEmail]
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
  const result = await query<User>(
    `UPDATE login.users
     SET password_hash = $1,
         password_reset_token = NULL,
         password_reset_expires = NULL
     WHERE password_reset_token = $2
       AND password_reset_expires >= $3
     RETURNING ${USER_COLUMNS}`,
    [passwordHash, token, new Date().toISOString()]
  );

  if (!result.rows[0]) {
    throw new AppError('Invalid or expired reset token', 400, 'INVALID_RESET_TOKEN');
  }

  return result.rows[0];
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
  const result = await query<User>(
    `UPDATE login.users
     SET preferred_language_code = $1
     WHERE id = $2
     RETURNING ${USER_COLUMNS}`,
    [languageCode, userId]
  );

  return result.rows[0];
}

/**
 * List all users (admin use)
 */
export async function getAllUsers(): Promise<User[]> {
  const result = await query<User>(
    `SELECT ${USER_COLUMNS}
     FROM login.users
     ORDER BY created_at DESC`
  );

  return result.rows;
}

