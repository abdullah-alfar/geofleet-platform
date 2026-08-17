import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../../integrations/postgres/postgres.module';
import { abilitiesForRole } from '../../common/admin-permissions';

interface UserRow {
  id: number;
  uuid: string;
  password: string;
  status: string;
  role: string;
}

interface AdminRow {
  admin_role: string;
}

/**
 * Laravel/PHP tags its bcrypt hashes `$2y$`; Node's `bcrypt` package only
 * recognizes `$2a$`/`$2b$`. Both are the byte-identical "fixed" bcrypt
 * variant — `$2y$` is PHP's own historical name for the same thing `$2b$`
 * denotes everywhere else — so renaming the tag is safe and standard
 * interop practice, not a weakened check. Confirmed empirically: without
 * this, every correct password fails to verify.
 */
function normalizeBcryptHash(hash: string): string {
  return hash.startsWith('$2y$') ? '$2b$' + hash.slice(4) : hash;
}

/**
 * admin-api's own login — replaces the old flow of calling core-api's
 * POST /api/v1/auth/login and trusting its Sanctum token. Verifies
 * `users.password` (bcrypt, same hash core-api's own AuthController
 * checks) directly, then mints a session into admin_sessions — admin-
 * api's own table, never read by core-api. See
 * docs/decisions/0011-admin-api-independent-service.md.
 *
 * Every failure path (no such email, wrong password, inactive account,
 * not an admin) collapses to the same generic error — no account
 * enumeration, matching core-api's AuthController::login exactly.
 */
@Injectable()
export class AdminAuthService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async login(email: string, password: string): Promise<string> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT id, uuid, password, status, role FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0];

    // Always run bcrypt.compare, even with no user found, against a
    // fixed dummy hash — otherwise a missing-email response returns
    // faster than a wrong-password one, a timing side-channel that
    // leaks which emails exist.
    const hashToCompare = normalizeBcryptHash(
      user?.password ??
        '$2b$12$CwTycUXWue0Thq9StjUM0uJ8i6mS/GJXbaJHrpwHmKf.i1sZDwUeS',
    );
    const passwordMatches = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    if (user.status !== 'active' || user.role !== 'admin') {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const { rows: adminRows } = await this.pool.query<AdminRow>(
      `SELECT admin_role FROM admins WHERE user_id = $1`,
      [user.id],
    );
    const admin = adminRows[0];
    if (!admin) {
      // role='admin' with no admins row is a data-integrity anomaly —
      // fail closed rather than authenticate into a zero-ability session
      // (same guard core-api's own AuthController effectively applied).
      throw new UnauthorizedException('Invalid credentials.');
    }

    const abilities = abilitiesForRole(admin.admin_role);
    const plaintext = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(plaintext).digest('hex');

    const { rows: sessionRows } = await this.pool.query<{ id: number }>(
      `INSERT INTO admin_sessions (user_id, token_hash, admin_role, abilities, created_at)
       VALUES ($1, $2, $3, $4, now())
       RETURNING id`,
      [user.id, tokenHash, admin.admin_role, JSON.stringify(abilities)],
    );

    return `${sessionRows[0].id}|${plaintext}`;
  }
}
