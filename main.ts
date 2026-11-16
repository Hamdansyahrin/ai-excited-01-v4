// The Glass Phoenix — procedural stained-glass phoenix over a mirror sea.
// Node standard library only. Deterministic: seeded PRNG only, fixed seed.
// Renders at 2x supersampling (2048x2048) and box-downscales to 1024x1024.
// Writes exactly one file: <output dir>/entry.png (manual PNG encoder).

// @ts-ignore - node builtins; types are declared locally so this file
// compiles with a bare tsc and no external type packages.
import * as fs from "node:fs";
// @ts-ignore
import * as path from "node:path";
// @ts-ignore
import * as zlib from "node:zlib";
// @ts-ignore
import * as crypto from "node:crypto";

declare const process: any;
declare const Buffer: any;

// ---------------------------------------------------------------- constants
const OUT_W = 1024;
const OUT_H = 1024;
const SS = 2;
const W = OUT_W * SS; // 2048
const H = OUT_H * SS; // 2048
const SEED = 20261116;
const HORIZON = 0.67; // in normalized v coordinates
const SUN_X = 0.4;
const SUN_Y = 0.485;
const SUN_R = 0.118;
const CORE_X = 0.53;
const CORE_Y = 0.43;

// region codes stored in the region map
const R_SKY = 0;
const R_TAIL = 1;
const R_WING_A = 2;
const R_WING_B = 3;
const R_BODY = 4;
const R_NECK = 5;
const R_CREST = 6;
const R_HEAD = 7;
const R_BEAK = 8;

// ------------------------------------------------------------------- PRNG
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// deterministic 2D integer hash -> [0,1)
function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash1(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 2654435761);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- helpers
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// HSL (h in degrees, s and l in [0,1]) -> RGB in [0,255], written to out[0..2]
const _col: number[] = [0, 0, 0];
function hslToRgb(h: number, s: number, l: number): number[] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  _col[0] = (r + m) * 255;
  _col[1] = (g + m) * 255;
  _col[2] = (b + m) * 255;
  return _col;
}

// ------------------------------------------------------------- geometry
type Pt = { x: number; y: number };

