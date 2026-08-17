import type { Pool, PoolClient } from 'pg';

/**
 * `AdminPrincipal.userId` is `users.uuid` (the public identifier — see
 * that interface's own doc comment: never the internal bigint id). But
 * `audit_logs.actor_id` is `bigint`, referencing `users.id` — the same
 * uuid -> bigint resolution core-api's own `AdminCommandRequest::admin()`
 * does (`User::where('uuid', ...)->firstOrFail()`) before using `$user->id`
 * for the audit row. Every write module needs this exact lookup once per
 * command, so it lives here rather than being copy-pasted per module.
 */
export async function resolveAdminId(
  db: Pool | PoolClient,
  adminUserUuid: string,
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE uuid = $1`,
    [adminUserUuid],
  );
  if (!rows[0]) {
    throw new Error(`No user found for admin uuid ${adminUserUuid}`);
  }
  return rows[0].id;
}
