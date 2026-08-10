#!/usr/bin/env bash
# Replays every message currently sitting on a .retry or .dlq topic back
# onto its original topic — the replay procedure referenced by
# docs/events/retry-and-dlq.md and docs/decisions/0007-retry-dlq-strategy.md.
#
# Run this AFTER the underlying failure (DB down, bad deploy, a bug that's
# now fixed) is actually resolved. Replaying without fixing the root cause
# just re-populates the same retry/DLQ topic.
#
# Usage:
#   scripts/kafka-replay-dlq.sh <topic>.dlq
#   scripts/kafka-replay-dlq.sh ride.requested.v1.dlq
#
# Safe to re-run and safe if a message was already partially processed
# before it originally failed: replayed messages flow back through the
# normal consumer, which is idempotent via the inbox pattern (AGENTS.md) —
# reprocessing an event that already succeeded is a no-op, not a duplicate
# side effect.
set -euo pipefail

TOPIC="${1:?Usage: $0 <topic>.dlq (or .retry)}"
BOOTSTRAP="${KAFKA_BOOTSTRAP_SERVER:-localhost:9092}"
COMPOSE_SERVICE="${KAFKA_COMPOSE_SERVICE:-kafka}"
KAFKA_BIN="/opt/kafka/bin"

if ! command -v jq >/dev/null 2>&1; then
  echo "This script needs 'jq' on the host to parse retry/DLQ envelopes." >&2
  exit 1
fi

echo "Reading all messages currently on ${TOPIC}..."

# A fresh, throwaway consumer group every run: this is a deliberate,
# manual, one-shot replay, not a long-running consumer — reusing a group
# would mean a second run silently replays nothing (its offsets already
# committed past everything).
GROUP="replay-$(date +%s)-$$"

MESSAGES=$(docker compose exec -T "${COMPOSE_SERVICE}" "${KAFKA_BIN}/kafka-console-consumer.sh" \
  --bootstrap-server "${BOOTSTRAP}" \
  --topic "${TOPIC}" \
  --group "${GROUP}" \
  --from-beginning \
  --timeout-ms 5000 \
  --property print.key=true \
  --property key.separator=$'\t' \
  2>/dev/null || true)

if [ -z "${MESSAGES}" ]; then
  echo "Nothing to replay on ${TOPIC}."
  exit 0
fi

COUNT=0
while IFS=$'\t' read -r KEY ENVELOPE; do
  [ -z "${ENVELOPE:-}" ] && continue

  ORIGINAL_TOPIC=$(printf '%s' "${ENVELOPE}" | jq -r '.original_topic // empty')
  PAYLOAD=$(printf '%s' "${ENVELOPE}" | jq -c '.payload // empty')

  if [ -z "${ORIGINAL_TOPIC}" ] || [ -z "${PAYLOAD}" ]; then
    echo "  ! skipping malformed message (no original_topic/payload): ${ENVELOPE:0:200}"
    continue
  fi

  printf '%s\t%s\n' "${KEY}" "${PAYLOAD}" | docker compose exec -T "${COMPOSE_SERVICE}" "${KAFKA_BIN}/kafka-console-producer.sh" \
    --bootstrap-server "${BOOTSTRAP}" \
    --topic "${ORIGINAL_TOPIC}" \
    --property parse.key=true \
    --property key.separator=$'\t'

  COUNT=$((COUNT + 1))
  echo "  -> replayed key=${KEY} onto ${ORIGINAL_TOPIC}"
done <<< "${MESSAGES}"

echo ""
echo "Replayed ${COUNT} message(s) from ${TOPIC} back onto their original topic(s)."
