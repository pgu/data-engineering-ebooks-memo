#!/usr/bin/env node
// Builds the static data files the web app reads (GitHub Pages can't list directories):
//   seed/media.json            pictures per ebook folder + per-picture keywords (from seed/keywords/*.json)
//   seed/index-referential.json  merged, cleaned index.js keywords bucketed by length (typing game)
//   seed/keyword-groups.json     keyword groups (e.g. "Data quality" → data quality checks, AWS Glue Data Quality…);
//                                hand-editable: rebuilds keep your names / include / exclude / rejected
//   ebook-covers/<folder>/thumbs/*.avif, ebook-covers/thumbs/*.avif  small AVIF thumbnails (macOS `sips`)
// Run from the repo root:  node tools/build-data.mjs

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const COVERS = join(ROOT, 'ebook-covers');
const KW_DIR = join(ROOT, 'seed', 'keywords');
const IMG = /\.(png|jpe?g|webp|gif|avif)$/i;

// Deck ids, from the CSV "Picture cover" (col 4) and "Deck ID" (col 5) columns.
function deckIdsByFolder() {
  const csv = readFileSync(join(ROOT, 'seed', 'data-engineering-ebooks.csv'), 'utf8');
  const map = {};
  for (const line of csv.split('\n').slice(1)) {
    const m = line.match(/^(?:"[^"]*"|[^,]*),[^,]*,[^,]*,([^,]*),([^,]*),/);
    if (m) map[m[1].replace(/\.[a-z]+$/i, '')] = m[2];
  }
  return map;
}
const DECK = deckIdsByFolder();
const THUMBS = 'thumbs';
const folders = readdirSync(COVERS).filter((d) => d !== THUMBS && statSync(join(COVERS, d)).isDirectory()).sort();

// ---------------------------------------------------------------------------
// 0. Thumbnails: AVIF, downscaled to `width`; regenerated only when the source is newer.
// ---------------------------------------------------------------------------
let hasSips = true;
try { execFileSync('sips', ['--help'], { stdio: 'ignore' }); } catch { hasSips = false; console.warn('! sips not found (macOS only): thumbnails skipped'); }
let thumbsMade = 0;
function thumb(srcAbs, dir, width) {
  const name = srcAbs.split('/').pop().replace(/\.[a-z]+$/i, '.avif');
  const out = join(dir, name);
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(srcAbs).mtimeMs) return name;
  if (!hasSips) return null;
  mkdirSync(dir, { recursive: true });
  const w = Number(execFileSync('sips', ['-g', 'pixelWidth', srcAbs]).toString().match(/pixelWidth: (\d+)/)?.[1] ?? 0);
  const args = ['-s', 'format', 'avif', '-s', 'formatOptions', '70'];
  if (w > width) args.push('--resampleWidth', String(width));
  execFileSync('sips', [...args, srcAbs, '--out', out], { stdio: 'ignore' });
  thumbsMade++;
  return name;
}
const PICTURE_THUMB_W = 480; // grids show ~120–240 CSS px, so 2× density
const COVER_THUMB_W = 160; // graph nodes, table rows, panel lists
const coverThumbs = {};
for (const f of readdirSync(COVERS).filter((f) => IMG.test(f))) {
  const t = thumb(join(COVERS, f), join(COVERS, THUMBS), COVER_THUMB_W);
  if (t) coverThumbs[f.replace(/\.[a-z]+$/i, '')] = `${THUMBS}/${t}`;
}

// ---------------------------------------------------------------------------
// 1. Media manifest
// ---------------------------------------------------------------------------
const kindOf = (f) => (/^gh\./i.test(f) ? 'repo' : /^memo0\./i.test(f) ? 'chapters' : 'memo');
const orderOf = (f) => (kindOf(f) === 'chapters' ? -2 : kindOf(f) === 'repo' ? -1 : Number(f.match(/\d+/)?.[0] ?? 999));

