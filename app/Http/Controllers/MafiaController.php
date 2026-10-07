<?php

namespace App\Http\Controllers;

use App\Events\Mafia\MafiaActionRecorded;
use App\Events\Mafia\MafiaGameStarting;
use App\Events\Mafia\MafiaLobbyUpdated;
use App\Events\Mafia\MafiaRoomCancelled;
use App\Events\Mafia\MafiaSignalReceived;
use App\Models\MafiaAction;
use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Inertia\Inertia;
use Inertia\Response;

class MafiaController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('Mafia/Index');
    }

    /**
     * A short-lived, HMAC-signed token authorizing the caller to join the
     * media-sfu sidecar's WebSocket as this specific player in this
     * specific room (plan Phase 7) — the sidecar verifies the signature
     * itself and never touches this database, so this is the *entire*
     * hand-off between the two processes. `media_shared_secret` must be
     * configured (same value as media-sfu/.env's SHARED_SECRET) or
     * voice/video simply doesn't work; deliberately not defaulted, so a
     * misconfigured deployment fails loudly here rather than silently
     * producing tokens the sidecar will never accept.
     */
    public function mediaToken(Request $request): JsonResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);
        abort_unless(filled(config('mafia.media_shared_secret')), 500, 'Voice/video is not configured on this server.');

        $payload = [
            'roomCode' => $room->room_code,
            'playerId' => $player->id,
            'userId' => $player->user_id,
            'slot' => $player->slot,
            'exp' => now()->addSeconds(config('mafia.media_token_ttl_seconds'))->timestamp,
        ];

        $payloadB64 = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
        $signature = hash_hmac('sha256', $payloadB64, (string) config('mafia.media_shared_secret'));

        return response()->json([
            'token' => "{$payloadB64}.{$signature}",
            'wsUrl' => config('mafia.media_ws_url'),
        ]);
    }

    /**
     * Server-to-server only — the media-sfu sidecar calls this before
     * letting a `consume` request through (plan Phase 7). Authenticated
     * by a shared-secret header, never by the `auth` guard (the sidecar
     * has no user session, no cookies, nothing Laravel's normal
     * middleware could check) — this route deliberately lives outside
     * every other Mafia route's middleware group in routes/web.php.
     */
    public function canView(Request $request): JsonResponse
    {
        $expected = (string) config('mafia.media_shared_secret');
        $given = (string) $request->header('X-Media-Sfu-Secret', '');
        abort_unless($expected !== '' && hash_equals($expected, $given), 403);

        $room = MafiaRoom::where('room_code', strtoupper((string) $request->query('room')))->first();
        $viewer = $room?->players()->find($request->query('viewer'));
        $target = $room?->players()->find($request->query('target'));

        return response()->json([
            'canView' => (bool) ($room && $viewer && $target && $room->canPlayerView($viewer, $target)),
        ]);
    }

    /**
     * Finished games the requesting user actually played in, newest
     * first — mirrors QuizAttemptController::history()'s shape/pagination
     * convention. A cancelled room never reaches here (no result to show
     * for it); only 'game_over' rooms count as history.
     */
    public function history(Request $request): Response
    {
        $games = MafiaPlayer::where('user_id', $request->user()->id)
            ->whereHas('room', fn ($q) => $q->where('status', 'game_over'))
            ->with('room')
            ->orderByDesc('created_at')
            ->paginate(15)
            ->through(fn (MafiaPlayer $p) => [
                'id' => $p->id,
                'roomCode' => $p->room->room_code,
                'role' => $p->role,
                'team' => $p->team(),
                'won' => $p->team() === $p->room->winner_team,
                'finishedAt' => $p->room->finished_at?->toIso8601String(),
            ]);

        return Inertia::render('Mafia/History', [
            'games' => $games,
        ]);
    }

    /**
     * Creates a room and seats its creator as the game-host (slot 1,
     * non-transferable in MVP — see plan §3.1/§10). Accounts-only, unlike
     * Race Mode: there's no nickname, the account name is the identity.
     */
    public function store(Request $request): RedirectResponse
    {
        MafiaRoom::deleteStaleFinishedRooms();

        $validated = $request->validate([
            'password' => ['nullable', 'string', 'max:64'],
        ]);

        $room = DB::transaction(function () use ($request, $validated) {
            $room = MafiaRoom::create([
                'host_user_id' => $request->user()->id,
                'room_code' => MafiaRoom::generateUniqueRoomCode(),
                'status' => 'lobby',
                'settings' => [
                    'password_hash' => filled($validated['password'] ?? null) ? Hash::make($validated['password']) : null,
                    'registered_only' => false,
                    'skip_role_shuffle' => true,
                    'autohost' => true,
                ],
                'current_day' => 0,
            ]);

            $room->players()->create([
                'user_id' => $request->user()->id,
                'slot' => 1,
                'status' => 'alive',
                'is_ready' => false,
                'is_game_host' => true,
                'joined_at' => now(),
                'last_seen_at' => now(),
            ]);

            return $room;
        });

        return redirect()->route('mafia.lobby', $room->room_code);
    }

    /**
     * Entry point for an invitation link. Renders the appropriate state
     * (joinable / full / already started / finished / cancelled / not
     * found), or sends an already-seated user straight to the lobby or
     * game — mirrors RaceController::show()'s shape, simplified for
     * accounts-only identity (no session-token resolution needed).
     */
    public function show(Request $request, string $code): Response|RedirectResponse
    {
        $room = MafiaRoom::where('room_code', strtoupper($code))->first();

        if (! $room) {
            return Inertia::render('Mafia/Join', [
                'state' => 'not_found',
                'code' => strtoupper($code),
            ]);
        }

        $existingPlayer = $room->players()->where('user_id', $request->user()->id)->first();
        if ($existingPlayer) {
            return redirect()->route($room->status === 'lobby' ? 'mafia.lobby' : 'mafia.play', $room->room_code);
        }

        $playerCount = $room->players()->count();

        $state = match (true) {
            $room->status === 'game_over' => 'finished',
            $room->status === 'cancelled' => 'cancelled',
            $room->status !== 'lobby' => 'started',
            $playerCount >= config('mafia.seats') => 'full',
            default => 'joinable',
        };

        return Inertia::render('Mafia/Join', [
            'state' => $state,
            'code' => $room->room_code,
            'playerCount' => $playerCount,
            'maxPlayers' => config('mafia.seats'),
            'requiresPassword' => (bool) ($room->settings['password_hash'] ?? null),
        ]);
    }

    public function join(Request $request, string $code): RedirectResponse
    {
        $room = MafiaRoom::where('room_code', strtoupper($code))->firstOrFail();

        $existing = $room->players()->where('user_id', $request->user()->id)->first();
        if ($existing) {
            return redirect()->route('mafia.lobby', $room->room_code);
        }

        if (! $room->isJoinable()) {
            return back()->withErrors(['room' => __('mafia.room_full_or_started')]);
        }

        if (filled($room->settings['password_hash'] ?? null)) {
            $validated = $request->validate(['password' => ['required', 'string']]);
            if (! Hash::check($validated['password'], $room->settings['password_hash'])) {
                return back()->withErrors(['password' => __('mafia.wrong_password')]);
            }
        }

        $occupiedSlots = $room->players()->pluck('slot')->all();
        $slot = collect(range(1, config('mafia.seats')))->first(fn ($s) => ! in_array($s, $occupiedSlots, true));

        $room->players()->create([
            'user_id' => $request->user()->id,
            'slot' => $slot,
            'status' => 'alive',
            'is_ready' => false,
            'joined_at' => now(),
            'last_seen_at' => now(),
        ]);

        MafiaLobbyUpdated::dispatch($room->fresh());

        return redirect()->route('mafia.lobby', $room->room_code);
    }

    public function lobby(Request $request): Response|RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        if (! $player) {
            return redirect()->route('mafia.show', $room->room_code);
        }

        if ($room->status !== 'lobby') {
            return redirect()->route('mafia.play', $room->room_code);
        }

        return Inertia::render('Mafia/Lobby', [
            'room' => [
                'code' => $room->room_code,
                'seats' => config('mafia.seats'),
            ],
            // Nested under one key (rather than spread as top-level props)
            // so it's a single, Inertia-stable object reference for
            // useMafiaChannel to seed its state from — see that hook's
            // sync-on-fresh-props effect and its docblock for why a
            // freshly-constructed-every-render object would infinite-loop.
            'snapshot' => [
                'status' => $room->status,
                'players' => $this->seatSnapshot($room->players()->orderBy('slot')->get()),
            ],
            'isGameHost' => $player->is_game_host,
            'isReady' => $player->is_ready,
            'myPlayerId' => $player->id,
            'inviteUrl' => route('mafia.show', $room->room_code),
        ]);
    }

    /**
     * Moves the player to another free seat while the room is still in
     * the lobby. A taken seat (including losing a race to another player
     * clicking the same one) is a benign no-op — the broadcast/redirect
     * resync shows the real occupancy. Ready state and host role stay with
     * the player, not the seat.
     */
    public function seat(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        if ($room->status !== 'lobby') {
            return redirect()->route('mafia.play', $room->room_code);
        }

        $validated = $request->validate([
            'slot' => ['required', 'integer', 'between:1,'.config('mafia.seats')],
        ]);

        $moved = DB::transaction(function () use ($room, $player, $validated) {
            $taken = $room->players()->where('slot', $validated['slot'])->lockForUpdate()->exists();

            if ($taken) {
                return false;
            }

            $player->update(['slot' => $validated['slot']]);

            return true;
        });

        if ($moved) {
            MafiaLobbyUpdated::dispatch($room->fresh());
        }

        return redirect()->route('mafia.lobby', $room->room_code);
    }

    /**
     * No explicit host-clicked "start" — matching ttl10 exactly: a room
     * auto-starts the moment every seated player is ready (mafia.js's
     * gamePlayerStatus / gameStart auto-fire). Toggling ready when the
     * room has already moved on is a benign timing race (same philosophy
     * as the Race Mode 409 fix), not an error — it just sends the player
     * to wherever the room already is.
     */
    public function ready(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        if ($room->status !== 'lobby') {
            return redirect()->route('mafia.play', $room->room_code);
        }

        $player->update(['is_ready' => ! $player->is_ready]);

        MafiaLobbyUpdated::dispatch($room->fresh());

        $everyoneReady = $room->players()->where('is_ready', false)->doesntExist();
        if ($everyoneReady) {
            $this->startGame($room->fresh());
        }

        return redirect()->route('mafia.lobby', $room->room_code);
    }

    public function play(Request $request): Response|RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        if (! $player) {
            return redirect()->route('mafia.show', $room->room_code);
        }

        if ($room->status === 'lobby') {
            return redirect()->route('mafia.lobby', $room->room_code);
        }

        // A lobby that never started (no dummies dealt, no roles, no
        // started_at) can still reach here if it was cancelled — e.g.
        // MafiaTickService::cancelAbandonedLobbies() flips 'lobby'
        // straight to 'cancelled', which isn't 'lobby' so the guard above
        // doesn't catch it. Without this, roomSnapshot() rendered a real
        // gameplay UI with every player's role null (never dealt) —
        // caught directly in production as a literal "mafia.role_null"
        // badge under a fake "Day" heading (Play.jsx's phase-label
        // fallback masked the actually-invalid status).
        if ($room->status === 'cancelled') {
            return redirect()->route('mafia.index');
        }

        // Nested under 'snapshot' (not spread as top-level props) so
        // useMafiaChannel gets one Inertia-stable object to seed its
        // state from — see that hook's docblock.
        return Inertia::render('Mafia/Play', [
            'code' => $room->room_code,
            'snapshot' => $this->roomSnapshot($room, $player),
        ]);
    }

    /**
     * JSON hydration/resync for the Reverb hooks — same role as
     * RaceController::state(). While the room is still in the lobby this
     * returns the lobby's own (simpler) shape, since Lobby.jsx's hook is
     * the only thing calling this before the game starts; every other
     * status returns the full gameplay snapshot Play.jsx needs.
     */
    public function state(Request $request): JsonResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        if ($room->status === 'lobby') {
            return response()->json([
                'status' => $room->status,
                'players' => $this->seatSnapshot($room->players()->orderBy('slot')->get()),
                'goAt' => $room->started_at?->toIso8601String(),
            ]);
        }

        return response()->json($this->roomSnapshot($room, $player));
    }

    /**
     * Living player, correct phase/stage, target still alive — every
     * write action below re-validates all three server-side regardless of
     * what the UI currently shows (never trust a button merely being
     * visible client-side — same principle as ttl10's onlyMafTeam/
     * onlySheriff/onlyDon). None of these trigger a phase transition
     * themselves — they only record a MafiaAction row; mafia:tick /
     * MafiaGameEngine is the only thing that ever advances the room, from
     * its own stored deadline (see MafiaGameEngine's class docblock).
     */
    /**
     * Only the player currently holding the floor may nominate — checked
     * here server-side, not just reflected in `canNominate` for the UI
     * (see roomSnapshot()). Confirmed directly against ttl10's own source:
     * its server-side handler actually accepts a nomination from ANY alive
     * player at ANY point in the discussion stage — the "only the active
     * speaker can nominate" restriction that real ttl10 play always
     * exhibits is enforced *only* by CSS (the nominate icon is invisible,
     * and its hover-reveal is itself gated behind a `self-active-speaker`
     * class only present on the current speaker's own client), never by
     * the server. A modified/devtools client could still fire the request
     * off-turn there and ttl10's server would honor it. Per direct
     * request, this port makes it a real server-side rule instead of a
     * CSS-only one — a deliberate improvement matching this app's existing
     * "no client-side-only enforcement" standard (see MafiaRoom::canPlayerView()),
     * not a departure from what a normal ttl10 game actually looks like.
     */
    public function nominate(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        $state = $room->dayState();
        $isCurrentSpeaker = $room->status === 'day' && $room->stage === 'speaking'
            && ($state['speaking_order'][0] ?? null) === $player->slot;

        if ($player->isAlive() && $isCurrentSpeaker) {
            $validated = $request->validate(['target_player_id' => ['required', 'integer']]);
            $target = $room->players()->whereKey($validated['target_player_id'])->where('status', 'alive')->first();

            if ($target && $target->id !== $player->id) {
                // Re-nominating your own current pick toggles it off —
                // matches ttl10's own accuser-toggle behavior exactly
                // (`nominatePlayer` in ws/controllers/mafia.js). A `null`
                // target records "no active nomination from this actor"
                // under the same "latest action per actor wins" convention
                // every other action type already uses; MafiaRoom::currentNominees()
                // filters those out when building the aggregate list.
                $currentNomineeId = MafiaAction::where('mafia_room_id', $room->id)
                    ->where('actor_player_id', $player->id)
                    ->where('action_type', 'nominate')
                    ->where('day', $room->current_day)
                    ->orderByDesc('created_at')
                    ->value('target_player_id');

                $this->recordAction($room, $player, 'day', 'nominate', $currentNomineeId === $target->id ? null : $target->id);
            }
        }

        return redirect()->route('mafia.play', $room->room_code);
    }

    /**
     * Accepts a vote for any candidate in the current round, not only the
     * one currently "up" — a deliberate simplification of ttl10's
     * per-candidate live window (see MafiaGameEngine's class docblock);
     * the final tally still applies the last-candidate default to anyone
     * who never explicitly voted.
     */
    public function vote(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        if ($player->isAlive() && $room->stage === 'voting') {
            $validated = $request->validate(['candidate_player_id' => ['required', 'integer']]);
            $candidates = $room->dayState()['voting_candidates'] ?? [];

            if (in_array((int) $validated['candidate_player_id'], $candidates, true)) {
                $this->recordAction($room, $player, 'day', 'vote', (int) $validated['candidate_player_id']);
            }
        }

        return redirect()->route('mafia.play', $room->room_code);
    }

    /**
     * Pressing this is the only "yes" signal for the "Eliminate ALL" lock
     * motion — silence counts as no (plan §7), so there's nothing to
     * record for a non-press.
     */
    public function lockVote(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        if ($player->isAlive() && $room->stage === 'lock_vote') {
            $this->recordAction($room, $player, 'day', 'lock_vote');
        }

        return redirect()->route('mafia.play', $room->room_code);
    }

    /**
     * A null target is an explicit abstain — MafiaShootResolver treats a
     * missing or null-target shot identically (no kill), matching plan §7.
     */
    public function shoot(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        if ($player->isAlive() && $room->status === 'shooting' && in_array($player->role, ['mafia', 'don'], true)) {
            $validated = $request->validate(['target_player_id' => ['nullable', 'integer']]);
            $target = ! empty($validated['target_player_id'])
                ? $room->players()->whereKey($validated['target_player_id'])->where('status', 'alive')->first()
                : null;

            $this->recordAction($room, $player, 'shooting', 'shoot', $target?->id);
        }

        return redirect()->route('mafia.play', $room->room_code);
    }

    /**
     * "Never re-check the same target" is enforced across the room's
     * entire history, not just this night — plan §7. One check per night
     * is enforced separately, by day.
     */
    public function donCheck(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        if ($player->isAlive() && $room->status === 'don_check' && $player->role === 'don') {
            $validated = $request->validate(['target_player_id' => ['required', 'integer']]);
            $this->recordCheck($room, $player, 'don_check', (int) $validated['target_player_id']);
        }

        return redirect()->route('mafia.play', $room->room_code);
    }

    public function sheriffCheck(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        if ($player->isAlive() && $room->status === 'sheriff_check' && $player->role === 'sheriff') {
            $validated = $request->validate(['target_player_id' => ['required', 'integer']]);
            $this->recordCheck($room, $player, 'sheriff_check', (int) $validated['target_player_id']);
        }

        return redirect()->route('mafia.play', $room->room_code);
    }

    /**
     * A covert signal to a specific seat — number and color are both
     * optional (plan §7's hidden-communication panel: "5 reveals" with no
     * number is a legitimate message on its own). Usable any time a game
     * is actually running, not gated to a particular phase — it's a
     * side-channel specifically because normal speech is restricted most
     * of the time.
     */
    public function signal(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        if ($player->isAlive() && ! in_array($room->status, ['lobby', 'game_over', 'cancelled'], true)) {
            $validated = $request->validate([
                'target_player_id' => ['required', 'integer'],
                'number' => ['nullable', 'integer', 'min:1', 'max:10'],
                'color' => ['nullable', 'in:grey,black,red'],
            ]);

            $target = $room->players()->whereKey($validated['target_player_id'])->where('status', 'alive')->first();

            if ($target && $target->id !== $player->id) {
                $value = ['number' => $validated['number'] ?? null, 'color' => $validated['color'] ?? null];
                $this->recordAction($room, $player, 'signal', 'signal', $target->id, $value);
                MafiaSignalReceived::dispatch($room, $target, $player->slot, $value['number'], $value['color']);
            }
        }

        return redirect()->route('mafia.play', $room->room_code);
    }

    /**
     * Votes to eliminate or keep a currently-disconnected player (plan
     * §8) — resolved by mafia:tick, not here, once every other living
     * real (non-dummy) player has cast one. A player who is no longer
     * actually disconnected (or was never seated, or is the caller
     * themselves) simply has no effect.
     */
    public function disconnectVote(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        $validated = $request->validate([
            'target_player_id' => ['required', 'integer'],
            'choice' => ['required', 'in:eliminate,continue'],
        ]);

        $target = $room->players()
            ->whereKey($validated['target_player_id'])
            ->where('status', 'alive')
            ->where('connection_status', 'disconnected')
            ->first();

        if ($player->isAlive() && $target && $target->id !== $player->id) {
            $this->recordAction($room, $player, 'disconnect', "disconnect_{$validated['choice']}", $target->id);
        }

        return redirect()->route('mafia.play', $room->room_code);
    }

    /**
     * Ends the caller's own turn early — a speech, a last speech, a
     * defense speech. This never transitions the room itself; it just
     * pulls the deadline forward to now, so the very next mafia:tick
     * pass (≤500ms later) resolves the stage exactly as if the timer had
     * actually run out. No-ops silently if it isn't the caller's turn.
     */
    public function pass(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        abort_unless($player, 403);

        if ($this->canPass($room, $player)) {
            $room->update(['phase_deadline_at' => now()]);
        }

        return redirect()->route('mafia.play', $room->room_code);
    }

    /**
     * Lobby-only for now — once a game is running, disconnect handling
     * (plan §8) is what governs a player dropping out, not a hard leave;
     * that lands in a later phase. The host leaving the lobby cancels the
     * room outright (simplest robust option, no host-transfer bookkeeping
     * — same call Race Mode made).
     */
    public function leave(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('mafiaRoom');
        $player = $request->attributes->get('mafiaPlayer');

        if ($player && $room->status === 'lobby') {
            $wasGameHost = $player->is_game_host;
            $player->delete();

            if ($wasGameHost) {
                $room->update(['status' => 'cancelled']);
                MafiaRoomCancelled::dispatch($room);
            } else {
                MafiaLobbyUpdated::dispatch($room->fresh());
            }
        }

        return redirect()->route('mafia.index');
    }

    /**
     * Deals the fixed 10-role deck across all 10 seats — materializing a
     * "dummy" player (user_id: null) for any seat nobody joined, since
     * ttl10 always deals its role deck regardless of headcount (plan §7's
     * dummy-seat correction). Instant, not the slow manual-pick flow
     * (`skip_role_shuffle` is fixed true in MVP — see plan §10).
     */
    private function startGame(MafiaRoom $room): void
    {
        DB::transaction(function () use ($room) {
            $occupiedSlots = $room->players()->pluck('slot')->all();
            $emptySlots = array_values(array_diff(range(1, config('mafia.seats')), $occupiedSlots));

            foreach ($emptySlots as $slot) {
                $room->players()->create([
                    'user_id' => null,
                    'slot' => $slot,
                    'status' => 'alive',
                    'is_ready' => true,
                    'joined_at' => null,
                ]);
            }

            $roles = collect(config('mafia.role_deck'))->shuffle()->values();
            $room->players()->orderBy('slot')->get()->each(
                fn (MafiaPlayer $player, int $i) => $player->update(['role' => $roles[$i]])
            );

            $room->update([
                'status' => 'sitdown',
                'current_day' => 0,
                'started_at' => now(),
                'phase_deadline_at' => now()->addMilliseconds(config('mafia.timers_ms.sitdown')),
            ]);
        });

        MafiaGameStarting::dispatch($room->fresh());
    }

    /**
     * @param  Collection<int, MafiaPlayer>  $players
     */
    private function seatSnapshot(Collection $players): array
    {
        return $players->map(fn (MafiaPlayer $p) => [
            'id' => $p->id,
            'slot' => $p->slot,
            'name' => $p->user?->name,
            'isGameHost' => $p->is_game_host,
            'isReady' => $p->is_ready,
        ])->values()->all();
    }

    private function recordAction(MafiaRoom $room, MafiaPlayer $player, string $phase, string $actionType, ?int $targetPlayerId = null, ?array $value = null): void
    {
        MafiaAction::create([
            'mafia_room_id' => $room->id,
            'day' => $room->current_day,
            'phase' => $phase,
            'actor_player_id' => $player->id,
            'target_player_id' => $targetPlayerId,
            'action_type' => $actionType,
            'value' => $value,
        ]);

        // Reported directly: nominate/vote/etc previously recorded silently
        // — nobody else found out until the next phase transition's own
        // broadcast, or the 12s heartbeat poll. One shared dispatch point
        // here covers every action type that calls recordAction() (every
        // in-stage action except signal, which already has its own
        // targeted broadcast — see MafiaSignalReceived).
        MafiaActionRecorded::dispatch($room);
    }

    /**
     * Shared by donCheck()/sheriffCheck(): the target must be alive, must
     * never have been checked by this role before (any day), and this
     * player must not have already used up tonight's one check.
     */
    /**
     * No alive-only filter on the target: the check phase runs right
     * after shooting, so the target may have just been killed by tonight's
     * shot — a check still has to work and return the true result (plan
     * §7's "checks resolve independent of status" correction). Any
     * MafiaPlayer row in the room is a legal target.
     */
    private function recordCheck(MafiaRoom $room, MafiaPlayer $player, string $actionType, int $targetPlayerId): void
    {
        $target = $room->players()->find($targetPlayerId);
        if (! $target) {
            return;
        }

        $alreadyCheckedThisTarget = MafiaAction::where('mafia_room_id', $room->id)
            ->where('action_type', $actionType)
            ->where('target_player_id', $target->id)
            ->exists();

        $alreadyActedTonight = MafiaAction::where('mafia_room_id', $room->id)
            ->where('actor_player_id', $player->id)
            ->where('action_type', $actionType)
            ->where('day', $room->current_day)
            ->exists();

        if (! $alreadyCheckedThisTarget && ! $alreadyActedTonight) {
            $this->recordAction($room, $player, $actionType, $actionType, $target->id);
        }
    }

    /**
     * Whether $player is the one currently entitled to end their own
     * spotlight turn early via pass() — the front of the speaking order
     * during a normal speech, or the featured player during a last/
     * defense/morning speech. False (a silent no-op) for every other
     * stage, including voting/lock-vote/night, which have no "your turn"
     * concept to skip.
     */
    private function canPass(MafiaRoom $room, MafiaPlayer $player): bool
    {
        $state = $room->dayState();

        return match (true) {
            $room->status === 'day' && $room->stage === 'speaking' => ($state['speaking_order'][0] ?? null) === $player->slot,
            in_array($room->stage, ['last_speech', 'morning_speech'], true) => ($state['current_elimination'] ?? null) === $player->id,
            $room->stage === 'defense_speech' => ($state['defense_queue'][0] ?? null) === $player->id,
            default => false,
        };
    }

    /**
     * Everything Play.jsx needs for the current phase/stage, scoped to
     * the requesting player — this is the only place hidden information
     * (your own role, check results, the mafia roster) is ever exposed,
     * and only ever to the player it belongs to (see plan §5.1 and
     * MafiaPhaseChanged's docblock for why this is safe without a
     * private broadcast channel).
     */
    private function roomSnapshot(MafiaRoom $room, MafiaPlayer $player): array
    {
        $state = $room->dayState();
        $players = $room->players()->orderBy('slot')->get();
        $stageStartedAt = $state['stage_started_at'] ?? null;

        $spotlightPlayerId = match (true) {
            in_array($room->stage, ['last_speech', 'morning_speech'], true) => $state['current_elimination'] ?? null,
            $room->stage === 'defense_speech' => $state['defense_queue'][0] ?? null,
            default => null,
        };

        // A last word or defense speech has exactly one seat holding the
        // floor too, same as a normal speaking-order turn — just keyed by
        // player id (spotlightPlayerId) rather than slot, since those
        // stages track a queue of player ids, not slots. Feeding both
        // into the same $currentSpeakerSlot lets the ring/highlight (§16)
        // and the info-panel countdown gating below cover all three
        // "somebody has the floor" stages identically.
        $currentSpeakerSlot = match (true) {
            $room->status === 'day' && $room->stage === 'speaking' => $state['speaking_order'][0] ?? null,
            $spotlightPlayerId !== null => $players->firstWhere('id', $spotlightPlayerId)?->slot,
            default => null,
        };

        $nomineeIds = match (true) {
            $room->status === 'day' && $room->stage === 'speaking' => $room->currentNominees(),
            $room->stage === 'voting' => $state['voting_candidates'] ?? [],
            default => [],
        };

        $hasActedThisStage = match (true) {
            $room->stage === 'voting' && $stageStartedAt => MafiaAction::where('mafia_room_id', $room->id)
                ->where('actor_player_id', $player->id)->where('action_type', 'vote')
                ->where('created_at', '>=', $stageStartedAt)->exists(),
            $room->stage === 'lock_vote' && $stageStartedAt => MafiaAction::where('mafia_room_id', $room->id)
                ->where('actor_player_id', $player->id)->where('action_type', 'lock_vote')
                ->where('created_at', '>=', $stageStartedAt)->exists(),
            $room->status === 'shooting' => MafiaAction::where('mafia_room_id', $room->id)
                ->where('actor_player_id', $player->id)->where('action_type', 'shoot')
                ->where('day', $room->current_day)->exists(),
            $room->status === 'don_check' => MafiaAction::where('mafia_room_id', $room->id)
                ->where('actor_player_id', $player->id)->where('action_type', 'don_check')
                ->where('day', $room->current_day)->exists(),
            $room->status === 'sheriff_check' => MafiaAction::where('mafia_room_id', $room->id)
                ->where('actor_player_id', $player->id)->where('action_type', 'sheriff_check')
                ->where('day', $room->current_day)->exists(),
            default => false,
        };

        return [
            'status' => $room->status,
            'stage' => $room->stage,
            'day' => $room->current_day,
            'deadlineAt' => $room->phase_deadline_at?->toIso8601String(),
            'winnerTeam' => $room->winner_team,
            'seats' => $players->map(fn (MafiaPlayer $p) => [
                'id' => $p->id,
                'slot' => $p->slot,
                'name' => $p->user?->name,
                'status' => $p->status,
                'isYou' => $p->id === $player->id,
                'connectionStatus' => $p->connection_status,
                // Every role is a full reveal at game-over (matches ttl10's
                // end-of-game icon reveal on every seat) — omitted at every
                // other status so a client can't learn anyone's role by
                // simply inspecting the snapshot payload mid-game.
                'role' => $room->status === 'game_over' ? $p->role : null,
            ])->values()->all(),
            'disconnectedPlayers' => $this->disconnectVoteOptions($room, $player, $players),
            'you' => [
                'id' => $player->id,
                'slot' => $player->slot,
                'role' => $player->role,
                'team' => $player->team(),
                'status' => $player->status,
                'isAlive' => $player->isAlive(),
                // Whichever seat THIS player most recently nominated today,
                // if any — lets the UI highlight "your current pick" on the
                // seat grid. Mirrors the same "latest action per accuser"
                // resolution MafiaRoom::currentNominees() already applies
                // for the aggregate nominee list, just scoped to one actor.
                'currentNomineeId' => $room->status === 'day' && $room->stage === 'speaking'
                    ? MafiaAction::where('mafia_room_id', $room->id)
                        ->where('actor_player_id', $player->id)
                        ->where('action_type', 'nominate')
                        ->where('day', $room->current_day)
                        ->orderByDesc('created_at')
                        ->value('target_player_id')
                    : null,
            ],
            'currentSpeakerSlot' => $currentSpeakerSlot,
            // The circular per-speaker countdown ring (plan-doc §16, matching
            // ttl10's own `slot-timer` element) needs a fixed "total" to
            // compute how much of the ring should still be filled — unlike
            // `deadlineAt` (a moving target every tick), this is the same
            // value for the whole turn. `MafiaGameEngine::beginSpeakingOrder()`/
            // `advanceSpeaking()` currently only ever transition with the
            // 'speech' timer key (never 'warned_speech' — see the plan doc's
            // Phase 4 note: nothing in this app can actually issue a warning
            // yet), so this is safe to hardcode to that one config value
            // rather than trying to infer which timer key was used.
            'speechDurationMs' => match (true) {
                $room->status === 'day' && $room->stage === 'speaking' => config('mafia.timers_ms.speech'),
                in_array($room->stage, ['last_speech', 'morning_speech'], true) => config('mafia.timers_ms.last_speech'),
                $room->stage === 'defense_speech' => config('mafia.timers_ms.defense_speech'),
                default => null,
            },
            'canPass' => $this->canPass($room, $player),
            'nominees' => collect($nomineeIds)->map(fn ($id) => $this->playerBrief($players, $id))->filter()->values()->all(),
            // Only the player currently holding the floor during a normal
            // speaking-order turn may nominate — see nominate()'s own
            // docblock for why this is a real server-side rule here rather
            // than the CSS-only restriction ttl10 itself actually
            // implements. $currentSpeakerSlot is also non-null during a
            // last/defense speech now (for the countdown ring above), so
            // the stage check here still matters — nominating isn't a
            // thing during those stages.
            'canNominate' => $player->isAlive() && $room->stage === 'speaking' && $currentSpeakerSlot === $player->slot,
            'votingCandidates' => collect($state['voting_candidates'] ?? [])
                ->map(fn ($id) => $this->playerBrief($players, $id))->filter()->values()->all(),
            'canVote' => $player->isAlive() && $room->stage === 'voting',
            'lockVoteCandidates' => collect($state['lock_vote_candidates'] ?? [])
                ->map(fn ($id) => $this->playerBrief($players, $id))->filter()->values()->all(),
            'canLockVote' => $player->isAlive() && $room->stage === 'lock_vote',
            'spotlightPlayer' => $spotlightPlayerId ? $this->playerBrief($players, $spotlightPlayerId) : null,
            'isSpotlight' => $spotlightPlayerId !== null && $spotlightPlayerId === $player->id,
            // {slot, role} rather than bare slots — lets the seat grid show
            // the don's own icon distinctly from a plain mafia icon for
            // teammates (matching ttl10's separate don-ring/mafia-silhouette
            // icons), not just "this is a teammate."
            'mafiaTeammates' => in_array($player->role, ['mafia', 'don'], true)
                ? $players->whereIn('role', ['mafia', 'don'])->where('id', '!=', $player->id)
                    ->map(fn (MafiaPlayer $p) => ['slot' => $p->slot, 'role' => $p->role])->values()->all()
                : [],
            'canShoot' => $player->isAlive() && $room->status === 'shooting' && in_array($player->role, ['mafia', 'don'], true),
            'canDonCheck' => $player->isAlive() && $room->status === 'don_check' && $player->role === 'don',
            'canSheriffCheck' => $player->isAlive() && $room->status === 'sheriff_check' && $player->role === 'sheriff',
            'donCheckHistory' => $player->role === 'don' ? $this->checkHistory($room, $player, 'don_check', 'isSheriff') : [],
            'sheriffCheckHistory' => $player->role === 'sheriff' ? $this->checkHistory($room, $player, 'sheriff_check', 'isBlackTeam') : [],
            'hasActedThisStage' => $hasActedThisStage,
        ];
    }

    /**
     * Every currently-disconnected, still-alive player the viewer is
     * eligible to vote on (plan §8) — nothing shown if the viewer isn't
     * themselves alive and connected (a disconnected player doesn't get a
     * say in someone else's disconnect vote either).
     *
     * @param  Collection<int, MafiaPlayer>  $players
     */
    private function disconnectVoteOptions(MafiaRoom $room, MafiaPlayer $player, Collection $players): array
    {
        if (! $player->isAlive() || $player->connection_status !== 'connected') {
            return [];
        }

        return $players
            ->filter(fn (MafiaPlayer $p) => $p->id !== $player->id && $p->isAlive() && $p->connection_status === 'disconnected')
            ->map(function (MafiaPlayer $p) use ($room, $player) {
                $myVote = MafiaAction::where('mafia_room_id', $room->id)
                    ->where('actor_player_id', $player->id)
                    ->where('target_player_id', $p->id)
                    ->whereIn('action_type', ['disconnect_eliminate', 'disconnect_continue'])
                    ->where('created_at', '>=', $p->disconnected_at)
                    ->latest()
                    ->first();

                return [
                    'id' => $p->id,
                    'slot' => $p->slot,
                    'name' => $p->user?->name,
                    'disconnectedSince' => $p->disconnected_at?->toIso8601String(),
                    'myVote' => $myVote ? str_replace('disconnect_', '', $myVote->action_type) : null,
                ];
            })
            ->values()
            ->all();
    }

    /**
     * A check's result is always derived from the target's current role,
     * never stored at check-time — it's correct even if the target was
     * later killed the same night (plan §7's "checks resolve independent
     * of status" correction).
     */
    private function checkHistory(MafiaRoom $room, MafiaPlayer $player, string $actionType, string $resultKey): array
    {
        return MafiaAction::where('mafia_room_id', $room->id)
            ->where('actor_player_id', $player->id)
            ->where('action_type', $actionType)
            ->with('target')
            ->get()
            ->unique('target_player_id')
            ->map(fn (MafiaAction $a) => [
                'slot' => $a->target->slot,
                $resultKey => $actionType === 'don_check'
                    ? $a->target->role === 'sheriff'
                    : in_array($a->target->role, ['mafia', 'don'], true),
            ])
            ->values()
            ->all();
    }

    private function playerBrief(Collection $players, ?int $playerId): ?array
    {
        $p = $players->firstWhere('id', $playerId);

        return $p ? ['id' => $p->id, 'slot' => $p->slot, 'name' => $p->user?->name] : null;
    }
}
