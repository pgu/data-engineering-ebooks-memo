// Data Engineering Library — vanilla JS, no build step.
// Serve the repository root over HTTP (e.g. `python3 -m http.server`) and open /app/.

import { ZONES, ZONE, BOOK_BAND, zoneOf, zoneCenter } from './lifecycle.js';

const CSV_URL = '../seed/data-engineering-ebooks.csv';
const MEDIA_URL = '../seed/media.json'; // built by tools/build-data.mjs (pictures + inferred keywords)
const GRAPH_DIMS = ['technologies', 'topics', 'platform'];
const ZONED_DIMS = ['technologies', 'topics']; // dims that support the lifecycle layout
const COVERS_DIR = '../ebook-covers/';
const D3_URL = 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// ---------------------------------------------------------------------------
// Normalisation of free-text tags (edit freely as the CSV grows)
// ---------------------------------------------------------------------------
const ALIASES = {
  spark: 'Apache Spark',
  kafka: 'Apache Kafka',
  flink: 'Apache Flink',
  iceberg: 'Apache Iceberg',
  hudi: 'Apache Hudi',
  airflow: 'Apache Airflow',
  'iceberg tables': 'Apache Iceberg',
  hadoop: 'Apache Hadoop',
  avro: 'Apache Avro',
  orc: 'Apache ORC',
  hive: 'Apache Hive',
  athena: 'Amazon Athena',
  emr: 'Amazon EMR',
  redshift: 'Amazon Redshift',
  'redshift spectrum': 'Amazon Redshift Spectrum',
  sagemaker: 'Amazon SageMaker',
  'amazon kinesis data streams': 'Amazon Kinesis',
  'lake formation': 'AWS Lake Formation',
  'step functions': 'AWS Step Functions',
  'glue data catalog': 'AWS Glue Data Catalog',
  'event hubs': 'Azure Event Hubs',
  adls: 'Azure Data Lake Storage',
  'azure data lake storage gen2': 'Azure Data Lake Storage',
  'azure sql': 'Azure SQL Database',
  'cloud storage': 'Google Cloud Storage',
  'cortex ai': 'Snowflake Cortex',
  'protocol buffers': 'Protobuf',
  'jupyter notebook': 'Jupyter',
  // topics
  'data catalogs': 'Data catalog',
  'data lakes': 'Data lake',
  'data architectures': 'Data architecture',
  cdc: 'Change data capture',
  'data lakehouse': 'Lakehouse',
  'personally identifiable information': 'PII',
  'infrastructure as code': 'Infrastructure as code',
};
// Cloud platforms are providers, not technologies.
const NOT_TECH = new Set(['amazon web services', 'microsoft azure', 'google cloud platform', 'aws', 'azure', 'google cloud']);

const KIND_LABEL = { chapters: 'Chapters', repo: 'Companion repo', memo: 'Memo' };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const fold = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const splitList = (s, sep) => (s || '').split(sep).map((v) => v.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// CSV (RFC 4180: quoted fields, escaped quotes, CRLF)
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.filter((r) => r.some((v) => v.trim())).map((r) =>
    Object.fromEntries(header.map((h, j) => [h.trim(), (r[j] ?? '').trim()])));
}

const folderOf = (coverFile) => (coverFile || '').replace(/\.(jpe?g|webp|png|avif|gif)$/i, '');

function toBooks(records, media = {}, coverThumbs = {}) {
  const normTech = makeNormalizerWithLabels();
  const normTopic = makeNormalizerWithLabels({ capitalize: true });
  const books = records.map((r, idx) => {
    const monthNum = MONTHS.indexOf((r['Publication month'] || '').toLowerCase()) + 1;
    const year = Number(r['Publication year']) || 0;
    const book = {
      id: r['Deck ID'] || `book-${idx}`,
      title: r['Title'],
      subtitle: r['Subtitle'],
      authors: splitList(r['Authors'], ';'),
      publisher: r['Publisher'],
      edition: r['Edition'],
      category: r['Category'],
      topicKeys: [...new Set(splitList(r['Topics'], ';').map(normTopic.add))],
      platform: splitList(r['Platform / Vendor'], ';'),
      techKeys: [...new Set(splitList(r['Technologies'], ';').map(normTech.add))],
      type: r['Book type'],
      year,
      month: r['Publication month'],
      date: year * 100 + monthNum,
      coverFile: r['Picture cover'],
      cover: null,
      repo: r['Companion repo'],
      chapters: splitList(r['Chapters covered in deck'], '|'),
      summary: r['Summary'],
    };
    // Pictures + keywords inferred from them (seed/media.json) enrich the CSV tags.
    const m = media[folderOf(book.coverFile)];
    const dir = COVERS_DIR + encodeURI(folderOf(book.coverFile)) + '/';
    book.coverThumb = coverThumbs[folderOf(book.coverFile)] ? COVERS_DIR + encodeURI(coverThumbs[folderOf(book.coverFile)]) : null;
    book.pictures = (m?.images ?? []).map((img, i) => ({ ...img, i, book, src: dir + encodeURI(img.file),
      thumbSrc: img.thumb ? dir + encodeURI(img.thumb) : dir + encodeURI(img.file),
      text: fold([img.caption, ...img.keywords, KIND_LABEL[img.kind]].join(' \u0001 ')) }));
    for (const t of m?.technologies ?? []) if (!NOT_TECH.has(t.toLowerCase())) book.techKeys.push(normTech.add(t));
    for (const t of m?.topics ?? []) book.topicKeys.push(normTopic.add(t));
    book.techKeys = [...new Set(book.techKeys)];
    book.topicKeys = [...new Set(book.topicKeys)];
    book.platform = [...new Set([...book.platform, ...(m?.providers ?? [])])];
    return book;
  });
  for (const b of books) {
    b.technologies = b.techKeys.map(normTech.label);
    b.topics = b.topicKeys.map(normTopic.label);
    b.extras = [b.repo && 'Companion repo', b.chapters.length && 'Deck chapters', b.pictures.length && 'Pictures'].filter(Boolean);
    b.searchText = fold([b.title, b.subtitle, ...b.authors, b.publisher, b.category, ...b.platform,
      ...b.technologies, ...b.topics, b.type, b.summary, ...b.chapters, String(b.year), b.id].join(' \u0001 '))
      + ' \u0001 ' + b.pictures.map((p) => p.text).join(' \u0001 ');
  }
  return books;
}

// One canonical display label per case-insensitive (aliased) value, per facet.
function makeNormalizerWithLabels({ capitalize = false } = {}) {
  const labels = new Map();
  return {
    add(raw) {
      const v = ALIASES[raw.toLowerCase()] ?? raw;
      const key = v.toLowerCase();
      const cand = capitalize ? capFirst(v) : v;
      const cur = labels.get(key);
      if (!cur || (/^[a-z]/.test(cur) && /^[A-Z]/.test(cand))) labels.set(key, cand);
      return key;
    },
    label: (key) => labels.get(key),
  };
}

