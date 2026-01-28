import { query } from '@/lib/db/client';
import { Permission } from '@/lib/types/auth';

export async function getAllPermissions(): Promise<Permission[]> {
  const result = await query<Permission>(
    'SELECT * FROM login.permissions ORDER BY resource ASC, action ASC'
  );
  return result.rows;
}
