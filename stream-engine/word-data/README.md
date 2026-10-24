# word-data — everything the Guess the Word dictionaries are made from

All raw data, models and finished dictionaries of Guess the Word, kept by us. **A build uses only what is
here; nothing is downloaded again** unless a developer explicitly decides to refresh a set (see the end).

Collected 2026-10-24 without any download: the raw sets and models were copied out of the local Docker build
cache of the build that produced the dictionaries now in production (`election-game` Dockerfile and
`tools/*.py`, commits 0373694 / 9299f21), the finished dictionaries from `election-game/ranker/build/assets`.
Checked the same day: the 21 files on the server (`/var/www/quiz/stream-engine/assets`) and the
`vocab.txt` + `embeddings.npy` inside the four deployed `word-ranker-<lang>` Lambdas (CodeSha256 = the local
zips) are byte-identical to `built/`.

`MANIFEST.sha256` — sha256 of every file (`sha256sum -c MANIFEST.sha256` in this folder);
`pip-freeze.txt` — every Python package of that build with its exact version.

## Layout and where each part is stored

| Folder | Size | What | Stored |
|---|---|---|---|
| `sources/` | 135 MB | raw sets, one folder per library and version | GitHub (this repo) |
| `built/` | 200 MB | finished dictionaries, one folder per dictionary | GitHub (this repo) |
| `models/hub/` | 2.55 GB | Hugging Face snapshots (an `HF_HOME/hub` cache, real files, no symlinks) | S3 `s3://aws-for-claude-registry-565905128720/word-data/models/` (LaBSE alone is 1.8 GB, over GitHub's 100 MB per file) |

`models/` is in `stream-engine/.gitignore`; fetch it from S3 (`aws s3 sync s3://aws-for-claude-registry-565905128720/word-data/models/ models/`).

## Sources (`sources/`)

| Folder | Library / data | Used for | License |
|---|---|---|---|
| `wordfreq-3.1.1/data/` | wordfreq 3.1.1, `large_` + `small_` lists for en, ru, fr, es (the only files the build reads; the other languages of the package are not kept) | word frequencies (`top_n_list`, `zipf_frequency`): vocabulary order, difficulty tiers | code Apache-2.0, data CC BY-SA 4.0 |
| `pymorphy3-dicts-ru-2.4.417150.4580142/` | pymorphy3-dicts-ru (OpenCorpora dictionaries) for pymorphy3 2.0.6, package + dist-info | Russian lemmas, part of speech, inflection aliases, ru-hard nouns | code MIT, OpenCorpora data CC BY-SA |
| `nltk_data/corpora/` | NLTK 3.10.3 corpora: `wordnet`, `omw-1.4`, `omw-2.0`, `stopwords` | English parts of speech / categories (WordNet 3.0); French / Spanish nouns (Open Multilingual Wordnet) and stopwords | WordNet 3.0 license; OMW: per language, `LICENSE` inside each language of the zip |
| `better-profanity-0.7.0/` | better-profanity 0.7.0, package + dist-info | profanity list (`profanity_wordlist.txt`): never guessable, never secret | MIT |
| `spacy-fr_core_news_sm-3.8.0/` | spaCy model fr_core_news_sm 3.8.0 (spaCy 3.8.16), package + dist-info | French part of speech + lemma of each form | LGPL-LR |
| `spacy-es_core_news_sm-3.8.0/` | spaCy model es_core_news_sm 3.8.0, package + dist-info | Spanish part of speech + lemma of each form | GNU GPL 3.0 |

## Models (`models/hub/`)

| Model | Revision | Dictionaries | License |
|---|---|---|---|
| `sentence-transformers/all-MiniLM-L6-v2` | 1110a243fdf4706b3f48f1d95db1a4f5529b4d41 | en, en-easy | Apache-2.0 |
| `cointegrated/rubert-tiny2` | e8ed3b0c8bbf4fb6984c3de043bf7d2f4e5969ae | ru, ru-easy, ru-hard | MIT |
| `sentence-transformers/LaBSE` | 836121a0533e5664b21c7aacc5d22951f2b8b25b | fr | Apache-2.0 |
| `hiiamsid/sentence_similarity_spanish_es` | 66ab46adac3910bb6ea6085b962a25e49513b981 | es | Apache-2.0 |

Libraries that ran them: torch 2.14.1+cpu, sentence-transformers 6.1.0, transformers 5.19.0,
huggingface_hub 1.33.0 (all versions: `pip-freeze.txt`). Use: `HF_HOME=<this folder>/models HF_HUB_OFFLINE=1`.

## Finished dictionaries (`built/`)

Each `built/<dict>/`: `vocab.txt` (guessable words, most frequent first), `embeddings.npy` (float16, one
L2-normalized row per vocab word), `secret_nouns.txt`, `meta.json` (pools, aliases, categories, sources).
`vocab_hash` = first 12 hex of sha1(`vocab.txt`) — what the game and the Lambdas compare.

| Dictionary | vocab_hash | Built | Code |
|---|---|---|---|
| en-easy | d20aff51a53d | 2026-10-14 | election-game 0373694 |
| en | 214fea340819 | 2026-10-14 | election-game 0373694 |
| ru-easy | aa9d346e1399 | 2026-10-14 | election-game 0373694 |
| ru | adea3f1869b5 | 2026-10-14 | election-game 0373694 |
| ru-hard | f4b8e7ff8552 | 2026-10-23 | quiz `stream-engine/tools` 11c42ee |
| fr | 2e7cca203229 | 2026-10-14 | election-game 0373694 |
| es | c3234eafeadf | 2026-10-14 | election-game 0373694 |

Note: the dictionary rules of quiz 5429d31 (`stream-engine/tools/lang_ru.py`) are not in these files yet.

## How the places in a round are counted

The secret word's row of `embeddings.npy` is multiplied by every row (all rows are L2-normalized, so this is
the cosine similarity of the two words' vectors); the words are sorted by it, highest first (stable sort),
the secret word itself is always place 1. Place of word *i* = its position in that order. The same code in
two places: `SemanticIndex.ranking()` in `stream-engine/app/games/guess/semantic.py` and `ranking()` in
`services/word-ranker/handler.py` (the Lambda sends the places to the game; the game server has no embeddings).

## Refreshing a set (only on a developer's explicit decision)

A normal build never downloads data or models. To take a newer version of a set: download it on purpose,
put it in a new folder named by its version (`sources/<library>-<version>/`, or a new snapshot under
`models/hub/`), rebuild the dictionaries, update `MANIFEST.sha256`, `pip-freeze.txt`, this file and the
Dockerfile, then upload (GitHub / S3) the same way.
