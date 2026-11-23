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
const V_SPLASH = 30;
const V_CHUTE_MAX = 48;
const RELEASE_FRAMES = 3;
const ICE_V0 = 1;
const ICE_G = 0.16;
const ICE_VMAX = 4;

const TOTAL_CELLS = GW * GH;
const CELL_X = new Uint8Array(TOTAL_CELLS);
const CELL_Y = new Uint8Array(TOTAL_CELLS);
for (let i = 0; i < TOTAL_CELLS; i++) {
  CELL_X[i] = i % GW;
  CELL_Y[i] = (i / GW) | 0;
}

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
    this.grid = new Uint8Array(TOTAL_CELLS);
    this.tag = new Uint8Array(TOTAL_CELLS);
    this.interior = new Uint8Array(TOTAL_CELLS);
    this.dye = new Uint8Array(TOTAL_CELLS);
    this.dyeFrom = new Uint8Array(TOTAL_CELLS);
    this.vel = new Uint8Array(TOTAL_CELLS);
    this.slopeDir = new Int8Array(TOTAL_CELLS);
    this.rowAwake = new Uint8Array(GH);
    this.nextRowAwake = new Uint8Array(GH);
    this.iceMark = new Uint8Array(TOTAL_CELLS);
    this.iceTmpTag = new Uint8Array(256);
    this.iceSandSrc = new Int32Array(64);
    this.iceSandDst = new Int32Array(64);
    this.bfsQueue = new Int32Array(1024);
    this.bfsSeen = new Uint8Array(TOTAL_CELLS);

    this.activeCache = [];
    this.colorLut = new Int16Array(6);
    this.occupiedCache = 0;
    this.hasUnfinishedGold = false;
    this.receivableMask = 0;
    this.cacheDirty = true;

    this.frame = 0;
    this.events = [];
    this.residueRemoved = 0;
    this.errors = [];
    this.build();
  }

  idx(x, y) {
    return y * GW + x;
  }

  ensureBucketCache() {
    if (!this.cacheDirty) return;
    this.cacheDirty = false;
    const list = this.activeCache;
    list.length = 0;
    for (let s = 0; s < this.maxActiveSlots; s++) {
      const bk = this.activeSlots[s];
      if (bk && !bk.done) list.push(bk);
    }
    if (list.length > 1) list.sort((a, b) => a.placedSeq - b.placedSeq);
    this.occupiedCache = list.length;

    this.colorLut.fill(-1);
    let mask = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i].color;
      if (this.colorLut[c] < 0) {
        this.colorLut[c] = list[i].idx;
        mask |= 1 << c;
      }
    }

    let unfinishedGold = false;
    for (let i = 0; i < this.buckets.length; i++) {
      const b = this.buckets[i];
      if (!b.done && b.color === GOLD) {
        unfinishedGold = true;
        break;
      }
    }
    this.hasUnfinishedGold = unfinishedGold;
    if (list.length > 0 && !unfinishedGold) {
      mask |= 1 << GOLD;
    }
    this.receivableMask = mask;
  }

  get active() {
    this.ensureBucketCache();
    return this.activeCache;
  }

  get occupiedSlotCount() {
    this.ensureBucketCache();
    return this.occupiedCache;
  }

  findFirstEmptySlot() {
    for (let s = 0; s < this.maxActiveSlots; s++) {
      if (!this.activeSlots[s]) return s;
    }
    return -1;
  }

  wakeRows(y0, y1) {
    const a = y0 <= 7 ? 5 : y0 - 2;
    const b = y1 >= GH - 4 ? GH - 2 : y1 + 2;
    for (let y = a; y <= b; y++) {
      this.rowAwake[y] = 1;
      this.nextRowAwake[y] = 1;
    }
  }

  wakeAllRows() {
    this.rowAwake.fill(1);
    this.nextRowAwake.fill(1);
  }

  rebuildSlopeGuide() {
    const sd = this.slopeDir;
    sd.fill(0);
    const markSeg = (x0, y0, x1, y1, th) => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (Math.abs(dx) <= 1 || Math.abs(dy) <= 1) return;
      const dir = dx * dy > 0 ? 1 : -1;
      stampLine(x0, y0, x1, y1, th + 1, (rx, ry) => {
        sd[ry * GW + rx] = dir;
      });
    };
    const vessel = this.vessels[this.level.vesselTemplate];
    if (vessel) {
      for (const poly of vessel.walls) {
        for (let i = 0; i < poly.points.length - 1; i++) {
          const [ax, ay] = poly.points[i];
          const [bx, by] = poly.points[i + 1];
          markSeg(ax, ay, bx, by, poly.thickness);
        }
      }
    }
    for (const w of this.level.staticWalls || []) {
      markSeg(w.x0, w.y0, w.x1, w.y1, w.thickness || 2);
    }
    for (const b of this.boards) {
      if (!b.removed && !b.isOpen) {
        markSeg(b.x0, b.y0, b.x1, b.y1, 2);
      }
    }
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
      const x = CELL_X[i];
      const y = CELL_Y[i];
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
    this.cacheDirty = true;
    this.ensureBucketCache();
    this.rebuildSlopeGuide();
    this.wakeAllRows();

    this.won = false;
    this.lastMovedParticles = 0;
    this.endGameIdleFrames = 0;

    // 开局静默预沉降（与 SandEngine.settleInitialState 100% 同源对齐）
    let idle = 0;
    for (let f = 0; f < 360; f++) {
      if (idle === 1) this.wakeAllRows();
      const act = this.step();
      idle = act === 0 ? idle + 1 : 0;
      if (idle >= 6) break;
    }
    this.frame = 0;
    this.vel.fill(0);
    this.rowAwake.fill(0);
    this.nextRowAwake.fill(0);
    this.lastMovedParticles = 0;
    this.endGameIdleFrames = 0;
    this.events.length = 0;
  }

  displaceSandConnected(startIdx, gateVal) {
    const g = this.grid;
    const inter = this.interior;
    const x = CELL_X[startIdx];
    const y = CELL_Y[startIdx];
    let upOpen = true;
    let dnOpen = true;
    for (let d = 1; d < 28 && (upOpen || dnOpen); d++) {
      if (upOpen) {
        const ny = y - d;
        if (ny < 6) {
          upOpen = false;
        } else {
          const ni = ny * GW + x;
          const nv = g[ni];
          if (!inter[ni] || nv === WALL || (nv >= BOARD_BASE && nv < FROZEN_BASE && nv !== gateVal)) {
            upOpen = false;
          } else if (nv === EMPTY) {
            return ni;
          }
        }
      }
      if (dnOpen) {
        const ny = y + d;
        if (ny >= GH - 1) {
          dnOpen = false;
        } else {
          const ni = ny * GW + x;
          const nv = g[ni];
          if (!inter[ni] || nv === WALL || (nv >= BOARD_BASE && nv < FROZEN_BASE && nv !== gateVal)) {
            dnOpen = false;
          } else if (nv === EMPTY) {
            return ni;
          }
        }
      }
    }

    const q = this.bfsQueue;
    const seen = this.bfsSeen;
    let head = 0;
    let tail = 0;
    q[tail++] = startIdx;
    seen[startIdx] = 1;
    let found = -1;
    while (head < tail && tail < q.length - 4) {
      const cur = q[head++];
      const cx = CELL_X[cur];
      const cy = CELL_Y[cur];
      const nbs = [cur - GW, cur + GW, cx > 1 ? cur - 1 : -1, cx < GW - 2 ? cur + 1 : -1];
      for (let k = 0; k < 4; k++) {
        const nb = nbs[k];
        if (nb < 6 * GW || nb >= (GH - 1) * GW || seen[nb]) continue;
        const nv = g[nb];
        if (!inter[nb] || nv === WALL || (nv >= BOARD_BASE && nv < FROZEN_BASE && nv !== gateVal)) continue;
        seen[nb] = 1;
        if (nv === EMPTY) {
          found = nb;
          break;
        }
        if (cy >= 6 && tail < q.length) q[tail++] = nb;
      }
      if (found >= 0) break;
    }
    for (let k = 0; k < tail; k++) seen[q[k]] = 0;
    return found;
  }

  closeGateInGrid(b) {
    const g = this.grid;
    const tag = this.tag;
    b.release = null;
    let minY = GH;
    let maxY = 0;
    stampLine(b.x0, b.y0, b.x1, b.y1, 2, (x, y) => {
      const i = this.idx(x, y);
      if (!this.interior[i] || g[i] === WALL || g[i] === b.val) return;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (isSand(g[i])) {
        const dest = this.displaceSandConnected(i, b.val);
        if (dest >= 0) {
          g[dest] = g[i];
          tag[dest] = tag[i];
          this.vel[dest] = 0;
          const dy = CELL_Y[dest];
          if (dy < minY) minY = dy;
          if (dy > maxY) maxY = dy;
          g[i] = b.val;
          tag[i] = 0;
          this.vel[i] = 0;
        }
        return;
      }
      if (g[i] === EMPTY) {
        g[i] = b.val;
        this.vel[i] = 0;
      }
    });
    if (maxY >= minY) this.wakeRows(minY, maxY);
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
      let minY = GH;
      let maxY = 0;
      while (b.releasePtr < target) {
        const i = b.release[b.releasePtr++];
        if (g[i] === b.val) {
          g[i] = EMPTY;
          const ry = CELL_Y[i];
          if (ry < minY) minY = ry;
          if (ry > maxY) maxY = ry;
        }
        if (b.releasePtr === target && target < b.release.length && CELL_X[b.release[target]] === CELL_X[i]) {
          target++;
        }
      }
      if (maxY >= minY) this.wakeRows(minY, maxY);
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
    this.cacheDirty = true;
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
    this.rebuildSlopeGuide();

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
    this.ensureBucketCache();
    const list = this.activeCache;
    if (list.length === 0) return null;
    const exactIdx = this.colorLut[sandColor];
    if (exactIdx >= 0) return this.buckets[exactIdx];
    if (sandColor === GOLD && !this.hasUnfinishedGold) {
      if (ownerBucketIdx >= 0) {
        for (let i = 0; i < list.length; i++) {
          if (list[i].idx === ownerBucketIdx) return list[i];
        }
      }
      return list[0];
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
    this.cacheDirty = true;
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
            const sy = CELL_Y[i];
            this.wakeRows(sy, sy);
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
            const sy = CELL_Y[i];
            this.wakeRows(sy, sy);
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
    const vel = this.vel;
    const slopeDir = this.slopeDir;
    const rowAwake = this.rowAwake;
    const nextRowAwake = this.nextRowAwake;

    // 1. 宽底滤网接触自动吸沙
    let drained = 0;
    let drainedSlotMask = 0;
    const maxDrain = 42;
    const outletW = OUTLET.x1 - OUTLET.x0 + 1;
    if (this.occupiedSlotCount > 0) {
      let recvMask = this.receivableMask;
      for (let y = OUTLET.y1; y >= OUTLET.y0 && drained < maxDrain && recvMask !== 0; y--) {
        const startOff = (this.frame * 37 + y * 53) % outletW;
        const rowBase = y * GW;
        let rowDrained = false;
        for (let k = 0; k < outletW && drained < maxDrain; k++) {
          const x = OUTLET.x0 + ((startOff + k * 29) % outletW);
          const i = rowBase + x;
          const c = g[i];
          if (c < 1 || c > 5 || (recvMask & (1 << c)) === 0) continue;
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
          vel[i] = 0;
          drained++;
          rowDrained = true;
          target.cur++;
          target.idleDrainFrames = 0;
          drainedSlotMask |= 1 << slotIdx;

          if (target.cur >= target.max) {
            this.completeBucket(target);
            this.ensureBucketCache();
            recvMask = this.receivableMask;
            if (recvMask === 0) break;
          }
        }
        if (rowDrained) this.wakeRows(y - 1, y);
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

    // 2. 真实感散体速度场元胞自动机（与 SandEngine.ts 100% 逐分支对齐）
    let movedParticles = 0;
    const dye = this.dye;
    const dyeFrom = this.dyeFrom;

    const dyeAt = (cell, col) => {
      const dt = dye[cell];
      if (dt && col !== GOLD && col !== dt && (!dyeFrom[cell] || (dyeFrom[cell] & (1 << col)) !== 0)) {
        return dt;
      }
      return col;
    };

    const keepCellAwake = cell => {
      const cy = CELL_Y[cell];
      const y0 = cy > 6 ? cy - 1 : 5;
      const y1 = cy + 1 < GH - 2 ? cy + 1 : GH - 2;
      rowAwake[y0] = 1;
      nextRowAwake[y0] = 1;
      nextRowAwake[cy] = 1;
      nextRowAwake[y1] = 1;
    };

    const step1 = (from, to, col) => {
      const nc = dyeAt(to, col);
      g[to] = nc;
      tag[to] = tag[from];
      g[from] = EMPTY;
      tag[from] = 0;
      vel[from] = 0;
      activity++;
      movedParticles++;
      const fy = CELL_Y[from];
      const ty = CELL_Y[to];
      const y0 = (fy < ty ? fy : ty) <= 7 ? 5 : (fy < ty ? fy : ty) - 2;
      const y1 = (fy > ty ? fy : ty) >= GH - 4 ? GH - 2 : (fy > ty ? fy : ty) + 2;
      for (let wy = y0; wy <= y1; wy++) {
        rowAwake[wy] = 1;
        nextRowAwake[wy] = 1;
      }
      return nc;
    };

    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) {
        rowAwake.set(nextRowAwake);
      }
      nextRowAwake.fill(0);

      for (let y = GH - 3; y >= 6; y--) {
        if (rowAwake[y] === 0) continue;
        const dir = ((y + pass + this.frame) & 1) === 0;
        const rowOff = y * GW;

        for (let s = 1; s < GW - 1; s++) {
          const x = dir ? s : GW - 1 - s;
          const i = rowOff + x;
          const c = g[i];
          if (c < 1 || c > 5) continue;

          let v = vel[i];
          const b0 = i + GW;

          if (g[b0] === EMPTY) {
            let n;
            const dither = (this.frame * 7 + pass * 11) & 15;
            if (v === 0 && y > 6 && isSand(g[i - GW])) {
              let inherit = 0;
              for (let k = 2; k <= 5; k++) {
                const j = b0 + GW * (k - 1);
                if (j >= TOTAL_CELLS) break;
                const cj = g[j];
                if (cj === EMPTY) continue;
                if (isSand(cj)) inherit = vel[j];
                break;
              }
              if (inherit >= V_INIT) {
                v = inherit;
                n = (v + dither) >> 4;
                if (n < 1) n = 1;
              } else if (
                vel[i - GW] === 0 &&
                (isSand(g[i - 1]) || isSand(g[i + 1])) &&
                ((x * 73 + y * 37 + this.frame * 19 + pass * 11) & 3) === 0
              ) {
                vel[i] = V_INIT;
                activity++;
                keepCellAwake(i);
                continue;
              } else {
                v = V_INIT;
                n = 1;
              }
            } else {
              v = v < V_INIT ? V_INIT : Math.min(V_MAX, v + V_GRAV);
              n = (v + dither) >> 4;
              if (n < 1) n = 1;
            }

            let cur = i;
            let col = c;
            let k = 0;
            for (; k < n; k++) {
              const nb = cur + GW;
              if (nb >= TOTAL_CELLS - GW || g[nb] !== EMPTY) break;
              col = step1(cur, nb, col);
              cur = nb;
            }

            if (k < n) {
              const nb = cur + GW;
              if (nb < TOTAL_CELLS - GW && isSand(g[nb]) && vel[nb] >= V_INIT) {
                vel[cur] = vel[nb];
                keepCellAwake(cur);
                continue;
              }

              const cx = CELL_X[cur];
              const sd = nb < TOTAL_CELLS ? slopeDir[nb] || slopeDir[cur] : slopeDir[cur];
              const bL = cx > 1 && nb < TOTAL_CELLS && g[nb - 1] === EMPTY && !(g[nb] >= WALL && g[cur - 1] >= WALL);
              const bR =
                cx < GW - 2 && nb < TOTAL_CELLS && g[nb + 1] === EMPTY && !(g[nb] >= WALL && g[cur + 1] >= WALL);
              const d1 = sd !== 0 ? sd : bL !== bR ? (bL ? -1 : 1) : this.rng() < 0.5 ? -1 : 1;
              const d2 = -d1;
              const dd = (d1 === -1 ? bL : bR) ? d1 : (d2 === -1 ? bL : bR) ? d2 : 0;

              if (dd !== 0) {
                col = step1(cur, nb + dd, col);
                cur = nb + dd;
                const nv = sd === dd ? Math.min(V_CHUTE_MAX, Math.max(24, v)) : Math.max(10, v - (v >> 2));
                vel[cur] = nv;
                keepCellAwake(cur);
              } else if (sd !== 0 && cx + sd > 0 && cx + sd < GW - 1 && g[cur + sd] === EMPTY) {
                col = step1(cur, cur + sd, col);
                cur = cur + sd;
                vel[cur] = Math.min(V_CHUTE_MAX, Math.max(22, v - (v >> 3)));
                keepCellAwake(cur);
              } else if (v >= V_SPLASH) {
                const sDir = cx + d1 > 0 && cx + d1 < GW - 1 && g[cur + d1] === EMPTY
                  ? d1
                  : cx + d2 > 0 && cx + d2 < GW - 1 && g[cur + d2] === EMPTY
                    ? d2
                    : 0;
                if (sDir !== 0) {
                  col = step1(cur, cur + sDir, col);
                  cur = cur + sDir;
                  if (
                    v >= 46 &&
                    CELL_X[cur] + sDir > 0 &&
                    CELL_X[cur] + sDir < GW - 1 &&
                    g[cur + sDir] === EMPTY &&
                    g[cur + GW] !== EMPTY
                  ) {
                    col = step1(cur, cur + sDir, col);
                    cur = cur + sDir;
                  }
                  vel[cur] = Math.min(14, v >> 2);
                  keepCellAwake(cur);
                } else {
                  vel[cur] = 0;
                }
              } else {
                vel[cur] = 0;
              }
              continue;
            }

            vel[cur] = v;
            keepCellAwake(cur);
            continue;
          }

          const bv = vel[b0];
          if (
            bv >= V_INIT &&
            y < GH - 3 &&
            isSand(g[b0]) &&
            (g[b0 + GW] === EMPTY || (isSand(g[b0 + GW]) && vel[b0 + GW] >= V_INIT))
          ) {
            vel[i] = bv;
            activity++;
            keepCellAwake(i);
            continue;
          }

          const sd = slopeDir[b0] || slopeDir[i];
          const bLEmpty = x > 1 && g[b0 - 1] === EMPTY && !(g[b0] >= WALL && g[i - 1] >= WALL);
          const bREmpty = x < GW - 2 && g[b0 + 1] === EMPTY && !(g[b0] >= WALL && g[i + 1] >= WALL);
          const allow2 = v >= 8 || y >= GH - 26 || sd !== 0;

          if (!bLEmpty && !bREmpty) {
            if (!allow2 && v < V_SPLASH) {
              vel[i] = 0;
              continue;
            }
            const canL2 = allow2 && x > 2 && g[i - 1] === EMPTY && g[i - 2] === EMPTY && g[b0 - 2] === EMPTY;
            const canR2 = allow2 && x < GW - 3 && g[i + 1] === EMPTY && g[i + 2] === EMPTY && g[b0 + 2] === EMPTY;
            const canChute3 =
              sd !== 0 &&
              x + sd * 3 > 0 &&
              x + sd * 3 < GW - 1 &&
              g[i + sd] === EMPTY &&
              g[i + sd * 2] === EMPTY &&
              g[i + sd * 3] === EMPTY &&
              g[b0 + sd * 3] === EMPTY;
            const canSplash =
              v >= V_SPLASH && ((x > 1 && g[i - 1] === EMPTY) || (x < GW - 2 && g[i + 1] === EMPTY));

            if (!canL2 && !canR2 && !canChute3 && !canSplash) {
              vel[i] = 0;
              continue;
            }

            if (sd !== 0) {
              if ((sd === -1 ? canL2 : canR2)) {
                const col1 = dyeAt(i + sd, c);
                const col2 = dyeAt(i + sd * 2, col1);
                const dest = b0 + sd * 2;
                step1(i, dest, col2);
                vel[dest] = Math.min(V_CHUTE_MAX, Math.max(22, v + 3));
                keepCellAwake(dest);
                continue;
              }
              if (canChute3) {
                const col1 = dyeAt(i + sd, c);
                const dest = i + sd * 2;
                step1(i, dest, col1);
                vel[dest] = Math.max(20, v);
                keepCellAwake(dest);
                continue;
              }
            }

            const d1 = canL2 !== canR2 ? (canL2 ? -1 : 1) : sd !== 0 ? sd : this.rng() < 0.5 ? -1 : 1;
            const d2 = -d1;
            const pick2 = (d1 === -1 ? canL2 : canR2) ? d1 : (d2 === -1 ? canL2 : canR2) ? d2 : 0;
            if (pick2 !== 0) {
              const col1 = dyeAt(i + pick2, c);
              const col2 = dyeAt(i + pick2 * 2, col1);
              const dest = b0 + pick2 * 2;
              step1(i, dest, col2);
              const nv = v >> 1;
              vel[dest] = nv;
              if (nv > 0) keepCellAwake(dest);
              continue;
            }

            if (canSplash) {
              const sDir =
                x + d1 > 0 && x + d1 < GW - 1 && g[i + d1] === EMPTY
                  ? d1
                  : x + d2 > 0 && x + d2 < GW - 1 && g[i + d2] === EMPTY
                    ? d2
                    : 0;
              if (sDir !== 0) {
                const dest = i + sDir;
                step1(i, dest, c);
                const nv = v >> 2;
                vel[dest] = nv;
                if (nv > 0) keepCellAwake(dest);
                continue;
              }
            }

            vel[i] = 0;
            continue;
          }

          const d1 = sd !== 0 ? sd : bLEmpty !== bREmpty ? (bLEmpty ? -1 : 1) : this.rng() < 0.5 ? -1 : 1;
          const d2 = -d1;
          const dd = (d1 === -1 ? bLEmpty : bREmpty) ? d1 : d2;

          let cur = b0 + dd;
          let col = step1(i, cur, c);
          if (g[cur + GW] === EMPTY) {
            if (sd === dd && v >= 24) {
              const cx = CELL_X[cur];
              if (cx + dd > 0 && cx + dd < GW - 1 && g[cur + dd] === EMPTY && g[cur + GW + dd] === EMPTY) {
                col = dyeAt(cur + dd, col);
                col = step1(cur, cur + GW + dd, col);
                cur = cur + GW + dd;
              }
            }
            let inh = 0;
            for (let k = 2; k <= 5; k++) {
              const j = cur + GW * k;
              if (j >= TOTAL_CELLS) break;
              const cj = g[j];
              if (cj === EMPTY) continue;
              if (isSand(cj)) inh = vel[j];
              break;
            }
            const v2 = inh > V_INIT ? inh : Math.max(V_INIT, v);
            let n2 = (v2 + ((this.frame * 7 + pass * 11) & 15)) >> 4;
            if (n2 < 1) n2 = 1;
            for (let k = 0; k < n2; k++) {
              const nb = cur + GW;
              if (nb >= TOTAL_CELLS - GW || g[nb] !== EMPTY) break;
              col = step1(cur, nb, col);
              cur = nb;
            }
            const nextBelow = cur + GW;
            const fv =
              nextBelow < TOTAL_CELLS - GW &&
              (g[nextBelow] === EMPTY || (isSand(g[nextBelow]) && vel[nextBelow] >= V_INIT))
                ? v2
                : Math.min(14, v2 >> 1);
            vel[cur] = fv;
            if (fv > 0) keepCellAwake(cur);
            continue;
          }

          const underCur = cur + GW;
          const onChute =
            underCur < TOTAL_CELLS && !isSand(g[underCur]) && (slopeDir[underCur] === dd || sd === dd);
          let nv;
          let extra;
          if (onChute) {
            nv = Math.min(V_CHUTE_MAX, Math.max(24, v + 5));
            extra = Math.min(3, nv >> 4);
          } else {
            extra = v >= V_MOMENTUM ? Math.min(3, (v - V_INIT) >> 4) : 0;
            nv = v > 0 ? Math.max(8, v - (v >> 2)) : 10;
          }

          while (extra-- > 0) {
            const downCell = cur + GW;
            if (downCell < TOTAL_CELLS - GW && g[downCell] === EMPTY) {
              col = step1(cur, downCell, col);
              cur = downCell;
              continue;
            }
            const cx = CELL_X[cur];
            if (cx + dd <= 0 || cx + dd >= GW - 1) break;
            const nb = downCell + dd;
            if (downCell < TOTAL_CELLS && g[nb] === EMPTY && !(g[downCell] >= WALL && g[cur + dd] >= WALL)) {
              col = step1(cur, nb, col);
              cur = nb;
              if (!onChute) nv = Math.max(8, nv - (nv >> 2));
              continue;
            }
            if (
              onChute &&
              g[cur + dd] === EMPTY &&
              cx + dd * 2 > 0 &&
              cx + dd * 2 < GW - 1 &&
              downCell < TOTAL_CELLS &&
              (g[downCell + dd * 2] === EMPTY || g[cur + dd * 2] === EMPTY)
            ) {
              col = step1(cur, cur + dd, col);
              cur = cur + dd;
              continue;
            }
            break;
          }
          vel[cur] = nv;
          if (nv > 0) keepCellAwake(cur);
        }
      }
    }
    rowAwake.set(nextRowAwake);

    // 3. 冰砖刚体下落（重物排开零星浮沙） / 脆冰高空硬底碎裂（厚沙床缓冲不碎）
    const own = this.iceMark;
    for (const ice of this.ice) {
      if (ice.shattered) continue;

      if (ice.iceType === 'permafrost') {
        let touchingSand = 0;
        let touchingForeign = 0;
        const cells = ice.cells;
        for (let k = 0; k < cells.length; k++) own[cells[k]] = 1;
        for (let k = 0; k < cells.length; k++) {
          const idx = cells[k];
          for (let q = 0; q < 3; q++) {
            const nb = q === 0 ? idx - GW : q === 1 ? idx - 1 : idx + 1;
            if (nb < 0 || nb >= TOTAL_CELLS || own[nb]) continue;
            const c = g[nb];
            if (isSand(c)) {
              touchingSand++;
              if (c !== ice.color && c !== GOLD) touchingForeign++;
            }
          }
        }
        for (let k = 0; k < cells.length; k++) own[cells[k]] = 0;
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
              let minY = GH;
              let maxY = 0;
              for (const i of ice.cells) {
                g[i] = ice.color;
                vel[i] = 0;
                const cy = CELL_Y[i];
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;
              }
              ice.shattered = true;
              this.wakeRows(minY, maxY);
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
      const nextVy = ice.moving ? Math.min(ICE_VMAX, ice.vy + ICE_G) : ICE_V0;
      const nextAcc = ice.acc + nextVy;
      let want = Math.floor(nextAcc);
      if (want < 1) want = 1;

      while (rows < want) {
        const stepped = this.iceTryStepDown(ice);
        if (!stepped.moved) break;
        activity += stepped.displaced;
        rows++;
      }

      if (rows > 0) {
        ice.vy = nextVy;
        ice.acc = Math.max(0, nextAcc - want);
        ice.moving = true;
        activity++;
      } else if (ice.moving) {
        ice.moving = false;
        ice.vy = 0;
        ice.acc = 0;
        for (let k = 0; k < ice.cells.length; k++) own[ice.cells[k]] = 1;
        let sandContacts = 0;
        let hardContacts = 0;
        for (const idx of ice.cells) {
          const below = idx + GW;
          if (below >= TOTAL_CELLS) {
            hardContacts++;
            continue;
          }
          if (own[below]) continue;
          const bv = g[below];
          if (bv === EMPTY) continue;
          if (isSand(bv) || bv >= FROZEN_BASE) sandContacts++;
          else hardContacts++;
        }
        for (let k = 0; k < ice.cells.length; k++) own[ice.cells[k]] = 0;
        const cushionedBySand = sandContacts > 0 && sandContacts >= hardContacts;

        if (ice.iceType !== 'permafrost' && !cushionedBySand && ice.fall >= ice.shatterDrop) {
          let minY = GH;
          let maxY = 0;
          for (const i of ice.cells) {
            g[i] = ice.color;
            vel[i] = 0;
            const cy = CELL_Y[i];
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;
          }
          ice.shattered = true;
          this.wakeRows(minY, maxY);
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
            vel[i] = 0;
            this.residueRemoved++;
          }
          for (const bk of [...this.active]) {
            if (!bk.done) this.completeBucket(bk);
          }
          this.wakeAllRows();
          activity++;
        }
      }
    }

    if (!this.won && this.buckets.length > 0 && this.buckets.every(b => b.done)) {
      for (let i = 0; i < g.length; i++) {
        if (isSand(g[i])) {
          g[i] = EMPTY;
          tag[i] = 0;
          vel[i] = 0;
          this.residueRemoved++;
        }
      }
      this.won = true;
      this.events.push({ frame: this.frame, type: 'win' });
    }
    return activity;
  }

  iceTryStepDown(ice) {
    const g = this.grid;
    const inter = this.interior;
    const own = this.iceMark;
    const cells = ice.cells;
    const n = cells.length;
    for (let k = 0; k < n; k++) own[cells[k]] = 1;

    let bottomFace = 0;
    let sandCnt = 0;
    let hardBlocked = false;
    const srcBuf = this.iceSandSrc;
    const dstBuf = this.iceSandDst;

    for (let k = 0; k < n; k++) {
      const below = cells[k] + GW;
      if (below < TOTAL_CELLS && own[below]) continue;
      bottomFace++;
      if (below >= TOTAL_CELLS) {
        hardBlocked = true;
        break;
      }
      const bv = g[below];
      if (bv === EMPTY) continue;
      if (isSand(bv) && sandCnt < srcBuf.length) {
        srcBuf[sandCnt++] = below;
      } else {
        hardBlocked = true;
        break;
      }
    }

    if (hardBlocked) {
      for (let k = 0; k < n; k++) own[cells[k]] = 0;
      return { moved: false, displaced: 0 };
    }

    if (sandCnt === 0) {
      for (let k = 0; k < n; k++) own[cells[k]] = 0;
      this.iceMoveDown(ice);
      return { moved: true, displaced: 0 };
    }

    if (sandCnt > Math.max(3, Math.floor(bottomFace * 0.28))) {
      for (let k = 0; k < n; k++) own[cells[k]] = 0;
      return { moved: false, displaced: 0 };
    }

    let allFound = true;
    let markedCnt = 0;
    for (let m = 0; m < sandCnt; m++) {
      const sIdx = srcBuf[m];
      const sx = CELL_X[sIdx];
      const sy = CELL_Y[sIdx];
      let dest = -1;
      const below2 = sIdx + GW;
      if (below2 < TOTAL_CELLS - GW && !own[below2] && inter[below2] && g[below2] === EMPTY) {
        dest = below2;
      } else {
        const pref = sx < 75 ? 1 : -1;
        let openA = true;
        let openB = true;
        for (let d = 1; d <= 10 && dest < 0 && (openA || openB); d++) {
          for (let side = 0; side < 2; side++) {
            const dir = side === 0 ? pref : -pref;
            if (side === 0 ? !openA : !openB) continue;
            const nx = sx + dir * d;
            if (nx <= 0 || nx >= GW - 1) {
              if (side === 0) openA = false;
              else openB = false;
              continue;
            }
            const cand = sy * GW + nx;
            const cv = g[cand];
            if (!inter[cand] || cv === WALL || (cv >= BOARD_BASE && cv < FROZEN_BASE)) {
              if (side === 0) openA = false;
              else openB = false;
              continue;
            }
            if (cv === EMPTY && !own[cand] && !own[cand - GW]) {
              dest = cand;
              break;
            }
          }
        }
      }
      if (dest < 0) {
        allFound = false;
        break;
      }
      dstBuf[m] = dest;
      own[dest] = 2;
      markedCnt++;
    }

    for (let m = 0; m < markedCnt; m++) own[dstBuf[m]] = 0;
    for (let k = 0; k < n; k++) own[cells[k]] = 0;

    if (!allFound) {
      return { moved: false, displaced: 0 };
    }

    const tag = this.tag;
    const vel = this.vel;
    const dye = this.dye;
    const dyeFrom = this.dyeFrom;
    for (let m = 0; m < sandCnt; m++) {
      const from = srcBuf[m];
      const to = dstBuf[m];
      let col = g[from];
      const dt = dye[to];
      if (dt && col !== GOLD && col !== dt && (!dyeFrom[to] || (dyeFrom[to] & (1 << col)) !== 0)) {
        col = dt;
      }
      g[to] = col;
      tag[to] = tag[from];
      vel[to] = V_INIT;
      g[from] = EMPTY;
      tag[from] = 0;
      vel[from] = 0;
      this.wakeRows(CELL_Y[from], CELL_Y[to]);
    }

    this.iceMoveDown(ice);
    return { moved: true, displaced: sandCnt };
  }

  iceMoveDown(ice) {
    const g = this.grid;
    const tag = this.tag;
    const cells = ice.cells;
    const n = cells.length;
    if (this.iceTmpTag.length < n) {
      this.iceTmpTag = new Uint8Array(n);
    }
    const tags = this.iceTmpTag;
    let minY = GH;
    let maxY = 0;
    for (let k = 0; k < n; k++) {
      const idx = cells[k];
      const cy = CELL_Y[idx];
      if (cy < minY) minY = cy;
      if (cy + 1 > maxY) maxY = cy + 1;
      tags[k] = tag[idx];
      g[idx] = EMPTY;
      tag[idx] = 0;
    }
    for (let k = 0; k < n; k++) {
      const j = cells[k] + GW;
      g[j] = ice.val;
      tag[j] = tags[k];
      cells[k] = j;
    }
    ice.fall++;
    if (maxY >= minY) this.wakeRows(minY, maxY);
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
