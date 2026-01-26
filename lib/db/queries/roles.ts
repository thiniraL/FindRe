import { Role, Permission } from '@/lib/types/auth';
import { isPgUniqueViolation, query, queryOne } from '@/lib/db/pg';

/**
 * Get all roles
 */
export async function getAllRoles(): Promise<Role[]> {
  return await query<Role>(
    `SELECT *
     FROM login.roles
     ORDER BY name`
  );
}

/**
 * Get role by ID
 */
export async function getRoleById(roleId: string): Promise<Role | null> {
  return await queryOne<Role>(
    `SELECT *
     FROM login.roles
     WHERE id = $1`,
    [roleId]
  );
}

/**
 * Get role by name
 */
export async function getRoleByName(name: string): Promise<Role | null> {
  return await queryOne<Role>(
    `SELECT *
     FROM login.roles
     WHERE name = $1`,
    [name]
  );
}

/**
 * Create a new role
 */
export async function createRole(
  name: string,
  description?: string
): Promise<Role> {
  try {
    const role = await queryOne<Role>(
      `INSERT INTO login.roles (name, description)
       VALUES ($1, $2)
       RETURNING *`,
      [name, description ?? null]
    );
    if (!role) throw new Error('Failed to create role');
    return role;
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new Error('Role name already exists');
    }
    throw err instanceof Error
      ? new Error(`Failed to create role: ${err.message}`)
      : new Error('Failed to create role');
  }
}

/**
 * Update role
 */
export async function updateRole(
  roleId: string,
  updates: Partial<Role>
): Promise<Role> {
  const keys = (Object.keys(updates) as Array<keyof Role>).filter(
    (k): k is 'name' | 'description' => k === 'name' || k === 'description'
  );
  if (keys.length === 0) throw new Error('No valid fields to update');

  const sets = keys.map((k, idx) => `"${k}" = $${idx + 1}`);
  const values = keys.map((k) => (updates as Record<string, unknown>)[k] ?? null);
  values.push(roleId);

  const role = await queryOne<Role>(
    `UPDATE login.roles
     SET ${sets.join(', ')}
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );
  if (!role) throw new Error('Failed to update role');
  return role;
}

/**
 * Delete role (only if not system role)
 */
export async function deleteRole(roleId: string): Promise<void> {
  await query(
    `DELETE FROM login.roles
     WHERE id = $1 AND is_system = FALSE`,
    [roleId]
  );
}

/**
 * Get permissions for a role
 */
export async function getRolePermissions(roleId: string): Promise<Permission[]> {
  return await query<Permission>(
    `SELECT p.id, p.resource, p.action, p.description, p.created_at
     FROM login.role_permissions rp
     JOIN login.permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [roleId]
  );
}

/**
 * Assign permission to role
 */
export async function assignPermissionToRole(
  roleId: string,
  permissionId: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO login.role_permissions (role_id, permission_id)
       VALUES ($1, $2)`,
      [roleId, permissionId]
    );
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new Error('Permission already assigned to role');
    }
    throw err instanceof Error
      ? new Error(`Failed to assign permission: ${err.message}`)
      : new Error('Failed to assign permission');
  }
}

/**
 * Remove permission from role
 */
export async function removePermissionFromRole(
  roleId: string,
  permissionId: string
): Promise<void> {
  await query(
    `DELETE FROM login.role_permissions
     WHERE role_id = $1 AND permission_id = $2`,
    [roleId, permissionId]
  );
}

/**
 * Assign role to user (replaces existing role if any)
 */
export async function assignRoleToUser(
  userId: string,
  roleId: string,
  assignedBy?: string
): Promise<void> {
  await query(
    `INSERT INTO login.user_roles (user_id, role_id, assigned_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       role_id = EXCLUDED.role_id,
       assigned_by = EXCLUDED.assigned_by,
       assigned_at = (NOW() AT TIME ZONE 'UTC')`,
    [userId, roleId, assignedBy ?? null]
  );
}

/**
 * Remove role from user
 */
export async function removeRoleFromUser(
  userId: string
): Promise<void> {
  await query(
    `DELETE FROM login.user_roles
     WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Grant permission directly to user
 */
export async function grantPermissionToUser(
  userId: string,
  permissionId: string,
  grantedBy?: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO login.user_permissions (user_id, permission_id, granted_by)
       VALUES ($1, $2, $3)`,
      [userId, permissionId, grantedBy ?? null]
    );
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new Error('Permission already granted to user');
    }
    throw err instanceof Error
      ? new Error(`Failed to grant permission: ${err.message}`)
      : new Error('Failed to grant permission');
  }
}

/**
 * Revoke permission from user
 */
export async function revokePermissionFromUser(
  userId: string,
  permissionId: string
): Promise<void> {
  await query(
    `DELETE FROM login.user_permissions
     WHERE user_id = $1 AND permission_id = $2`,
    [userId, permissionId]
  );
}

/**
 * Get direct permissions for a user
 */
export async function getUserDirectPermissions(userId: string): Promise<Permission[]> {
  return await query<Permission>(
    `SELECT p.id, p.resource, p.action, p.description, p.created_at
     FROM login.user_permissions up
     JOIN login.permissions p ON p.id = up.permission_id
     WHERE up.user_id = $1`,
    [userId]
  );
}

