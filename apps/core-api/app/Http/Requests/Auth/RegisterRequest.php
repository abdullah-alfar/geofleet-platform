<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Anyone may self-register as a customer or driver. Admin accounts
        // are provisioned out-of-band (not via this endpoint).
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'phone' => ['nullable', 'string', 'max:32', 'unique:users,phone'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
            'role' => ['required', Rule::in(['customer', 'driver'])],
            'region_id' => ['nullable', 'string', 'max:64'],

            // Required only when registering as a driver.
            'license_number' => ['required_if:role,driver', 'string', 'max:64', 'unique:drivers,license_number'],
            'license_expires_at' => ['required_if:role,driver', 'date', 'after:today'],
        ];
    }
}
