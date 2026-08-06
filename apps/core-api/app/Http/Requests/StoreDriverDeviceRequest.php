<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDriverDeviceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // gated by the `role:driver` route middleware
    }

    public function rules(): array
    {
        return [
            'device_identifier' => ['required', 'string', 'max:191', 'unique:driver_devices,device_identifier'],
            'platform' => ['required', Rule::in(['ios', 'android'])],
            'app_version' => ['nullable', 'string', 'max:32'],
        ];
    }
}
