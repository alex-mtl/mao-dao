"""HTTP + WebSocket API and pages of the stream engine (many rooms in one process).

Internal API for the platform (Laravel), header X-Internal-Secret = INTERNAL_SECRET:
  GET    /internal/rooms                     status of every room
  PUT    /internal/rooms/{id}                create / update: username, lang, euler_key, overlay_token,
                                             control_token, simulate, tg_key  -> status + tokens + links
  POST   /internal/rooms/{id}/start|stop
  POST   /internal/rooms/{id}/settings       {game, options} and/or {lang}; {active} switches the game
  DELETE /internal/rooms/{id}                (its data folder stays)
  GET    /internal/rooms/{id}/options        games, their options and values (for the platform's form)

A room's own pages, by token (the link is the key; nginx publishes the engine under BASE_PATH):
  /r/{control_token}/...   everything: the menu, settings, debug, the game pages
  /r/{overlay_token}/...   only what TikTok LIVE Studio needs: game pages, state, websocket
    GET  <game>/             page (battle, guess, streamer)    GET  api/state?game=&since=&fsince=
    WS   ws                  pushes {active, game, state, events}
Pages use relative addresses; the engine adds <base href=".../r/{token}/"> to every page it serves.
"""

import hashlib
import os
import secrets

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response

from . import config
from .context import current_room
from .games.base import Viewer
from .room_prefs import GIFT_ACTIONS, GIFT_MIN_COINS, catalog

WEB = os.path.join(os.path.dirname(__file__), "web")
CONTROL_ONLY = ("", "index.html", "debug", "demo")   # the menu and debug pages need the control token


def web_version():
    """Hash of all page files: open overlays reload themselves when it changes."""
    h = hashlib.sha1()
    for root, _, files in sorted(os.walk(WEB)):
        for f in sorted(files):
            with open(os.path.join(root, f), "rb") as fh:
                h.update(f.encode() + fh.read())
    return h.hexdigest()[:12]


def tt_bat(url):
    """Windows launcher: Chrome as a bare 9:16 app window with sound allowed, on the TT mode page."""
    chrome = "\\Google\\Chrome\\Application\\chrome.exe"
    return "\r\n".join([
        "@echo off",
        "rem Live Games - TT mode: a Chrome window without tabs/toolbars, 9:16, sound without a click",
        f"set URL={url}",
        f"set CH=%ProgramFiles%{chrome}",
        f'if not exist "%CH%" set CH=%ProgramFiles(x86)%{chrome}',
        f'if not exist "%CH%" set CH=%LocalAppData%{chrome}',
        'start "" "%CH%" --app=%URL% --window-size=540,960 --autoplay-policy=no-user-gesture-required'
        ' --user-data-dir="%LocalAppData%\\LiveGamesTT"',
        "",
    ])


def room_base(token):
    return f"{config.BASE_PATH}/r/{token}/"


def page(path, token):
    """an HTML page with <base href> to the room, so its relative addresses stay inside the room"""
    with open(path, encoding="utf-8") as f:
        html = f.read()
    return HTMLResponse(html.replace("<head>", f'<head>\n<base href="{room_base(token)}">', 1))


