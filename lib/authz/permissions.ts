import { Permission, Role } from '@/lib/types/auth';
import { query, queryOne } from '@/lib/db/pg';

/**
 * Get all permissions for a user (role permissions + direct user permissions)
 */
export async function getUserPermissions(userId: string): Promise<Permission[]> {
  // UNION role-based permissions and direct user permissions.
  return await query<Permission>(
    `SELECT DISTINCT p.id, p.resource, p.action, p.description, p.created_at
     FROM login.permissions p
     JOIN login.role_permissions rp ON rp.permission_id = p.id
     JOIN login.user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = $1
     UNION
     SELECT DISTINCT p.id, p.resource, p.action, p.description, p.created_at
     FROM login.permissions p
     JOIN login.user_permissions up ON up.permission_id = p.id
     WHERE up.user_id = $1`,
    [userId]
  );
}

/**
 * Get the role for a user (single role)
 */
export async function getUserRole(userId: string): Promise<Role | null> {
  return await queryOne<Role>(
    `SELECT r.id, r.name, r.description, r.is_system, r.created_at, r.updated_at
     FROM login.user_roles ur
     JOIN login.roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [userId]
  );
}

/**
 * Get all roles for a user (for backward compatibility, returns array with single role)
 */
export async function getUserRoles(userId: string): Promise<Role[]> {
  const role = await getUserRole(userId);
  return role ? [role] : [];
}

/**
 * Check if user has a specific permission
 */
export async function hasPermission(
  userId: string,
  resource: string,
  action: string
): Promise<boolean> {
  const permissions = await getUserPermissions(userId);
  return permissions.some(
    (p) => p.resource === resource && p.action === action
  );
}

/**
 * Check if user has any of the specified permissions
 */
export async function hasAnyPermission(
  userId: string,
  requiredPermissions: Array<{ resource: string; action: string }>
): Promise<boolean> {
  const permissions = await getUserPermissions(userId);
  return requiredPermissions.some((required) =>
    permissions.some(
      (p) => p.resource === required.resource && p.action === required.action
    )
  );
}

/**
 * Check if user has all of the specified permissions
 */
export async function hasAllPermissions(
  userId: string,
  requiredPermissions: Array<{ resource: string; action: string }>
): Promise<boolean> {
  const permissions = await getUserPermissions(userId);
  return requiredPermissions.every((required) =>
    permissions.some(
      (p) => p.resource === required.resource && p.action === required.action
    )
  );
}

/**
 * Check if user has a specific role
 */
export async function hasRole(userId: string, roleName: string): Promise<boolean> {
  const role = await getUserRole(userId);
  return role?.name === roleName;
}

/**
 * Check if user has any of the specified roles
 */
export async function hasAnyRole(
  userId: string,
  roleNames: string[]
): Promise<boolean> {
  const role = await getUserRole(userId);
  return role ? roleNames.includes(role.name) : false;
}

