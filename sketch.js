// Pixel Tapestry — github.com/sycrus/pixel-tapestry (ADR-026).
// 5x5 pixel tiles, each symmetric left-right and top-bottom, laid out in a
// grid and reflected into four quadrants: a kaleidoscope of glyphs.
//
// Carpets (ADR-030): grayscale designs where each cell's level picks a tile
// of matching ink from tiles.js. Deployed (no ?edit), the sketch plays the
// carpets saved in settings.js — hold, morph to the next, repeat — with no
// UI. Edit mode (?edit, added by the site adapter under `next dev`) is the
// carpet editor: paint on the tapestry, manage carpets, tune the morph, save.

const EDIT_MODE = new URLSearchParams(location.search).has('edit');

const DIMS_MIN = 1;
const DIMS_MAX = 12;
const BRUSH_MAX = 5;

let dims = clampInt(SETTINGS.dims, DIMS_MIN, DIMS_MAX, 4); // tiles per quadrant side
let patternSeed = Number.isInteger(SETTINGS.seed) ? SETTINGS.seed : 1;
const morphCfg = {
  duration: clampNum(SETTINGS.morph?.duration, 0, 8, 2.5), // seconds
  hold: clampNum(SETTINGS.morph?.hold, 0, 8, 2), // seconds on each carpet
  spread: clampNum(SETTINGS.morph?.spread, 0, 1, 0.6), // per-cell stagger
};
const carpets = (SETTINGS.carpets ?? []).map(decodeCarpet).filter(Boolean);

// what's on screen: carpet `target` (-1 = the seed's random pattern), and
// while morphT < 1, a morph into it from the `fromTiles` snapshot
let target = carpets.length ? 0 : -1;
let fromTiles = null;
let morphT = 1;
let playing = !EDIT_MODE && carpets.length > 1;
let holdLeft = morphCfg.hold;

// editor state
const brush = { level: LEVELS - 1, size: 1, mirror: false };
let grayView = false;
let showGuides = true; // xy axes + tile grid over the canvas
let recording = false; // true while record loop plays; painting and keys off
let onLoopEnd = null; // record loop: called when the cycle lands back on carpet 1
let dirty = false;
let lastPaint = null; // last painted cell of the current stroke
let hovering = false; // pointer over the canvas — shows the brush cursor

// each tile's black cells as column * 5 + row, for the renderer
const TILE_CELLS = Array.from({ length: TILE_COUNT }, (_, id) => {
  const cells = [];
  tileColumns(id).forEach((col, j) => {
    for (let i = 0; i < 5; i++) if (col[i] === '0') cells.push(j * 5 + i);
  });
  return cells;
});

