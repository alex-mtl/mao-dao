<?php

namespace App\Http\Controllers;

use App\Models\FriendRequest;
use App\Models\Group;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redirect;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class GroupController extends Controller
{
    public function index(Request $request): Response
    {
        $user = $request->user();

        $groups = $user->groups()
            ->withCount('members')
            ->orderBy('name')
            ->get();

        return Inertia::render('Groups/Index', [
            'groups' => $groups,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
        ]);

        $user = $request->user();

        $group = DB::transaction(function () use ($user, $validated) {
            $group = Group::create([
                'owner_id' => $user->id,
                'name' => $validated['name'],
            ]);

            $group->members()->attach($user->id);

            return $group;
        });

        return Redirect::route('groups.show', $group);
    }

    public function show(Request $request, Group $group): Response
    {
        $this->authorize('view', $group);

        $user = $request->user();

        $friendIds = $user->acceptedFriendRequests()
            ->get()
            ->map(fn (FriendRequest $friendRequest) => $friendRequest->sender_id === $user->id
                ? $friendRequest->recipient_id
                : $friendRequest->sender_id);

        return Inertia::render('Groups/Show', [
            'group' => [
                'id' => $group->id,
                'name' => $group->name,
                'owner_id' => $group->owner_id,
            ],
            'members' => $group->members()->get(['users.id', 'users.name']),
            'isOwner' => $group->owner_id === $user->id,
            'friendsNotInGroup' => User::query()
                ->whereIn('id', $friendIds)
                ->whereDoesntHave('groups', fn ($query) => $query->where('groups.id', $group->id))
                ->get(['id', 'name']),
        ]);
    }

    public function update(Request $request, Group $group): RedirectResponse
    {
        $this->authorize('update', $group);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
        ]);

        $group->update($validated);

        return Redirect::route('groups.show', $group);
    }

    public function destroy(Request $request, Group $group): RedirectResponse
    {
        $this->authorize('delete', $group);

        $group->delete();

        return Redirect::route('groups.index');
    }

    public function addMember(Request $request, Group $group): RedirectResponse
    {
        $this->authorize('manageMembers', $group);

        $validated = $request->validate([
            'user_id' => ['required', 'integer', Rule::exists('users', 'id')],
        ]);

        $group->members()->syncWithoutDetaching([$validated['user_id']]);

        return Redirect::back();
    }

    public function removeMember(Request $request, Group $group, User $user): RedirectResponse
    {
        $this->authorize('manageMembers', $group);

        abort_if($user->id === $group->owner_id, 422);

        $group->members()->detach($user->id);

        return Redirect::back();
    }

    /**
     * A member leaves on their own. If the owner leaves, the group is
     * deleted outright rather than silently reassigning ownership.
     */
    public function leave(Request $request, Group $group): RedirectResponse
    {
        $this->authorize('leave', $group);

        if ($group->owner_id === $request->user()->id) {
            $group->delete();

            return Redirect::route('groups.index');
        }

        $group->members()->detach($request->user()->id);

        return Redirect::route('groups.index');
    }
}
