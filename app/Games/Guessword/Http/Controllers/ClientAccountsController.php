<?php

declare(strict_types=1);

namespace App\Games\Guessword\Http\Controllers;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\ClientAccounts;
use App\Services\StreamerPack;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Super admins: accounts for the streamer app (App\Services\ClientAccounts) - create one, switch its
 * streamer pack, issue / revoke its access key. A new key is shown once, right after it is made.
 */
class ClientAccountsController extends Controller
{
    public function __construct(private ClientAccounts $clients, private StreamerPack $pack) {}

    public function index(Request $request): Response
    {
        $this->admin($request);
        $rooms = GuesswordRoom::get(['id', 'user_id', 'tiktok_username'])->keyBy('user_id');
        $fresh = session('client_key');

        return Inertia::render('Guessword/Clients', [
            'clients' => User::where('client_only', true)->latest()->get()
                ->map(fn (User $u) => [
                    'id' => $u->id,
                    'name' => $u->name,
                    'tiktok' => $rooms[$u->id]->tiktok_username ?? null,
                    'roomId' => $rooms[$u->id]->id ?? null,
                    'pack' => (bool) ($grant = $this->pack->activeFor($u)),
                    'packUntil' => $grant?->expires_at?->toIso8601String(),
                    'keyHint' => $u->client_key_hint,
                    'keyIssued' => $u->client_key_issued_at?->toIso8601String(),
                    'created' => $u->created_at?->toIso8601String(),
                ])->values(),
            'newKey' => $fresh,     // {id, key} once, after "Generate key"
            'notice' => session('success'),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:60'],
            'pack' => ['boolean'],
        ]);
        $this->clients->create(trim($data['name']), $request->boolean('pack'), $request->user());

        return back()->with('success', __('guessword.client_created'));
    }

    public function issueKey(Request $request, User $user): RedirectResponse
    {
        $this->client($request, $user);
        $key = $this->clients->issueKey($user);

        return back()->with('client_key', ['id' => $user->id, 'key' => $key]);
    }

    public function revokeKey(Request $request, User $user): RedirectResponse
    {
        $this->client($request, $user);
        $this->clients->revokeKey($user);

        return back()->with('success', __('guessword.client_key_revoked'));
    }

    public function pack(Request $request, User $user): RedirectResponse
    {
        $this->client($request, $user);
        $request->boolean('on') ? $this->pack->grantUser($user, by: $request->user()) : $this->pack->revokeUser($user);

        return back();
    }

    private function admin(Request $request): void
    {
        abort_unless($request->user()->isSuperAdmin(), 403);
    }

    private function client(Request $request, User $user): void
    {
        $this->admin($request);
        abort_unless($user->client_only, 404);
    }
}
