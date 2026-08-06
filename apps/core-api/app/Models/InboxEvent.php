<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InboxEvent extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'processed_at' => 'datetime',
        ];
    }
}
