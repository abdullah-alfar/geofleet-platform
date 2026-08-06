<?php

namespace App\Casts;

use App\ValueObjects\GeoPoint;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Query\Expression;

/**
 * Casts a PostGIS geography(Point, 4326) column to/from App\ValueObjects\GeoPoint.
 *
 * @implements CastsAttributes<GeoPoint, GeoPoint|array{lat: float, lng: float}>
 */
class GeographyPoint implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): ?GeoPoint
    {
        if ($value === null) {
            return null;
        }

        return GeoPoint::fromEwkbHex($value);
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): array
    {
        if ($value === null) {
            return [$key => null];
        }

        $point = $value instanceof GeoPoint ? $value : GeoPoint::fromArray($value);

        return [
            $key => new Expression(sprintf(
                'ST_SetSRID(ST_MakePoint(%F, %F), 4326)',
                $point->lng,
                $point->lat,
            )),
        ];
    }
}
