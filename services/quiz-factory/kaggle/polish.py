# Kaggle GPU job (pushed by kaggle.mjs, which fills in the run id, the models and the drafts below).
# The question wording is fixed by the build-*.mjs templates (quiz-show style). Models: transformers ids, or
# "org/repo-GGUF:q8_0" for llama.cpp (built on the spot). For each model in turn:
#  1. genitive: the names the templates decline ("Австралия" -> "Австралии"), checked against the original;
#     a failed check leaves the draft's fallback text that needs no declension
#  2. verify: the model answers the final question blind (A-D: correct + 3 wrong); a miss is only a mark
# Output: /kaggle/working/quiz-<run>.json = {"runs": [one result per model, with timings]}.
import base64, gc, gzip, json, os, random, re, subprocess, sys, time
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

RUN_ID = "__RUN_ID__"
DRAFTS = json.loads(gzip.decompress(base64.b64decode("__DRAFTS__")).decode("utf-8"))
MODELS = "__MODEL__".split(",")  # filled in by kaggle.mjs (--model=a,b), default Qwen/Qwen2.5-7B-Instruct
BATCH = 16  # GigaChat: 4 (its MoE layers need far more memory per row)
t0 = time.time()
log = lambda *a: print(f"[{time.time() - t0:7.1f}s]", *a, flush=True)

# GigaChat3 (DeepSeek-V3 architecture) needs a recent transformers
giga = any("GigaChat" in m for m in MODELS)
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U", "bitsandbytes", "accelerate"] + (["transformers"] if giga else []), check=False)
import torch
from huggingface_hub import snapshot_download
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

gpus = [torch.cuda.get_device_properties(i) for i in range(torch.cuda.device_count())]
gpu_info = [f"{g.name} {g.total_memory // 2**30}GB" for g in gpus]
total_gb = sum(g.total_memory for g in gpus) / 2**30
log("gpus", gpu_info)

GEN_SYS = "Поставь название в родительный падеж (кого? чего?). Несклоняемые названия оставь как есть. Выведи только результат."
SHOTS = [("Австралия", "Австралии"), ("США", "США"), ("Великобритания", "Великобритании"), ("Монблан", "Монблана"),
         ("Джомолунгма", "Джомолунгмы"), ("Мак-Кинли", "Мак-Кинли"), ("Аконкагуа", "Аконкагуа"), ("Кот-д’Ивуар", "Кот-д’Ивуара"),
         ("Папуа — Новая Гвинея", "Папуа — Новой Гвинеи"), ("Объединённые Арабские Эмираты", "Объединённых Арабских Эмиратов")]


def gen_ok(name, gen):
    """the same words, each only its ending changed"""
    a, b = name.split(), gen.split()
    if not gen or len(a) != len(b) or gen.endswith("?"):
        return False
    for x, y in zip(a, b):
        n = max(2, min(4, len(x) - 2))
        if x[:n].lower() != y[:n].lower() or abs(len(x) - len(y)) > 3:
            return False
    return True


LETTERS = "ABCD"


