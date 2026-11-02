<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Products an account has (App\Models\UserProduct): one row per grant, with its term - the active
 * ones answer "may this user ...?", the rest stay as history. The first product is the streamer
 * pack; it moves here from the GUESSWORD_STREAMERS allowlist in .env and from the short-lived
 * users.streamer_pack flag, every current holder until the end of 2026 (owner's decision, 2026-11-02).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('product', 40);
            $table->timestamp('starts_at');
            $table->timestamp('expires_at')->nullable();       // null = no end
            $table->timestamp('revoked_at')->nullable();
            $table->string('source', 20);                      // migration | admin | console | purchase
            $table->foreignId('granted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['user_id', 'product']);
        });

        $ids = DB::table('users')->where('streamer_pack', true)->pluck('id')->all();
        $emails = $this->allowlist();
        if ($emails) {
            $ids = array_merge($ids, DB::table('users')->whereIn(DB::raw('lower(email)'), $emails)->pluck('id')->all());
        }
        $now = now();
        foreach (array_unique($ids) as $id) {
            DB::table('user_products')->insert([
                'user_id' => $id,
                'product' => 'streamer_pack',
                'starts_at' => $now,
                'expires_at' => '2026-12-31 23:59:59',
                'source' => 'migration',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('streamer_pack');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('streamer_pack')->default(false);
        });
        Schema::dropIfExists('user_products');
    }

    /** GUESSWORD_STREAMERS read from the file itself: with a cached config env() is empty */
    private function allowlist(): array
    {
        $path = app()->environmentFilePath();
        $env = is_file($path) ? (string) file_get_contents($path) : '';
        $value = preg_match('/^GUESSWORD_STREAMERS=(.*)$/m', $env, $m) ? trim($m[1], " \t\r\"'") : '';

        return array_values(array_filter(array_map(fn ($e) => strtolower(trim($e)), explode(',', $value))));
    }
};
