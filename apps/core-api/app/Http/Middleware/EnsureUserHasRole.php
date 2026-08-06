<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route-level role gate (e.g. `role:driver`). Endpoints scoped to "my own
 * profile" (vehicles, devices, availability) never take a driver/customer id
 * from the request — they always resolve $request->user()->driver — so this
 * check is sufficient to prevent a customer from reaching driver-only
 * actions; it is not an ownership check by itself.
 */
class EnsureUserHasRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if (! $user || ! in_array($user->role, $roles, true)) {
            abort(403, 'This action is not available for your account type.');
        }

        return $next($request);
    }
}
