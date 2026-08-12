package main

import (
	"context"
	"os/exec"
	"time"
)

// pumpOutbox runs `php artisan outbox:publish` on a tight interval for as
// long as ctx is alive — ride.requested.v1 only reaches Kafka (and
// therefore dispatch-service) through core-api's transactional outbox
// (see AGENTS.md), which is normally drained by a developer's own
// `watch -n 2 php artisan outbox:publish` loop or a production scheduler.
// This tool runs its own so `go run .` is a single self-contained command
// rather than requiring a second terminal.
func pumpOutbox(ctx context.Context, cfg config) {
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cmd := exec.CommandContext(ctx, "php", "artisan", "outbox:publish", "--batch=500")
			cmd.Dir = cfg.coreAPIDir
			_ = cmd.Run() // best-effort; a failed publish attempt just gets retried next tick
		}
	}
}
