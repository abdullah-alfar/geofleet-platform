<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Adds 'superseded' to ride_offers.status: when a driver accepts an
     * offer, every other pending offer for the same ride_request needs a
     * terminal status too — 'rejected' would incorrectly imply the driver
     * actively declined it, and 'expired' would incorrectly imply it timed
     * out. 'superseded' says precisely what happened: another driver got
     * the ride first.
     */
    public function up(): void
    {
        DB::statement('ALTER TABLE ride_offers DROP CONSTRAINT ride_offers_status_check');
        DB::statement("ALTER TABLE ride_offers ADD CONSTRAINT ride_offers_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'superseded'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE ride_offers DROP CONSTRAINT ride_offers_status_check');
        DB::statement("ALTER TABLE ride_offers ADD CONSTRAINT ride_offers_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'expired'))");
    }
};
