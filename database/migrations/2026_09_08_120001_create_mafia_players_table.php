<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mafia_players', function (Blueprint $table) {
            $table->id();
            $table->foreignId('mafia_room_id')->constrained()->cascadeOnDelete();

            // Nullable: a seat nobody joined still gets dealt a role at
            // shuffle time (ttl10 always deals its fixed 10-role set across
            // all 10 seats regardless of headcount) and plays on as a
            // "dummy" — never speaking or acting, but still alive/dead and
            // still counted toward its team for the win check. See the
            // "Mafia Extension" plan §7/§10.
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();

            $table->unsignedTinyInteger('slot');
            $table->enum('role', ['citizen', 'sheriff', 'mafia', 'don'])->nullable();
            $table->enum('status', [
                'alive', 'killed', 'voted_out', 'locked', 'disqualified', 'disconnect_eliminated',
            ])->default('alive');
            $table->unsignedTinyInteger('warnings')->default(0);
            $table->boolean('is_ready')->default(false);
            $table->boolean('is_game_host')->default(false);
            $table->enum('connection_status', ['connected', 'disconnected'])->default('connected');
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('disconnected_at')->nullable();
            $table->timestamp('joined_at')->nullable();
            $table->timestamps();

            $table->unique(['mafia_room_id', 'slot']);
            $table->unique(['mafia_room_id', 'user_id']);
            $table->index(['mafia_room_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mafia_players');
    }
};
