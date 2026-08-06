<?php

namespace App\Http\Middleware;

use App\Support\CorrelationContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Reuses a client-supplied X-Correlation-Id (so a mobile app can trace a
 * request through to its resulting Kafka events and logs) or generates one.
 * Shared into the log context so every log line for this request carries it
 * without call sites having to pass it explicitly.
 */
class AssignCorrelationId
{
    public function handle(Request $request, Closure $next): Response
    {
        $correlationId = $request->header('X-Correlation-Id');

        if (! is_string($correlationId) || ! Str::isUuid($correlationId)) {
            $correlationId = (string) Str::uuid();
        }

        app()->instance(CorrelationContext::class, new CorrelationContext($correlationId));
        Log::shareContext(['correlation_id' => $correlationId]);

        $response = $next($request);
        $response->headers->set('X-Correlation-Id', $correlationId);

        return $response;
    }
}
