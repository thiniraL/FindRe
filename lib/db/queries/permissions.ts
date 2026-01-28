import { getSupabaseClient } from '@/lib/db/client';
import { Permission } from '@/lib/types/auth';

export async function getAllPermissions(): Promise<Permission[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('permissions')
    .select('*')
    .order('resource', { ascending: true })
    .order('action', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch permissions: ${error.message}`);
  }

  return (data || []) as Permission[];
}
