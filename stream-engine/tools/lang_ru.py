"""Russian word assets: vocabulary of lemmas (pymorphy3), inflection aliases,
secret-word pools of common singular nouns. Used by build_assets.py --lang ru."""

import re

RU_WORD_RE = re.compile(r"^[а-я]{3,22}$")
RU_PROPER = {"Name", "Surn", "Patr", "Geox", "Orgn", "Trad", "Abbr", "Init"}
# roots of Russian profanity: such words are neither guessable nor secret
RU_BAD_ROOTS = ("хуй", "хуе", "хуя", "пизд", "ебл", "ебат", "ебан", "ебу", "бля", "сука", "суки",
                "мудак", "мудил", "жоп", "говн", "дерьм", "срать", "сран", "шлюх", "пидор", "пидар",
                "гандон", "залуп", "манда", "дроч", "ублюд", "трах", "секс", "порн")
# secret words by wordfreq zipf frequency; every noun is a secret word (no lower bound, any length):
# the game picks among all of them alike, the tier only tells how common the word is
RU_TIERS = {"easy": (4.15, 9.0), "medium": (3.8, 4.15), "hard": (3.3, 3.8), "rare": (-1.0, 3.3)}


def norm(w):
    return w.replace("ё", "е")


def bad(w):
    return any(r in w for r in RU_BAD_ROOTS)


def build_ru(vocab_size):
    import pymorphy3
    from wordfreq import top_n_list, zipf_frequency
    morph = pymorphy3.MorphAnalyzer()
    vocab, aliases, seen = [], {}, set()
    for raw in top_n_list("ru", 400000):
        w = norm(raw)
        if not RU_WORD_RE.match(w) or w in seen or bad(w):
            continue
        seen.add(w)
        p = morph.parse(w)[0]
        if RU_PROPER & set(p.tag.grammemes):
            continue
        lemma = w if plural_only(morph, w) else norm(p.normal_form)
        if lemma == w:
            if len(vocab) < vocab_size:
                vocab.append(w)
        elif RU_WORD_RE.match(lemma):
            aliases[w] = lemma                    # кошки -> кошка
    vocab_set = set(vocab)
    aliases = {k: v for k, v in aliases.items() if v in vocab_set}
    print(f"[vocab ru] {len(vocab)} words, {len(aliases)} aliases")
    return (vocab, aliases) + ru_pools(vocab, morph)


# words of 2 letters are mostly junk (notes, letters, units); these are real nouns
RU_SHORT = {"ад", "ас", "еж", "ил", "ум", "уж", "ус", "щи", "юг", "яд", "як"}
RU_NOUN_RE = re.compile(r"^[а-я]{3,22}$")


# plural-only nouns the morphology dictionary takes for a plural of another word (деньги -> деньга)
RU_PLURAL_ONLY = {"деньги"}


def plural_only(morph, w):
    """w is a noun used only in the plural (сутки, деньги, духи, ножницы): a word of its own, not a form of
    a singular noun (деньга, дух) the first parse may suggest"""
    return w in RU_PLURAL_ONLY or any(q.tag.POS == "NOUN" and "Pltm" in q.tag and norm(q.normal_form) == w
               and not RU_PROPER & set(q.tag.grammemes) for q in morph.parse(w))


def common_noun(morph, w):
    """First parse of w that is a common noun (кит, роза, лев are also names: still nouns)."""
    for p in morph.parse(w):
        if p.tag.POS == "NOUN" and not RU_PROPER & set(p.tag.grammemes):
            return p
    return None


def build_ru_normal(vocab_size):
    """'Normal' level: nouns only, as many as the frequency list has (rare animals, plants,
    tools, science terms included), so more of what viewers type gets a rank."""
    import pymorphy3
    from wordfreq import top_n_list
    morph = pymorphy3.MorphAnalyzer()
    ok = lambda w: (RU_NOUN_RE.match(w) or w in RU_SHORT) and not bad(w)
    vocab, aliases, seen = [], {}, set()
    for raw in top_n_list("ru", 2_000_000, wordlist="large"):
        w = norm(raw)
        if not re.match(r"^[а-я]{2,22}$", w):
            continue
        p = common_noun(morph, w)
        if p is None:
            continue
        lemma = w if plural_only(morph, w) else norm(p.normal_form)
        if not ok(lemma) or not morph.word_is_known(lemma) or common_noun(morph, lemma) is None:
            continue
        if lemma not in seen:
            seen.add(lemma)
            if len(vocab) < vocab_size:
                vocab.append(lemma)
        if w != lemma:
            aliases.setdefault(w, lemma)              # кошки -> кошка, бобр -> бобер
    vocab_set = set(vocab)
    aliases = {k: v for k, v in aliases.items() if v in vocab_set and k not in vocab_set}
    print(f"[vocab ru normal] {len(vocab)} nouns, {len(aliases)} aliases")
    return (vocab, aliases) + ru_pools(vocab, morph)


def build_ru_hard(vocab_size):
    """'Hard' level (Russian only): the normal dictionary plus every common noun of the morphology dictionary
    (OpenCorpora) it lacks - rare professions, demonyms, terms. They have no frequency, so they go last."""
    import pymorphy3
    vocab, aliases, *_ = build_ru_normal(vocab_size)
    morph = pymorphy3.MorphAnalyzer()
    seen, added = set(vocab), set()
    for word, tag, nf, para, idx in morph.dictionary.iter_known_words(""):
        if idx != 0 or tag.POS != "NOUN" or RU_PROPER & set(tag.grammemes):
            continue                              # lemmas of common nouns only
        w = norm(word)
        if w in seen or w in added or not RU_NOUN_RE.match(w) or bad(w):
            continue
        p = common_noun(morph, w)
        if p is None or (norm(p.normal_form) != w and not plural_only(morph, w)):
            continue                              # a form of another word (the same rule as the normal level)
        added.add(w)
    vocab = vocab + sorted(added)[:max(0, vocab_size - len(vocab))]
    print(f"[vocab ru hard] {len(vocab)} nouns (+{len(added)} from OpenCorpora), {len(aliases)} aliases")
    return (vocab, aliases) + ru_pools(vocab, morph)


def ru_pools(vocab, morph):
    from wordfreq import zipf_frequency
    # the secret word: a common noun in the singular, any frequency or length, any topic (the owner's decision,
    # 2026-10-23: no stop-list - only profanity, which isn't in the vocabulary either)
    pools = {k: [] for k in RU_TIERS}
    for w in vocab:
        if bad(w):
            continue
        parses = morph.parse(w)
        p = parses[0]
        if not plural_only(morph, w) and (p.tag.POS != "NOUN" or p.score < 0.6 or "sing" not in p.tag
                                          or "nomn" not in p.tag):
            continue                              # a common noun in the singular, or one with no singular (сутки)
        if any(RU_PROPER & set(q.tag.grammemes) for q in parses[:3]):
            continue                              # names (Роза, Лев...) neither
        z = zipf_frequency(w, "ru")
        for tier, (lo, hi) in RU_TIERS.items():
            if lo <= z < hi:
                pools[tier].append(w)
                break
    print("[pools ru]", {k: len(v) for k, v in pools.items()})
    checks = [("океан", ["море", "вода", "волна"], ["компьютер", "банан"]),
              ("собака", ["щенок", "кошка"], ["вулкан", "налог"]),
              ("машина", ["автомобиль", "колесо"], ["облако", "любовь"])]
    sources = ["wordfreq (MIT / CC BY-SA 4.0)", "pymorphy3 + OpenCorpora dictionaries (MIT / CC BY-SA)"]
    return pools, {}, sources, checks