function pointInPolygon(px: number, py: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function quadBezier(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
}

// ------------------------------------------------------- phoenix shapes
// All coordinates are normalized (0..1), y pointing down.
const WING_A: Pt[] = [
  { x: 0.485, y: 0.355 }, { x: 0.06, y: 0.075 }, { x: 0.145, y: 0.175 },
  { x: 0.105, y: 0.215 }, { x: 0.205, y: 0.255 }, { x: 0.165, y: 0.315 },
  { x: 0.275, y: 0.335 }, { x: 0.245, y: 0.395 }, { x: 0.365, y: 0.415 },
  { x: 0.425, y: 0.465 }, { x: 0.5, y: 0.44 },
];
const WING_B: Pt[] = [
  { x: 0.585, y: 0.43 }, { x: 0.78, y: 0.335 }, { x: 0.895, y: 0.355 },
  { x: 0.815, y: 0.415 }, { x: 0.845, y: 0.445 }, { x: 0.75, y: 0.475 },
  { x: 0.765, y: 0.515 }, { x: 0.675, y: 0.53 }, { x: 0.635, y: 0.565 },
  { x: 0.585, y: 0.5 },
];
const NECK: Pt[] = [
  { x: 0.575, y: 0.355 }, { x: 0.655, y: 0.255 }, { x: 0.715, y: 0.295 },
  { x: 0.625, y: 0.445 }, { x: 0.565, y: 0.42 },
];
const BEAK: Pt[] = [
  { x: 0.73, y: 0.252 }, { x: 0.8, y: 0.274 }, { x: 0.728, y: 0.288 },
];
const CRESTS: Pt[][] = [
  [{ x: 0.682, y: 0.228 }, { x: 0.598, y: 0.152 }, { x: 0.638, y: 0.24 }],
  [{ x: 0.668, y: 0.218 }, { x: 0.562, y: 0.186 }, { x: 0.632, y: 0.252 }],
  [{ x: 0.66, y: 0.232 }, { x: 0.586, y: 0.262 }, { x: 0.648, y: 0.266 }],
];
const BODY_CX = 0.53;
const BODY_CY = 0.43;
const BODY_RX = 0.165;
const BODY_RY = 0.072;
const BODY_ROT = -0.56; // radians, rising toward upper-right
const HEAD_CX = 0.695;
const HEAD_CY = 0.27;
const HEAD_R = 0.053;

type Ribbon = { p0: Pt; p1: Pt; p2: Pt; w0: number; w1: number };
const RIBBONS: Ribbon[] = [
  { p0: { x: 0.425, y: 0.47 }, p1: { x: 0.26, y: 0.53 }, p2: { x: 0.04, y: 0.64 }, w0: 0.032, w1: 0.005 },
  { p0: { x: 0.43, y: 0.485 }, p1: { x: 0.27, y: 0.6 }, p2: { x: 0.07, y: 0.76 }, w0: 0.034, w1: 0.005 },
  { p0: { x: 0.44, y: 0.495 }, p1: { x: 0.29, y: 0.63 }, p2: { x: 0.11, y: 0.86 }, w0: 0.033, w1: 0.005 },
  { p0: { x: 0.45, y: 0.495 }, p1: { x: 0.38, y: 0.59 }, p2: { x: 0.3, y: 0.78 }, w0: 0.029, w1: 0.004 },
  { p0: { x: 0.415, y: 0.46 }, p1: { x: 0.29, y: 0.47 }, p2: { x: 0.035, y: 0.52 }, w0: 0.022, w1: 0.003 },
];

// ------------------------------------------------------------ region map
const region = new Uint8Array(W * H);
const tailT = new Float32Array(W * H);
const tailDist = new Float32Array(W * H);

function polyBBox(poly: Pt[]): number[] {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return [Math.max(0, Math.floor(x0 * W)), Math.max(0, Math.floor(y0 * H)),
    Math.min(W - 1, Math.ceil(x1 * W)), Math.min(H - 1, Math.ceil(y1 * H))];
}

function stampPolygon(poly: Pt[], code: number): void {
  const bb = polyBBox(poly);
  for (let y = bb[1]; y <= bb[3]; y++) {
    const v = y / (H - 1);
    for (let x = bb[0]; x <= bb[2]; x++) {
      const u = x / (W - 1);
      if (pointInPolygon(u, v, poly)) region[y * W + x] = code;
    }
  }
}

function buildRegionMap(): void {
  tailDist.fill(1e9);
  // tail ribbons first (furthest back): stamp discs along each bezier
  const SAMPLES = 170;
  for (let ri = 0; ri < RIBBONS.length; ri++) {
    const rb = RIBBONS[ri];
    for (let s = 0; s <= SAMPLES; s++) {
      const t = s / SAMPLES;
      const c = quadBezier(rb.p0, rb.p1, rb.p2, t);
      const rad = lerp(rb.w0, rb.w1, t);
      const cx = c.x * (W - 1);
      const cy = c.y * (H - 1);
      const rp = rad * W;
      const x0 = Math.max(0, Math.floor(cx - rp));
      const x1 = Math.min(W - 1, Math.ceil(cx + rp));
      const y0 = Math.max(0, Math.floor(cy - rp));
      const y1 = Math.min(H - 1, Math.ceil(cy + rp));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d <= rp) {
            const idx = y * W + x;
            if (d < tailDist[idx]) {
              tailDist[idx] = d;
              tailT[idx] = t;
              region[idx] = R_TAIL;
            }
          }
        }
      }
    }
  }
  // wings
  stampPolygon(WING_A, R_WING_A);
  stampPolygon(WING_B, R_WING_B);
  // body: rotated ellipse
  {
    const cosR = Math.cos(BODY_ROT);
    const sinR = Math.sin(BODY_ROT);
    const x0 = Math.max(0, Math.floor((BODY_CX - BODY_RX - 0.03) * W));
    const x1 = Math.min(W - 1, Math.ceil((BODY_CX + BODY_RX + 0.03) * W));
    const y0 = Math.max(0, Math.floor((BODY_CY - BODY_RX - 0.03) * H));
    const y1 = Math.min(H - 1, Math.ceil((BODY_CY + BODY_RX + 0.03) * H));
    for (let y = y0; y <= y1; y++) {
      const v = y / (H - 1);
      for (let x = x0; x <= x1; x++) {
        const u = x / (W - 1);
        const dx = u - BODY_CX;
        const dy = v - BODY_CY;
        const lx = cosR * dx + sinR * dy;
        const ly = -sinR * dx + cosR * dy;
        const q = (lx * lx) / (BODY_RX * BODY_RX) + (ly * ly) / (BODY_RY * BODY_RY);
        if (q <= 1) region[y * W + x] = R_BODY;
      }
    }
  }
  // neck, crests, head, beak (front layers last)
  stampPolygon(NECK, R_NECK);
  for (const crest of CRESTS) stampPolygon(crest, R_CREST);
  {
    const cx = HEAD_CX * (W - 1);
    const cy = HEAD_CY * (H - 1);
    const rp = HEAD_R * W;
    const x0 = Math.max(0, Math.floor(cx - rp));
    const x1 = Math.min(W - 1, Math.ceil(cx + rp));
    const y0 = Math.max(0, Math.floor(cy - rp));
    const y1 = Math.min(H - 1, Math.ceil(cy + rp));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rp * rp) region[y * W + x] = R_HEAD;
      }
    }
  }
  stampPolygon(BEAK, R_BEAK);
}

