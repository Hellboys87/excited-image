// entry.png — a colossal galaxy jellyfish ascending over a miniature night city.
//
// Drawn pixel by pixel in code: no image assets, no randomness at run time.
// Every random-looking choice comes from a seeded PRNG with a fixed seed, so
// the two graded runs write byte-identical files.
//
// Scene: a huge translucent bell whose dome holds a spiral galaxy, rimmed in
// cyan and gold, trailing ribbons of light over a tiny black skyline whose
// warm windows and searchlights give the scale away.
//
// Node 22, standard library only. Run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- utilities

// mulberry32: tiny deterministic PRNG.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashI(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ------------------------------------------------------------- frame buffer
// Two HDR float buffers: the image itself, and a glow buffer that is blurred
// at the end and added back so every bright thing blooms.

const img = new Float32Array(W * H * 3);
const glow = new Float32Array(W * H * 3);

function addTo(buf: Float32Array, x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] += r;
  buf[i + 1] += g;
  buf[i + 2] += b;
}

function setTo(x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  img[i] = r;
  img[i + 1] = g;
  img[i + 2] = b;
}

// Soft round stamp: quadratic falloff, additive.
function stamp(
  buf: Float32Array,
  cx: number,
  cy: number,
  rad: number,
  r: number,
  g: number,
  b: number,
  s: number,
): void {
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  const inv = 1 / (rad * rad);
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const d2 = (dx * dx + dy * dy) * inv;
      if (d2 < 1) {
        const w = 1 - d2;
        const f = w * w * s;
        addTo(buf, x, y, r * f, g * f, b * f);
      }
    }
  }
}

// --------------------------------------------------------------------- sky

function paintSky(): void {
  // Vertical gradient, near-black indigo to a faint violet horizon.
  const stops: Array<[number, number, number, number]> = [
    [0.0, 0.008, 0.006, 0.035],
    [0.38, 0.02, 0.014, 0.07],
    [0.7, 0.045, 0.024, 0.11],
    [0.9, 0.075, 0.038, 0.15],
    [1.0, 0.05, 0.028, 0.115],
  ];
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, r0, g0, b0] = stops[k];
    const [t1, r1, g1, b1] = stops[k + 1];
    const f = clamp01((t - t0) / (t1 - t0));
    const r = lerp(r0, r1, f);
    const g = lerp(g0, g1, f);
    const b = lerp(b0, b1, f);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      img[i] = r;
      img[i + 1] = g;
      img[i + 2] = b;
    }
  }
  // Nebula washes: enormous, barely-there colour clouds.
  stamp(img, 190, 150, 520, 0.1, 0.05, 0.24, 0.5);
  stamp(img, 850, 110, 470, 0.2, 0.05, 0.17, 0.42);
  stamp(img, 720, 560, 560, 0.02, 0.1, 0.16, 0.4);
  stamp(img, 120, 700, 480, 0.12, 0.04, 0.1, 0.3);
}

function paintStars(): void {
  const R = rng(20240);
  for (let i = 0; i < 1250; i++) {
    const x = R() * W;
    const y = Math.pow(R(), 1.3) * H * 0.99;
    const b = 0.15 + Math.pow(R(), 2.2) * 0.85;
    const warm = R();
    const cr = lerp(0.82, 1.1, warm) * b;
    const cg = lerp(0.9, 0.92, warm) * b;
    const cb = lerp(1.15, 0.72, warm) * b;
    stamp(img, x, y, 1.15, cr, cg, cb, 0.75);
    if (b > 0.8) {
      // The brightest few get a cross sparkle and a halo.
      stamp(glow, x, y, 4.5, cr, cg, cb, 0.16);
      for (let d = 2; d <= 5; d++) {
        const f = 0.3 * (1 - d / 6);
        addTo(img, Math.round(x) + d, Math.round(y), cr * f, cg * f, cb * f);
        addTo(img, Math.round(x) - d, Math.round(y), cr * f, cg * f, cb * f);
        addTo(img, Math.round(x), Math.round(y) + d, cr * f, cg * f, cb * f);
        addTo(img, Math.round(x), Math.round(y) - d, cr * f, cg * f, cb * f);
      }
    }
  }
}

