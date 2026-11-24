# data-engineering-ebooks-memo

Catalogue of data engineering ebooks: metadata in [`seed/data-engineering-ebooks.csv`](seed/data-engineering-ebooks.csv), covers in [`ebook-covers/`](ebook-covers/).

## Library web app

Static app in [`app/`](app/) (vanilla HTML/CSS/JS, no build). It reads the CSV and covers at runtime, so serve the **repository root**:

```sh
python3 -m http.server 8000
# open http://localhost:8000/app/
```

Views:

- **Shelf**: cover cards, sortable and groupable (year, category, platform, level, publisher).
- **Table**: dense sortable table (click column headers).
- **Graph**: force-directed network linking books through shared technologies, topics, platforms, categories or authors (D3 loaded from CDN on demand).

Filters: full-text search (titles, authors, summary, topics, chapters) plus facet chips with live counts. Values within a facet are OR'ed by default; multi-valued facets (technologies, topics, platform, authors) can switch to **All** (AND). Facets combine with AND. The full state (view, filters, sort, open book) lives in the URL hash, so any view can be bookmarked or shared.

Tag normalisation (e.g. `Spark` → `Apache Spark`, case-insensitive merges) is defined in `ALIASES` at the top of [`app/app.js`](app/app.js).
