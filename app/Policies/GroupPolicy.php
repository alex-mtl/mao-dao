<?php

namespace App\Policies;

use App\Models\Group;
use App\Models\User;

class GroupPolicy
{
    public function view(User $user, Group $group): bool
    {
        return $user->id === $group->owner_id
            || $group->members()->where('users.id', $user->id)->exists();
    }

    public function update(User $user, Group $group): bool
    {
        return $user->id === $group->owner_id;
    }

    public function delete(User $user, Group $group): bool
    {
        return $user->id === $group->owner_id;
    }

    /**
     * Only the owner can add/remove other members.
     */
    public function manageMembers(User $user, Group $group): bool
    {
        return $user->id === $group->owner_id;
    }

    /**
     * Any current member (including the owner) can leave; the owner
     * leaving is handled as a special case in the controller since it
     * would orphan the group.
     */
    public function leave(User $user, Group $group): bool
    {
        return $group->members()->where('users.id', $user->id)->exists();
    }
}
