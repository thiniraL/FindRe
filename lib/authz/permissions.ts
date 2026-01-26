import { dbLogin as supabase } from '@/lib/db/client';
import { Permission, Role } from '@/lib/types/auth';

type RolePermissionJoinRow = { permissions?: Permission | null };
type RoleJoin = { role_permissions?: RolePermissionJoinRow[] | null };
type UserRoleJoin = { roles?: RoleJoin | RoleJoin[] | null };
type UserPermissionJoinRow = { permissions?: Permission | null };

/**
 * Get all permissions for a user (role permissions + direct user permissions)
 */
export async function getUserPermissions(userId: string): Promise<Permission[]> {
  const permissionMap = new Map<string, Permission>();

  // Get role permissions
  const { data: userRoleData, error: userRoleError } = await supabase
    .from('user_roles')
    .select(`
      role_id,
      roles!inner(
        id,
        role_permissions!inner(
          permission_id,
          permissions!inner(
            id,
            resource,
            action,
            description,
            created_at
          )
        )
      )
    `)
    .eq('user_id', userId)
    .single();

  if (userRoleError && userRoleError.code !== 'PGRST116') {
    throw new Error(`Failed to fetch user role permissions: ${userRoleError.message}`);
  }

  // Add role permissions
  if (userRoleData) {
    const roles = (userRoleData as UserRoleJoin).roles;
    const role = Array.isArray(roles) ? roles[0] : roles;
    const rolePermissions = role?.role_permissions || [];
    rolePermissions.forEach((rp: RolePermissionJoinRow) => {
      const permission = rp.permissions;
      if (permission) {
        permissionMap.set(permission.id, permission);
      }
    });
  }

  // Get direct user permissions
  const { data: userPermData, error: userPermError } = await supabase
    .from('user_permissions')
    .select(`
      permission_id,
      permissions!inner(
        id,
        resource,
        action,
        description,
        created_at
      )
    `)
    .eq('user_id', userId);

  if (userPermError) {
    throw new Error(`Failed to fetch user direct permissions: ${userPermError.message}`);
  }

  // Add direct user permissions
  (userPermData as UserPermissionJoinRow[] | null | undefined)?.forEach((up) => {
    const permission = up.permissions;
    if (permission) {
      permissionMap.set(permission.id, permission);
    }
  });

  return Array.from(permissionMap.values());
}

/**
 * Get the role for a user (single role)
 */
export async function getUserRole(userId: string): Promise<Role | null> {
  const { data, error } = await supabase
    .from('user_roles')
    .select(`
      role_id,
      roles!inner(
        id,
        name,
        description,
        is_system,
        created_at,
        updated_at
      )
    `)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // User has no role
    }
    throw new Error(`Failed to fetch user role: ${error.message}`);
  }

  const roles = (data as { roles?: Role | Role[] | null } | null | undefined)?.roles;
  const role = Array.isArray(roles) ? roles[0] : roles;
  return role || null;
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

