import { getSupabaseClient } from '@/lib/db/client';
import { Permission, Role } from '@/lib/types/auth';

export async function getUserRole(userId: string): Promise<Role | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_roles')
    .select('role:roles(id, name, description, is_system, created_at, updated_at)')
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch user role: ${error.message}`);
  }

  const row = data as
    | { role: Role | null }
    | { role: Role[] }
    | null;
  if (!row) {
    return null;
  }
  if (Array.isArray(row.role)) {
    return row.role[0] || null;
  }
  return row.role || null;
}

export async function getUserPermissions(userId: string): Promise<Permission[]> {
  const supabase = getSupabaseClient();
  const rolePromise = getUserRole(userId);
  const directPromise = supabase
    .from('user_permissions')
    .select('permission:permissions(id, resource, action, description, created_at)')
    .eq('user_id', userId);

  const [role, directResult] = await Promise.all([rolePromise, directPromise]);

  if (directResult.error) {
    throw new Error(`Failed to fetch direct permissions: ${directResult.error.message}`);
  }

  const directPermissions = ((directResult.data || []) as Array<{
    permission: Permission | Permission[];
  }>).flatMap((row) => (Array.isArray(row.permission) ? row.permission : [row.permission]));
  let rolePermissions: Permission[] = [];

  if (role?.id) {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('permission:permissions(id, resource, action, description, created_at)')
      .eq('role_id', role.id);

    if (error) {
      throw new Error(`Failed to fetch role permissions: ${error.message}`);
    }

    rolePermissions = ((data || []) as Array<{ permission: Permission | Permission[] }>).flatMap(
      (row) => (Array.isArray(row.permission) ? row.permission : [row.permission])
    );
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
  const permissions = await getUserPermissions(userId);
  return permissions.some((perm) => perm.resource === resource && perm.action === action);
}

export async function hasAnyPermission(
  userId: string,
  permissions: Array<{ resource: string; action: string }>
): Promise<boolean> {
  const userPermissions = await getUserPermissions(userId);
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
  const userPermissions = await getUserPermissions(userId);
  return permissions.every((perm) =>
    userPermissions.some(
      (userPerm) => userPerm.resource === perm.resource && userPerm.action === perm.action
    )
  );
}