// ------------------------------------------------- stained-glass shards
const SHARD_CELL = 36; // supersampled pixels per shard cell (denser mosaic)
const shardGW = Math.ceil(W / SHARD_CELL) + 2;
const shardGH = Math.ceil(H / SHARD_CELL) + 2;
const shardPX = new Float32Array(shardGW * shardGH);
const shardPY = new Float32Array(shardGW * shardGH);
function buildShards(): void {
  const rng = mulberry32(SEED + 11);
  for (let gy = 0; gy < shardGH; gy++) {
    for (let gx = 0; gx < shardGW; gx++) {
      const i = gy * shardGW + gx;
      shardPX[i] = (gx - 0.5) * SHARD_CELL + (rng() - 0.5) * SHARD_CELL * 0.92;
      shardPY[i] = (gy - 0.5) * SHARD_CELL + (rng() - 0.5) * SHARD_CELL * 0.92;
    }
  }
}
let shId = 0;
let shF1 = 0;
let shF2 = 0;
function shardInfo(x: number, y: number): void {
  const gx = Math.floor(x / SHARD_CELL) + 1;
  const gy = Math.floor(y / SHARD_CELL) + 1;
  let f1 = 1e18;
  let f2 = 1e18;
  let id = 0;
  for (let cy = gy - 1; cy <= gy + 1; cy++) {
    if (cy < 0 || cy >= shardGH) continue;
    for (let cx = gx - 1; cx <= gx + 1; cx++) {
      if (cx < 0 || cx >= shardGW) continue;
      const i = cy * shardGW + cx;
      const dx = x - shardPX[i];
      const dy = y - shardPY[i];
      const d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; id = i; }
      else if (d < f2) { f2 = d; }
    }
  }
  shId = id;
  shF1 = f1;
  shF2 = f2;
}

