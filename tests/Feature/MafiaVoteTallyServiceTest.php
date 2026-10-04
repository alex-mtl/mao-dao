<?php

use App\Services\Mafia\MafiaVoteTallyService;

test('votes are tallied per candidate and the highest count wins', function () {
    $service = new MafiaVoteTallyService();

    $votes = collect([
        ['voter_player_id' => 1, 'candidate_player_id' => 10],
        ['voter_player_id' => 2, 'candidate_player_id' => 10],
        ['voter_player_id' => 3, 'candidate_player_id' => 11],
    ]);

    $result = $service->tally([10, 11], $votes, collect([1, 2, 3]));

    expect($result['counts'])->toBe([10 => 2, 11 => 1]);
    expect($result['winners'])->toBe([10]);
});

test('a living voter who never cast a vote defaults to the last candidate in nomination order', function () {
    $service = new MafiaVoteTallyService();

    $votes = collect([
        ['voter_player_id' => 1, 'candidate_player_id' => 10],
    ]);

    // Voters 2 and 3 never voted — both default to candidate 12, the last
    // in nomination order.
    $result = $service->tally([10, 11, 12], $votes, collect([1, 2, 3]));

    expect($result['counts'])->toBe([10 => 1, 11 => 0, 12 => 2]);
    expect($result['winners'])->toBe([12]);
});

test('a tie is reported as multiple winners', function () {
    $service = new MafiaVoteTallyService();

    $votes = collect([
        ['voter_player_id' => 1, 'candidate_player_id' => 10],
        ['voter_player_id' => 2, 'candidate_player_id' => 11],
    ]);

    $result = $service->tally([10, 11], $votes, collect([1, 2]));

    expect($result['counts'])->toBe([10 => 1, 11 => 1]);
    expect($result['winners'])->toBe([10, 11]);
});

test('a single nominee with no votes at all still wins by default via the last-candidate rule', function () {
    $service = new MafiaVoteTallyService();

    $result = $service->tally([10], collect(), collect([1, 2, 3]));

    expect($result['counts'])->toBe([10 => 3]);
    expect($result['winners'])->toBe([10]);
});
