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
});

Route::get('/guessword', [GuesswordController::class, 'index'])->name('guessword.index');