// Resolve covers; CSV entries may omit the extension.
function probe(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
async function resolveCovers(books) {
  await Promise.all(books.map(async (b) => {
    if (!b.coverFile) return;
    const base = COVERS_DIR + encodeURI(b.coverFile);
    if (/\.(jpe?g|webp|png|avif|gif)$/i.test(b.coverFile)) { b.cover = base; return; }
    for (const ext of ['.jpeg', '.jpg', '.webp', '.png']) {
      const ok = await probe(base + ext);
      if (ok) { b.cover = ok; return; }
    }
  }));
}

// ---------------------------------------------------------------------------
// Facets
// ---------------------------------------------------------------------------
const FACETS = [
  { key: 'category', label: 'Category', get: (b) => [b.category], open: true },
  { key: 'platform', label: 'Platform / Vendor', get: (b) => b.platform, multi: true, open: true },
  { key: 'technologies', label: 'Technologies', get: (b) => b.technologies, multi: true, limit: 16, find: true, open: true },
  { key: 'topics', label: 'Topics', get: (b) => b.topics, multi: true, limit: 16, find: true, open: true },
  { key: 'type', label: 'Book type', get: (b) => [b.type] },
  { key: 'publisher', label: 'Publisher', get: (b) => [b.publisher] },
  { key: 'year', label: 'Year', get: (b) => [String(b.year)], order: (a, b) => b - a },
  { key: 'extras', label: 'Includes', get: (b) => b.extras },
];
const FACET = Object.fromEntries(FACETS.map((f) => [f.key, f]));

const SORTS = {
  title: (a, b) => collator.compare(a.title, b.title),
  date: (a, b) => a.date - b.date,
  publisher: (a, b) => collator.compare(a.publisher, b.publisher),
  category: (a, b) => collator.compare(a.category, b.category),
  platform: (a, b) => collator.compare(a.platform.join(', '), b.platform.join(', ')),
  type: (a, b) => collator.compare(a.type, b.type),
  chapters: (a, b) => a.chapters.length - b.chapters.length,
};

const GROUPS = {
  year: { get: (b) => [String(b.year)], order: (a, b) => b - a },
  category: { get: (b) => [b.category] },
  platform: { get: (b) => b.platform },
  publisher: { get: (b) => [b.publisher] },
};

// ---------------------------------------------------------------------------
// State + URL hash
// ---------------------------------------------------------------------------
const state = {
  view: 'shelf',
  q: '',
  filters: new Map(), // facet key -> Set(values)
  modes: new Map(), // facet key -> 'any' | 'all'
  sort: { key: 'date', dir: 'descending' },
  group: '',
  graphDim: 'technologies',
  graphMin: 2,
  graphLayout: 'lifecycle', // 'lifecycle' | 'free'
  picMatch: 'exact', // pictures: 'exact' phrase | 'partial' words
  book: null, // book open in the modal
  sel: null, // book previewed in the graph side panel
  selTag: null, // tag node last clicked in the graph (panel lists its books)
};

function writeHash() {
  const p = new URLSearchParams();
  if (state.view !== 'shelf') p.set('view', state.view);
  if (state.q) p.set('q', state.q);
  for (const [k, set] of state.filters) if (set.size) p.set(`f.${k}`, [...set].join('|'));
  for (const [k, m] of state.modes) if (m === 'all') p.set(`m.${k}`, 'all');
  if (state.sort.key !== 'date' || state.sort.dir !== 'descending') p.set('sort', `${state.sort.key}:${state.sort.dir}`);
  if (state.group) p.set('group', state.group);
  if (state.view === 'graph') {
    p.set('dim', state.graphDim); p.set('min', state.graphMin);
    if (state.graphLayout !== 'lifecycle') p.set('layout', state.graphLayout);
  }
  if (state.picMatch !== 'exact') p.set('pm', state.picMatch);
  if (state.view === 'graph' && state.sel) p.set('sel', state.sel);
  if (state.view === 'graph' && activeTag()) p.set('tag', activeTag());
  if (state.book) p.set('book', state.book);
  const s = p.toString();
  history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search);
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.view = ['shelf', 'table', 'graph', 'pictures', 'game'].includes(p.get('view')) ? p.get('view') : 'shelf';
  state.q = p.get('q') || '';
  state.filters = new Map();
  state.modes = new Map();
  for (const [k, v] of p) {
    if (k.startsWith('f.') && FACET[k.slice(2)]) state.filters.set(k.slice(2), new Set(v.split('|').filter(Boolean)));
    if (k.startsWith('m.') && FACET[k.slice(2)]) state.modes.set(k.slice(2), v === 'all' ? 'all' : 'any');
  }
  const [sk, sd] = (p.get('sort') || 'date:descending').split(':');
  state.sort = { key: SORTS[sk] ? sk : 'date', dir: sd === 'ascending' ? 'ascending' : 'descending' };
  state.group = GROUPS[p.get('group')] ? p.get('group') : '';
  state.graphDim = GRAPH_DIMS.includes(p.get('dim')) ? p.get('dim') : 'technologies';
  state.graphMin = Math.max(1, Number(p.get('min')) || 2);
  state.graphLayout = p.get('layout') === 'free' ? 'free' : 'lifecycle';
  state.picMatch = p.get('pm') === 'partial' ? 'partial' : 'exact';
  state.book = p.get('book');
  state.sel = BY_ID.has(p.get('sel')) ? p.get('sel') : null;
  state.selTag = p.get('tag');
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------
let BOOKS = [];
let BY_ID = new Map();

function matchesQuery(b) {
  if (!state.q) return true;
  return fold(state.q).split(/\s+/).filter(Boolean).every((t) => b.searchText.includes(t));
}

function matchesFacet(b, key, set = state.filters.get(key)) {
  if (!set || !set.size) return true;
  const vals = FACET[key].get(b);
  return state.modes.get(key) === 'all'
    ? [...set].every((v) => vals.includes(v))
    : vals.some((v) => set.has(v));
}

function matches(b, exceptKey = null) {
  if (!matchesQuery(b)) return false;
  for (const key of state.filters.keys()) {
    if (key === exceptKey) continue;
    if (!matchesFacet(b, key)) return false;
  }
  return true;
}

function visibleBooks() {
  const { key, dir } = state.sort;
  const f = dir === 'ascending' ? 1 : -1;
  return BOOKS.filter((b) => matches(b)).sort((a, b) =>
    f * SORTS[key](a, b) || SORTS.date(b, a) || SORTS.title(a, b));
}

// Graph tag click: single selection within the facet. Clicking the only selected value clears it.
function selectOnlyFilter(key, value) {
  const set = state.filters.get(key);
  if (set?.size === 1 && set.has(value)) state.filters.delete(key);
  else state.filters.set(key, new Set([value]));
}

function toggleFilter(key, value, force) {
  const set = state.filters.get(key) ?? new Set();
  const on = force ?? !set.has(value);
  on ? set.add(value) : set.delete(value);
  if (set.size) state.filters.set(key, set); else state.filters.delete(key);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'command' || k === 'commandfor') el.setAttribute(k, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}
function moveToEnd(parent, el) {
  if (parent.moveBefore && el.isConnected && parent.isConnected) {
    try { parent.moveBefore(el, null); return; } catch { /* fall through */ }
  }
  parent.append(el);
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let currentTransition = null;
function withTransition(update, animate = true) {
  if (!animate || !document.startViewTransition || reduceMotion.matches) { update(); return; }
  currentTransition?.skipTransition();
  currentTransition = document.startViewTransition(update);
  currentTransition.finished.finally(() => { currentTransition = null; });
}

let catHue = new Map();
const hueOf = (b) => catHue.get(b.category) ?? 220;

const SMALL_COVERS = new Set(['thumb-img', 'gp-thumb', 'gal-cover']); // use the small AVIF thumbnail
function coverEl(b, cls = 'cover') {
  if (b.cover) return h('img', { class: cls, src: (SMALL_COVERS.has(cls) && b.coverThumb) || b.cover, alt: '', loading: 'lazy', decoding: 'async', width: 300, height: 400 });
  const initials = b.title.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 3).map((w) => w[0]).join('');
  return h('div', { class: `${cls} media cover-ph`, 'aria-hidden': 'true', text: initials });
}

// ---------------------------------------------------------------------------
// Facet sidebar (built once, updated in place to keep focus)
// ---------------------------------------------------------------------------
const facetUI = new Map(); // key -> { chips: Map(value -> button), expanded, findText, section }

function buildFacets() {
  const root = $('#facets');
  for (const f of FACETS) {
    const counts = new Map();
    for (const b of BOOKS) for (const v of new Set(f.get(b))) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    const values = [...counts.keys()].sort(f.order ?? ((a, b) => counts.get(b) - counts.get(a) || collator.compare(a, b)));
    const ui = { chips: new Map(), expanded: false, findText: '', values };
    const chipBox = h('div', { class: 'chips' });
    for (const v of values) {
      const btn = h('button', { type: 'button', class: 'chip', 'data-facet': f.key, 'data-value': v, 'aria-pressed': 'false' },
        h('span', { class: 'chip-label', text: v }), h('span', { class: 'chip-count', text: counts.get(v) }));
      ui.chips.set(v, btn);
      chipBox.append(btn);
    }
    const summaryBits = [h('h3', { text: f.label }), h('span', { class: 'facet-sel', hidden: true })];
    const body = [];
    if (f.multi) {
      body.push(h('div', { class: 'mode', role: 'group', 'aria-label': `${f.label} match mode` },
        h('button', { type: 'button', 'data-mode': 'any', 'data-facet': f.key, 'aria-pressed': 'true', text: 'Any' }),
        h('button', { type: 'button', 'data-mode': 'all', 'data-facet': f.key, 'aria-pressed': 'false', text: 'All' })));
    }
    if (f.find) {
      const find = h('input', { type: 'search', class: 'facet-find', placeholder: `Find ${f.label.toLowerCase()}…`, 'aria-label': `Find ${f.label}` });
      find.addEventListener('input', () => { ui.findText = fold(find.value.trim()); updateFacets(); });
      body.push(find);
    }
    body.push(chipBox);
    if (f.limit && values.length > f.limit) {
      ui.more = h('button', { type: 'button', class: 'more', 'data-more': f.key });
      body.push(ui.more);
    }
    ui.section = h('details', { class: 'facet', open: !!f.open, 'data-facet': f.key },
      h('summary', {}, ...summaryBits), ...body);
    facetUI.set(f.key, ui);
    root.append(ui.section);
  }

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('button.chip');
    if (chip) { toggleFilter(chip.dataset.facet, chip.dataset.value); update(); return; }
    const mode = e.target.closest('button[data-mode]');
    if (mode) { state.modes.set(mode.dataset.facet, mode.dataset.mode); update(); return; }
    const more = e.target.closest('button[data-more]');
    if (more) { const ui = facetUI.get(more.dataset.more); ui.expanded = !ui.expanded; updateFacets(); }
  });
}

