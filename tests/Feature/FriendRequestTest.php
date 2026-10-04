<?php

use App\Models\FriendRequest;
use App\Models\User;

test('a user can send a friend request', function () {
    $sender = User::factory()->create();
    $recipient = User::factory()->create();

    $this->actingAs($sender)->post('/friends', ['recipient_id' => $recipient->id]);

    $this->assertDatabaseHas('friend_requests', [
        'sender_id' => $sender->id,
        'recipient_id' => $recipient->id,
        'status' => 'pending',
    ]);
});

test('a user cannot send a friend request to themselves', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->post('/friends', ['recipient_id' => $user->id]);

    $response->assertStatus(422);
});

test('sending a duplicate request does not create a second row', function () {
    $sender = User::factory()->create();
    $recipient = User::factory()->create();

    $this->actingAs($sender)->post('/friends', ['recipient_id' => $recipient->id]);
    $this->actingAs($sender)->post('/friends', ['recipient_id' => $recipient->id]);

    expect(FriendRequest::where('sender_id', $sender->id)->where('recipient_id', $recipient->id)->count())->toBe(1);
});

test('a mutual request from the other side auto-accepts instead of duplicating', function () {
    $alice = User::factory()->create();
    $bob = User::factory()->create();

    $this->actingAs($alice)->post('/friends', ['recipient_id' => $bob->id]);
    $this->actingAs($bob)->post('/friends', ['recipient_id' => $alice->id]);

    $this->assertDatabaseHas('friend_requests', [
        'sender_id' => $alice->id,
        'recipient_id' => $bob->id,
        'status' => 'accepted',
    ]);
    expect(FriendRequest::count())->toBe(1);
});

test('only the recipient can accept a request', function () {
    $sender = User::factory()->create();
    $recipient = User::factory()->create();
    $request = FriendRequest::create([
        'sender_id' => $sender->id,
        'recipient_id' => $recipient->id,
        'status' => 'pending',
    ]);

    $this->actingAs($sender)->patch("/friends/{$request->id}/accept")->assertForbidden();
    $this->actingAs($recipient)->patch("/friends/{$request->id}/accept")->assertRedirect();

    expect($request->fresh()->status)->toBe('accepted');
});

test('either participant can remove a friendship or request, but a stranger cannot', function () {
    $sender = User::factory()->create();
    $recipient = User::factory()->create();
    $stranger = User::factory()->create();
    $request = FriendRequest::create([
        'sender_id' => $sender->id,
        'recipient_id' => $recipient->id,
        'status' => 'accepted',
    ]);

    $this->actingAs($stranger)->delete("/friends/{$request->id}")->assertForbidden();
    $this->actingAs($recipient)->delete("/friends/{$request->id}")->assertRedirect();

    $this->assertDatabaseMissing('friend_requests', ['id' => $request->id]);
});

test('search excludes existing friends, pending requests, and the current user', function () {
    $user = User::factory()->create(['name' => 'Searcher']);
    $friend = User::factory()->create(['name' => 'Already Friend']);
    $pending = User::factory()->create(['name' => 'Already Pending']);
    $stranger = User::factory()->create(['name' => 'Findable Stranger']);

    FriendRequest::create(['sender_id' => $user->id, 'recipient_id' => $friend->id, 'status' => 'accepted']);
    FriendRequest::create(['sender_id' => $user->id, 'recipient_id' => $pending->id, 'status' => 'pending']);

    $response = $this->actingAs($user)->get('/friends?search=Already');

    $response->assertInertia(fn ($page) => $page->where('searchResults', []));

    $response = $this->actingAs($user)->get('/friends?search=Findable');
    $response->assertInertia(fn ($page) => $page->has('searchResults', 1));
});
