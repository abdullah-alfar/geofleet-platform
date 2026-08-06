<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function register(RegisterRequest $request): JsonResponse
    {
        $data = $request->validated();

        $user = DB::transaction(function () use ($data) {
            $user = User::create([
                'name' => $data['name'],
                'email' => $data['email'],
                'phone' => $data['phone'] ?? null,
                'password' => $data['password'],
                'role' => $data['role'],
                'region_id' => $data['region_id'] ?? config('events.default_region_id'),
            ]);

            if ($data['role'] === 'customer') {
                $user->customer()->create([]);
            } else {
                $user->driver()->create([
                    'license_number' => $data['license_number'],
                    'license_expires_at' => $data['license_expires_at'],
                    'region_id' => $user->region_id,
                ]);
            }

            return $user;
        });

        $token = $user->createToken('mobile')->plainTextToken;

        return (new UserResource($user->load(['customer', 'driver'])))
            ->additional(['meta' => ['token' => $token]])
            ->response()
            ->setStatusCode(201);
    }

    public function login(LoginRequest $request): JsonResponse
    {
        $credentials = $request->validated();

        $user = User::where('email', $credentials['email'])->first();

        if (! $user || ! Hash::check($credentials['password'], $user->password)) {
            // Deliberately identical error whether the email doesn't exist
            // or the password is wrong — avoids leaking which accounts
            // exist (account enumeration).
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        if ($user->status !== 'active') {
            throw ValidationException::withMessages([
                'email' => ['This account is not active.'],
            ]);
        }

        $token = $user->createToken('mobile')->plainTextToken;

        return (new UserResource($user->load(['customer', 'driver'])))
            ->additional(['meta' => ['token' => $token]])
            ->response();
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out.']);
    }

    public function me(Request $request): UserResource
    {
        return new UserResource($request->user()->load(['customer', 'driver.activeVehicle']));
    }
}
