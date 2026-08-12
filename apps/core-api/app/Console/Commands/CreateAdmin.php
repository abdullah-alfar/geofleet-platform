<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\AdminPermissions;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * Out-of-band admin provisioning — per RegisterRequest's own comment,
 * admin accounts are deliberately not reachable through
 * POST /api/v1/auth/register (self-registering as an admin would defeat
 * the point of the role). This is the one path that creates them.
 *
 * See docs/decisions/0009-admin-identity.md.
 */
class CreateAdmin extends Command
{
    protected $signature = 'admin:create
        {email : Login email}
        {name : Display name}
        {admin_role : One of super_admin, operations_admin, support_admin, finance_admin, viewer}
        {--password= : If omitted, a random password is generated and printed once}';

    protected $description = 'Provisions an admin user + admin profile out-of-band.';

    public function handle(): int
    {
        $email = $this->argument('email');
        $name = $this->argument('name');
        $adminRole = $this->argument('admin_role');
        $password = $this->option('password') ?: Str::password(20);

        $validator = Validator::make(
            ['email' => $email, 'name' => $name, 'admin_role' => $adminRole],
            [
                'email' => ['required', 'email', 'max:255', 'unique:users,email'],
                'name' => ['required', 'string', 'max:255'],
                'admin_role' => ['required', 'string', 'in:'.implode(',', AdminPermissions::validRoles())],
            ],
        );

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $message) {
                $this->error($message);
            }

            return self::FAILURE;
        }

        DB::transaction(function () use ($email, $name, $adminRole, $password): void {
            $user = User::create([
                'name' => $name,
                'email' => $email,
                'password' => $password,
                'role' => 'admin',
            ]);

            $user->admin()->create(['admin_role' => $adminRole]);
        });

        $this->info("Admin account created: {$email} ({$adminRole}).");

        if (! $this->option('password')) {
            // Only ever surfaced here — never written to Log:: or any
            // other durable sink. The operator running this command is
            // responsible for delivering it to the new admin securely.
            $this->warn("Generated password (shown once): {$password}");
        }

        return self::SUCCESS;
    }
}
