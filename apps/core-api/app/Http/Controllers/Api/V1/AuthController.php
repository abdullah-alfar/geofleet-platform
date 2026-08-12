<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\AdminPermissions;
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

            // Postgres INSERT..RETURNING (via Laravel's insertGetId) only
            // returns the id column, so DB-generated defaults (uuid,
            // status) are never synced into the in-memory instance without
            // an explicit refresh.
            return $user->refresh();
        });

        $token = $this->issueToken($user);

        return (new UserResource($user->load(['customer', 'driver', 'admin'])))
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

        $token = $this->issueToken($user);

        return (new UserResource($user->load(['customer', 'driver', 'admin'])))
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
        return new UserResource($request->user()->load(['customer', 'driver.activeVehicle', 'admin']));
    }

    /**
     * Admin accounts get a token scoped to their admin_role's abilities
     * (App\Support\AdminPermissions) instead of the unrestricted default —
     * enforced by Sanctum's own tokenCan(), and readable directly from
     * personal_access_tokens.abilities by any service that verifies this
     * token the same way (see docs/decisions/0009-admin-identity.md).
     * Customer/driver tokens are unaffected: full '*' abilities, same as
     * before this admin support existed.
     */
    private function issueToken(User $user): string
    {
        if (! $user->isAdmin()) {
            return $user->createToken('mobile')->plainTextToken;
        }

        $user->loadMissing('admin');

        // An admin-role user with no admins row (shouldn't happen —
        // provisioned only via `php artisan admin:create`) gets a token
        // with zero abilities rather than a fatal error or, worse, an
        // unrestricted one. Fails closed.
        $abilities = $user->admin
            ? AdminPermissions::for($user->admin->admin_role)
            : [];

        return $user->createToken('admin-api', $abilities)->plainTextToken;
    }
}