// -------------------------------------------------------------- searchlights

function beam(
  bx: number,
  by: number,
  tx: number,
  ty: number,
  w0: number,
  w1: number,
  r: number,
  g: number,
  b: number,
  s: number,
): void {
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const maxW = Math.max(w0, w1);
  const x0 = Math.max(0, Math.floor(Math.min(bx, tx) - maxW - 2));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(bx, tx) + maxW + 2));
  const y0 = Math.max(0, Math.floor(Math.min(by, ty) - maxW - 2));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(by, ty) + maxW + 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x - bx;
      const py = y - by;
      const t = (px * ux + py * uy) / len;
      if (t < 0 || t > 1) continue;
      const perp = Math.abs(px * uy - py * ux);
      const wdt = lerp(w0, w1, t);
      const across = sstep(wdt, wdt * 0.3, perp);
      const along = Math.pow(1 - t, 1.5);
      const f = across * along * s;
      if (f > 0.003) addTo(img, x, y, r * f, g * f, b * f);
    }
  }
}

function paintBeams(): void {
  beam(140, 952, 470, 330, 5, 46, 1.0, 0.84, 0.52, 0.1);
  beam(892, 958, 655, 345, 5, 40, 0.62, 0.86, 1.05, 0.09);
  beam(520, 962, 575, 420, 4, 30, 0.7, 0.8, 1.05, 0.055);
}

// --------------------------------------------------------------- jellyfish

const BCX = 580; // bell centre
const BCY = 326;
const BR = 238; // bell radius

// The bell's lower rim, in squashed bell units: a gentle wave.
function rimV(u: number): number {
  return 0.16 + 0.045 * Math.sin(u * 8.0 + 1.2) + 0.02 * Math.sin(u * 17.0 - 0.7);
}

// Bell silhouette mask at squashed coords (uu, vv): 1 inside, soft edge.
function bellMask(uu: number, vv: number): number {
  if (vv < 0) {
    return sstep(1.03, 0.955, Math.sqrt(uu * uu + vv * vv));
  }
  const rim = sstep(0.035, -0.035, vv - rimV(uu));
  const side = sstep(1.04, 0.97, Math.abs(uu) + vv * 0.4);
  return Math.min(rim, side);
}

function paintBellHalo(): void {
  stamp(glow, BCX, BCY, BR * 1.6, 0.3, 0.52, 0.95, 0.5);
  stamp(glow, BCX, BCY - 20, BR * 1.12, 0.42, 0.3, 0.9, 0.5);
  stamp(glow, BCX, BCY + 30, BR * 0.95, 0.1, 0.65, 0.8, 0.3);
}

