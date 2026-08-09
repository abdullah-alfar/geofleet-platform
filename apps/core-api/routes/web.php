<?php

use Illuminate\Support\Facades\Response;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// Interactive REST API reference (Redoc, rendered from
// contracts/openapi/openapi.yaml — the single source of truth also used
// for the Postman collection). Local/dev only: not meant to be reachable
// once this app is actually deployed anywhere.
Route::middleware('local-only')->group(function () {
    Route::get('/docs', fn () => view('docs'))->name('docs');

    Route::get('/docs/openapi.yaml', function () {
        $path = base_path('../../contracts/openapi/openapi.yaml');

        abort_unless(is_file($path), 404);

        return Response::file($path, ['Content-Type' => 'application/yaml']);
    })->name('docs.openapi');
});
