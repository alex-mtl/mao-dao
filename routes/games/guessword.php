<?php

use App\Games\Guessword\Http\Controllers\ArchiveController;
use App\Games\Guessword\Http\Controllers\BonusesController;
use App\Games\Guessword\Http\Controllers\ClientAccountsController;
use App\Games\Guessword\Http\Controllers\ClientController;
use App\Games\Guessword\Http\Controllers\GuesswordController;
use App\Games\Guessword\Http\Controllers\QuizBankController;
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
    // viewers' bonuses on account (the monitor's "Players' bonuses" tab)
    Route::get('/guessword/room/bonuses', [BonusesController::class, 'index'])->name('guessword.room.bonuses');
    Route::post('/guessword/room/bonuses', [BonusesController::class, 'change'])->name('guessword.room.bonuses.change');

    // the archive of LIVEs and the digest built in the browser (ArchiveController)
    Route::get('/guessword/archive', [ArchiveController::class, 'index'])->name('guessword.archive');
    Route::get('/guessword/archive/lives/{file}', [ArchiveController::class, 'events'])->name('guessword.archive.events');
    Route::get('/guessword/archive/rounds/{live}', [ArchiveController::class, 'rounds'])->name('guessword.archive.rounds');
    Route::get('/guessword/avatars/{key}', [ArchiveController::class, 'avatar'])->name('guessword.avatar');

    // super admins: every streamer's room (the same page and actions, for a room picked from the list)
    Route::get('/guessword/rooms', [GuesswordController::class, 'rooms'])->name('guessword.rooms');
    Route::get('/guessword/rooms/{room}', [GuesswordController::class, 'room'])->name('guessword.rooms.show');
    Route::post('/guessword/rooms/{room}', [GuesswordController::class, 'update'])->name('guessword.rooms.update');
    Route::post('/guessword/rooms/{room}/start', [GuesswordController::class, 'start'])->name('guessword.rooms.start');
    Route::post('/guessword/rooms/{room}/stop', [GuesswordController::class, 'stop'])->name('guessword.rooms.stop');
    Route::post('/guessword/rooms/{room}/link', [GuesswordController::class, 'regenerateLink'])->name('guessword.rooms.link');
    Route::get('/guessword/rooms/{room}/bonuses', [BonusesController::class, 'index'])->name('guessword.rooms.bonuses');
    Route::post('/guessword/rooms/{room}/bonuses', [BonusesController::class, 'change'])->name('guessword.rooms.bonuses.change');
    Route::get('/guessword/rooms/{room}/archive', [ArchiveController::class, 'index'])->name('guessword.rooms.archive');
    Route::get('/guessword/rooms/{room}/archive/lives/{file}', [ArchiveController::class, 'roomEvents'])->name('guessword.rooms.archive.events');
    Route::get('/guessword/rooms/{room}/archive/rounds/{live}', [ArchiveController::class, 'roomRounds'])->name('guessword.rooms.archive.rounds');

    // super admins: accounts for the streamer app and their access keys
    Route::get('/guessword/clients', [ClientAccountsController::class, 'index'])->name('guessword.clients');
    Route::post('/guessword/clients', [ClientAccountsController::class, 'store'])->name('guessword.clients.store');
    Route::post('/guessword/clients/{user}/key', [ClientAccountsController::class, 'issueKey'])->name('guessword.clients.key');
    Route::post('/guessword/clients/{user}/revoke', [ClientAccountsController::class, 'revokeKey'])->name('guessword.clients.revoke');
    Route::post('/guessword/clients/{user}/pack', [ClientAccountsController::class, 'pack'])->name('guessword.clients.pack');
});

Route::get('/guessword', [GuesswordController::class, 'index'])->name('guessword.index');

// the streamer app (stream-client/): access key → one-time sign-in address and the overlay link
Route::middleware('throttle:20,1')->group(function () {
    Route::post('/guessword/client/api/session', [ClientController::class, 'session'])->name('guessword.client.session');
    Route::get('/guessword/client/enter/{code}', [ClientController::class, 'enter'])->name('guessword.client.enter');
});
// the engine: viewers' bonuses (stream-engine/app/bonuses.py), header X-Internal-Secret
Route::get('/internal/guessword/bonuses', [BonusesController::class, 'engineBalances'])->name('internal.guessword.bonuses');
Route::post('/internal/guessword/bonuses', [BonusesController::class, 'engineOps'])->name('internal.guessword.bonuses.ops');
// the engine's Quiz game: the generated quizzes with every wrong answer (stream-engine/app/games/quiz/bank.py)
Route::get('/internal/guessword/quizzes', [QuizBankController::class, 'index'])->name('internal.guessword.quizzes');

// asked on every load of the overlay in OBS / LIVE Studio
Route::post('/guessword/client/api/overlay', [ClientController::class, 'overlay'])
    ->middleware('throttle:120,1')->name('guessword.client.overlay');
