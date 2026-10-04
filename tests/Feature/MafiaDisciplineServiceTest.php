<?php

use App\Services\Mafia\MafiaDisciplineService;

test('a player under 3 warnings gets the normal speech duration', function () {
    $service = new MafiaDisciplineService();

    expect($service->speechMillisecondsFor(0))->toBe(config('mafia.timers_ms.speech'));
    expect($service->speechMillisecondsFor(2))->toBe(config('mafia.timers_ms.speech'));
});

test('a player with 3 or more warnings gets the shortened speech duration', function () {
    $service = new MafiaDisciplineService();

    expect($service->speechMillisecondsFor(3))->toBe(config('mafia.timers_ms.warned_speech'));
    expect($service->speechMillisecondsFor(5))->toBe(config('mafia.timers_ms.warned_speech'));
});

test('a player is only disqualified once warnings reach 4', function () {
    $service = new MafiaDisciplineService();

    expect($service->isDisqualified(3))->toBeFalse();
    expect($service->isDisqualified(4))->toBeTrue();
    expect($service->isDisqualified(5))->toBeTrue();
});
