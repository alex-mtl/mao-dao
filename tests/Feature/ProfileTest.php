<?php

use App\Models\Role;
use App\Models\User;

test('profile page is displayed', function () {
    $user = User::factory()->create();

    $response = $this
        ->actingAs($user)
        ->get('/profile');

    $response->assertOk();
});

test('profile information can be updated', function () {
    $user = User::factory()->create();

    $response = $this
        ->actingAs($user)
        ->patch('/profile', [
            'name' => 'Test User',
            'email' => 'test@example.com',
        ]);

    $response
        ->assertSessionHasNoErrors()
        ->assertRedirect('/profile');

    $user->refresh();

    $this->assertSame('Test User', $user->name);
    $this->assertSame('test@example.com', $user->email);
    $this->assertNull($user->email_verified_at);
});

test('email verification status is unchanged when the email address is unchanged', function () {
    $user = User::factory()->create();

    $response = $this
        ->actingAs($user)
        ->patch('/profile', [
            'name' => 'Test User',
            'email' => $user->email,
        ]);

    $response
        ->assertSessionHasNoErrors()
        ->assertRedirect('/profile');

    $this->assertNotNull($user->refresh()->email_verified_at);
});

test('super admin can delete their account', function () {
    $role = Role::factory()->create(['slug' => Role::SUPER_ADMIN]);
    $user = User::factory()->create(['role_id' => $role->id]);

    $response = $this
        ->actingAs($user)
        ->delete('/profile', [
            'password' => 'password',
        ]);

    $response
        ->assertSessionHasNoErrors()
        ->assertRedirect('/');

    $this->assertGuest();
    $this->assertNull($user->fresh());
});

test('correct password must be provided to delete account', function () {
    $role = Role::factory()->create(['slug' => Role::SUPER_ADMIN]);
    $user = User::factory()->create(['role_id' => $role->id]);

    $response = $this
        ->actingAs($user)
        ->from('/profile')
        ->delete('/profile', [
            'password' => 'wrong-password',
        ]);

    $response
        ->assertSessionHasErrors('password')
        ->assertRedirect('/profile');

    $this->assertNotNull($user->fresh());
});

test('a non super admin cannot delete their account', function () {
    $role = Role::factory()->create(['slug' => Role::USER]);
    $user = User::factory()->create(['role_id' => $role->id]);

    $response = $this
        ->actingAs($user)
        ->delete('/profile', [
            'password' => 'password',
        ]);

    $response->assertForbidden();

    $this->assertNotNull($user->fresh());
});

test('the delete account section is hidden from non super admins but shown to super admins', function () {
    $userRole = Role::factory()->create(['slug' => Role::USER]);
    $superAdminRole = Role::factory()->create(['slug' => Role::SUPER_ADMIN]);

    $user = User::factory()->create(['role_id' => $userRole->id]);
    $superAdmin = User::factory()->create(['role_id' => $superAdminRole->id]);

    $this->actingAs($user)->get('/profile')
        ->assertInertia(fn ($page) => $page->where('canDeleteAccount', false));

    $this->actingAs($superAdmin)->get('/profile')
        ->assertInertia(fn ($page) => $page->where('canDeleteAccount', true));
});
