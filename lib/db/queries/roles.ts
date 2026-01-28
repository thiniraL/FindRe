import { query } from '@/lib/db/client';
import { Role, Permission } from '@/lib/types/auth';

export async function getAllRoles(): Promise<Role[]> {
  const result = await query<Role>(
    'SELECT * FROM login.roles ORDER BY name ASC'
  );
  return result.rows;
}

export async function getRoleById(roleId: string): Promise<Role | null> {
  const result = await query<Role>(
    'SELECT * FROM login.roles WHERE id = $1',
    [roleId]
  );
  return result.rows[0] || null;
}

export async function getRoleByName(name: string): Promise<Role | null> {
  const result = await query<Role>(
    'SELECT * FROM login.roles WHERE name = $1',
    [name]
  );
  return result.rows[0] || null;
}

export async function createRole(
  name: string,
  description?: string
): Promise<Role> {
  const result = await query<Role>(
    `INSERT INTO login.roles (name, description)
     VALUES ($1, $2)
     RETURNING *`,
    [name, description || null]
  );
  return result.rows[0];
}

export async function updateRole(
  roleId: string,
  updates: Partial<Role>
): Promise<Role> {
  const fields: Array<keyof Role> = ['name', 'description', 'is_system'];
  const setParts: string[] = [];
  const values: Array<string | boolean | null> = [];

  fields.forEach((field) => {
    const value = updates[field];
    if (value !== undefined) {
      setParts.push(`${field} = $${values.length + 1}`);
      values.push(value as string | boolean | null);
    }
  });

  if (setParts.length === 0) {
    throw new Error('No valid fields to update');
  }

  values.push(roleId);

  const result = await query<Role>(
    `UPDATE login.roles
     SET ${setParts.join(', ')}
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

export async function deleteRole(roleId: string): Promise<void> {
  await query('DELETE FROM login.roles WHERE id = $1', [roleId]);
}

export async function assignRoleToUser(
  userId: string,
  roleId: string,
  assignedBy?: string
): Promise<void> {
  await query(
    `INSERT INTO login.user_roles (user_id, role_id, assigned_by, assigned_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id)
     DO UPDATE SET role_id = EXCLUDED.role_id,
                   assigned_by = EXCLUDED.assigned_by,
                   assigned_at = EXCLUDED.assigned_at`,
    [userId, roleId, assignedBy || null, new Date().toISOString()]
  );
}

export async function removeRoleFromUser(userId: string): Promise<void> {
  await query('DELETE FROM login.user_roles WHERE user_id = $1', [userId]);
}

export async function getUserDirectPermissions(userId: string): Promise<Permission[]> {
  const result = await query<Permission>(
    `SELECT p.*
     FROM login.user_permissions up
     JOIN login.permissions p ON p.id = up.permission_id
     WHERE up.user_id = $1`,
    [userId]
  );

  return result.rows;
}

export async function grantPermissionToUser(
  userId: string,
  permissionId: string,
  grantedBy?: string
): Promise<void> {
  await query(
    `INSERT INTO login.user_permissions (user_id, permission_id, granted_by, granted_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, permission_id)
     DO UPDATE SET granted_by = EXCLUDED.granted_by,
                   granted_at = EXCLUDED.granted_at`,
    [userId, permissionId, grantedBy || null, new Date().toISOString()]
  );
}

export async function revokePermissionFromUser(
  userId: string,
  permissionId: string
): Promise<void> {
  await query(
    'DELETE FROM login.user_permissions WHERE user_id = $1 AND permission_id = $2',
    [userId, permissionId]
  );
}
