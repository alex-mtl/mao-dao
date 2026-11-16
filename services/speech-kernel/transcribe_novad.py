# Kaggle script: streams WITHOUT the VAD (it clips the first word after a pause), with a filter for what Whisper makes up on
# non-speech ("Продолжение следует...", subtitles credits). Found 15.11.2026 on a piece of the 11.11 stream: no-VAD gives back the
# words the VAD cut ("Нина не боится...") and adds hallucinations on silence, which the filter below removes.
# Input (flat dataset): <id>__segments.csv (file,start,end) + <id>__part_XX.ogg for every stream <id>.
# Output in /kaggle/working/<id>/: transcript.json (filtered), transcript_raw.json (everything the model said, with no_speech / logprob
# per segment and probability per word), transcript.srt, transcript.txt, dropped.txt (what the filter removed). A stream whose
# transcript.json exists is skipped; transcript.json is written last.
import csv, glob, json, os, re, subprocess, sys, time

subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "faster-whisper"])
import numpy as np
import torch
from faster_whisper import WhisperModel

def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0

major, _ = torch.cuda.get_device_capability(0)
model = WhisperModel("large-v3", device="cuda", compute_type="float16" if major >= 7 else "float32")

def ts(x, sep=","):
    h, r = divmod(x, 3600); m, s = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d}{sep}{int(round((s % 1) * 1000)):03d}"

# what Whisper writes on music and silence (the Russian "subtitles" habit of its training data)
JUNK = re.compile(r"продолжение следует|субтитр|dimatorzok|редактор|корректор|спасибо за (просмотр|внимание)|подписывайтесь на канал|amara\.org", re.I)
NO_SPEECH = 0.8

def junk(seg):
    text = seg["text"].strip()
    if JUNK.search(text):
        return "phrase"
    if seg["no_speech"] > NO_SPEECH and seg["logprob"] < -0.3:
        return "no_speech"
    if seg["no_speech"] > 0.95:
        return "no_speech"
    return None

for seg_csv in sorted(glob.glob("/kaggle/input/**/*__segments.csv", recursive=True)):
    sid = os.path.basename(seg_csv)[: -len("__segments.csv")]
    base = os.path.dirname(seg_csv)
    out = f"/kaggle/working/{sid}"
    if os.path.exists(f"{out}/transcript.json"):
        continue
    parts = []
    with open(seg_csv) as f:
        for row in csv.reader(f):
            if row:
                parts.append((os.path.join(base, f"{sid}__{row[0]}"), float(row[1])))
    raw, t0 = [], time.time()
    for path, offset in parts:
        it, info = model.transcribe(load(path), language="ru", beam_size=5, vad_filter=False, no_speech_threshold=None,
                                    log_prob_threshold=None, word_timestamps=True, condition_on_previous_text=False,
                                    hallucination_silence_threshold=2.0)
        for s in it:
            raw.append({
                "start": round(s.start + offset, 2), "end": round(s.end + offset, 2), "text": s.text.strip(),
                "no_speech": round(s.no_speech_prob, 3), "logprob": round(s.avg_logprob, 3),
                "words": [{"w": w.word, "s": round(w.start + offset, 2), "e": round(w.end + offset, 2), "p": round(w.probability, 3)} for w in (s.words or [])],
            })
        print(f"{sid} {os.path.basename(path)}: {len(raw)} segments, {time.time() - t0:.0f}s", flush=True)
    os.makedirs(out, exist_ok=True)
    segments, dropped = [], []
    for s in raw:
        why = junk(s)
        (dropped if why else segments).append({**s, "why": why} if why else s)
    with open(f"{out}/transcript_raw.json", "w", encoding="utf-8") as f:
        json.dump({"engine": "faster-whisper large-v3 no VAD", "segments": raw}, f, ensure_ascii=False)
    with open(f"{out}/dropped.txt", "w", encoding="utf-8") as f:
        for s in dropped:
            f.write(f"[{ts(s['start'], '.')[:8]}] {s['why']} ns={s['no_speech']} lp={s['logprob']} {s['text']}\n")
    with open(f"{out}/transcript.srt", "w", encoding="utf-8") as f:
        for i, s in enumerate(segments, 1):
            f.write(f"{i}\n{ts(s['start'])} --> {ts(s['end'])}\n{s['text']}\n\n")
    with open(f"{out}/transcript.txt", "w", encoding="utf-8") as f:
        for s in segments:
            f.write(f"[{ts(s['start'], '.')[:8]}] {s['text']}\n")
    with open(f"{out}/transcript.json", "w", encoding="utf-8") as f:
        json.dump({"engine": "faster-whisper large-v3 no VAD + junk filter", "segments": segments}, f, ensure_ascii=False)
    print(f"{sid}: {len(raw)} segments, kept {len(segments)}, dropped {len(dropped)} in {time.time() - t0:.0f}s", flush=True)

open("/kaggle/working/ALL_DONE", "w").write("ok")
print("ALL_DONE", flush=True)
