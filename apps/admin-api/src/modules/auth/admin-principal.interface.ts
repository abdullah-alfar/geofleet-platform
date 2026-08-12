/** Resolved identity for a verified admin Sanctum token. */
export interface AdminPrincipal {
  /** users.uuid — the public identifier, never the internal bigint id. */
  userId: string;
  adminRole: string;
  /** Raw Sanctum token abilities, e.g. ['*'] or ['dashboard.view', ...]. */
  abilities: string[];
}
