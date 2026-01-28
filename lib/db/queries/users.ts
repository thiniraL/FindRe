import { getSupabaseClient } from '@/lib/db/client';
import { User, UserWithPassword } from '@/lib/types/auth';
import { hashPassword, generateToken } from '@/lib/auth/password';

/**
 * Create a new user
 */
export async function createUser(
  email: string,
  password: string,
  preferredLanguageCode?: string
): Promise<User> {
  const supabase = getSupabaseClient();
  const passwordHash = await hashPassword(password);
  const emailVerificationToken = generateToken();

  const { data, error } = await supabase
    .from('users')
    .insert({
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      email_verification_token: emailVerificationToken,
      preferred_language_code: preferredLanguageCode || 'en',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      // Unique constraint violation
      throw new Error('Email already exists');
    }
    throw new Error(`Failed to create user: ${error.message}`);
  }

  // Remove password_hash from returned data
  const { password_hash, ...user } = data;
  void password_hash;
  return user as User;
}

/**
 * Create user and return verification token for email sending
 */
export async function createUserWithVerificationToken(
  email: string,
  password: string,
  preferredLanguageCode?: string
): Promise<{ user: User; emailVerificationToken: string }> {
  const supabase = getSupabaseClient();
  const passwordHash = await hashPassword(password);
  const emailVerificationToken = generateToken();

  const { data, error } = await supabase
    .from('users')
    .insert({
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      email_verification_token: emailVerificationToken,
      preferred_language_code: preferredLanguageCode || 'en',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Email already exists');
    }
    throw new Error(`Failed to create user: ${error.message}`);
  }

  const { password_hash, ...user } = data;
  void password_hash;
  return { user: user as User, emailVerificationToken };
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at')
    .eq('id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch user: ${error.message}`);
  }

  return data as User;
}

/**
 * Get user by email (with password hash for authentication)
 */
export async function getUserByEmail(email: string): Promise<UserWithPassword | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch user: ${error.message}`);
  }

  return data as UserWithPassword;
}

/**
 * Update user
 */
export async function updateUser(
  userId: string,
  updates: Partial<User>
): Promise<User> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select('id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(`Failed to update user: ${error.message}`);
  }

  return data as User;
}

/**
 * Verify user email
 */
export async function verifyUserEmail(token: string): Promise<User> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .update({
      email_verified: true,
      email_verification_token: null,
    })
    .eq('email_verification_token', token)
    .select('id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error('Invalid or expired verification token');
  }

  return data as User;
}

/**
 * Set password reset token
 */
export async function setPasswordResetToken(
  email: string,
  token: string,
  expiresAt: Date
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('users')
    .update({
      password_reset_token: token,
      password_reset_expires: expiresAt.toISOString(),
    })
    .eq('email', email.toLowerCase().trim());

  if (error) {
    throw new Error(`Failed to set password reset token: ${error.message}`);
  }
}

/**
 * Set email verification token (for resend verification)
 */
export async function setEmailVerificationToken(
  email: string,
  token: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('users')
    .update({
      email_verification_token: token,
      email_verified: false,
    })
    .eq('email', email.toLowerCase().trim());

  if (error) {
    throw new Error(`Failed to set email verification token: ${error.message}`);
  }
}

/**
 * Reset password using token
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<User> {
  const supabase = getSupabaseClient();
  const passwordHash = await hashPassword(newPassword);

  const { data, error } = await supabase
    .from('users')
    .update({
      password_hash: passwordHash,
      password_reset_token: null,
      password_reset_expires: null,
    })
    .eq('password_reset_token', token)
    .gte('password_reset_expires', new Date().toISOString())
    .select('id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error('Invalid or expired reset token');
  }

  return data as User;
}

/**
 * Update last login timestamp
 */
export async function updateLastLogin(userId: string): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', userId);
}

/**
 * Update user language preference
 */
export async function updateUserLanguagePreference(
  userId: string,
  languageCode: string
): Promise<User> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .update({ preferred_language_code: languageCode })
    .eq('id', userId)
    .select('id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(`Failed to update language preference: ${error.message}`);
  }

  return data as User;
}

/**
 * List all users (admin use)
 */
export async function getAllUsers(): Promise<User[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, email, email_verified, two_factor_enabled, last_login, is_active, preferred_language_code, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch users: ${error.message}`);
  }

  return (data || []) as User[];
}

