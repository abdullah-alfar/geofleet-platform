<?php

namespace App\Http\Controllers\Api\Internal\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Internal\AdminCustomerResource;
use App\Models\Customer;
use App\Support\CursorPagination;
use Illuminate\Http\Request;

/**
 * Read-side for admin-api's customers module — see
 * docs/admin-api/query-apis.md. Customers had no admin-facing CRUD at
 * all before this: no controller, no route, nothing beyond a customer_id
 * embedded in a ride/trip/payment row.
 */
class CustomerQueryController extends Controller
{
    public function index(Request $request): array
    {
        $filters = $request->validate([
            'status' => ['nullable', 'string'],
            'region_id' => ['nullable', 'string'],
            'search' => ['nullable', 'string'],
            'cursor' => ['nullable', 'string'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        $query = Customer::query()->with('user');

        if (isset($filters['status'])) {
            $query->whereHas('user', fn ($q) => $q->where('status', $filters['status']));
        }
        if (isset($filters['region_id'])) {
            $query->whereHas('user', fn ($q) => $q->where('region_id', $filters['region_id']));
        }
        if (isset($filters['search'])) {
            $query->whereHas('user', fn ($q) => $q->where('name', 'ilike', $filters['search'].'%'));
        }

        $page = CursorPagination::paginate(
            $query,
            idColumn: 'uuid',
            orderColumn: 'updated_at',
            cursor: $filters['cursor'] ?? null,
            limit: $filters['limit'] ?? 20,
        );

        return [
            'data' => AdminCustomerResource::collection($page['data']),
            'meta' => ['next_cursor' => $page['next_cursor']],
        ];
    }

    /** ->resolve(), not a bare Resource return — see DriverQueryController::show's note on Laravel's default wrapping. */
    public function show(Customer $customer): array
    {
        return (new AdminCustomerResource(
            $customer->load('user')->loadCount(['rideRequests', 'trips'])
        ))->resolve();
    }
}
