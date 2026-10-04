<?php

use App\Services\Mafia\MafiaShootResolver;
use Illuminate\Support\Collection;

test('the shot lands when every living black-team member agrees on the same target', function () {
    $resolver = new MafiaShootResolver();

    $shots = collect([
        ['actor_player_id' => 1, 'target_player_id' => 9],
        ['actor_player_id' => 2, 'target_player_id' => 9],
        ['actor_player_id' => 3, 'target_player_id' => 9],
    ]);

    expect($resolver->resolve($shots, collect([1, 2, 3])))->toBe(9);
});

test('nobody dies if the living black-team members disagree on the target', function () {
    $resolver = new MafiaShootResolver();

    $shots = collect([
        ['actor_player_id' => 1, 'target_player_id' => 9],
        ['actor_player_id' => 2, 'target_player_id' => 5],
        ['actor_player_id' => 3, 'target_player_id' => 9],
    ]);

    expect($resolver->resolve($shots, collect([1, 2, 3])))->toBeNull();
});

test('nobody dies if one living black-team member never submitted a shot', function () {
    $resolver = new MafiaShootResolver();

    $shots = collect([
        ['actor_player_id' => 1, 'target_player_id' => 9],
        ['actor_player_id' => 2, 'target_player_id' => 9],
    ]);

    expect($resolver->resolve($shots, collect([1, 2, 3])))->toBeNull();
});

test('nobody dies if a living black-team member explicitly abstained', function () {
    $resolver = new MafiaShootResolver();

    $shots = collect([
        ['actor_player_id' => 1, 'target_player_id' => 9],
        ['actor_player_id' => 2, 'target_player_id' => null],
        ['actor_player_id' => 3, 'target_player_id' => 9],
    ]);

    expect($resolver->resolve($shots, collect([1, 2, 3])))->toBeNull();
});

test('a lone surviving black-team member can still land a kill alone', function () {
    $resolver = new MafiaShootResolver();

    $shots = collect([
        ['actor_player_id' => 1, 'target_player_id' => 9],
    ]);

    expect($resolver->resolve($shots, collect([1])))->toBe(9);
});

test('there is no kill if no black-team players are alive to shoot', function () {
    $resolver = new MafiaShootResolver();

    expect($resolver->resolve(collect(), collect()))->toBeNull();
});

test('a disconnected shooter who never voted breaks unanimity even though the others agreed', function () {
    // Mirrors plan §8: a disconnected mafia/don's night action simply
    // fails — no substitute vote is cast on their behalf.
    $resolver = new MafiaShootResolver();

    $shots = collect([
        ['actor_player_id' => 1, 'target_player_id' => 9],
        ['actor_player_id' => 2, 'target_player_id' => 9],
    ]);

    expect($resolver->resolve($shots, collect([1, 2, 3])))->toBeNull();
});
