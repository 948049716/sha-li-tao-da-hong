'use strict';
/**
 * 《星夜流沙瓶》上下双核联动无头确定性模拟器
 * 严格与 src/engine/SandEngine.ts + BucketSystem.ts + SandGrid.ts 逐帧对齐：
 *  1. 宽底黄铜滤沙格栅（OUTLET: x=22..127, y=159..163），仅在槽木桶可从滤网接触面抽走同色底沙；
 *  2. 4 个默认小卡槽（+1 临时槽）+ 3~4 列纵深候选桶队列（前排挡后排，支持 ? 问号盲桶翻牌与 🧊 冰封桶破冰）；
 *  3. 速度场流沙元胞自动机、高空脆冰硬底碎裂（软沙缓冲不碎）、颜色锁自动崩开、魔法染色环；
 *  4. 混合动作序列：`"col:0".."col:3"` 代表点选对应候选列首木桶入槽，`"<boardId>"` 代表抽拉木栓。
 */

const GW = 150;
const GH = 165;
const EMPTY = 0;
const OUTSIDE = 8;
const WALL = 9;
const GOLD = 5;
const BOARD_BASE = 20; // 20..59
const FROZEN_BASE = 60; // 60..89
const OUTLET = { x0: 22, x1: 127, y0: GH - 6, y1: GH - 2 };
const FILL_RATIO = 0.985;
const DEFAULT_SHATTER_DROP = 44;
const DEFAULT_THAW_CONTACTS = 1200;
const DEFAULT_ACTIVE_SLOTS = 4;
const MAX_ACTIVE_SLOTS = 5;

// ---- 速度场物理常量（必须与 src/engine/SandGrid.ts 保持一致）----
const V_INIT = 16;
const V_GRAV = 3;
const V_MAX = 60;
const V_MOMENTUM = 36;
const RELEASE_FRAMES = 3;
const ICE_V0 = 1;
const ICE_G = 0.16;
const ICE_VMAX = 4;

