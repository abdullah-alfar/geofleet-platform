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

];
