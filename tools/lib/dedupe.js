'use strict';
/** 去重核心算法：文本归一化 + 字符二元组 Jaccard 相似度；关卡几何指纹（颜色归一化 + 镜像比对） */
const crypto = require('crypto');
const { Sim, GW, GH, WALL, OUTSIDE, BOARD_BASE, FROZEN_BASE, isSand } = require('./sim');

function normalizeText(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(s) {
  const t = normalizeText(s);
  const set = new Set();
  if (t.length === 1) set.add(t);
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

function jaccard(a, b) {
  const A = a instanceof Set ? a : bigrams(a);
  const B = b instanceof Set ? b : bigrams(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 最长公共子序列占较长者比例：专门识别"插字/删字"式改名（纯金招财橘猫 → 纯金招财大橘猫） */
function lcsRatio(a, b) {
  const s = [...normalizeText(a)], t = [...normalizeText(b)];
  if (!s.length || !t.length) return 0;
  const dp = Array(t.length + 1).fill(0);
  for (let i = 1; i <= s.length; i++) {
    let prev = 0;
    for (let j = 1; j <= t.length; j++) {
      const tmp = dp[j];
      dp[j] = s[i - 1] === t[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[t.length] / Math.max(s.length, t.length);
}

/** 名称相似度 = max(二元组 Jaccard, LCS 比例) */
function nameSimilarity(a, b) {
  return Math.max(jaccard(a, b), lcsRatio(a, b));
}

/**
 * 关卡几何指纹：将初始盘面按 5×5 格降采样为 30×33 字符矩阵。
 * - 沙色按"桶队列首次出现顺序"归一化为 a/b/c/d…，所以"只换颜色"的克隆关也能被识别；
 * - 同时比对水平镜像，"左右翻转"的克隆关也能被识别。
 */
const CELL = 5;
const FW = Math.ceil(GW / CELL);
const FH = Math.ceil(GH / CELL);

function levelFingerprint(level, vessels) {
  const sim = new Sim(level, vessels);
  const order = [];
  for (const b of level.bucketQueue) if (!order.includes(b.color)) order.push(b.color);
  const colorCode = c => (c === 5 ? 'G' : String.fromCharCode(97 + Math.max(0, order.indexOf(c))));
  const lockedVals = new Set(sim.boards.filter(b => b.lockColor).map(b => b.val));
  const openGateMask = new Uint8Array(GW * GH);
  for (const b of sim.boards) {
    if (!b.isOpen) continue;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x1 - b.x0, b.y1 - b.y0)));
    for (let s = 0; s <= steps; s++) {
      const gx = Math.round(b.x0 + ((b.x1 - b.x0) * s) / steps);
      const gy = Math.round(b.y0 + ((b.y1 - b.y0) * s) / steps);
      if (gx >= 0 && gx < GW && gy >= 0 && gy < GH) openGateMask[gy * GW + gx] = 1;
    }
  }
  const rows = [];
  for (let fy = 0; fy < FH; fy++) {
    let row = '';
    for (let fx = 0; fx < FW; fx++) {
      const counts = {};
      for (let y = fy * CELL; y < Math.min(GH, (fy + 1) * CELL); y++) {
        for (let x = fx * CELL; x < Math.min(GW, (fx + 1) * CELL); x++) {
          const v = sim.grid[y * GW + x];
          let k = '.';
          if (v === WALL) k = '#';
          else if (v === OUTSIDE) k = ' ';
          else if (v >= FROZEN_BASE) { const ice = sim.ice.find(i => i.val === v); k = ice ? colorCode(ice.color).toUpperCase() : 'I'; }
          else if (v >= BOARD_BASE) k = lockedVals.has(v) ? 'L' : '=';
          else if (openGateMask[y * GW + x]) k = '-';
          else if (isSand(v)) k = colorCode(v);
          else if (sim.dye[y * GW + x]) k = '~';
          counts[k] = (counts[k] || 0) + 1;
        }
      }
      // 结构元素（墙/木板/锁/虚线闸槽）优先，其次多数类
      let best = '.';
      if ((counts['='] || 0) >= 5) best = '=';
      else if ((counts.L || 0) >= 5) best = 'L';
      else if ((counts['-'] || 0) >= 4) best = '-';
      else if ((counts['#'] || 0) >= 6) best = '#';
      else {
        let m = -1;
        for (const [k, n] of Object.entries(counts)) if (n > m) { m = n; best = k; }
      }
      row += best;
    }
    rows.push(row);
  }
  const grid = rows.join('|');
  const queueSig = level.bucketQueue
    .map((b, i) => {
      const col = b.col != null ? b.col : i % (level.numCols || 4);
      return `${col}:${colorCode(b.color)}${b.mystery ? '?' : ''}${b.iceLayers ? 'i' + b.iceLayers : ''}`;
    })
    .join(',');
  const hash = crypto.createHash('sha1').update(grid + '#' + queueSig + '#' + level.vesselTemplate).digest('hex').slice(0, 16);
  return { grid, queueSig, hash };
}

function mirrorGrid(grid) {
  return grid.split('|').map(r => r.split('').reverse().join('')).join('|');
}

/** 仅在"非空白"格上比较的相似度（0~1） */
function gridSimilarity(g1, g2) {
  let same = 0, total = 0;
  for (let i = 0; i < Math.min(g1.length, g2.length); i++) {
    const a = g1[i], b = g2[i];
    if (a === '|') continue;
    const emptyA = a === '.' || a === ' ';
    const emptyB = b === '.' || b === ' ';
    if (emptyA && emptyB) continue;
    total++;
    if (a === b) same++;
  }
  return total ? same / total : 1;
}

function levelSimilarity(fpA, fpB) {
  const direct = gridSimilarity(fpA.grid, fpB.grid);
  const mirror = gridSimilarity(fpA.grid, mirrorGrid(fpB.grid));
  return { score: Math.max(direct, mirror), mirrored: mirror > direct };
}

module.exports = { normalizeText, bigrams, jaccard, lcsRatio, nameSimilarity, levelFingerprint, levelSimilarity, mirrorGrid };
