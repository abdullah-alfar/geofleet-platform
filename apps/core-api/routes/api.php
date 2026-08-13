<?php

use App\Http\Controllers\Api\Internal\V1\AdminAccountController;
use App\Http\Controllers\Api\Internal\V1\DashboardQueryController;
use App\Http\Controllers\Api\Internal\V1\DriverCommandController;
use App\Http\Controllers\Api\Internal\V1\DriverQueryController;
use App\Http\Controllers\Api\Internal\V1\PaymentCommandController;
use App\Http\Controllers\Api\Internal\V1\PaymentQueryController;
use App\Http\Controllers\Api\Internal\V1\RideQueryController;
use App\Http\Controllers\Api\Internal\V1\TripCommandController;
use App\Http\Controllers\Api\Internal\V1\TripQueryController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\DriverAvailabilityController;
use App\Http\Controllers\Api\V1\DriverDeviceController;
use App\Http\Controllers\Api\V1\RideRequestController;
use App\Http\Controllers\Api\V1\TripController;
use App\Http\Controllers\Api\V1\VehicleController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->name('api.v1.')->group(function () {

    Route::prefix('auth')->name('auth.')->group(function () {
        Route::post('register', [AuthController::class, 'register'])
            ->middleware('throttle:auth')
            ->name('register');

        Route::post('login', [AuthController::class, 'login'])
            ->middleware('throttle:auth')
            ->name('login');

        Route::middleware('auth:sanctum')->group(function () {
            Route::post('logout', [AuthController::class, 'logout'])->name('logout');
            Route::get('me', [AuthController::class, 'me'])->name('me');
        });
    });

    Route::middleware('auth:sanctum')->group(function () {

        // --- Driver-only: own profile management ---------------------------
        Route::middleware('role:driver')->prefix('drivers')->name('drivers.')->group(function () {
            Route::get('vehicles', [VehicleController::class, 'index'])->name('vehicles.index');
            Route::post('vehicles', [VehicleController::class, 'store'])->name('vehicles.store');
        });

        Route::middleware('role:driver')->prefix('driver')->name('driver.')->group(function () {
            Route::get('devices', [DriverDeviceController::class, 'index'])->name('devices.index');
            Route::post('devices', [DriverDeviceController::class, 'store'])->name('devices.store');
            Route::patch('availability', [DriverAvailabilityController::class, 'update'])->name('availability.update');
        });

        // --- Customer-only: ride requests -----------------------------------
        Route::middleware('role:customer')->prefix('ride-requests')->name('ride-requests.')->group(function () {
            Route::post('', [RideRequestController::class, 'store'])->name('store');
        });

        // Read/cancel is authorized per-resource via RideRequestPolicy
        // (customer owner, or the assigned driver for reads) rather than a
        // blanket role check.
        Route::prefix('ride-requests')->name('ride-requests.')->group(function () {
            Route::get('{rideRequest:uuid}', [RideRequestController::class, 'show'])->name('show');
            Route::post('{rideRequest:uuid}/cancel', [RideRequestController::class, 'cancel'])->name('cancel');
        });

        // --- Trips: read-only, authorized via TripPolicy --------------------
        Route::prefix('trips')->name('trips.')->group(function () {
            Route::get('', [TripController::class, 'index'])->name('index');
            Route::get('{trip:uuid}', [TripController::class, 'show'])->name('show');
        });
    });
});

// --- Internal: service-to-service only, no Sanctum, no end user -----------
// Deliberately a sibling of the `v1` group above, not nested inside it —
// `/api/internal/v1/*`, not `/api/v1/internal/v1/*`. Called exclusively by
// apps/admin-api's Laravel command integration client — see
// docs/decisions/0010-internal-service-authentication.md and
// docs/admin-api/laravel-integration.md. Gated by a shared secret, not
// `auth:sanctum` — there is no end-user session on this boundary.
Route::prefix('internal/v1')->name('api.internal.v1.')->middleware('internal-service')->group(function () {
    Route::patch('drivers/{driver:uuid}/approve', [DriverCommandController::class, 'approve'])->name('drivers.approve');
    Route::patch('drivers/{driver:uuid}/suspend', [DriverCommandController::class, 'suspend'])->name('drivers.suspend');
    Route::patch('drivers/{driver:uuid}/unsuspend', [DriverCommandController::class, 'unsuspend'])->name('drivers.unsuspend');
    Route::patch('drivers/{driver:uuid}/disable', [DriverCommandController::class, 'disable'])->name('drivers.disable');
    Route::patch('trips/{trip:uuid}/cancel', [TripCommandController::class, 'cancel'])->name('trips.cancel');
    Route::patch('payments/{payment:uuid}/refund', [PaymentCommandController::class, 'refund'])->name('payments.refund');

    Route::get('admins', [AdminAccountController::class, 'index'])->name('admins.index');
    Route::patch('admins/{admin:uuid}/role', [AdminAccountController::class, 'updateRole'])->name('admins.update-role');
    Route::patch('admins/{admin:uuid}/deactivate', [AdminAccountController::class, 'deactivate'])->name('admins.deactivate');

    // --- Read side: admin-api's own query modules call these directly and
    // synchronously instead of maintaining a Kafka-projected read model —
    // see docs/admin-api/query-apis.md.
    Route::get('drivers', [DriverQueryController::class, 'index'])->name('drivers.index');
    Route::get('drivers/{driver:uuid}', [DriverQueryController::class, 'show'])->name('drivers.show');

    Route::get('rides', [RideQueryController::class, 'index'])->name('rides.index');
    Route::get('rides/{rideRequest:uuid}', [RideQueryController::class, 'show'])->name('rides.show');
    Route::get('rides/{rideRequest:uuid}/offers', [RideQueryController::class, 'offers'])->name('rides.offers');

    Route::get('trips', [TripQueryController::class, 'index'])->name('trips.index');
    Route::get('trips/{trip:uuid}', [TripQueryController::class, 'show'])->name('trips.show');

    Route::get('payments', [PaymentQueryController::class, 'index'])->name('payments.index');
    Route::get('payments/{payment:uuid}', [PaymentQueryController::class, 'show'])->name('payments.show');

    Route::get('dashboard/summary', [DashboardQueryController::class, 'summary'])->name('dashboard.summary');
    Route::get('dashboard/regions', [DashboardQueryController::class, 'regions'])->name('dashboard.regions');
});