function updateFacets() {
  let activeCount = 0;
  for (const f of FACETS) {
    const ui = facetUI.get(f.key);
    const sel = state.filters.get(f.key) ?? new Set();
    activeCount += sel.size;
    // Counts: books matching every other filter (and this facet's selection when in "all" mode).
    const base = BOOKS.filter((b) => matches(b, f.key) && (state.modes.get(f.key) !== 'all' || matchesFacet(b, f.key)));
    const counts = new Map();
    for (const b of base) for (const v of new Set(f.get(b))) counts.set(v, (counts.get(v) ?? 0) + 1);
    let shown = 0, hiddenByLimit = 0;
    ui.values.forEach((v) => {
      const btn = ui.chips.get(v);
      const pressed = sel.has(v);
      const n = counts.get(v) ?? 0;
      btn.setAttribute('aria-pressed', pressed);
      btn.lastChild.textContent = n;
      btn.disabled = !pressed && n === 0;
      const findOk = !ui.findText || fold(v).includes(ui.findText);
      const limitOk = !f.limit || ui.expanded || ui.findText || shown < f.limit || pressed;
      btn.hidden = !(findOk && limitOk);
      if (findOk && !limitOk) hiddenByLimit++;
      if (!btn.hidden) shown++;
    });
    if (ui.more) {
      ui.more.hidden = !ui.expanded && hiddenByLimit === 0;
      ui.more.textContent = ui.expanded ? 'Show fewer' : `Show all ${ui.values.length}`;
    }
    const badge = $('.facet-sel', ui.section);
    badge.hidden = !sel.size;
    badge.textContent = sel.size;
    for (const b of $$('button[data-mode]', ui.section)) b.setAttribute('aria-pressed', (state.modes.get(f.key) ?? 'any') === b.dataset.mode);
  }
  const fc = $('#filter-count');
  fc.hidden = !activeCount;
  fc.textContent = `${activeCount} active`;
}

function updateActiveFilters() {
  const box = $('#active-filters');
  const items = [];
  if (state.q) items.push(h('button', { type: 'button', class: 'chip active', 'data-remove': 'q' }, `“${state.q}”`, h('span', { 'aria-hidden': 'true', text: ' ×' })));
  for (const [k, set] of state.filters) {
    for (const v of set) {
      items.push(h('button', { type: 'button', class: 'chip active', 'data-remove': k, 'data-value': v, 'aria-label': `Remove filter ${FACET[k].label}: ${v}` },
        h('span', { class: 'chip-facet', text: `${FACET[k].label}:` }), ` ${v}`, h('span', { 'aria-hidden': 'true', text: ' ×' })));
    }
  }
  if (items.length > 1) items.push(h('button', { type: 'button', class: 'link', 'data-action': 'clear', text: 'Clear all' }));
  box.replaceChildren(...items);
}

// ---------------------------------------------------------------------------
// Shelf view
// ---------------------------------------------------------------------------
const cards = new Map();

function buildCard(b) {
  return h('article', { class: 'card', style: `--hue:${hueOf(b)}; view-transition-name: c-${b.id}; view-transition-class: card`, 'data-id': b.id },
    coverEl(b),
    h('header', {},
      h('p', { class: 'eyebrow', text: b.category }),
      h('h3', {}, h('button', { type: 'button', class: 'card-link', 'data-open': b.id, text: b.title })),
      b.subtitle && h('p', { class: 'subtitle', text: b.subtitle })),
    h('div', { class: 'card-content' },
      h('p', { class: 'meta' }, `${b.month ? b.month.slice(0, 3) + ' ' : ''}${b.year} · ${b.publisher}${b.edition && b.edition !== '1st' ? ` · ${b.edition} ed.` : ''}`),
      h('p', { class: 'authors', text: b.authors.join(', ') }),
      h('ul', { class: 'badges', 'aria-label': 'Platform' },
        b.platform.map((p) => h('li', { class: 'badge', text: p }))),
      h('p', { class: 'summary', text: b.summary }),
      b.pictures.length ? h('button', { type: 'button', class: 'card-pics', 'data-pics-of': b.id }) : null),
  );
}

function updateCardPictures(b, card) {
  const btn = $('.card-pics', card);
  if (!btn) return;
  const n = matchingPictures(b).length;
  const searching = queryTerms().length > 0;
  btn.textContent = searching ? `${n} of ${b.pictures.length} pictures match` : `${b.pictures.length} pictures`;
  btn.classList.toggle('hit', searching && n > 0);
}

function renderShelf(list) {
  const root = $('#shelf');
  for (const b of list) updateCardPictures(b, cards.get(b.id));
  const sections = [];
  if (!state.group) {
    const grid = h('div', { class: 'grid' });
    sections.push(grid);
    root.replaceChildren(...sections);
    for (const b of list) moveToEnd(grid, cards.get(b.id));
    return;
  }
  const g = GROUPS[state.group];
  const buckets = new Map();
  for (const b of list) for (const k of g.get(b)) { if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(b); }
  const keys = [...buckets.keys()].sort(g.order ?? ((a, b) => buckets.get(b).length - buckets.get(a).length || collator.compare(a, b)));
  const placed = new Set();
  const plan = [];
  for (const k of keys) {
    const grid = h('div', { class: 'grid' });
    sections.push(h('section', { class: 'group', 'aria-labelledby': `g-${cssId(k)}` },
      h('h2', { id: `g-${cssId(k)}` }, k, h('span', { class: 'count', text: buckets.get(k).length })), grid));
    plan.push([grid, buckets.get(k)]);
  }
  root.replaceChildren(...sections);
  for (const [grid, books] of plan) {
    for (const b of books) {
      if (placed.has(b.id)) { // multi-valued group: show a copy without a transition name
        const clone = cards.get(b.id).cloneNode(true);
        clone.style.viewTransitionName = 'none';
        grid.append(clone);
      } else { placed.add(b.id); moveToEnd(grid, cards.get(b.id)); }
    }
  }
}
const cssId = (s) => fold(s).replace(/[^a-z0-9]+/g, '-');

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------
const rows = new Map();

function buildRow(b) {
  return h('tr', { 'data-id': b.id, style: `view-transition-name: r-${b.id}; --hue:${hueOf(b)}` },
    h('td', { class: 'thumb' }, coverEl(b, 'thumb-img')),
    h('th', { scope: 'row' }, h('button', { type: 'button', class: 'row-link', 'data-open': b.id, text: b.title }),
      b.subtitle && h('span', { class: 'row-sub', text: b.subtitle }),
      h('span', { class: 'row-sub', text: b.authors.join(', ') })),
    h('td', {}, h('time', { datetime: `${b.year}-${String(b.date % 100).padStart(2, '0')}`, text: `${b.month ? b.month.slice(0, 3) + ' ' : ''}${b.year}` })),
    h('td', { text: b.publisher }),
    h('td', {}, h('span', { class: 'cat-dot', 'aria-hidden': 'true' }), b.category),
    h('td', { text: b.platform.join(', ') }),
    h('td', { text: b.type }),
    h('td', { class: 'num', text: b.chapters.length || '–' }),
    h('td', { class: 'tech' }, b.technologies.slice(0, 5).join(', '), b.technologies.length > 5 ? ` +${b.technologies.length - 5}` : ''),
    h('td', {}, b.repo ? h('a', { href: b.repo, target: '_blank', rel: 'noopener', text: 'GitHub', 'aria-label': `Companion repo for ${b.title}` }) : '–'),
  );
}

function renderTable(list) {
  const tbody = $('#book-table tbody');
  const visible = new Set(list.map((b) => b.id));
  for (const [id, tr] of rows) tr.hidden = !visible.has(id);
  for (const b of list) moveToEnd(tbody, rows.get(b.id));
  for (const th of $$('#book-table thead th')) {
    if (th.dataset.key === state.sort.key) th.setAttribute('aria-sort', state.sort.dir);
    else th.removeAttribute('aria-sort');
  }
}