function boardReleaseOrder(b, cells) {
  const minX = Math.min(b.x0, b.x1);
  const maxX = Math.max(b.x0, b.x1);
  const handleLeft = minX <= GW - 1 - maxX;
  return cells.sort((a, c) => {
    const ax = a % GW;
    const cx = c % GW;
    if (ax !== cx) return handleLeft ? cx - ax : ax - cx;
    return a - c;
  });
}

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
    this.tag = new Uint8Array(GW * GH);
    this.interior = new Uint8Array(GW * GH);
    this.dye = new Uint8Array(GW * GH);
    this.dyeFrom = new Uint8Array(GW * GH);
    this.vel = new Uint8Array(GW * GH);
    this.frame = 0;
    this.events = [];
    this.residueRemoved = 0;
    this.errors = [];
    this.build();
  }

  idx(x, y) {
    return y * GW + x;
  }

  get active() {
    const list = [];
    for (let s = 0; s < this.maxActiveSlots; s++) {
      const bk = this.activeSlots[s];
      if (bk && !bk.done) list.push(bk);
    }
    list.sort((a, b) => a.placedSeq - b.placedSeq);
    return list;
  }

  get occupiedSlotCount() {
    let n = 0;
    for (let s = 0; s < this.maxActiveSlots; s++) {
      if (this.activeSlots[s] && !this.activeSlots[s].done) n++;
    }
    return n;
  }

  findFirstEmptySlot() {
    for (let s = 0; s < this.maxActiveSlots; s++) {
      if (!this.activeSlots[s]) return s;
    }
    return -1;
  }

  build() {
    const L = this.level;
    const vessel = this.vessels[L.vesselTemplate];
    if (!vessel) throw new Error(`未知容器模板 ${L.vesselTemplate}`);
    const g = this.grid;
    const setWall = (x, y) => {
      g[this.idx(x, y)] = WALL;
    };
    for (const poly of vessel.walls) {
      for (let i = 0; i < poly.points.length - 1; i++) {
        const [ax, ay] = poly.points[i];
        const [bx, by] = poly.points[i + 1];
        stampLine(ax, ay, bx, by, poly.thickness, setWall);
      }
    }
    for (let x = 0; x < GW; x++) g[this.idx(x, GH - 1)] = WALL;

    // 先对容器外壁内部泛洪求 interior，再落内部静态隔墙（与 SandEngine.ts 100% 同步）
    const seed = this.idx(75, GH - 4);
    const stack = [seed];
    this.interior[seed] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % GW;
      const y = (i / GW) | 0;
      const nb = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
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
    for (const w of L.staticWalls || []) {
      stampLine(w.x0, w.y0, w.x1, w.y1, w.thickness || 2, (x, y) => {
        const i = this.idx(x, y);
        g[i] = WALL;
        this.interior[i] = 0;
      });
    }

    // 光栅化木板
    this.boards = (L.boards || []).map((b, k) => {
      const val = BOARD_BASE + k;
      const isOpen = Boolean(b.startsOpen);
      let cells = 0;
      if (!isOpen) {
        stampLine(b.x0, b.y0, b.x1, b.y1, 2, (x, y) => {
          const i = this.idx(x, y);
          if (this.interior[i] && g[i] === EMPTY) {
            g[i] = val;
            cells++;
          }
        });
      }
      return { ...b, val, isOpen, removed: false, cells, release: null, releasePtr: 0, releaseTick: 0 };
    });

    // 染色环
    this.dyeRings = L.dyeRings || [];
    for (const ring of this.dyeRings) {
      let mask = 0;
      for (const c of ring.fromColors || []) mask |= 1 << c;
      for (let y = ring.y0; y <= ring.y1; y++) {
        for (let x = ring.x0; x <= ring.x1; x++) {
          if (x < 0 || x >= GW || y < 0 || y >= GH) continue;
          const i = this.idx(x, y);
          if (this.interior[i]) {
            this.dye[i] = ring.toColor;
            this.dyeFrom[i] = mask;
          }
        }
      }
    }

    const zoneBucket = {};
    (L.bucketQueue || []).forEach((b, k) => {
      (b.zones || []).forEach(z => {
        zoneBucket[z] = k;
      });
    });

    // 放置冰砖与流沙颗粒（每格同步调用 1 次 rng，保证与 SandEngine.ts 完全同源确定性）
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
          this.rng();
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
          vy: 0,
          acc: 0,
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

    // 初始化 3~4 列纵深候选桶队列 + 4 个默认小卡槽
    const inferredCols = (L.bucketQueue || []).reduce(
      (m, b, i) => Math.max(m, (b.col != null ? b.col : i % 4) + 1),
      3
    );
    this.numCols = Math.max(3, Math.min(4, L.numCols || inferredCols));
    this.columns = Array.from({ length: this.numCols }, () => []);
    this.activeSlots = [null, null, null, null, null];
    this.maxActiveSlots = DEFAULT_ACTIVE_SLOTS;
    this.placementCounter = 0;

    this.buckets = (L.bucketQueue || []).map((b, k) => {
      const col = Math.max(0, Math.min(this.numCols - 1, b.col != null ? b.col : k % this.numCols));
      const isFront = this.columns[col].length === 0;
      const mystery = Boolean(b.mystery);
      const iceLayers = Math.max(0, Math.floor(b.iceLayers || 0));
      const rt = {
        idx: k,
        color: b.color,
        zones: [...(b.zones || [])],
        col,
        mystery,
        mysteryRevealed: !mystery || isFront,
        iceLayers,
        maxIceLayers: iceLayers,
        cur: 0,
        max: Math.max(1, (b.zones || []).reduce((s, z) => s + (this.zoneCells[z] || 0), 0)),
        done: false,
        slotIdx: -1,
        placedSeq: 0,
        idleDrainFrames: 0,
      };
      this.columns[col].push(rt);
      return rt;
    });

    this.won = false;
    this.lastMovedParticles = 0;
    this.endGameIdleFrames = 0;

    // 开局静默预沉降（与 SandEngine.settleInitialState 100% 同源对齐）
    let idle = 0;
    for (let f = 0; f < 360; f++) {
      const act = this.step();
      idle = act === 0 ? idle + 1 : 0;
      if (idle >= 6) break;
    }
    this.frame = 0;
    this.vel.fill(0);
    this.lastMovedParticles = 0;
    this.endGameIdleFrames = 0;
    this.events.length = 0;
  }

  closeGateInGrid(b) {
    const g = this.grid;
    const tag = this.tag;
    b.release = null;
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
              this.vel[ni] = 0;
              moved = true;
              break;
            }
          }
        }
        tag[i] = 0;
      }
      if (g[i] === EMPTY || isSand(g[i])) {
        g[i] = b.val;
        this.vel[i] = 0;
      }
    });
  }

  beginBoardRelease(b) {
    const cells = [];
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i] === b.val) cells.push(i);
    b.release = boardReleaseOrder(b, cells);
    b.releasePtr = 0;
    b.releaseTick = 0;
  }

  advanceBoardRelease() {
    let act = 0;
    const g = this.grid;
    for (const b of this.boards) {
      if (!b.release) continue;
      b.releaseTick++;
      const t = Math.min(1, b.releaseTick / RELEASE_FRAMES);
      let target = Math.ceil(b.release.length * t * t);
      while (b.releasePtr < target) {
        const i = b.release[b.releasePtr++];
        if (g[i] === b.val) g[i] = EMPTY;
        if (b.releasePtr === target && target < b.release.length && b.release[target] % GW === i % GW) target++;
      }
      act++;
      if (b.releasePtr >= b.release.length) b.release = null;
    }
    return act;
  }

  // ---------- 玩家动作：选桶入槽 & 抽拉木栓 ----------
  dispatchBucket(colIdx) {
    if (colIdx < 0 || colIdx >= this.numCols) {
      return { ok: false, reason: 'out_of_bounds' };
    }
    const col = this.columns[colIdx];
    if (!col || col.length === 0) {
      return { ok: false, reason: 'empty_col' };
    }
    const front = col[0];
    if (front.iceLayers > 0) {
      return { ok: false, reason: 'iced', bucket: front.idx };
    }
    const slotIdx = this.findFirstEmptySlot();
    if (slotIdx < 0) {
      return { ok: false, reason: 'slots_full', bucket: front.idx };
    }

    col.shift();
    front.slotIdx = slotIdx;
    front.placedSeq = ++this.placementCounter;
    front.idleDrainFrames = 0;
    this.activeSlots[slotIdx] = front;
    this.events.push({ frame: this.frame, type: 'dispatch_bucket', col: colIdx, slot: slotIdx, bucket: front.idx, color: front.color });

    if (col.length > 0 && !col[0].mysteryRevealed) {
      col[0].mysteryRevealed = true;
      this.events.push({ frame: this.frame, type: 'mystery_reveal', col: colIdx, bucket: col[0].idx, color: col[0].color });
    }
    return { ok: true, slotIdx, bucket: front.idx };
  }

  pullBoard(id, auto = false, fromLink = false) {
    const b = this.boards.find(x => x.id === id);
    if (!b) return { ok: false, reason: 'not_found' };
    if (b.removed) return { ok: false, reason: 'already_removed' };
    if (b.lockColor && !auto) return { ok: false, reason: 'locked' };

    if (b.isOpen) {
      b.isOpen = false;
      this.closeGateInGrid(b);
      this.events.push({ frame: this.frame, type: 'push_close', board: id });
    } else {
      this.beginBoardRelease(b);
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

  executeAction(action) {
    if (typeof action === 'string' && action.startsWith('col:')) {
      const colIdx = Number(action.slice(4));
      return this.dispatchBucket(colIdx);
    }
    return this.pullBoard(action);
  }

  findReceivingBucket(sandColor, ownerBucketIdx = -1) {
    const act = this.active;
    if (act.length === 0) return null;
    const exact = act.find(b => b.color === sandColor);
    if (exact) return exact;
    if (sandColor === GOLD) {
      const hasAnyUnfinishedGoldBucket = this.buckets.some(b => !b.done && b.color === GOLD);
      if (!hasAnyUnfinishedGoldBucket) {
        if (ownerBucketIdx >= 0) {
          const ownerInSlot = act.find(b => b.idx === ownerBucketIdx);
          if (ownerInSlot) return ownerInSlot;
        }
        return act[0];
      }
    }
    return null;
  }

  hasPendingIceOrDyeForColor(color) {
    for (const ic of this.ice) {
      if (!ic.shattered && ic.color === color) return true;
    }
    for (const ring of this.dyeRings) {
      if (ring.toColor !== color) continue;
      for (let y = 6; y <= Math.min(GH - 2, ring.y1 + 2); y++) {
        for (let x = 1; x < GW - 1; x++) {
          const c = this.grid[this.idx(x, y)];
          if (isSand(c) && c !== color && c !== GOLD) return true;
        }
      }
    }
    return false;
  }

  completeBucket(b) {
    b.done = true;
    b.cur = b.max;
    if (b.slotIdx >= 0 && b.slotIdx < this.activeSlots.length && this.activeSlots[b.slotIdx] === b) {
      this.activeSlots[b.slotIdx] = null;
    }
    b.slotIdx = -1;
    this.events.push({ frame: this.frame, type: 'bucket_full', bucket: b.idx, color: b.color });

    // 任意木桶 100% 满桶清走时，候选列中所有冰封木桶同步震裂 1 层寒冰
    for (const col of this.columns) {
      for (const cb of col) {
        if (cb.iceLayers > 0) {
          cb.iceLayers--;
          if (cb.iceLayers === 0) {
            this.events.push({ frame: this.frame, type: 'bucket_thaw', bucket: cb.idx });
          }
        }
      }
    }

    // 颜色锁自动崩开
    for (const bd of this.boards) {
      if (!bd.removed && bd.lockColor === b.color) {
        this.pullBoard(bd.id, true);
      }
    }
  }

  checkIdleTailSweeps(isChamberSettled) {
    let act = 0;
    const g = this.grid;
    for (const b of this.active) {
      if (b.done) continue;
      if (b.cur >= b.max) {
        this.completeBucket(b);
        act++;
        continue;
      }
      if (b.idleDrainFrames < 18) continue;

      if (isChamberSettled && b.cur > 0 && b.cur < Math.ceil(b.max * FILL_RATIO)) {
        let bestSwap = null;
        let bestDiff = Infinity;
        for (const o of this.buckets) {
          if (o.done || o.idx === b.idx || o.color !== b.color) continue;
          if (o.cur !== 0 || o.max >= b.max) continue;
          if (b.cur >= Math.ceil(o.max * 0.965) && b.cur <= o.max + 24) {
            const diff = Math.abs(o.max - b.cur);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestSwap = o;
            }
          }
        }
        if (bestSwap) {
          const sumMax = b.max + bestSwap.max;
          if (b.cur > bestSwap.max) {
            b.max = b.cur;
            bestSwap.max = Math.max(1, sumMax - b.cur);
          } else {
            const tmp = b.max;
            b.max = bestSwap.max;
            bestSwap.max = tmp;
          }
          if (b.cur >= b.max) {
            this.completeBucket(b);
            act++;
            continue;
          }
        }
      }

      const otherUnfinishedSameColor = this.buckets.some(
        o => !o.done && o.idx !== b.idx && o.color === b.color
      );
      const pendingSource = this.hasPendingIceOrDyeForColor(b.color);

      if (b.cur >= Math.ceil(b.max * FILL_RATIO)) {
        const need = b.max - b.cur;
        const found = [];
        for (let y = GH - 2; y >= 6 && found.length < need; y--) {
          for (let x = 1; x < GW - 1 && found.length < need; x++) {
            const i = y * GW + x;
            if (isSand(g[i]) && g[i] === b.color) found.push(i);
          }
        }
        const canSweepNow = found.length >= need || (!otherUnfinishedSameColor && !pendingSource);
        if (canSweepNow) {
          for (const i of found) {
            g[i] = EMPTY;
            this.tag[i] = 0;
            this.vel[i] = 0;
            this.residueRemoved++;
          }
          this.completeBucket(b);
          act += found.length + 1;
        }
        continue;
      }

      if (isChamberSettled && b.idleDrainFrames >= 24 && b.cur > 0 && !otherUnfinishedSameColor && !pendingSource) {
        const allMatching = [];
        let allGoldCount = 0;
        let heldByBoardOrForeign = false;
        for (let y = GH - 2; y >= 6; y--) {
          for (let x = 1; x < GW - 1; x++) {
            const i = y * GW + x;
            const v = g[i];
            if (v === b.color) {
              allMatching.push(i);
              const below = i + GW < g.length ? g[i + GW] : 0;
              if ((below >= 50 && below < 100) || (isSand(below) && below !== b.color)) {
                heldByBoardOrForeign = true;
              }
            } else if (v === GOLD) {
              allGoldCount++;
            }
          }
        }
        if (allMatching.length === 0 && allGoldCount === 0) {
          this.completeBucket(b);
          act++;
        } else if (
          allMatching.length > 0 &&
          allGoldCount === 0 &&
          !heldByBoardOrForeign &&
          allMatching.length <= Math.max(55, Math.ceil(b.max * 0.09)) &&
          b.cur + allMatching.length >= Math.ceil(b.max * 0.88)
        ) {
          for (const i of allMatching) {
            g[i] = EMPTY;
            this.tag[i] = 0;
            this.vel[i] = 0;
            this.residueRemoved++;
          }
          this.completeBucket(b);
          act += allMatching.length + 1;
        }
      }
    }
    return act;
  }

  // ---------- 单帧推进 ----------
  step() {
    if (this.won) return 0;
    this.frame++;
    let activity = 0;
    const g = this.grid;
    const tag = this.tag;

    // 1. 宽底滤网接触自动吸沙
    let drained = 0;
    let drainedSlotMask = 0;
    const maxDrain = 42;
    const outletW = OUTLET.x1 - OUTLET.x0 + 1;
    if (this.occupiedSlotCount > 0) {
      for (let y = OUTLET.y1; y >= OUTLET.y0 && drained < maxDrain; y--) {
        const startOff = (this.frame * 37 + y * 53) % outletW;
        for (let k = 0; k < outletW && drained < maxDrain; k++) {
          const x = OUTLET.x0 + ((startOff + k * 29) % outletW);
          const i = this.idx(x, y);
          const c = g[i];
          if (!isSand(c)) continue;
          const ownerIdx = tag[i] > 0 ? tag[i] - 1 : -1;
          const target = this.findReceivingBucket(c, ownerIdx);
          if (!target || target.done) continue;

          if (c === GOLD && target.color !== GOLD && ownerIdx >= 0 && ownerIdx !== target.idx) {
            const owner = this.buckets[ownerIdx];
            if (owner && !owner.done && owner.max > owner.cur + 1) {
              owner.max--;
              target.max++;
            }
          }

          const slotIdx = Math.max(0, target.slotIdx);
          g[i] = EMPTY;
          tag[i] = 0;
          this.vel[i] = 0;
          drained++;
          target.cur++;
          target.idleDrainFrames = 0;
          drainedSlotMask |= 1 << slotIdx;

          if (target.cur >= target.max) {
            this.completeBucket(target);
          }
        }
      }
    }
    activity += drained;

    for (const bk of this.active) {
      if ((drainedSlotMask & (1 << bk.slotIdx)) === 0) {
        bk.idleDrainFrames++;
      }
    }
    const isChamberSettled =
      drained === 0 &&
      this.lastMovedParticles === 0 &&
      !this.boards.some(bd => bd.release !== null) &&
      !this.ice.some(ic => !ic.shattered && ic.moving);
    activity += this.checkIdleTailSweeps(isChamberSettled);

    // 1b. 抽板渐进释放
    activity += this.advanceBoardRelease();

    // 2. 速度场流沙元胞自动机
    let movedParticles = 0;
    const vel = this.vel;
    const dye = this.dye;
    const dyeFrom = this.dyeFrom;
    const step1 = (from, to, col) => {
      let nc = col;
      const dt = dye[to];
      if (dt && col !== GOLD && col !== dt && (!dyeFrom[to] || (dyeFrom[to] & (1 << col)))) nc = dt;
      g[to] = nc;
      tag[to] = tag[from];
      g[from] = EMPTY;
      tag[from] = 0;
      vel[from] = 0;
      activity++;
      movedParticles++;
      return nc;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let y = GH - 3; y >= 6; y--) {
        const dir = (y + pass + this.frame) % 2 === 0;
        for (let s = 1; s < GW - 1; s++) {
          const x = dir ? s : GW - 1 - s;
          const i = this.idx(x, y);
          const c = g[i];
          if (!isSand(c)) continue;
          let v = vel[i];
          const b0 = i + GW;
          if (g[b0] === EMPTY) {
            let n;
            if (v === 0 && y > 6 && isSand(g[i - GW])) {
              v = 16;
              n = 1;
            } else {
              v = v < V_INIT ? V_INIT : Math.min(V_MAX, v + V_GRAV);
              const dither = (x * 73 + y * 19 + this.frame * 7 + pass * 11) & 15;
              n = (v + dither) >> 4;
              if (n < 1) n = 1;
            }
            let cur = i;
            let col = c;
            for (let k = 0; k < n; k++) {
              const nb = cur + GW;
              if (g[nb] !== EMPTY) break;
              col = step1(cur, nb, col);
              cur = nb;
            }
            vel[cur] = v;
            continue;
          }
          const bv = vel[b0];
          if (bv >= V_INIT && y < GH - 3 && g[b0 + GW] === EMPTY && isSand(g[b0])) {
            vel[i] = v < bv ? v : bv;
            activity++;
            continue;
          }
          const d1 = this.rng() < 0.5 ? -1 : 1;
          const d2 = -d1;
          const b1 = b0 + d1;
          const b2 = b0 + d2;
          let dd = 0;
          if (g[b1] === EMPTY) dd = d1;
          else if (g[b2] === EMPTY) dd = d2;
          if (dd !== 0) {
            let cur = b0 + dd;
            let col = step1(i, cur, c);
            let extra = v >= V_MOMENTUM ? Math.min(3, (v - V_INIT) >> 4) : 0;
            let nv = v - (v >> 2);
            while (extra-- > 0) {
              const downCell = cur + GW;
              if (cur + GW < g.length - GW && g[downCell] === EMPTY) {
                col = step1(cur, downCell, col);
                cur = downCell;
                continue;
              }
              const nb = downCell + dd;
              const cx = cur % GW;
              if (cx + dd <= 0 || cx + dd >= GW - 1 || g[nb] !== EMPTY) break;
              col = step1(cur, nb, col);
              cur = nb;
              nv -= nv >> 2;
            }
            vel[cur] = nv;
          } else {
            const nx1 = x + d1 * 2;
            const nx2 = x + d2 * 2;
            if (nx1 > 0 && nx1 < GW - 1 && g[i + d1] === EMPTY && g[b0 + d1 * 2] === EMPTY) {
              const j = b0 + d1 * 2;
              step1(i, j, c);
              vel[j] = v >> 1;
            } else if (nx2 > 0 && nx2 < GW - 1 && g[i + d2] === EMPTY && g[b0 + d2 * 2] === EMPTY) {
              const j = b0 + d2 * 2;
              step1(i, j, c);
              vel[j] = v >> 1;
            } else {
              vel[i] = 0;
            }
          }
        }
      }
    }

    // 3. 冰砖刚体下落 / 脆冰高空硬底碎裂（软沙缓冲不碎）
    for (const ice of this.ice) {
      if (ice.shattered) continue;
      const own = new Set(ice.cells);

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
          if (ice.thawProgress >= ice.thawContacts) ice.primed = true;
        }
        if (ice.primed) {
          if (touchingForeign <= 3) {
            ice.clearFrames++;
            activity++;
            if (ice.clearFrames >= 8) {
              for (const i of ice.cells) {
                g[i] = ice.color;
                this.vel[i] = 0;
              }
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

      let rows = 0;
      if (this.iceFree(ice)) {
        ice.vy = ice.moving ? Math.min(ICE_VMAX, ice.vy + ICE_G) : ICE_V0;
        ice.acc += ice.vy;
        let want = Math.floor(ice.acc);
        if (want < 1) want = 1;
        ice.acc -= want;
        if (ice.acc < 0) ice.acc = 0;
        while (rows < want && this.iceFree(ice)) {
          this.iceMoveDown(ice);
          rows++;
        }
      }
      if (rows > 0) {
        ice.moving = true;
        activity++;
      } else if (ice.moving) {
        ice.moving = false;
        ice.vy = 0;
        ice.acc = 0;
        const ownNow = new Set(ice.cells);
        let cushionedBySand = false;
        for (const i of ice.cells) {
          const below = i + GW;
          if (below < g.length && !ownNow.has(below) && g[below] !== EMPTY) {
            if (isSand(g[below]) || g[below] >= FROZEN_BASE) {
              cushionedBySand = true;
              break;
            }
          }
        }
        if (ice.iceType !== 'permafrost' && !cushionedBySand && ice.fall >= ice.shatterDrop) {
          for (const i of ice.cells) {
            g[i] = ice.color;
            this.vel[i] = 0;
          }
          ice.shattered = true;
          this.events.push({ frame: this.frame, type: 'ice_shatter', zone: ice.zoneId, drop: ice.fall });
          activity++;
        } else {
          this.events.push({
            frame: this.frame,
            type: 'ice_land_intact',
            zone: ice.zoneId,
            drop: ice.fall,
            cushionedBySand,
          });
        }
        ice.fall = 0;
      }
    }

    this.lastMovedParticles = movedParticles;
    if (!this.won && !this.buckets.every(b => b.done)) {
      if (drained === 0 && movedParticles === 0 && activity === 0) {
        this.endGameIdleFrames++;
      } else {
        this.endGameIdleFrames = 0;
      }
      const candLeft = this.columns.reduce((s, col) => s + col.length, 0);
      if (
        this.endGameIdleFrames >= 28 &&
        candLeft === 0 &&
        this.boards.every(bd => bd.removed || bd.isOpen) &&
        this.ice.every(ic => ic.shattered)
      ) {
        const activeColors = new Set(this.active.map(b => b.color));
        const totalMax = this.buckets.reduce((s, b) => s + b.max, 0);
        const remainingCells = [];
        let foreignCount = 0;
        for (let y = GH - 2; y >= 6; y--) {
          for (let x = 1; x < GW - 1; x++) {
            const i = this.idx(x, y);
            const c = g[i];
            if (!isSand(c)) continue;
            remainingCells.push(i);
            if (c !== GOLD && !activeColors.has(c)) foreignCount++;
          }
        }
        if (
          foreignCount <= Math.max(20, Math.ceil(totalMax * 0.015)) &&
          remainingCells.length <= Math.max(180, Math.ceil(totalMax * 0.09))
        ) {
          for (const i of remainingCells) {
            g[i] = EMPTY;
            tag[i] = 0;
            this.vel[i] = 0;
            this.residueRemoved++;
          }
          for (const bk of [...this.active]) {
            if (!bk.done) this.completeBucket(bk);
          }
          activity++;
        }
      }
    }

    if (!this.won && this.buckets.length > 0 && this.buckets.every(b => b.done)) {
      for (let i = 0; i < g.length; i++) {
        if (isSand(g[i])) {
          g[i] = EMPTY;
          tag[i] = 0;
          this.vel[i] = 0;
          this.residueRemoved++;
        }
      }
      this.won = true;
      this.events.push({ frame: this.frame, type: 'win' });
    }
    return activity;
  }

  iceFree(ice) {
    const g = this.grid;
    const own = new Set(ice.cells);
    for (const i of ice.cells) {
      const below = i + GW;
      if (below >= g.length || (!own.has(below) && g[below] !== EMPTY)) return false;
    }
    return true;
  }

  iceMoveDown(ice) {
    const g = this.grid;
    const tag = this.tag;
    const tags = ice.cells.map(i => tag[i]);
    for (const i of ice.cells) {
      g[i] = EMPTY;
      tag[i] = 0;
    }
    const moved = [];
    ice.cells.forEach((i, k) => {
      const j = i + GW;
      g[j] = ice.val;
      tag[j] = tags[k];
      moved.push(j);
    });
    ice.cells = moved;
    ice.fall++;
  }

  sandLeft() {
    let n = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (isSand(this.grid[i]) || this.grid[i] >= FROZEN_BASE) n++;
    }
    return n;
  }

  isHardDeadlocked() {
    const hasDispatchableFront = this.columns.some(col => col.length > 0 && col[0].iceLayers === 0);
    const slotsFull = this.occupiedSlotCount >= this.maxActiveSlots;
    if (!slotsFull && hasDispatchableFront) return false;

    let emptyGrateFloor = 0;
    const rowBase = OUTLET.y1 * GW;
    for (let x = OUTLET.x0; x <= OUTLET.x1; x++) {
      const idx = rowBase + x;
      if (this.interior[idx] && this.grid[idx] === EMPTY) emptyGrateFloor++;
    }
    const hasUnlockedPin = this.boards.some(b => !b.removed && !b.lockColor);
    return !(hasUnlockedPin && emptyGrateFloor >= 4);
  }

  /** 运行到静止（无任何颗粒/冰砖运动 且 无可收尾满桶）。返回帧数；超过上限返回 -1 */
  runUntilIdle(maxFrames = 6000, idleFrames = 22) {
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
   * 按顺序执行混合操作步骤（`"col:0".."col:3"` 选桶入槽 或 `"<boardId>"` 抽栓，每步等待盘面静止）。
   * 返回 { result: 'win'|'jam'|'stuck'|'timeout'|'invalid'|'unstable', ... }
   */
  play(steps) {
    const t0 = this.runUntilIdle(1500);
    if (t0 < 0) return { result: 'timeout', frame: this.frame };
    const earlyDrain = this.buckets.reduce((s, b) => s + b.cur, 0) > 0;
    if (earlyDrain) {
      return { result: 'unstable', frame: this.frame, earlyDrain };
    }

    for (let k = 0; k < steps.length; k++) {
      if (this.won) break;
      const act = steps[k];
      const r = this.executeAction(act);
      if (!r.ok) {
        return {
          result: r.reason === 'slots_full' || r.reason === 'iced' ? 'jam' : 'invalid',
          atStep: k,
          action: act,
          reason: r.reason,
          active: this.active.map(b => b.color),
        };
      }
      const t = this.runUntilIdle();
      if (t < 0) return { result: 'timeout', atStep: k, frame: this.frame };
    }

    if (this.won) {
      return {
        result: 'win',
        frame: this.frame,
        residue: this.residueRemoved,
        sandLeft: this.sandLeft(),
      };
    }
    if (this.isHardDeadlocked()) {
      return {
        result: 'jam',
        atStep: steps.length,
        frame: this.frame,
        active: this.active.map(b => `${b.color}:${b.cur}/${b.max}`),
      };
    }
    return {
      result: 'stuck',
      frame: this.frame,
      sandLeft: this.sandLeft(),
      buckets: this.buckets.map(b => `${b.color}:${b.cur}/${b.max}`),
    };
  }
}

module.exports = {
  Sim,
  GW,
  GH,
  EMPTY,
  OUTSIDE,
  WALL,
  GOLD,
  BOARD_BASE,
  FROZEN_BASE,
  OUTLET,
  isSand,
  zoneContains,
  stampLine,
};
