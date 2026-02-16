/**
 * In-memory caches for filter config, property details, and feed preferences.
 * For production with multiple instances, consider Redis or Vercel KV.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class SimpleCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private defaultTTL: number;

  constructor(defaultTTLMs: number) {
    this.defaultTTL = defaultTTLMs;
  }

  set<T>(key: string, value: T, ttl?: number): void {
    const expiresAt = Date.now() + (ttl ?? this.defaultTTL);
    this.cache.set(key, { data: value, expiresAt });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
  }
}

// Filter config: 10 minutes (config refreshed by filter-config-refresh)
const FILTER_CONFIG_TTL = 10 * 60 * 1000;
export const filterConfigCache = new SimpleCache(FILTER_CONFIG_TTL);

// Property detail: 2 minutes (balance freshness vs load)
const PROPERTY_DETAIL_TTL = 2 * 60 * 1000;
export const propertyDetailCache = new SimpleCache(PROPERTY_DETAIL_TTL);

// Feed preferences: 2 minutes (prefs change on onboarding/analyze)
const FEED_PREFS_TTL = 2 * 60 * 1000;
export const feedPrefsCache = new SimpleCache(FEED_PREFS_TTL);

// Default role (e.g. "buyer") for registration - invalidate when roles change
const ROLE_CACHE_TTL = 10 * 60 * 1000;
export const roleCache = new SimpleCache(ROLE_CACHE_TTL);

// Email verification 6-digit OTP (10 min expiry)
const EMAIL_VERIFICATION_OTP_TTL = 10 * 60 * 1000;
export const emailVerificationOtpCache = new SimpleCache(EMAIL_VERIFICATION_OTP_TTL);

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    filterConfigCache.cleanup();
    propertyDetailCache.cleanup();
    feedPrefsCache.cleanup();
    roleCache.cleanup();
    emailVerificationOtpCache.cleanup();
  }, 10 * 60 * 1000);
}
