<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateDriverAvailabilityRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // gated by the `role:driver` route middleware
    }

    public function rules(): array
    {
        return [
            'is_available' => ['required', 'boolean'],
        ];
    }
}