// ------------------------------------------------------------- sky ramp
// vertical gradient stops: [v, r, g, b]
const SKY_STOPS: number[][] = [
  [0.0, 8, 8, 32],
  [0.3, 20, 14, 60],
  [0.52, 38, 22, 90],
  [0.62, 54, 27, 94],
  [0.67, 74, 36, 88],
];
function skyColor(v: number, out: Float32Array, idx: number): void {
  let s = 0;
  while (s < SKY_STOPS.length - 2 && v > SKY_STOPS[s + 1][0]) s++;
  const a = SKY_STOPS[s];
  const b = SKY_STOPS[s + 1];
  const t = clamp((v - a[0]) / (b[0] - a[0]), 0, 1);
  out[idx] = lerp(a[1], b[1], t);
  out[idx + 1] = lerp(a[2], b[2], t);
  out[idx + 2] = lerp(a[3], b[3], t);
}

// ------------------------------------------------------------ main render
const img = new Float32Array(W * H * 3);

function renderScene(): void {
  const horizonPx = Math.floor(HORIZON * H);
  const cosB = Math.cos(BODY_ROT);
  const sinB = Math.sin(BODY_ROT);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const idx = (y * W + x) * 3;
      const reg = region[y * W + x];

      if (y > horizonPx && reg === R_SKY) {
        // deep sea base; the reflection pass replaces most of this
        img[idx] = 10;
        img[idx + 1] = 15;
        img[idx + 2] = 44;
        continue;
      }

      // --- sky + sun (background) ---
      skyColor(Math.min(v, HORIZON) / HORIZON * 0.999, img, idx);
      const sdx = u - SUN_X;
      const sdy = (v - SUN_Y) * 1.0;
      const sd2 = sdx * sdx + sdy * sdy;
      const sd = Math.sqrt(sd2);
      // wide halo + tight glow (rational falloff, no exp needed)
      const halo = 1 / (1 + sd2 * 55);
      const wide = 1 / (1 + sd2 * 7);
      img[idx] += 255 * halo * 0.34 + 150 * wide * 0.08;
      img[idx + 1] += 138 * halo * 0.34 + 70 * wide * 0.07;
      img[idx + 2] += 46 * halo * 0.34 + 90 * wide * 0.06;
      if (sd < SUN_R) {
        // molten disc: white-gold centre to burnt orange rim
        const t = sd / SUN_R;
        const r = lerp(255, 255, t);
        const g = lerp(226, 118, t * t);
        const b = lerp(150, 34, t * t);
        img[idx] = r;
        img[idx + 1] = g;
        img[idx + 2] = b;
        if (sd < SUN_R * 0.55) {
          // hot inner core
          const k = 1 - sd / (SUN_R * 0.55);
          img[idx] = lerp(img[idx], 255, k * 0.55);
          img[idx + 1] = lerp(img[idx + 1], 242, k * 0.55);
          img[idx + 2] = lerp(img[idx + 2], 196, k * 0.55);
        }
      }

      if (reg === R_SKY) continue;

      // --- phoenix base colour by region ---
      let h = 40;
      let s = 0.92;
      let l = 0.56;
      let featherLine = 0;
      let featherJitter = 0;
      let tealK = 0;
      if (reg === R_TAIL) {
        const t = tailT[y * W + x];
        h = t < 0.5 ? lerp(42, 18, t * 2) : 18 - (t - 0.5) * 2 * 34;
        s = 0.94;
        l = lerp(0.58, 0.42, t);
        featherLine = Math.abs(((t * 14) % 1) - 0.5) < 0.05 ? 0.08 : 0;
      } else if (reg === R_WING_A || reg === R_WING_B) {
        const sx = reg === R_WING_A ? 0.475 : 0.6;
        const sy = reg === R_WING_A ? 0.375 : 0.47;
        const dx = u - sx;
        const dy = v - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const base = clamp(dist / 0.44, 0, 1);
        h = reg === R_WING_A ? lerp(44, 2, base) : lerp(45, 4, base);
        l = lerp(0.61, 0.42, base);
        s = 0.95;
        // lower edge of the east wing deepens toward crimson for contrast
        if (reg === R_WING_B && v > 0.47) {
          h -= clamp((v - 0.47) / 0.1, 0, 1) * 16;
          l -= clamp((v - 0.47) / 0.1, 0, 1) * 0.09;
        }
        if (reg === R_WING_A && base > 0.72) {
          // deep teal accents at the far wing tips. Crimson and teal are
          // complementary, so this blend is applied later in RGB space;
          // lerping the hue would pass straight through lime green.
          tealK = (base - 0.72) / 0.28 * 0.78;
        }
        if (reg === R_WING_B && base > 0.84) {
          // balancing teal accent on the east wing tip
          tealK = (base - 0.84) / 0.16 * 0.5;
        }
        // layered feather rows: arcs by radius, columns by angle
        const rowF = dist / 0.052;
        const row = Math.floor(rowF);
        const frac = rowF - row;
        const ang = Math.atan2(dy, dx);
        const col = Math.floor((ang + Math.PI) / 0.3) + row * 7;
        featherJitter = (hash2(row * 3 + 11, col * 5 + 3) - 0.5) * 0.11;
        if (frac < 0.16) featherLine = 0.52 * (1 - frac / 0.16);
      } else if (reg === R_BODY) {
        const dx = u - BODY_CX;
        const dy = v - BODY_CY;
        const lx = cosB * dx + sinB * dy;
        const ly = -sinB * dx + cosB * dy;
        // elliptical distance so the colour ramp follows the body shape;
        // a radial ramp would paint a red circle arc across the belly
        const coreD = clamp(Math.sqrt((lx * lx) / (BODY_RX * BODY_RX) + (ly * ly) / (BODY_RY * BODY_RY)), 0, 1);
        h = lerp(46, 10, coreD);
        l = lerp(0.62, 0.46, coreD);
        s = 0.96;
        // belly shading: the lower body deepens toward crimson so the
        // underside reads against the sun instead of washing out gold
        {
          const belly = clamp(ly / BODY_RY, 0, 1);
          h -= belly * 6;
          l -= belly * 0.045;
        }
        // breast scallops in the rotated body frame
        const rowF = (lx + 0.17) / 0.036;
        const row = Math.floor(rowF);
        const colF = (ly + 0.08) / 0.036 + (row % 2) * 0.5;
        const col = Math.floor(colF);
        featherJitter = (hash2(row * 7 + 1, col * 3 + 9) - 0.5) * 0.07;
        const frac = rowF - row;
        if (frac < 0.18) featherLine = 0.34 * (1 - frac / 0.18);
      } else if (reg === R_NECK) {
        h = lerp(44, 18, clamp((0.45 - v) / 0.2, 0, 1));
        l = 0.57;
        s = 0.94;
      } else if (reg === R_HEAD) {
        h = 38;
        l = 0.57;
        s = 0.95;
      } else if (reg === R_CREST) {
        h = 356;
        l = 0.52;
        s = 0.88;
      } else if (reg === R_BEAK) {
        h = 33;
        l = lerp(0.4, 0.22, clamp((u - 0.73) / 0.07, 0, 1));
        s = 0.9;
      }

      // --- stained glass: per-shard jitter + dark leading ---
      shardInfo(x, y);
      const hj1 = hash1(shId * 3 + 17);
      const hj2 = hash1(shId * 7 + 41);
      h += (hj1 - 0.5) * 13;
      l += (hj2 - 0.5) * 0.13 + featherJitter;
      l = clamp(l, 0.2, 0.78);
      const rgb = hslToRgb(h, s, l);
      // slight dome shading inside each shard
      const dome = 0.93 + 0.07 * (1 - clamp(Math.sqrt(shF1) / SHARD_CELL, 0, 1));
      let r = rgb[0] * dome;
      let g = rgb[1] * dome;
      let b = rgb[2] * dome;
      if (tealK > 0) {
        r = lerp(r, 10, tealK);
        g = lerp(g, 150, tealK);
        b = lerp(b, 140, tealK);
      }
      if (featherLine > 0) {
        r *= 1 - featherLine;
        g *= 1 - featherLine;
        b *= 1 - featherLine;
      }
      // bright inner glow at the body core
      const cdx = u - CORE_X;
      const cdy = v - CORE_Y;
      const cd2 = cdx * cdx + cdy * cdy;
      const glow = 1 / (1 + cd2 * 340);
      r += 255 * glow * 0.36;
      g += 178 * glow * 0.36;
      b += 74 * glow * 0.3;
      // voronoi border -> dark leading
      const border = Math.sqrt(shF2) - Math.sqrt(shF1);
      if (border < 2.1) {
        const k = (1 - border / 2.1) * 0.88;
        r = lerp(r, 9, k);
        g = lerp(g, 7, k);
        b = lerp(b, 15, k);
      }
      img[idx] = r;
      img[idx + 1] = g;
      img[idx + 2] = b;
    }
  }
}

