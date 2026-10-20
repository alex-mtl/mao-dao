"""One DynamoDB table, key "pk" (string), expiring items carry "ttl" (epoch seconds, DynamoDB TTL attribute).
pk prefixes: GAME#<sha256 of game key>, WORD#<stream word>, FLOW#<tg id>, KEY#<code>, TT#<tiktok id>, TG#<tg id>.
Tests swap the backend for MemoryTable."""

import os
import time
from decimal import Decimal

TABLE = os.getenv("TABLE", "tiktok-tg-bot")
_table = None


def table():
    global _table
    if _table is None:
        import boto3
        _table = DynamoTable(boto3.resource("dynamodb").Table(TABLE))
    return _table


def use(backend):
    global _table
    _table = backend


def get(pk):
    item = table().get(pk)
    if item and item.get("ttl") and item["ttl"] <= time.time():
        return None                      # DynamoDB deletes expired items lazily
    return item


def put(pk, data, ttl=None):
    item = dict(data, pk=pk)
    if ttl:
        item["ttl"] = int(ttl)
    table().put(item)


def delete(pk):
    table().delete(pk)


def append(pk, field, value):
    """add value to the list field (created if missing), atomically"""
    table().append(pk, field, value)


def claim(pk, data, ttl, now):
    """put only if the item is absent or expired; True if claimed"""
    return table().put_if_free(dict(data, pk=pk, ttl=int(ttl)), int(now))


def _plain(v):
    if isinstance(v, Decimal):
        return int(v) if v == int(v) else float(v)
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_plain(x) for x in v]
    return v


class DynamoTable:
    def __init__(self, t):
        self.t = t

    def get(self, pk):
        item = self.t.get_item(Key={"pk": pk}).get("Item")
        return _plain(item) if item else None

    def put(self, item):
        self.t.put_item(Item=item)

    def delete(self, pk):
        self.t.delete_item(Key={"pk": pk})

    def append(self, pk, field, value):
        self.t.update_item(Key={"pk": pk}, UpdateExpression="SET #f = list_append(if_not_exists(#f, :e), :v)",
                           ExpressionAttributeNames={"#f": field},
                           ExpressionAttributeValues={":e": [], ":v": [value]})

    def put_if_free(self, item, now):
        try:
            self.t.put_item(Item=item, ConditionExpression="attribute_not_exists(pk) OR #t <= :now",
                            ExpressionAttributeNames={"#t": "ttl"}, ExpressionAttributeValues={":now": now})
            return True
        except self.t.meta.client.exceptions.ConditionalCheckFailedException:
            return False


class MemoryTable:
    def __init__(self):
        self.items = {}

    def get(self, pk):
        return dict(self.items[pk]) if pk in self.items else None

    def put(self, item):
        self.items[item["pk"]] = dict(item)

    def delete(self, pk):
        self.items.pop(pk, None)

    def append(self, pk, field, value):
        self.items.setdefault(pk, {"pk": pk}).setdefault(field, []).append(value)

    def put_if_free(self, item, now):
        cur = self.items.get(item["pk"])
        if cur and cur.get("ttl", now + 1) > now:
            return False
        self.put(item)
        return True