function sortByHeader(button) {
  const key = button.closest('th').dataset.key;
  const dir = state.sort.key === key && state.sort.dir === 'ascending' ? 'descending' : 'ascending';
  state.sort = { key, dir };
  update({ animate: true });
  announce(`Sorted by ${button.textContent.trim()}, ${dir}`);
}

// ---------------------------------------------------------------------------
// Graph view (D3 force layout, loaded on demand)
// ---------------------------------------------------------------------------
let d3 = null;
const graph = { key: null, svg: null, nodes: null, sim: null };
const layoutCache = new Map(); // graphKey -> Map(node id -> [x, y]): switching back is instant and identical
const LABEL_MIN_DEGREE = 3; // tags linked to fewer books only show their label on hover/selection

async function renderGraph() {
  const host = $('#graph');
  if (!d3) {
    host.textContent = 'Loading graph…';
    try { d3 = await import(D3_URL); } catch {
      host.textContent = 'Could not load D3 from the CDN (offline?). The shelf and table views still work.';
      return;
    }
  }
  if (graph.key !== graphKey()) buildGraph();
  styleGraph();
}

const isZoned = () => state.graphLayout === 'lifecycle' && ZONED_DIMS.includes(state.graphDim);
const graphKey = () => `${state.graphDim}:${state.graphMin}:${isZoned()}`;

// Background boxes laid out like the lifecycle / undercurrents figure.
function drawZones(g, tags) {
  const perZone = new Map();
  for (const t of tags) perZone.set(t.zone, (perZone.get(t.zone) ?? 0) + 1);
  const layer = g.append('g').attr('class', 'zones').attr('aria-hidden', 'true');
  layer.append('text').attr('class', 'zone-title').attr('x', -185).attr('y', -515).attr('text-anchor', 'middle')
    .text('Data engineering lifecycle');
  layer.append('text').attr('class', 'zone-title').attr('x', 0).attr('y', 215).attr('text-anchor', 'middle').text('Undercurrents');
  layer.append('line').attr('class', 'zone-rule').attr('x1', -700).attr('x2', 700).attr('y1', 196).attr('y2', 196);
  // Flow arrows: generation → core → consumption
  layer.append('defs').append('marker').attr('id', 'zone-arrow').attr('viewBox', '0 0 10 10').attr('refX', 9).attr('refY', 5)
    .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto').append('path').attr('d', 'M0,0L10,5L0,10z');
  for (const [x1, x2, y] of [[-508, -484, -290], [412, 436, -315]]) {
    layer.append('line').attr('class', 'zone-flow').attr('x1', x1).attr('x2', x2).attr('y1', y).attr('y2', y).attr('marker-end', 'url(#zone-arrow)');
  }
  const z = layer.selectAll('g.zone').data(ZONES.filter((zz) => zz.id !== 'other' || perZone.get('other'))).join('g')
    .attr('class', (d) => `zone ${perZone.get(d.id) ? '' : 'empty'}`).style('--zc', (d) => d.color);
  z.append('rect').attr('x', (d) => d.rect[0]).attr('y', (d) => d.rect[1]).attr('width', (d) => d.rect[2]).attr('height', (d) => d.rect[3]).attr('rx', 14)
    .append('title').text((d) => (d.desc ? `${d.label}: ${d.desc}` : d.label));
  z.append('text').attr('x', (d) => d.rect[0] + 12).attr('y', (d) => d.rect[1] + 22)
    .text((d) => d.label).append('tspan').attr('class', 'zone-count').text((d) => (perZone.get(d.id) ? `  ${perZone.get(d.id)}` : ''));
}

function buildGraph() {
  const host = $('#graph');
  graph.sim?.stop();
  const facet = FACET[state.graphDim];
  const zoned = isZoned();
  const counts = new Map();
  for (const b of BOOKS) for (const v of new Set(facet.get(b))) counts.set(v, (counts.get(v) ?? 0) + 1);
  const tags = [...counts].filter(([, n]) => n >= state.graphMin);
  const nodes = [
    ...BOOKS.map((b) => ({ id: `b:${b.id}`, kind: 'book', book: b })),
    ...tags.map(([v, n]) => ({ id: `t:${v}`, kind: 'tag', value: v, degree: n, zone: zoned ? zoneOf(v) : null })),
  ];
  const cached = layoutCache.get(graphKey());
  if (cached) {
    for (const n of nodes) { const pos = cached.get(n.id); if (pos) [n.x, n.y] = pos; }
  } else if (zoned) { // seed positions near the target zone / book band so the layout settles quickly
    const rnd = d3.randomLcg(42);
    for (const n of nodes) {
      if (n.kind === 'tag') { const [cx, cy] = zoneCenter(ZONE[n.zone]); n.x = cx + (rnd() - 0.5) * 60; n.y = cy + (rnd() - 0.5) * 40; }
      else { n.x = BOOK_BAND.x[0] + rnd() * (BOOK_BAND.x[1] - BOOK_BAND.x[0]); n.y = BOOK_BAND.y[0] + rnd() * (BOOK_BAND.y[1] - BOOK_BAND.y[0]); }
    }
  }
  const tagSet = new Set(tags.map(([v]) => v));
  const links = BOOKS.flatMap((b) => [...new Set(facet.get(b))].filter((v) => tagSet.has(v)).map((v) => ({ source: `b:${b.id}`, target: `t:${v}` })));

  const width = host.clientWidth || 900;
  const height = Math.max(520, Math.min(900, innerHeight * 0.72));
  const R = 24;
  const viewBox = zoned ? [-720, -545, 1440, 1065] : [-width / 2, -height / 2, width, height];
  const svg = d3.create('svg').attr('viewBox', viewBox).attr('class', `graph-svg${zoned ? ' zoned' : ''}`)
    .attr('role', 'group').attr('aria-label', `Books linked by ${facet.label.toLowerCase()}${zoned ? ', arranged by data engineering lifecycle stage and undercurrent' : ''}`);
  svg.append('defs').append('clipPath').attr('id', 'clip-circle').attr('clipPathUnits', 'objectBoundingBox')
    .append('circle').attr('cx', 0.5).attr('cy', 0.5).attr('r', 0.5);
  const g = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.3, 4]).on('zoom', (e) => g.attr('transform', e.transform)));
  if (zoned) drawZones(g, nodes.filter((n) => n.kind === 'tag'));

  const link =g.append('g').attr('class', 'links').selectAll('line').data(links).join('line');
  const node = g.append('g').attr('class', 'nodes').selectAll('g').data(nodes, (d) => d.id).join('g')
    .attr('class', (d) => `node ${d.kind}${d.kind === 'tag' && d.degree < LABEL_MIN_DEGREE ? ' minor' : ''}`).attr('tabindex', 0).attr('role', 'button')
    .attr('aria-label', (d) => d.kind === 'book' ? `${d.book.title}, open details` : `${facet.label}: ${d.value}, ${d.degree} books, toggle filter`);

  const books = node.filter((d) => d.kind === 'book').style('--hue', (d) => hueOf(d.book));
  books.append('circle').attr('class', 'ring').attr('r', R + 3);
  books.each(function (d) {
    const sel = d3.select(this);
    if (d.book.cover) sel.append('image').attr('href', d.book.coverThumb || d.book.cover).attr('x', -R).attr('y', -R).attr('width', 2 * R).attr('height', 2 * R)
      .attr('preserveAspectRatio', 'xMidYMin slice').attr('clip-path', 'url(#clip-circle)');
    else sel.append('circle').attr('class', 'ph').attr('r', R);
  });
  books.append('title').text((d) => `${d.book.title} (${d.book.year})`);

  const tagNodes = node.filter((d) => d.kind === 'tag');
  tagNodes.append('circle').attr('r', (d) => 5 + 3.2 * Math.sqrt(d.degree));
  tagNodes.append('text').attr('dy', (d) => -(9 + 3.2 * Math.sqrt(d.degree))).attr('text-anchor', 'middle').text((d) => d.value);
  tagNodes.append('title').text((d) => `${d.value}: ${d.degree} books${d.zone ? ` · ${ZONE[d.zone].group}: ${ZONE[d.zone].label}` : ''}`);
  if (zoned) tagNodes.style('--zc', (d) => ZONE[d.zone].color);

  const activate = (d) => {
    if (d.kind === 'book') selectGraphBook(d.book.id);
    else { // tag click: single-select filter, reset book preview, list the tag's books in the panel
      state.sel = null;
      selectOnlyFilter(state.graphDim, d.value);
      state.selTag = state.filters.get(state.graphDim)?.has(d.value) ? d.value : null;
      update();
    }
  };
  node.on('click', (e, d) => { if (!e.defaultPrevented) activate(d); })
    .on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(d); } })
    .on('pointerenter focus', (e, d) => highlight(d)).on('pointerleave blur', () => highlight(null));

  const neighbors = new Map(nodes.map((n) => [n.id, new Set([n.id])]));
  for (const l of links) { neighbors.get(l.source).add(l.target); neighbors.get(l.target).add(l.source); }
  // Hover highlight, coalesced to one update per frame and ignored while dragging.
  let hlPending = null, hlFrame = 0, dragging = false;
  function highlight(d) {
    if (dragging) return;
    hlPending = d;
    if (!hlFrame) hlFrame = requestAnimationFrame(() => { hlFrame = 0; applyHighlight(hlPending); });
  }
  function applyHighlight(d) {
    svg.classed('hovering', !!d);
    if (!d) { node.classed('hl', false); link.classed('hl', false); return; }
    const nb = neighbors.get(d.id);
    node.classed('hl', (n) => nb.has(n.id));
    link.classed('hl', (l) => l.source.id === d.id || l.target.id === d.id);
  }

  const sim = d3.forceSimulation(nodes);
  if (zoned) {
    // Tags are held inside their zone; books are kept in the band between lifecycle and undercurrents.
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const keepInZones = () => {
      for (const n of nodes) {
        if (n.kind === 'tag') {
          const [x, y, w, hh] = ZONE[n.zone].rect;
          n.x = clamp(n.x, x + 16, x + w - 16); n.y = clamp(n.y, y + 44, y + hh - 12);
        } else {
          n.x = clamp(n.x, BOOK_BAND.x[0] + R, BOOK_BAND.x[1] - R); n.y = clamp(n.y, BOOK_BAND.y[0] + R, BOOK_BAND.y[1] - R);
        }
      }
    };
    sim.force('link', d3.forceLink(links).id((d) => d.id).distance(120).strength(0.08))
      .force('charge', d3.forceManyBody().strength((d) => (d.kind === 'book' ? -220 : -40)))
      .force('collide', d3.forceCollide((d) => (d.kind === 'book' ? R + 6 : 18 + 2 * Math.sqrt(d.degree))))
      .force('x', d3.forceX((d) => (d.kind === 'tag' ? zoneCenter(ZONE[d.zone])[0] : 0)).strength((d) => (d.kind === 'tag' ? 0.25 : 0.01)))
      .force('y', d3.forceY((d) => (d.kind === 'tag' ? zoneCenter(ZONE[d.zone])[1] : (BOOK_BAND.y[0] + BOOK_BAND.y[1]) / 2)).strength((d) => (d.kind === 'tag' ? 0.25 : 0.05)))
      .force('zones', keepInZones);
  } else {
    sim.force('link', d3.forceLink(links).id((d) => d.id).distance(80).strength(0.5))
      .force('charge', d3.forceManyBody().strength((d) => (d.kind === 'book' ? -320 : -160)))
      .force('collide', d3.forceCollide((d) => (d.kind === 'book' ? R + 8 : 14 + 3 * Math.sqrt(d.degree))))
      .force('x', d3.forceX().strength(0.06)).force('y', d3.forceY().strength(0.08));
  }
  // Settle the layout off-screen, then draw it once: no jitter, no animation frames.
  const render = () => {
    link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
  };
  sim.stop();
  if (!cached) {
    const ticks = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay())); // ≈300
    for (let i = 0; i < ticks; i++) sim.tick();
  } // (cached: forces were initialised when added, so links already point at node objects)
  render();
  const saveLayout = () => layoutCache.set(graphKey(), new Map(nodes.map((n) => [n.id, [n.x, n.y]])));
  saveLayout();

  // Dragging moves just that node (and its links); the rest stays put.
  node.call(d3.drag()
    .on('start', () => { dragging = true; })
    .on('drag', (e, d) => { d.x = e.x; d.y = e.y; render(); })
    .on('end', () => { dragging = false; saveLayout(); }));

  host.replaceChildren(svg.node());
  Object.assign(graph, { key: graphKey(), svg, nodes: node, links: link, sim });
}

