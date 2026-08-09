<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gates dev-only routes (e.g. the interactive API docs at /docs) so they
 * are never accidentally reachable if this app is ever deployed somewhere
 * with APP_ENV set to anything other than local.
 */
class EnsureLocalEnvironment
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(app()->environment('local'), 404);

        return $next($request);
    }
}
