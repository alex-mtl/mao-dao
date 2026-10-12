<?php

declare(strict_types=1);

return [
    'mail_subject' => 'Confirm your email address',
    'mail_greeting' => 'Hello, :name!',
    'mail_intro' => 'Thanks for signing up. Please confirm your email address to activate your account.',
    'mail_action' => 'Confirm email',
    'mail_deadline' => 'The link is valid for :hours hours. If the address is not confirmed in that time, the account will be disabled.',
    'mail_ignore' => 'If you did not create an account, you can ignore this email.',
    'mail_salutation' => 'See you at :app',
    'confirmed_please_login' => 'Email confirmed. You can sign in now.',
    'resend_generic' => 'If this address is registered and not confirmed yet, we have sent a new confirmation link to it.',
    'disabled_login' => 'This account is disabled: the email address was not confirmed within 24 hours. Request a new confirmation link below.',
    'pending_badge' => 'Pending validation',
    'pending_banner' => 'Confirm your email address: we sent a link to :email. The account will be disabled if it is not confirmed within :hours h.',
    'pending_banner_no_deadline' => 'Your email address :email is not confirmed yet. Please confirm it with the link we emailed you.',
    'resend_button' => 'Send the link again',
    'resend_sent' => 'A new confirmation link has been sent.',
    'login_resend_button' => 'Send me a new confirmation link',
];