function styleGraph() {
  if (!graph.nodes) return;
  const ok = new Set(BOOKS.filter((b) => matches(b)).map((b) => b.id));
  const sel = state.filters.get(state.graphDim) ?? new Set();
  graph.nodes.classed('dim', (d) => d.kind === 'book' && !ok.has(d.book.id))
    .classed('selected', (d) => d.kind === 'tag' && sel.has(d.value))
    .attr('aria-pressed', (d) => (d.kind === 'tag' ? String(sel.has(d.value)) : null));
  graph.links.classed('dim', (l) => !ok.has(l.source.book?.id));
  graph.nodes.classed('current', (d) => d.kind === 'book' && d.book.id === state.sel)
    .attr('aria-current', (d) => (d.kind === 'book' && d.book.id === state.sel ? 'true' : null));
  graph.links.classed('current', (l) => l.source.book?.id === state.sel);
}

// Side panel, tag mode: the selected tag as title + compact list of its (filtered) books.
function renderTagPanel(panel, tag) {
  const facet = FACET[state.graphDim];
  const zone = isZoned() ? ZONE[zoneOf(tag)] : null;
  const list = visibleBooks();
  panel.replaceChildren(h('article', { class: 'gp gp-tag', style: zone ? `--zc:${zone.color}` : '' },
    h('p', { class: 'eyebrow', text: zone ? `${facet.label} · ${zone.group}: ${zone.label}` : facet.label }),
    h('h2', { id: 'gp-title', text: tag }),
    h('p', { class: 'meta', text: `${list.length} book${list.length === 1 ? '' : 's'}${state.filters.size > 1 || state.q ? ' (with other active filters)' : ''}` }),
    h('ul', { class: 'gp-books' }, list.map((o) => h('li', {},
      h('button', { type: 'button', 'data-select': o.id, style: `--hue:${hueOf(o)}` },
        coverEl(o, 'gp-thumb'),
        h('span', {}, h('span', { class: 'gp-book-title', text: o.title }),
          h('span', { class: 'gp-book-meta', text: `${o.year} · ${o.publisher}` })))))),
    h('footer', { class: 'gp-actions' },
      h('button', { type: 'button', 'data-clear-tag': '1', text: 'Clear selection' })),
  ));
}

// Side panel: non-blocking book preview while browsing the graph.
function selectGraphBook(id) {
  state.sel = state.sel === id ? null : id;
  styleGraph();
  renderGraphPanel();
  writeHash();
  if (state.sel) announce(`Previewing ${BY_ID.get(id).title}`);
}

// The clicked tag only counts while its filter is still active (sidebar removal resets it).
function activeTag() {
  return state.selTag && state.filters.get(state.graphDim)?.has(state.selTag) ? state.selTag : null;
}

// Re-render only when what the panel shows changes; otherwise
// just refresh chip states in place so keyboard focus stays on the chip.
let panelKey = null;
const panelOpen = {};
const currentPanelKey = () => `${state.sel}:${state.graphDim}:${activeTag()}:${activeTag() && !state.sel ? visibleBooks().map((b) => b.id).join() : ''}`;
function syncGraphPanel() {
  if (currentPanelKey() !== panelKey) { renderGraphPanel(); return; }
  for (const chip of $$('#graph-panel button.chip[data-facet]')) {
    chip.setAttribute('aria-pressed', String(!!state.filters.get(chip.dataset.facet)?.has(chip.dataset.value)));
  }
}

