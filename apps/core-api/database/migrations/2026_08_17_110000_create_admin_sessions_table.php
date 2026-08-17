<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * admin-api's own session store — replaces Sanctum's personal_access_
     * tokens for admin sessions (see docs/decisions/0011-admin-api-
     * independent-service.md, superseding 0009's Sanctum-sharing model).
     * core-api never reads this table; admin-api owns it outright, same
     * "id|plaintext, SHA-256 hash stored, constant-time compare on
     * verify" shape personal_access_tokens/driver_devices already use in
     * this codebase, just under admin-api's own roof.
     *
     * admin_role/abilities are baked in at login time, not re-derived per
     * request — mirrors Sanctum's own "abilities immutable at issuance,
     * changes apply next login" semantics that AdminAccountController's
     * updateRole already documents and relies on.
     */
    public function up(): void
    {
        Schema::create('admin_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('token_hash', 64)->unique();
            $table->string('admin_role');
            $table->jsonb('abilities');
            $table->timestampTz('expires_at')->nullable();
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampTz('created_at');
        });

        Schema::table('admin_sessions', function (Blueprint $table) {
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_sessions');
    }
};
