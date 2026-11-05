"""One DynamoDB table "tg-hub", key pk (S) + sk (S); expiring items carry "ttl" (epoch seconds). Layout: handler.py.
Tests swap the backend for MemoryTable."""

import os
from decimal import Decimal

TABLE = os.getenv("TABLE", "tg-hub")
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


def _plain(v):
    if isinstance(v, Decimal):
        return int(v) if v == int(v) else float(v)
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_plain(x) for x in v]
    return v


def _dynamo(v):
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

    def get(self, pk, sk):
        item = self.t.get_item(Key={"pk": pk, "sk": sk}).get("Item")
        return _plain(item) if item else None

    def put(self, item):
        self.t.put_item(Item=_dynamo(item))

    def put_new(self, item):
        """put only if absent; False if the item exists"""
        try:
            self.t.put_item(Item=_dynamo(item), ConditionExpression="attribute_not_exists(pk)")
            return True
        except self.t.meta.client.exceptions.ConditionalCheckFailedException:
            return False

    def add(self, pk, sk, field, n=1, ttl=None):
        """atomically add n to a number field (0 if missing); returns the new value"""
        expr, values = "ADD #f :n", {":n": n}
        if ttl:
            expr, values = expr + " SET #t = :t", dict(values, **{":t": int(ttl)})
        r = self.t.update_item(Key={"pk": pk, "sk": sk}, UpdateExpression=expr,
                               ExpressionAttributeNames=dict({"#f": field}, **({"#t": "ttl"} if ttl else {})),
                               ExpressionAttributeValues=values, ReturnValues="UPDATED_NEW")
        return int(r["Attributes"][field])

    def update(self, pk, sk, fields):
        """set the given fields (merge into the item)"""
        names = {f"#k{i}": k for i, k in enumerate(fields)}
        values = {f":v{i}": _dynamo(v) for i, v in enumerate(fields.values())}
        expr = "SET " + ", ".join(f"#k{i} = :v{i}" for i in range(len(fields)))
        self.t.update_item(Key={"pk": pk, "sk": sk}, UpdateExpression=expr,
                           ExpressionAttributeNames=names, ExpressionAttributeValues=values)

    def query(self, pk, after=None, before=None, limit=None, desc=False):
        """items of pk with after < sk < before, sk ascending (desc: descending), at most limit"""
        from boto3.dynamodb.conditions import Key
        cond = Key("pk").eq(pk)
        if after is not None and before is not None:
            cond &= Key("sk").between(after, before)
        elif after is not None:
            cond &= Key("sk").gt(after)
        elif before is not None:
            cond &= Key("sk").lt(before)
        out, kw = [], {"KeyConditionExpression": cond, "ScanIndexForward": not desc}
        while True:
            if limit:                    # read only what is needed (+2 for the excluded bounds): reads cost capacity
                kw["Limit"] = limit - len(out) + 2
            r = self.t.query(**kw)
            out += [_plain(i) for i in r.get("Items", []) if i["sk"] != after and i["sk"] != before]
            if "LastEvaluatedKey" not in r or (limit and len(out) >= limit):
                return out[:limit] if limit else out
            kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]


class MemoryTable:
    def __init__(self):
        self.items = {}

    def get(self, pk, sk):
        item = self.items.get((pk, sk))
        return dict(item) if item else None

    def put(self, item):
        self.items[(item["pk"], item["sk"])] = dict(item)

    def put_new(self, item):
        if (item["pk"], item["sk"]) in self.items:
            return False
        self.put(item)
        return True

    def add(self, pk, sk, field, n=1, ttl=None):
        item = self.items.setdefault((pk, sk), {"pk": pk, "sk": sk})
        item[field] = item.get(field, 0) + n
        if ttl:
            item["ttl"] = int(ttl)
        return item[field]

    def update(self, pk, sk, fields):
        self.items.setdefault((pk, sk), {"pk": pk, "sk": sk}).update(fields)

    def query(self, pk, after=None, before=None, limit=None, desc=False):
        out = [dict(v) for (p, s), v in sorted(self.items.items(), reverse=desc)
               if p == pk and (after is None or s > after) and (before is None or s < before)]
        return out[:limit] if limit else out
