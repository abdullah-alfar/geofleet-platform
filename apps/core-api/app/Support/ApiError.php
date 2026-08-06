<?php

namespace App\Support;

use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * Renders every API exception into one consistent envelope, so clients
 * never have to special-case Laravel's default validation/HTML error
 * shapes. Attaches the request's correlation id (see
 * App\Http\Middleware\AssignCorrelationId) so a client-reported error can
 * be matched to server-side logs.
 *
 * Note: Laravel's own Handler::prepareException() converts several
 * exception types (ModelNotFoundException -> NotFoundHttpException,
 * AuthorizationException -> AccessDeniedHttpException, etc.) *before* this
 * renderer ever sees them — so this only needs to special-case exceptions
 * that DON'T already implement HttpExceptionInterface by that point
 * (validation and pre-auth failures), and otherwise derive a semantic code
 * from the already-resolved HTTP status.
 */
class ApiError
{
    private const STATUS_CODES = [
        401 => 'unauthenticated',
        403 => 'forbidden',
        404 => 'not_found',
        409 => 'conflict',
        422 => 'unprocessable',
        429 => 'rate_limited',
    ];

    public static function render(Throwable $e, Request $request): ?JsonResponse
    {
        if (! $request->is('api/*')) {
            return null;
        }

        [$status, $code, $message, $details] = match (true) {
            $e instanceof ValidationException => [422, 'validation_failed', 'The given data was invalid.', $e->errors()],
            $e instanceof AuthenticationException => [401, 'unauthenticated', 'Authentication required.', null],
            $e instanceof HttpExceptionInterface => [
                $e->getStatusCode(),
                self::STATUS_CODES[$e->getStatusCode()] ?? 'http_error',
                $e->getMessage() ?: 'Request failed.',
                null,
            ],
            default => [500, 'server_error', config('app.debug') ? $e->getMessage() : 'An unexpected error occurred.', null],
        };

        return response()->json([
            'error' => array_filter([
                'code' => $code,
                'message' => $message,
                'details' => $details,
                'correlation_id' => self::correlationId(),
            ], fn ($value) => $value !== null),
        ], $status);
    }

    private static function correlationId(): ?string
    {
        return app()->bound(CorrelationContext::class)
            ? app(CorrelationContext::class)->id()
            : null;
    }
}
