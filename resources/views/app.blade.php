<!DOCTYPE html>
@php
    $colorScheme = auth()->user()->color_scheme
        ?? session('color_scheme')
        ?? config('color_schemes.default');
@endphp
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" data-theme="{{ $colorScheme }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">

        <title inertia>{{ config('app.name', 'Laravel') }}</title>

        <!-- Fonts -->
        <link rel="preconnect" href="https://fonts.bunny.net">
        <link href="https://fonts.bunny.net/css?family=inter:400,500,600,700|manrope:600,700,800&display=swap" rel="stylesheet" />

        {{-- Material Symbols Outlined — the exact icon set ttl10 itself uses for
             its Mafia game screen (role/nominate/signal/shoot/check/device-control
             icons), loaded here rather than picked as look-alike Heroicons, per
             explicit request to preserve that specific icon design. `icon_names`
             subsets the font to only the ligatures this app actually uses (~5KB/
             weight instead of the ~4MB full variable font) — see
             resources/js/Components/Mafia/MaterialIcon.jsx for the ligature list. --}}
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=bolt,counter_1,counter_2,counter_3,record_voice_over,frame_person,frame_person_mic,leak_add,eye_tracking,motion_sensor_active,visibility_lock,crop_free,settings,mic,mic_off,videocam,videocam_off,flip,volume_up&display=block" rel="stylesheet" />

        <!-- Scripts -->
        @routes
        @viteReactRefresh
        @vite(['resources/js/app.jsx', "resources/js/Pages/{$page['component']}.jsx"])
        @inertiaHead
    </head>
    <body class="font-sans antialiased bg-warm-100 text-ink-900">
        @inertia
    </body>
</html>
