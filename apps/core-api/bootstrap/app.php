<?php

use App\Http\Middleware\AssignCorrelationId;
use App\Http\Middleware\EnsureLocalEnvironment;
use App\Http\Middleware\EnsureUserHasRole;
use App\Support\ApiError;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->throttleApi(redis: true);

        // This is an API-only backend with no web login page. Laravel's
        // ApplicationBuilder unconditionally defaults unauthenticated
        // guests to redirect to route('login') — which doesn't exist here
        // — regardless of whether the client sent an Accept: application/
        // json header. Without this override, a client that omits that
        // header gets a 500 (RouteNotFoundException) instead of a 401.
        $middleware->redirectGuestsTo(fn () => null);

        // Prepended (not appended): must run before route-model binding
        // resolution so a 404 from an unresolvable {model:uuid} still gets
        // a correlation id attached.
        $middleware->api(prepend: [
            AssignCorrelationId::class,
        ]);

        $middleware->alias([
            'role' => EnsureUserHasRole::class,
            'local-only' => EnsureLocalEnvironment::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );

        $exceptions->render(fn (Throwable $e, Request $request) => ApiError::render($e, $request));
    })->create();
