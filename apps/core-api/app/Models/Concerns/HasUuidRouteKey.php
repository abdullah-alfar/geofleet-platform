<?php

namespace App\Models\Concerns;

/**
 * Resolves route-model binding by the public `uuid` column instead of the
 * internal sequential `id` — public identifiers must never expose
 * predictable sequential IDs (see AGENTS.md).
 */
trait HasUuidRouteKey
{
    public function getRouteKeyName(): string
    {
        return 'uuid';
    }
}
