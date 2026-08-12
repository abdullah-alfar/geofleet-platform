<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gates `internal/v1/*` routes — see
 * docs/decisions/0010-internal-service-authentication.md for why a shared
 * secret rather than mTLS or a second Sanctum guard. `hash_equals()`
 * mirrors the constant-time-compare discipline admin-api's own
 * TokenVerificationService already applies to Sanctum token hashes.
 */
class VerifyInternalServiceToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $provided = $request->header('X-Internal-Service-Token');
        $expected = config('services.admin_api.internal_token');

        if (! is_string($provided) || ! is_string($expected) || $expected === '' || ! hash_equals($expected, $provided)) {
            abort(401, 'Missing or invalid internal service token.');
        }

        return $next($request);
    }
}
