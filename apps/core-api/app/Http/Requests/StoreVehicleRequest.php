<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreVehicleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // gated by the `role:driver` route middleware
    }

    public function rules(): array
    {
        return [
            'make' => ['required', 'string', 'max:64'],
            'model' => ['required', 'string', 'max:64'],
            'year' => ['required', 'integer', 'min:1980', 'max:'.(date('Y') + 1)],
            'color' => ['required', 'string', 'max:32'],
            'plate_number' => ['required', 'string', 'max:32', 'unique:vehicles,plate_number'],
            'vehicle_type' => ['required', Rule::in(['sedan', 'suv', 'van', 'motorcycle'])],
        ];
    }
}