// dark outline where the silhouette meets the sky (uses the region map)
function silhouetteEdge(): void {
  const horizonPx = Math.floor(HORIZON * H);
  for (let y = 1; y < horizonPx; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (region[i] === R_SKY) continue;
      if (
        region[i - 1] === R_SKY || region[i + 1] === R_SKY ||
        region[i - W] === R_SKY || region[i + W] === R_SKY ||
        region[i - 2] === R_SKY || region[i + 2] === R_SKY
      ) {
        const idx = i * 3;
        img[idx] = lerp(img[idx], 8, 0.82);
        img[idx + 1] = lerp(img[idx + 1], 6, 0.82);
        img[idx + 2] = lerp(img[idx + 2], 14, 0.82);
      }
    }
  }
}

// the eye: a dark bead with a hard highlight, stamped before reflection
function drawEye(): void {
  const cx = 0.706 * (W - 1);
  const cy = 0.262 * (H - 1);
  const rp = 0.0085 * W;
  const x0 = Math.floor(cx - rp - 2);
  const x1 = Math.ceil(cx + rp + 2);
  const y0 = Math.floor(cy - rp - 2);
  const y1 = Math.ceil(cy + rp + 2);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      const idx = (y * W + x) * 3;
      if (d2 <= rp * rp) {
        img[idx] = 12;
        img[idx + 1] = 8;
        img[idx + 2] = 10;
      }
      const hx = x - (cx + rp * 0.35);
      const hy = y - (cy - rp * 0.35);
      if (hx * hx + hy * hy <= rp * rp * 0.14) {
        img[idx] = 255;
        img[idx + 1] = 250;
        img[idx + 2] = 235;
      }
    }
  }
}

