# Kaggle GPU job (pushed by kaggle.mjs, which fills in __RUN_ID__ and __DRAFTS__):
#  1. polish: the template question -> natural Russian (names declined, nothing added, answer not given away)
#  2. verify: the model answers the polished question blind (A-D: correct + 3 wrong); a miss = doubtful, dropped later
# Output: /kaggle/working/quiz-<run>.json with timings, so the pilot measures speed too.
import base64, gzip, json, os, random, re, subprocess, sys, time

RUN_ID = "__RUN_ID__"
DRAFTS = json.loads(gzip.decompress(base64.b64decode("__DRAFTS__")).decode("utf-8"))
MODEL = "Qwen/Qwen2.5-7B-Instruct"
BATCH = 16
t0 = time.time()
log = lambda *a: print(f"[{time.time() - t0:7.1f}s]", *a, flush=True)

subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U", "bitsandbytes", "accelerate"], check=False)
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

gpus = [torch.cuda.get_device_properties(i) for i in range(torch.cuda.device_count())]
gpu_info = [f"{g.name} {g.total_memory // 2**30}GB" for g in gpus]
total_gb = sum(g.total_memory for g in gpus) / 2**30
log("gpus", gpu_info)

tok = AutoTokenizer.from_pretrained(MODEL)
tok.padding_side = "left"
if total_gb >= 28:  # two T4: fp16 split across both
    model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype=torch.float16, device_map="auto")
    mode = "fp16"
else:
    model = AutoModelForCausalLM.from_pretrained(MODEL, device_map="auto",
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16, bnb_4bit_quant_type="nf4"))
    mode = "nf4"
model.eval()
t_load = time.time() - t0
log("model loaded", mode)


def generate(chats, max_new):
    out, n_tokens = [], 0
    for i in range(0, len(chats), BATCH):
        texts = [tok.apply_chat_template(c, tokenize=False, add_generation_prompt=True) for c in chats[i:i + BATCH]]
        enc = tok(texts, return_tensors="pt", padding=True).to(model.device)
        with torch.no_grad():
            gen = model.generate(**enc, max_new_tokens=max_new, do_sample=False, pad_token_id=tok.eos_token_id)
        for row in gen[:, enc["input_ids"].shape[1]:]:
            n_tokens += int((row != tok.eos_token_id).sum())
            out.append(tok.decode(row, skip_special_tokens=True).strip())
    return out, n_tokens


POLISH_SYS = (
    "Ты редактор русскоязычной телевикторины. Перепиши вопрос коротко и естественно, как сказал бы ведущий. "
    "Правила: смысл не меняй; все названия сохрани (склонять можно и нужно); не добавляй новых фактов и подсказок; "
    "не называй ответ; не длиннее 110 символов; в конце знак вопроса. Выведи только вопрос."
)
SHOTS = [
    ("Какой город является столицей страны «Австралия»?", "Какой город — столица Австралии?"),
    ("В какой стране находится вершина Гора Рашмор?", "В какой стране находится гора Рашмор?"),
    ("Какая вершина является высшей точкой страны «Норвегия»?", "Какая вершина — высшая точка Норвегии?"),
    ("Какова высота вершины Монблан над уровнем моря?", "Какова высота Монблана над уровнем моря?"),
    ("Куда впадает река Сена?", "Куда впадает Сена?"),
]


def polish_chat(d):
    msgs = [{"role": "system", "content": POLISH_SYS}]
    for q, a in SHOTS:
        msgs += [{"role": "user", "content": q}, {"role": "assistant", "content": a}]
    return msgs + [{"role": "user", "content": d["template"]}]


t1 = time.time()
polished, tok_polish = generate([polish_chat(d) for d in DRAFTS], 60)
polished = [p.splitlines()[0].strip().strip('"«»') if p else "" for p in polished]
t_polish = time.time() - t1
log("polished", len(polished), f"{t_polish:.1f}s")

LETTERS = "ABCD"
items, chats = [], []
for d, p in zip(DRAFTS, polished):
    opts = [d["correct"]] + d["wrong"][:3]
    random.Random(d["id"]).shuffle(opts)
    item = {"id": d["id"], "polished": p, "options": opts, "key": LETTERS[opts.index(d["correct"])]}
    items.append(item)
    q = p if p.endswith("?") else d["template"]
    chats.append([
        {"role": "system", "content": "Ты эрудит и отвечаешь на вопросы викторины. Ответь только одной буквой: A, B, C или D."},
        {"role": "user", "content": q + "\n" + "\n".join(f"{LETTERS[i]}) {o}" for i, o in enumerate(opts))},
    ])
t2 = time.time()
answers, tok_verify = generate(chats, 3)
t_verify = time.time() - t2
for it, a in zip(items, answers):
    m = re.search(r"[ABCD]", a.upper())
    it["model_answer"] = m.group(0) if m else a
log("verified", sum(it["model_answer"] == it["key"] for it in items), "/", len(items), f"{t_verify:.1f}s")

json.dump({
    "run": RUN_ID, "model": MODEL, "mode": mode, "gpus": gpu_info, "count": len(items),
    "seconds": {"load": round(t_load, 1), "polish": round(t_polish, 1), "verify": round(t_verify, 1), "total": round(time.time() - t0, 1)},
    "tokens": {"polish_out": tok_polish, "verify_out": tok_verify},
    "items": items,
}, open(f"/kaggle/working/quiz-{RUN_ID}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
log("done")
