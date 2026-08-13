<?php

namespace App\Http\Requests\Internal;

use App\Support\AdminPermissions;
use Illuminate\Validation\Rule;

class UpdateAdminRoleRequest extends AdminCommandRequest
{
    public function rules(): array
    {
        return array_merge(parent::rules(), [
            'admin_role' => ['required', 'string', Rule::in(AdminPermissions::validRoles())],
        ]);
    }
}
