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
- `ebook-covers/<folder>/thumbs/*.avif` and `ebook-covers/thumbs/*.avif` (generated, macOS `sips`): small AVIF thumbnails (pictures 480 px wide, covers 160 px) used by the grids, table and graph; the viewer loads the original PNG. Only regenerated when the source is newer. On other systems thumbnails are skipped and the app falls back to the originals.
- [`seed/keyword-groups.json`](seed/keyword-groups.json) (generated once, then **hand-editable**): groups one notion's keyword variants, e.g. *Data quality* → data quality checks, AWS Glue Data Quality, data quality rules… Searching a group name (suggested first in the search box) returns everything in the group; a bar under the toolbar lists its keywords to narrow down, and a keyword that belongs to groups offers to widen to them. Each group has:
  - `name`: label shown in the search;
  - `pattern`: whole-phrase match over all keywords, plurals included (`null` = members come only from `include`);
  - `include` / `exclude`: keywords to add or remove by hand (fix semantic mistakes here, e.g. exclude "load balancing" from *Load*);
  - `members`: computed, don't edit.

  Rebuilds keep your edits and only add new proposals (a keyword, or its singular, found in ≥ 3 keywords). To drop a group for good, delete it **and** add its pattern to `rejected`.
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

Search ([`app/search.js`](app/search.js), [MiniSearch](https://github.com/lucaong/minisearch) from CDN): ranked over books and pictures, with typo tolerance ("parqet"), prefix on the word being typed, light stemming ("partitioned" → partition) and field boosts (keywords/tags > title > caption > text). Typing a search sorts by *Most relevant*. Pictures show precise matches first (whole phrase in a keyword/caption, or a group's keywords); close matches (≈) are added with *Include close matches*, or automatically when nothing matches precisely. Put the search in "quotes" for an exact phrase everywhere. Offline, it falls back to simple word matching.

Filters: full-text search (titles, authors, summary, topics, chapters, picture keywords, with suggestions) plus facet chips with live counts. Values within a facet are OR'ed by default; multi-valued facets (technologies, topics, platform) can switch to **All** (AND). Facets combine with AND. The full state (view, filters, sort, open book) lives in the URL hash, so any view can be bookmarked or shared.

Tag normalisation (e.g. `Spark` → `Apache Spark`, case-insensitive merges) is defined in `ALIASES` at the top of [`app/app.js`](app/app.js).
