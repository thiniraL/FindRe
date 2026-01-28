import { getSupabaseClient } from '@/lib/db/client';
import { Role, Permission } from '@/lib/types/auth';

export async function getAllRoles(): Promise<Role[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch roles: ${error.message}`);
  }

  return (data || []) as Role[];
}

export async function getRoleById(roleId: string): Promise<Role | null> {
  const supabase = getSupabaseClient();
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

export async function getRoleByName(name: string): Promise<Role | null> {
  const supabase = getSupabaseClient();
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

export async function createRole(
  name: string,
  description?: string
): Promise<Role> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('roles')
    .insert({ name, description: description || null })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create role: ${error.message}`);
  }

  return data as Role;
}

export async function updateRole(
  roleId: string,
  updates: Partial<Role>
): Promise<Role> {
  const supabase = getSupabaseClient();
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

export async function deleteRole(roleId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('roles')
    .delete()
    .eq('id', roleId);

  if (error) {
    throw new Error(`Failed to delete role: ${error.message}`);
  }
}

export async function assignRoleToUser(
  userId: string,
  roleId: string,
  assignedBy?: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('user_roles')
    .upsert(
      {
        user_id: userId,
        role_id: roleId,
        assigned_by: assignedBy || null,
        assigned_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    throw new Error(`Failed to assign role: ${error.message}`);
  }
}

export async function removeRoleFromUser(userId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to remove role: ${error.message}`);
  }
}

export async function getUserDirectPermissions(userId: string): Promise<Permission[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_permissions')
    .select('permission:permissions(id, resource, action, description, created_at)')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to fetch direct permissions: ${error.message}`);
  }

  const permissions = ((data || []) as Array<{ permission: Permission | Permission[] }>).flatMap(
    (row) => (Array.isArray(row.permission) ? row.permission : [row.permission])
  );
  return permissions as Permission[];
}

export async function grantPermissionToUser(
  userId: string,
  permissionId: string,
  grantedBy?: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('user_permissions')
    .upsert(
      {
        user_id: userId,
        permission_id: permissionId,
        granted_by: grantedBy || null,
        granted_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,permission_id' }
    );

  if (error) {
    throw new Error(`Failed to grant permission: ${error.message}`);
  }
}

export async function revokePermissionFromUser(
  userId: string,
  permissionId: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('user_permissions')
    .delete()
    .eq('user_id', userId)
    .eq('permission_id', permissionId);

  if (error) {
    throw new Error(`Failed to revoke permission: ${error.message}`);
  }
}
