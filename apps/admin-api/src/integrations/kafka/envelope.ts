/**
 * Mirrors docs/events/event-envelope.md field-for-field — the same shape
 * core-api's App\Domain\Outbox\Outbox and every Go service's own
 * internal/kafka.Envelope already produce. No shared package exists for
 * this yet (event-envelope.md: "extract... if a second [service] needs
 * it verbatim, not before" — admin-api is now that second consumer-side
 * need, but on the read side, not a producer, so it doesn't trigger that
 * extraction either).
 */
export interface EventEnvelope<T = unknown> {
  event_id: string;
  event_type: string;
  event_version: number;
  occurred_at: string;
  producer: string;
  correlation_id: string;
  causation_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  region_id: string | null;
  data: T;
}

const REQUIRED_STRING_FIELDS = [
  'event_id',
  'event_type',
  'occurred_at',
  'producer',
  'correlation_id',
  'aggregate_type',
  'aggregate_id',
] as const;

/**
 * Throws on anything that isn't a well-formed envelope — a message this
 * malformed didn't come from any producer in this platform (all of which
 * already validate their own envelope shape at construction time), so
 * there's no sensible partial-recovery path. The caller
 * (KafkaConsumerService) logs and lets it count as a processing failure
 * rather than silently dropping it.
 */
export function parseEnvelope(raw: Buffer | string | null): EventEnvelope {
  if (raw === null) {
    throw new Error('Kafka message has no value.');
  }

  const parsed: unknown = JSON.parse(raw.toString());
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Envelope is not a JSON object.');
  }

  const envelope = parsed as Record<string, unknown>;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof envelope[field] !== 'string') {
      throw new Error(`Envelope missing required string field "${field}".`);
    }
  }
  if (typeof envelope.event_version !== 'number') {
    throw new Error('Envelope missing required number field "event_version".');
  }
  if (typeof envelope.data !== 'object' || envelope.data === null) {
    throw new Error('Envelope missing required object field "data".');
  }

  return envelope as unknown as EventEnvelope;
}
