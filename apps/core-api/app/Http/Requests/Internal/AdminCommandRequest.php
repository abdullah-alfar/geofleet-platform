<?php

namespace App\Http\Requests\Internal;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Base for every internal/v1/* command request. Authorization for *which*
 * admin may call *which* command already happened in admin-api's own
 * PermissionsGuard before this HTTP request was ever made — see
 * docs/decisions/0010-internal-service-authentication.md. `admin_user_id`
 * here is who to attribute the action to (audit_logs), validated for
 * data-integrity (defense in depth on an already-authenticated boundary),
 * not re-authorized.
 */
abstract class AdminCommandRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // gated by the `internal-service` route middleware
    }

    public function rules(): array
    {
        return [
            'admin_user_id' => [
                'required',
                'uuid',
                Rule::exists('users', 'uuid')->where(fn ($query) => $query->where('role', 'admin')),
            ],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function admin(): User
    {
        return User::where('uuid', $this->validated('admin_user_id'))->firstOrFail();
    }
}
