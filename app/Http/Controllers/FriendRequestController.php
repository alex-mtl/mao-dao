<?php

namespace App\Http\Controllers;

use App\Models\FriendRequest;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redirect;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class FriendRequestController extends Controller
{
    public function index(Request $request): Response
    {
        $user = $request->user();

        $friends = $user->acceptedFriendRequests()
            ->with(['sender:id,name', 'recipient:id,name'])
            ->get()
            ->map(function (FriendRequest $friendRequest) use ($user) {
                $friend = $friendRequest->sender_id === $user->id
                    ? $friendRequest->recipient
                    : $friendRequest->sender;

                return [
                    'id' => $friend->id,
                    'name' => $friend->name,
                    'friend_request_id' => $friendRequest->id,
                ];
            })
            ->values();

        $incoming = $user->receivedFriendRequests()
            ->where('status', 'pending')
            ->with('sender:id,name')
            ->get();

        $outgoing = $user->sentFriendRequests()
            ->where('status', 'pending')
            ->with('recipient:id,name')
            ->get();

        $search = trim((string) $request->query('search', ''));
        $searchResults = collect();

        if ($search !== '') {
            $excludedIds = $friends->pluck('id')
                ->merge($incoming->pluck('sender_id'))
                ->merge($outgoing->pluck('recipient_id'))
                ->push($user->id);

            $searchResults = User::query()
                ->where('name', 'like', '%'.$search.'%')
                ->whereNotIn('id', $excludedIds)
                ->limit(10)
                ->get(['id', 'name']);
        }

        return Inertia::render('Friends/Index', [
            'friends' => $friends,
            'incoming' => $incoming,
            'outgoing' => $outgoing,
            'search' => $search,
            'searchResults' => $searchResults,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'recipient_id' => ['required', 'integer', Rule::exists('users', 'id')],
        ]);

        $user = $request->user();
        $recipientId = (int) $validated['recipient_id'];

        abort_if($recipientId === $user->id, 422);

        // If the other user already sent us a pending request, accept it
        // instead of creating a second, reversed one.
        $reverse = FriendRequest::query()
            ->where('sender_id', $recipientId)
            ->where('recipient_id', $user->id)
            ->where('status', 'pending')
            ->first();

        if ($reverse) {
            $reverse->update(['status' => 'accepted']);

            return Redirect::back();
        }

        FriendRequest::firstOrCreate(
            ['sender_id' => $user->id, 'recipient_id' => $recipientId],
            ['status' => 'pending'],
        );

        return Redirect::back();
    }

    public function accept(Request $request, FriendRequest $friendRequest): RedirectResponse
    {
        $this->authorize('accept', $friendRequest);

        $friendRequest->update(['status' => 'accepted']);

        return Redirect::back();
    }

    /**
     * Covers cancelling a pending outgoing request, declining a pending
     * incoming request, and ending an accepted friendship — all three are
     * just "remove this row" from whichever side is allowed to do it.
     */
    public function destroy(Request $request, FriendRequest $friendRequest): RedirectResponse
    {
        $this->authorize('delete', $friendRequest);

        $friendRequest->delete();

        return Redirect::back();
    }
}
