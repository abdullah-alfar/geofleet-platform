<?php

namespace App\Http\Controllers\Api\Internal\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Internal\AdminPaymentResource;
use App\Models\Payment;
use App\Support\CursorPagination;
use Illuminate\Http\Request;

class PaymentQueryController extends Controller
{
    public function index(Request $request): array
    {
        $filters = $request->validate([
            'status' => ['nullable', 'string'],
            'payment_provider' => ['nullable', 'string'],
            'region_id' => ['nullable', 'string'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
            'amount_from' => ['nullable', 'numeric'],
            'amount_to' => ['nullable', 'numeric'],
            'cursor' => ['nullable', 'string'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        $query = Payment::query()->with(['trip', 'customer']);

        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['payment_provider'])) {
            $query->where('provider', $filters['payment_provider']);
        }
        if (isset($filters['region_id'])) {
            $query->whereHas('trip', fn ($q) => $q->where('region_id', $filters['region_id']));
        }
        if (isset($filters['date_from'])) {
            $query->where('created_at', '>=', $filters['date_from']);
        }
        if (isset($filters['date_to'])) {
            $query->where('created_at', '<=', $filters['date_to']);
        }
        if (isset($filters['amount_from'])) {
            $query->where('amount', '>=', $filters['amount_from']);
        }
        if (isset($filters['amount_to'])) {
            $query->where('amount', '<=', $filters['amount_to']);
        }

        $page = CursorPagination::paginate(
            $query,
            idColumn: 'uuid',
            orderColumn: 'updated_at',
            cursor: $filters['cursor'] ?? null,
            limit: $filters['limit'] ?? 20,
        );

        return [
            'data' => AdminPaymentResource::collection($page['data']),
            'meta' => ['next_cursor' => $page['next_cursor']],
        ];
    }

    public function show(Payment $payment): AdminPaymentResource
    {
        return new AdminPaymentResource($payment->load(['trip', 'customer']));
    }
}