function clampNum(v, lo, hi, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function clampInt(v, lo, hi, fallback) {
  return Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function gridN() {
  return dims * 2;
}

function setup() {
  const s = min(windowWidth, windowHeight);
  createCanvas(s, s);
  noLoop(); // redraws on change; loops only while something moves
  if (EDIT_MODE) {
    guidesEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    guidesEl.id = 'guides';
    document.body.appendChild(guidesEl);
    createControls();
    canvas.addEventListener('mouseenter', () => { hovering = true; });
    canvas.addEventListener('mouseleave', () => { hovering = false; syncReadout(); redraw(); });
    window.addEventListener('beforeunload', (e) => {
      if (dirty) e.preventDefault();
    });
  }
  if (playing) loop();
}

// --- what each cell shows -------------------------------------------------

function targetTile(c, r, n) {
  if (target < 0) return randomTile(patternSeed, c, r, n);
  return pickTile(sampleCarpet(carpets[target], c, r, n), patternSeed, c, r, n);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// mid-morph, a cell walks from its old tile's ink to its new tile's through
// the buckets between, keeping each endpoint's exact tile while at its level
function tileAt(c, r, n) {
  if (morphT >= 1 || !fromTiles) return targetTile(c, r, n);
  const h = cellHash(patternSeed, foldCell(c, n), foldCell(r, n));
  const tc = cellProgress(smoothstep(morphT), morphCfg.spread, h);
  const from = fromTiles[r * n + c];
  if (tc <= 0) return from;
  const to = targetTile(c, r, n);
  if (tc >= 1) return to;
  const level = Math.round(TILE_LEVEL[from] + (TILE_LEVEL[to] - TILE_LEVEL[from]) * tc);
  if (level === TILE_LEVEL[from]) return from;
  if (level === TILE_LEVEL[to]) return to;
  return pickTile(level, patternSeed, c, r, n);
}

function snapshotTiles(n) {
  const tiles = new Int16Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) tiles[r * n + c] = tileAt(c, r, n);
  return tiles;
}

function settle() {
  morphT = 1;
  fromTiles = null;
}

function morphTo(index) {
  fromTiles = snapshotTiles(gridN());
  target = index;
  morphT = morphCfg.duration > 0 ? 0 : 1;
  holdLeft = morphCfg.hold;
  if (morphT >= 1) arrived();
  syncMenu();
  loop();
}

// a morph has landed on `target`
function arrived() {
  settle();
  if (onLoopEnd && target === 0) {
    const done = onLoopEnd;
    onLoopEnd = null;
    done();
  }
}

function animating() {
  return morphT < 1 || (playing && carpets.length > 1);
}

function advance(dt) {
  if (morphT < 1) {
    morphT = Math.min(1, morphT + dt / morphCfg.duration);
    if (morphT >= 1) arrived();
    return;
  }
  if (playing && carpets.length > 1) {
    holdLeft -= dt;
    if (holdLeft <= 0) morphTo((target + 1) % carpets.length);
  }
}

// --- drawing --------------------------------------------------------------

function draw() {
  advance(Math.min(deltaTime / 1000, 0.1));

  const ctx = drawingContext;
  const n = gridN();
  const cells = n * 5;
  // pixel-snapped cell edges, so fractional sizes never seam
  const edges = Array.from({ length: cells + 1 }, (_, k) => Math.round((k * width) / cells));

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const id = tileAt(c, r, n);
      if (grayView) {
        ctx.fillStyle = grayOf(TILE_LEVEL[id]);
        ctx.fillRect(edges[c * 5], edges[r * 5], edges[c * 5 + 5] - edges[c * 5], edges[r * 5 + 5] - edges[r * 5]);
        continue;
      }
      for (const cell of TILE_CELLS[id]) {
        const x = c * 5 + Math.floor(cell / 5);
        const y = r * 5 + (cell % 5);
        ctx.fillRect(edges[x], edges[y], edges[x + 1] - edges[x], edges[y + 1] - edges[y]);
      }
    }
  }

  if (EDIT_MODE) renderGuides(n, edges);
  if (!animating()) noLoop();
}

function mouseCell(n) {
  if (mouseX < 0 || mouseY < 0 || mouseX >= width || mouseY >= height) return null;
  return { c: Math.floor((mouseX / width) * n), r: Math.floor((mouseY / height) * n) };
}

// every cell a dab at (c, r) touches, mirrors included
function brushCells(c, r, n) {
  const lo = -Math.floor((brush.size - 1) / 2);
  const out = new Map();
  for (let dr = lo; dr < lo + brush.size; dr++) {
    for (let dc = lo; dc < lo + brush.size; dc++) {
      const x = c + dc;
      const y = r + dr;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const spots = brush.mirror
        ? [[x, y], [n - 1 - x, y], [x, n - 1 - y], [n - 1 - x, n - 1 - y]]
        : [[x, y]];
      for (const [px, py] of spots) out.set(py * n + px, [px, py]);
    }
  }
  return [...out.values()];
}

