<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Trip route sampling
    |--------------------------------------------------------------------------
    |
    | How often a validated GPS update belonging to an active trip is
    | durably stored in trip_location_samples — throttled by time AND
    | distance (whichever triggers first). See App\Domain\Location\LocationSampler.
    |
    */

    'sample_min_interval_seconds' => (int) env('TRIP_SAMPLE_MIN_INTERVAL_SECONDS', 15),
    'sample_min_distance_meters' => (float) env('TRIP_SAMPLE_MIN_DISTANCE_METERS', 30),

    /*
    |--------------------------------------------------------------------------
    | Kafka consumer group
    |--------------------------------------------------------------------------
    |
    | Also used as the inbox_events.consumer_name for idempotency — changing
    | this value resets this consumer's processed-event history (it starts
    | as if nothing had been consumed yet, per Kafka consumer-group
    | semantics).
    |
    */

    'consumer_group' => env('LOCATION_CONSUMER_GROUP', 'core-api-location-consumer'),

];
