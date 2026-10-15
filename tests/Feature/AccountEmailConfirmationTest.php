<?php

use App\Models\User;
use App\Notifications\VerifyEmailNotification;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\URL;

function pendingUser(array $overrides = []): User
{
    return User::factory()->unverified()->create(array_merge([
        'verification_expires_at' => now()->addDay(),
    ], $overrides));
}

test('registering sends a confirmation link and starts a 24 hour grace period', function () {
    Notification::fake();

    $response = $this->post('/register', [
        'name' => 'Newbie',
        'email' => 'newbie@example.com',
        'password' => 'password-123',
        'password_confirmation' => 'password-123',
    ]);

    $this->assertAuthenticated();
    $response->assertRedirect(route('welcome', absolute: false));

    $user = User::where('email', 'newbie@example.com')->firstOrFail();
    expect($user->hasVerifiedEmail())->toBeFalse()
        ->and($user->verification_expires_at)->not->toBeNull()
        ->and($user->verification_expires_at->between(now()->addHours(23), now()->addHours(25)))->toBeTrue()
        ->and($user->emailVerificationState())->toBe('pending');

    Notification::assertSentTo($user, VerifyEmailNotification::class);
});

test('a pending account can use the site and sees a reminder prop', function () {
    $user = pendingUser();

    $this->actingAs($user)->get('/quiz')
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->where('emailVerification.state', 'pending')
            ->where('emailVerification.hoursLeft', 24));
});

test('a confirmed account has no reminder', function () {
    $this->actingAs(User::factory()->create())->get('/quiz')
        ->assertOk()
        ->assertInertia(fn ($page) => $page->where('emailVerification.state', 'verified'));
});

test('the confirmation link works without being signed in and clears the deadline', function () {
    $user = pendingUser();

    $url = URL::temporarySignedRoute('verification.verify', now()->addHour(), [
        'id' => $user->id,
        'hash' => sha1($user->email),
    ]);

    $this->get($url)->assertRedirect(route('login'));

    $user->refresh();
    expect($user->hasVerifiedEmail())->toBeTrue()
        ->and($user->verification_expires_at)->toBeNull()
        ->and($user->emailVerificationState())->toBe('verified');
    $this->assertGuest();
});

test('a link with a wrong hash does not confirm the account', function () {
    $user = pendingUser();

    $url = URL::temporarySignedRoute('verification.verify', now()->addHour(), [
        'id' => $user->id,
        'hash' => sha1('someone-else@example.com'),
    ]);

    $this->get($url)->assertForbidden();
    expect($user->fresh()->hasVerifiedEmail())->toBeFalse();
});

test('an unconfirmed account can sign in inside the grace period', function () {
    $user = pendingUser();

    $this->post('/login', ['email' => $user->email, 'password' => 'password'])
        ->assertRedirect(route('welcome', absolute: false));

    $this->assertAuthenticatedAs($user);
});

test('an unconfirmed account cannot sign in after the deadline', function () {
    $user = pendingUser(['verification_expires_at' => now()->subMinute()]);

    $this->post('/login', ['email' => $user->email, 'password' => 'password'])
        ->assertSessionHasErrors(['email', 'account_expired']);

    $this->assertGuest();
    expect($user->fresh()->emailVerificationState())->toBe('expired');
});

test('a session that outlives the deadline is ended on the next request', function () {
    $user = pendingUser(['verification_expires_at' => now()->subMinute()]);

    $this->actingAs($user)->get('/quiz')
        ->assertRedirect(route('login'));

    $this->assertGuest();
});

test('accounts without a deadline are never disabled', function () {
    $legacy = User::factory()->unverified()->create(['verification_expires_at' => null]);

    expect($legacy->emailVerificationState())->toBe('pending');

    $this->post('/login', ['email' => $legacy->email, 'password' => 'password'])
        ->assertRedirect(route('welcome', absolute: false));
});

test('placeholder (telegram) emails have nothing to confirm', function () {
    $telegram = User::factory()->unverified()->create([
        'email' => 'telegram-123@users.noreply.quiz-platform.local',
        'verification_expires_at' => null,
    ]);

    expect($telegram->emailVerificationState())->toBe('not_applicable');

    Notification::fake();
    $telegram->sendEmailVerificationNotification();
    Notification::assertNothingSent();
});

test('a disabled account can ask for a new link and is restored by it', function () {
    Notification::fake();
    $user = pendingUser(['verification_expires_at' => now()->subDay()]);

    $this->post('/email/resend-verification', ['email' => $user->email])
        ->assertSessionHas('status');

    Notification::assertSentTo($user, VerifyEmailNotification::class);
    $user->refresh();
    expect($user->verification_expires_at->isFuture())->toBeTrue()
        ->and($user->emailVerificationState())->toBe('pending');
});

test('asking for a new link reveals nothing about unknown or confirmed addresses', function () {
    Notification::fake();
    $verified = User::factory()->create();

    $unknown = $this->post('/email/resend-verification', ['email' => 'nobody@example.com']);
    $known = $this->post('/email/resend-verification', ['email' => $verified->email]);

    $unknown->assertSessionHas('status', __('account.resend_generic'));
    $known->assertSessionHas('status', __('account.resend_generic'));
    Notification::assertNothingSent();
});

test('resending from a signed-in pending account refreshes the deadline', function () {
    Notification::fake();
    $user = pendingUser(['verification_expires_at' => now()->addHour()]);

    $this->actingAs($user)->post('/email/verification-notification')
        ->assertSessionHas('status', 'verification-link-sent');

    Notification::assertSentTo($user, VerifyEmailNotification::class);
    expect($user->fresh()->verification_expires_at->between(now()->addHours(23), now()->addHours(25)))->toBeTrue();
});

test('the confirmation email is localized and states the deadline', function () {
    $user = User::factory()->unverified()->create(['ui_language' => 'ru', 'name' => 'Анна']);

    $user->notify(new VerifyEmailNotification);

    $message = app('mail.manager')->mailer('array')->getSymfonyTransport()->messages()->last()->getOriginalMessage();
    expect($message->getSubject())->toBe('Подтвердите адрес электронной почты')
        ->and($message->getTextBody())->toContain('Здравствуйте, Анна!')
        ->and($message->getTextBody())->toContain('24 ч');
});

test('with deadline enforcement off, registration only shows a reminder and never disables', function () {
    config(['auth.verification.enforce_deadline' => false]);
    Notification::fake();

    $this->post('/register', [
        'name' => 'Soft',
        'email' => 'soft@example.com',
        'password' => 'password-123',
        'password_confirmation' => 'password-123',
    ]);

    $user = User::where('email', 'soft@example.com')->firstOrFail();
    expect($user->verification_expires_at)->toBeNull()
        ->and($user->emailVerificationState())->toBe('pending');
    Notification::assertSentTo($user, VerifyEmailNotification::class);
});