function renderGraphPanel() {
  panelKey = currentPanelKey();
  const panel = $('#graph-panel');
  // Remember which collapsible sections were open so browsing related books keeps them open.
  for (const d of $$('details[data-sec]', panel)) panelOpen[d.dataset.sec] = d.open;
  const b = state.sel && BY_ID.get(state.sel);
  const tag = activeTag();
  if (!b && tag) { renderTagPanel(panel, tag); return; }
  if (!b) {
    panel.replaceChildren(h('div', { class: 'gp-empty' },
      h('p', { text: 'Click a cover to preview the book, or a tag node to list its books.' }),
      h('p', { class: 'muted', text: 'Click the same node again to deselect.' })));
    return;
  }
  const facet = FACET[state.graphDim];
  const shared = new Set(facet.get(b));
  const related = BOOKS.filter((o) => o !== b && facet.get(o).some((v) => shared.has(v)))
    .map((o) => ({ o, n: facet.get(o).filter((v) => shared.has(v)).length }))
    .sort((x, y) => y.n - x.n || SORTS.date(y.o, x.o)).slice(0, 6);
  panel.replaceChildren(h('article', { class: 'gp', style: `--hue:${hueOf(b)}` },
    tag && h('button', { type: 'button', class: 'gp-back', 'data-back': '1' }, `← ${tag}`),
    h('header', { class: 'gp-head' },
      coverEl(b, 'gp-cover'),
      h('div', {},
        h('p', { class: 'eyebrow', text: b.category }),
        h('h2', { id: 'gp-title', text: b.title }),
        b.subtitle && h('p', { class: 'subtitle', text: b.subtitle }))),
    h('p', { class: 'authors', text: b.authors.join(', ') }),
    h('p', { class: 'meta' }, `${b.month} ${b.year} · ${b.publisher}${b.edition ? ` · ${b.edition} ed.` : ''} · ${b.type}`),
    h('p', { class: 'summary', text: b.summary }),
    b.pictures.length ? h('details', { class: 'gp-more', 'data-sec': 'pictures', open: panelOpen.pictures ?? true },
      h('summary', { text: `Pictures (${b.pictures.length})` }), pictureThumbs(b.pictures, 'book')) : null,
    h('h3', { text: 'Platform' }), tagButtons('platform', b.platform),
    h('h3', { text: 'Technologies' }), tagButtons('technologies', b.technologies),
    h('details', { class: 'gp-more', 'data-sec': 'topics', open: !!panelOpen.topics }, h('summary', { text: `Topics (${b.topics.length})` }), tagButtons('topics', b.topics)),
    b.chapters.length ? h('details', { class: 'gp-more', 'data-sec': 'chapters', open: !!panelOpen.chapters }, h('summary', { text: `Chapters covered in deck (${b.chapters.length})` }),
      h('ol', { class: 'chapters' }, b.chapters.map((c) => h('li', { text: c })))) : null,
    related.length ? h('details', { class: 'gp-more', 'data-sec': 'related', open: !!panelOpen.related },
      h('summary', { text: `Related by ${facet.label.toLowerCase()} (${related.length})` }),
      h('ul', { class: 'gp-related' }, related.map(({ o, n }) => h('li', {},
        h('button', { type: 'button', 'data-select': o.id }, o.title, h('span', { class: 'chip-count', text: ` ${n} shared` })))))) : null,
    h('footer', { class: 'gp-actions' },
      h('button', { type: 'button', 'data-open': b.id, text: 'Full details' }),
      b.repo && h('a', { href: b.repo, target: '_blank', rel: 'noopener', text: 'Companion repo' }),
      h('button', { type: 'button', 'data-select': b.id, text: 'Close' })),
  ));
}

// ---------------------------------------------------------------------------
// Detail dialog
// ---------------------------------------------------------------------------
let dialogList = [];

function tagButtons(key, values) {
  return h('ul', { class: 'chips' }, values.map((v) =>
    h('li', {}, h('button', { type: 'button', class: 'chip', 'data-facet': key, 'data-value': v, 'aria-pressed': String(!!state.filters.get(key)?.has(v)), text: v }))));
}

function renderDialog(b) {
  const body = $('#dlg-body');
  const row = (label, value) => value && value.length !== 0 ? [h('dt', { text: label }), h('dd', {}, value)] : [];
  body.replaceChildren(h('article', { class: 'detail', style: `--hue:${hueOf(b)}` },
    coverEl(b, 'detail-cover'),
    h('div', { class: 'detail-main' },
      h('p', { class: 'eyebrow', text: `${b.category} · ${b.id}` }),
      h('h1', { id: 'dlg-title', text: b.title }),
      b.subtitle && h('p', { class: 'subtitle', text: b.subtitle }),
      h('p', { class: 'authors', text: b.authors.join(', ') }),
      h('p', { class: 'summary', text: b.summary }),
      h('dl', { class: 'facts' },
        row('Published', `${b.month} ${b.year}`),
        row('Publisher', `${b.publisher}${b.edition ? `, ${b.edition} edition` : ''}`),
        row('Type', b.type),
        row('Platform', tagButtons('platform', b.platform)),
        row('Companion repo', b.repo && h('a', { href: b.repo, target: '_blank', rel: 'noopener', text: b.repo.replace(/^https?:\/\/(www\.)?/, '') }))),
      b.pictures.length ? [h('h2', { text: `Pictures (${b.pictures.length})` }), pictureThumbs(b.pictures, 'book')] : null,
      h('h2', { text: 'Technologies' }), tagButtons('technologies', b.technologies),
      h('h2', { text: 'Topics' }), tagButtons('topics', b.topics),
      b.chapters.length ? [h('h2', { text: `Chapters covered in deck (${b.chapters.length})` }),
        h('ol', { class: 'chapters' }, b.chapters.map((c) => h('li', { text: c })))] : null,
    )));
  const i = dialogList.findIndex((x) => x.id === b.id);
  $('#dlg-pos').textContent = i >= 0 ? `${i + 1} / ${dialogList.length}` : '';
  for (const btn of $$('.dlg-nav [data-step]')) btn.disabled = i < 0 || dialogList.length < 2;
}

function openBook(id) {
  const b = BY_ID.get(id);
  if (!b) return;
  dialogList = visibleBooks();
  if (!dialogList.some((x) => x.id === id)) dialogList = [b, ...dialogList];
  state.book = id;
  renderDialog(b);
  const dlg = $('#book-dialog');
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  writeHash();
}

function stepBook(step) {
  const i = dialogList.findIndex((x) => x.id === state.book);
  if (i < 0) return;
  const next = dialogList[(i + step + dialogList.length) % dialogList.length];
  state.book = next.id;
  renderDialog(next);
  $('#book-dialog').scrollTop = 0;
  writeHash();
}

// ---------------------------------------------------------------------------
// Pictures: thumbnails, gallery view, viewer
// ---------------------------------------------------------------------------
const queryTerms = () => fold(state.q).split(/\s+/).filter(Boolean);

