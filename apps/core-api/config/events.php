<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Event envelope defaults
    |--------------------------------------------------------------------------
    |
    | See docs/events/event-envelope.md and AGENTS.md for the envelope shape
    | every outbox event (and, later, every Kafka message) must follow.
    |
    */

    'producer' => env('EVENT_PRODUCER', 'core-api'),

    'default_region_id' => env('REGION_ID', 'amman'),

    /*
    |--------------------------------------------------------------------------
    | Inbox retention (see App\Console\Commands\PruneInboxEvents)
    |--------------------------------------------------------------------------
    |
    | One day past Kafka's own default topic retention (168h/7d — see
    | infrastructure/kafka/init-topics.sh) as a safety margin: a row this
    | old can never be redelivered by Kafka again, so it's safe to prune.
    |
    */

    'inbox_retention_days' => (int) env('INBOX_RETENTION_DAYS', 8),

];
