import { Permission } from '@/lib/types/auth';
import { isPgUniqueViolation, query, queryOne } from '@/lib/db/pg';

/**
 * Get all permissions
 */
export async function getAllPermissions(): Promise<Permission[]> {
  return await query<Permission>(
    `SELECT *
     FROM login.permissions
     ORDER BY resource, action`
  );
}

/**
 * Get permission by ID
 */
export async function getPermissionById(permissionId: string): Promise<Permission | null> {
  return await queryOne<Permission>(
    `SELECT *
     FROM login.permissions
     WHERE id = $1`,
    [permissionId]
  );
}

/**
 * Create a new permission
 */
export async function createPermission(
  resource: string,
  action: string,
  description?: string
): Promise<Permission> {
  try {
    const permission = await queryOne<Permission>(
      `INSERT INTO login.permissions (resource, action, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [resource, action, description ?? null]
    );
    if (!permission) throw new Error('Failed to create permission');
    return permission;
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new Error('Permission already exists');
    }
    throw err instanceof Error
      ? new Error(`Failed to create permission: ${err.message}`)
      : new Error('Failed to create permission');
  }
}




