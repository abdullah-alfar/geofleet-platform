#!/usr/bin/env bash
# Tails every real topic in the platform's event catalog at once — the
# rawest possible view of "trace the code": every envelope every service
# publishes, as it's published, unfiltered.
#
# Usage:
#   ./16-tail-kafka.sh                  # all topics, new messages only
#   ./16-tail-kafka.sh --from-beginning # all topics, replay everything retained
#   ./16-tail-kafka.sh ride.requested.v1  # just one topic
#
# Envelope shape: docs/events/event-envelope.md. Topic == "{event_type}.v{event_version}"
# (docs/events/topic-catalog.md) — so `event_type` in the JSON already tells
# you which topic a line came from; no need to print it separately.
#
# Best paired with the numbered scripts in this directory in a second
# terminal: run this first, then 09/11 etc., and watch ride.requested.v1 ->
# ride.offer.created.v1 -> ride.offer.accepted.v1 -> ride.assigned.v1
# arrive in the order the system actually produces them.
#
# Known gap: a message published in the first second or two after this
# script starts can be missed. kafka-console-consumer.sh has to join its
# consumer group and get a partition assignment before it actually starts
# receiving — that join/rebalance isn't instant. If you fire off a
# publish (e.g. 08-submit-gps.sh) right as this starts, it can land
# before the join finishes. Not a bug, just normal Kafka consumer-group
# behavior. Use --from-beginning to sidestep it entirely, or just wait a
# beat after the "Tailing ..." banner before triggering the event.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Auto-detect from core-api's own .env (KAFKA_BROKERS) rather than
# hardcoding a port — it's whatever you set up in
# docs/local-development-without-docker.md, which may or may not match
# apps/core-api/.env.example's own default (127.0.0.1:9094).
if [ -z "${KAFKA_BOOTSTRAP:-}" ]; then
  CORE_API_ENV="$SCRIPT_DIR/../../apps/core-api/.env"
  if [ -f "$CORE_API_ENV" ]; then
    KAFKA_BOOTSTRAP="$(grep -E '^KAFKA_BROKERS=' "$CORE_API_ENV" | cut -d= -f2-)"
  fi
fi
KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP:-127.0.0.1:9094}"

# Same search order docs/local-development-without-docker.md's install
# steps produce; override KAFKA_BIN_DIR if yours lives elsewhere.
KAFKA_BIN_DIR="${KAFKA_BIN_DIR:-}"
if [ -z "$KAFKA_BIN_DIR" ]; then
  for candidate in /opt/kafka/bin "$(command -v kafka-console-consumer.sh 2>/dev/null | xargs dirname 2>/dev/null || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate/kafka-console-consumer.sh" ]; then
      KAFKA_BIN_DIR="$candidate"
      break
    fi
  done
fi
if [ -z "$KAFKA_BIN_DIR" ]; then
  echo "Can't find kafka-console-consumer.sh — set KAFKA_BIN_DIR to your Kafka install's bin/ directory." >&2
  exit 1
fi

FROM_BEGINNING=()
TOPIC_ARG=()
for arg in "$@"; do
  case "$arg" in
    --from-beginning) FROM_BEGINNING=(--from-beginning) ;;
    *) TOPIC_ARG=(--topic "$arg") ;;
  esac
done

if [ "${#TOPIC_ARG[@]}" -eq 0 ]; then
  # Every real topic in infrastructure/kafka/init-topics.sh, retry/DLQ
  # topics included, __consumer_offsets (and anything else internal)
  # excluded.
  TOPIC_ARG=(--include '^(driver|ride|trip|payment|notification)\..*')
  echo "Tailing all topics on ${KAFKA_BOOTSTRAP} (Ctrl+C to stop)..."
else
  echo "Tailing ${TOPIC_ARG[1]} on ${KAFKA_BOOTSTRAP} (Ctrl+C to stop)..."
fi
echo

FORMAT_CMD=(cat)
if command -v jq >/dev/null 2>&1; then
  FORMAT_CMD=(jq -C .)
else
  echo "(jq not found — printing raw JSON, one line per event)" >&2
fi

"$KAFKA_BIN_DIR/kafka-console-consumer.sh" \
  --bootstrap-server "$KAFKA_BOOTSTRAP" \
  "${TOPIC_ARG[@]}" \
  "${FROM_BEGINNING[@]}" \
  | "${FORMAT_CMD[@]}"
