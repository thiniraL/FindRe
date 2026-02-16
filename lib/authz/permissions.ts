import { query } from '@/lib/db/client';
import { Permission, Role } from '@/lib/types/auth';
import { permissionCache } from '@/lib/authz/cache';

const PERMISSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getPermissionsForCheck(userId: string): Promise<Permission[]> {
  const key = `user:${userId}:permissions`;
  const cached = permissionCache.get<Permission[]>(key);
  if (cached) return cached;
  const permissions = await getUserPermissions(userId);
  permissionCache.set(key, permissions, PERMISSION_CACHE_TTL);
  return permissions;
}

export async function getUserRole(userId: string): Promise<Role | null> {
  const result = await query<Role>(
    `SELECT r.*
     FROM login.user_roles ur
     JOIN login.roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

export async function getUserPermissions(userId: string): Promise<Permission[]> {
  const rolePromise = getUserRole(userId);
  const directPromise = query<Permission>(
    `SELECT p.*
     FROM login.user_permissions up
     JOIN login.permissions p ON p.id = up.permission_id
     WHERE up.user_id = $1`,
    [userId]
  );

  const [role, directResult] = await Promise.all([rolePromise, directPromise]);
  const directPermissions = directResult.rows;
  let rolePermissions: Permission[] = [];

  if (role?.id) {
    const roleResult = await query<Permission>(
      `SELECT p.*
       FROM login.role_permissions rp
       JOIN login.permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1`,
      [role.id]
    );
    rolePermissions = roleResult.rows;
  }

  const unique = new Map<string, Permission>();
  for (const permission of [...rolePermissions, ...directPermissions]) {
    if (permission?.id) {
      unique.set(permission.id, permission);
    }
  }

  return Array.from(unique.values());
}

export async function hasPermission(
  userId: string,
  resource: string,
  action: string
): Promise<boolean> {
  const permissions = await getPermissionsForCheck(userId);
  return permissions.some((perm) => perm.resource === resource && perm.action === action);
}

export async function hasAnyPermission(
  userId: string,
  permissions: Array<{ resource: string; action: string }>
): Promise<boolean> {
  const userPermissions = await getPermissionsForCheck(userId);
  return permissions.some((perm) =>
    userPermissions.some(
      (userPerm) => userPerm.resource === perm.resource && userPerm.action === perm.action
    )
  );
}

export async function hasAllPermissions(
  userId: string,
  permissions: Array<{ resource: string; action: string }>
): Promise<boolean> {
  const userPermissions = await getPermissionsForCheck(userId);
  return permissions.every((perm) =>
    userPermissions.some(
      (userPerm) => userPerm.resource === perm.resource && userPerm.action === perm.action
    )
  );
}