const media = {};
const bookKeywords = {};
for (const folder of folders) {
  const files = readdirSync(join(COVERS, folder)).filter((f) => IMG.test(f));
  const kwFile = join(KW_DIR, `${folder}.json`);
  const kw = existsSync(kwFile) ? JSON.parse(readFileSync(kwFile, 'utf8')) : null;
  const byFile = Object.fromEntries((kw?.images ?? []).map((i) => [i.file, i]));
  media[folder] = {
    deckId: DECK[folder] ?? kw?.deckId ?? null,
    images: files.sort((a, b) => orderOf(a) - orderOf(b)).map((file) => ({
      file,
      thumb: (() => { const t = thumb(join(COVERS, folder, file), join(COVERS, folder, THUMBS), PICTURE_THUMB_W); return t && `${THUMBS}/${t}`; })(),
      kind: kindOf(file),
      caption: byFile[file]?.caption ?? '',
      keywords: byFile[file]?.keywords ?? [],
    })),
    technologies: kw?.technologies ?? [],
    topics: kw?.topics ?? [],
    providers: kw?.providers ?? [],
  };
  if (!kw) console.warn(`! no keywords yet for ${folder}`);
  bookKeywords[folder] = kw;
}
writeFileSync(join(ROOT, 'seed', 'media.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), covers: coverThumbs, books: media }, null, 1) + '\n');
console.log(`thumbnails: ${thumbsMade} generated`);
console.log(`media.json: ${folders.length} folders, ${Object.values(media).reduce((n, b) => n + b.images.length, 0)} pictures`);

// ---------------------------------------------------------------------------
// 2. Index referential (typing game)
// ---------------------------------------------------------------------------
const MAX_LEN = 25;
const BUCKETS = [['easy', 10], ['medium', 20], ['hard', MAX_LEN]];

// Sub-entry fragments of a back-of-book index ("of cloud services", "with Apache Superset").
const LEADING_STOP = /^(of|as|with|in|for|to|on|from|using|versus|vs|and|or|by|via|at|into|over|the|a|an|see|when|is|its|it|between|without|within|under|about|per|through|how|what|why|vs\.|compared|example|examples|overview|benefits)\b/i;
const TRAILING_STOP = /\s+(versus|vs|on|in|for|of|with|to|and|or|from|by|via|at|using|as|the|a|an)$/i;
const PERSON = /^[A-Z][a-z'-]+,\s+[A-Z][a-z'.-]+(\s+[A-Z][a-z.]*)*$/; // "Devlin, Barry"
const GENERIC = new Set(['data', 'advantage', 'advantages', 'disadvantages', 'problem', 'problems', 'challenges', 'benefit', 'considerations', 'concepts', 'components', 'options', 'types', 'features', 'tools', 'steps', 'process', 'approach', 'approaches', 'limitations', 'requirements', 'patterns', 'best practices']);
// Tokens that make a term data-engineering relevant.
const LEXICON = new RegExp('\\b(' + [
  'data\\w*', 'table\\w*', 'quer\\w*', 'sql', 'schema\\w*', 'stream\\w*', 'pipeline\\w*', 'partition\\w*', 'cluster\\w*',
  'lake\\w*', 'warehous\\w*', 'lakehouse\\w*', 'storage', 'store\\w*', 'file\\w*', 'format\\w*', 'catalog\\w*', 'model\\w*',
  'index\\w*', 'transaction\\w*', 'replica\\w*', 'consisten\\w*', 'cach\\w*', 'batch\\w*', 'event\\w*', 'log\\w*', 'join\\w*',
  'key\\w*', 'column\\w*', 'row\\w*', 'metadata', 'job\\w*', 'task\\w*', 'dag\\w*', 'workflow\\w*', 'orchestrat\\w*',
  'ingest\\w*', 'automat\\w*', 'distribut\\w*', 'concurren\\w*', 'parallel\\w*', 'fault\\w*', 'partition\\w*', 'etl', 'elt', 'load\\w*', 'transform\\w*', 'cloud', 'comput\\w*', 'node\\w*', 'shard\\w*', 'encrypt\\w*',
  'secur\\w*', 'access', 'governance', 'quality', 'lineage', 'analytic\\w*', 'dashboard\\w*', 'report\\w*', 'semantic\\w*',
  'measure\\w*', 'dimension\\w*', 'fact\\w*', 'api\\w*', 'function\\w*', 'notebook\\w*', 'spark', 'python', 'ml', 'ai',
  'llm\\w*', 'vector\\w*', 'embedding\\w*', 'agent\\w*', 'prompt\\w*', 'serverless', 'scal\\w*', 'latency', 'throughput',
  'write\\w*', 'read\\w*', 'update\\w*', 'delete\\w*', 'merge\\w*', 'insert\\w*', 'upsert\\w*', 'snapshot\\w*', 'version\\w*',
  'compaction', 'vacuum', 'bucket\\w*', 'object\\w*', 'blob\\w*', 'database\\w*', 'server\\w*', 'service\\w*', 'endpoint\\w*',
  'permission\\w*', 'polic\\w*', 'monitor\\w*', 'observab\\w*', 'alert\\w*', 'test\\w*', 'validat\\w*', 'contract\\w*',
  'mesh', 'fabric', 'architect\\w*', 'layer\\w*', 'bronze', 'silver', 'gold', 'medallion', 'aggregat\\w*', 'window\\w*',
  'trigger\\w*', 'checkpoint\\w*', 'watermark\\w*', 'offset\\w*', 'topic\\w*', 'queue\\w*', 'message\\w*', 'broker\\w*',
  'consumer\\w*', 'producer\\w*', 'sink\\w*', 'source\\w*', 'connector\\w*', 'driver\\w*', 'executor\\w*', 'shuffl\\w*',
  'serializ\\w*', 'encod\\w*', 'compress\\w*', 'hash\\w*', 'tree\\w*', 'graph\\w*', 'lock\\w*', 'isolation', 'durab\\w*',
  'atomic\\w*', 'idempoten\\w*', 'deduplicat\\w*', 'backfill\\w*', 'incremental', 'cdc', 'scd', 'olap', 'oltp', 'acid',
  'metric\\w*', 'kpi\\w*', 'bi', 'visual\\w*', 'chart\\w*', 'pivot\\w*', 'view\\w*', 'procedure\\w*', 'udf\\w*', 'sampl\\w*',
  'training', 'inference', 'feature\\w*', 'deploy\\w*', 'ci', 'cd', 'devops', 'dataops', 'mlops', 'iac', 'terraform',
  'container\\w*', 'kubernetes', 'docker', 'warehouse', 'mart\\w*', 'cube\\w*', 'normal\\w*', 'denormal\\w*', 'lakeflow',
  'cost\\w*', 'pricing', 'billing', 'capacity', 'workspace\\w*', 'credential\\w*', 'token\\w*', 'auth\\w*', 'iam', 'role\\w*',
  'privacy', 'gdpr', 'pii', 'mask\\w*', 'audit\\w*', 'retention', 'backup\\w*', 'recovery', 'failover', 'availability',
  'consensus', 'leader\\w*', 'quorum', 'gossip', 'clock\\w*', 'timestamp\\w*', 'time', 'schedul\\w*', 'cron', 'retr\\w*',
  'error\\w*', 'exception\\w*', 'debug\\w*', 'profil\\w*', 'optimi\\w*', 'tuning', 'performance', 'predicate\\w*', 'pushdown',
  'skew', 'spill\\w*', 'memory', 'disk', 'cpu', 'gpu', 'json', 'csv', 'parquet', 'avro', 'orc', 'xml', 'yaml', 'sdk', 'cli',
].join('|') + ')\\b', 'i');

const DICT = new Set(
  existsSync('/usr/share/dict/words')
    ? readFileSync('/usr/share/dict/words', 'utf8').split('\n').filter((w) => w && w === w.toLowerCase())
    : [],
);

function candidates(raw) {
  let s = raw.normalize('NFKC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').trim();
  if (/pagination|page numbers/i.test(s) || PERSON.test(s)) return [];
  s = s.replace(/^(.*)\[(.+)\]$/, '$2'); // ".help command[help command]" → "help command"
  s = s.replace(/\[([^\]]+)\]/g, '$1').replace(/"/g, '');
  const inner = [];
  s = s.replace(/\(([^()]*)\)/g, (_, g) => { inner.push(...g.split(/\s*,\s*/)); return ' '; });
  const base = s.split(/\s*[,;:]\s*/)[0];
  return [base, ...inner]
    .map((t) => t.replace(/^\s*(and|or)\s+/i, '').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+#)]+$/g, '').replace(/\s+/g, ' ').trim())
    .map((t) => { while (TRAILING_STOP.test(t)) t = t.replace(TRAILING_STOP, ''); return t; });
}

function acceptable(t) {
  if (t.length < 2 || t.length > MAX_LEN) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9 .\-/&+#_']*$/.test(t)) return false;
  if (/^\d[\d .\-/]*$/.test(t)) return false; // pure numbers / dates
  if (LEADING_STOP.test(t)) return false;
  if (/\b(chapter|figure|appendix|case study|book|author|reader)s?\b/i.test(t)) return false;
  return true;
}

function relevant(t, nBooks) {
  const lower = t.toLowerCase();
  if (GENERIC.has(lower)) return false;
  const single = !t.includes(' ');
  // A plain English word that isn't data-engineering vocabulary: drop, unless capitalised and shared ("Airflow").
  if (single && DICT.has(lower) && !LEXICON.test(t) && !(/^[A-Z]/.test(t) && nBooks >= 2)) return false;
  // Inverted index sub-entries ("building in Airflow", "granting in Unity Catalog", "types of time").
  if (nBooks < 3 && /\s(in|into|with|by|than|for|to|from|on|of|within|inside|without)\s|\sused$/i.test(t)) return false;
  if (nBooks >= 2) return true;
  if (/[A-Z]/.test(t.replace(/^./, ''))) return true; // inner capitals: product names, acronyms
  if (/^[A-Z]{2,}/.test(t)) return true;
  if (LEXICON.test(t)) return true;
  const words = t.split(' ');
  if (words.length === 1) return !DICT.has(t.toLowerCase()); // jargon ("upsert") yes, plain English ("consequences") no
  return false;
}

const singular = (w) => (w.length > 3 && /ies$/.test(w) ? w.slice(0, -3) + 'y'
  : w.length > 3 && /(ss|us|is|xes)$/.test(w) ? w.replace(/xes$/, 'x')
  : w.length > 3 && /s$/.test(w) ? w.slice(0, -1) : w);
const keyOf = (t) => t.toLowerCase().replace(/'s\b/g, '').replace(/[-_/.]/g, ' ').split(/\s+/).filter(Boolean).map(singular).join(' ');
const PREFIX = /^(apache|amazon|aws|azure|google|microsoft|databricks|snowflake) /;

function lev1(a, b) { // edit distance ≤ 1
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Collect: key → { variants: Map(text → count), books: Set }
const groups = new Map();
let rawCount = 0;
for (const folder of folders) {
  const f = join(COVERS, folder, 'index.js');
  if (!existsSync(f)) continue;
  const id = DECK[folder] ?? folder;
  const entries = JSON.parse(readFileSync(f, 'utf8'));
  rawCount += entries.length;
  for (const raw of entries) {
    for (const t of candidates(raw)) {
      if (!acceptable(t)) continue;
      const k = keyOf(t);
      if (!k) continue;
      const g = groups.get(k) ?? { variants: new Map(), books: new Set() };
      g.variants.set(t, (g.variants.get(t) ?? 0) + 1);
      g.books.add(id);
      groups.set(k, g);
    }
  }
}

// Merge "very similar": space-insensitive keys, vendor-prefixed duplicates, 1-edit typos on long terms.
const mergeInto = (from, to) => {
  const a = groups.get(from), b = groups.get(to);
  if (!a || !b || a === b) return;
  for (const [t, n] of a.variants) b.variants.set(t, (b.variants.get(t) ?? 0) + n);
  a.books.forEach((x) => b.books.add(x));
  groups.delete(from);
};
const bySquash = new Map();
for (const k of [...groups.keys()]) {
  const sq = k.replace(/ /g, '');
  if (bySquash.has(sq)) mergeInto(k, bySquash.get(sq)); else bySquash.set(sq, k);
}
for (const k of [...groups.keys()]) {
  const m = k.match(PREFIX);
  if (m && groups.has(k.slice(m[0].length))) mergeInto(k.slice(m[0].length), k); // keep the full product name
}
const keys = [...groups.keys()].sort();
for (let i = 0; i < keys.length; i++) {
  const a = keys[i];
  if (!groups.has(a) || a.length < 7) continue;
  for (let j = i + 1; j < keys.length && keys[j].slice(0, 3) === a.slice(0, 3); j++) {
    const b = keys[j];
    if (groups.has(b) && b.length >= 7 && lev1(a, b) && !/\d/.test(a + b)) mergeInto(b, a);
  }
}

const pickDisplay = (variants) => [...variants].sort((x, y) => y[1] - x[1]
  || (/[A-Z]/.test(y[0]) - /[A-Z]/.test(x[0])) // prefer capitalised product spelling on ties
  || x[0].length - y[0].length)[0][0];

const words = [];
for (const g of groups.values()) {
  const term = pickDisplay(g.variants);
  if (!relevant(term, g.books.size)) continue;
  const bucket = BUCKETS.find(([, max]) => term.length <= max)[0];
  words.push({ term, length: term.length, bucket, books: [...g.books].sort() });
}
words.sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));

const counts = Object.fromEntries(BUCKETS.map(([b]) => [b, words.filter((w) => w.bucket === b).length]));
writeFileSync(join(ROOT, 'seed', 'index-referential.json'), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: 'ebook-covers/*/index.js, cleaned by tools/build-data.mjs',
  buckets: Object.fromEntries(BUCKETS.map(([b, max]) => [b, { maxLength: max, count: counts[b] }])),
  words,
}) + '\n');
console.log(`index-referential.json: ${rawCount} raw entries → ${words.length} keywords`, counts);

// ---------------------------------------------------------------------------
// 3. Keyword groups (search one notion, get all its variants)
// ---------------------------------------------------------------------------
// Universe: book-level technologies/topics + per-picture keywords (seed/keywords) + CSV Topics/Technologies.
const GROUPS_FILE = join(ROOT, 'seed', 'keyword-groups.json');
const variants = new Map(); // folded -> Map(display -> count)
const addKw = (k) => {
  const d = k.trim(); const f = d.toLowerCase();
  if (!f) return;
  const m = variants.get(f) ?? new Map(); m.set(d, (m.get(d) ?? 0) + 1); variants.set(f, m);
};
for (const kw of Object.values(bookKeywords)) {
  if (!kw) continue;
  kw.technologies.forEach(addKw); kw.topics.forEach(addKw); kw.images.forEach((i) => i.keywords.forEach(addKw));
}
for (const line of readFileSync(join(ROOT, 'seed', 'data-engineering-ebooks.csv'), 'utf8').split('\n').slice(1)) {
  const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) ?? [];
  for (const i of [10, 12]) (cells[i] ?? '').split(';').forEach(addKw); // Topics, Technologies
}
const display = (f) => [...(variants.get(f) ?? new Map([[f, 1]]))].sort((a, b) => b[1] - a[1] || /^[A-Z]/.test(b[0]) - /^[A-Z]/.test(a[0]))[0][0];
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRe = (pat) => new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(pat.toLowerCase())}(e?s)?($|[^\\p{L}\\p{N}])`, 'u');
const universe = [...variants.keys()];
const membersOf = (g) => {
  const ex = new Set((g.exclude ?? []).map((x) => x.toLowerCase()));
  const set = new Set(g.pattern ? universe.filter((k) => phraseRe(g.pattern).test(k)) : []);
  for (const x of g.include ?? []) set.add(x.toLowerCase());
  return [...set].filter((k) => !ex.has(k)).sort().map(display);
};
// Too broad to be a useful notion on their own.
const NEVER = new Set(['data', 'table', 'tables', 'query', 'queries', 'file', 'files', 'model', 'models', 'cloud', 'sql', 'python', 'api',
  'job', 'jobs', 'pipeline', 'pipelines', 'layer', 'service', 'services', 'function', 'functions', 'architecture', 'management', 'security',
  'performance', 'storage', 'analytics', 'processing', 'engineering', 'design', 'pattern', 'patterns', 'tools', 'time', 'schema', 'catalog',
  'format', 'formats', 'apache', 'aws', 'azure', 'amazon', 'google', 'microsoft', 'snowflake', 'databricks', 'fabric', 'spark', 'integration']);

const saved = existsSync(GROUPS_FILE) ? JSON.parse(readFileSync(GROUPS_FILE, 'utf8')) : null;
const rejected = saved?.rejected ?? ['generation', 'load', 'transform', 'tag', 'task', 'stream', 'infrastructure', 'trigger', 'workload', 'capacity'];
const groupsOut = (saved?.groups ?? []).map((g) => ({ ...g, members: membersOf(g) }));
const known = new Set([...groupsOut.map((g) => g.pattern?.toLowerCase()).filter(Boolean), ...rejected.map((r) => r.toLowerCase())]);
// Propose new groups: an existing keyword (or its singular) found as a whole phrase in ≥ 3 keywords, ≤ 40.
const singularOf = (k) => k.replace(/(?<=[a-z]{3})(ies)$/, 'y').replace(/(?<=[a-z]{3})(?<!s)s$/, '');
const seenSig = new Set(groupsOut.map((g) => g.members.map((m) => m.toLowerCase()).sort().join('|')));
const proposals = [];
for (const pat of [...new Set(universe.flatMap((k) => [singularOf(k), k]))].sort((a, b) => a.length - b.length)) {
  if (NEVER.has(pat) || NEVER.has(pat + 's') || known.has(pat) || known.has(singularOf(pat)) || pat.length < 3) continue;
  const g = { name: '', pattern: pat, include: [], exclude: [], auto: true };
  g.members = membersOf(g);
  if (g.members.length < 3 || g.members.length > 40) continue;
  const sig = g.members.map((m) => m.toLowerCase()).sort().join('|');
  if (seenSig.has(sig)) continue; // same notion as a shorter pattern (e.g. "databases" vs "database")
  seenSig.add(sig); known.add(pat);
  const shown = display(pat);
  g.name = shown === pat ? shown.charAt(0).toUpperCase() + shown.slice(1) : shown;
  proposals.push(g);
}
const allGroups = [...groupsOut, ...proposals].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
writeFileSync(GROUPS_FILE, JSON.stringify({
  about: 'Keyword groups used by the search. Edit freely, then run node tools/build-data.mjs (members are recomputed, your edits are kept). '
    + 'name: label shown in search. pattern: whole-phrase match on all keywords (plurals included); null = only "include". '
    + 'include / exclude: keywords to add / remove by hand. To drop a group for good, delete it AND add its pattern to "rejected" '
    + '(otherwise it is proposed again). "auto": true = proposed by the script (harmless to keep or remove).',
  rejected,
  groups: allGroups.map(({ name, pattern, include, exclude, auto, members }) => ({ name, pattern, include, exclude, ...(auto ? { auto } : {}), members })),
}, null, 1) + '\n');
console.log(`keyword-groups.json: ${allGroups.length} groups (${proposals.length} new), ${universe.length} keywords`);
