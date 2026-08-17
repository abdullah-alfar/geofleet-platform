import { Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../../integrations/postgres/postgres.module';
import { AdminPrincipal } from './admin-principal.interface';

interface SessionRow {
  token_hash: string;
  admin_role: string;
  abilities: string[];
  expires_at: string | null;
  user_uuid: string;
  user_status: string;
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Different-length secrets are already distinguishable by a timing
  // attack before comparison even starts — only the equal-length
  // comparison itself needs to be constant-time.
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies an admin-api session token directly against Postgres —
 * admin_sessions, admin-api's own table (see
 * docs/decisions/0011-admin-api-independent-service.md), not core-api's
 * Sanctum personal_access_tokens anymore. Same "split id|plaintext, hash
 * the plaintext, constant-time compare" shape this service already used
 * before, and the same shape personal_access_tokens/driver_devices use
 * elsewhere in this platform — only the table changed.
 *
 * `users.status` is joined and checked on every call, not just at login
 * — this is what makes admin_account.deactivate take effect immediately
 * on the next request, not just the next login.
 */
@Injectable()
export class TokenVerificationService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async verify(rawToken: string): Promise<AdminPrincipal | null> {
    const separatorIndex = rawToken.indexOf('|');
    if (separatorIndex === -1) {
      return null;
    }

    const id = rawToken.slice(0, separatorIndex);
    const plaintext = rawToken.slice(separatorIndex + 1);
    if (!/^\d+$/.test(id) || plaintext.length === 0) {
      return null;
    }

    const { rows } = await this.pool.query<SessionRow>(
      `SELECT s.token_hash, s.admin_role, s.abilities, s.expires_at,
              u.uuid AS user_uuid, u.status AS user_status
       FROM admin_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1`,
      [id],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    // Deliberately not filtered by token_hash in the WHERE clause above
    // — comparing it here, in application code, with a constant-time
    // compare avoids Postgres's own (non-constant-time) string equality
    // check from becoming a timing side-channel.
    const computedHash = createHash('sha256').update(plaintext).digest('hex');
    if (!constantTimeEqual(row.token_hash, computedHash)) {
      return null;
    }

    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return null;
    }
    if (row.user_status !== 'active') {
      return null;
    }

    return {
      userId: row.user_uuid,
      adminRole: row.admin_role,
      abilities: row.abilities,
    };
  }
}
