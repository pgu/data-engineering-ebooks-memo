// "Pipeline Rush" typing game. Keywords (from the books' indexes) flow as data packets down
// the pipeline from top to bottom; type a packet's keyword to load it before it reaches the sink.
// Words come from seed/index-referential.json (built by tools/build-data.mjs).

const MAX_ON_BOARD = 6;
const LIVES = 3;
const WORDS_PER_LEVEL = 8;
// Progressive: share of short (≤10) / medium (≤20) / long (≤25) keywords per level; the last row repeats.
const MIX = [
  { easy: 1 },
  { easy: 0.8, medium: 0.2 },
  { easy: 0.6, medium: 0.4 },
  { easy: 0.4, medium: 0.5, hard: 0.1 },
  { easy: 0.3, medium: 0.5, hard: 0.2 },
  { easy: 0.2, medium: 0.5, hard: 0.3 },
  { easy: 0.15, medium: 0.45, hard: 0.4 },
  { easy: 0.1, medium: 0.4, hard: 0.5 },
];
const MODES = {
  easy: { label: 'Easy', hint: 'up to 10 characters', mix: () => ({ easy: 1 }) },
  medium: { label: 'Medium', hint: 'up to 20 characters', mix: () => ({ medium: 1 }) },
  hard: { label: 'Hard', hint: 'up to 25 characters', mix: () => ({ hard: 1 }) },
  progressive: { label: 'Progressive', hint: 'short words first, then a growing mix of longer ones',
    mix: (level) => MIX[Math.min(level, MIX.length) - 1] },
};
const SIZE_LABEL = { easy: 'short', medium: 'medium', hard: 'long' };
// Seconds for a packet to fall: faster each level, slower for longer keywords (5 chars ≈ ×1, 25 chars ≈ ×1.5).
const travelTime = (level, term) => Math.max(5, 15 - level * 0.8) * (0.875 + term.length / 40);
function pickBucket(mix) {
  let r = Math.random();
  for (const [b, w] of Object.entries(mix)) if ((r -= w) <= 0) return b;
  return Object.keys(mix).at(-1);
}

