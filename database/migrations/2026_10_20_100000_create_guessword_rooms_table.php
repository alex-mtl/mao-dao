<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Guess the Word: one room per streamer (pilot). The game state lives in the stream-engine
 * sidecar; this table holds who owns the room and what the engine needs to run it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('guessword_rooms', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('tiktok_username', 64)->nullable()->unique();   // without "@", lower case
            $table->string('lang', 2)->default('ru');
            $table->text('euler_key')->nullable();                          // encrypted; empty = anonymous signing
            $table->text('tg_key')->nullable();                             // encrypted; the room's key for the bot / ranker
            $table->string('overlay_token', 64)->unique();                  // the TikTok LIVE Studio link
            $table->string('control_token', 64)->unique();                  // the owner's menu inside the engine
            $table->timestamp('last_started_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('guessword_rooms');
    }
};
