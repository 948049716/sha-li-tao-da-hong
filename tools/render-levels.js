#!/usr/bin/env node
'use strict';
/** 渲染双核关卡初始盘面预览图（上层宽底滤网沙箱 + 下层小卡槽与多列候选桶工作台）：docs/level_previews/lvl_XXXX.png 及 20 关总览图 */
const fs = require('fs');
const path = require('path');
const { Sim, GW, GH, WALL, OUTSIDE, BOARD_BASE, FROZEN_BASE, OUTLET } = require('./lib/sim');
const { encodePNG } = require('./lib/png');

const ROOT = path.resolve(__dirname, '..');
const vessels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/vessels.json'), 'utf8'));
const OUT = path.join(ROOT, 'docs/level_previews');
fs.mkdirSync(OUT, { recursive: true });

const SAND = {
  1: [236, 125, 132],
  2: [242, 188, 72],
  3: [86, 178, 238],
  4: [104, 206, 138],
  5: [250, 204, 21],
};
const SCALE = 2;
const TRAY_H = 92; // 下方小卡槽 + 多列候选桶预览区高度（像素）

function fillRect(px, W, H, x0, y0, w, h, col) {
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
      const i = (y * W + x) * 4;
      px[i] = col[0];
      px[i + 1] = col[1];
      px[i + 2] = col[2];
      px[i + 3] = 255;
    }
  }
}

function strokeRect(px, W, H, x0, y0, w, h, col, th = 2) {
  fillRect(px, W, H, x0, y0, w, th, col);
  fillRect(px, W, H, x0, y0 + h - th, w, th, col);
  fillRect(px, W, H, x0, y0, th, h, col);
  fillRect(px, W, H, x0 + w - th, y0, th, h, col);
}

function renderLevel(L) {
  const sim = new Sim(L, vessels);
  const W = GW * SCALE;
  const chamberH = GH * SCALE;
  const H = chamberH + TRAY_H;
  const px = new Uint8Array(W * H * 4);
  const lockCol = {};
  for (const b of sim.boards) if (b.lockColor) lockCol[b.val] = SAND[b.lockColor];
  const put = (x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = a;
  };

  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const v = sim.grid[i];
      let c = [253, 246, 227];
      if (v === WALL) {
        if (y >= GH - 3 && x >= OUTLET.x0 && x <= OUTLET.x1) {
          c = x % 4 === 0 ? [92, 54, 24] : [214, 158, 66]; // 黄铜滤沙格栅
        } else {
          c = [74, 47, 29];
        }
      } else if (v === OUTSIDE) {
        c = [237, 226, 200];
      } else if (v >= FROZEN_BASE) {
        const ice = sim.ice.find(k => k.val === v);
        const s = SAND[ice.color];
        c = [((s[0] + 255 * 2) / 3) | 0, ((s[1] + 255 * 2) / 3) | 0, ((s[2] + 255 * 2) / 3) | 0];
        if ((x + y) % 4 === 0) c = [255, 255, 255];
      } else if (v >= BOARD_BASE) {
        c = lockCol[v] ? (x % 3 === 0 ? lockCol[v] : [120, 72, 40]) : [176, 115, 64];
      } else if (v >= 1 && v <= 5) {
        c = SAND[v];
      } else if (sim.dye[i]) {
        c = (x + y) % 3 === 0 ? SAND[sim.dye[i]] : [253, 246, 227];
      }
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) put(x * SCALE + dx, y * SCALE + dy, c);
      }
    }
  }

  // 绘制底部工作台：4+1 小卡槽 + 3~4 列候选木桶（? 盲桶涂紫褐问号斑，🧊 冰封桶加冰蓝框）
  fillRect(px, W, H, 0, chamberH, W, TRAY_H, [206, 162, 112]);
  fillRect(px, W, H, 0, chamberH, W, 3, [74, 47, 29]);

  const slotW = 42;
  const slotGap = 8;
  const slotStartX = Math.floor((W - (5 * slotW + 4 * slotGap)) / 2);
  for (let s = 0; s < 5; s++) {
    const sx = slotStartX + s * (slotW + slotGap);
    const sy = chamberH + 7;
    fillRect(px, W, H, sx, sy, slotW, 18, s === 4 ? [182, 140, 96] : [238, 222, 194]);
    strokeRect(px, W, H, sx, sy, slotW, 18, [92, 54, 24], 2);
  }

  const nCols = sim.numCols;
  const colW = 54;
  const colGap = 12;
  const colStartX = Math.floor((W - (nCols * colW + (nCols - 1) * colGap)) / 2);
  for (let cIdx = 0; cIdx < nCols; cIdx++) {
    const cx = colStartX + cIdx * (colW + colGap);
    const col = sim.columns[cIdx] || [];
    fillRect(px, W, H, cx, chamberH + 30, colW, 56, [186, 142, 94]);
    for (let rIdx = 0; rIdx < Math.min(3, col.length); rIdx++) {
      const bk = col[rIdx];
      const by = chamberH + 32 + rIdx * 18;
      const fill = !bk.mysteryRevealed ? [126, 98, 78] : SAND[bk.color] || [220, 180, 140];
      fillRect(px, W, H, cx + 4, by, colW - 8, 15, fill);
      const border = bk.iceLayers > 0 ? [96, 188, 248] : [74, 47, 29];
      strokeRect(px, W, H, cx + 4, by, colW - 8, 15, border, 2);
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
    const cols = 5,
      pad = 8;
    const cw = imgs[0].W,
      chh = imgs[0].H;
    const rows = Math.ceil(imgs.length / cols);
    const OW = cols * (cw + pad) + pad,
      OH = rows * (chh + pad) + pad;
    const out = new Uint8Array(OW * OH * 4).fill(255);
    imgs.forEach((im, k) => {
      const ox = pad + (k % cols) * (cw + pad),
        oy = pad + Math.floor(k / cols) * (chh + pad);
      for (let y = 0; y < im.H; y++) {
        for (let x = 0; x < im.W; x++) {
          const s = (y * im.W + x) * 4,
            d = ((oy + y) * OW + ox + x) * 4;
          out[d] = im.px[s];
          out[d + 1] = im.px[s + 1];
          out[d + 2] = im.px[s + 2];
          out[d + 3] = 255;
        }
      }
    });
    const name = `overview_${f.replace('.json', '')}.png`;
    fs.writeFileSync(path.join(OUT, name), encodePNG(OW, OH, out));
    console.log(`已渲染 ${imgs.length} 关 → docs/level_previews/（总览 ${name}）`);
  }
}
main();
