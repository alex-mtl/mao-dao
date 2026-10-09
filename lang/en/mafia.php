<?php

declare(strict_types=1);

return [
    'index_title' => 'Mafia',
    'index_heading' => 'Mafia',
    'index_description' => 'Gather up to 10 players for a game of secret roles, night eliminations, and day-time accusations.',
    'view_history_link' => 'View your game history',
    'create_room_button' => 'Create Room',
    'create_password_label' => 'Room password (optional)',
    'join_by_code_heading' => 'Have a room code?',
    'join_by_code_placeholder' => 'Enter code',
    'join_by_code_button' => 'Go',

    'join_title' => 'Join Mafia Room',
    'room_label' => 'Room',
    'player_count' => ':count / :max players',
    'password_label' => 'Room password',
    'join_button' => 'Join Room',

    'full_title' => 'Room Full',
    'full_description' => 'This room already has the maximum number of players.',
    'started_title' => 'Game Already Started',
    'started_description' => 'This game has already started and can no longer be joined.',
    'finished_title' => 'Game Finished',
    'finished_description' => 'This game has already finished.',
    'cancelled_title' => 'Room Cancelled',
    'cancelled_description' => 'This room was cancelled by the host.',
    'not_found_title' => 'Room Not Found',
    'not_found_description' => "We couldn't find a room with that code. Double-check the link and try again.",

    'room_full_or_started' => 'This room is full or has already started.',
    'wrong_password' => 'That password is incorrect.',

    'lobby_title' => 'Mafia Lobby',
    'lobby_heading' => 'Mafia Lobby',
    'seats_heading' => 'Seats (:count / :max)',
    'empty_seat' => 'Empty seat',
    'game_host_badge' => 'Host',
    'ready_badge' => 'Ready',
    'ready_button' => "I'm Ready",
    'not_ready_button' => 'Cancel Ready',
    'leave_button' => 'Leave Room',
    'waiting_for_ready' => 'The game starts automatically once everyone is ready.',
    'copy_invite_link' => 'Copy Invite Link',
    'link_copied' => 'Link Copied!',
    'share' => 'Share',

    'play_title' => 'Mafia',
    'fullscreen_enter_button' => 'Enter fullscreen',
    'fullscreen_exit_button' => 'Exit fullscreen',
    'play_placeholder_heading' => 'The game has begun',
    'play_your_role' => 'Your role: :role',
    'play_your_team' => 'Team: :team',
    'play_more_soon' => 'Full gameplay is coming in a future update — for now, this confirms your role was dealt correctly.',

    'role_citizen' => 'Citizen',
    'role_sheriff' => 'Sheriff',
    'role_mafia' => 'Mafia',
    'role_don' => 'Don',
    'team_red' => 'Town (Red)',
    'team_black' => 'Mafia (Black)',

    // Gameplay screen (Phase 3)
    'phase_sitdown' => 'Plotting the Crime',
    'phase_don_watch' => 'The Don is Watching',
    'phase_sheriff_watch' => 'The Sheriff is Watching',
    'phase_day' => 'Day',
    'phase_night' => 'Night Falls',
    'phase_shooting' => 'The Mafia Strikes',
    'phase_don_check' => "The Don's Check",
    'phase_sheriff_check' => "The Sheriff's Check",
    'phase_game_over' => 'Game Over',

    'stage_speaking' => 'Discussion',
    'stage_voting' => 'Voting',
    'stage_defense_speech' => 'Defense',
    'stage_lock_vote' => 'Final Vote',
    'stage_last_speech' => 'Last Words',
    'stage_morning_speech' => 'Morning News',

    'status_killed' => 'Killed',
    'status_voted_out' => 'Voted Out',
    'status_locked' => 'Eliminated',
    'status_disqualified' => 'Disqualified',
    'status_disconnect_eliminated' => 'Disconnected',

    // Seat-anchored action overlays (plan §2.5) — nominate/vote/shoot/check
    // share one label pattern rather than four separate strings.
    'action_nominate' => 'nominate',
    'action_vote' => 'vote for',
    'action_shoot' => 'shoot',
    'action_check' => 'check',
    'action_sit' => 'sit at',
    'spectators_heading' => 'Watching: :count',
    'spectator_guest' => 'Guest',
    'spectating_badge' => 'You are watching',
    'release_seat_button' => 'Free my seat',
    'release_seat_hint' => 'Give up your seat and keep watching',
    'release_seat_alone_hint' => "You are the only player, so there is nobody to take over the seat. Wait for someone to join, or leave the room.",
    'log_in_to_play' => 'Log in to play',
    'spectator_lobby_hint' => 'You are watching. Tap a free seat to sit down.',
    'spectator_guest_hint' => 'You are watching. Log in to take a seat.',
    'watch_instead' => 'Just watch instead',
    'seat_taken' => 'That seat was just taken.',
    'spectator_limit_reached' => 'This room already has the maximum number of spectators.',
    'shout_out_button' => 'Take a foul: your mic opens for a few seconds and you get a warning',
    'warnings_label' => ':count warning(s)',
    'pick_a_seat_hint' => 'Tap a free seat to sit there. The game starts automatically once everyone is ready.',
    'seat_action_label' => 'Tap to :action seat :slot',

    'day_label' => 'Day :day',
    'you_are_dead_notice' => 'You have been eliminated — you can keep watching.',
    'mafia_teammates_heading' => 'Your fellow mafia: seats :slots',

    'spotlight_last_speech' => ':name has the floor.',
    'spotlight_defense_speech' => ':name is defending themselves.',
    'spotlight_morning_speech' => 'In the night, :name was found dead. A few final words are shared in their memory.',
    'pass_button' => 'Pass',

    // Nominate/vote/shoot/check are now seat-anchored (tap a seat on the
    // grid directly, plan §2.5) rather than a pick-list with its own
    // heading/button — these hints replace that former heading text.
    'nominate_seat_hint' => 'Tap a seat above to accuse that player.',

    'vote_seat_hint' => 'Tap a highlighted seat above to cast your vote.',

    'lock_vote_candidates_heading' => 'Eliminate all of: :names?',
    'lock_vote_button' => 'Eliminate ALL',

    'shoot_heading' => 'Choose tonight\'s target',
    'shoot_seat_hint' => 'Tap a seat above to shoot that player.',
    'shoot_abstain_button' => "Don't Shoot",

    'don_check_heading' => 'Check if someone is the Sheriff',
    'check_seat_hint' => 'Tap a seat above to check that player.',
    'don_check_history_heading' => 'Your checks',
    'check_result_is_sheriff' => 'Seat :slot is the Sheriff.',
    'check_result_not_sheriff' => 'Seat :slot is not the Sheriff.',

    'sheriff_check_heading' => 'Check someone\'s allegiance',
    'sheriff_check_history_heading' => 'Your checks',
    'check_result_black' => 'Seat :slot is on the Mafia team.',
    'check_result_red' => 'Seat :slot is on the Town team.',

    'game_over_heading' => 'Game Over',
    'game_over_red' => 'The Town wins!',
    'game_over_black' => 'The Mafia wins!',

    // Voice/video (Phase 7)
    'camera_enable_button' => 'Enable Camera',
    'camera_disable_button' => 'Disable Camera',
    'media_error_media_permission_denied' => 'Camera/microphone access was denied — check your browser permissions.',
    'media_error_media_connection_failed' => 'Could not connect to the voice/video server.',
    'media_error_media_device_not_found' => 'No camera or microphone was found on this device.',
    'media_error_media_device_busy' => 'The camera or microphone is being used by another app or browser tab — close it and try again.',
    'media_error_media_setup_failed' => 'Something went wrong starting your camera. Try again.',
    'media_error_media_join_rejected' => 'The voice/video server rejected the connection — try reloading the page.',
    'media_error_media_token_failed' => 'Could not get permission to join voice/video for this room.',

    // Per-seat device controls (post-launch correction #7) — settings/
    // mic/cam/mirror live on the local player's own seat, a volume slider
    // on every other seat.
    'media_settings_button' => 'Video/audio settings',
    'media_settings_heading' => 'Video & audio settings',
    'media_settings_video_source' => 'Camera',
    'media_settings_audio_source' => 'Microphone',
    'media_settings_default_device' => 'System default',
    'media_settings_close_button' => 'Close',
    'media_settings_apply_button' => 'Apply',
    'media_mic_enable_button' => 'Unmute microphone',
    'media_mic_disable_button' => 'Mute microphone',
    'media_cam_enable_button' => 'Turn camera on',
    'media_cam_disable_button' => 'Turn camera off',
    'media_mirror_button' => 'Mirror my preview',
    'media_volume_label' => 'Volume for :name',

    // Disconnection (Phase 4)
    'disconnect_notice' => ':name has gone quiet. Eliminate them, or give them more time?',
    'disconnect_eliminate_button' => 'Eliminate',
    'disconnect_continue_button' => 'Give more time',

    // Hidden communication + accessibility (Phase 5)
    'signal_heading' => 'Send a covert signal',
    'signal_description' => "A silent way to signal a number and/or color to someone — they'll see who it came from, nobody else will.",
    'signal_help_label' => 'What is this?',
    'signal_target_label' => 'To: :name',
    'signal_trigger_label' => 'Send a covert signal to seat :slot',
    'signal_number_label' => 'Number',
    'signal_color_label' => 'Color',
    'signal_color_grey' => 'grey',
    'signal_color_black' => 'black',
    'signal_color_red' => 'red',
    'signal_send_button' => 'Send',
    'signal_cancel_button' => 'Cancel',
    'signal_received' => 'Seat :slot reveals :details',
    'signal_dismiss' => 'Dismiss',
    'seconds_remaining' => ':seconds seconds remaining',

    // Game history (Phase 5)
    'history_title' => 'Mafia History',
    'history_room' => 'Room :code',
    'history_won' => 'Won',
    'history_lost' => 'Lost',
    'no_games' => "You haven't finished a Mafia game yet.",
];