// a cell's coordinate counted out from the mirror axis: 4 3 2 1 | 1 2 3 4,
// so mirrored cells share a number (negative left of / above the axis)
function axisCoord(i, n) {
  return i < n / 2 ? i - Math.floor(n / 2) : i - Math.floor(n / 2) + 1;
}

// Edit-mode guides live on an SVG layer over the canvas, never on the
// canvas itself, so the facet capture, save png and record loop (which all
// read the canvas) can't pick them up: a faint tile grid, the two mirror
// axes, tile numbers counted out from the axes, and a crosshair plus brush
// outline on the hovered cell.
let guidesEl;
let guidesKey = ''; // what the layer last drew, to skip identical rebuilds

function renderGuides(n, edges) {
  const at = hovering && !recording && mouseCell(n);
  const key = [showGuides, n, width, at && at.c, at && at.r, brush.size, brush.mirror].join();
  if (key === guidesKey) return;
  guidesKey = key;

  const RED = '229 72 77';
  const tileEdge = (i) => edges[i * 5];
  const parts = [];
  if (at) {
    for (const [x, y] of brushCells(at.c, at.r, n)) {
      const x0 = tileEdge(x);
      const y0 = tileEdge(y);
      parts.push(`<rect x="${x0 + 0.5}" y="${y0 + 0.5}" width="${tileEdge(x + 1) - x0 - 1}" height="${tileEdge(y + 1) - y0 - 1}" fill="none" stroke="rgb(${RED})"/>`);
    }
  }
  if (showGuides) {
    if (at) {
      const fill = `rgb(${RED} / 0.08)`;
      parts.unshift(
        `<rect x="${tileEdge(at.c)}" y="0" width="${tileEdge(at.c + 1) - tileEdge(at.c)}" height="${height}" fill="${fill}"/>`,
        `<rect x="0" y="${tileEdge(at.r)}" width="${width}" height="${tileEdge(at.r + 1) - tileEdge(at.r)}" fill="${fill}"/>`,
      );
    }
    let grid = '';
    for (let i = 1; i < n; i++) {
      const e = tileEdge(i) + 0.5;
      grid += `M${e} 0V${height}M0 ${e}H${width}`;
    }
    const mid = tileEdge(n / 2) + 0.5;
    parts.push(
      `<path d="${grid}" stroke="rgb(${RED} / 0.28)"/>`,
      `<path d="M${mid} 0V${height}M0 ${mid}H${width}" stroke="rgb(${RED} / 0.9)"/>`,
    );
    // labels in each tile's top-left corner, haloed white to read on ink
    const label = (text, x, y, hot) =>
      `<text x="${x}" y="${y}" fill="rgb(${RED} / ${hot ? 1 : 0.75})">${text}</text>`;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(axisCoord(i, n));
      parts.push(label(v, tileEdge(i) + 3, 2, at && at.c === i));
      if (i > 0) parts.push(label(v, 2, tileEdge(i) + 2, at && at.r === i));
    }
    parts.push(label('x', mid + 3, 12, false), label('y', 2, mid + 12, false));
  }
  guidesEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
  guidesEl.innerHTML = parts.join('');
}

// --- editing --------------------------------------------------------------

function markDirty() {
  dirty = true;
  syncMenu();
}

// the carpet a stroke paints into; painting over the random pattern first
// captures it as a new carpet, so its texture becomes a starting point
function editableCarpet() {
  playing = false;
  if (morphT < 1) settle();
  if (target < 0) {
    const n = gridN();
    const levels = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) levels[r * n + c] = TILE_LEVEL[targetTile(c, r, n)];
    carpets.push({ size: n, levels });
    target = carpets.length - 1;
    rebuildCarpetList();
  }
  return carpets[target];
}

function paintCell(c, r, n) {
  let carpet = editableCarpet();
  // a carpet made at another tile count would paint one of its cells across
  // several tiles; bring it to the grid on screen first
  if (carpet.size !== n) {
    carpet = carpets[target] = resampleCarpet(carpet, n);
    drawThumb(target);
  }
  for (const [x, y] of brushCells(c, r, n)) carpet.levels[y * n + x] = brush.level;
}

