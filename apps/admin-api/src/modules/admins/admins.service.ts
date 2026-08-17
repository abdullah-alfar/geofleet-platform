import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../../integrations/postgres/postgres.module';
import { resolveAdminId } from '../../common/resolve-admin-id';
import { AdminPrincipal } from '../auth/admin-principal.interface';

export interface AdminAccountRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  admin_role: string;
  status: string;
  created_at: string | null;
}

interface AdminAccountQueryRow extends AdminAccountRow {
  admin_row_id: number;
  target_user_id: number;
}

const ADMIN_ACCOUNT_BASE_QUERY = `
  SELECT
    a.id AS admin_row_id,
    a.uuid AS id,
    u.id AS target_user_id,
    u.uuid AS user_id,
    u.name AS name,
    u.email AS email,
    a.admin_role AS admin_role,
    u.status AS status,
    a.created_at AS created_at
  FROM admins a
  JOIN users u ON u.id = a.user_id
`;

/**
 * Direct SQL against admins/users — ports AdminAccountController's
 * index()/updateRole()/deactivate() exactly, including both
 * self-protection guards (an admin can't change their own role or
 * deactivate themselves through this endpoint — 422, not a DB error)
 * and the idempotent-no-op behavior (same role / already disabled ->
 * success, no audit row written). No outbox insert for either command
 * — core-api's own controller doesn't publish one either (admin account
 * management isn't event-sourced domain data). See
 * docs/decisions/0011-admin-api-independent-service.md.
 */
@Injectable()
export class AdminsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(correlationId: string | undefined): Promise<AdminAccountRow[]> {
    const { rows } = await this.pool.query<AdminAccountQueryRow>(
      `${ADMIN_ACCOUNT_BASE_QUERY} ORDER BY a.created_at ASC`,
    );
    return rows.map(toAdminAccountRow);
  }

  async updateRole(
    adminId: string,
    admin: AdminPrincipal,
    newRole: string,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<AdminAccountRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const actorUserId = await resolveAdminId(client, admin.userId);

      const { rows: targetRows } = await client.query<{
        admin_row_id: number;
        target_user_id: number;
        admin_role: string;
      }>(
        `SELECT a.id AS admin_row_id, a.user_id AS target_user_id, a.admin_role
         FROM admins a WHERE a.uuid = $1`,
        [adminId],
      );
      const target = targetRows[0];
      if (!target) {
        await client.query('ROLLBACK');
        throw new NotFoundException({
          code: 'admin_not_found',
          message: 'No admin account with that id.',
        });
      }

      if (target.target_user_id === actorUserId) {
        await client.query('ROLLBACK');
        throw new UnprocessableEntityException({
          code: 'cannot_change_own_role',
          message: 'You cannot change your own admin role.',
        });
      }

      if (target.admin_role !== newRole) {
        await client.query(
          `UPDATE admins SET admin_role = $1 WHERE id = $2`,
          [newRole, target.admin_row_id],
        );
        await client.query(
          `INSERT INTO audit_logs
             (uuid, actor_type, actor_id, action, auditable_type, auditable_id, changes, occurred_at)
           VALUES ($1, 'admin', $2, 'admin_account.role_changed', 'admin', $3, $4, now())`,
          [
            randomUUID(),
            actorUserId,
            target.admin_row_id,
            JSON.stringify({
              admin_role: { from: target.admin_role, to: newRole },
              reason: reason ?? null,
            }),
          ],
        );
      }

      await client.query('COMMIT');
      return this.findByUuid(adminId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deactivate(
    adminId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<AdminAccountRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const actorUserId = await resolveAdminId(client, admin.userId);

      const { rows: targetRows } = await client.query<{
        admin_row_id: number;
        target_user_id: number;
      }>(`SELECT a.id AS admin_row_id, a.user_id AS target_user_id FROM admins a WHERE a.uuid = $1`, [
        adminId,
      ]);
      const target = targetRows[0];
      if (!target) {
        await client.query('ROLLBACK');
        throw new NotFoundException({
          code: 'admin_not_found',
          message: 'No admin account with that id.',
        });
      }

      if (target.target_user_id === actorUserId) {
        await client.query('ROLLBACK');
        throw new UnprocessableEntityException({
          code: 'cannot_deactivate_self',
          message: 'You cannot deactivate your own admin account.',
        });
      }

      const { rowCount } = await client.query(
        `UPDATE users SET status = 'disabled' WHERE id = $1 AND status != 'disabled'`,
        [target.target_user_id],
      );

      if (rowCount && rowCount > 0) {
        await client.query(
          `INSERT INTO audit_logs
             (uuid, actor_type, actor_id, action, auditable_type, auditable_id, changes, occurred_at)
           VALUES ($1, 'admin', $2, 'admin_account.deactivated', 'admin', $3, $4, now())`,
          [
            randomUUID(),
            actorUserId,
            target.admin_row_id,
            JSON.stringify({
              status: { from: 'active', to: 'disabled' },
              reason: reason ?? null,
            }),
          ],
        );
      }

      await client.query('COMMIT');
      return this.findByUuid(adminId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async findByUuid(adminId: string): Promise<AdminAccountRow> {
    const { rows } = await this.pool.query<AdminAccountQueryRow>(
      `${ADMIN_ACCOUNT_BASE_QUERY} WHERE a.uuid = $1`,
      [adminId],
    );
    return toAdminAccountRow(rows[0]);
  }
}

function toAdminAccountRow(row: AdminAccountQueryRow): AdminAccountRow {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    admin_role: row.admin_role,
    status: row.status,
    created_at: row.created_at,
  };
}
