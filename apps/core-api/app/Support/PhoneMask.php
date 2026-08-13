<?php

namespace App\Support;

/**
 * Shared by every internal/v1 Admin*Resource that exposes a phone
 * number — masks everything but the last 4 digits, e.g.
 * "+962791234567" -> "*********4567". Never expose a full phone number
 * to the admin panel; the last 4 digits are enough to confirm identity
 * over a support call without printing the whole number.
 */
class PhoneMask
{
    public static function apply(?string $phone): ?string
    {
        if ($phone === null) {
            return null;
        }

        $visible = substr($phone, -4);

        return str_repeat('*', max(strlen($phone) - 4, 0)).$visible;
    }
}