// -------------------------------------------------------------- the sea
function renderSea(): void {
  const horizonPx = Math.floor(HORIZON * H);
  const rng = mulberry32(SEED + 23);
  // pre-seeded sparkle phases per coarse cell column are derived by hash,
  // so no table is needed; rng is used only for a global sparkle density jitter
  const sparkleBoost = 0.9 + rng() * 0.2;
  for (let y = horizonPx + 1; y < H; y++) {
    const depth = (y - horizonPx) / (H - horizonPx); // 0..1
    // ripple offset grows gently with depth; one offset per row keeps
    // the reflected streaks coherent without shearing the whole bird
    const ripple = Math.sin(y * 0.045 + Math.sin(y * 0.011) * 2.4) * (1.5 + depth * 4.5);
    // vertical compression: the reflection is squashed toward the horizon
    const srcY = Math.max(0, Math.floor(horizonPx - (y - horizonPx) * 0.58));
    // reflection strength fades with depth into deep indigo water
    const refl = lerp(0.58, 0.16, depth);
    const reflBright = lerp(0.85, 0.55, depth);
    const wave = 0.94 + 0.06 * Math.sin(y * 0.19 + Math.sin(y * 0.023) * 3);
    for (let x = 0; x < W; x++) {
      let sx = Math.round(x + ripple + Math.sin(y * 0.11 + x * 0.0016) * 1.6);
      if (sx < 0) sx = 0;
      if (sx > W - 1) sx = W - 1;
      const sIdx = (srcY * W + sx) * 3;
      const idx = (y * W + x) * 3;
      let r = (img[sIdx] * reflBright * refl + 7 * (1 - refl)) * wave;
      let g = (img[sIdx + 1] * reflBright * refl + 12 * (1 - refl)) * wave;
      let b = (img[sIdx + 2] * reflBright * refl + 38 * (1 - refl)) * wave;
      // sun column shimmer: broken, sparse, and confined to a narrow column
      const colD = Math.abs(x / (W - 1) - SUN_X);
      const shimmer = Math.max(0, 1 - colD / 0.09);
      const n = hash2(Math.floor(x / 5), Math.floor(y / 3));
      if (n > 0.92) {
        const k = (n - 0.92) / 0.08 * shimmer * shimmer * (1 - depth * 0.6) * sparkleBoost;
        r += 255 * k * 0.3;
        g += 168 * k * 0.3;
        b += 60 * k * 0.26;
      }
      // sparse bright glints across the whole sea
      const glint = hash2(Math.floor(x / 2) + 5000, Math.floor(y / 3) + 900);
      if (glint > 0.9992) {
        r += 150;
        g += 145;
        b += 165;
      }
      img[idx] = r;
      img[idx + 1] = g;
      img[idx + 2] = b;
    }
  }
  // bright horizon line
  for (let x = 0; x < W; x++) {
    const idx = (horizonPx * W + x) * 3;
    img[idx] = Math.min(255, img[idx] * 1.25 + 26);
    img[idx + 1] = Math.min(255, img[idx + 1] * 1.2 + 16);
    img[idx + 2] = Math.min(255, img[idx + 2] * 1.15 + 10);
  }
}

