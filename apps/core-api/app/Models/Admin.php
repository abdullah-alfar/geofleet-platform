<?php

namespace App\Models;

use App\Models\Concerns\HasUuidRouteKey;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'admin_role'])]
class Admin extends Model
{
    use HasUuidRouteKey;

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
