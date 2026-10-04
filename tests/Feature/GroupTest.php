<?php

use App\Models\Group;
use App\Models\User;

test('creating a group makes the creator the owner and first member', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->post('/groups', ['name' => 'Trivia Crew']);

    $group = Group::where('name', 'Trivia Crew')->first();
    expect($group->owner_id)->toBe($user->id);
    expect($group->members()->where('users.id', $user->id)->exists())->toBeTrue();
});

test('only the owner can add or remove members', function () {
    $owner = User::factory()->create();
    $member = User::factory()->create();
    $outsider = User::factory()->create();
    $group = Group::create(['owner_id' => $owner->id, 'name' => 'Group']);
    $group->members()->attach([$owner->id, $member->id]);

    $this->actingAs($member)
        ->post("/groups/{$group->id}/members", ['user_id' => $outsider->id])
        ->assertForbidden();

    $this->actingAs($owner)
        ->post("/groups/{$group->id}/members", ['user_id' => $outsider->id])
        ->assertRedirect();

    expect($group->members()->where('users.id', $outsider->id)->exists())->toBeTrue();
});

test('a user cannot join the same group twice', function () {
    $owner = User::factory()->create();
    $member = User::factory()->create();
    $group = Group::create(['owner_id' => $owner->id, 'name' => 'Group']);
    $group->members()->attach($owner->id);

    $this->actingAs($owner)->post("/groups/{$group->id}/members", ['user_id' => $member->id]);
    $this->actingAs($owner)->post("/groups/{$group->id}/members", ['user_id' => $member->id]);

    expect($group->members()->wherePivot('user_id', $member->id)->count())->toBe(1);
});

test('a non member cannot view the group', function () {
    $owner = User::factory()->create();
    $outsider = User::factory()->create();
    $group = Group::create(['owner_id' => $owner->id, 'name' => 'Group']);
    $group->members()->attach($owner->id);

    $this->actingAs($outsider)->get("/groups/{$group->id}")->assertForbidden();
});

test('a member can leave but the group survives', function () {
    $owner = User::factory()->create();
    $member = User::factory()->create();
    $group = Group::create(['owner_id' => $owner->id, 'name' => 'Group']);
    $group->members()->attach([$owner->id, $member->id]);

    $this->actingAs($member)->post("/groups/{$group->id}/leave")->assertRedirect();

    expect($group->members()->where('users.id', $member->id)->exists())->toBeFalse();
    $this->assertDatabaseHas('groups', ['id' => $group->id]);
});

test('the owner leaving deletes the group entirely', function () {
    $owner = User::factory()->create();
    $group = Group::create(['owner_id' => $owner->id, 'name' => 'Group']);
    $group->members()->attach($owner->id);

    $this->actingAs($owner)->post("/groups/{$group->id}/leave")->assertRedirect();

    $this->assertDatabaseMissing('groups', ['id' => $group->id]);
});

test('the owner can delete the group and it is removed with its memberships', function () {
    $owner = User::factory()->create();
    $member = User::factory()->create();
    $group = Group::create(['owner_id' => $owner->id, 'name' => 'Doomed']);
    $group->members()->attach([$owner->id, $member->id]);

    $this->actingAs($owner)->delete("/groups/{$group->id}")->assertRedirect(route('groups.index'));

    $this->assertDatabaseMissing('groups', ['id' => $group->id]);
    $this->assertDatabaseMissing('group_user', ['group_id' => $group->id]);
});

test('a non-owner member cannot delete the group', function () {
    $owner = User::factory()->create();
    $member = User::factory()->create();
    $group = Group::create(['owner_id' => $owner->id, 'name' => 'Safe']);
    $group->members()->attach([$owner->id, $member->id]);

    $this->actingAs($member)->delete("/groups/{$group->id}")->assertForbidden();

    $this->assertDatabaseHas('groups', ['id' => $group->id]);
});