// ---------------------------------------------------- stars and embers
function splat(cx: number, cy: number, rad: number, r: number, g: number, b: number, peak: number): void {
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = (dx * dx + dy * dy) / (rad * rad);
      if (d2 >= 1) continue;
      const fall = (1 - d2) * (1 - d2) * peak;
      const idx = (y * W + x) * 3;
      img[idx] += r * fall;
      img[idx + 1] += g * fall;
      img[idx + 2] += b * fall;
    }
  }
}

function drawStars(): void {
  const rng = mulberry32(SEED + 31);
  const horizonPx = Math.floor(HORIZON * H);
  const COUNT = 260;
  for (let i = 0; i < COUNT; i++) {
    const u = rng();
    const v = rng() * 0.52; // upper sky only
    const x = u * (W - 1);
    const y = v * (H - 1);
    if (y > horizonPx - 30) continue;
    if (region[Math.floor(y) * W + Math.floor(x)] !== R_SKY) continue;
    const bright = 0.25 + rng() * 0.75;
    const fade = 1 - v / 0.55; // fainter near the horizon glow
    const rad = rng() < 0.12 ? 3.4 : 1.9;
    const tint = rng();
    const r = tint < 0.3 ? 0.75 : 1.0;
    const g = 0.85;
    const b = 1.0;
    splat(x, y, rad, 255 * r, 255 * g, 255 * b, bright * fade * 0.85);
    if (rad > 3) {
      // small diffraction cross on the brightest few
      for (let k = -7; k <= 7; k++) {
        if (k === 0) continue;
        const f = (1 - Math.abs(k) / 8) * bright * fade * 0.3;
        const ix = Math.round(x + k);
        const iy = Math.round(y);
        if (ix >= 0 && ix < W) {
          const idx = (iy * W + ix) * 3;
          img[idx] += 200 * f;
          img[idx + 1] += 210 * f;
          img[idx + 2] += 255 * f;
        }
        const jx = Math.round(x);
        const jy = Math.round(y + k);
        if (jy >= 0 && jy < H) {
          const idx = (jy * W + jx) * 3;
          img[idx] += 200 * f;
          img[idx + 1] += 210 * f;
          img[idx + 2] += 255 * f;
        }
      }
    }
  }
}

