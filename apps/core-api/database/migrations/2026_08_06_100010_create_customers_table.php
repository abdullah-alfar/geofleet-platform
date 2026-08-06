<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique()->default(DB::raw('gen_random_uuid()'));

            // One customer profile per user account.
            $table->foreignId('user_id')->unique()->constrained('users')->cascadeOnDelete();

            $table->decimal('rating', 3, 2)->nullable();
            $table->timestampsTz();
        });

        DB::statement('ALTER TABLE customers ADD CONSTRAINT customers_rating_range_check CHECK (rating IS NULL OR (rating >= 1.00 AND rating <= 5.00))');
    }

    public function down(): void
    {
        Schema::dropIfExists('customers');
    }
};
