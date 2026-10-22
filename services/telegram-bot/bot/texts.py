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
        "owner_ok": "👑 Ты ведущий стрима <b>{word}</b>: буду присылать сюда каждую привязку зрителей.",
        "owner_new": "👑 У игры <b>{game}</b> новый ведущий: <a href=\"tg://user?id={tg}\">{who}</a>",
        "owner_bad": "Ссылка ведущего не подошла или истекла (действует 10 минут). Возьми новую в меню игры.",
        "superadmin": "🛡 Ты суперадмин бота: буду присылать сюда каждую привязку во всех играх.",
        "help_host": "🎬 <b>Для ведущего</b>\n<b>загадывает</b> [часть ника] или /pick — выбрать зрителя, который загадает слово.\n"
                     "<b>очередь</b> или /queue — загаданные слова по раундам (ответ исчезнет через минуту)\n"
                     "<b>раунд</b> или /round — текущий раунд: слово, кто загадал, участники, догадки, топ-20\n"
                     "<b>история</b> [N] или /history [N] — N прошлых раундов (по умолчанию 1, до 10)",
        "twins_games": "⚠️ Эфир <b>@{tt}</b> подключён к двум играм: <b>{a}</b> и <b>{b}</b>. Выключите лишнюю — "
                       "иначе слова, подсказки и очередь разойдутся по двум играм.",
        "twins_instances": "⚠️ Игра <b>{game}</b> запущена дважды (например, дома в Docker и на платформе). "
                           "Выключите лишнюю — иначе слова и очередь разойдутся.",
        "help_all": "/zagadka или <b>загадка</b> — загадать слово для игры (решает ведущий)\n"
                    "/hints или <b>подсказки</b> — сколько подсказок у тебя на счету\n"
                    "/game или <b>игра</b> [слово стрима] — переключиться на другой стрим",
        "ask_game": "Пришли слово стрима — оно появляется на экране после команды <b>настроить связь</b> в чате стрима.",
        "game_ok": "✅ Теперь ты играешь на стриме <b>{word}</b>.",
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
        "owner_ok": "👑 You are the host of the stream <b>{word}</b>: every viewer link will be reported here.",
        "owner_new": "👑 The game <b>{game}</b> has a new host: <a href=\"tg://user?id={tg}\">{who}</a>",
        "owner_bad": "The host link is wrong or expired (valid 10 minutes). Get a new one in the game menu.",
        "superadmin": "🛡 You are the bot's superadmin: every link in every game will be reported here.",
        "help_host": "🎬 <b>For the host</b>\n<b>загадывает</b> [part of a nick] or /pick - choose a viewer who picks the word.\n"
                     "/queue - the picked words by round (the answer disappears in a minute)\n"
                     "/round - the current round: the word, who picked it, players, guesses, top 20\n"
                     "/history [N] - the last N rounds (1 by default, up to 10)",
        "help_all": "/zagadka - offer a word for the game (the host decides)\n"
                    "/hints - how many hints you have on account\n"
                    "/game [stream word] - switch to another stream",
        "ask_game": "Send the stream word - it appears on screen after the <b>link up</b> command in the stream chat.",
        "game_ok": "✅ You now play on the stream <b>{word}</b>.",
    },
}
