// Tile vocabulary, light→dark ranking, and the carpet codec (ADR-030).
// Pure — no p5 calls — so Vitest evaluates this file directly.
//
// A tile is five columns [a, b, c, b, a], each one of the eight palindromic
// strips below ('0' = black cell), so every tile is symmetric both ways.
// Tile id = a * 64 + b * 8 + c.

const BIT_ARRAYS = ['11111', '11011', '10101', '10001', '01110', '00100', '01010', '00000'];
const TILE_COUNT = BIT_ARRAYS.length ** 3;
const MAX_CARPET = 64; // tiles per side a saved carpet may claim

function tileColumns(id) {
  const a = BIT_ARRAYS[id >> 6];
  const b = BIT_ARRAYS[(id >> 3) & 7];
  const c = BIT_ARRAYS[id & 7];
  return [a, b, c, b, a];
}

function stripInk(strip) {
  let n = 0;
  for (const bit of strip) if (bit === '0') n++;
  return n;
}

// a tile's black-cell count, 0 … 25
const TILE_INK = Uint8Array.from({ length: TILE_COUNT }, (_, id) => {
  let n = 0;
  for (const col of tileColumns(id)) n += stripInk(col);
  return n;
});

// Brush levels: the usable ink counts, 1 (one dot) … 24 (one gap), banded
// into LEVELS even steps, light → dark. No tile is ever all white or all
// black. Rounding keeps the bands mirror-symmetric (ink k and 25 − k land in
// mirrored levels), since ink counts come in matched pairs.
const LEVELS = 10;
const MIN_INK = 1;
const MAX_INK = 24;

function clampLevel(level) {
  return Math.min(LEVELS - 1, Math.max(0, level));
}

// each tile's level, or -1 for the two solid tiles
const TILE_LEVEL = Int8Array.from({ length: TILE_COUNT }, (_, id) => {
  const ink = TILE_INK[id];
  if (ink < MIN_INK || ink > MAX_INK) return -1;
  return Math.round(((ink - MIN_INK) * (LEVELS - 1)) / (MAX_INK - MIN_INK));
});

// a level's tiles — its bucket
const TILES_BY_LEVEL = Array.from({ length: LEVELS }, () => []);
for (let id = 0; id < TILE_COUNT; id++) {
  if (TILE_LEVEL[id] >= 0) TILES_BY_LEVEL[TILE_LEVEL[id]].push(id);
}
const ALLOWED_TILES = TILES_BY_LEVEL.flat();

// how dark a level reads, 0 … 1: its tiles' mean share of black cells
const LEVEL_SHADE = TILES_BY_LEVEL.map(
  (bucket) => bucket.reduce((sum, id) => sum + TILE_INK[id], 0) / bucket.length / 25,
);

// fold a column/row index into its quadrant, so mirrored cells hash alike
function foldCell(i, n) {
  return Math.min(i, n - 1 - i);
}

// small integer hash (murmur3 finaliser over the mixed inputs)
function hashInts(...xs) {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

// a cell's stable random in [0, 1), e.g. its morph delay
function cellHash(seed, c, r) {
  return hashInts(seed, c, r, 1) / 4294967296;
}

// the tile of `level` shown at cell (c, r) of an n × n grid
function pickTile(level, seed, c, r, n) {
  level = clampLevel(level);
  const bucket = TILES_BY_LEVEL[level];
  return bucket[hashInts(seed, level, foldCell(c, n), foldCell(r, n)) % bucket.length];
}

// the original sketch's look: any tile, mirrored into the four quadrants.
// The level is drawn as a uniform allowed tile's level (the original
// distribution, less the two solid tiles), then the tile comes from
// pickTile — so painting over this pattern captures it as a carpet without
// a single tile changing.
function randomTile(seed, c, r, n) {
  const pick = hashInts(seed, foldCell(c, n), foldCell(r, n), 2) % ALLOWED_TILES.length;
  const level = TILE_LEVEL[ALLOWED_TILES[pick]];
  return pickTile(level, seed, c, r, n);
}

// a cell's own progress through a morph at global progress t: with spread
// > 0 each cell starts late by a hashed fraction, yet all land by t = 1
function cellProgress(t, spread, h) {
  return Math.min(1, Math.max(0, t * (1 + spread) - spread * h));
}

// carpets: { size, levels: Uint8Array(size²) } in memory,
// { size, rows: ['aj…', …] } saved — one letter per level, a (lightest) …
// j (darkest)
function encodeCarpet(carpet) {
  const rows = [];
  for (let r = 0; r < carpet.size; r++) {
    let row = '';
    for (let c = 0; c < carpet.size; c++) {
      row += String.fromCharCode(97 + carpet.levels[r * carpet.size + c]);
    }
    rows.push(row);
  }
  return { size: carpet.size, rows };
}

function decodeCarpet(saved) {
  if (typeof saved !== 'object' || saved === null) return null;
  const { size, rows } = saved;
  if (!Number.isInteger(size) || size < 1 || size > MAX_CARPET) return null;
  const levels = new Uint8Array(size * size);
  const lines = Array.isArray(rows) ? rows : [];
  for (let r = 0; r < size; r++) {
    const line = typeof lines[r] === 'string' ? lines[r] : '';
    for (let c = 0; c < size; c++) {
      const level = line.charCodeAt(c) - 97;
      levels[r * size + c] = level >= 0 && level < 26 ? clampLevel(level) : 0;
    }
  }
  return { size, levels };
}

// the carpet's level at cell (c, r) of an n × n grid, nearest-neighbour
function sampleCarpet(carpet, c, r, n) {
  const s = carpet.size;
  return carpet.levels[Math.floor((r * s) / n) * s + Math.floor((c * s) / n)];
}

// a copy of the carpet at n × n, nearest-neighbour — so painting happens at
// the grid's resolution, one tile per cell
function resampleCarpet(carpet, n) {
  const levels = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) levels[r * n + c] = sampleCarpet(carpet, c, r, n);
  return { size: n, levels };
}
