/**
 * Ports apps/core-api/app/Support/CursorPagination.php's keyset-pagination
 * scheme exactly — same cursor encoding (base64url of `{value, id}` JSON),
 * same "order by (orderColumn, idColumn) DESC, fetch limit+1, slice" shape.
 * Every direct-SQL list query in admin-api now does its own pagination
 * (there's no core-api round trip to do it for us anymore — see
 * docs/decisions/0011-admin-api-independent-service.md), so this is the
 * one place that logic lives, reused by every module.
 */
export interface DecodedCursor {
  value: string;
  id: string;
}

/**
 * `orderValue` is typed `string` for every caller's convenience (matches
 * the API response shape), but `pg` actually hands back a `Date` object
 * for timestamptz columns at runtime — normalize explicitly here rather
 * than relying on callers to remember, or on JSON.stringify's own
 * Date-to-ISO auto-conversion happening to produce the right thing.
 */
export function encodeCursor(orderValue: string | Date, id: string): string {
  const value =
    orderValue instanceof Date ? orderValue.toISOString() : orderValue;
  return Buffer.from(JSON.stringify({ value, id })).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): DecodedCursor | null {
  if (!cursor) {
    return null;
  }
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      decoded &&
      typeof decoded === 'object' &&
      typeof (decoded as Record<string, unknown>).value === 'string' &&
      typeof (decoded as Record<string, unknown>).id === 'string'
    ) {
      return decoded as DecodedCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Builds the keyset WHERE fragment for a decoded cursor, e.g.
 * `(updated_at, uuid) < ($3, $4)` — Postgres row-constructor comparison,
 * the exact tuple-ordering semantics Laravel's OR-based construction
 * achieves, just simpler since Postgres supports it natively. Returns
 * null when there's no cursor (first page) — caller omits the fragment
 * entirely rather than adding a no-op `WHERE true`.
 */
export function cursorWhereFragment(
  decoded: DecodedCursor | null,
  orderColumn: string,
  idColumn: string,
  direction: 'desc' | 'asc',
  paramIndexStart: number,
): { sql: string; params: [string, string] } | null {
  if (!decoded) {
    return null;
  }
  const op = direction === 'desc' ? '<' : '>';
  return {
    sql: `(${orderColumn}, ${idColumn}) ${op} ($${paramIndexStart}, $${paramIndexStart + 1})`,
    params: [decoded.value, decoded.id],
  };
}

/**
 * Slices a limit+1 result set into a page + next_cursor. Takes accessor
 * callbacks rather than key names so it works with any row shape
 * (including ones without an index signature) without a cast at every
 * call site.
 */
export function paginateRows<T>(
  rows: T[],
  limit: number,
  orderValueOf: (row: T) => string | Date,
  idValueOf: (row: T) => string,
): { page: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    page,
    nextCursor:
      hasMore && last
        ? encodeCursor(orderValueOf(last), idValueOf(last))
        : null,
  };
}
