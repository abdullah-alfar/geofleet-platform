<?php

namespace App\Http\Resources;

use App\Models\Admin;
use App\Support\AdminPermissions;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Admin
 */
class AdminResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // Explicit null guard: the `admin` relation is eager-loaded
        // unconditionally alongside `customer`/`driver` (same pattern as
        // both of those), so it's loaded-but-null for every non-admin
        // user — this resource must not blow up on that, only on a
        // genuinely missing (unloaded) relation.
        if ($this->resource === null) {
            return [];
        }

        return [
            'admin_role' => $this->admin_role,
            'permissions' => AdminPermissions::for($this->admin_role),
        ];
    }
}
