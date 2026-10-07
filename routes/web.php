<?php

use App\Http\Controllers\DashboardController;
use App\Http\Controllers\FriendRequestController;
use App\Http\Controllers\GroupController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\ImageController;
use App\Http\Controllers\MafiaController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\ProfilePhotoController;
use App\Http\Controllers\QuizAttemptController;
use App\Http\Controllers\QuizController;
use App\Http\Controllers\QuizExplorerController;
use App\Http\Controllers\QuizLibraryController;
use App\Http\Controllers\QuizLikeController;
use App\Http\Controllers\RaceController;
use App\Http\Controllers\WelcomeController;
use Illuminate\Support\Facades\Route;

Route::get('/', WelcomeController::class)->name('welcome');

Route::get('/dashboard', [DashboardController::class, 'index'])
    ->middleware(['auth', 'verified'])
    ->name('dashboard');

Route::middleware('auth')->group(function () {
    Route::get('/notifications', [NotificationController::class, 'index'])->name('notifications.index');
    Route::post('/dashboard/onboarding/dismiss', [DashboardController::class, 'dismissOnboarding'])->name('dashboard.onboarding.dismiss');
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::patch('/profile/language', [ProfileController::class, 'updateLanguage'])->name('profile.language.update');
    Route::patch('/profile/color-scheme', [ProfileController::class, 'updateColorScheme'])->name('profile.color-scheme.update');
    Route::patch('/profile/tags', [ProfileController::class, 'updateTags'])->name('profile.tags.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

    Route::post('/profile/photo', [ProfilePhotoController::class, 'store'])->name('profile.photo.store');
    Route::delete('/profile/photo', [ProfilePhotoController::class, 'destroy'])->name('profile.photo.destroy');

    Route::post('/images', [ImageController::class, 'store'])->name('images.store');
    Route::delete('/images/{media}', [ImageController::class, 'destroy'])->name('images.destroy');

    Route::get('/friends', [FriendRequestController::class, 'index'])->name('friends.index');
    Route::post('/friends', [FriendRequestController::class, 'store'])->name('friends.store');
    Route::patch('/friends/{friendRequest}/accept', [FriendRequestController::class, 'accept'])->name('friends.accept');
    Route::delete('/friends/{friendRequest}', [FriendRequestController::class, 'destroy'])->name('friends.destroy');

    Route::get('/groups', [GroupController::class, 'index'])->name('groups.index');
    Route::post('/groups', [GroupController::class, 'store'])->name('groups.store');
    Route::get('/groups/{group}', [GroupController::class, 'show'])->name('groups.show');
    Route::patch('/groups/{group}', [GroupController::class, 'update'])->name('groups.update');
    Route::delete('/groups/{group}', [GroupController::class, 'destroy'])->name('groups.destroy');
    Route::post('/groups/{group}/members', [GroupController::class, 'addMember'])->name('groups.members.add');
    Route::delete('/groups/{group}/members/{user}', [GroupController::class, 'removeMember'])->name('groups.members.remove');
    Route::post('/groups/{group}/leave', [GroupController::class, 'leave'])->name('groups.leave');

    Route::get('/explorer', fn () => redirect()->route('library.index'));
    Route::get('/library', [QuizLibraryController::class, 'index'])->name('library.index');
    Route::get('/my-quizzes', [QuizController::class, 'mine'])->name('quizzes.mine');
    Route::get('/quizzes/create', [QuizController::class, 'create'])->name('quizzes.create');
    Route::post('/quizzes', [QuizController::class, 'store'])->name('quizzes.store');
    Route::get('/quizzes/{quiz}', [QuizLibraryController::class, 'show'])->name('quizzes.show');
    Route::get('/quizzes/{quiz}/edit', [QuizController::class, 'edit'])->name('quizzes.edit');
    Route::put('/quizzes/{quiz}', [QuizController::class, 'update'])->name('quizzes.update');
    Route::get('/quizzes/{quiz}/preview', [QuizController::class, 'preview'])->name('quizzes.preview');
    Route::post('/quizzes/{quiz}/publish', [QuizController::class, 'publish'])->name('quizzes.publish');
    Route::post('/quizzes/{quiz}/copy', [QuizController::class, 'copy'])->name('quizzes.copy');
    Route::delete('/quizzes/{quiz}', [QuizController::class, 'destroy'])->name('quizzes.destroy');

    Route::post('/quizzes/{quiz}/like', [QuizLikeController::class, 'store'])->name('quizzes.like');
    Route::delete('/quizzes/{quiz}/like', [QuizLikeController::class, 'destroy'])->name('quizzes.unlike');

    Route::get('/quizzes/{quiz}/play', [QuizAttemptController::class, 'play'])->name('quizzes.play');
    Route::post('/quizzes/{quiz}/attempts', [QuizAttemptController::class, 'store'])->name('quiz-attempts.store');
    Route::get('/quiz-attempts/{quizAttempt}', [QuizAttemptController::class, 'show'])->name('quiz-attempts.show');
    Route::get('/quiz-history', [QuizAttemptController::class, 'history'])->name('quiz-attempts.history');

    Route::post('/quizzes/{quiz}/race', [RaceController::class, 'store'])->name('race.store');
    Route::post('/race/{code}/start', [RaceController::class, 'start'])->middleware('race.player')->name('race.start');
    Route::post('/race/{code}/play-again', [RaceController::class, 'playAgain'])->middleware('race.player')->name('race.play-again');

    // Mafia — unlike Race Mode, every route here is accounts-only (plan
    // §3.1 #2), so there's no guest-accessible group: identity is just
    // `auth()->user()`, resolved onto the request by ResolveMafiaPlayer
    // (mafia.player) rather than a session token.
    Route::get('/mafia', [MafiaController::class, 'index'])->name('mafia.index');
    Route::post('/mafia/rooms', [MafiaController::class, 'store'])->name('mafia.store');
    // Must come before the {code} wildcard route below, or "history"
    // would be swallowed as a room code.
    Route::get('/mafia/history', [MafiaController::class, 'history'])->name('mafia.history');
    Route::get('/mafia/{code}', [MafiaController::class, 'show'])->name('mafia.show');
    Route::post('/mafia/{code}/join', [MafiaController::class, 'join'])->name('mafia.join');
    Route::get('/mafia/{code}/lobby', [MafiaController::class, 'lobby'])->middleware('mafia.player')->name('mafia.lobby');
    Route::post('/mafia/{code}/seat', [MafiaController::class, 'seat'])->middleware('mafia.player')->name('mafia.seat');
    Route::post('/mafia/{code}/ready', [MafiaController::class, 'ready'])->middleware('mafia.player')->name('mafia.ready');
    Route::get('/mafia/{code}/play', [MafiaController::class, 'play'])->middleware('mafia.player')->name('mafia.play');
    Route::get('/mafia/{code}/state', [MafiaController::class, 'state'])->middleware('mafia.player')->name('mafia.state');
    Route::post('/mafia/{code}/nominate', [MafiaController::class, 'nominate'])->middleware('mafia.player')->name('mafia.nominate');
    Route::post('/mafia/{code}/vote', [MafiaController::class, 'vote'])->middleware('mafia.player')->name('mafia.vote');
    Route::post('/mafia/{code}/lock-vote', [MafiaController::class, 'lockVote'])->middleware('mafia.player')->name('mafia.lock-vote');
    Route::post('/mafia/{code}/shoot', [MafiaController::class, 'shoot'])->middleware('mafia.player')->name('mafia.shoot');
    Route::post('/mafia/{code}/don-check', [MafiaController::class, 'donCheck'])->middleware('mafia.player')->name('mafia.don-check');
    Route::post('/mafia/{code}/sheriff-check', [MafiaController::class, 'sheriffCheck'])->middleware('mafia.player')->name('mafia.sheriff-check');
    Route::post('/mafia/{code}/pass', [MafiaController::class, 'pass'])->middleware('mafia.player')->name('mafia.pass');
    Route::post('/mafia/{code}/disconnect-vote', [MafiaController::class, 'disconnectVote'])->middleware('mafia.player')->name('mafia.disconnect-vote');
    Route::post('/mafia/{code}/signal', [MafiaController::class, 'signal'])->middleware('mafia.player')->name('mafia.signal');
    Route::post('/mafia/{code}/leave', [MafiaController::class, 'leave'])->middleware('mafia.player')->name('mafia.leave');
    Route::get('/mafia/{code}/media-token', [MafiaController::class, 'mediaToken'])->middleware('mafia.player')->name('mafia.media-token');
});

// Server-to-server only (plan Phase 7) — the media-sfu sidecar, a
// separate Node.js process with no user session of its own, calls this
// to ask "can this viewer see this target right now". Authenticated by
// a shared-secret header inside MafiaController::canView() itself, never
// by the `auth` guard, so it deliberately sits outside every other Mafia
// route's middleware group.
Route::get('/internal/mafia/can-view', [MafiaController::class, 'canView'])->name('internal.mafia.can-view');
Route::get('/internal/mafia/mic-policy', [MafiaController::class, 'micPolicy'])->name('internal.mafia.mic-policy');

// Guest-accessible: an invitation link must work without an account. Race
// identity here is a session-stored token (see ResolveRacePlayer), not the
// `auth` guard, so these routes are reachable by anonymous and logged-in
// visitors alike.
Route::get('/race/{code}', [RaceController::class, 'show'])->name('race.show');
Route::post('/race/{code}/join', [RaceController::class, 'join'])->name('race.join');
Route::get('/race/{code}/lobby', [RaceController::class, 'lobby'])->middleware('race.player')->name('race.lobby');
Route::get('/race/{code}/play', [RaceController::class, 'play'])->middleware('race.player')->name('race.play');
Route::get('/race/{code}/state', [RaceController::class, 'state'])->middleware('race.player')->name('race.state');
Route::post('/race/{code}/answer', [RaceController::class, 'answer'])->middleware('race.player')->name('race.answer');
Route::post('/race/{code}/leave', [RaceController::class, 'leave'])->middleware('race.player')->name('race.leave');

require __DIR__.'/auth.php';
