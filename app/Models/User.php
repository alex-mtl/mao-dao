<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;

#[Fillable(['name', 'email', 'password', 'ui_language', 'color_scheme'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable implements HasMedia
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable, InteractsWithMedia;

    public const MAX_COLLECTION_IMAGES = 100;

    public const MAX_IMAGE_SIZE_KB = 5120;

    /**
     * Included in every serialization of this model (e.g. the `auth.user`
     * Inertia prop) so the nav/UI can render a real avatar image, purely
     * presentational — no stored column, computed from the media library.
     */
    protected $appends = ['profile_photo_url'];

    protected function profilePhotoUrl(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->getFirstMediaUrl('profile') ?: null,
        );
    }

    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('profile')
            ->singleFile()
            ->acceptsMimeTypes(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

        $this->addMediaCollection('images')
            ->acceptsMimeTypes(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    }

    /**
     * Every user gets the default "User" role unless one was already set
     * explicitly (e.g. by a seeder). Not exposed via mass assignment
     * (`role_id` is intentionally absent from #[Fillable]) — this only
     * fires for real model creation (registration, social auth), not for
     * seeders run under WithoutModelEvents, which assign roles directly.
     */
    protected static function booted(): void
    {
        static::creating(function (User $user) {
            $user->role_id ??= Role::where('slug', Role::USER)->value('id');
        });
    }

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }

    public function hasRole(string $slug): bool
    {
        return $this->role?->slug === $slug;
    }

    public function isSuperAdmin(): bool
    {
        return $this->hasRole(Role::SUPER_ADMIN);
    }

    public function isCommunityAdmin(): bool
    {
        return $this->hasRole(Role::COMMUNITY_ADMIN);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    public function socialAccounts(): HasMany
    {
        return $this->hasMany(SocialAccount::class);
    }

    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class);
    }

    public function sentFriendRequests(): HasMany
    {
        return $this->hasMany(FriendRequest::class, 'sender_id');
    }

    public function receivedFriendRequests(): HasMany
    {
        return $this->hasMany(FriendRequest::class, 'recipient_id');
    }

    /**
     * All accepted friendships involving this user, regardless of who sent
     * the original request.
     */
    public function acceptedFriendRequests(): Builder
    {
        return FriendRequest::query()
            ->where('status', 'accepted')
            ->where(fn ($query) => $query
                ->where('sender_id', $this->id)
                ->orWhere('recipient_id', $this->id));
    }

    public function ownedGroups(): HasMany
    {
        return $this->hasMany(Group::class, 'owner_id');
    }

    public function groups(): BelongsToMany
    {
        return $this->belongsToMany(Group::class)->withTimestamps();
    }

    public function quizzes(): HasMany
    {
        return $this->hasMany(Quiz::class);
    }

    public function quizAttempts(): HasMany
    {
        return $this->hasMany(QuizAttempt::class);
    }

    public function likedQuizzes(): BelongsToMany
    {
        return $this->belongsToMany(Quiz::class, 'quiz_likes')->withTimestamps();
    }
}
