<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('admins', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique()->default(DB::raw('gen_random_uuid()'));

            // One admin profile per user account — same shape as
            // customers/drivers. A user with role='admin' but no row here
            // can authenticate but is granted no abilities (see
            // App\Support\AdminPermissions) — fails closed, not open.
            $table->foreignId('user_id')->unique()->constrained('users')->cascadeOnDelete();

            // See App\Support\AdminPermissions for the role -> Sanctum
            // token abilities mapping. Kept as a plain constrained column,
            // not a full roles/permissions table — the same "sufficient
            // for MVP-scale authorization" reasoning the 0001_01_01
            // users migration already applies to `users.role`.
            $table->string('admin_role');

            $table->timestampsTz();
        });

        DB::statement(
            'ALTER TABLE admins ADD CONSTRAINT admins_admin_role_check '.
            "CHECK (admin_role IN ('super_admin', 'operations_admin', 'support_admin', 'finance_admin', 'viewer'))"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('admins');
    }
};
