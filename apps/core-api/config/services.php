<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // Least-privilege Postgres role for apps/location-service (Go). See
    // database/migrations/*_create_location_service_role.php.
    'location_service' => [
        'db_password' => env('LOCATION_SERVICE_DB_PASSWORD'),
    ],

    // Read/write-scoped Postgres role for apps/dispatch-service (Go). See
    // database/migrations/*_create_dispatch_service_role.php and
    // docs/decisions/0005-geohash-and-dispatch-db-access.md.
    'dispatch_service' => [
        'db_password' => env('DISPATCH_SERVICE_DB_PASSWORD'),
    ],

    // Read-only Postgres role for apps/realtime-gateway (Go). See
    // database/migrations/*_create_realtime_gateway_role.php and
    // docs/decisions/0006-realtime-gateway-fanout.md.
    'realtime_gateway' => [
        'db_password' => env('REALTIME_GATEWAY_DB_PASSWORD'),
    ],

    // Read-only, authentication-only Postgres role for apps/admin-api
    // (NestJS). See database/migrations/*_create_admin_api_role.php and
    // docs/decisions/0009-admin-identity.md.
    'admin_api' => [
        'db_password' => env('ADMIN_API_DB_PASSWORD'),

        // Shared secret admin-api sends as X-Internal-Service-Token on
        // internal/v1/* requests. See
        // docs/decisions/0010-internal-service-authentication.md.
        'internal_token' => env('ADMIN_API_INTERNAL_TOKEN'),
    ],

];
