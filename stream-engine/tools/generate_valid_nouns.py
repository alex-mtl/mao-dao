#!/usr/bin/env python3
"""Generate valid_nouns.txt for the guess-word custom-word check.

Rule (user, 2026-10-28): a setter/host secret word must be a common noun
in nominative singular by default; plural-only nouns are allowed, plural
forms of regular nouns are rejected, proper names are rejected.

Criteria (pymorphy3 / OpenCorpora, over the ru vocab list):
  - a NOUN parse with normal_form == word, tag nomn, and sing or Pltm
  - no Surn / Name / Geox / Patr tag on that parse
  - word not in EXCLUDE (see below)

EXCLUDE = pool-deleted words that must not come back via a setter, plus
known OpenCorpora artifacts. The 5 borderline words Claude restored to the
pool on 2026-10-28 (лихо, пасть, постой, винил, меняла) are NOT excluded:
they are legitimate nominative-singular nouns and the user approved them.

Usage:
    python generate_valid_nouns.py --vocab vocab.txt --out valid_nouns.txt
Result for the 2026-10-28 ru vocab (38 360 words): 36 841 words.
"""
import argparse
import pymorphy3

# 25 definite leaks from the 2026-10-28 pool check (forms, verbs, adjectives)
DEFINITE = """перед тут справа подряд весь помочь подать погиб победит закрой
живете веди силен крепки черных рыжей мировой городской уголовный
головной цветной зубной сердечная ночное пардон""".split()
# 40 borderline words from the same check, MINUS the 5 Claude restored
# (лихо, пасть, постой, винил, меняла) and approved by the user 2026-10-28.
BORDERLINE = """красный золотой черный белые правый левый живой угловой
любопытный бедный голодный рыжий смертный встречный молодая маленькая
духовная древние новое старое среднее малое онлайн стоп тала полон
велик смог надел спас задел замер стать знать став""".split()
# Other known artifacts: носовой (adjective leaked as a secret 2026-10-28)
# and 6 OpenCorpora noun-lemma artifacts found during whitelist review.
OTHER = ["носовой", "обо", "той", "бей", "пал", "низок", "хлоп"]
EXCLUDE = set(DEFINITE + BORDERLINE + OTHER)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vocab", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    morph = pymorphy3.MorphAnalyzer()
    vocab = [line.strip() for line in open(args.vocab, encoding="utf-8") if line.strip()]
    out = []
    for word in vocab:
        if word in EXCLUDE:
            continue
        for parse in morph.parse(word):
            tag = str(parse.tag)
            if (
                parse.tag.POS == "NOUN"
                and parse.normal_form == word
                and "nomn" in parse.tag
                and not any(t in tag for t in ("Surn", "Name", "Geox", "Patr"))
                and ("sing" in parse.tag or "Pltm" in parse.tag)
            ):
                out.append(word)
                break
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(out)) + "\n")
    print(f"{len(out)} valid nouns from {len(vocab)} vocab words -> {args.out}")


if __name__ == "__main__":
    main()
