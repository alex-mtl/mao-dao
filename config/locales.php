<?php

declare(strict_types=1);

return [
    /*
     * The complete set of locales supported by the application UI and by
     * quiz content. Every place that needs to validate or list supported
     * languages (user ui_language, quiz language, the language switcher)
     * should read from this single source of truth.
     */
    'supported' => ['en', 'fr', 'es', 'ru'],

    'default' => 'en',

    'native_names' => [
        'en' => 'English',
        'fr' => 'Français',
        'es' => 'Español',
        'ru' => 'Русский',
    ],
];
