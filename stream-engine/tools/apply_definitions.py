#!/usr/bin/env python3
"""Rebuild word-data/built/ru for a definition-based embedding matrix (Дружок's run of 2026-11-02).

The matrix encodes "слово — определение" with the same Sber model; its word list is the old ru vocab minus
the words left out of the run (uncertain definitions), in the same order. This script makes the dictionary
match the matrix exactly:
  vocab.txt        = the matrix's word list
  embeddings.npy   = the matrix (float16, rows L2-normalized)
  secret_nouns.txt, meta.json pools / zipf, difficulty.json zipf, valid_nouns.txt: words not in the new vocab
                   are dropped; meta.json aliases whose lemma left the vocab are dropped.
Nothing else changes (difficulty thresholds, hint_limit, level...).

Usage: apply_definitions.py <run dir with def-sbert-words.txt + def-sbert-matrix-fp16.npy> <built/ru dir>"""

import json
import os
import sys

import numpy as np


def lines(path):
    with open(path, encoding="utf-8") as f:
        return [w.strip() for w in f if w.strip()]


def write_lines(path, words):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("".join(w + "\n" for w in words))


def dump(path, obj):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def main(run, out):
    words = lines(os.path.join(run, "def-sbert-words.txt"))
    emb = np.load(os.path.join(run, "def-sbert-matrix-fp16.npy"))
    old = lines(os.path.join(out, "vocab.txt"))
    keep = set(words)
    assert emb.shape[0] == len(words) == len(keep), "matrix rows != words"
    assert emb.dtype == np.float16 and not np.isnan(emb).any()
    norms = np.linalg.norm(emb.astype(np.float32), axis=1)
    assert abs(norms.min() - 1) < 1e-2 and abs(norms.max() - 1) < 1e-2, "rows not normalized"
    assert words == [w for w in old if w in keep], "matrix words are not the old vocab's subsequence"
    gone = [w for w in old if w not in keep]

    write_lines(os.path.join(out, "vocab.txt"), words)
    np.save(os.path.join(out, "embeddings.npy"), emb)

    secret = lines(os.path.join(out, "secret_nouns.txt"))
    write_lines(os.path.join(out, "secret_nouns.txt"), [w for w in secret if w in keep])

    with open(os.path.join(out, "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    meta["pools"] = {t: [w for w in p if w in keep] for t, p in meta["pools"].items()}
    meta["aliases"] = {a: l for a, l in meta["aliases"].items() if l in keep and a not in keep}
    if "zipf" in meta:
        meta["zipf"] = {w: z for w, z in meta["zipf"].items() if w in keep}
    meta["embeddings"] = "ai-forever/sbert_large_mt_nlu_ru over 'слово — определение' (word-data/definitions)"
    dump(os.path.join(out, "meta.json"), meta)

    p = os.path.join(out, "difficulty.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        d["zipf"] = {w: z for w, z in d["zipf"].items() if w in keep}
        dump(p, d)

    p = os.path.join(out, "valid_nouns.txt")
    if os.path.exists(p):
        write_lines(p, [w for w in lines(p) if w in keep])

    print(f"vocab {len(old)} -> {len(words)} (-{len(gone)}), secret {len(secret)} -> "
          f"{sum(1 for w in secret if w in keep)}, pools { {t: len(v) for t, v in meta['pools'].items()} }, "
          f"aliases {len(meta['aliases'])}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
