"""Telegram Bot API over urllib (no dependencies). Token and webhook secret come from SSM Parameter Store
(SecureString /tiktok-tg-bot/token and /tiktok-tg-bot/webhook-secret), read once per cold start."""

import json
import os
import urllib.request

PREFIX = os.getenv("SSM_PREFIX", "/tiktok-tg-bot/")
_params = {}
sent = None                  # tests set a list here: messages are collected instead of sent


def param(name):
    if name not in _params:
        import boto3
        _params[name] = boto3.client("ssm").get_parameter(Name=PREFIX + name, WithDecryption=True)["Parameter"]["Value"]
    return _params[name]


def webhook_secret():
    return param("webhook-secret")


def call(method, **data):
    req = urllib.request.Request(f"https://api.telegram.org/bot{param('token')}/{method}",
                                 data=json.dumps(data).encode(), headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


markups = []                 # tests: (chat, inline keyboard) of messages with buttons


def buttons(rows):
    """[[(label, callback data), ...], ...] -> inline keyboard markup"""
    return {"inline_keyboard": [[{"text": t, "callback_data": d} for t, d in row] for row in rows]}


def send(chat, text, markup=None):
    if sent is not None:
        sent.append((chat, text))
        if markup:
            markups.append((chat, markup))
        return
    try:
        data = dict(chat_id=chat, text=text, parse_mode="HTML", disable_web_page_preview=True)
        if markup:
            data["reply_markup"] = markup
        call("sendMessage", **data)
    except Exception as e:
        print(f"send error: {type(e).__name__}")


def answer(callback_id, text=""):
    """confirm a button press (the button stops spinning)"""
    if sent is not None:
        return
    try:
        call("answerCallbackQuery", callback_query_id=callback_id, text=text)
    except Exception as e:
        print(f"answer error: {type(e).__name__}")


def edit(chat, message_id, text):
    """replace a message's text and drop its buttons"""
    if sent is not None:
        sent.append((chat, text))
        return
    try:
        call("editMessageText", chat_id=chat, message_id=message_id, text=text, parse_mode="HTML")
    except Exception as e:
        print(f"edit error: {type(e).__name__}")


def bot_name():
    if "bot_name" not in _params:
        try:
            _params["bot_name"] = call("getMe")["result"]["username"]
        except Exception as e:
            print(f"getMe error: {type(e).__name__}")
            return ""
    return _params["bot_name"]
