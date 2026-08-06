<?php

namespace App\Models;

use App\Casts\GeographyPoint;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Note: the table's actual primary key is composite (id, recorded_at) —
 * required by Postgres for a partitioned table (see the migration). Eloquent
 * only needs to know about `id` for the inserts this model is used for; it
 * never looks these rows up by primary key.
 */
#[Fillable(['trip_id', 'driver_id', 'location', 'speed_mps', 'heading_degrees', 'accuracy_meters', 'recorded_at'])]
class TripLocationSample extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'location' => GeographyPoint::class,
            'recorded_at' => 'datetime',
        ];
    }

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class);
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }
}
