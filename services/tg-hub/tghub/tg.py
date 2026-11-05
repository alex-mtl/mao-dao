"""Telegram Bot API over urllib (no dependencies). The bot token and the webhook secret come from SSM Parameter Store
(SecureString /tg-hub/token, /tg-hub/webhook-secret), read once per cold start. Tests set `fake` to a function
(method, data) -> result and never reach the network."""

import json
import os
import urllib.error
import urllib.request

PREFIX = os.getenv("SSM_PREFIX", "/tg-hub/")
_params = {}
fake = None


class TgError(Exception):
    def __init__(self, description, code=None):
        super().__init__(description)
        self.description, self.code = description, code


def param(name):
    if name not in _params:
        import boto3
        _params[name] = boto3.client("ssm").get_parameter(Name=PREFIX + name, WithDecryption=True)["Parameter"]["Value"]
    return _params[name]


def bot_id():
    return int(param("token").split(":")[0])


def call(method, **data):
    """-> result; TgError with Telegram's description on a refusal"""
    if fake is not None:
        return fake(method, data)
    req = urllib.request.Request(f"https://api.telegram.org/bot{param('token')}/{method}",
                                 data=json.dumps(data).encode(), headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
        except ValueError:
            raise TgError(f"HTTP {e.code}", e.code)
    if not body.get("ok"):
        raise TgError(body.get("description", "error"), body.get("error_code"))
    return body["result"]


def download(file_path):
    """bytes of a file Telegram keeps (path from getFile)"""
    if fake is not None:
        return fake("download", {"file_path": file_path})
    with urllib.request.urlopen(f"https://api.telegram.org/file/bot{param('token')}/{file_path}", timeout=20) as r:
        return r.read()


def username():
    if "username" not in _params:
        _params["username"] = call("getMe")["username"]
    return _params["username"]
