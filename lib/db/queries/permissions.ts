import { dbLogin as supabase } from '@/lib/db/client';
import { Permission } from '@/lib/types/auth';

/**
 * Get all permissions
 */
export async function getAllPermissions(): Promise<Permission[]> {
  const { data, error } = await supabase
    .from('permissions')
    .select('*')
    .order('resource, action');

  if (error) {
    throw new Error(`Failed to fetch permissions: ${error.message}`);
  }

  return data || [];
}

/**
 * Get permission by ID
 */
export async function getPermissionById(permissionId: string): Promise<Permission | null> {
  const { data, error } = await supabase
    .from('permissions')
    .select('*')
    .eq('id', permissionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch permission: ${error.message}`);
  }

  return data as Permission;
}

/**
 * Create a new permission
 */
export async function createPermission(
  resource: string,
  action: string,
  description?: string
): Promise<Permission> {
  const { data, error } = await supabase
    .from('permissions')
    .insert({
      resource,
      action,
      description,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Permission already exists');
    }
    throw new Error(`Failed to create permission: ${error.message}`);
  }

  return data as Permission;
}