// Picture matching:
// - exact (default): the whole query as a phrase, on word boundaries (plural allowed), in a keyword or the caption.
//   "data engineer" matches the keyword "data engineers" but not "data engineering".
// - partial: every word somewhere in the picture's text (or the book title), e.g. "data" + "engineer…".
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let hitCache = { key: null, map: new WeakMap() };
function pictureHits(p) {
  const key = `${state.picMatch}:${state.q}`;
  if (hitCache.key !== key) hitCache = { key, map: new WeakMap() };
  if (hitCache.map.has(p)) return hitCache.map.get(p);
  const phrase = fold(state.q).trim().replace(/\s+/g, ' ');
  let hits = null;
  if (state.picMatch === 'partial') {
    const terms = phrase.split(' ');
    const title = fold(p.book.title);
    if (terms.every((t) => p.text.includes(t) || title.includes(t)) && terms.some((t) => p.text.includes(t))) {
      hits = p.keywords.filter((k) => terms.some((t) => fold(k).includes(t)));
    }
  } else {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(phrase)}(e?s)?($|[^\\p{L}\\p{N}])`, 'u');
    const kw = p.keywords.filter((k) => re.test(fold(k)));
    if (kw.length || re.test(fold(p.caption))) hits = kw;
  }
  hitCache.map.set(p, hits);
  return hits;
}
function matchingPictures(b) {
  if (!state.q.trim()) return b.pictures;
  return b.pictures.filter((p) => pictureHits(p));
}
const galleryPictures = (list = visibleBooks()) => list.flatMap((b) => matchingPictures(b));

function pictureThumbs(pics, listKind) {
  return h('ul', { class: 'pic-grid' }, pics.map((p) => h('li', {},
    h('button', { type: 'button', class: `pic-thumb k-${p.kind}`, 'data-pic': `${p.book.id}:${p.i}`, 'data-list': listKind,
      'aria-label': `${KIND_LABEL[p.kind]}${p.caption ? `: ${p.caption}` : ''}` },
      h('img', { src: p.thumbSrc, alt: '', loading: 'lazy', decoding: 'async' }),
      h('span', { class: 'pic-kind', 'aria-hidden': 'true', text: KIND_LABEL[p.kind] }),
      hitLabel(p)))));
}
// While searching: show which keyword made the picture match (or "in caption").
function hitLabel(p) {
  if (!state.q.trim()) return null;
  const hits = pictureHits(p);
  if (!hits) return null;
  const text = hits.length ? hits[0] + (hits.length > 1 ? ` +${hits.length - 1}` : '') : 'in caption';
  return h('span', { class: 'pic-hit', title: hits.join(', ') || 'Matched in the caption', text });
}

let galleryKey = null;
function renderGallery(list) {
  const terms = queryTerms();
  const sections = list.map((b) => [b, matchingPictures(b)]).filter(([, pics]) => pics.length);
  const key = state.picMatch + state.q + sections.map(([b, pics]) => b.id + pics.map((p) => p.i).join('.')).join('|');
  if (key === galleryKey) return;
  galleryKey = key;
  const root = $('#gallery');
  if (!list.length) { root.replaceChildren(); return; } // #empty explains it
  if (!sections.length) {
    root.replaceChildren(h('p', { class: 'empty', text: terms.length ? `No picture matches “${state.q}”.` : 'No pictures for these books.' }));
    return;
  }
  const nPics = sections.reduce((n, [, pics]) => n + pics.length, 0);
  const summary = terms.length ? h('p', { class: 'gal-summary' },
    h('strong', { text: `${nPics} picture${nPics === 1 ? '' : 's'}` }),
    ` match “${state.q.trim()}” in ${sections.length} book${sections.length === 1 ? '' : 's'}`,
    state.picMatch === 'exact' ? ' (exact phrase). Tick “Include partial matches” to widen.' : ' (partial words).') : null;
  root.replaceChildren(...[summary, ...sections.map(([b, pics]) => h('section', { class: 'gal-book', style: `--hue:${hueOf(b)}`, 'aria-labelledby': `gal-${b.id}` },
    h('header', { class: 'gal-head' },
      coverEl(b, 'gal-cover'),
      h('div', {},
        h('h2', { id: `gal-${b.id}` }, h('button', { type: 'button', class: 'card-link', 'data-open': b.id, text: b.title })),
        h('p', { class: 'meta' }, `${b.year} · ${b.publisher} · ${pics.length}${terms.length ? ` of ${b.pictures.length}` : ''} picture${pics.length === 1 ? '' : 's'}`,
          b.repo ? [' · ', h('a', { href: b.repo, target: '_blank', rel: 'noopener', text: 'Companion repo ↗' })] : null))),
    pictureThumbs(pics, 'gallery')))].filter(Boolean));
}

let viewerList = [];
let viewerIdx = 0;
function openPicture(ref, listKind = 'book') {
  const [bid, i] = ref.split(':');
  const b = BY_ID.get(bid);
  const pic = b?.pictures[Number(i)];
  if (!pic) return;
  viewerList = listKind === 'gallery' ? galleryPictures() : listKind === 'match' ? matchingPictures(b) : b.pictures;
  if (!viewerList.includes(pic)) viewerList = b.pictures;
  viewerIdx = viewerList.indexOf(pic);
  renderViewer();
  const dlg = $('#pic-viewer');
  if (!dlg.open) dlg.showModal();
}
function stepPicture(step) {
  if (viewerList.length < 2) return;
  viewerIdx = (viewerIdx + step + viewerList.length) % viewerList.length;
  renderViewer();
}
function renderViewer() {
  const p = viewerList[viewerIdx];
  const b = p.book;
  const repoLabel = b.repo?.replace(/^https?:\/\/(www\.)?/, '');
  const img = h('img', { class: 'pv-img', src: p.src, alt: p.caption || `${KIND_LABEL[p.kind]} — ${b.title}` });
  const zoomBtn = h('button', { type: 'button', class: 'pv-zoom', 'data-pv-zoom': '1', 'aria-pressed': 'false', text: 'Zoom to full size' });
  const q = fold(state.q);
  const hitSet = new Set(state.q.trim() ? pictureHits(p) ?? [] : []);
  $('#pv-body').replaceChildren(h('figure', { class: 'pv', style: `--hue:${hueOf(b)}` },
    h('header', { class: 'pv-head' },
      h('p', { class: 'eyebrow', text: `${KIND_LABEL[p.kind]} · ${p.file}` }),
      h('h1', { id: 'pv-title', text: b.title }), zoomBtn),
    h('div', { class: 'pv-frame' }, p.kind === 'repo' && b.repo
      ? h('a', { class: 'pv-imglink', href: b.repo, target: '_blank', rel: 'noopener', 'aria-label': `Open ${repoLabel} on GitHub` }, img)
      : img),
    h('figcaption', {},
      p.kind === 'repo' && (b.repo
        ? h('p', {}, h('a', { class: 'pv-repo', href: b.repo, target: '_blank', rel: 'noopener', text: `Open ${repoLabel} on GitHub ↗` }))
        : h('p', { class: 'muted', text: 'No repository link in the catalogue for this book.' })),
      p.caption && h('p', { class: 'pv-caption', text: p.caption }),
      p.keywords.length ? h('ul', { class: 'chips', 'aria-label': 'Keywords (click to search)' }, p.keywords.map((k) =>
        h('li', {}, h('button', { type: 'button', class: `chip${hitSet.has(k) ? ' hit' : ''}`, 'data-kw': k, 'aria-pressed': String(!!q && fold(k) === q), text: k })))) : null,
      h('p', {}, h('button', { type: 'button', class: 'linkish', 'data-open-book': b.id, text: 'Book details' })))));
  $('#pv-pos').textContent = `${viewerIdx + 1} / ${viewerList.length}`;
  for (const btn of $$('[data-pv-step]')) btn.disabled = viewerList.length < 2;
}

// Search everything (books + pictures) for a keyword and show the matching pictures.
function searchKeyword(k) {
  state.q = k;
  $('#q').value = k;
  for (const d of $$('dialog[open]')) d.close();
  setView('pictures');
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function announce(msg) { $('#status').textContent = msg; }

function update({ animate = false } = {}) {
  const list = visibleBooks();
  const apply = () => {
    if (state.view === 'shelf') renderShelf(list);
    if (state.view === 'table') renderTable(list);
    if (state.view === 'pictures') renderGallery(list);
  };
  withTransition(apply, animate && state.view !== 'graph');
  if (state.view === 'graph') { renderGraph(); syncGraphPanel(); }
  updateFacets();
  updateActiveFilters();
  const text = `${list.length} of ${BOOKS.length} books`;
  $('#result-count').textContent = text;
  $('#empty').hidden = list.length > 0 || ['graph', 'game'].includes(state.view);
  const hint = $('#pic-hint');
  const nPics = state.q && !['pictures', 'game'].includes(state.view) ? galleryPictures(list).length : 0;
  hint.hidden = !nPics;
  hint.textContent = `${nPics} matching picture${nPics === 1 ? '' : 's'} →`;
  announce(text);

  const sortVal = `${state.sort.key}:${state.sort.dir}`;
  const select = $('#shelf-sort');
  let custom = $('option[data-custom]', select);
  if (![...select.options].some((o) => !o.dataset.custom && o.value === sortVal)) {
    if (!custom) { custom = h('option', { 'data-custom': '1' }); select.append(custom); }
    custom.value = sortVal;
    custom.textContent = `Table order (${state.sort.key}, ${state.sort.dir})`;
  } else custom?.remove();
  select.value = sortVal;
  $('#shelf-group').value = state.group;
  $('#graph-dim').value = state.graphDim;
  $('#graph-min').value = state.graphMin;
  $('#graph-layout').value = state.graphLayout;
  $('#pic-partial').checked = state.picMatch === 'partial';
  $('#graph-layout-ctl').hidden = !ZONED_DIMS.includes(state.graphDim);
  writeHash();
}

function setView(view) {
  state.view = view;
  for (const b of $$('.views button')) b.setAttribute('aria-pressed', b.dataset.view === view);
  for (const s of $$('.view')) s.hidden = s.id !== `view-${view}`;
  for (const c of $$('.view-controls')) c.hidden = c.dataset.for !== view;
  document.body.dataset.view = view;
  update();
  if (view === 'game') startGameView(); else game?.pause();
}

// Typing game: loaded on first visit.
let game = null;
async function startGameView() {
  if (!game) {
    const { createGame } = await import('./game.js');
    game = createGame($('#game'), {
      wordsUrl: '../seed/index-referential.json',
      visibleBookIds: () => new Set(visibleBooks().map((b) => b.id)),
      titleOf: (id) => BY_ID.get(id)?.title ?? id,
      openBook,
    });
  }
  game.show();
}

function wireEvents() {
  for (const b of $$('.views button')) b.addEventListener('click', () => withTransition(() => setView(b.dataset.view)));

  const q = $('#q');
  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = q.value.trim(); update(); }, 120);
  });

  $('#shelf-sort').addEventListener('change', (e) => {
    const [key, dir] = e.target.value.split(':');
    state.sort = { key, dir };
    update({ animate: true });
  });
  $('#shelf-group').addEventListener('change', (e) => { state.group = e.target.value; update({ animate: true }); });
  $('#graph-dim').addEventListener('change', (e) => { state.graphDim = e.target.value; update(); });
  $('#toggle-filters').addEventListener('click', (e) => {
    const show = !document.body.classList.contains('show-filters');
    document.body.classList.toggle('show-filters', show);
    e.currentTarget.setAttribute('aria-expanded', String(show));
    if (show) $('#filters-details').open = true;
    if (state.view === 'graph' && !isZoned()) { graph.key = null; renderGraph(); } // free layout sizes to the container
  });
  $('#graph-layout').addEventListener('change', (e) => { state.graphLayout = e.target.value; update(); });
  $('#pic-partial').addEventListener('change', (e) => { state.picMatch = e.target.checked ? 'partial' : 'exact'; update(); });
  $('#graph-min').addEventListener('change', (e) => { state.graphMin = Math.max(1, Math.min(6, Number(e.target.value) || 1)); update(); });

  // Table header sort via invoker commands, with click fallback.
  const table = $('#book-table');
  table.addEventListener('command', (e) => { if (e.command === '--sort') sortByHeader(e.source); });
  if (!('commandForElement' in HTMLButtonElement.prototype)) {
    for (const btn of $$('button[command="--sort"]', table)) btn.addEventListener('click', () => sortByHeader(btn));
  }

  document.addEventListener('click', (e) => {
    const pic = e.target.closest('[data-pic]');
    if (pic) { openPicture(pic.dataset.pic, pic.dataset.list); return; }
    const picsOf = e.target.closest('[data-pics-of]');
    if (picsOf) { const b = BY_ID.get(picsOf.dataset.picsOf); const m = matchingPictures(b); openPicture(`${b.id}:${(m[0] ?? b.pictures[0]).i}`, m.length ? 'match' : 'book'); return; }
    const kw = e.target.closest('[data-kw]');
    if (kw) { searchKeyword(kw.dataset.kw); return; }
    const ob = e.target.closest('[data-open-book]');
    if (ob) { $('#pic-viewer').close(); openBook(ob.dataset.openBook); return; }
    if (e.target.closest('#pic-hint')) { withTransition(() => setView('pictures')); return; }
    const open = e.target.closest('[data-open]');
    if (open) { openBook(open.dataset.open); return; }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      if (rm.dataset.remove === 'q') { state.q = ''; $('#q').value = ''; } else toggleFilter(rm.dataset.remove, rm.dataset.value, false);
      update({ animate: true });
      $('#q').focus();
      return;
    }
    if (e.target.closest('[data-action="clear"]')) {
      state.filters.clear(); state.q = ''; $('#q').value = '';
      update({ animate: true });
    }
  });

  $('#graph-panel').addEventListener('click', (e) => {
    const chip = e.target.closest('button.chip[data-facet]');
    if (chip) { toggleFilter(chip.dataset.facet, chip.dataset.value); update(); return; }
    const sel = e.target.closest('[data-select]');
    if (sel) { selectGraphBook(sel.dataset.select); return; }
    if (e.target.closest('[data-back]')) { state.sel = null; styleGraph(); renderGraphPanel(); writeHash(); return; }
    if (e.target.closest('[data-clear-tag]')) {
      state.filters.get(state.graphDim)?.delete(activeTag());
      if (!state.filters.get(state.graphDim)?.size) state.filters.delete(state.graphDim);
      state.selTag = null; state.sel = null;
      update();
    }
  });

  const dlg = $('#book-dialog');
  dlg.addEventListener('click', (e) => {
    const chip = e.target.closest('button.chip[data-facet]');
    if (chip) { toggleFilter(chip.dataset.facet, chip.dataset.value, true); dlg.close(); update({ animate: true }); return; }
    const step = e.target.closest('[data-step]');
    if (step) stepBook(Number(step.dataset.step));
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); stepBook(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepBook(-1); }
  });
  dlg.addEventListener('close', () => { state.book = null; writeHash(); });

  const pv = $('#pic-viewer');
  pv.addEventListener('click', (e) => {
    const step = e.target.closest('[data-pv-step]');
    if (step) stepPicture(Number(step.dataset.pvStep));
    // Zoom: the button, or a click on the picture itself (the repo picture keeps its link).
    const zoomBtn = e.target.closest('[data-pv-zoom]');
    if (zoomBtn || (e.target.matches('.pv-img') && !e.target.closest('a'))) {
      const fig = $('.pv', pv);
      const on = !fig.classList.contains('zoomed');
      fig.classList.toggle('zoomed', on);
      const btn = $('[data-pv-zoom]', pv);
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? 'Fit to screen' : 'Zoom to full size';
    }
  });
  pv.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); stepPicture(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepPicture(-1); }
  });

  // Light-dismiss fallback where <dialog closedby> is unsupported.
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    for (const d of $$('dialog[closedby="any"]')) {
      const outside = (e) => {
        const r = d.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      let pressedOutside = false;
      d.addEventListener('pointerdown', (e) => { pressedOutside = outside(e); });
      d.addEventListener('pointerup', (e) => { if (pressedOutside && outside(e)) d.close(); });
    }
  }
  // Invoker commands fallback for the dialogs' Close buttons.
  if (!('commandForElement' in HTMLButtonElement.prototype)) {
    $('.dlg-close').addEventListener('click', () => dlg.close());
    $('.pv-close').addEventListener('click', () => pv.close());
  }

  // Collapse the filter panel by default on narrow screens.
  const narrow = matchMedia('(width < 860px)');
  const syncPanel = () => { $('#filters-details').open = !narrow.matches; };
  narrow.addEventListener('change', syncPanel);
  syncPanel();

  let rt;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (state.view === 'graph') { graph.key = null; renderGraph(); } }, 250);
  });
}

async function main() {
  let text;
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(res.status);
    text = await res.text();
  } catch {
    $('#main').replaceChildren(h('p', { class: 'empty' },
      'Could not load ', h('code', { text: CSV_URL }), '. Serve the repository root over HTTP, e.g. ',
      h('code', { text: 'python3 -m http.server 8000' }), ', then open ', h('code', { text: 'http://localhost:8000/app/' }), '.'));
    return;
  }
  let media = {};
  let coverThumbs = {};
  try {
    const res = await fetch(MEDIA_URL);
    if (res.ok) ({ books: media = {}, covers: coverThumbs = {} } = await res.json());
  } catch { /* pictures are optional */ }
  BOOKS = toBooks(parseCSV(text), media, coverThumbs);
  BY_ID = new Map(BOOKS.map((b) => [b.id, b]));
  await resolveCovers(BOOKS);

  const cats = [...new Set(BOOKS.map((b) => b.category))].sort(collator.compare);
  catHue = new Map(cats.map((c, i) => [c, Math.round((i * 360) / cats.length + 200) % 360]));

  const years = BOOKS.map((b) => b.year).filter(Boolean);
  const techCount = new Set(BOOKS.flatMap((b) => b.technologies)).size;
  const topicCount = new Set(BOOKS.flatMap((b) => b.topics)).size;
  const picCount = BOOKS.reduce((n, b) => n + b.pictures.length, 0);
  $('#stats').textContent = `${BOOKS.length} books · ${picCount} pictures · ${Math.min(...years)}–${Math.max(...years)} · ${techCount} technologies · ${topicCount} topics · ${new Set(BOOKS.map((b) => b.publisher)).size} publishers`;

  for (const b of BOOKS) { cards.set(b.id, buildCard(b)); rows.set(b.id, buildRow(b)); }
  const tbody = $('#book-table tbody');
  for (const b of BOOKS) tbody.append(rows.get(b.id));

  // Keyword suggestions for the search box: tags + picture keywords.
  const kws = new Map();
  for (const b of BOOKS) for (const k of [...b.technologies, ...b.topics, ...b.pictures.flatMap((p) => p.keywords)]) kws.set(fold(k), kws.get(fold(k)) ?? k);
  $('#kw-list').replaceChildren(...[...kws.values()].sort(collator.compare).map((k) => h('option', { value: k })));

  buildFacets();
  wireEvents();
  readHash();
  $('#q').value = state.q;
  setView(state.view);
  if (state.book) openBook(state.book);

  addEventListener('hashchange', () => {
    readHash();
    $('#q').value = state.q;
    setView(state.view);
    if (state.book) openBook(state.book); else if ($('#book-dialog').open) $('#book-dialog').close();
  });
}

main();