// a stroke steps cell by cell from the last dab, so fast drags leave no gaps
function paintTo(at, n) {
  const from = lastPaint ?? at;
  const steps = Math.max(Math.abs(at.c - from.c), Math.abs(at.r - from.r), 1);
  for (let k = 1; k <= steps; k++) {
    paintCell(
      Math.round(from.c + ((at.c - from.c) * k) / steps),
      Math.round(from.r + ((at.r - from.r) * k) / steps),
      n,
    );
  }
  lastPaint = at;
  drawThumb(target);
  markDirty();
  redraw();
}

function onCanvas(event) {
  return EDIT_MODE && !recording && event?.target === canvas;
}

function mousePressed(event) {
  if (!onCanvas(event)) return;
  const n = gridN();
  const at = mouseCell(n);
  if (!at) return;
  if (keyIsDown(ALT)) {
    setBrushLevel(TILE_LEVEL[tileAt(at.c, at.r, n)]);
    return false;
  }
  lastPaint = null;
  paintTo(at, n);
  return false;
}

function mouseDragged(event) {
  if (!onCanvas(event) || keyIsDown(ALT)) return;
  const n = gridN();
  const at = mouseCell(n);
  if (at) paintTo(at, n);
  return false;
}

function mouseReleased() {
  lastPaint = null;
}

function mouseMoved() {
  syncReadout();
  if (EDIT_MODE && !animating()) redraw(); // brush cursor
}

function fillCarpet() {
  editableCarpet().levels.fill(brush.level);
  drawThumb(target);
  markDirty();
  redraw();
}

function selectCarpet(index) {
  if (index < 0 || index >= carpets.length) return;
  playing = false;
  const size = carpets[index].size;
  if (size % 2 === 0 && size / 2 !== dims && size / 2 <= DIMS_MAX) setDims(size / 2);
  morphTo(index);
}

function newCarpet() {
  const n = gridN();
  carpets.push({ size: n, levels: new Uint8Array(n * n) });
  rebuildCarpetList();
  markDirty();
  selectCarpet(carpets.length - 1);
}

function duplicateCarpet() {
  const src = editableCarpet();
  carpets.push({ size: src.size, levels: src.levels.slice() });
  target = carpets.length - 1;
  rebuildCarpetList();
  markDirty();
  redraw();
}

function deleteCarpet() {
  if (target < 0) return;
  carpets.splice(target, 1);
  playing = false;
  fromTiles = snapshotTiles(gridN());
  target = Math.min(target, carpets.length - 1);
  morphT = morphCfg.duration > 0 ? 0 : 1;
  rebuildCarpetList();
  markDirty();
  loop();
}

function stepCarpet(d) {
  if (!carpets.length) return;
  selectCarpet(target < 0 ? 0 : (target + d + carpets.length) % carpets.length);
}

function togglePlay() {
  playing = !playing;
  holdLeft = morphCfg.hold;
  if (playing && target < 0 && carpets.length) morphTo(0);
  syncMenu();
  if (playing) loop();
}

function setDims(n) {
  dims = constrain(n, DIMS_MIN, DIMS_MAX);
  settle(); // a morph's snapshot is for the old grid
  markDirty();
  redraw();
}

function reshuffle() {
  patternSeed = Math.floor(Math.random() * 1e9);
  settle();
  markDirty();
  redraw();
}

function setBrushLevel(level) {
  brush.level = clampLevel(level);
  syncMenu();
}

function windowResized() {
  const s = min(windowWidth, windowHeight);
  resizeCanvas(s, s);
  positionPanels();
  redraw();
}

