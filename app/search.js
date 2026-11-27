// Ranked full-text search over books and pictures (MiniSearch).
// Pure module: MiniSearch is injected, so it runs in the browser (CDN) and in Node tests.
//
// Documents: one per book (title, tags, text) and one per picture (keywords, caption).
// Query: all words required (AND), prefix match on the word being typed, typo tolerance on
// longer words, light stemming (plurals, -ing, -ed), field boosts (keywords/tags > title > caption > text).

const BOOST = { keywords: 3, tags: 3, title: 2.5, caption: 1.5, text: 1 };

// Light English stemming, applied to indexed and query terms alike:
// partitions / partitioned / partitioning → partition; queries → query.
export function stem(t) {
  if (t.length <= 4) return t;
  if (t.endsWith('ies') && t.length > 5) return t.slice(0, -3) + 'y';
  if (t.endsWith('ing') && t.length > 6) return t.slice(0, -3);
  if (t.endsWith('ed') && t.length > 5 && !t.endsWith('eed')) return t.slice(0, -2);
  if (t.endsWith('es') && /(ss|x|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('s') && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

export function createSearch(MiniSearch, books, { fold }) {
  const ms = new MiniSearch({
    fields: ['title', 'tags', 'keywords', 'caption', 'text'],
    storeFields: [],
    processTerm: (term) => {
      const t = fold(term).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#]+$/gu, '');
      return t ? stem(t) : null;
    },
    searchOptions: {
      boost: BOOST,
      combineWith: 'AND',
      prefix: (term, i, terms) => i === terms.length - 1 && term.length >= 2, // the word being typed
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false), // ~1 typo per 5 letters
    },
  });
  const byId = new Map();
  const docs = [];
  for (const b of books) {
    const id = `b:${b.id}`;
    byId.set(id, { book: b });
    docs.push({
      id,
      title: [b.title, b.subtitle].filter(Boolean).join(' — '),
      tags: [...b.technologies, ...b.topics, ...b.platform, b.category].join(' ; '),
      text: [...b.authors, b.publisher, b.type, String(b.year), b.summary, ...b.chapters].join(' ; '),
    });
    for (const p of b.pictures) {
      const pid = `p:${b.id}:${p.i}`;
      byId.set(pid, { book: b, picture: p });
      docs.push({ id: pid, keywords: p.keywords.join(' ; '), caption: p.caption, title: b.title });
    }
  }
  ms.addAll(docs);

  // q: string, or { any: [phrases] } for a keyword group (OR of its members).
  function query(q) {
    // Group: OR of its member phrases, each phrase AND-ed, no prefix (members are complete keywords).
    const tree = typeof q === 'string' ? q
      : { combineWith: 'OR', queries: q.any.map((m) => ({ combineWith: 'AND', prefix: false, queries: [m] })) };
    const results = ms.search(tree);
    const bookScore = new Map();
    const pictures = new Map(); // picture -> { score, terms }
    const picsPerBook = new Map();
    for (const r of results) {
      const d = byId.get(r.id);
      if (d.picture) {
        pictures.set(d.picture, { score: r.score, terms: r.terms });
        const list = picsPerBook.get(d.book.id) ?? [];
        list.push(r.score);
        picsPerBook.set(d.book.id, list);
      } else bookScore.set(d.book.id, r.score);
    }
    // A book's relevance: its own fields + its best pictures (diminishing).
    for (const [id, scores] of picsPerBook) {
      const top = scores.sort((a, b) => b - a).slice(0, 3);
      const extra = top.reduce((s, x, i) => s + x * [0.6, 0.25, 0.1][i], 0);
      bookScore.set(id, (bookScore.get(id) ?? 0) + extra);
    }
    return { bookScore, pictures };
  }

  // Suggestions while typing (prefix + fuzzy), e.g. "lakeh" → "lakehouse".
  const suggest = (q) => ms.autoSuggest(q, { fuzzy: (t) => (t.length >= 5 ? 0.2 : false) });

  return { query, suggest, size: docs.length };
}
