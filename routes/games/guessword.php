<?php

use App\Games\Guessword\Http\Controllers\GuesswordController;
use Illuminate\Support\Facades\Route;

/*
 * Guess the Word for TikTok LIVE (docs/games/guessword.md). The section page is public; the room
 * pages need an account with access to the TikTok mode (App\Services\Capabilities).
 * The engine itself is published by nginx under /guessword/engine/ (not a Laravel route).
 */
Route::middleware('auth')->group(function () {
    Route::get('/guessword/room', [GuesswordController::class, 'room'])->name('guessword.room');
    Route::post('/guessword/room', [GuesswordController::class, 'update'])->name('guessword.room.update');
    Route::post('/guessword/room/start', [GuesswordController::class, 'start'])->name('guessword.room.start');
    Route::post('/guessword/room/stop', [GuesswordController::class, 'stop'])->name('guessword.room.stop');
    Route::post('/guessword/room/link', [GuesswordController::class, 'regenerateLink'])->name('guessword.room.link');

    // super admins: every streamer's room (the same page and actions, for a room picked from the list)
    Route::get('/guessword/rooms', [GuesswordController::class, 'rooms'])->name('guessword.rooms');
    Route::get('/guessword/rooms/{room}', [GuesswordController::class, 'room'])->name('guessword.rooms.show');
    Route::post('/guessword/rooms/{room}', [GuesswordController::class, 'update'])->name('guessword.rooms.update');
    Route::post('/guessword/rooms/{room}/start', [GuesswordController::class, 'start'])->name('guessword.rooms.start');
    Route::post('/guessword/rooms/{room}/stop', [GuesswordController::class, 'stop'])->name('guessword.rooms.stop');
    Route::post('/guessword/rooms/{room}/link', [GuesswordController::class, 'regenerateLink'])->name('guessword.rooms.link');
});

Route::get('/guessword', [GuesswordController::class, 'index'])->name('guessword.index');