function keyPressed() {
  if (!EDIT_MODE || recording) return;
  if (key === 'r' || key === 'R' || key === ' ') reshuffle();
  else if (keyCode === UP_ARROW) setDims(dims + 1);
  else if (keyCode === DOWN_ARROW) setDims(dims - 1);
  else if (keyCode === LEFT_ARROW) stepCarpet(-1);
  else if (keyCode === RIGHT_ARROW) stepCarpet(1);
  else if (key === '[') setBrushLevel(brush.level - 1);
  else if (key === ']') setBrushLevel(brush.level + 1);
  else if (key === 'm' || key === 'M') { brush.mirror = !brush.mirror; syncMenu(); }
  else if (key === 'g' || key === 'G') { grayView = !grayView; syncMenu(); redraw(); }
  else if (key === 'a' || key === 'A') { showGuides = !showGuides; syncMenu(); redraw(); }
  else if (key === 'p' || key === 'P') togglePlay();
  else if (key === 's' || key === 'S') savePng();
  else return;
  return false;
}

function savePng() {
  saveCanvas('pixel-tapestry-' + nf(hour(), 2) + nf(minute(), 2) + nf(second(), 2), 'png');
}

async function saveSettings() {
  const settings = {
    dims,
    seed: patternSeed,
    morph: { ...morphCfg },
    carpets: carpets.map(encodeCarpet),
  };
  ui.saveStatus.textContent = 'saving…';
  try {
    const res = await fetch('/api/dev/sketch-settings?slug=pixel-tapestry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    const out = await res.json();
    if (out.ok) dirty = false;
    syncMenu();
    ui.saveStatus.textContent = out.ok ? 'saved settings.js — commit to deploy' : `not saved: ${out.reason}`;
  } catch {
    ui.saveStatus.textContent = 'not saved — saving needs `next dev`';
  }
}

// --- panels (edit mode only) ----------------------------------------------

let menuEl; // left panel: canvas, brush, deploy
let hintEl; // right panel: carpets, morph, keyboard
const ui = {};

function addSection(panel, title) {
  const sec = document.createElement('div');
  sec.className = 'sec';
  const h = document.createElement('div');
  h.className = 'sec-title';
  h.textContent = title;
  sec.appendChild(h);
  panel.appendChild(sec);
  return sec;
}

// positions the two flanking panels off the canvas's own rect, so they
// re-center with it on resize
function positionPanels() {
  if (!menuEl) return;
  const rect = canvas.getBoundingClientRect();
  const gap = 28;
  const panelW = Math.max(150, Math.min(230, rect.left - gap - 40));
  for (const el of [menuEl, hintEl]) {
    el.style.width = panelW + 'px';
    el.style.top = rect.top + 'px';
    el.style.bottom = (windowHeight - rect.bottom) + 'px';
  }
  menuEl.style.right = (windowWidth - rect.left + gap) + 'px';
  Object.assign(guidesEl.style, {
    left: rect.left + 'px',
    top: rect.top + 'px',
    width: rect.width + 'px',
    height: rect.height + 'px',
  });
  hintEl.style.left = (rect.right + gap) + 'px';
}

function addButtons(parent) {
  const btns = document.createElement('div');
  btns.className = 'btns';
  parent.appendChild(btns);
  return btns;
}

function addButton(parent, action, key, onClick) {
  const btn = document.createElement('button');
  btn.innerHTML = `<span class="action">${action}</span>${key ? `<span class="key">${key}</span>` : ''}`;
  btn.addEventListener('click', onClick);
  parent.appendChild(btn);
  return btn;
}

function addRange(parent, label, min, max, step, value, onInput) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `
    <label>${label} <span class="val"></span></label>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${value}">
  `;
  parent.appendChild(row);
  const input = row.querySelector('input');
  input.addEventListener('input', () => onInput(+input.value));
  return { input, val: row.querySelector('.val') };
}

