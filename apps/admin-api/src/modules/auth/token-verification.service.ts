import { Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../../integrations/postgres/postgres.module';
import { AdminPrincipal } from './admin-principal.interface';

interface TokenRow {
  token: string;
  tokenable_type: string;
  abilities: string | null;
  expires_at: string | null;
  user_uuid: string;
  user_status: string;
  user_role: string;
  admin_role: string | null;
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
 * Verifies a Sanctum bearer token directly against Postgres — the same
 * algorithm Laravel Sanctum's own PersonalAccessToken::findToken() uses
 * (split "{id}|{plaintext}", hash the plaintext, constant-time compare
 * against the stored hash), and the same pattern realtime-gateway already
 * applies for customer/driver tokens (ADR 0006). No call back into
 * core-api. See docs/decisions/0009-admin-identity.md.
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

    const { rows } = await this.pool.query<TokenRow>(
      `SELECT pat.token, pat.tokenable_type, pat.abilities, pat.expires_at,
              u.uuid AS user_uuid, u.status AS user_status, u.role AS user_role,
              a.admin_role
       FROM personal_access_tokens pat
       JOIN users u ON u.id = pat.tokenable_id
       LEFT JOIN admins a ON a.user_id = u.id
       WHERE pat.id = $1`,
      [id],
    );

    const row = rows[0];
    if (!row || row.tokenable_type !== 'App\\Models\\User') {
      return null;
    }

    const computedHash = createHash('sha256').update(plaintext).digest('hex');
    if (!constantTimeEqual(row.token, computedHash)) {
      return null;
    }

    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return null;
    }
    if (row.user_status !== 'active' || row.user_role !== 'admin') {
      return null;
    }
    // Provisioned only by `php artisan admin:create`, which creates the
    // user and admins rows in one transaction — a role='admin' user with
    // no admins row is a data-integrity anomaly, not a valid session.
    // Fails closed rather than authenticating into a zero-ability session.
    if (!row.admin_role) {
      return null;
    }

    const abilities: string[] = row.abilities
      ? (JSON.parse(row.abilities) as string[])
      : [];

    return { userId: row.user_uuid, adminRole: row.admin_role, abilities };
  }
}