class LlamaServer:
    """GGUF models ("org/repo-GGUF:q8_0"): llama.cpp's llama-server built here for the T4 (sm_75), 8 parallel slots."""

    def __init__(self, name):
        import urllib.request
        from huggingface_hub import hf_hub_download
        repo, quant = name.split(":")
        self.port = 8090
        tb = time.time()
        if not os.path.exists("/tmp/llama.cpp/build/bin/llama-server"):
            # nvcc is not on PATH in Kaggle's image; find the toolkit, and a recent cmake comes from pip
            cuda = next((d for d in ["/usr/local/cuda", *sorted(__import__("glob").glob("/usr/local/cuda-*"), reverse=True)]
                         if os.path.exists(d + "/bin/nvcc")), None)
            log("cuda toolkit", cuda)
            if cuda is None:
                raise RuntimeError("no nvcc: " + subprocess.run("ls -d /usr/local/cuda* /usr/lib/cuda* 2>&1; which nvcc", shell=True,
                                                                capture_output=True, text=True).stdout)
            env = {**os.environ, "PATH": f"{cuda}/bin:" + os.environ["PATH"], "CUDACXX": f"{cuda}/bin/nvcc"}
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U", "cmake", "ninja"], check=False)
            subprocess.run("git clone --depth 1 https://github.com/ggml-org/llama.cpp.git /tmp/llama.cpp", shell=True, check=True)
            r = subprocess.run("cd /tmp/llama.cpp && cmake -B build -G Ninja -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=75 -DLLAMA_CURL=OFF "
                               "-DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DCMAKE_BUILD_TYPE=Release > /tmp/cmake.log 2>&1 && "
                               f"cmake --build build --target llama-server -j {os.cpu_count()} >> /tmp/cmake.log 2>&1", shell=True, env=env)
            if r.returncode:
                raise RuntimeError("llama.cpp build failed: " + open("/tmp/cmake.log").read()[-2500:])
        self.build_seconds = round(time.time() - tb, 1)
        log("llama.cpp built", self.build_seconds, "s")
        file = next(f for f in __import__("huggingface_hub").list_repo_files(repo) if f.lower().endswith(f"{quant.lower()}.gguf"))
        path = hf_hub_download(repo, file)
        self.proc = subprocess.Popen(["/tmp/llama.cpp/build/bin/llama-server", "-m", path, "-ngl", "99", "-c", "16384", "-np", "8",
                                      "--jinja", "--port", str(self.port), "--host", "127.0.0.1"],
                                     stdout=open("/tmp/llama-server.log", "w"), stderr=subprocess.STDOUT)
        for _ in range(600):
            try:
                if urllib.request.urlopen(f"http://127.0.0.1:{self.port}/health", timeout=2).status == 200:
                    break
            except Exception:
                pass
            if self.proc.poll() is not None:
                raise RuntimeError("llama-server died: " + open("/tmp/llama-server.log").read()[-1500:])
            time.sleep(1)

    def chat(self, messages, max_new):
        import urllib.request
        body = json.dumps({"messages": messages, "max_tokens": max_new, "temperature": 0}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/v1/chat/completions", body, {"Content-Type": "application/json"})
        r = json.load(urllib.request.urlopen(req, timeout=300))
        return r["choices"][0]["message"]["content"] or "", r.get("usage", {}).get("completion_tokens", 0)

    def close(self):
        self.proc.terminate()
        self.proc.wait(30)


def load(name):
    if "GGUF" in name:
        server = LlamaServer(name)
        return None, server, "gguf-" + name.split(":")[1]
    path = name
    if "GigaChat" in name:
        # its config has routed_scaling_factor: 1 (int); recent transformers insist on a float
        path = snapshot_download(name)
        cfg_file = os.path.join(path, "config.json")
        cfg = json.load(open(cfg_file))
        for k in ("routed_scaling_factor", "rope_theta", "rms_norm_eps", "initializer_range"):
            if isinstance(cfg.get(k), int):
                cfg[k] = float(cfg[k])
        os.remove(cfg_file)  # a symlink into the HF blob store: replace it with our own copy
        json.dump(cfg, open(cfg_file, "w"))
        log("patched config")
    tok = AutoTokenizer.from_pretrained(path)
    tok.padding_side = "left"
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    if "GigaChat" in name:  # ~20 GB in bf16 over both T4 (fp16 may overflow in this architecture)
        # leave room on each T4 for generation (OOM on GPU 0 with the default even split)
        model, mode = AutoModelForCausalLM.from_pretrained(path, torch_dtype=torch.bfloat16, device_map="auto",
                                                           max_memory={0: "10GiB", 1: "13GiB"}), "bf16"
    elif total_gb >= 28:  # two T4: fp16 split across both
        model, mode = AutoModelForCausalLM.from_pretrained(path, torch_dtype=torch.float16, device_map="auto"), "fp16"
    else:
        model, mode = AutoModelForCausalLM.from_pretrained(path, device_map="auto", quantization_config=BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16, bnb_4bit_quant_type="nf4")), "nf4"
    model.eval()
    return tok, model, mode


