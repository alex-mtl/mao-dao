"""One DynamoDB table, key "pk" (string), expiring items carry "ttl" (epoch seconds, DynamoDB TTL attribute).
pk prefixes: GAME#<sha256 of game key>, WORD#<stream word>, FLOW#<tg id>, KEY#<code>, TT#<tiktok id>, TG#<tg id>.
Tests swap the backend for MemoryTable."""

import copy
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


def update(pk, changes, expect=None):
    """set the fields in changes, only if the item exists and each field in expect has that value (a tuple:
    one of these values); True if written. Two writers can never undo each other's change this way."""
    return table().update(pk, changes, expect or {})


def delete_if(pk, expect=None):
    """delete only if the item exists and matches expect (as in update); True if deleted"""
    return table().delete_if(pk, expect or {})


def set_add(pk, field, value):
    """add a string to the set field (created if missing), atomically"""
    table().set_op("ADD", pk, field, value)


def set_remove(pk, field, value):
    table().set_op("DELETE", pk, field, value)


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


def _dynamo(v):
    """DynamoDB takes no Python floats: Decimal instead (read back as float by _plain)"""
    if isinstance(v, float):
        return Decimal(str(v))
    if isinstance(v, dict):
        return {k: _dynamo(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_dynamo(x) for x in v]
    return v


class DynamoTable:
    def __init__(self, t):
        self.t = t

    def get(self, pk):
        item = self.t.get_item(Key={"pk": pk}).get("Item")
        return _plain(item) if item else None

    def put(self, item):
        self.t.put_item(Item=_dynamo(item))

    def delete(self, pk):
        self.t.delete_item(Key={"pk": pk})

    def append(self, pk, field, value):
        self.t.update_item(Key={"pk": pk}, UpdateExpression="SET #f = list_append(if_not_exists(#f, :e), :v)",
                           ExpressionAttributeNames={"#f": field},
                           ExpressionAttributeValues={":e": [], ":v": [_dynamo(value)]})

    def put_if_free(self, item, now):
        try:
            self.t.put_item(Item=_dynamo(item), ConditionExpression="attribute_not_exists(pk) OR #t <= :now",
                            ExpressionAttributeNames={"#t": "ttl"}, ExpressionAttributeValues={":now": now})
            return True
        except self.t.meta.client.exceptions.ConditionalCheckFailedException:
            return False

    @staticmethod
    def _cond(expect, names, values):
        names["#pk"] = "pk"
        conds = ["attribute_exists(#pk)"]
        for n, (k, v) in enumerate(expect.items()):
            names[f"#e{n}"] = k
            vs = v if isinstance(v, (list, tuple)) else [v]
            values.update({f":e{n}_{m}": _dynamo(x) for m, x in enumerate(vs)})
            conds.append(f"#e{n} IN ({', '.join(f':e{n}_{m}' for m in range(len(vs)))})")
        return " AND ".join(conds)

    def _try(self, call, **kw):
        if not kw.get("ExpressionAttributeValues"):
            kw.pop("ExpressionAttributeValues", None)
        try:
            call(**kw)
            return True
        except self.t.meta.client.exceptions.ConditionalCheckFailedException:
            return False

    def update(self, pk, changes, expect):
        names, values = {}, {}
        for n, (k, v) in enumerate(changes.items()):
            names[f"#c{n}"], values[f":c{n}"] = k, _dynamo(v)
        cond = self._cond(expect, names, values)
        return self._try(self.t.update_item, Key={"pk": pk}, ConditionExpression=cond,
                         UpdateExpression="SET " + ", ".join(f"#c{n} = :c{n}" for n in range(len(changes))),
                         ExpressionAttributeNames=names, ExpressionAttributeValues=values)

    def delete_if(self, pk, expect):
        names, values = {}, {}
        cond = self._cond(expect, names, values)
        return self._try(self.t.delete_item, Key={"pk": pk}, ConditionExpression=cond,
                         ExpressionAttributeNames=names, ExpressionAttributeValues=values)

    def set_op(self, op, pk, field, value):
        self.t.update_item(Key={"pk": pk}, UpdateExpression=f"{op} #f :v",
                           ExpressionAttributeNames={"#f": field}, ExpressionAttributeValues={":v": {value}})


class MemoryTable:
    def __init__(self):
        self.items = {}

    def get(self, pk):
        return copy.deepcopy(self.items[pk]) if pk in self.items else None   # a copy, like a real read

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

    def _matches(self, pk, expect):
        cur = self.items.get(pk)
        return cur is not None and all(cur.get(k) in (v if isinstance(v, (list, tuple)) else [v])
                                       for k, v in expect.items())

    def update(self, pk, changes, expect):
        if not self._matches(pk, expect):
            return False
        self.items[pk].update(copy.deepcopy(changes))
        return True

    def delete_if(self, pk, expect):
        if not self._matches(pk, expect):
            return False
        del self.items[pk]
        return True

    def set_op(self, op, pk, field, value):
        s = self.items.setdefault(pk, {"pk": pk}).setdefault(field, set())
        s.add(value) if op == "ADD" else s.discard(value)
        if not s:
            del self.items[pk][field]
