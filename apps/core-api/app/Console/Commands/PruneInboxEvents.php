<?php

namespace App\Console\Commands;

use App\Models\InboxEvent;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Inbox hardening (docs/decisions/0007-retry-dlq-strategy.md): inbox_events
 * has no retention today — it grows forever, one row per successfully
 * processed event, for as long as the platform runs. That's safe to prune:
 * a row older than the source topic's own retention window
 * (KAFKA_LOG_RETENTION_HOURS, 168h/7d by default — see
 * infrastructure/kafka/init-topics.sh) can never be redelivered by Kafka
 * again, so there's no longer any duplicate for it to guard against.
 *
 * Registered on Laravel's scheduler (routes/console.php) to run daily —
 * unlike outbox:publish, which needs sub-minute cadence and so runs via an
 * external loop in local dev, pruning is a low-frequency job the built-in
 * scheduler is the right fit for.
 */
class PruneInboxEvents extends Command
{
    protected $signature = 'inbox:prune {--days= : Override the retention window in days}';

    protected $description = 'Deletes inbox_events rows older than the retention window (default: past Kafka topic retention).';

    public function handle(): int
    {
        $days = (int) ($this->option('days') ?? config('events.inbox_retention_days'));

        $cutoff = now()->subDays($days);

        $deleted = InboxEvent::where('processed_at', '<', $cutoff)->delete();

        Log::info('inbox.pruned', ['deleted' => $deleted, 'retention_days' => $days, 'cutoff' => $cutoff->toISOString()]);
        $this->info("Pruned {$deleted} inbox_events row(s) older than {$days} day(s).");

        return self::SUCCESS;
    }
}