function paintGalaxy(): void {
  const x0 = Math.max(0, Math.floor(BCX - BR - 4));
  const x1 = Math.min(W - 1, Math.ceil(BCX + BR + 4));
  const y0 = Math.max(0, Math.floor(BCY - BR - 4));
  const y1 = Math.min(H - 1, Math.ceil(BCY + BR * 0.55));
  for (let y = y0; y <= y1; y++) {
    const vv = (y - BCY) / (BR * 0.94);
    for (let x = x0; x <= x1; x++) {
      const uu = (x - BCX) / BR;
      const mask = bellMask(uu, vv);
      if (mask <= 0.001) continue;
      const r = Math.sqrt(uu * uu + vv * vv);
      const ang = Math.atan2(vv, uu);

      // Spiral galaxy: two arms winding outward, a diffuse disc, a hot core.
      let arm = 0.5 + 0.5 * Math.sin(2 * ang + 7.2 * r - 0.6);
      arm = Math.pow(arm, 2.8);
      const dust = 0.72 + 0.28 * Math.sin(3 * ang + 12.5 * r + 1.7);
      const disc = Math.exp(-r * 2.7);
      const bright = (arm * 1.55 * (1 - r * 0.72) + disc * 0.5) * dust;
      const core = Math.exp(-r * r * 11) * 2.3;

      // Palette: violet body, magenta arms, cyan fringe, gold-white core.
      let cr = 0.34 * disc + 1.02 * arm * (1 - r) + 0.22 * r * arm;
      let cg = 0.18 * disc + 0.3 * arm * (1 - r) + 0.72 * r * arm;
      let cb = 0.85 * disc + 0.78 * arm * (1 - r) + 1.02 * r * arm;
      cr = cr * bright + 1.18 * core;
      cg = cg * bright + 0.96 * core;
      cb = cb * bright + 0.74 * core;

      // Star sparkles embedded in the galaxy, on a hashed grid.
      const cs = 7;
      const gx = Math.floor(x / cs);
      const gy = Math.floor(y / cs);
      const h1 = hashI(gx, gy);
      if (h1 > 0.9) {
        const sx = gx * cs + hashI(gx + 91, gy) * cs;
        const sy = gy * cs + hashI(gx, gy + 57) * cs;
        const ddx = x - sx;
        const ddy = y - sy;
        const sp = Math.exp(-(ddx * ddx + ddy * ddy) / 2.4) * (0.35 + bright);
        cr += 0.95 * sp;
        cg += 0.98 * sp;
        cb += 1.12 * sp;
      }

      const m = mask * 0.96;
      addTo(img, x, y, cr * m, cg * m, cb * m);
      addTo(glow, x, y, cr * m * 0.22, cg * m * 0.22, cb * m * 0.22);

      // Fresnel rim: bright where the dome curves away, cyan melting to
      // gold on the upper right where the light catches it.
      const fres = sstep(0.6, 0.995, r);
      if (fres > 0.002) {
        const goldMix = sstep(-0.5, 0.95, uu * 0.72 - vv * 0.7);
        const rr = lerp(0.35, 1.12, goldMix);
        const rg = lerp(0.92, 0.8, goldMix);
        const rb = lerp(1.05, 0.38, goldMix);
        const f = fres * mask;
        addTo(img, x, y, rr * f * 1.35, rg * f * 1.35, rb * f * 1.35);
        addTo(glow, x, y, rr * f * 0.55, rg * f * 0.55, rb * f * 0.55);
      }
    }
  }
}

function paintOrgans(): void {
  // Glowing guts hanging in the bell: rose and gold, soft as lanterns.
  const blobs: Array<[number, number, number, number, number, number, number]> = [
    // dx, dy (bell units), radius px, r, g, b, strength
    [-0.32, 0.0, 44, 1.08, 0.4, 0.52, 0.55],
    [-0.09, 0.1, 58, 1.12, 0.66, 0.3, 0.6],
    [0.15, 0.02, 50, 1.05, 0.42, 0.58, 0.55],
    [0.37, 0.1, 36, 1.1, 0.7, 0.32, 0.5],
    [0.02, -0.16, 32, 1.05, 0.5, 0.72, 0.45],
  ];
  for (const [du, dv, rad, r, g, b, s] of blobs) {
    const x = BCX + du * BR;
    const y = BCY + dv * BR * 0.94;
    stamp(img, x, y, rad, r, g, b, s);
    stamp(glow, x, y, rad * 1.7, r, g, b, s * 0.4);
  }
}

