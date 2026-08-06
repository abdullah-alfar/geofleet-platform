<?php

namespace App\ValueObjects;

use JsonSerializable;

/**
 * A WGS84 (SRID 4326) coordinate pair.
 *
 * Always constructed and read as (lat, lng) here — the PostGIS point
 * convention of (longitude, latitude) is confined entirely to
 * App\Casts\GeographyPoint and never leaks into application code.
 */
final class GeoPoint implements JsonSerializable
{
    public function __construct(
        public readonly float $lat,
        public readonly float $lng,
    ) {}

    public static function fromArray(array $value): self
    {
        return new self((float) $value['lat'], (float) $value['lng']);
    }

    /**
     * Decodes the hex-encoded EWKB PostgreSQL returns for a `geography`
     * column on a plain SELECT. Point geometry only — this platform never
     * stores other geometry types in geography(Point, 4326) columns.
     */
    public static function fromEwkbHex(string $hex): self
    {
        // PostGIS emits EWKB in little-endian byte order (leading 0x01) on
        // every platform this stack targets (linux/amd64, linux/arm64).
        // Big-endian hosts are not supported by this decoder.
        $binary = hex2bin($hex);
        $unpacked = unpack('Vtype/Vsrid/dx/dy', substr($binary, 1));

        return new self(lat: $unpacked['y'], lng: $unpacked['x']);
    }

    public function jsonSerialize(): array
    {
        return ['lat' => $this->lat, 'lng' => $this->lng];
    }
}
