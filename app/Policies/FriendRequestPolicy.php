<?php

namespace App\Policies;

use App\Models\FriendRequest;
use App\Models\User;

class FriendRequestPolicy
{
    /**
     * Only the recipient may accept a pending request.
     */
    public function accept(User $user, FriendRequest $friendRequest): bool
    {
        return $user->id === $friendRequest->recipient_id;
    }

    /**
     * Either participant may remove the request/friendship — the sender
     * cancelling a pending request, the recipient declining it, or either
     * side ending an accepted friendship.
     */
    public function delete(User $user, FriendRequest $friendRequest): bool
    {
        return $user->id === $friendRequest->sender_id
            || $user->id === $friendRequest->recipient_id;
    }
}
