# Nothing here may ask the viewer to type the messenger's name in TikTok: TikTok may cut or filter it.
TEXT = {
    "ru": {
        "start": "Привет! Я свяжу тебя с твоим аккаунтом в TikTok, чтобы ты получал сообщения от игры на стриме.\n\n"
                 "Напиши в чат стрима <b>настроить связь</b> — на экране появится <b>слово стрима</b>. "
                 "Пришли это слово мне.",
        "no_stream": "Не нашёл стрим в эфире со словом <b>{word}</b>. Проверь слово на экране стрима — "
                     "оно появляется после команды <b>настроить связь</b> в чате.",
        "ask_nick": "Стрим найден ✅ Пришли свой ник в TikTok (например <code>@nickname</code>) или ссылку на профиль.",
        "bad_nick": "Не понял ник. Пришли его так: <code>@nickname</code> или ссылкой "
                    "<code>https://www.tiktok.com/@nickname</code>.",
        "key": "Твой ключ:\n\n<code>{key}</code>\n\nСкопируй и отправь его в чат стрима со своего аккаунта "
               "<b>@{tt}</b>. Ключ действует 15 минут.",
        "done": "✅ Готово! Аккаунт <b>@{tt}</b> подтверждён.",
        "wrong": "Ключ отправил аккаунт <b>@{who}</b>, а ты указал <b>@{tt}</b>. Отправь ключ в чат стрима "
                 "со своего аккаунта <b>@{tt}</b>.",
        "owner_ok": "👑 Ты владелец игры <b>{game}</b>: буду присылать сюда каждую привязку зрителей.",
        "owner_bad": "Код владельца не подошёл или истёк.",
        "superadmin": "🛡 Ты суперадмин бота: буду присылать сюда каждую привязку во всех играх.",
    },
    "en": {
        "start": "Hi! I connect you with your TikTok account so you get messages from the stream game.\n\n"
                 "Type <b>link up</b> in the stream chat - the <b>stream word</b> appears on screen. Send me that word.",
        "no_stream": "No live stream with the word <b>{word}</b>. Check the word on the stream screen - "
                     "it appears after the <b>link up</b> command in the chat.",
        "ask_nick": "Stream found ✅ Send your TikTok username (like <code>@nickname</code>) or a link to your profile.",
        "bad_nick": "I didn't get the username. Send it like <code>@nickname</code> or "
                    "<code>https://www.tiktok.com/@nickname</code>.",
        "key": "Your key:\n\n<code>{key}</code>\n\nCopy it and send it in the stream chat from your account "
               "<b>@{tt}</b>. The key is valid for 15 minutes.",
        "done": "✅ Done! Account <b>@{tt}</b> confirmed.",
        "wrong": "The key was sent by <b>@{who}</b>, but you gave <b>@{tt}</b>. Send the key in the stream chat "
                 "from your account <b>@{tt}</b>.",
        "owner_ok": "👑 You own the game <b>{game}</b>: every viewer link will be reported here.",
        "owner_bad": "The owner code is wrong or expired.",
        "superadmin": "🛡 You are the bot's superadmin: every link in every game will be reported here.",
    },
}
