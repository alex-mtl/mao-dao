<?php

namespace App\Services;

use App\Models\FriendRequest;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;

/**
 * MVP notification feed, derived on the fly from existing models rather
 * than a separate events table: incoming pending friend requests and
 * being added to someone else's group. An item is "unread" when it was
 * created after the user last opened the bell (users.notifications_read_at).
 * Race invites have no model of their own (rooms are joined by link/code),
 * so there is nothing to surface for them yet.
 */
class NotificationFeedService
{
    public function unreadCount(User $user): int
    {
        $readAt = $user->notifications_read_at;

        $friendRequests = FriendRequest::query()
            ->where('recipient_id', $user->id)
            ->where('status', 'pending')
            ->when($readAt, fn ($q) => $q->where('created_at', '>', $readAt))
            ->count();

        $groups = $user->groups()
            ->where('groups.owner_id', '!=', $user->id)
            ->when($readAt, fn ($q) => $q->where('group_user.created_at', '>', $readAt))
            ->count();

        return $friendRequests + $groups;
    }

    /**
     * @return Collection<int, array<string, mixed>>
     */
    public function items(User $user, int $limit = 20): Collection
    {
        $readAt = $user->notifications_read_at;
        $isUnread = fn (?CarbonInterface $at) => $at !== null && ($readAt === null || $at->gt($readAt));

        $friendRequests = FriendRequest::query()
            ->where('recipient_id', $user->id)
            ->where('status', 'pending')
            ->with('sender:id,name')
            ->latest()
            ->limit($limit)
            ->get()
            ->map(fn (FriendRequest $request) => [
                'type' => 'friend_request',
                'key' => 'friend_request-'.$request->id,
                'name' => $request->sender->name,
                'created_at' => $request->created_at,
                'unread' => $isUnread($request->created_at),
            ]);

        $groups = $user->groups()
            ->where('groups.owner_id', '!=', $user->id)
            ->with('owner:id,name')
            ->orderByPivot('created_at', 'desc')
            ->limit($limit)
            ->get()
            ->map(fn ($group) => [
                'type' => 'group_added',
                'key' => 'group_added-'.$group->id,
                'name' => $group->owner->name,
                'group_id' => $group->id,
                'group_name' => $group->name,
                'created_at' => $group->pivot->created_at,
                'unread' => $isUnread($group->pivot->created_at),
            ]);

        return $friendRequests->concat($groups)
            ->sortByDesc('created_at')
            ->take($limit)
            ->values()
            ->map(fn (array $item) => [...$item, 'created_at' => $item['created_at']?->toIso8601String()]);
    }

    public function markAllRead(User $user): void
    {
        $user->forceFill(['notifications_read_at' => now()])->save();
    }
}