// A ribbon of light: a tapering, waving path stamped wide into the glow
// buffer and narrow and bright into the image.
function ribbon(
  sx: number,
  sy: number,
  len: number,
  wRoot: number,
  phase: number,
  freq: number,
  amp: number,
  drift: number,
  frill: number,
  top: [number, number, number],
  tip: [number, number, number],
  bright: number,
): void {
  const steps = Math.ceil(len / 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const yy = t * len;
    const x = sx - drift * Math.pow(t, 1.25) + Math.sin(yy * freq + phase) * amp * t;
    const y = sy + yy;
    let wdt = lerp(wRoot, 0.7, Math.pow(t, 0.8));
    if (frill > 0) wdt *= 0.78 + frill * (0.5 + 0.5 * Math.sin(yy * 0.13 + phase));
    const pulse = 0.7 + 0.5 * Math.sin(t * 9 - phase * 2);
    const cr = lerp(top[0], tip[0], t) * bright * pulse;
    const cg = lerp(top[1], tip[1], t) * bright * pulse;
    const cb = lerp(top[2], tip[2], t) * bright * pulse;
    stamp(glow, x, y, wdt * 2.7, cr, cg, cb, 0.3);
    stamp(img, x, y, Math.max(0.8, wdt), cr, cg, cb, 0.8);
  }
}

function paintTentacles(): void {
  const cyan: [number, number, number] = [0.38, 0.94, 1.05];
  const magenta: [number, number, number] = [1.02, 0.38, 0.9];
  const R = rng(777);
  // Four long hero tentacles sweep far down-left: the momentum lines.
  for (let i = 0; i < 4; i++) {
    const t = -0.55 + i * 0.34 + R() * 0.1;
    const sx = BCX + t * BR * 0.98;
    const sy = BCY + rimV(t) * BR * 0.94 + 4;
    ribbon(sx, sy, 470 + R() * 130, 7.5, R() * 6.28, 0.011 + R() * 0.004, 15 + R() * 9, 130 + R() * 50, 0, cyan, magenta, 1.25);
  }
  // The main veil of tentacles along the rim.
  for (let i = 0; i < 30; i++) {
    const t = -0.94 + (i / 29) * 1.88 + (R() - 0.5) * 0.04;
    const sx = BCX + t * BR * 0.98;
    const sy = BCY + rimV(t) * BR * 0.94 + 4;
    const centreBoost = 1 - Math.abs(t) * 0.45;
    ribbon(
      sx,
      sy,
      (225 + R() * 290) * centreBoost,
      4.2 + R() * 3.4,
      R() * 6.28,
      0.012 + R() * 0.013,
      8 + R() * 17,
      26 + R() * 66,
      0,
      cyan,
      magenta,
      0.85 + R() * 0.35,
    );
  }
  // Thick frilled oral arms at the centre, rose melting to violet.
  for (let i = 0; i < 5; i++) {
    const off = (i - 2) * 34 + (R() - 0.5) * 10;
    ribbon(
      BCX + off,
      BCY + rimV(off / BR) * BR * 0.94 + 2,
      150 + R() * 70,
      13 + R() * 6,
      R() * 6.28,
      0.016 + R() * 0.006,
      7 + R() * 6,
      22 + R() * 26,
      0.5,
      [1.06, 0.42, 0.6],
      [0.82, 0.32, 0.98],
      0.8,
    );
  }
}

function paintParticles(): void {
  const R = rng(99);
  const palette: Array<[number, number, number]> = [
    [0.42, 0.95, 1.05],
    [1.02, 0.42, 0.9],
    [1.1, 0.78, 0.4],
  ];
  for (let i = 0; i < 250; i++) {
    const x = BCX + (R() - 0.64) * 600;
    const y = BCY - 30 + R() * 580;
    const size = 0.8 + R() * 2.3;
    const col = palette[Math.floor(R() * 3)];
    const s = 0.4 + R() * 0.85;
    stamp(img, x, y, size * 1.6, col[0], col[1], col[2], s);
    stamp(glow, x, y, size * 4.2, col[0], col[1], col[2], s * 0.32);
  }
  // Sparks shedding off the rim.
  for (let i = 0; i < 80; i++) {
    const t = -1 + R() * 2;
    const x = BCX + t * BR * (0.95 + R() * 0.2);
    const y = BCY + (rimV(t) + R() * 0.35) * BR * 0.94;
    const s = 0.35 + R() * 0.6;
    stamp(img, x, y, 1.5, 0.5, 0.95, 1.05, s);
    stamp(glow, x, y, 4, 0.5, 0.95, 1.05, s * 0.3);
  }
}

