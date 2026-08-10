#!/usr/bin/env bash
# Creates the platform's topic catalog. Runs once as the `kafka-init` compose
# service and exits. Safe to re-run: --if-not-exists makes creation idempotent.
#
# Partition counts reflect per-aggregate ordering keys (see
# docs/events/topic-catalog.md): GPS-heavy topics get more partitions since
# they carry the highest throughput; lifecycle topics stay low since local
# dev has no meaningful concurrent load. Replication factor is 1 because this
# is a single-broker local cluster, not a production sizing decision.
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP_SERVER:-kafka:9092}"
KAFKA_BIN="/opt/kafka/bin"

echo "Waiting for Kafka broker at ${BOOTSTRAP}..."
until "${KAFKA_BIN}/kafka-broker-api-versions.sh" --bootstrap-server "${BOOTSTRAP}" >/dev/null 2>&1; do
  sleep 2
done
echo "Kafka is reachable. Creating topics..."

# name:partitions:replication
TOPICS=(
  "driver.location.received.v1:6:1"
  "driver.location.validated.v1:6:1"
  "driver.status.changed.v1:3:1"

  "ride.requested.v1:3:1"
  "ride.search.started.v1:3:1"
  "ride.offer.created.v1:3:1"
  "ride.offer.accepted.v1:3:1"
  "ride.offer.rejected.v1:3:1"
  "ride.assigned.v1:3:1"
  "ride.unavailable.v1:3:1"

  "trip.started.v1:3:1"
  "trip.location.updated.v1:6:1"
  "trip.completed.v1:3:1"
  "trip.cancelled.v1:3:1"

  "payment.requested.v1:3:1"
  "payment.completed.v1:3:1"
  "payment.failed.v1:3:1"

  "notification.requested.v1:3:1"

  # Retry/DLQ topics (Phase 7 — see docs/events/retry-and-dlq.md and
  # docs/decisions/0007-retry-dlq-strategy.md). Deliberately not created for
  # every topic in this catalog — only for consumers where a permanently
  # dropped message means real, unrecoverable data loss. Low partition
  # count: these only ever carry failure volume, never production traffic.
  "driver.location.validated.v1.retry:1:1"
  "driver.location.validated.v1.dlq:1:1"
  "ride.requested.v1.retry:1:1"
  "ride.requested.v1.dlq:1:1"
)

for entry in "${TOPICS[@]}"; do
  IFS=':' read -r name partitions replication <<< "$entry"
  echo "  -> ${name} (partitions=${partitions}, replication=${replication})"
  "${KAFKA_BIN}/kafka-topics.sh" --bootstrap-server "${BOOTSTRAP}" \
    --create --if-not-exists \
    --topic "${name}" \
    --partitions "${partitions}" \
    --replication-factor "${replication}"
done

echo ""
echo "Topic initialization complete. Current topics:"
"${KAFKA_BIN}/kafka-topics.sh" --bootstrap-server "${BOOTSTRAP}" --list