function drawEmbers(): void {
  const rng = mulberry32(SEED + 47);
  const COUNT = 320;
  for (let i = 0; i < COUNT; i++) {
    const x = rng() * (W - 1);
    const y = rng() * (H - 1);
    const big = rng() < 0.16;
    const rad = big ? 7 + rng() * 6 : 2.4 + rng() * 2.6;
    const peak = big ? 0.5 + rng() * 0.4 : 0.55 + rng() * 0.45;
    const warm = rng();
    const r = 1.0;
    const g = 0.45 + warm * 0.3;
    const b = 0.1 + warm * 0.12;
    splat(x, y, rad, 255 * r, 255 * g, 255 * b, peak);
  }
}

function applyVignette(): void {
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1) - 0.5;
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1) - 0.5;
      const d2 = (u * u + v * v) * 2; // 0 centre, ~1 corners
      const k = 1 - 0.26 * d2 * d2;
      const idx = (y * W + x) * 3;
      img[idx] *= k;
      img[idx + 1] *= k;
      img[idx + 2] *= k;
    }
  }
}

// ------------------------------------------------------------ downscale
function downscale(): Uint8Array {
  const out = new Uint8Array(OUT_W * OUT_H * 3);
  for (let y = 0; y < OUT_H; y++) {
    for (let x = 0; x < OUT_W; x++) {
      const oIdx = (y * OUT_W + x) * 3;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < SS; dy++) {
          for (let dx = 0; dx < SS; dx++) {
            sum += img[((y * SS + dy) * W + (x * SS + dx)) * 3 + c];
          }
        }
        const val = sum / (SS * SS);
        out[oIdx + c] = val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------- PNG encoder
const CRC_TABLE: Int32Array = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf: any): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: any): any {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
// adaptive per-row filtering: pick the filter minimising sum |signed byte|
function filterRow(row: any, prev: any | null, bpp: number): any {
  const candidates: any[] = [];
  const scores: number[] = [];
  for (let f = 0; f <= 4; f++) {
    const out = Buffer.alloc(row.length);
    let score = 0;
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) pred = paeth(a, b, c);
      const val = (row[i] - pred) & 0xff;
      out[i] = val;
      score += val < 128 ? val : 256 - val;
    }
    candidates.push(out);
    scores.push(score);
  }
  let best = 0;
  for (let f = 1; f <= 4; f++) if (scores[f] < scores[best]) best = f;
  const result = Buffer.alloc(row.length + 1);
  result[0] = best;
  candidates[best].copy(result, 1);
  return result;
}
function encodePng(rgb: Uint8Array, width: number, height: number): any {
  const bpp = 3;
  const stride = width * bpp;
  const filtered: any[] = [];
  let prev: any = null;
  for (let y = 0; y < height; y++) {
    const row = Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride);
    filtered.push(filterRow(row, prev, bpp));
    prev = row;
  }
  const raw = Buffer.concat(filtered);
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ main
function main(): void {
  const t0 = process.hrtime.bigint();
  buildRegionMap();
  buildShards();
  renderScene();
  silhouetteEdge();
  drawEye();
  renderSea();
  drawStars();
  drawEmbers();
  applyVignette();
  const rgb = downscale();
  const png = encodePng(rgb, OUT_W, OUT_H);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || process.env.OUTPUT_DIR || "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, png);
  const sha = crypto.createHash("sha256").update(png).digest("hex");
  const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(JSON.stringify({ width: OUT_W, height: OUT_H, bytes: png.length, sha256: sha, seconds: Math.round(seconds * 1000) / 1000 }));
}
main();
