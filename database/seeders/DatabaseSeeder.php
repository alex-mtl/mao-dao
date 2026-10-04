<?php

namespace Database\Seeders;

use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $this->call(RoleSeeder::class);
        $this->call(TagSeeder::class);

        // The one seeded account with the Super Admin role, so
        // super-admin-only features (e.g. account deletion) are
        // reachable without manually promoting a user by hand.
        User::factory()->create([
            'name' => 'Test User',
            'email' => 'test@example.com',
            'role_id' => Role::where('slug', Role::SUPER_ADMIN)->value('id'),
        ]);

        $this->call(QuizPlatformSeeder::class);
    }
}
