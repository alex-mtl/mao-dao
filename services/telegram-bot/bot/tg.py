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


temp = []                    # tests: (chat, text, seconds) of self-destructing messages


def send(chat, text, markup=None):
    """-> message id (None on error)"""
    if sent is not None:
        sent.append((chat, text))
        if markup:
            markups.append((chat, markup))
        return len(sent)
    try:
        data = dict(chat_id=chat, text=text, parse_mode="HTML", disable_web_page_preview=True)
        if markup:
            data["reply_markup"] = markup
        return call("sendMessage", **data)["result"]["message_id"]
    except Exception as e:
        print(f"send error: {type(e).__name__}")


def send_temp(chat, text, seconds=60):
    """a message that deletes itself: the bot invokes itself asynchronously to delete it later"""
    mid = send(chat, text)
    if sent is not None:
        temp.append((chat, text, seconds))
        return
    if not mid:
        return
    try:
        import boto3
        import os
        boto3.client("lambda").invoke(FunctionName=os.environ["AWS_LAMBDA_FUNCTION_NAME"], InvocationType="Event",
                                      Payload=json.dumps({"action": "delete_later", "chat": chat, "mid": mid,
                                                          "delay": seconds}).encode())
    except Exception as e:
        print(f"delete_later error: {type(e).__name__}")


def set_commands(commands, chat=None):
    """the menu of commands: for everyone (chat=None) or for one chat"""
    if sent is not None:
        markups.append((chat, {"commands": [c for c, _ in commands]}))
        return
    try:
        scope = {"type": "chat", "chat_id": chat} if chat else {"type": "default"}
        call("setMyCommands", commands=[{"command": c, "description": d} for c, d in commands], scope=scope)
    except Exception as e:
        print(f"menu error: {type(e).__name__}")


answers = []                 # tests: popup texts of button presses
deleted = []                 # tests: (chat, message id) of deleted messages


def answer(callback_id, text=""):
    """confirm a button press (the button stops spinning); text = a short popup, not kept in the chat"""
    if sent is not None:
        answers.append(text)
        return
    try:
        call("answerCallbackQuery", callback_query_id=callback_id, text=text)
    except Exception as e:
        print(f"answer error: {type(e).__name__}")


def delete(chat, message_id):
    if sent is not None:
        deleted.append((chat, message_id))
        return
    try:
        call("deleteMessage", chat_id=chat, message_id=message_id)
    except Exception as e:
        print(f"delete error: {type(e).__name__}")


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
