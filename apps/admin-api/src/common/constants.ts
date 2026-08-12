export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

/** Matches Illuminate\Support\Str::isUuid()'s acceptance of any UUID version. */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