def create_app(manager):
    app = FastAPI(title="Guess the Word stream engine", docs_url=None, redoc_url=None)
    version = web_version()

    @app.middleware("http")
    async def no_cache(request, call_next):
        resp = await call_next(request)
        resp.headers["Cache-Control"] = "no-cache"   # always revalidate -> never a stale overlay
        return resp

    def internal(req: Request):
        if not config.INTERNAL_SECRET or not secrets.compare_digest(
                req.headers.get("x-internal-secret", ""), config.INTERNAL_SECRET):
            raise HTTPException(403, "forbidden")

    def room_of(token, need_control=False):
        room, kind = manager.by_token(token)
        if not room or (need_control and kind != "control"):
            raise HTTPException(404, "not found")
        current_room.set(room.id)                      # this request's log lines say whose they are
        hub = room.ensure_hub()
        hub.web_version = version
        return room, kind, hub

    def info(room):
        return dict(room.status(), overlay_token=room.cfg["overlay_token"],
                    control_token=room.cfg["control_token"],
                    overlay_url=room_base(room.cfg["overlay_token"]) + "guess/?tt=1&alpha=1",
                    control_url=room_base(room.cfg["control_token"]))

    def apply_settings(hub, body):
        if body.get("game") in hub.games or body.get("game") in ("global", "toasts", "gifts"):
            hub.set_options(body["game"], body.get("options") or {})
        if "lang" in body:
            if body["lang"] not in config.LANGUAGES:
                raise HTTPException(400, "unknown language")
            hub.set_lang(body["lang"])
        if body.get("active"):
            if body["active"] not in hub.games:
                raise HTTPException(404, "unknown game")
            hub.set_active(body["active"])
        return {"lang": hub.lang, "options": hub.options(), "active": hub.active}

    def games_info(hub, room):
        return {"active": hub.active, "games": hub.menu(), "lang": hub.lang,
                "languages": config.LANGUAGES, "options": hub.options(),
                "global": {"options": hub.global_settings.schema(), "values": hub.global_settings.values()},
                "toasts": {"schema": hub.toasts.schema(), "values": hub.toasts.values()},
                "gifts": {"actions": GIFT_ACTIONS, "min": GIFT_MIN_COINS, "values": hub.gift_rules.values(),
                          "catalog": catalog().list()},
                "overlay": room_base(room.cfg["overlay_token"]), "running": room.running}

    # ------------------------------------------------------------------ process
    @app.get("/health")
    def health():
        rss = 0
        try:
            with open("/proc/self/status") as f:
                rss = next(int(l.split()[1]) // 1024 for l in f if l.startswith("VmRSS"))
        except Exception:
            pass
        return {"ok": True, "rooms": len(manager.rooms),
                "running": sum(1 for r in manager.rooms.values() if r.running), "rss_mb": rss}

    # ------------------------------------------------------------------ internal API (the platform)
    @app.get("/internal/rooms")
    def rooms_list(req: Request):
        internal(req)
        return {"rooms": [info(r) for r in manager.rooms.values()]}

    @app.put("/internal/rooms/{rid}")
    async def rooms_put(rid: str, req: Request):
        internal(req)
        if not rid.replace("-", "").replace("_", "").isalnum() or len(rid) > 40:
            raise HTTPException(400, "bad room id")
        return info(manager.upsert(rid, await req.json()))

    @app.get("/internal/rooms/{rid}/options")
    def rooms_options(rid: str, req: Request):
        internal(req)
        room = manager.rooms.get(rid)
        if not room:
            raise HTTPException(404, "no such room")
        return games_info(room.ensure_hub(), room)

    @app.post("/internal/rooms/{rid}/{action}")
    async def rooms_action(rid: str, action: str, req: Request):
        internal(req)
        room = manager.rooms.get(rid)
        if not room:
            raise HTTPException(404, "no such room")
        current_room.set(rid)
        if action == "start":
            await manager.start(rid)
        elif action == "stop":
            await manager.stop(rid)
        elif action == "settings":
            apply_settings(room.ensure_hub(), await req.json())
        else:
            raise HTTPException(404, "unknown action")
        return info(room)

    @app.delete("/internal/rooms/{rid}")
    async def rooms_delete(rid: str, req: Request):
        internal(req)
        await manager.delete(rid)
        return {"ok": True}

    # ------------------------------------------------------------------ a room's API (by token)
    @app.get("/r/{token}/api/games")
    def games(token: str):
        room, _, hub = room_of(token, need_control=True)
        return games_info(hub, room)

    @app.post("/r/{token}/api/settings")
    async def settings(token: str, req: Request):
        _, _, hub = room_of(token, need_control=True)
        return apply_settings(hub, await req.json())

    @app.get("/r/{token}/api/viewers")
    def viewers(token: str):
        _, _, hub = room_of(token, need_control=True)
        return {"viewers": hub.viewers()}

    @app.post("/r/{token}/api/action")
    async def manual_action(token: str, req: Request):
        """the room page: do a gift's action for a viewer of the stream, now - {action, id}"""
        _, _, hub = room_of(token, need_control=True)
        body = await req.json()
        if body.get("action") not in GIFT_ACTIONS:
            raise HTTPException(400, "unknown action")
        if not hub.manual_action(body["action"], str(body.get("id") or "")):
            raise HTTPException(409, "not possible now (no such viewer, or not during a round)")
        return {"ok": True}

    @app.get("/r/{token}/api/monitor")
    def monitor(token: str):
        """the room page's monitor of the guess game: the round now, this stream's rounds, what's planned"""
        _, _, hub = room_of(token, need_control=True)
        g = hub.games.get("guess")
        return dict(g.monitor(), active=hub.active) if g else {"active": hub.active}

    @app.post("/r/{token}/api/control")
    async def control(token: str, req: Request):
        """the host's command for the guess game: {cmd, ...} - pause, extend, skip, the word queue..."""
        _, _, hub = room_of(token, need_control=True)
        g = hub.games.get("guess")
        body = await req.json()
        r = g.control(str(body.get("cmd") or ""), body) if g else False
        if isinstance(r, dict):
            if not r.get("ok"):
                raise HTTPException(409, r.get("error") or "not possible")
        elif not r:
            raise HTTPException(409, "not possible now")
        g.save()
        return {"ok": True}

    @app.post("/r/{token}/api/active")
    async def set_active(token: str, req: Request):
        _, _, hub = room_of(token, need_control=True)
        name = (await req.json()).get("game")
        if name not in hub.games:
            raise HTTPException(404, "unknown game")
        hub.set_active(name)
        return {"active": hub.active}

    @app.get("/r/{token}/api/state")
    def api_state(token: str, game: str | None = None, since: int | None = None, fsince: int | None = None):
        _, _, hub = room_of(token)
        name = game if game in hub.games else hub.active
        return hub.message(name, since, fsince)

    @app.post("/r/{token}/api/client-log")
    async def client_log(token: str, req: Request):
        """Pages report what happens in the browser (alerts on/off, speech errors)."""
        room_of(token)
        try:
            d = await req.json()
            print(f"[client] {str(d.get('page'))[:40]}: {str(d.get('msg'))[:2000]}")
        except Exception:
            pass
        return {"ok": True}

    @app.post("/r/{token}/reset")
    def reset(token: str):
        _, _, hub = room_of(token, need_control=True)
        hub.game.new_session()
        print(f"[hub] manual reset of {hub.active}")
        return {"ok": True}

    @app.post("/r/{token}/api/debug/{action}")
    async def debug(token: str, action: str, req: Request):
        _, _, hub = room_of(token, need_control=True)
        if not config.DEBUG_CONTROLS:
            raise HTTPException(403, "debug controls disabled (DEBUG_CONTROLS=0)")
        try:
            params = await req.json()
        except Exception:
            params = {}
        params = params if isinstance(params, dict) else {}
        name = (params.get("name") or "Tester")[:30]
        if action == "chat":                         # as if it came from TikTok: feed + active game
            hub.comment(Viewer(name.lower(), name, ""), params.get("text") or params.get("word") or "hello!")
            return {"ok": True}
        if action == "like":
            hub.like(Viewer(name.lower(), name, ""), int(params.get("n") or 10))
            return {"ok": True}
        if action == "balloon":
            hub.like(Viewer(name.lower(), name, ""), hub.global_settings.get("LIKES_PER_BALLOON"))
            return {"ok": True}
        if action == "join":
            hub.join(Viewer(name.lower(), name, ""))
            return {"ok": True}
        if action == "gift":
            hub.gift(Viewer(name.lower(), name, ""), params.get("gift") or "Rose", 1)
            return {"ok": True}
        return JSONResponse(hub.game.debug(action, params))

    @app.post("/r/{token}/api/tg/host-link")
    async def tg_host_link(token: str):
        """One-time link that makes whoever opens it in the messenger the host of this game (menu only)."""
        _, _, hub = room_of(token, need_control=True)
        if not hub.tg:
            raise HTTPException(404, "bot not configured or the room is not running")
        r = await hub.tg.api("/game/host_code")
        if not r.get("link"):
            raise HTTPException(502, "bot unavailable")
        return r

    @app.get("/r/{token}/api/tt.bat")
    def tt_launcher(token: str, req: Request):
        room, _, _ = room_of(token, need_control=True)
        url = f"{req.url.scheme}://{req.headers.get('host', 'localhost')}" \
              f"{room_base(room.cfg['overlay_token'])}guess/?tt=1"
        return Response(tt_bat(url), media_type="application/octet-stream",
                        headers={"Content-Disposition": 'attachment; filename="LiveGames-TT.bat"'})

    @app.websocket("/r/{token}/ws")
    async def ws(websocket: WebSocket, token: str):
        room, _ = manager.by_token(token)
        if not room:
            await websocket.close(code=4404)
            return
        hub = room.ensure_hub()
        hub.web_version = version
        await websocket.accept()
        hub.clients.add(websocket)
        try:
            await websocket.send_json(hub.message(hub.active))      # snapshot, no event replay
            while True:
                await websocket.receive_text()                       # keepalive pings
        except WebSocketDisconnect:
            pass
        finally:
            hub.clients.discard(websocket)

    # ------------------------------------------------------------------ a room's pages and files
    @app.get("/r/{token}")
    def room_root(token: str):
        return RedirectResponse(room_base(token))

    @app.get("/r/{token}/{path:path}")
    def room_file(token: str, path: str, request: Request):
        _, kind, _ = room_of(token)
        clean = path.strip("/")
        if clean.split("/")[0] in CONTROL_ONLY and kind != "control":
            raise HTTPException(404, "not found")
        web = os.path.realpath(WEB)
        full = os.path.realpath(os.path.join(web, clean))
        if full != web and not full.startswith(web + os.sep):
            raise HTTPException(404, "not found")
        if os.path.isdir(full):
            if clean and not path.endswith("/"):           # keep ?tt=1&alpha=1 (the Studio mode)
                query = f"?{request.url.query}" if request.url.query else ""
                return RedirectResponse(room_base(token) + clean + "/" + query)
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            raise HTTPException(404, "not found")
        if full.endswith(".html"):
            return page(full, token)
        return FileResponse(full)

    return app
