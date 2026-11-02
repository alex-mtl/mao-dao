"""Who is who on TikTok, for all rooms: the numeric user id (never changes) -> the @unique_id the games key
everything by (hint credits, boosts, wins, the Telegram link, the setter's word).

Since 2026-11-01 TikTok sends chat messages without the @unique_id (only the nickname and the numeric id), while
gifts, likes and joins still carry it. So every event's viewer goes through resolve(): an id known for its numeric
id replaces whatever the event brought. A viewer seen only in the chat so far gets their nickname as a stand-in id;
when their real @id shows up (a like, a gift, a join) the stand-in is renamed to it - renames() hands the rooms
the old -> new pairs, so their data is merged into one viewer, never kept twice. A changed @handle is renamed the
same way. lookup() finds the current id by any id the viewer ever had (an old handle, a stand-in).

Saved in DATA_DIR/identities.json: {"uids": {uid: {"id", "real"}}, "alias": {id lower: uid}, "renames": [[seq,
old, new]], "seq": n} - flushed by the hubs' saver (at most once a second)."""

import json
import os
import tempfile

from . import config

RENAMES_KEPT = 20000
AMBIGUOUS = "?"                                  # alias of a nickname several viewers have


class Identities:
    def __init__(self, path=None):
        self.path = path or os.path.join(config.DATA_DIR, "identities.json")
        d = {}
        try:
            with open(self.path, encoding="utf-8") as f:
                d = json.load(f) or {}
        except (OSError, ValueError):
            pass
        self.uids = d.get("uids") or {}              # numeric id -> {"id": current id, "real": from TikTok's @id}
        self.alias = d.get("alias") or {}            # every id a viewer ever had (lower case) -> numeric id
        self.renames = [tuple(r) for r in d.get("renames") or []]   # (seq, old id, new id)
        self.seq = int(d.get("seq") or 0)
        self.dirty = False
        if not d:
            self.backfill(os.path.join(os.path.dirname(self.path), "rooms"))

    REAL_KINDS = {"gift", "balloon", "plane", "snowball", "cake"}   # their viewer came from a like or a gift

    def backfill(self, rooms_dir):
        """once: who is who from every room's LIVE logs (rooms/*/lives/*.jsonl: {"uid", "id", "name"} of each viewer),
        in time order. An id is the real @id when it came with a like / gift or differs from the nickname (the chat's
        stand-in is the nickname itself; TikTok dropped the @id from some chat messages even before 2026-11-01).
        Every stand-in the rooms may keep data under becomes a rename to the viewer's id, so the rooms merge it."""
        import glob
        from datetime import datetime
        from types import SimpleNamespace
        seen = []
        for path in glob.glob(os.path.join(rooms_dir, "*", "lives", "*.jsonl")):
            try:
                with open(path, encoding="utf-8") as f:
                    for line in f:
                        try:
                            r = json.loads(line)
                            t = datetime.fromisoformat(r["t"])
                        except (ValueError, KeyError, TypeError):
                            continue
                        u = r.get("user")              # the event's own viewer (a winner's uid is looked up by id)
                        if isinstance(u, dict) and u.get("uid") and u.get("id"):
                            real = (r.get("type") in self.REAL_KINDS and not r.get("manual")) \
                                or str(u["id"]) != str(u.get("name") or u["id"])
                            seen.append((t, str(u["uid"]), str(u["id"]), real))
            except OSError:
                continue
        seen.sort(key=lambda x: x[0])
        stand_ins = {}                                   # nickname used as an id -> the numeric ids that used it
        for _, uid, vid, real in seen:
            self.resolve(SimpleNamespace(uid=uid, id=vid, guessed=not real))
            if not real:
                stand_ins.setdefault(vid.lower(), set()).add(uid)
        renamed = {r[1] for r in self.renames}
        for vid, uid, _real in {(vid, uid, real) for _, uid, vid, real in seen if not real}:
            now = self.uids[uid]["id"]
            # one viewer only ever had this nickname (two Mashas: whose data is it? left as it is)
            if now != vid and vid not in renamed and stand_ins[vid.lower()] == {uid} and \
                    self.alias.get(vid.lower()) in (None, uid):
                renamed.add(vid)
                self._rename(vid, now)
        self.dirty = True
        print(f"[ids] backfill: {len(self.uids)} viewers, {len(self.renames)} renames from {len(seen)} records")

    def resolve(self, v):
        """the viewer's current id into v.id (v.guessed: the event had no @id, v.id is the nickname)"""
        uid = str(getattr(v, "uid", "") or "")
        if not uid or not v.id:
            if v.id:
                v.id = self.lookup(v.id)
            return v
        known = self.uids.get(uid)
        guessed = getattr(v, "guessed", False)
        if known is None:
            vid = v.id if not guessed else self._stand_in(v.id, uid)
            if not guessed:
                self._evict(vid, uid)
            self.uids[uid] = {"id": vid, "real": not guessed}
            self._alias(vid, uid)
            self.dirty = True
        elif not guessed and known["id"] != v.id:     # the real @id: first time (a stand-in so far) or a new handle
            self._rename(known["id"], v.id)
            self._evict(v.id, uid)
            self.uids[uid] = {"id": v.id, "real": True}
            self._alias(v.id, uid)
        elif not guessed and not known["real"]:
            known["real"] = True
            self.dirty = True
        if guessed:                                      # the nickname finds them too - while nobody else has it
            owner = self.alias.get(v.id.lower())
            if owner is None:
                self._alias(v.id, uid)
            elif owner not in (uid, AMBIGUOUS) and self.uids.get(owner, {}).get("id", "").lower() != v.id.lower():
                self.alias[v.id.lower()] = AMBIGUOUS     # two viewers, one nickname: it finds nobody
                self.dirty = True
        v.id = self.uids[uid]["id"]
        return v

    def _evict(self, vid, uid):
        """vid is uid's real @id now: another viewer who had it as a stand-in (their nickname) gets a new one"""
        other = self.alias.get(vid.lower())
        o = self.uids.get(other) if other and other != uid else None
        if o and o["id"].lower() == vid.lower() and not o["real"]:
            o["id"] = f"{o['id']}~{other[-6:]}"
            self._alias(o["id"], other)

    def lookup(self, vid):
        """the current id of a viewer by any id they ever had; unknown ids come back as they are"""
        uid = self.alias.get(str(vid or "").strip().lstrip("@").lower())
        known = self.uids.get(uid) if uid else None
        return known["id"] if known else vid

    def renames_since(self, seq):
        return [r for r in self.renames if r[0] > seq]

    def _stand_in(self, nick, uid):
        """the nickname as the id until the real @id comes - unless it is someone else's id (theirs or a stand-in)"""
        owner = self.alias.get(nick.lower())
        return nick if owner in (None, uid) else f"{nick}~{uid[-6:]}"

    def _alias(self, vid, uid):
        if self.alias.get(vid.lower()) != uid:
            self.alias[vid.lower()] = uid
            self.dirty = True

    def _rename(self, old, new):
        self.seq += 1
        self.renames.append((self.seq, old, new))
        del self.renames[:-RENAMES_KEPT]
        self.dirty = True
        print(f"[ids] {old} -> {new}")

    def flush(self):
        if not self.dirty:
            return
        self.dirty = False
        data = {"uids": self.uids, "alias": self.alias, "renames": self.renames, "seq": self.seq}
        d = os.path.dirname(self.path) or "."
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix="identities.", suffix=".tmp", dir=d)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, self.path)


IDENTITIES = None


def identities():
    """One registry for the whole process (all rooms)."""
    global IDENTITIES
    if IDENTITIES is None:
        IDENTITIES = Identities()
    return IDENTITIES
