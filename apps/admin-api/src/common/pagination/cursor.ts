/**
 * Keyset ("cursor") pagination — never OFFSET, per the original spec's
 * Large Dataset Rules ("Admin APIs must avoid... OFFSET pagination at
 * very high offsets"). Every list query in this service orders by
 * `(updated_at DESC, <primary key> DESC)` and encodes the last row of a
 * page as the cursor for the next one — stable even if rows are being
 * upserted concurrently by Phase 4's projection consumers, unlike an
 * OFFSET which shifts under concurrent writes.
 */
export interface Cursor {
  updatedAt: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    JSON.stringify({
      updatedAt: cursor.updatedAt.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url');
}

/** Returns null for a missing/malformed cursor rather than throwing — treated as "first page." */
export function decodeCursor(encoded: string | undefined): Cursor | null {
  if (!encoded) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).updatedAt !== 'string' ||
      typeof (parsed as Record<string, unknown>).id !== 'string'
    ) {
      return null;
    }
    const { updatedAt, id } = parsed as { updatedAt: string; id: string };
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return { updatedAt: date, id };
  } catch {
    return null;
  }
}
