<?php

namespace App\Http\Controllers\Api\Internal\V1;

use App\Http\Controllers\Controller;
use App\Models\Driver;
use App\Models\Payment;
use App\Models\RideRequest;
use App\Models\Trip;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Live aggregates against core-api's own tables — no precomputed
 * `admin_region_metrics` table anymore (that existed only to be filled by
 * a Kafka projection admin-api no longer runs). Admin traffic is
 * low-volume (see docs/admin-api/query-apis.md), so a handful of indexed
 * COUNT queries per request is the simpler, more honest choice over
 * maintaining a second derived store for one caller.
 *
 * `online_drivers` no longer means "sent a heartbeat recently" — core-api
 * has no heartbeat table (that lived only in location-service's Redis,
 * never replicated here). Redefined as "approved and in the fleet"
 * (`status = 'active'`), a real and stable core-api concept, distinct
 * from `available_drivers` (`is_available = true`, actively looking for
 * rides right now). Both are meaningful; neither pretends to be a
 * location-service heartbeat.
 */
class DashboardQueryController extends Controller
{
    public function summary(): array
    {
        $todayStart = Carbon::now('UTC')->startOfDay();

        return [
            'online_drivers' => Driver::where('status', 'active')->count(),
            'available_drivers' => Driver::where('is_available', true)->count(),
            'active_trips' => Trip::where('status', 'in_progress')->count(),
            'searching_rides' => RideRequest::where('status', 'searching')->count(),
            'rides_today' => RideRequest::where('requested_at', '>=', $todayStart)->count(),
            'completed_trips_today' => Trip::where('status', 'completed')->where('completed_at', '>=', $todayStart)->count(),
            'cancelled_trips_today' => Trip::where('status', 'cancelled')->where('cancelled_at', '>=', $todayStart)->count(),
            'failed_payments_today' => Payment::where('status', 'failed')->where('created_at', '>=', $todayStart)->count(),
            'average_matching_time_ms' => $this->averageMatchingTimeMs($todayStart),
        ];
    }

    public function regions(): array
    {
        $byRegion = [];
        $blank = fn (string $regionId) => [
            'region_id' => $regionId,
            'online_drivers' => 0,
            'available_drivers' => 0,
            'active_trips' => 0,
            'searching_rides' => 0,
        ];

        $driverRows = Driver::query()
            ->whereNotNull('region_id')
            ->selectRaw('region_id, count(*) filter (where status = ?) as online_drivers, count(*) filter (where is_available = true) as available_drivers', ['active'])
            ->groupBy('region_id')
            ->get();
        foreach ($driverRows as $row) {
            $byRegion[$row->region_id] = $blank($row->region_id);
            $byRegion[$row->region_id]['online_drivers'] = (int) $row->online_drivers;
            $byRegion[$row->region_id]['available_drivers'] = (int) $row->available_drivers;
        }

        $tripRows = Trip::query()
            ->whereNotNull('region_id')
            ->where('status', 'in_progress')
            ->selectRaw('region_id, count(*) as active_trips')
            ->groupBy('region_id')
            ->get();
        foreach ($tripRows as $row) {
            $byRegion[$row->region_id] ??= $blank($row->region_id);
            $byRegion[$row->region_id]['active_trips'] = (int) $row->active_trips;
        }

        $rideRows = RideRequest::query()
            ->whereNotNull('region_id')
            ->where('status', 'searching')
            ->selectRaw('region_id, count(*) as searching_rides')
            ->groupBy('region_id')
            ->get();
        foreach ($rideRows as $row) {
            $byRegion[$row->region_id] ??= $blank($row->region_id);
            $byRegion[$row->region_id]['searching_rides'] = (int) $row->searching_rides;
        }

        ksort($byRegion);

        return array_values($byRegion);
    }

    private function averageMatchingTimeMs(Carbon $todayStart): ?float
    {
        $row = DB::table('ride_requests')
            ->selectRaw('avg(extract(epoch from (accepted_at - requested_at)) * 1000) as avg_ms')
            ->whereNotNull('accepted_at')
            ->where('accepted_at', '>=', $todayStart)
            ->first();

        return $row?->avg_ms !== null ? (float) $row->avg_ms : null;
    }
}
