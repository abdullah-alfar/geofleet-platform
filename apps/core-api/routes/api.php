<?php

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
