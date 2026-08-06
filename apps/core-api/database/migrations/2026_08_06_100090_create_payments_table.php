<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->id();

            // Kafka partition key for payment.* events — per-payment ordering.
            $table->uuid('uuid')->unique()->default(DB::raw('gen_random_uuid()'));

            // One payment per trip for MVP (no split/partial payments yet).
            $table->foreignId('trip_id')->unique()->constrained('trips')->restrictOnDelete();
            $table->foreignId('customer_id')->constrained('customers')->restrictOnDelete();

            $table->decimal('amount', 10, 2);
            $table->char('currency', 3)->default('JOD');
            $table->string('status')->default('pending');

            // External payment provider identifiers. Never store full
            // payment credentials here (brief: no full payment credentials
            // in logs or storage) — only a provider-issued reference.
            $table->string('provider')->nullable();
            $table->string('provider_reference')->nullable()->unique();
            $table->string('failure_reason')->nullable();

            $table->timestampTz('paid_at')->nullable();
            $table->timestampsTz();
        });

        DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'completed', 'failed', 'refunded'))");
        DB::statement('ALTER TABLE payments ADD CONSTRAINT payments_amount_positive_check CHECK (amount >= 0)');

        // Supports: "a customer's payment/billing history" and admin
        // filtering by payment state (e.g. finding failed payments to retry).
        Schema::table('payments', function (Blueprint $table) {
            $table->index(['customer_id', 'status']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};
