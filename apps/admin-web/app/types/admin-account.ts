/** Mirrors admin-api's AdminAccountRow (admins.service.ts) — an admin
 * account as a manageable resource, not the caller's own session. */
export interface AdminAccountRow {
  id: string;
  /** users.uuid — distinct from `id` above (this Admin row's own uuid).
   * Matches auth.admin.userId, so this is what isSelf() must compare
   * against. */
  user_id: string;
  name: string;
  email: string;
  admin_role: string;
  status: string;
  created_at: string | null;
}

/** Mirrors admin-api's src/modules/admins/dto/update-admin-role.dto.ts
 * ADMIN_ROLES — itself a mirror of core-api's
 * App\Support\AdminPermissions::validRoles(). */
export const ADMIN_ROLES = [
  'super_admin',
  'operations_admin',
  'support_admin',
  'finance_admin',
  'viewer',
] as const;