// ------------------------------------------------------------ glow composite

function compositeGlow(): void {
  const S = 4;
  const SW = W / S;
  const SH = H / S;
  const small = new Float32Array(SW * SH * 3);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const i = ((y * S + dy) * W + (x * S + dx)) * 3;
          r += glow[i];
          g += glow[i + 1];
          b += glow[i + 2];
        }
      }
      const o = (y * SW + x) * 3;
      const n = S * S;
      small[o] = r / n;
      small[o + 1] = g / n;
      small[o + 2] = b / n;
    }
  }
  // A few box-blur passes at low resolution = one wide soft bloom.
  const tmp = new Float32Array(SW * SH * 3);
  for (let pass = 0; pass < 3; pass++) {
    const rad = 3;
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= SW) continue;
          const i = (y * SW + xx) * 3;
          r += small[i];
          g += small[i + 1];
          b += small[i + 2];
          n++;
        }
        const o = (y * SW + x) * 3;
        tmp[o] = r / n;
        tmp[o + 1] = g / n;
        tmp[o + 2] = b / n;
      }
    }
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -rad; dy <= rad; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= SH) continue;
          const i = (yy * SW + x) * 3;
          r += tmp[i];
          g += tmp[i + 1];
          b += tmp[i + 2];
          n++;
        }
        const o = (y * SW + x) * 3;
        small[o] = r / n;
        small[o + 1] = g / n;
        small[o + 2] = b / n;
      }
    }
  }
  // Bilinear upsample and add.
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / S - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / S - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let oy = 0; oy <= 1; oy++) {
        const yy = Math.min(SH - 1, Math.max(0, y0 + oy));
        const wy = oy === 0 ? 1 - ty : ty;
        for (let ox = 0; ox <= 1; ox++) {
          const xx = Math.min(SW - 1, Math.max(0, x0 + ox));
          const wx = ox === 0 ? 1 - tx : tx;
          const i = (yy * SW + xx) * 3;
          const w = wx * wy * S * S; // undo the box average: energy back
          r += small[i] * w;
          g += small[i + 1] * w;
          b += small[i + 2] * w;
        }
      }
      const o = (y * W + x) * 3;
      img[o] += r * 0.85;
      img[o + 1] += g * 0.85;
      img[o + 2] += b * 0.85;
    }
  }
}

// --------------------------------------------------------------------- city

function paintCity(): void {
  const R = rng(4242);
  let bx = -8;
  while (bx < W + 8) {
    const bw = 24 + R() * 56;
    const bh = 36 + R() * R() * 128;
    const top = Math.round(H - bh);
    const shade = 0.75 + R() * 0.5;
    for (let y = top; y < H; y++) {
      for (let x = Math.max(0, Math.round(bx)); x < Math.min(W, Math.round(bx + bw)); x++) {
        setTo(x, y, 0.012 * shade, 0.014 * shade, 0.032 * shade);
      }
    }
    // Rooftop rim light: the jellyfish glow catches every roof edge.
    const yTop = top;
    for (let x = Math.max(0, Math.round(bx)); x < Math.min(W, Math.round(bx + bw)); x++) {
      addTo(img, x, yTop, 0.1, 0.3, 0.38);
      addTo(img, x, yTop + 1, 0.03, 0.09, 0.12);
    }
    // Antenna with a red beacon on the taller towers.
    if (bh > 105 && R() < 0.8) {
      const ax = Math.round(bx + bw / 2);
      const ah = 9 + R() * 15;
      for (let y = Math.round(top - ah); y < top; y++) setTo(ax, y, 0.012, 0.014, 0.032);
      stamp(img, ax, Math.round(top - ah), 1.6, 1.05, 0.14, 0.18, 0.9);
    }
    // Windows: pinpricks of warm light, a few cool ones.
    for (let wy = top + 7; wy < H - 5; wy += 9) {
      for (let wx = bx + 4; wx < bx + bw - 4; wx += 8) {
        if (R() < 0.3) {
          const warm = R() < 0.82;
          const inten = 0.3 + R() * 0.65;
          const cr = warm ? 1.05 : 0.72;
          const cg = warm ? 0.74 : 0.84;
          const cb = warm ? 0.36 : 1.0;
          for (let dy = 0; dy < 3; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              addTo(img, Math.round(wx) + dx, wy + dy, cr * inten, cg * inten, cb * inten);
            }
          }
        }
      }
    }
    bx += bw + (R() < 0.3 ? 2 : 0);
  }
  // Mist pooling over the rooftops.
  for (let y = 872; y < 990; y++) {
    const a = Math.sin(((y - 872) / 118) * Math.PI) * 0.05;
    for (let x = 0; x < W; x++) addTo(img, x, y, 0.34 * a, 0.44 * a, 0.68 * a);
  }
}