function addCheck(parent, label, onChange) {
  const row = document.createElement('label');
  row.className = 'check';
  row.innerHTML = `<input type="checkbox"> <span>${label}</span>`;
  parent.appendChild(row);
  const input = row.querySelector('input');
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function grayOf(level) {
  const v = Math.round(255 * (1 - LEVEL_SHADE[level]));
  return `rgb(${v},${v},${v})`;
}

function createControls() {
  menuEl = document.createElement('div');
  menuEl.id = 'menu';
  menuEl.className = 'panel';
  document.body.appendChild(menuEl);

  // canvas
  const grid = addSection(menuEl, 'canvas');
  ui.dims = addRange(grid, 'tiles per quadrant', DIMS_MIN, DIMS_MAX, 1, dims, setDims);
  ui.gray = addCheck(grid, 'grayscale view (G)', (on) => { grayView = on; redraw(); });
  ui.guides = addCheck(grid, 'xy axes (A)', (on) => { showGuides = on; redraw(); });
  const gridBtns = addButtons(grid);
  addButton(gridBtns, 'reshuffle tiles', 'R', reshuffle);
  addButton(gridBtns, 'save png', 'S', savePng);

  // brush: swatches light → dark, and the tiles the chosen level draws from
  const brushSec = addSection(menuEl, 'brush');
  const swatches = document.createElement('div');
  swatches.className = 'swatches';
  brushSec.appendChild(swatches);
  ui.swatches = Array.from({ length: LEVELS }, (_, level) => {
    const sw = document.createElement('button');
    sw.className = 'swatch';
    sw.style.background = grayOf(level);
    sw.title = `level ${level + 1} · ${TILES_BY_LEVEL[level].length} tile${TILES_BY_LEVEL[level].length > 1 ? 's' : ''}`;
    sw.addEventListener('click', () => setBrushLevel(level));
    swatches.appendChild(sw);
    return sw;
  });
  ui.levelLabel = document.createElement('div');
  ui.levelLabel.className = 'muted';
  brushSec.appendChild(ui.levelLabel);
  ui.bucket = document.createElement('canvas');
  ui.bucket.className = 'bucket';
  brushSec.appendChild(ui.bucket);
  ui.brushSize = addRange(brushSec, 'brush size', 1, BRUSH_MAX, 1, brush.size, (v) => {
    brush.size = v;
    syncMenu();
  });
  ui.mirror = addCheck(brushSec, '4-way mirror (M)', (on) => { brush.mirror = on; });
  addButton(addButtons(brushSec), 'fill carpet', '', fillCarpet);
  const tip = document.createElement('div');
  tip.className = 'muted';
  tip.textContent = 'paint on the tapestry · alt-click samples';
  ui.readout = document.createElement('div');
  ui.readout.className = 'readout';
  brushSec.appendChild(ui.readout);
  brushSec.appendChild(tip);

  // deploy
  const deploy = addSection(menuEl, 'deploy');
  addButton(addButtons(deploy), 'save settings', '', saveSettings);
  ui.saveStatus = document.createElement('div');
  ui.saveStatus.className = 'muted';
  ui.saveStatus.textContent = 'deployed version plays these carpets';
  deploy.appendChild(ui.saveStatus);

  // record
  const record = addSection(menuEl, 'record');
  ui.recordBtn = addButton(addButtons(record), 'record loop', '', recordLoop);
  ui.recordStatus = document.createElement('div');
  ui.recordStatus.className = 'muted';
  record.appendChild(ui.recordStatus);

  hintEl = document.createElement('div');
  hintEl.id = 'hint';
  hintEl.className = 'panel';
  document.body.appendChild(hintEl);

  // carpets
  const carpetSec = addSection(hintEl, 'carpets');
  ui.carpetList = document.createElement('div');
  ui.carpetList.className = 'carpets';
  carpetSec.appendChild(ui.carpetList);
  const carpetBtns = addButtons(carpetSec);
  carpetBtns.classList.add('inline');
  addButton(carpetBtns, 'new', '', newCarpet);
  addButton(carpetBtns, 'duplicate', '', duplicateCarpet);
  ui.deleteBtn = addButton(carpetBtns, 'delete', '', deleteCarpet);

  // morph
  const morphSec = addSection(hintEl, 'morph');
  ui.duration = addRange(morphSec, 'duration', 0, 8, 0.1, morphCfg.duration, (v) => {
    morphCfg.duration = v;
    markDirty();
  });
  ui.hold = addRange(morphSec, 'hold', 0, 8, 0.1, morphCfg.hold, (v) => {
    morphCfg.hold = v;
    markDirty();
  });
  ui.spread = addRange(morphSec, 'spread', 0, 1, 0.05, morphCfg.spread, (v) => {
    morphCfg.spread = v;
    markDirty();
  });
  ui.playBtn = addButton(addButtons(morphSec), 'play loop', 'P', togglePlay);

  // keyboard
  const keys = addSection(hintEl, 'keyboard');
  for (const [gesture, effect] of [
    ['[ / ]', 'lighter / darker'],
    ['← / →', 'prev / next carpet'],
    ['↑ / ↓', 'more / fewer tiles'],
    ['M', 'mirror brush'],
    ['G', 'grayscale view'],
    ['A', 'xy axes'],
    ['P', 'play loop'],
    ['R', 'reshuffle tiles'],
    ['S', 'save png'],
  ]) {
    const r = document.createElement('div');
    r.className = 'row';
    r.innerHTML = `<span>${gesture}</span><span>${effect}</span>`;
    keys.appendChild(r);
  }

  positionPanels(); // before the first sync, which measures the panel
  rebuildCarpetList();
}

function rebuildCarpetList() {
  if (!ui.carpetList) return;
  ui.carpetList.replaceChildren();
  ui.thumbs = carpets.map((carpet, i) => {
    const item = document.createElement('button');
    item.className = 'carpet';
    const thumb = document.createElement('canvas');
    const label = document.createElement('span');
    label.textContent = `${i + 1}`;
    item.append(thumb, label);
    item.addEventListener('click', () => selectCarpet(i));
    ui.carpetList.appendChild(item);
    return { item, thumb };
  });
  if (!carpets.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'none yet — paint to capture one';
    ui.carpetList.appendChild(empty);
  }
  carpets.forEach((_, i) => drawThumb(i));
  syncMenu();
}

function drawThumb(i) {
  const t = ui.thumbs?.[i];
  if (!t) return;
  const { size, levels } = carpets[i];
  t.thumb.width = size; // a paint may have resampled the carpet
  t.thumb.height = size;
  const ctx = t.thumb.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let k = 0; k < levels.length; k++) {
    const v = Math.round(255 * (1 - LEVEL_SHADE[levels[k]]));
    img.data.set([v, v, v, 255], k * 4);
  }
  ctx.putImageData(img, 0, 0);
}