def generate(tok, model, chats, max_new, batch=BATCH):
    if tok is None:  # llama-server: 8 requests at a time, it batches them itself
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(8) as ex:
            res = list(ex.map(lambda c: model.chat(c, max_new), chats))
        return [r[0].strip() for r in res], sum(r[1] for r in res)
    out, n_tokens = [], 0
    for i in range(0, len(chats), batch):
        texts = [tok.apply_chat_template(c, tokenize=False, add_generation_prompt=True) for c in chats[i:i + batch]]
        enc = tok(texts, return_tensors="pt", padding=True, add_special_tokens=False).to(model.device)
        with torch.no_grad():
            gen = model.generate(**enc, max_new_tokens=max_new, do_sample=False, pad_token_id=tok.pad_token_id)
        for row in gen[:, enc["input_ids"].shape[1]:]:
            n_tokens += int((row != tok.pad_token_id).sum())
            out.append(tok.decode(row, skip_special_tokens=True).strip())
    return out, n_tokens


def gen_chat(name):
    msgs = [{"role": "system", "content": GEN_SYS}]
    for q, a in SHOTS:
        msgs += [{"role": "user", "content": q}, {"role": "assistant", "content": a}]
    return msgs + [{"role": "user", "content": name}]


def run(name):
    ts = time.time()
    tok, model, mode = load(name)
    t_load = time.time() - ts
    log(name, "loaded", mode)

    batch = 4 if "GigaChat" in name else BATCH
    t1 = time.time()
    names = sorted({d["gen_of"] for d in DRAFTS if d.get("gen_of")})
    out, tok_polish = generate(tok, model, [gen_chat(n) for n in names], 24, batch)
    gens = {n: o.splitlines()[0].strip().strip('"«».') if o else "" for n, o in zip(names, out)}
    t_polish = time.time() - t1
    log("genitive", sum(gen_ok(n, g) for n, g in gens.items()), "/", len(names), f"{t_polish:.1f}s")

    items, chats = [], []
    for d in DRAFTS:
        g = gens.get(d.get("gen_of") or "", "")
        good = bool(d.get("pattern")) and gen_ok(d["gen_of"], g)
        q = d["pattern"].replace("{gen}", g) if good else d["template"]
        opts = [d["correct"]] + d["wrong"][:3]
        random.Random(d["id"]).shuffle(opts)
        items.append({"id": d["id"], "text": q, "genitive": g if d.get("pattern") else None, "genitive_ok": good if d.get("pattern") else None,
                      "options": opts, "key": LETTERS[opts.index(d["correct"])]})
        chats.append([
            {"role": "system", "content": "Ты эрудит и отвечаешь на вопросы викторины. Ответь только одной буквой: A, B, C или D."},
            {"role": "user", "content": q + "\n" + "\n".join(f"{LETTERS[i]}) {o}" for i, o in enumerate(opts))},
        ])
    t2 = time.time()
    answers, tok_verify = generate(tok, model, chats, 3, batch)
    t_verify = time.time() - t2
    for it, a in zip(items, answers):
        m = re.search(r"[ABCD]", a.upper())
        it["model_answer"] = m.group(0) if m else a
    log("verified", sum(it["model_answer"] == it["key"] for it in items), "/", len(items), f"{t_verify:.1f}s")

    build = getattr(model, "build_seconds", None)
    if tok is None:
        model.close()
    del model
    gc.collect()
    torch.cuda.empty_cache()
    return {"run": RUN_ID, "model": name, "mode": mode, "gpus": gpu_info, "count": len(items), "build_seconds": build,
            "seconds": {"load": round(t_load, 1), "genitive": round(t_polish, 1), "verify": round(t_verify, 1)},
            "genitives": gens,
            "tokens": {"genitive_out": tok_polish, "verify_out": tok_verify}, "items": items}


results = []
for name in MODELS:
    try:
        results.append(run(name))
    except Exception as e:  # one model failing must not lose the other's result
        import traceback
        traceback.print_exc()
        results.append({"run": RUN_ID, "model": name, "error": repr(e)[:500]})
json.dump({"runs": results}, open(f"/kaggle/working/quiz-{RUN_ID}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
log("done")
