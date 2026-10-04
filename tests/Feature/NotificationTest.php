<?php

use App\Models\FriendRequest;
use App\Models\Group;
use App\Models\User;

function unreadFor($test, User $user): int
{
    return $test->actingAs($user)->get('/dashboard')->viewData('page')['props']['notifications_unread'];
}

test('a new incoming friend request raises the bell counter', function () {
    $me = User::factory()->create();
    $sender = User::factory()->create();

    expect(unreadFor($this, $me))->toBe(0);

    FriendRequest::create(['sender_id' => $sender->id, 'recipient_id' => $me->id, 'status' => 'pending']);

    expect(unreadFor($this, $me))->toBe(1);
});

test('being added to someone elses group counts, but creating your own group does not', function () {
    $me = User::factory()->create();
    $owner = User::factory()->create();

    $own = Group::create(['owner_id' => $me->id, 'name' => 'Mine']);
    $own->members()->attach($me->id);
    expect(unreadFor($this, $me))->toBe(0);

    $theirs = Group::create(['owner_id' => $owner->id, 'name' => 'Theirs']);
    $theirs->members()->attach([$owner->id, $me->id]);
    expect(unreadFor($this, $me))->toBe(1);
});

test('opening the list shows the events as unread once, then clears the counter', function () {
    $me = User::factory()->create();
    $sender = User::factory()->create(['name' => 'Zed Sender']);
    FriendRequest::create(['sender_id' => $sender->id, 'recipient_id' => $me->id, 'status' => 'pending']);

    $first = $this->actingAs($me)->getJson('/notifications')->assertOk()->json('items');
    expect($first)->toHaveCount(1);
    expect($first[0]['type'])->toBe('friend_request');
    expect($first[0]['name'])->toBe('Zed Sender');
    expect($first[0]['unread'])->toBeTrue();

    expect(unreadFor($this, $me))->toBe(0);

    $second = $this->actingAs($me)->getJson('/notifications')->json('items');
    expect($second)->toHaveCount(1);
    expect($second[0]['unread'])->toBeFalse();
});

test('an event arriving after the list was read counts as unread again', function () {
    $me = User::factory()->create();
    $owner = User::factory()->create();

    $this->actingAs($me)->getJson('/notifications')->assertOk();
    $me->forceFill(['notifications_read_at' => now()->subMinute()])->save();
    expect(unreadFor($this, $me))->toBe(0);

    $group = Group::create(['owner_id' => $owner->id, 'name' => 'Late']);
    $group->members()->attach([$owner->id, $me->id]);

    expect(unreadFor($this, $me))->toBe(1);
});

test('accepted or someone elses friend requests do not notify', function () {
    $me = User::factory()->create();
    $a = User::factory()->create();
    $b = User::factory()->create();

    FriendRequest::create(['sender_id' => $a->id, 'recipient_id' => $me->id, 'status' => 'accepted']);
    FriendRequest::create(['sender_id' => $a->id, 'recipient_id' => $b->id, 'status' => 'pending']);
    FriendRequest::create(['sender_id' => $me->id, 'recipient_id' => $b->id, 'status' => 'pending']);

    expect(unreadFor($this, $me))->toBe(0);
});

test('guests cannot read notifications', function () {
    $this->getJson('/notifications')->assertUnauthorized();
});
