"""TikTok LIVE battle events -> plain dicts for app/battles.py (no TikTokLive import here, so the tracker and its
tests never need the library; every field is read defensively because the proto changes between library versions).

Two events carry a battle:
  LinkMicBattleEvent   the battle's life: INVITE / ACCEPT / OPEN (start) / FINISH, anchors, the result of each side
  LinkMicArmiesEvent   the score of each side during the battle, with the top gifters of each side

The side is the anchor's numeric user id; the tracker knows which one is the room's host (set_host)."""


def enum_name(value):
    """'FINISH' for an enum member (or its string/number form), '' when unknown"""
    name = getattr(value, "name", None)
    return str(name if name is not None else (value if value is not None else "")).upper()


def _int(value, default=0):
    try:
        return int(value or 0)
    except Exception:
        return default


def _text(value):
    return str(value or "").strip()


def _items(mapping_or_list):
    """(key, value) pairs of a proto map (dict) or a repeated {key, value} wrapper list"""
    if not mapping_or_list:
        return []
    if hasattr(mapping_or_list, "items"):
        return list(mapping_or_list.items())
    out = []
    for w in mapping_or_list:
        out.append((getattr(w, "key", None), getattr(w, "value", None)))
    return out


def _settings(event):
    s = getattr(event, "battle_settings", None)
    return {
        "battle_id": _int(getattr(s, "battle_id", 0)) or _int(getattr(event, "battle_id", 0)),
        "channel_id": _int(getattr(s, "channel_id", 0)),
        "start_ms": _int(getattr(s, "start_time_ms", 0)),
        "duration": _int(getattr(s, "duration", 0)),
        "extra_sec": _int(getattr(s, "extra_duration_second", 0)),
        "status": enum_name(getattr(s, "status", None)),
        "type": enum_name(getattr(s, "battle_type", None)),
    }


def anchor_of(wrapper_value):
    """{id, name, handle, avatar} of a BattleUserInfo (user: BattleBaseUserInfo)"""
    u = getattr(wrapper_value, "user", None) or wrapper_value
    avatar = ""
    try:
        urls = getattr(getattr(u, "avatar_thumb", None), "url_list", None) or []
        avatar = next((x for x in urls if str(x).startswith("https://")), "")
    except Exception:
        pass
    return {
        "id": _text(getattr(u, "user_id_str", "") or getattr(u, "user_id", "") or getattr(u, "id_str", "") or getattr(u, "id", "")),
        "name": _text(getattr(u, "nickname", "")),
        "handle": _text(getattr(u, "display_id", "") or getattr(u, "unique_id", "")),
        "avatar": avatar,
    }


def battle_info(event):
    """LinkMicBattleEvent -> {kind: "battle", action, battle_id, channel_id, start_ms, duration, extra_sec, status,
    type, anchors: {id: {name, handle, avatar}}, results: {id: {result: WIN|LOSE|DRAW, score}}}"""
    info = _settings(event)
    anchors = {}
    for key, val in _items(getattr(event, "anchors_info", None)):
        a = anchor_of(val)
        aid = str(_int(key) or a["id"])
        if aid and aid != "0":
            anchors[aid] = {k: a[k] for k in ("name", "handle", "avatar")}
    results = {}
    for key, val in _items(getattr(event, "battle_result", None)):
        rid = str(_int(key) or _int(getattr(val, "user_id", 0)))
        if rid and rid != "0":
            results[rid] = {"result": enum_name(getattr(val, "result", None)), "score": _int(getattr(val, "score", 0))}
    scores = {}
    for key, val in _items(getattr(event, "armies", None)):       # the sides' scores may come with the battle too
        sid = str(_int(key))
        if sid != "0":
            scores[sid] = _int(getattr(val, "hostscore", 0))
    info.update(kind="battle", action=enum_name(getattr(event, "action", None)), anchors=anchors, results=results,
                scores=scores)
    return info


def armies_info(event):
    """LinkMicArmiesEvent -> {kind: "armies", battle_id, channel_id, reason, scores: {anchor id: points},
    supporters: {anchor id: [{id, name, score}]}}"""
    info = _settings(event)
    scores, supporters = {}, {}
    for key, val in _items(getattr(event, "armies", None)):
        sid = str(_int(key))
        if sid == "0":
            continue
        scores[sid] = _int(getattr(val, "hostscore", 0))
        people = []
        for u in getattr(val, "user_armies", None) or []:
            people.append({"id": _text(getattr(u, "user_id_str", "") or getattr(u, "user_id", "")),
                           "name": _text(getattr(u, "nickname", "")), "score": _int(getattr(u, "score", 0))})
        supporters[sid] = people
    info.update(kind="armies", reason=enum_name(getattr(event, "trigger_reason", None)), scores=scores,
                supporters=supporters)
    return info
