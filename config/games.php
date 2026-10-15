<?php

declare(strict_types=1);

/*
 * The games shown on the platform home page (blocks, in this order). Adding a
 * game = a row here + translations in lang/<locale>/platform.php + its own routes
 * under its URL prefix + docs/games/<key>.md.
 *
 * `route`  – named route of the game's section home
 * `create` – named route that starts a new game / room (null = none yet)
 */
return [
    'quiz' => [
        'route' => 'dashboard',
        'create' => 'library.index',
        'accent' => 'cyan',
    ],
    'mafia' => [
        'route' => 'mafia.index',
        'create' => 'mafia.index',
        'accent' => 'magenta',
    ],
];