const norm = (s) => s.toLowerCase();
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k in e && !k.startsWith('aria-') && !k.startsWith('data-')) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return e;
}
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function createGame(root, { wordsUrl, visibleBookIds, titleOf, openBook }) {
  let words = null; // [{ term, length, bucket, books }]
  let loadError = null;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const g = {
    running: false, paused: false, mode: 'progressive', onlyFiltered: false,
    level: 1, score: 0, lives: LIVES, combo: 0, cleared: 0, correctKeys: 0, mistakes: 0,
    activeMs: 0, packets: [], bags: {}, spawnIn: 0, last: 0, missed: [], log: [], raf: 0,
  };

  // ---------- DOM ----------
  const live = el('p', { class: 'visually-hidden', role: 'status' });
  const setup = el('div', { class: 'gm-setup' });
  const hud = el('div', { class: 'gm-hud', hidden: true });
  const board = el('div', { class: 'gm-board', hidden: true, 'aria-hidden': 'true' });
  const input = el('input', { class: 'gm-input', type: 'text', autocomplete: 'off', autocapitalize: 'off',
    'aria-label': 'Type the keyword of a packet', placeholder: 'Type a keyword…' });
  input.spellcheck = false;
  const inputRow = el('div', { class: 'gm-input-row', hidden: true }, input,
    el('button', { type: 'button', class: 'gm-pause', text: 'Pause', 'data-gm': 'pause' }));
  const logBox = el('ol', { class: 'gm-log', hidden: true, 'aria-label': 'Loaded keywords' });
  const overlay = el('div', { class: 'gm-overlay', hidden: true });
  const sink = el('div', { class: 'gm-sink', text: 'sink' });
  board.append(sink);
  // Visual theme (this browser only).
  const THEMES = { neon: 'Neon grid', retro: 'Retro terminal', classic: 'Classic' };
  const THEME_KEY = 'pipeline-rush-theme';
  const savedTheme = store.get(THEME_KEY);
  const themeSelect = el('select', { 'data-gm': 'theme' },
    Object.entries(THEMES).map(([k, label]) => el('option', { value: k, text: label })));
  themeSelect.value = THEMES[savedTheme] ? savedTheme : 'neon';
  const shell = el('div', { class: 'gm', 'data-theme': themeSelect.value });
  themeSelect.addEventListener('change', () => {
    shell.dataset.theme = themeSelect.value;
    store.set(THEME_KEY, themeSelect.value);
  });
  root.replaceChildren(shell);
  shell.append(el('div', { class: 'gm-top' }, el('label', { class: 'gm-theme' }, 'Theme ', themeSelect)), setup, hud, el('div', { class: 'gm-stage' }, board, overlay), inputRow, logBox, live);

  function bestKey(mode) { return `pipeline-rush-best:${mode}`; }
  // Score history (this browser only): every finished game, newest first, capped.
  const HISTORY_KEY = 'pipeline-rush-history';
  const HISTORY_MAX = 100;
  const history = () => (Array.isArray(store.get(HISTORY_KEY)) ? store.get(HISTORY_KEY) : []);
  const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  function historyTable() {
    const all = history();
    if (!all.length) return el('p', { class: 'muted', text: 'No games played yet in this browser.' });
    const filter = g.historyMode;
    const rows = all.filter((r) => !filter || r.mode === filter);
    const top = [...rows].sort((a, b) => b.score - a.score || a.at.localeCompare(b.at)).slice(0, 10);
    const latest = all[0]?.at;
    return el('div', { class: 'gm-history-body' },
      el('div', { class: 'gm-history-tabs', role: 'group', 'aria-label': 'Show scores for' },
        [['', 'All modes'], ...Object.entries(MODES).map(([k, m]) => [k, m.label])].map(([k, label]) =>
          el('button', { type: 'button', 'data-gm-hist': k, 'aria-pressed': String((filter ?? '') === k), text: label }))),
      top.length ? el('table', { class: 'gm-history-table' },
        el('caption', { class: 'visually-hidden', text: 'Top scores' }),
        el('thead', {}, el('tr', {}, ['#', 'Score', 'Mode', 'Level', 'Keywords', 'WPM', 'Accuracy', 'Date'].map((t) => el('th', { scope: 'col', text: t })))),
        el('tbody', {}, top.map((r, i) => el('tr', { class: r.at === latest ? 'latest' : null },
          el('td', { text: i + 1 }), el('td', {}, el('strong', { text: r.score })), el('td', { text: MODES[r.mode]?.label ?? r.mode }),
          el('td', { text: r.level }), el('td', { text: r.cleared }), el('td', { text: r.wpm }), el('td', { text: `${r.accuracy}%` }),
          el('td', {}, el('time', { datetime: r.at, text: dateFmt.format(new Date(r.at)) }), r.at === latest ? el('span', { class: 'gm-latest', text: 'last game' }) : null)))))
        : el('p', { class: 'muted', text: 'No games in this mode yet.' }),
      el('p', { class: 'muted gm-history-foot' }, `${all.length} game${all.length === 1 ? '' : 's'} saved in this browser · `,
        el('button', { type: 'button', class: 'linkish', 'data-gm': 'clear-history', text: 'Clear history' })));
  }

  function pool(bucket) {
    const ids = g.onlyFiltered ? visibleBookIds() : null;
    let list = words.filter((w) => w.bucket === bucket && (!ids || w.books.some((b) => ids.has(b))));
    if (list.length < 12) list = words.filter((w) => w.bucket === bucket); // too few: fall back to all books
    return list;
  }

  function renderSetup(summary = g.summary) {
    const ids = visibleBookIds();
    const filteredCount = words ? words.filter((w) => w.books.some((b) => ids.has(b))).length : 0;
    const counts = words ? Object.fromEntries(['easy', 'medium', 'hard'].map((b) => [b, words.filter((w) => w.bucket === b).length])) : {};
    setup.replaceChildren(...[
      el('h2', { text: summary ? 'Pipeline jammed!' : 'Pipeline Rush' }),
      summary
        ? el('div', { class: 'gm-summary' },
          el('p', { class: 'gm-big', text: `${summary.score} points` }),
          el('p', { text: `Level ${summary.level} · ${summary.cleared} keywords loaded · ${summary.wpm} WPM · ${summary.accuracy}% accuracy${summary.best ? ' · new best!' : ''}` }),
          summary.missed.length ? el('details', { class: 'gm-missed' },
            el('summary', { text: `Keywords that reached the sink (${summary.missed.length})` }),
            el('ul', {}, summary.missed.map((w) => el('li', {}, el('strong', { text: w.term }), ' — ',
              w.books.slice(0, 3).map((id, i) => [i ? ', ' : '', el('button', { type: 'button', class: 'linkish', 'data-gm-book': id, text: titleOf(id) })]),
              w.books.length > 3 ? ` +${w.books.length - 3}` : '')))) : null)
        : el('p', { class: 'gm-intro', text: 'Keywords from the books’ indexes flow down the pipeline as data packets. Type a keyword to load its packet before it reaches the sink. Three packets lost and the pipeline jams.' }),
      loadError ? el('p', { class: 'empty', text: `Could not load the keyword referential (${loadError}).` }) : null,
      el('fieldset', { class: 'gm-modes' }, el('legend', { text: 'Difficulty' }),
        Object.entries(MODES).map(([k, m]) => el('label', {},
          el('input', { type: 'radio', name: 'gm-mode', value: k, checked: g.mode === k }),
          el('span', {}, el('strong', { text: m.label }), ` ${m.hint}`,
            counts[k] != null ? el('span', { class: 'muted', text: ` · ${counts[k]} words` }) : null,
            store.get(bestKey(k)) ? el('span', { class: 'muted', text: ` · best ${store.get(bestKey(k))}` }) : null)))),
      el('label', { class: 'gm-check' },
        el('input', { type: 'checkbox', checked: g.onlyFiltered, 'data-gm': 'filtered' }),
        ` Only keywords from the books currently filtered (${ids.size} book${ids.size === 1 ? '' : 's'}, ${filteredCount} words)`),
      el('p', {}, el('button', { type: 'button', class: 'gm-start', 'data-gm': 'start', disabled: !words, text: summary ? 'Play again' : 'Start' })),
      el('section', { class: 'gm-history', 'aria-labelledby': 'gm-history-title' },
        el('h3', { id: 'gm-history-title', text: 'Best scores' }), historyTable()),
    ].filter(Boolean)); // optional parts are null: don't render them as text
  }

  function renderHud() {
    hud.replaceChildren(
      el('span', {}, 'Score ', el('strong', { text: g.score })),
      el('span', {}, 'Level ', el('strong', { text: g.level })),
      el('span', { class: 'gm-lives', 'aria-label': `${g.lives} lives` }, '♥'.repeat(g.lives) + '♡'.repeat(LIVES - g.lives)),
      el('span', {}, 'Combo ', el('strong', { text: `×${g.combo}` })),
      el('span', {}, el('strong', { text: wpm() }), ' WPM'),
      el('span', {}, el('strong', { text: `${accuracy()}%` }), ' accuracy'),
      el('span', { class: 'muted', text: g.mode === 'progressive'
        ? `Mix: ${Object.entries(MODES.progressive.mix(g.level)).map(([b, w]) => `${Math.round(w * 100)}% ${SIZE_LABEL[b]}`).join(' · ')}`
        : MODES[g.mode].label }),
    );
  }
  const wpm = () => (g.activeMs > 3000 ? Math.round((g.correctKeys / 5) / (g.activeMs / 60000)) : 0);
  const accuracy = () => (g.correctKeys + g.mistakes ? Math.round((100 * g.correctKeys) / (g.correctKeys + g.mistakes)) : 100);

  // ---------- game loop ----------
  function nextWord() {
    const bucket = pickBucket(MODES[g.mode].mix(g.level));
    if (!g.bags[bucket]?.length) g.bags[bucket] = shuffle([...pool(bucket)]);
    const onBoard = new Set(g.packets.map((p) => norm(p.word.term)));
    const bag = g.bags[bucket];
    for (let i = bag.length - 1; i >= 0; i--) {
      // Avoid two packets on board sharing a prefix (typing would be ambiguous).
      const t = norm(bag[i].term);
      if (![...onBoard].some((o) => o.startsWith(t.slice(0, 2)))) return bag.splice(i, 1)[0];
    }
    return bag.pop();
  }

  function spawn() {
    const word = nextWord();
    if (!word) return false;
    const typed = el('span', { class: 'typed' });
    const rest = el('span', { class: 'rest', text: word.term });
    const node = el('div', { class: `gm-packet b-${word.bucket}` }, typed, rest);
    board.append(node);
    const w = node.offsetWidth, hgt = node.offsetHeight, width = board.clientWidth;
    const fall = board.clientHeight - sink.offsetHeight;
    const travel = travelTime(g.level, word.term);
    const speed = fall / travel;
    // Columns to avoid: packets still near the top, and slower packets this one would catch up with before the sink.
    const busy = g.packets.filter((p) => {
      if (p.y < hgt * 1.8) return true;
      const pSpeed = fall / p.travel;
      if (speed <= pSpeed) return false;
      const catchUp = (p.y - 6) / (speed - pSpeed); // gap between its top and our bottom (we start at -hgt)
      return catchUp < (fall - p.y - p.node.offsetHeight) / pSpeed;
    }).map((p) => [p.x - 8, p.x + p.node.offsetWidth + 8]);
    let x = null;
    for (let i = 0; i < 12 && x == null; i++) {
      const c = Math.random() * Math.max(0, width - w);
      if (!busy.some(([a, b]) => c < b && c + w > a)) x = c;
    }
    if (x == null) { node.remove(); g.bags[word.bucket]?.push(word); return false; }
    g.packets.push({ word, node, typed, rest, x, y: -hgt, travel });
    node.style.transform = `translate(${x}px, ${-hgt}px)`;
    return true;
  }

  function tick(now) {
    g.raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - g.last) / 1000);
    g.last = now;
    if (!g.running || g.paused) return;
    g.activeMs += dt * 1000;
    const fall = board.clientHeight - sink.offsetHeight; // distance to the sink
    g.spawnIn -= dt;
    const maxOnBoard = Math.min(2 + Math.ceil(g.level / 2), MAX_ON_BOARD);
    if ((g.spawnIn <= 0 && g.packets.length < maxOnBoard) || !g.packets.length) {
      if (spawn()) g.spawnIn = Math.max(0.9, 3.2 - g.level * 0.22);
    }
    for (const p of [...g.packets]) {
      if (!g.running) break; // jammed during this frame
      p.y += (fall / p.travel) * dt;
      p.node.style.transform = `translate(${p.x}px, ${p.y}px)`;
      if (p.y + p.node.offsetHeight >= fall) lose(p);
    }
  }

  function lose(p) {
    if (!g.running) return;
    removePacket(p, 'lost');
    g.lives -= 1;
    g.combo = 0;
    g.missed.push(p.word);
    input.value = '';
    refreshHighlights();
    renderHud();
    if (g.lives <= 0) gameOver(); else live.textContent = `Packet lost: ${p.word.term}. ${g.lives} lives left.`;
  }

  function removePacket(p, cls) {
    g.packets.splice(g.packets.indexOf(p), 1);
    p.node.classList.add(cls);
    setTimeout(() => p.node.remove(), reduceMotion.matches ? 0 : 280);
  }

  function refreshHighlights() {
    const v = norm(input.value);
    const target = v ? targetFor(v) : null;
    for (const p of g.packets) {
      const on = p === target;
      p.node.classList.toggle('target', on);
      p.typed.textContent = on ? p.word.term.slice(0, v.length) : '';
      p.rest.textContent = on ? p.word.term.slice(v.length) : p.word.term;
    }
  }
  // The lowest packet whose keyword starts with what was typed.
  const targetFor = (v) => g.packets.filter((p) => norm(p.word.term).startsWith(v)).sort((a, b) => b.y - a.y)[0] ?? null;

  let prev = '';
  input.addEventListener('input', () => {
    if (!g.running || g.paused) { input.value = prev; return; }
    const v = norm(input.value);
    if (v.length < prev.length) { prev = input.value; refreshHighlights(); return; } // backspace
    const target = v ? targetFor(v) : null;
    if (v && !target) {
      g.mistakes += 1;
      g.combo = 0;
      input.value = prev;
      if (!reduceMotion.matches) { inputRow.classList.remove('shake'); void inputRow.offsetWidth; inputRow.classList.add('shake'); }
      renderHud();
      return;
    }
    g.correctKeys += v.length - norm(prev).length;
    prev = input.value;
    if (target && norm(target.word.term) === v) clear(target);
    refreshHighlights();
  });

  function clear(p) {
    removePacket(p, 'loaded');
    g.combo += 1;
    g.cleared += 1;
    g.score += Math.round(p.word.term.length * g.level * (1 + Math.min(g.combo, 10) * 0.1));
    input.value = '';
    prev = '';
    const books = p.word.books;
    logBox.prepend(el('li', {}, el('strong', { text: p.word.term }), ' — ',
      el('button', { type: 'button', class: 'linkish', 'data-gm-book': books[0], text: titleOf(books[0]) }),
      books.length > 1 ? el('span', { class: 'muted', text: ` +${books.length - 1} more book${books.length > 2 ? 's' : ''}` }) : null));
    while (logBox.children.length > 6) logBox.lastChild.remove();
    if (g.cleared % WORDS_PER_LEVEL === 0) {
      g.level += 1;
      live.textContent = `Level ${g.level}`;
      board.classList.remove('levelup'); void board.offsetWidth; board.classList.add('levelup');
    }
    renderHud();
  }

  function start() {
    for (const p of g.packets) p.node.remove();
    Object.assign(g, { running: true, paused: false, level: 1, score: 0, lives: LIVES, combo: 0, cleared: 0,
      correctKeys: 0, mistakes: 0, activeMs: 0, packets: [], bags: {}, spawnIn: 0, missed: [], summary: null, last: performance.now() });
    logBox.replaceChildren();
    setup.hidden = true; overlay.hidden = true;
    hud.hidden = board.hidden = inputRow.hidden = logBox.hidden = false;
    renderHud();
    input.value = ''; prev = '';
    input.focus();
    cancelAnimationFrame(g.raf);
    g.raf = requestAnimationFrame(tick);
  }

  function gameOver() {
    g.running = false;
    cancelAnimationFrame(g.raf);
    const best = store.get(bestKey(g.mode)) ?? 0;
    const isBest = g.score > best;
    if (isBest) store.set(bestKey(g.mode), g.score);
    for (const p of [...g.packets]) removePacket(p, 'lost');
    hud.hidden = board.hidden = inputRow.hidden = logBox.hidden = true;
    setup.hidden = false;
    g.summary = { score: g.score, level: g.level, cleared: g.cleared, wpm: wpm(), accuracy: accuracy(), best: isBest, missed: g.missed };
    if (g.score > 0 || g.cleared > 0) {
      const { score, level, cleared, wpm: w, accuracy: acc } = g.summary;
      store.set(HISTORY_KEY, [{ score, mode: g.mode, level, cleared, wpm: w, accuracy: acc, at: new Date().toISOString() }, ...history()].slice(0, HISTORY_MAX));
    }
    renderSetup();
    live.textContent = `Game over. ${g.score} points.`;
    setup.querySelector('[data-gm="start"]')?.focus();
  }

  function pause() {
    if (!g.running || g.paused) return;
    g.paused = true;
    overlay.hidden = false;
    overlay.replaceChildren(el('p', { text: 'Paused' }),
      el('button', { type: 'button', class: 'gm-start', 'data-gm': 'resume', text: 'Resume' }),
      el('button', { type: 'button', 'data-gm': 'quit', text: 'End game' }));
  }
  function resume() {
    if (!g.running) return;
    g.paused = false;
    overlay.hidden = true;
    g.last = performance.now();
    input.focus();
  }

  // ---------- events ----------
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-gm]')?.dataset.gm;
    if (a === 'start') start();
    if (a === 'pause') pause();
    if (a === 'resume') resume();
    if (a === 'quit') { g.lives = 0; gameOver(); }
    if (a === 'clear-history' && confirm('Delete all saved Pipeline Rush scores in this browser?')) {
      store.set(HISTORY_KEY, []);
      for (const k of Object.keys(MODES)) store.set(bestKey(k), null);
      renderSetup();
    }
    const hist = e.target.closest('[data-gm-hist]');
    if (hist) { g.historyMode = hist.dataset.gmHist || null; renderSetup(); setup.querySelector(`[data-gm-hist="${hist.dataset.gmHist}"]`)?.focus(); }
    const book = e.target.closest('[data-gm-book]');
    if (book) { pause(); openBook(book.dataset.gmBook); }
  });
  root.addEventListener('change', (e) => {
    if (e.target.name === 'gm-mode') g.mode = e.target.value;
    if (e.target.dataset.gm === 'filtered') { g.onlyFiltered = e.target.checked; renderSetup(); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); pause(); }
    if (e.key === 'Enter') { e.preventDefault(); input.value = ''; prev = ''; refreshHighlights(); }
  });
  board.addEventListener('pointerdown', (e) => { e.preventDefault(); input.focus(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  async function load() {
    try {
      const res = await fetch(wordsUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      words = (await res.json()).words;
    } catch (err) { loadError = err.message; }
    if (!g.running) renderSetup();
  }

  renderSetup();
  const loading = load();

  return {
    async show() {
      await loading;
      if (!g.running) renderSetup();
      else if (g.paused) overlay.querySelector('[data-gm="resume"]')?.focus();
    },
    pause,
  };
}
