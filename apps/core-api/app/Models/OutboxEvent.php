<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['event_id', 'aggregate_type', 'aggregate_id', 'event_type', 'event_version', 'payload', 'headers', 'occurred_at'])]
class OutboxEvent extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'headers' => 'array',
            'occurred_at' => 'datetime',
            'published_at' => 'datetime',
        ];
    }
}
