# tiktok-clips tools (copy)

Copies of the scripts from the owner's PC folder `C:\projects\claude\tiktok-clips\tools` (that folder is not a git repo).
The working copy stays there; keep both in step.

- `hard-round.js` — "hard round" clip + 3:4 cover from the round's structure, no AI (the list of host remarks to tick:
  `--list`, then `--pick 1,2,3`). Header of the file has the usage. Set `TIKTOK_CLIPS` to the tiktok-clips folder when
  running from here (it holds `input/<stream>.mp4` and `work/<stream>/transcript/`).
- `render-clips.js`, `subtitle-chunks.js` — the clip renderer it calls (effects, subtitles, CTA, freeze plate).
