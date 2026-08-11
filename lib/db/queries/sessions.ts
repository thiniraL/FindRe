import { query } from '@/lib/db/client';
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
  const result = await query<UserSession>(
    `INSERT INTO user_activity.user_sessions
     (session_id, user_id, ip_address, user_agent, country_code, language_code, preferred_language_code, last_activity_at, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     ON CONFLICT (session_id)
     DO UPDATE SET user_id = COALESCE(EXCLUDED.user_id, user_activity.user_sessions.user_id),
                   ip_address = COALESCE(EXCLUDED.ip_address, user_activity.user_sessions.ip_address),
                   user_agent = COALESCE(EXCLUDED.user_agent, user_activity.user_sessions.user_agent),
                   country_code = COALESCE(EXCLUDED.country_code, user_activity.user_sessions.country_code),
                   language_code = COALESCE(EXCLUDED.language_code, user_activity.user_sessions.language_code),
                   preferred_language_code = COALESCE(EXCLUDED.preferred_language_code, user_activity.user_sessions.preferred_language_code),
                   last_activity_at = EXCLUDED.last_activity_at,
                   is_active = EXCLUDED.is_active,
                   updated_at = NOW()
     RETURNING *`,
    [
      sessionId,
      options.userId || null,
      options.ipAddress || null,
      options.userAgent || null,
      options.countryCode || null,
      options.languageCode || null,
      options.preferredLanguageCode || null,
      new Date().toISOString(),
    ]
  );

  return result.rows[0];
}

/**
 * Get user session by session ID
 */
export async function getUserSession(sessionId: string): Promise<UserSession | null> {
  const result = await query<UserSession>(
    'SELECT * FROM user_activity.user_sessions WHERE session_id = $1',
    [sessionId]
  );
  return result.rows[0] || null;
}

/**
 * Link session to user (when user logs in)
 */
export async function linkSessionToUser(
  sessionId: string,
  userId: string,
  preferredLanguageCode?: string
): Promise<UserSession> {
  const result = await query<UserSession>(
    `UPDATE user_activity.user_sessions
     SET user_id = $2,
         last_activity_at = $3,
         preferred_language_code = COALESCE($4, preferred_language_code),
         language_code = COALESCE($4, language_code)
     WHERE session_id = $1
     RETURNING *`,
    [sessionId, userId, new Date().toISOString(), preferredLanguageCode || null]
  );

  return result.rows[0];
}

/**
 * Update session language preference
 */
export async function updateSessionLanguagePreference(
  sessionId: string,
  languageCode: string
): Promise<UserSession> {
  const result = await query<UserSession>(
    `UPDATE user_activity.user_sessions
     SET preferred_language_code = $2,
         language_code = $2,
         last_activity_at = $3
     WHERE session_id = $1
     RETURNING *`,
    [sessionId, languageCode, new Date().toISOString()]
  );

  return result.rows[0];
}

/**
 * Sync all user sessions with user's preferred language
 */
export async function syncUserSessionsLanguage(
  userId: string,
  languageCode: string
): Promise<void> {
  await query(
    `UPDATE user_activity.user_sessions
     SET preferred_language_code = $2,
         language_code = $2,
         updated_at = NOW()
     WHERE user_id = $1
       AND is_active = true`,
    [userId, languageCode]
  );
}

/**
 * Update session last activity
 */
export async function updateSessionActivity(sessionId: string): Promise<void> {
  try {
    await query(
      `UPDATE user_activity.user_sessions
       SET last_activity_at = $2
       WHERE session_id = $1`,
      [sessionId, new Date().toISOString()]
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to update session activity: ${message}`);
  }
}

/**
 * Get all active sessions for a user
 */
export async function getUserSessions(userId: string): Promise<UserSession[]> {
  const result = await query<UserSession>(
    `SELECT *
     FROM user_activity.user_sessions
     WHERE user_id = $1
       AND is_active = true
     ORDER BY last_activity_at DESC`,
    [userId]
  );

  return result.rows;
}

/**
 * Deactivate session
 */
export async function deactivateSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE user_activity.user_sessions
     SET is_active = false,
         updated_at = NOW()
     WHERE session_id = $1`,
    [sessionId]
  );
}

