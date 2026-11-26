# data-engineering-ebooks-memo

Catalogue of data engineering ebooks: metadata in [`seed/data-engineering-ebooks.csv`](seed/data-engineering-ebooks.csv), covers in [`ebook-covers/`](ebook-covers/).

Each cover has a sibling folder (`ebook-covers/<cover name>/`) with `memo0.png` (chapters), `gh.png` (companion repo, optional), `memo1..N.png` (topic memos) and `index.js` (the book's index keywords).

## Data build

GitHub Pages can't list folders, so the app reads generated files. After adding pictures or editing keywords, run:

```sh
node tools/build-data.mjs
```

- [`seed/keywords/<folder>.json`](seed/keywords/): keywords inferred from each book's pictures (caption + keywords per picture, plus book-level technologies / topics / providers). Hand-editable; they enrich the CSV tags in the app.
- `seed/media.json` (generated): pictures per book + their keywords.
- `seed/index-referential.json` (generated): all `index.js` files merged and cleaned (sub-entries dropped, parentheses split, duplicates and near-duplicates merged, generic words removed), each keyword with its books and a length bucket: easy ≤ 10, medium ≤ 20, hard ≤ 25 characters.

## Library web app

Static app in [`app/`](app/) (vanilla HTML/CSS/JS, no build). It reads the CSV and covers at runtime, so serve the **repository root**:

```sh
python3 -m http.server 8000
# open http://localhost:8000/app/
```

Views:

- **Shelf**: cover cards, sortable and groupable (year, category, platform, publisher).
- **Table**: dense sortable table (click column headers).
- **Pictures**: every book's pictures; the search box filters them by keyword (picture captions + keywords). Clicking a picture opens a viewer (prev/next, keywords to search by, and for the repo picture a link to the GitHub repo). Books also show their pictures in the details dialog and the graph side panel.
- **Typing game** ("Pipeline Rush"): keywords from `seed/index-referential.json` flow down pipeline lanes; type them before they reach the sink. Easy / Medium / Hard length buckets or Progressive, optionally limited to the currently filtered books.
- **Graph**: force-directed network linking books through shared technologies, topics or platforms (D3 loaded from CDN on demand). Clicking a cover previews the book in a side panel (with related books) without leaving the graph. With Topics or Technologies, the default *Lifecycle zones* layout places each tag in a data engineering lifecycle stage (Generation → Ingestion / Transformation / Serving over Storage → Analytics · ML) or undercurrent (Security, Data management, DataOps, Data architecture, Orchestration, Software engineering); books sit in the band between. Tag → zone classification lives in [`app/lifecycle.js`](app/lifecycle.js) (`OVERRIDES` + regex `RULES`).

Filters: full-text search (titles, authors, summary, topics, chapters, picture keywords, with suggestions) plus facet chips with live counts. Values within a facet are OR'ed by default; multi-valued facets (technologies, topics, platform) can switch to **All** (AND). Facets combine with AND. The full state (view, filters, sort, open book) lives in the URL hash, so any view can be bookmarked or shared.

Tag normalisation (e.g. `Spark` → `Apache Spark`, case-insensitive merges) is defined in `ALIASES` at the top of [`app/app.js`](app/app.js).
