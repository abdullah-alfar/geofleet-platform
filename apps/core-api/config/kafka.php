<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Kafka bootstrap brokers
    |--------------------------------------------------------------------------
    |
    | Comma-separated broker list. Local dev points at the host-exposed
    | external listener from infrastructure/'s docker-compose.yml.
    |
    */

    'brokers' => env('KAFKA_BROKERS', '127.0.0.1:9094'),

];