// the chosen level's tiles, side by side
function drawBucket() {
  const tiles = TILES_BY_LEVEL[brush.level];
  const cell = 2;
  const tile = cell * 5;
  const gap = 3;
  const perRow = Math.max(1, Math.floor((ui.bucket.parentElement.clientWidth + gap) / (tile + gap)) || 12);
  const rows = Math.ceil(tiles.length / perRow);
  ui.bucket.width = perRow * (tile + gap) - gap;
  ui.bucket.height = rows * (tile + gap) - gap;
  const ctx = ui.bucket.getContext('2d');
  ctx.fillStyle = '#000';
  tiles.forEach((id, k) => {
    const ox = (k % perRow) * (tile + gap);
    const oy = Math.floor(k / perRow) * (tile + gap);
    for (const c of TILE_CELLS[id]) ctx.fillRect(ox + Math.floor(c / 5) * cell, oy + (c % 5) * cell, cell, cell);
  });
}

function syncMenu() {
  if (!menuEl) return;
  ui.dims.input.value = dims;
  ui.dims.val.textContent = `${dims} × ${dims}`;
  ui.gray.checked = grayView;
  ui.guides.checked = showGuides;
  syncReadout();
  ui.mirror.checked = brush.mirror;
  ui.brushSize.input.value = brush.size;
  ui.brushSize.val.textContent = `${brush.size} tile${brush.size > 1 ? 's' : ''}`;
  ui.swatches.forEach((sw, level) => sw.classList.toggle('on', level === brush.level));
  const count = TILES_BY_LEVEL[brush.level].length;
  ui.levelLabel.textContent = `level ${brush.level + 1} / ${LEVELS} · ${count} tile${count > 1 ? 's' : ''}`;
  drawBucket();
  ui.duration.val.textContent = `${morphCfg.duration.toFixed(1)} s`;
  ui.hold.val.textContent = `${morphCfg.hold.toFixed(1)} s`;
  ui.spread.val.textContent = morphCfg.spread.toFixed(2);
  ui.playBtn.querySelector('.action').textContent = playing ? 'pause loop' : 'play loop';
  ui.deleteBtn.disabled = target < 0;
  ui.recordBtn.disabled = recording || carpets.length < 2;
  menuEl.inert = hintEl.inert = recording; // a click mid-take would break the cycle
  if (!recording) {
    const secs = carpets.length * (morphCfg.hold + morphCfg.duration);
    ui.recordStatus.textContent = carpets.length < 2
      ? 'needs two or more carpets'
      : `one ${secs.toFixed(1)} s cycle of the deployed loop`;
  }
  ui.thumbs?.forEach((t, i) => t.item.classList.toggle('on', i === target));
  if (dirty) ui.saveStatus.textContent = 'unsaved changes';
}

