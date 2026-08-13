<?php

namespace App\Http\Resources;

use App\Models\Admin;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Distinct from AdminResource (the `{admin_role, permissions}` fragment
 * embedded in a logged-in user's own /me or /login response). This one
 * describes an admin *account as a manageable resource* — used only by
 * internal/v1/admins, where the caller is another admin managing a
 * colleague's access, not the admin viewing their own session.
 *
 * @mixin Admin
 */
class AdminAccountResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->uuid,
            // Distinct from `id` above — that's this Admin row's own
            // uuid; `user_id` is the underlying `users.uuid`, which is
            // what AdminPrincipal.userId (admin-api's /session response)
            // actually carries. admin-web needs this to correctly
            // recognize "this row is the caller's own account" — a
            // comparison against `id` above would silently never match.
            'user_id' => $this->user->uuid,
            'name' => $this->user->name,
            'email' => $this->user->email,
            'admin_role' => $this->admin_role,
            'status' => $this->user->status,
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
