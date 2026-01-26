import { Permission } from '@/lib/types/auth';
import { getUserPermissions } from '@/lib/authz/permissions';
import { permissionCache } from '@/lib/authz/cache';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached user permissions or fetch from DB
 */
export async function getCachedUserPermissions(
  userId: string
): Promise<Permission[]> {
  const cacheKey = `user:${userId}:permissions`;

  // Try cache first
  const cached = permissionCache.get<Permission[]>(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch from DB
  const permissions = await getUserPermissions(userId);

  // Cache the result
  permissionCache.set(cacheKey, permissions, CACHE_TTL);

  return permissions;
}

/**
 * Invalidate user permissions cache
 */
export function invalidateUserPermissionsCache(userId: string): void {
  const cacheKey = `user:${userId}:permissions`;
  permissionCache.delete(cacheKey);
}

/**
 * Invalidate all permission caches (use when roles/permissions change)
 */
export function invalidateAllPermissionCaches(): void {
  permissionCache.clear();
}




