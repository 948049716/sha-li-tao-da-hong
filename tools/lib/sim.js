'use strict';
/**
 * 《沙里淘大红》无头确定性流沙模拟器（与 demos/sand_pin_blindbox_demo.html 的元胞自动机规则一致）
 * 用途：关卡自动校验（标准解法必通关 / 零残留 / 防死锁 / 陷阱检测）与关卡预览图渲染。
 * 正式引擎（TypeScript）实现时应与本文件保持同一套规则，保证"校验通过 = 真机可通关"。
 */

const GW = 150;
const GH = 165;
const EMPTY = 0;
const OUTSIDE = 8;
const WALL = 9;
const GOLD = 5;
const BOARD_BASE = 20; // 20..59
const FROZEN_BASE = 60; // 60..89
const OUTLET = { x0: 58, x1: 91, y0: GH - 11, y1: GH - 2 };
const CAPSULE_COLLECT_Y = GH - 15;
const FILL_RATIO = 0.985;
const DEFAULT_SHATTER_DROP = 52;
const DEFAULT_THAW_CONTACTS = 1200;
const BOX_RADIUS = { box_red: 7.5, box_double: 7.5 };

const isSand = v => v >= 1 && v <= 5;

function mulberry32(seed) {
  let s = seed >>> 0;
  return function rand() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stampLine(x0, y0, x1, y1, th, fn) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps;
    const y = y0 + ((y1 - y0) * s) / steps;
    for (let dy = -th; dy <= th; dy++) {
      for (let dx = -th; dx <= th; dx++) {
        if (dx * dx + dy * dy <= th * th + 1) {
          const rx = Math.round(x + dx);
          const ry = Math.round(y + dy);
          if (rx >= 0 && rx < GW && ry >= 0 && ry < GH) fn(rx, ry);
        }
      }
    }
  }
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function zoneContains(zone, x, y) {
  if (zone.shape === 'poly') return pointInPoly(x + 0.5, y + 0.5, zone.points);
  return x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1;
}

class Sim {
  constructor(level, vessels, opts = {}) {
    this.level = level;
    this.vessels = vessels;
    this.rng = mulberry32(opts.seed != null ? opts.seed : 20261121);
    this.grid = new Uint8Array(GW * GH);
    this.tag = new Uint8Array(GW * GH); // bucket index + 1
    this.interior = new Uint8Array(GW * GH);
    this.dye = new Uint8Array(GW * GH); // target color
    this.dyeFrom = new Uint8Array(GW * GH); // bitmask of source colors (0 = all)
    this.frame = 0;
    this.events = [];
    this.residueRemoved = 0;
    this.errors = [];
    this.build();
  }

  idx(x, y) { return y * GW + x; }

