import { dbLogin as supabase } from '@/lib/db/client';
import { Role, Permission } from '@/lib/types/auth';

type PermissionJoinRow = { permissions: Permission | Permission[] | null };

function normalizePermission(p: Permission | Permission[] | null | undefined): Permission | null {
  if (!p) return null;
  return Array.isArray(p) ? p[0] ?? null : p;
}

/**
 * Get all roles
 */
export async function getAllRoles(): Promise<Role[]> {
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .order('name');

  if (error) {
    throw new Error(`Failed to fetch roles: ${error.message}`);
  }

  return data || [];
}

/**
 * Get role by ID
 */
export async function getRoleById(roleId: string): Promise<Role | null> {
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .eq('id', roleId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch role: ${error.message}`);
  }

  return data as Role;
}

/**
 * Get role by name
 */
export async function getRoleByName(name: string): Promise<Role | null> {
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .eq('name', name)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch role: ${error.message}`);
  }

  return data as Role;
}

/**
 * Create a new role
 */
export async function createRole(
  name: string,
  description?: string
): Promise<Role> {
  const { data, error } = await supabase
    .from('roles')
    .insert({
      name,
      description,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Role name already exists');
    }
    throw new Error(`Failed to create role: ${error.message}`);
  }

  return data as Role;
}

/**
 * Update role
 */
export async function updateRole(
  roleId: string,
  updates: Partial<Role>
): Promise<Role> {
  const { data, error } = await supabase
    .from('roles')
    .update(updates)
    .eq('id', roleId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update role: ${error.message}`);
  }

  return data as Role;
}

/**
 * Delete role (only if not system role)
 */
export async function deleteRole(roleId: string): Promise<void> {
  const { error } = await supabase
    .from('roles')
    .delete()
    .eq('id', roleId)
    .eq('is_system', false);

  if (error) {
    throw new Error(`Failed to delete role: ${error.message}`);
  }
}

/**
 * Get permissions for a role
 */
export async function getRolePermissions(roleId: string): Promise<Permission[]> {
  const { data, error } = await supabase
    .from('role_permissions')
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
    .eq('role_id', roleId);

  if (error) {
    throw new Error(`Failed to fetch role permissions: ${error.message}`);
  }

  return (
    (data as PermissionJoinRow[] | null | undefined)
      ?.map((rp) => normalizePermission(rp.permissions))
      .filter((p): p is Permission => Boolean(p)) || []
  );
}

/**
 * Assign permission to role
 */
export async function assignPermissionToRole(
  roleId: string,
  permissionId: string
): Promise<void> {
  const { error } = await supabase
    .from('role_permissions')
    .insert({
      role_id: roleId,
      permission_id: permissionId,
    });

  if (error) {
    if (error.code === '23505') {
      throw new Error('Permission already assigned to role');
    }
    throw new Error(`Failed to assign permission: ${error.message}`);
  }
}

/**
 * Remove permission from role
 */
export async function removePermissionFromRole(
  roleId: string,
  permissionId: string
): Promise<void> {
  const { error } = await supabase
    .from('role_permissions')
    .delete()
    .eq('role_id', roleId)
    .eq('permission_id', permissionId);

  if (error) {
    throw new Error(`Failed to remove permission: ${error.message}`);
  }
}

/**
 * Assign role to user (replaces existing role if any)
 */
export async function assignRoleToUser(
  userId: string,
  roleId: string,
  assignedBy?: string
): Promise<void> {
  // Use upsert to replace existing role
  const { error } = await supabase
    .from('user_roles')
    .upsert({
      user_id: userId,
      role_id: roleId,
      assigned_by: assignedBy || null,
    }, {
      onConflict: 'user_id',
    });

  if (error) {
    throw new Error(`Failed to assign role: ${error.message}`);
  }
}

/**
 * Remove role from user
 */
export async function removeRoleFromUser(
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to remove role: ${error.message}`);
  }
}

/**
 * Grant permission directly to user
 */
export async function grantPermissionToUser(
  userId: string,
  permissionId: string,
  grantedBy?: string
): Promise<void> {
  const { error } = await supabase
    .from('user_permissions')
    .insert({
      user_id: userId,
      permission_id: permissionId,
      granted_by: grantedBy || null,
    });

  if (error) {
    if (error.code === '23505') {
      throw new Error('Permission already granted to user');
    }
    throw new Error(`Failed to grant permission: ${error.message}`);
  }
}

/**
 * Revoke permission from user
 */
export async function revokePermissionFromUser(
  userId: string,
  permissionId: string
): Promise<void> {
  const { error } = await supabase
    .from('user_permissions')
    .delete()
    .eq('user_id', userId)
    .eq('permission_id', permissionId);

  if (error) {
    throw new Error(`Failed to revoke permission: ${error.message}`);
  }
}

/**
 * Get direct permissions for a user
 */
export async function getUserDirectPermissions(userId: string): Promise<Permission[]> {
  const { data, error } = await supabase
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

  if (error) {
    throw new Error(`Failed to fetch user direct permissions: ${error.message}`);
  }

  return (
    (data as PermissionJoinRow[] | null | undefined)
      ?.map((up) => normalizePermission(up.permissions))
      .filter((p): p is Permission => Boolean(p)) || []
  );
}

