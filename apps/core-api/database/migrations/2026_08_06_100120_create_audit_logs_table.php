<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique()->default(DB::raw('gen_random_uuid()'));

            // Polymorphic actor: a user (customer/driver/admin) or "system"
            // for events raised by background jobs/consumers rather than a
            // request.
            $table->string('actor_type');
            $table->unsignedBigInteger('actor_id')->nullable();

            $table->string('action');

            // Polymorphic subject of the action (e.g. ride_request, trip).
            $table->string('auditable_type')->nullable();
            $table->unsignedBigInteger('auditable_id')->nullable();

            $table->jsonb('changes')->nullable();
            $table->string('region_id')->nullable();

            $table->timestampTz('occurred_at');
            $table->timestampTz('created_at')->useCurrent();
        });

        Schema::table('audit_logs', function (Blueprint $table) {
            // Supports: "history of changes to this record" (e.g. a trip's
            // full audit trail for support/dispute resolution).
            $table->index(['auditable_type', 'auditable_id']);

            // Supports: "everything this actor did" (security review, abuse
            // investigation).
            $table->index(['actor_type', 'actor_id']);

            // Supports the retention/pruning job (added when retention
            // policies are implemented) selecting rows older than a cutoff.
            $table->index('occurred_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};
