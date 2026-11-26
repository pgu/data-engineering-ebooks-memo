// "Pipeline Rush" typing game. Keywords (from the books' indexes) flow as data packets down
// pipeline lanes; type a packet's keyword to load it before it reaches the sink.
// Words come from seed/index-referential.json (built by tools/build-data.mjs).

const LANES = 5;
const LIVES = 3;
const WORDS_PER_LEVEL = 8;
const MODES = {
  easy: { label: 'Easy', hint: 'up to 10 characters', buckets: () => ['easy'] },
  medium: { label: 'Medium', hint: 'up to 20 characters', buckets: () => ['medium'] },
  hard: { label: 'Hard', hint: 'up to 25 characters', buckets: () => ['hard'] },
  progressive: { label: 'Progressive', hint: 'easy → medium → hard as you level up',
    buckets: (level) => (level <= 3 ? ['easy'] : level <= 6 ? ['medium'] : ['hard']) },
};

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
  e.append(...children.flat().filter((c) => c != null && c !== false));
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
  board.append(...Array.from({ length: LANES }, (_, i) => el('div', { class: 'gm-lane', style: `--lane:${i}` })),
    el('div', { class: 'gm-sink', text: 'sink' }));
  root.replaceChildren(el('div', { class: 'gm' }, setup, hud, el('div', { class: 'gm-stage' }, board, overlay), inputRow, logBox, live));

  function bestKey(mode) { return `pipeline-rush-best:${mode}`; }

  function pool(level) {
    const buckets = MODES[g.mode].buckets(level);
    const ids = g.onlyFiltered ? visibleBookIds() : null;
    let list = words.filter((w) => buckets.includes(w.bucket) && (!ids || w.books.some((b) => ids.has(b))));
    if (list.length < 12) list = words.filter((w) => buckets.includes(w.bucket)); // too few: fall back to all books
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
      el('span', { class: 'muted', text: MODES[g.mode].label }),
    );
  }
  const wpm = () => (g.activeMs > 3000 ? Math.round((g.correctKeys / 5) / (g.activeMs / 60000)) : 0);
  const accuracy = () => (g.correctKeys + g.mistakes ? Math.round((100 * g.correctKeys) / (g.correctKeys + g.mistakes)) : 100);

  // ---------- game loop ----------
  function nextWord() {
    const buckets = MODES[g.mode].buckets(g.level).join();
    if (!g.bags[buckets]?.length) g.bags[buckets] = shuffle([...pool(g.level)]);
    const onBoard = new Set(g.packets.map((p) => norm(p.word.term)));
    const bag = g.bags[buckets];
    for (let i = bag.length - 1; i >= 0; i--) {
      // Avoid two packets on board sharing a prefix (typing would be ambiguous).
      const t = norm(bag[i].term);
      if (![...onBoard].some((o) => o.startsWith(t.slice(0, 2)))) return bag.splice(i, 1)[0];
    }
    return bag.pop();
  }

  function spawn() {
    const used = new Set(g.packets.map((p) => p.lane));
    const free = [...Array(LANES).keys()].filter((l) => !used.has(l));
    if (!free.length) return;
    const word = nextWord();
    if (!word) return;
    const lane = free[Math.floor(Math.random() * free.length)];
    const typed = el('span', { class: 'typed' });
    const rest = el('span', { class: 'rest', text: word.term });
    const node = el('div', { class: `gm-packet b-${word.bucket}`, style: `--lane:${lane}` }, typed, rest);
    board.append(node);
    const travel = Math.max(5, 15 - g.level * 0.8) * (1 + Math.max(0, word.term.length - 8) / 25); // seconds to cross
    g.packets.push({ word, lane, node, typed, rest, x: -node.offsetWidth, travel });
  }

  function tick(now) {
    g.raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - g.last) / 1000);
    g.last = now;
    if (!g.running || g.paused) return;
    g.activeMs += dt * 1000;
    const width = board.clientWidth;
    g.spawnIn -= dt;
    const maxOnBoard = Math.min(2 + Math.ceil(g.level / 2), LANES);
    if ((g.spawnIn <= 0 && g.packets.length < maxOnBoard) || !g.packets.length) {
      spawn();
      g.spawnIn = Math.max(0.9, 3.2 - g.level * 0.22);
    }
    for (const p of [...g.packets]) {
      if (!g.running) break; // jammed during this frame
      p.x += (width / p.travel) * dt;
      p.node.style.transform = `translateX(${p.x}px)`;
      if (p.x + p.node.offsetWidth >= width) lose(p);
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
  // The most advanced packet whose keyword starts with what was typed.
  const targetFor = (v) => g.packets.filter((p) => norm(p.word.term).startsWith(v)).sort((a, b) => b.x - a.x)[0] ?? null;

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
