# scripts

Local developer tooling (e.g. GPS load simulator, Kafka topic inspection
helpers, seed data scripts). Added as needed starting Phase 2; kept out of
Phase 1 since there's no application behavior yet to exercise.

## kafka-replay-dlq.sh

Replays every message on a `.retry`/`.dlq` topic back onto its original
topic, after the underlying failure has been fixed. See
[docs/events/retry-and-dlq.md](../docs/events/retry-and-dlq.md) for the
full replay procedure and [ADR 0007](../docs/decisions/0007-retry-dlq-strategy.md)
for the retry/DLQ design. Requires `jq` on the host.

```bash
scripts/kafka-replay-dlq.sh ride.requested.v1.dlq
```

## loadtest/

Lightweight Go load generator + capacity report for GPS ingestion and
ride-matching (Phase 8). See
[scripts/loadtest/README.md](loadtest/README.md),
[docs/architecture/scalability.md](../docs/architecture/scalability.md)
for the resulting analysis, and
[ADR 0008](../docs/decisions/0008-load-testing-approach.md) for the design.

```bash
cd scripts/loadtest && go run . -drivers=50 -customers=20
```
