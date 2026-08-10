<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Inbox hardening (docs/decisions/0007-retry-dlq-strategy.md): daily is
// plenty for a job pruning a multi-day retention window. Requires
// `php artisan schedule:work` (local dev) or a real cron entry running
// `php artisan schedule:run` every minute (production) to actually fire —
// see apps/core-api/README.md.
Schedule::command('inbox:prune')->daily();
