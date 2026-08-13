<?php

namespace App\Http\Controllers\Api\Internal\V1;

use App\Domain\Audit\AdminAudit;
use App\Http\Controllers\Controller;
use App\Http\Requests\Internal\DeactivateAdminAccountRequest;
use App\Http\Requests\Internal\UpdateAdminRoleRequest;
use App\Http\Resources\AdminAccountResource;
use App\Models\Admin;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

/**
 * Admin account management — list/change-role/deactivate other admins.
 * Provisioning (creating a new admin) stays `php artisan admin:create`
 * only (see ADR 0009's "out-of-band provisioning" section); this
 * controller only manages accounts that already exist. Gated by
 * `admins.view`/`admins.manage` in admin-api's PermissionsGuard — both
 * are super_admin-only in practice (no other role's ability array lists
 * them; only `super_admin`'s `'*'` wildcard satisfies the check), since
 * managing who else can operate the admin panel is inherently a
 * highest-privilege concern.
 */
class AdminAccountController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        return AdminAccountResource::collection(
            Admin::with('user')->orderBy('created_at')->get(),
        );
    }

    /**
     * Role changes take effect on the target admin's *next* login, not
     * retroactively — same trade-off docs/admin-api/permissions.md
     * already documents for ADR 0009 (a Sanctum token's abilities are
     * fixed at issuance; there's no live revocation of an already-issued
     * token's abilities short of deleting the token itself).
     *
     * Self-protection: an admin can't change their own role through this
     * endpoint — the realistic failure mode this guards is an admin
     * fat-fingering their own row in a list UI and locking themselves out
     * of `admins.manage` entirely with no one else around to fix it.
     */
    /** ->resolve(), not a bare Resource return — a bare Resource gets
     * auto-wrapped in `{"data": {...}}` by Laravel's JsonResource default;
     * admin-api forwards this response flat to admin-web. */
    public function updateRole(UpdateAdminRoleRequest $request, Admin $admin): array
    {
        $actor = $request->admin();

        if ($admin->user_id === $actor->id) {
            abort(422, 'You cannot change your own admin role.');
        }

        $previousRole = $admin->admin_role;
        $newRole = $request->validated('admin_role');

        DB::transaction(function () use ($request, $admin, $actor, $previousRole, $newRole): void {
            if ($previousRole === $newRole) {
                return;
            }

            $admin->update(['admin_role' => $newRole]);

            AdminAudit::record(
                actor: $actor,
                action: 'admin_account.role_changed',
                auditableType: 'admin',
                auditableId: $admin->id,
                changes: ['admin_role' => ['from' => $previousRole, 'to' => $newRole], 'reason' => $request->validated('reason')],
            );
        });

        return (new AdminAccountResource($admin->fresh('user')))->resolve();
    }

    /**
     * Sets the target's `users.status = 'disabled'` — immediate, unlike
     * a role change: both login (AuthController::login) and admin-api's
     * own TokenVerificationService already reject any non-'active'
     * status, so a deactivated admin is locked out on their very next
     * request, not just their next login. No reverse ("reactivate")
     * command exists yet — not asked for.
     *
     * Same self-protection as updateRole() — can't deactivate your own
     * account through this endpoint.
     */
    /** ->resolve(), not a bare Resource return — see updateRole()'s note. */
    public function deactivate(DeactivateAdminAccountRequest $request, Admin $admin): array
    {
        $actor = $request->admin();

        if ($admin->user_id === $actor->id) {
            abort(422, 'You cannot deactivate your own admin account.');
        }

        DB::transaction(function () use ($request, $admin, $actor): void {
            $affected = $admin->user()->where('status', '!=', 'disabled')->update(['status' => 'disabled']);

            if ($affected === 0) {
                return;
            }

            AdminAudit::record(
                actor: $actor,
                action: 'admin_account.deactivated',
                auditableType: 'admin',
                auditableId: $admin->id,
                changes: ['status' => ['from' => 'active', 'to' => 'disabled'], 'reason' => $request->validated('reason')],
            );
        });

        return (new AdminAccountResource($admin->fresh('user')))->resolve();
    }
}
