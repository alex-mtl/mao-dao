# ---- stage 1: word lists + embeddings for "Guess the Word" (heavy, cached) ----
# Data and models come ONLY from word-data/ (word-data/README.md: sources, versions, licenses, sha256).
# Only the Python libraries below are installed from PyPI, at the exact versions of word-data/pip-freeze.txt.
# Downloading data or models again is a developer's explicit decision, never part of a build.
FROM python:3.12-slim AS assets

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONUNBUFFERED=1 \
    NLTK_DATA=/word-data/sources/nltk_data HF_HOME=/word-data/models \
    HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1

RUN pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install sentence-transformers==6.1.0 transformers==5.19.0 huggingface_hub==1.33.0 tokenizers==0.23.2 \
      safetensors==0.8.0 numpy==2.5.3 wordfreq==3.1.1 nltk==3.10.3 better-profanity==0.7.0 \
      pymorphy3==2.0.6 pymorphy3-dicts-ru==2.4.417150.4580142 spacy==3.8.16
# our copies of the data replace whatever the packages ship: wordfreq lists, OpenCorpora, profanity list,
# spaCy fr/es models (package + dist-info); nltk corpora and HF models are read in place (ENV above)
COPY word-data/sources /word-data/sources
COPY word-data/models /word-data/models
RUN SP=/usr/local/lib/python3.12/site-packages \
 && rm -rf $SP/wordfreq/data $SP/better_profanity $SP/pymorphy3_dicts_ru \
 && cp -r /word-data/sources/wordfreq-3.1.1/data $SP/wordfreq/data \
 && for d in pymorphy3-dicts-ru-2.4.417150.4580142 better-profanity-0.7.0 \
             spacy-fr_core_news_sm-3.8.0 spacy-es_core_news_sm-3.8.0; do cp -r /word-data/sources/$d/* $SP/; done

WORKDIR /build
COPY tools/build_assets.py tools/lang_ru.py ./
# "easy" level = the original dictionary (any part of speech); "normal" = nouns only, bigger
RUN python build_assets.py --lang en --level easy --out /assets/en-easy
RUN python build_assets.py --lang ru --level easy --vocab-size 50000 --out /assets/ru-easy
RUN python build_assets.py --lang en --level normal --out /assets/en
RUN python build_assets.py --lang ru --level normal --vocab-size 100000 --out /assets/ru
# "hard" (Russian only) = normal + every common noun of OpenCorpora
RUN python build_assets.py --lang ru --level hard --vocab-size 100000 --out /assets/ru-hard
# French / Spanish come last: changes in lang_romance.py don't rebuild the dictionaries above
COPY tools/lang_romance.py ./
RUN python build_assets.py --lang fr --level normal --out /assets/fr
RUN python build_assets.py --lang es --level normal --out /assets/es
# the game itself needs no embeddings (the word-ranker Lambdas rank the words): word lists + metadata only.
# The full /assets (with embeddings) is for the Lambdas and the tests: docker build --target assets
RUN for d in /assets/*; do mkdir -p /assets-game/$(basename $d)  && cp $d/vocab.txt $d/meta.json $d/secret_nouns.txt /assets-game/$(basename $d)/; done

# ---- stage 2: runtime (small: no torch, no model) ----
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ASSETS_DIR=/app/assets

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY --from=assets /assets-game /app/assets
COPY app /app/app

EXPOSE 8765

CMD ["python", "-m", "app"]
