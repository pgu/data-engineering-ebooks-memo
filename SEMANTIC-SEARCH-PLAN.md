# Search by meaning: plan

Status: **proposal, not started** (written 2026-11-28). Open questions are at the end.

## Goal

Find books and pictures by *meaning*, not only by shared words. For example, "trustworthy data" should find *data quality* and *data contracts*, and "moving data in real time" should find *streaming* and *CDC*.

Everything stays local: no server, no API keys, so the app still runs as a static site on GitHub Pages.

## Where search stands today

- Ranked keyword search with [MiniSearch](https://github.com/lucaong/minisearch), in [`app/search.js`](app/search.js). It tolerates typos, matches prefixes and word variants, and weights fields.
- Hand-editable keyword groups in [`seed/keyword-groups.json`](seed/keyword-groups.json), e.g. *Data quality* → its variants.
- Pictures have two tiers of matches: precise and close (≈).

Search by meaning would add a third kind of result on top of these, without replacing them.

## How it works

Turn each item into an **embedding**: a vector of a few hundred numbers that captures its meaning. Do the same with the query, then rank items by how close the vectors are (cosine similarity).

### What gets embedded (about 300 items)

| Item | Text embedded |
|---|---|
| Picture (231) | caption + keywords |
| Book (22) | title, subtitle, summary, topics, chapters |
| Keyword group (~80) | name + members |
| Keyword (~1,300, optional) | the keyword itself, used by step 1 |

### The model

A small sentence-embedding model, run with **transformers.js** (`@huggingface/transformers`). It runs both in Node, for the build, and in the browser, for the query. The same model must embed both the content and the queries.

| Model | Size (compressed) | Notes |
|---|---|---|
| `all-MiniLM-L6-v2` | about 23 MB | English, fast, the usual default |
| `multilingual-e5-small` | larger | Choose this if queries in French (or other languages) should find English content |

## Two steps (you can stop after step 1)

### Step 1: meaning-based expansion, with no model in the browser

- **Build time:** embed all keywords, and store each keyword's closest neighbours by meaning in a small JSON file, e.g. `seed/keyword-neighbours.json`.
- **Search time:** when the query matches a known keyword or group, add its closest neighbours as related results. For example, "data contracts" would also bring in schema validation, data quality and expectations.
- **Cost for visitors:** nothing. No download, no impact on load time.
- **Limit:** it only helps when the query uses words that already exist in the catalogue.

### Step 2: true search by meaning (optional, opt-in)

- **Build time:** a script, `tools/build-embeddings.mjs`, embeds the ~300 items into `seed/embeddings.json`. Compressed (8-bit or 16-bit numbers), that's roughly 100–200 KB.
- **Browser:**
  - The model loads only when it's needed: a "Search by meaning" toggle, or opening the Pictures view.
  - The first load downloads about 23 MB. After that the browser caches it, and each query takes tens of milliseconds.
- **Ranking:** combine keyword ranks and meaning ranks (reciprocal rank fusion), so exact keyword matches stay on top.
  - Results found only by meaning get their own label ("related by meaning").
  - A similarity cutoff keeps weak matches from flooding the list.
- **Explaining results:** each related-by-meaning result shows its nearest keywords ("why this?").

## How to judge it

Write a dozen test queries with the results you expect, and compare before and after:

| Query | Expected |
|---|---|
| trustworthy data | data quality, data contracts |
| moving data in real time | streaming, CDC |
| keeping the bill down | cost optimization |
| who can see what | access control, row-level security |
| tables that remember history | slowly changing dimensions, time travel |
| organizing raw to curated data | medallion architecture, bronze/silver/gold |

## Not worth it here

- **Chrome's built-in AI:** it offers no embeddings, and it's only available in some browsers.
- **Hosted embedding APIs** (e.g. OpenAI): they need keys and a server, which doesn't fit a static site.
- **A vector database:** pointless for ~300 items, where plain comparisons are instant.

## Open questions

1. **Step 1 only, or both steps?** I'd start with step 1: cheap, no load-time cost, and it quickly shows whether meaning helps.
2. **French queries?** If yes, use `multilingual-e5-small` instead of `all-MiniLM-L6-v2`.
3. **Where to host the model:** the Hugging Face CDN (simplest), or a copy in the repo (works offline, but adds ~23 MB).
4. **When to load it (step 2):** only through an explicit toggle, or also automatically when keyword search finds little?