function vignette(): void {
  for (let y = 0; y < H; y++) {
    const ny = (y - H * 0.44) / (H * 0.72);
    for (let x = 0; x < W; x++) {
      const nx = (x - W * 0.5) / (W * 0.72);
      const d = Math.sqrt(nx * nx + ny * ny);
      const m = 1 - 0.4 * sstep(0.55, 1.08, d);
      const i = (y * W + x) * 3;
      img[i] *= m;
      img[i + 1] *= m;
      img[i + 2] *= m;
    }
  }
}

// -------------------------------------------------------------- PNG encoding

const CRC_TABLE = ((): Int32Array => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const crcData = Buffer.concat([out.subarray(4, 8), data]);
  out.writeUInt32BE(crc32(crcData), 8 + data.length);
  return out;
}

function encodePNG(rgb: Uint8Array): Buffer {
  const stride = W * 3;
  const raw = Buffer.alloc(H * (stride + 1));
  const rowBuf = Buffer.alloc(stride);
  const filt = Buffer.alloc(stride);
  let prev: Buffer | null = null;
  let pos = 0;
  for (let y = 0; y < H; y++) {
    rowBuf.set(rgb.subarray(y * stride, (y + 1) * stride));
    // Pick the filter with the least absolute signed-byte energy.
    let bestType = 0;
    let bestScore = Infinity;
    let bestRow: Buffer | null = null;
    for (let type = 0; type <= 4; type++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? rowBuf[i - 3] : 0;
        const b = prev ? prev[i] : 0;
        const c = prev && i >= 3 ? prev[i - 3] : 0;
        let v: number;
        if (type === 0) v = rowBuf[i];
        else if (type === 1) v = rowBuf[i] - a;
        else if (type === 2) v = rowBuf[i] - b;
        else if (type === 3) v = rowBuf[i] - ((a + b) >> 1);
        else {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = rowBuf[i] - pred;
        }
        filt[i] = v & 0xff;
        score += Math.abs(v & 0x80 ? v - 256 : v);
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        bestRow = Buffer.from(filt);
      }
    }
    raw[pos++] = bestType;
    (bestRow as Buffer).copy(raw, pos);
    pos += stride;
    prev = rowBuf;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------- main

function render(): Buffer {
  paintSky();
  paintStars();
  paintBeams();
  paintBellHalo();
  paintGalaxy();
  paintOrgans();
  paintTentacles();
  paintParticles();
  compositeGlow();
  paintCity();
  vignette();

  // Tonemap: soft exponential shoulder, gentle gamma lift, quantise.
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) {
    let v = 1 - Math.exp(-img[i] * 1.3);
    v = Math.pow(v, 0.82);
    rgb[i] = Math.round(clamp01(v) * 255);
  }
  return encodePNG(rgb);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), render());
