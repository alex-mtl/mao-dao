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


def send(chat, text):
    if sent is not None:
        sent.append((chat, text))
        return
    try:
        call("sendMessage", chat_id=chat, text=text, parse_mode="HTML", disable_web_page_preview=True)
    except Exception as e:
        print(f"send error: {type(e).__name__}")


def bot_name():
    if "bot_name" not in _params:
        try:
            _params["bot_name"] = call("getMe")["result"]["username"]
        except Exception as e:
            print(f"getMe error: {type(e).__name__}")
            return ""
    return _params["bot_name"]
