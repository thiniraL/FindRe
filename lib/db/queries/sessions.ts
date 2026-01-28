import { getSupabaseClient } from '@/lib/db/client';
import { UserSession } from '@/lib/types/auth';

/**
 * Create or update user session (supports both authenticated and anonymous users)
 */
export async function createOrUpdateUserSession(
  sessionId: string,
  options: {
    userId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    countryCode?: string | null;
    languageCode?: string | null;
    preferredLanguageCode?: string | null;
  }
): Promise<UserSession> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_sessions')
    .upsert({
      session_id: sessionId,
      user_id: options.userId || null,
      ip_address: options.ipAddress || null,
      user_agent: options.userAgent || null,
      country_code: options.countryCode || null,
      language_code: options.languageCode || null,
      preferred_language_code: options.preferredLanguageCode || null,
      last_activity_at: new Date().toISOString(),
      is_active: true,
    }, {
      onConflict: 'session_id',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create/update session: ${error.message}`);
  }

  return data as UserSession;
}

/**
 * Get user session by session ID
 */
export async function getUserSession(sessionId: string): Promise<UserSession | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch session: ${error.message}`);
  }

  return data as UserSession;
}

/**
 * Link session to user (when user logs in)
 */
export async function linkSessionToUser(
  sessionId: string,
  userId: string,
  preferredLanguageCode?: string
): Promise<UserSession> {
  const supabase = getSupabaseClient();
  const updateData: {
    user_id: string;
    last_activity_at: string;
    preferred_language_code?: string;
    language_code?: string;
  } = {
    user_id: userId,
    last_activity_at: new Date().toISOString(),
  };

  // Update preferred language if provided
  if (preferredLanguageCode) {
    updateData.preferred_language_code = preferredLanguageCode;
    updateData.language_code = preferredLanguageCode;
  }

  const { data, error } = await supabase
    .from('user_sessions')
    .update(updateData)
    .eq('session_id', sessionId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to link session to user: ${error.message}`);
  }

  return data as UserSession;
}

/**
 * Update session language preference
 */
export async function updateSessionLanguagePreference(
  sessionId: string,
  languageCode: string
): Promise<UserSession> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_sessions')
    .update({
      preferred_language_code: languageCode,
      language_code: languageCode,
      last_activity_at: new Date().toISOString(),
    })
    .eq('session_id', sessionId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update session language: ${error.message}`);
  }

  return data as UserSession;
}

/**
 * Sync all user sessions with user's preferred language
 */
export async function syncUserSessionsLanguage(
  userId: string,
  languageCode: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('user_sessions')
    .update({
      preferred_language_code: languageCode,
      language_code: languageCode,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to sync user sessions language: ${error.message}`);
  }
}

/**
 * Update session last activity
 */
export async function updateSessionActivity(sessionId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('user_sessions')
    .update({
      last_activity_at: new Date().toISOString(),
    })
    .eq('session_id', sessionId);

  if (error) {
    // Don't throw error for activity updates - it's not critical
    console.error(`Failed to update session activity: ${error.message}`);
  }
}

/**
 * Get all active sessions for a user
 */
export async function getUserSessions(userId: string): Promise<UserSession[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('last_activity_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch user sessions: ${error.message}`);
  }

  return (data || []) as UserSession[];
}

/**
 * Deactivate session
 */
export async function deactivateSession(sessionId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('user_sessions')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('session_id', sessionId);

  if (error) {
    throw new Error(`Failed to deactivate session: ${error.message}`);
  }
}

