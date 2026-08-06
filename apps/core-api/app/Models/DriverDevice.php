<?php

namespace App\Models;

use App\Models\Concerns\HasUuidRouteKey;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

#[Fillable(['driver_id', 'device_identifier', 'platform', 'app_version'])]
#[Hidden(['token_hash'])]
class DriverDevice extends Model
{
    use HasUuidRouteKey;

    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
        ];
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /**
     * Generates a new device token, hashes it for storage, and returns the
     * plain-text value — callers must return it to the client immediately;
     * it is never recoverable afterwards (same pattern as Sanctum tokens).
     */
    public static function generateToken(): array
    {
        $plainTextToken = Str::random(64);

        return [
            'plainTextToken' => $plainTextToken,
            'hash' => hash('sha256', $plainTextToken),
        ];
    }

    public static function findByPlainTextToken(string $plainTextToken): ?self
    {
        return static::where('token_hash', hash('sha256', $plainTextToken))
            ->where('status', 'active')
            ->first();
    }
}
