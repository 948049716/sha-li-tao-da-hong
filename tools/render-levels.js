#!/usr/bin/env node
'use strict';
/** 渲染关卡初始盘面预览图：docs/level_previews/lvl_XXXX.png 以及 20 关总览图 overview_chapter_01.png */
const fs = require('fs');
const path = require('path');
const { Sim, GW, GH, WALL, OUTSIDE, BOARD_BASE, FROZEN_BASE } = require('./lib/sim');
const { encodePNG } = require('./lib/png');

const ROOT = path.resolve(__dirname, '..');
const vessels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/vessels.json'), 'utf8'));
const OUT = path.join(ROOT, 'docs/level_previews');
fs.mkdirSync(OUT, { recursive: true });

const SAND = { 1: [255, 93, 115], 2: [255, 184, 48], 3: [56, 182, 255], 4: [76, 217, 123], 5: [250, 204, 21] };
const BOX = { box_white: [229, 231, 235], box_purple: [139, 92, 246], box_gold: [245, 158, 11], box_red: [185, 28, 28], box_ice: [186, 230, 253], box_double: [244, 114, 182] };
const SCALE = 2;

function renderLevel(L) {
  const sim = new Sim(L, vessels);
  const W = GW * SCALE, H = GH * SCALE;
  const px = new Uint8Array(W * H * 4);
  const lockCol = {};
  for (const b of sim.boards) if (b.lockColor) lockCol[b.val] = SAND[b.lockColor];
  const put = (x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
  };
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const v = sim.grid[i];
      let c = [253, 246, 227];
      if (v === WALL) c = [74, 47, 29];
      else if (v === OUTSIDE) c = [237, 226, 200];
      else if (v >= FROZEN_BASE) {
        const ice = sim.ice.find(k => k.val === v);
        const s = SAND[ice.color];
        if (ice.iceType === 'permafrost') {
          const edge = sim.grid[i - 1] !== v || sim.grid[i + 1] !== v || sim.grid[i - GW] !== v || sim.grid[i + GW] !== v;
          c = edge ? [29, 78, 216] : [(s[0] + 147 * 2) / 3 | 0, (s[1] + 197 * 2) / 3 | 0, (s[2] + 253 * 2) / 3 | 0];
        } else {
          c = [(s[0] + 255 * 2) / 3 | 0, (s[1] + 255 * 2) / 3 | 0, (s[2] + 255 * 2) / 3 | 0];
          if ((x + y) % 4 === 0) c = [255, 255, 255];
        }
      }
      else if (v >= BOARD_BASE) c = lockCol[v] ? ((x % 3 === 0) ? lockCol[v] : [120, 72, 40]) : [176, 115, 64];
      else if (v >= 1 && v <= 5) c = SAND[v];
      else if (sim.dye[i]) c = (x + y) % 3 === 0 ? SAND[sim.dye[i]] : [253, 246, 227];
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) put(x * SCALE + dx, y * SCALE + dy, c);
    }
  }
  // 叠加绘制 startsOpen 推入式虚线导槽
  for (const b of sim.boards) {
    if (!b.isOpen) continue;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x1 - b.x0, b.y1 - b.y0)));
    for (let s = 0; s <= steps; s++) {
      if ((s >> 2) % 2 === 1) continue;
      const gx = Math.round(b.x0 + ((b.x1 - b.x0) * s) / steps);
      const gy = Math.round(b.y0 + ((b.y1 - b.y0) * s) / steps);
      for (let dy = 0; dy < SCALE * 2; dy++) {
        for (let dx = 0; dx < SCALE; dx++) put(gx * SCALE + dx, gy * SCALE + dy, [217, 119, 6]);
      }
    }
  }
  for (const cap of sim.capsules) {
    const col = BOX[cap.boxType] || [0, 0, 0];
    const r = cap.r * SCALE;
    for (let dy = -r - 2; dy <= r + 2; dy++) for (let dx = -r - 2; dx <= r + 2; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      const X = Math.round(cap.x * SCALE + dx), Y = Math.round(cap.y * SCALE + dy);
      if (d <= r - 2) put(X, Y, col);
      else if (d <= r + 1) put(X, Y, [17, 24, 39]);
    }
  }
  return { W, H, px };
}

function main() {
  const files = fs.readdirSync(path.join(ROOT, 'data/levels')).filter(f => f.endsWith('.json')).sort();
  for (const f of files) {
    const ch = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/levels', f), 'utf8'));
    const imgs = ch.levels.map(L => ({ L, ...renderLevel(L) }));
    for (const im of imgs) fs.writeFileSync(path.join(OUT, `${im.L.key}.png`), encodePNG(im.W, im.H, im.px));
    // 总览图：5 列
    const cols = 5, pad = 8;
    const cw = imgs[0].W, chh = imgs[0].H;
    const rows = Math.ceil(imgs.length / cols);
    const OW = cols * (cw + pad) + pad, OH = rows * (chh + pad) + pad;
    const out = new Uint8Array(OW * OH * 4).fill(255);
    imgs.forEach((im, k) => {
      const ox = pad + (k % cols) * (cw + pad), oy = pad + Math.floor(k / cols) * (chh + pad);
      for (let y = 0; y < im.H; y++) for (let x = 0; x < im.W; x++) {
        const s = (y * im.W + x) * 4, d = ((oy + y) * OW + ox + x) * 4;
        out[d] = im.px[s]; out[d + 1] = im.px[s + 1]; out[d + 2] = im.px[s + 2]; out[d + 3] = 255;
      }
    });
    const name = `overview_${f.replace('.json', '')}.png`;
    fs.writeFileSync(path.join(OUT, name), encodePNG(OW, OH, out));
    console.log(`已渲染 ${imgs.length} 关 → docs/level_previews/（总览 ${name}）`);
  }
}
main();
