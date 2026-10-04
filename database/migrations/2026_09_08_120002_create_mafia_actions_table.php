<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Append-only log of every night/day action (shoot, checks, votes,
        // nominations, signals, ...) — the Laravel-idiomatic replacement
        // for ttl10's freeform `room.game.days[...]` JSON blob, so phase
        // resolution logic (e.g. "did every living black-team player
        // submit a matching shot?") is a queryable groupBy/having instead
        // of hand-parsed JSON. No `updated_at` — rows are never mutated.
        Schema::create('mafia_actions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('mafia_room_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('day');
            $table->string('phase');
            $table->foreignId('actor_player_id')->constrained('mafia_players')->cascadeOnDelete();
            $table->foreignId('target_player_id')->nullable()->constrained('mafia_players')->nullOnDelete();
            $table->string('action_type');
            $table->json('value')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['mafia_room_id', 'day', 'phase']);
            $table->index(['actor_player_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mafia_actions');
    }
};