// hovered cell as axis coordinates and its level, e.g. "x −2 · y 3 · level 12"
function syncReadout() {
  if (!ui.readout) return;
  const n = gridN();
  const at = hovering && mouseCell(n);
  if (!at) {
    ui.readout.textContent = ' ';
    return;
  }
  const fmt = (v) => (v < 0 ? '−' + -v : String(v));
  const level = TILE_LEVEL[tileAt(at.c, at.r, n)] + 1;
  ui.readout.textContent = `x ${fmt(axisCoord(at.c, n))} · y ${fmt(-axisCoord(at.r, n))} · level ${level}`;
}

// --- record loop (edit mode) -----------------------------------------------

// MP4 first: Chrome 126+ and Safari record H.264 natively; Firefox falls
// back to WebM
const RECORD_TYPES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];

// Plays exactly one deployed cycle and downloads it: from carpet 1's hold,
// through every carpet, ending as the last morph lands back on carpet 1 —
// before its hold replays — so the clip repeats seamlessly. Only the canvas
// is captured, and guides and the brush cursor are hidden while it runs.
function recordLoop() {
  if (recording || carpets.length < 2) return;
  const mimeType = RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const recorder = new MediaRecorder(canvas.captureStream(60), {
    mimeType,
    videoBitsPerSecond: 16_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
    a.download = `pixel-tapestry-loop.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    recording = false;
    playing = false;
    syncMenu();
    ui.recordStatus.textContent = ext === 'mp4'
      ? `downloaded ${a.download}`
      : `downloaded ${a.download} — this browser can't record MP4`;
    redraw();
  };

  // start settled on carpet 1, at the top of its hold
  settle();
  target = 0;
  holdLeft = morphCfg.hold;
  playing = true;
  recording = true;
  // fires mid-draw, as the last morph lands; stop once that frame is painted
  onLoopEnd = () => requestAnimationFrame(() => recorder.stop());
  syncMenu();
  ui.recordStatus.textContent = 'recording…';
  redraw();
  recorder.start();
  loop();
}
