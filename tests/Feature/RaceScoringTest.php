<?php

use App\Services\RaceScoringService;

test('an incorrect answer always scores zero regardless of speed', function () {
    $service = new RaceScoringService();

    expect($service->score(false, 0, 15000))->toBe(0);
    expect($service->score(false, 14999, 15000))->toBe(0);
});

test('a correct answer submitted instantly earns the full speed bonus', function () {
    $service = new RaceScoringService();

    $points = $service->score(true, 0, 15000);

    expect($points)->toBe(config('race.base_points') + config('race.max_speed_bonus'));
});

test('a correct answer submitted right at the deadline earns no speed bonus', function () {
    $service = new RaceScoringService();

    $points = $service->score(true, 15000, 15000);

    expect($points)->toBe(config('race.base_points'));
});

test('the speed bonus decreases linearly as response time increases', function () {
    $service = new RaceScoringService();

    $fast = $service->score(true, 3000, 15000);
    $medium = $service->score(true, 7500, 15000);
    $slow = $service->score(true, 12000, 15000);

    expect($fast)->toBeGreaterThan($medium);
    expect($medium)->toBeGreaterThan($slow);
    expect($slow)->toBeGreaterThan(config('race.base_points'));
});

test('a response time beyond the time limit is clamped to zero bonus, not negative', function () {
    $service = new RaceScoringService();

    $points = $service->score(true, 30000, 15000);

    expect($points)->toBe(config('race.base_points'));
});
