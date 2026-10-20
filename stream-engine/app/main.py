"""Entry point: python -m app

One process serves every room (streamer) of the platform. The platform creates, starts and stops
rooms through /internal/*; rooms that were running start again after a restart of the process.
DEV_ROOMS=N creates N simulated rooms with fixed tokens for local testing (dev1 / view1, dev2 / view2...)."""

import asyncio
import os
import sys

import uvicorn

from . import config
from .rooms import RoomManager
from .server import create_app


async def run():
    manager = RoomManager(config.DATA_DIR)
    for i in range(1, config.DEV_ROOMS + 1):
        rid = f"dev{i}"
        if rid not in manager.rooms:
            manager.upsert(rid, {"simulate": True, "control_token": f"dev{i}", "overlay_token": f"view{i}",
                                 "tg_key": config.TG_GAME_KEY})       # lets the ranker Lambdas answer
        manager.rooms[rid].start()
        print(f"[dev] room {rid}: menu http://localhost:{config.PORT}{config.BASE_PATH}/r/dev{i}/ "
              f"overlay http://localhost:{config.PORT}{config.BASE_PATH}/r/view{i}/guess/")
    manager.restore()
    server = uvicorn.Server(uvicorn.Config(create_app(manager), host=config.HOST, port=config.PORT,
                                           log_level="warning", ws_ping_interval=20))
    print(f"[engine] {len(manager.rooms)} rooms, listening on {config.HOST}:{config.PORT}")
    try:
        await server.serve()                       # returns on SIGTERM / Ctrl+C
    finally:
        # stop taking events, final save, remember which rooms ran (they start again after a restart)
        await manager.stop_all()
        print("stopped, state saved.")
        sys.stdout.flush()
        os._exit(0)                                # right away: the TikTok clients can keep the loop alive


def main():
    from .logfile import install
    install(config.DATA_DIR)                     # the log also goes to data/logs/YYYY-MM-DD.log
    asyncio.run(run())
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