  build() {
    const L = this.level;
    const vessel = this.vessels[L.vesselTemplate];
    if (!vessel) throw new Error(`未知容器模板 ${L.vesselTemplate}`);
    const g = this.grid;
    const setWall = (x, y) => { g[this.idx(x, y)] = WALL; };
    for (const poly of vessel.walls) {
      for (let i = 0; i < poly.points.length - 1; i++) {
        const [ax, ay] = poly.points[i];
        const [bx, by] = poly.points[i + 1];
        stampLine(ax, ay, bx, by, poly.thickness, setWall);
      }
    }
    for (const w of L.staticWalls || []) stampLine(w.x0, w.y0, w.x1, w.y1, w.thickness || 2, setWall);
    for (let x = 0; x < GW; x++) g[this.idx(x, GH - 1)] = WALL; // 出沙口底板

    // 计算容器内部掩码（从出沙口向上泛洪，顶部 y<6 视为封口）
    const seed = this.idx(75, GH - 4);
    const stack = [seed];
    this.interior[seed] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % GW;
      const y = (i / GW) | 0;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of nb) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= GW || ny < 6 || ny >= GH) continue;
        const j = this.idx(nx, ny);
        if (this.interior[j] || g[j] === WALL) continue;
        this.interior[j] = 1;
        stack.push(j);
      }
    }
    for (let i = 0; i < g.length; i++) if (!this.interior[i] && g[i] !== WALL) g[i] = OUTSIDE;

    // 木板（startsOpen 推入式闸门初始为开口虚线态，不写入阻挡网格）
    this.boards = (L.boards || []).map((b, k) => {
      const val = BOARD_BASE + k;
      const isOpen = Boolean(b.startsOpen);
      let cells = 0;
      if (!isOpen) {
        stampLine(b.x0, b.y0, b.x1, b.y1, 2, (x, y) => {
          const i = this.idx(x, y);
          if (this.interior[i] && g[i] === EMPTY) { g[i] = val; cells++; }
        });
      }
      return { ...b, val, isOpen, removed: false, cells };
    });

    // 染色环
    for (const ring of L.dyeRings || []) {
      let mask = 0;
      for (const c of ring.fromColors || []) mask |= 1 << c;
      for (let y = ring.y0; y <= ring.y1; y++) {
        for (let x = ring.x0; x <= ring.x1; x++) {
          const i = this.idx(x, y);
          if (this.interior[i]) { this.dye[i] = ring.toColor; this.dyeFrom[i] = mask; }
        }
      }
    }

    // 桶队列与区块→桶映射
    this.buckets = L.bucketQueue.map((b, k) => ({ idx: k, color: b.color, zones: b.zones, cur: 0, max: 0, done: false }));
    const zoneBucket = {};
    this.buckets.forEach(b => b.zones.forEach(z => { zoneBucket[z] = b.idx; }));

    // 冰砖先放置（固体），再填充流沙
    this.ice = [];
    this.zoneCells = {};
    for (const z of L.sandZones) {
      const bIdx = zoneBucket[z.id];
      let count = 0;
      const val = z.frozen ? FROZEN_BASE + this.ice.length : z.color;
      const cells = [];
      for (let y = 6; y < GH - 1; y++) {
        for (let x = 0; x < GW; x++) {
          if (!zoneContains(z, x, y)) continue;
          const i = this.idx(x, y);
          if (!this.interior[i] || g[i] !== EMPTY) continue;
          g[i] = val;
          this.tag[i] = bIdx != null ? bIdx + 1 : 0;
          count++;
          cells.push(i);
        }
      }
      this.zoneCells[z.id] = count;
      if (z.frozen) {
        const iceType = z.iceType || (z.thawContacts > 0 ? 'permafrost' : 'brittle');
        this.ice.push({
          zoneId: z.id,
          val,
          color: z.color,
          iceType,
          cells,
          fall: 0,
          moving: false,
          shattered: false,
          shatterDrop: z.shatterDrop || DEFAULT_SHATTER_DROP,
          thawContacts: z.thawContacts || DEFAULT_THAW_CONTACTS,
          thawProgress: 0,
          primed: false,
          clearFrames: 0,
        });
      }
    }
    for (const b of this.buckets) b.max = b.zones.reduce((s, z) => s + (this.zoneCells[z] || 0), 0);

    this.capsules = (L.capsules || []).map(c => ({ ...c, r: BOX_RADIUS[c.boxType] || 6.5, collected: false, naturally: false }));
    this.active = this.buckets.length ? [this.buckets[0]] : [];
    this.queuePtr = 1;
    this.won = false;
  }

  closeGateInGrid(b) {
    const g = this.grid;
    const tag = this.tag;
    stampLine(b.x0, b.y0, b.x1, b.y1, 2, (x, y) => {
      const i = this.idx(x, y);
      if (!this.interior[i] || g[i] === WALL || g[i] === b.val) return;
      if (isSand(g[i])) {
        let moved = false;
        for (let d = 1; d < 28 && !moved; d++) {
          for (const ny of [y - d, y + d]) {
            if (ny < 6 || ny >= GH - 1) continue;
            const ni = this.idx(x, ny);
            if (this.interior[ni] && g[ni] === EMPTY) {
              g[ni] = g[i];
              tag[ni] = tag[i];
              moved = true;
              break;
            }
          }
        }
        tag[i] = 0;
      }
      if (g[i] === EMPTY || isSand(g[i])) {
        g[i] = b.val;
      }
    });
  }

  // ---------- 动作 ----------
  pullBoard(id, auto = false, fromLink = false) {
    const b = this.boards.find(x => x.id === id);
    if (!b) throw new Error(`木板 ${id} 不存在`);
    if (b.removed) return { ok: false, reason: 'already_removed' };
    if (b.lockColor && !auto) return { ok: false, reason: 'locked' };

    if (b.isOpen) {
      b.isOpen = false;
      this.closeGateInGrid(b);
      this.events.push({ frame: this.frame, type: 'push_close', board: id });
    } else {
      for (let i = 0; i < this.grid.length; i++) if (this.grid[i] === b.val) this.grid[i] = EMPTY;
      if (b.reusable) {
        b.isOpen = true;
        this.events.push({ frame: this.frame, type: 'pull_open_reusable', board: id });
      } else {
        b.removed = true;
        this.events.push({ frame: this.frame, type: auto ? 'auto_unlock' : 'pull', board: id });
      }
    }

    if (!fromLink) {
      const partners = this.boards.filter(
        x => x.id !== b.id && !x.removed && !x.lockColor && (x.id === b.linkedTo || x.linkedTo === b.id)
      );
      for (const pb of partners) {
        this.pullBoard(pb.id, auto, true);
      }
    }
    return { ok: true };
  }

  // ---------- 单帧 ----------
  step() {
    this.frame++;
    let activity = 0;
    const g = this.grid;
    const tag = this.tag;

    // 1. 出沙口自动吸沙
    let drained = 0;
    let wrong = false;
    for (let y = OUTLET.y1; y >= OUTLET.y0 && drained < 32; y--) {
      const leftFirst = y % 2 === 0;
      for (let s = OUTLET.x0; s <= OUTLET.x1 && drained < 32; s++) {
        const x = leftFirst ? s : OUTLET.x0 + OUTLET.x1 - s;
        const i = this.idx(x, y);
        const c = g[i];
        if (!isSand(c)) continue;
        let target = null;
        if (c === GOLD) target = this.buckets[tag[i] - 1] || this.active[0];
        else target = this.active.find(b => b.color === c);
        if (target) {
          g[i] = EMPTY; tag[i] = 0; drained++;
          target.cur++;
          this.checkBucket(target);
        } else {
          wrong = true;
        }
      }
    }
    activity += drained;
    this.lastWrong = wrong && drained === 0;

    // 2. 流沙元胞自动机（每帧 2 子步）
    for (let pass = 0; pass < 2; pass++) {
      for (let y = GH - 3; y >= 6; y--) {
        const dir = (y + pass + this.frame) % 2 === 0;
        for (let s = 1; s < GW - 1; s++) {
          const x = dir ? s : GW - 1 - s;
          const i = this.idx(x, y);
          const c = g[i];
          if (!isSand(c)) continue;
          const moveTo = j => {
            g[j] = c; tag[j] = tag[i]; g[i] = EMPTY; tag[i] = 0; activity++;
            if (this.dye[j] && c !== GOLD && c !== this.dye[j] && (!this.dyeFrom[j] || (this.dyeFrom[j] & (1 << c)))) {
              g[j] = this.dye[j];
            }
          };
          const b0 = this.idx(x, y + 1);
          if (g[b0] === EMPTY) { moveTo(b0); continue; }
          const d1 = this.rng() < 0.5 ? -1 : 1;
          const d2 = -d1;
          const b1 = this.idx(x + d1, y + 1);
          const b2 = this.idx(x + d2, y + 1);
          if (g[b1] === EMPTY) moveTo(b1);
          else if (g[b2] === EMPTY) moveTo(b2);
          else {
            const nx = x + d1 * 2;
            if (nx > 0 && nx < GW - 1 && g[this.idx(x + d1, y)] === EMPTY && g[this.idx(nx, y + 1)] === EMPTY) moveTo(this.idx(nx, y + 1));
          }
        }
      }
    }

    // 3. 冰砖刚体下落 / 脆冰硬底碎裂(软沙缓冲不碎) / 万年寒冰流沙冲刷解冻
    for (const ice of this.ice) {
      if (ice.shattered) continue;
      const own = new Set(ice.cells);

      // 3a. 万年寒冰：统计冰面外缘接触的流动松散沙粒进行冲刷融冰
      if (ice.iceType === 'permafrost') {
        let touchingSand = 0;
        let touchingForeign = 0;
        for (const i of ice.cells) {
          const nbs = [i - GW, i - 1, i + 1];
          for (const nb of nbs) {
            if (nb < 0 || nb >= g.length || own.has(nb)) continue;
            const c = g[nb];
            if (isSand(c)) {
              touchingSand++;
              if (c !== ice.color && c !== GOLD) touchingForeign++;
            }
          }
        }
        if (!ice.primed && touchingSand > 0) {
          ice.thawProgress = Math.min(ice.thawContacts, ice.thawProgress + touchingSand);
          activity++;
          if (ice.thawProgress >= ice.thawContacts) {
            ice.primed = true;
          }
        }
        if (ice.primed) {
          if (touchingForeign <= 3) {
            ice.clearFrames++;
            activity++;
            if (ice.clearFrames >= 8) {
              for (const i of ice.cells) g[i] = ice.color;
              ice.shattered = true;
              this.events.push({ frame: this.frame, type: 'permafrost_thaw', zone: ice.zoneId });
              activity++;
              continue;
            }
          } else {
            ice.clearFrames = 0;
          }
        }
      }

      let free = true;
      for (const i of ice.cells) {
        const below = i + GW;
        if (below >= g.length || (!own.has(below) && g[below] !== EMPTY)) { free = false; break; }
      }
      if (free) {
        const moved = [];
        for (const i of ice.cells) { g[i] = EMPTY; }
        const tags = ice.cells.map(i => tag[i]);
        for (const i of ice.cells) tag[i] = 0;
        ice.cells.forEach((i, k) => { const j = i + GW; g[j] = ice.val; tag[j] = tags[k]; moved.push(j); });
        ice.cells = moved;
        ice.fall++;
        ice.moving = true;
        activity++;
      } else if (ice.moving) {
        ice.moving = false;
        let cushionedBySand = false;
        for (const i of ice.cells) {
          const below = i + GW;
          if (below < g.length && !own.has(below) && g[below] !== EMPTY) {
            if (isSand(g[below]) || g[below] >= FROZEN_BASE) {
              cushionedBySand = true;
              break;
            }
          }
        }
        if (ice.iceType !== 'permafrost' && !cushionedBySand && ice.fall >= ice.shatterDrop) {
          for (const i of ice.cells) g[i] = ice.color;
          ice.shattered = true;
          this.events.push({ frame: this.frame, type: 'ice_shatter', zone: ice.zoneId, drop: ice.fall });
          activity++;
        } else {
          this.events.push({ frame: this.frame, type: 'ice_land_intact', zone: ice.zoneId, drop: ice.fall, cushionedBySand });
        }
        ice.fall = 0;
      }
    }

    // 4. 盲盒胶囊重力
    for (const cap of this.capsules) {
      if (cap.collected) continue;
      const gx = Math.round(cap.x);
      const gy = Math.round(cap.y);
      const before = [cap.x, cap.y];
      if (this.capsuleClear(gx, gy + 1, cap.r)) cap.y += 1.25;
      else {
        const tc = cap.x < GW / 2 ? 1 : -1;
        if (this.capsuleClear(gx + tc, gy + 1, cap.r)) { cap.x += tc * 0.9; cap.y += 0.9; }
        else if (this.capsuleClear(gx - tc, gy + 1, cap.r)) { cap.x -= tc * 0.9; cap.y += 0.9; }
        else {
          // 斜面滚动：支撑点偏向哪侧，就往另一侧滚
          const [lh, rh] = this.supportBalance(gx, gy, cap.r);
          if (lh !== rh) {
            const d = lh > rh ? 1 : -1;
            if (this.capsuleClear(gx + d, gy, cap.r)) cap.x += d * 0.7;
          }
        }
      }
      if (cap.x !== before[0] || cap.y !== before[1]) activity++;
      if (cap.y >= CAPSULE_COLLECT_Y) { cap.collected = true; cap.naturally = true; this.events.push({ frame: this.frame, type: 'capsule', box: cap.boxType }); }
    }

    if (!this.won && this.buckets.every(b => b.done)) {
      this.won = true;
      this.events.push({ frame: this.frame, type: 'win' });
    }
    return activity;
  }

  supportBalance(gx, gy, r) {
    const R = Math.ceil(r) + 1;
    let l = 0, rr = 0;
    for (let dy = 1; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx === 0 || dx * dx + dy * dy > (r + 1) * (r + 1)) continue;
        const x = gx + dx, y = gy + dy;
        if (x < 0 || x >= GW || y >= GH) continue;
        if (this.grid[this.idx(x, y)] !== EMPTY) { if (dx < 0) l++; else rr++; }
      }
    }
    return [l, rr];
  }

  /** 通关后让剩余胶囊继续下落一段时间，区分"自然滚出"与"卡住需自动飞入" */
  finishCapsules(frames = 400) {
    for (let k = 0; k < frames && this.capsules.some(c => !c.collected); k++) this.step();
    for (const cap of this.capsules) if (!cap.collected) cap.collected = true;
  }

  capsuleClear(gx, gy, r) {
    const R = Math.ceil(r);
    let hits = 0;
    for (let dy = 0; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = gx + dx;
        const y = gy + dy;
        if (x < 0 || x >= GW || y < 0 || y >= GH) return false;
        if (this.grid[this.idx(x, y)] !== EMPTY) hits++;
        if (hits > 1) return false;
      }
    }
    return true;
  }

  checkBucket(b) {
    if (b.done || b.cur < Math.ceil(b.max * FILL_RATIO)) return;
    b.done = true;
    this.events.push({ frame: this.frame, type: 'bucket_full', bucket: b.idx, color: b.color });
    const g = this.grid;
    const leftovers = [];
    for (let i = 0; i < g.length; i++) if (this.tag[i] === b.idx + 1 && (isSand(g[i]) || g[i] >= FROZEN_BASE)) leftovers.push(i);
    const next = this.buckets.find(x => !x.done && x.idx > b.idx && x.color === b.color);
    const tailLimit = Math.ceil(b.max * 0.03);
    if (next && leftovers.length > tailLimit) {
      for (const i of leftovers) this.tag[i] = next.idx + 1;
      let cnt = 0;
      for (let i = 0; i < g.length; i++) if (this.tag[i] === next.idx + 1 && (isSand(g[i]) || g[i] >= FROZEN_BASE)) cnt++;
      next.max = next.cur + cnt;
    } else {
      for (const i of leftovers) if (isSand(g[i])) { g[i] = EMPTY; this.tag[i] = 0; this.residueRemoved++; }
    }
    // 颜色锁：首次装满对应颜色的桶即自动崩开并抽走
    for (const bd of this.boards) {
      if (!bd.removed && bd.lockColor === b.color) this.pullBoard(bd.id, true);
    }
    // 推进队列
    this.active = this.active.filter(x => !x.done);
    while (this.active.length === 0 && this.queuePtr < this.buckets.length) {
      const nb = this.buckets[this.queuePtr++];
      if (!nb.done) this.active.push(nb);
    }
    // 已提前装满的（如黄金桶）直接弹出
    while (this.active.length && this.active[0].done) {
      this.active.shift();
      if (this.queuePtr < this.buckets.length) this.active.push(this.buckets[this.queuePtr++]);
    }
  }

  outletHasWrongColor() {
    for (let y = OUTLET.y0; y <= OUTLET.y1; y++) {
      for (let x = OUTLET.x0; x <= OUTLET.x1; x++) {
        const c = this.grid[this.idx(x, y)];
        if (isSand(c) && c !== GOLD && !this.active.some(b => b.color === c)) return true;
      }
    }
    // 未碎冰砖楔死在底部漏斗咽喉 (y >= 138) 视为硬堵口
    for (const ice of this.ice) {
      if (ice.shattered || ice.moving || ice.primed) continue;
      for (const i of ice.cells) {
        const y = (i / GW) | 0;
        const x = i % GW;
        if (y >= 138 && x >= 44 && x <= 105) return true;
      }
    }
    return false;
  }

  sandLeft() {
    let n = 0;
    for (let i = 0; i < this.grid.length; i++) if (isSand(this.grid[i]) || this.grid[i] >= FROZEN_BASE) n++;
    return n;
  }

  /** 运行到静止（无任何颗粒/冰砖/胶囊运动）。返回帧数；超过上限返回 -1 */
  runUntilIdle(maxFrames = 6000, idleFrames = 12) {
    let idle = 0;
    const start = this.frame;
    while (this.frame - start < maxFrames) {
      const a = this.step();
      if (this.won) return this.frame - start;
      idle = a === 0 ? idle + 1 : 0;
      if (idle >= idleFrames) return this.frame - start;
    }
    return -1;
  }

  /**
   * 按顺序执行玩家抽板步骤（每步等待静止后再抽下一块）。
   * 返回 { result: 'win'|'jam'|'stuck'|'timeout'|'invalid', ... }
   */
  play(steps) {
    const initDrain = this.buckets.reduce((s, b) => s + b.cur, 0);
    const t0 = this.runUntilIdle(1500);
    const unstable = this.buckets.reduce((s, b) => s + b.cur, 0) > initDrain || this.outletHasWrongColor();
    if (unstable) return { result: 'unstable', frame: this.frame };
    if (t0 < 0) return { result: 'timeout', frame: this.frame };
    for (let k = 0; k <= steps.length; k++) {
      if (this.won) break;
      if (this.outletHasWrongColor()) return { result: 'jam', atStep: k, frame: this.frame, active: this.active.map(b => b.color) };
      if (k === steps.length) break;
      const r = this.pullBoard(steps[k]);
      if (!r.ok) return { result: 'invalid', atStep: k, reason: r.reason, board: steps[k] };
      const t = this.runUntilIdle();
      if (t < 0) return { result: 'timeout', atStep: k, frame: this.frame };
    }
    if (this.won) {
      this.finishCapsules();
      return { result: 'win', frame: this.frame, residue: this.residueRemoved, sandLeft: this.sandLeft(),
        capsulesStuck: this.capsules.filter(c => !c.naturally).map(c => c.boxType) };
    }
    if (this.outletHasWrongColor()) return { result: 'jam', atStep: steps.length, frame: this.frame, active: this.active.map(b => b.color) };
    return { result: 'stuck', frame: this.frame, sandLeft: this.sandLeft(), buckets: this.buckets.map(b => `${b.color}:${b.cur}/${b.max}`) };
  }
}

module.exports = { Sim, GW, GH, EMPTY, OUTSIDE, WALL, GOLD, BOARD_BASE, FROZEN_BASE, OUTLET, isSand, zoneContains, stampLine };
