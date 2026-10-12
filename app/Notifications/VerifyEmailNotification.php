<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Notifications\Messages\MailMessage;

/**
 * Laravel's stock confirmation email, with localized copy and a stated
 * 24-hour deadline. The signed link's own lifetime is taken from
 * `auth.verification.expire` (minutes), kept equal to the account deadline.
 */
class VerifyEmailNotification extends VerifyEmail
{
    public function toMail($notifiable): MailMessage
    {
        $hours = (int) round(config('auth.verification.expire', 1440) / 60);

        return (new MailMessage)
            ->subject(__('account.mail_subject'))
            ->greeting(__('account.mail_greeting', ['name' => $notifiable->name]))
            ->line(__('account.mail_intro'))
            ->action(__('account.mail_action'), $this->verificationUrl($notifiable))
            ->line(__('account.mail_deadline', ['hours' => $hours]))
            ->line(__('account.mail_ignore'))
            ->salutation(__('account.mail_salutation', ['app' => config('app.name')]));
    }
}
