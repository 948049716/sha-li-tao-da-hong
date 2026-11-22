import type { BlindBoxId } from '../types/blindbox';
import type {
  BoardDef,
  DyeRingDef,
  LevelCapsuleDef,
  LevelConfig,
  SandColorId,
  VesselCatalog,
  VesselDef,
} from '../types/level';
import { BucketSystem } from './BucketSystem';
import {
  BOARD_BASE,
  CAPSULE_COLLECT_Y,
  DEFAULT_SHATTER_DROP,
  EMPTY,
  FROZEN_BASE,
  GH,
  GOLD_SAND,
  GW,
  OUTLET,
  OUTSIDE,
  TOTAL_CELLS,
  WALL,
  gridIdx,
  isSand,
  mulberry32,
  stampLine,
  zoneContains,
} from './SandGrid';
import { SnapshotStack } from './SnapshotStack';

export interface BoardRuntime extends BoardDef {
  val: number;
  isOpen: boolean;
  removed: boolean;
  pullAnimMs: number;
  pushAnimMs: number;
  lockShakeMs: number;
}

export interface IceRuntime {
  zoneId: string;
  val: number;
  color: SandColorId;
  cells: number[];
  fall: number;
  moving: boolean;
  shattered: boolean;
  shatterDrop: number;
}

export interface CapsuleRuntime {
  id: number;
  boxType: BlindBoxId;
  x: number;
  y: number;
  r: number;
  collected: boolean;
  naturally: boolean;
  flyStartX: number;
  flyStartY: number;
  flyProgressMs: number; // 0..400ms
}

export interface SandEngineCallbacks {
  onBoardPull?: (board: BoardRuntime) => void;
  onBoardLockedTap?: (board: BoardRuntime) => void;
  onLockAutoBreak?: (board: BoardRuntime) => void;
  onDyePass?: (x: number, y: number, toColor: SandColorId) => void;
  onIceShatter?: (cx: number, cy: number) => void;
  onBucketStepFill?: (stepIdx: number) => void;
  onBucketFull?: (bucketIdx: number, color: SandColorId, sweptCells: { cellIdx: number; color: number }[]) => void;
  onDrainParticle?: (gx: number, gy: number, bucketSlotIdx: number, color: SandColorId, isGold: boolean) => void;
  onCapsulePocket?: (cap: CapsuleRuntime) => void;
  onClogWarningChange?: (active: boolean) => void;
  onWin?: () => void;
}

export class SandEngine {
  public readonly grid = new Uint8Array(TOTAL_CELLS);
  public readonly shade = new Uint8Array(TOTAL_CELLS);
  public readonly tag = new Uint8Array(TOTAL_CELLS);
  public readonly interior = new Uint8Array(TOTAL_CELLS);
  public readonly dye = new Uint8Array(TOTAL_CELLS);
  public readonly dyeFrom = new Uint8Array(TOTAL_CELLS);

  public level!: LevelConfig;
  public vessel!: VesselDef;
  public boards: BoardRuntime[] = [];
  public dyeRings: DyeRingDef[] = [];
  public ice: IceRuntime[] = [];
  public capsules: CapsuleRuntime[] = [];
  public lootBag: BlindBoxId[] = [];

  public readonly bucketSys = new BucketSystem();
  public readonly snapshots = new SnapshotStack();

  public frame = 0;
  public won = false;
  public lastFlowParticles = 0;
  public screenShakeMs = 0;
  public vacuumAnimMs = 0;
  public vacuumUsedCount = 0;
  public boardsPulledCount = 0;

  private rng = mulberry32(20261121);
  private callbacks: SandEngineCallbacks;

  constructor(callbacks: SandEngineCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public setCallbacks(cb: SandEngineCallbacks): void {
    this.callbacks = cb;
  }

  public loadLevel(
    level: LevelConfig,
    vessels: VesselCatalog,
    overrideCapsules?: LevelCapsuleDef[],
    seed = 20261121
  ): void {
    const vessel = vessels[level.vesselTemplate];
    if (!vessel) {
      throw new Error(`未知容器模板: ${level.vesselTemplate}`);
    }
    this.level = level;
    this.vessel = vessel;
    this.rng = mulberry32(seed);

    this.grid.fill(EMPTY);
    this.shade.fill(18);
    this.tag.fill(0);
    this.interior.fill(0);
    this.dye.fill(0);
    this.dyeFrom.fill(0);

    this.frame = 0;
    this.won = false;
    this.lastFlowParticles = 0;
    this.screenShakeMs = 0;
    this.vacuumAnimMs = 0;
    this.vacuumUsedCount = 0;
    this.boardsPulledCount = 0;
    this.lootBag = [];
    this.snapshots.clear();

    const setWall = (x: number, y: number): void => {
      this.grid[gridIdx(x, y)] = WALL;
    };
    for (const poly of vessel.walls) {
      for (let i = 0; i < poly.points.length - 1; i++) {
        const [ax, ay] = poly.points[i];
        const [bx, by] = poly.points[i + 1];
        stampLine(ax, ay, bx, by, poly.thickness, setWall);
      }
    }
    for (const w of level.staticWalls || []) {
      stampLine(w.x0, w.y0, w.x1, w.y1, w.thickness ?? 2, setWall);
    }
    for (let x = 0; x < GW; x++) {
      this.grid[gridIdx(x, GH - 1)] = WALL;
    }

    // 从出沙口向上泛洪计算容器内部掩码（严格与 tools/lib/sim.js 对齐）
    const seedCell = gridIdx(75, GH - 4);
    const stack = [seedCell];
    this.interior[seedCell] = 1;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const x = cur % GW;
      const y = (cur / GW) | 0;
      const neighbors: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= GW || ny < 6 || ny >= GH) continue;
        const j = gridIdx(nx, ny);
        if (this.interior[j] || this.grid[j] === WALL) continue;
        this.interior[j] = 1;
        stack.push(j);
      }
    }
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (!this.interior[i] && this.grid[i] !== WALL) {
        this.grid[i] = OUTSIDE;
      }
    }

    // 光栅化木板（startsOpen 推入式挡板初始为开口态，不写入阻挡网格）
    this.boards = (level.boards || []).map((b, k) => {
      const val = BOARD_BASE + k;
      const isOpen = Boolean(b.startsOpen);
      if (!isOpen) {
        stampLine(b.x0, b.y0, b.x1, b.y1, 2, (x, y) => {
          const i = gridIdx(x, y);
          if (this.interior[i] && this.grid[i] === EMPTY) {
            this.grid[i] = val;
          }
        });
      }
      return {
        ...b,
        val,
        isOpen,
        removed: false,
        pullAnimMs: 0,
        pushAnimMs: 0,
        lockShakeMs: 0,
      };
    });

    // 染色环
    this.dyeRings = level.dyeRings || [];
    for (const ring of this.dyeRings) {
      let mask = 0;
      for (const c of ring.fromColors || []) {
        mask |= 1 << c;
      }
      for (let y = ring.y0; y <= ring.y1; y++) {
        for (let x = ring.x0; x <= ring.x1; x++) {
          if (x < 0 || x >= GW || y < 0 || y >= GH) continue;
          const i = gridIdx(x, y);
          if (this.interior[i]) {
            this.dye[i] = ring.toColor;
            this.dyeFrom[i] = mask;
          }
        }
      }
    }

    // 统计各沙区归属桶索引
    const zoneBucket: Record<string, number> = {};
    level.bucketQueue.forEach((b, k) => {
      b.zones.forEach(z => {
        zoneBucket[z] = k;
      });
    });

    // 放置冰砖与流沙颗粒，生成固定颗粒亮度扰动 shade (0..36, 中心 18)
    this.ice = [];
    const zoneCellCounts: Record<string, number> = {};
    for (const z of level.sandZones) {
      const bIdx = zoneBucket[z.id];
      let count = 0;
      const val = z.frozen ? FROZEN_BASE + this.ice.length : z.color;
      const cells: number[] = [];
      const deltaMax = z.color === GOLD_SAND ? 18 : 12;

      for (let y = 6; y < GH - 1; y++) {
        for (let x = 0; x < GW; x++) {
          if (!zoneContains(z, x, y)) continue;
          const i = gridIdx(x, y);
          if (!this.interior[i] || this.grid[i] !== EMPTY) continue;
          this.grid[i] = val;
          this.tag[i] = bIdx !== undefined ? bIdx + 1 : 0;
          const delta = Math.round((this.rng() * 2 - 1) * deltaMax);
          this.shade[i] = Math.max(0, Math.min(36, 18 + delta));
          count++;
          cells.push(i);
        }
      }
      zoneCellCounts[z.id] = count;
      if (z.frozen) {
        this.ice.push({
          zoneId: z.id,
          val,
          color: z.color,
          cells,
          fall: 0,
          moving: false,
          shattered: false,
          shatterDrop: z.shatterDrop || DEFAULT_SHATTER_DROP,
        });
      }
    }

    this.bucketSys.init(level.bucketQueue, zoneCellCounts);

    const capsSource = overrideCapsules ?? level.capsules ?? [];
    this.capsules = capsSource.map((c, idx) => ({
      id: idx,
      boxType: c.boxType,
      x: c.x,
      y: c.y,
      r: c.boxType === 'box_red' || c.boxType === 'box_double' ? 7.5 : 6.5,
      collected: false,
      naturally: false,
      flyStartX: c.x,
      flyStartY: c.y,
      flyProgressMs: 0,
    }));
  }

  /**
   * 命中检测：支持木板法线方向外扩 hitPaddingGrid 格方便单手点按
   */
  public hitTestBoard(gx: number, gy: number, hitPaddingGrid = 6.5): BoardRuntime | null {
    let best: BoardRuntime | null = null;
    let bestDist = hitPaddingGrid;
    for (const b of this.boards) {
      if (b.removed) continue;
      const dx = b.x1 - b.x0;
      const dy = b.y1 - b.y0;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((gx - b.x0) * dx + (gy - b.y0) * dy) / lenSq));
      const px = b.x0 + t * dx;
      const py = b.y0 + t * dy;
      const dist = Math.hypot(gx - px, gy - py);
      if (dist <= bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    return best;
  }

  private captureSnapshot(): void {
    this.snapshots.push({
      grid: this.grid.slice(),
      shade: this.shade.slice(),
      tag: this.tag.slice(),
      boards: this.boards.map(b => ({
        id: b.id,
        val: b.val,
        isOpen: b.isOpen,
        removed: b.removed,
        pullAnimMs: 0,
        lockShakeMs: 0,
        lockColor: b.lockColor,
      })),
      ice: this.ice.map(ic => ({
        zoneId: ic.zoneId,
        val: ic.val,
        color: ic.color,
        cells: [...ic.cells],
        fall: ic.fall,
        moving: ic.moving,
        shattered: ic.shattered,
        shatterDrop: ic.shatterDrop,
      })),
      capsules: this.capsules.map(c => ({
        id: c.id,
        boxType: c.boxType,
        x: c.x,
        y: c.y,
        r: c.r,
        collected: c.collected,
        naturally: c.naturally,
      })),
      buckets: this.bucketSys.buckets.map(bk => ({ ...bk, zones: [...bk.zones] })),
      activeIndices: this.bucketSys.active.map(bk => bk.idx),
      queuePtr: this.bucketSys.queuePtr,
      lootBag: [...this.lootBag],
    });
  }

  private closeGateInGrid(b: BoardRuntime): void {
    const g = this.grid;
    const tag = this.tag;
    const shade = this.shade;
    stampLine(b.x0, b.y0, b.x1, b.y1, 2, (x, y) => {
      const i = gridIdx(x, y);
      if (!this.interior[i] || g[i] === WALL || g[i] === b.val) return;
      if (isSand(g[i])) {
        let moved = false;
        for (let d = 1; d < 28 && !moved; d++) {
          for (const ny of [y - d, y + d]) {
            if (ny < 6 || ny >= GH - 1) continue;
            const ni = gridIdx(x, ny);
            if (this.interior[ni] && g[ni] === EMPTY) {
              g[ni] = g[i];
              tag[ni] = tag[i];
              shade[ni] = shade[i];
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

  public pullBoard(boardId: string, auto = false, fromLink = false): { ok: boolean; reason?: string } {
    if (this.won) return { ok: false, reason: 'won' };
    const b = this.boards.find(x => x.id === boardId);
    if (!b) return { ok: false, reason: 'not_found' };
    if (b.removed) return { ok: false, reason: 'already_removed' };
    if (b.lockColor && !auto) {
      b.lockShakeMs = 280;
      this.callbacks.onBoardLockedTap?.(b);
      return { ok: false, reason: 'locked' };
    }

    if (!auto && !fromLink) {
      this.captureSnapshot();
      this.boardsPulledCount++;
    }

    if (b.isOpen) {
      b.isOpen = false;
      b.pushAnimMs = 120;
      this.closeGateInGrid(b);
    } else {
      for (let i = 0; i < TOTAL_CELLS; i++) {
        if (this.grid[i] === b.val) {
          this.grid[i] = EMPTY;
        }
      }
      b.removed = true;
      b.pullAnimMs = 120;
    }

    if (!fromLink) {
      const partners = this.boards.filter(
        x => x.id !== b.id && !x.removed && !x.lockColor && (x.id === b.linkedTo || x.linkedTo === b.id)
      );
      for (const pb of partners) {
        this.pullBoard(pb.id, auto, true);
      }
    }

    if (auto) {
      this.callbacks.onLockAutoBreak?.(b);
    } else if (!fromLink) {
      this.callbacks.onBoardPull?.(b);
    }
    return { ok: true };
  }

  public undo(): boolean {
    const snap = this.snapshots.pop();
    if (!snap) return false;

    const keepDualSlot = this.bucketSys.maxActiveSlots;

    this.grid.set(snap.grid);
    this.shade.set(snap.shade);
    this.tag.set(snap.tag);

    for (const sb of snap.boards) {
      const target = this.boards.find(x => x.id === sb.id);
      if (target) {
        target.isOpen = sb.isOpen;
        target.removed = sb.removed;
        target.pullAnimMs = 0;
        target.pushAnimMs = 0;
        target.lockShakeMs = 0;
      }
    }

    this.ice = snap.ice.map(ic => ({ ...ic, cells: [...ic.cells] }));
    this.capsules = snap.capsules.map(c => ({
      ...c,
      flyStartX: c.x,
      flyStartY: c.y,
      flyProgressMs: 0,
    }));
    this.lootBag = [...snap.lootBag];

    this.bucketSys.buckets = snap.buckets.map(bk => ({ ...bk, zones: [...bk.zones] }));
    this.bucketSys.queuePtr = snap.queuePtr;
    this.bucketSys.active = snap.activeIndices
      .map(idx => this.bucketSys.buckets[idx])
      .filter(Boolean);
    this.bucketSys.maxActiveSlots = keepDualSlot;
    this.bucketSys.refillActiveSlots();
    this.bucketSys.clogFrames = 0;
    if (this.bucketSys.clogWarningActive) {
      this.bucketSys.clogWarningActive = false;
      this.callbacks.onClogWarningChange?.(false);
    }

    this.boardsPulledCount = Math.max(0, this.boardsPulledCount - 1);
    return true;
  }

  /**
   * 检测底部漏斗口区域内是否有流沙或未碎冰砖可供万能吸尘器吸取
   */
  public canUseVacuum(): boolean {
    if (this.won || this.vacuumUsedCount >= 3) return false;
    const cx = 75;
    const cy = 150;
    const rSq = 46 * 46;
    for (let y = Math.max(6, cy - 46); y < GH - 1; y++) {
      for (let x = Math.max(1, cx - 46); x < Math.min(GW - 1, cx + 46); x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rSq) continue;
        const v = this.grid[gridIdx(x, y)];
        if (isSand(v) || v >= FROZEN_BASE) return true;
      }
    }
    return false;
  }

  /**
   * 执行【万能吸尘清堵】——严格遵守 PRD §2.4 1:1 容量守恒铁律（优先吸除异色堵口沙并预充对应待接桶，绝不丢沙死局）
   */
  public useVacuum(nowMs = performance.now()): number {
    if (!this.canUseVacuum()) return 0;
    const cx = 75;
    const cy = 150;
    const rSq = 46 * 46;
    const maxSuck = 1800;

    // 先震碎范围内卡住的未碎冰砖
    for (const ic of this.ice) {
      if (ic.shattered) continue;
      const inRange = ic.cells.some(idx => {
        const x = idx % GW;
        const y = (idx / GW) | 0;
        return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rSq;
      });
      if (inRange) {
        for (const idx of ic.cells) {
          this.grid[idx] = ic.color;
        }
        ic.shattered = true;
        this.callbacks.onIceShatter?.(cx, cy - 8);
      }
    }

    let sucked = 0;
    // 第一轮优先吸除阻塞出沙口的异色流沙，第二轮再吸同色余沙
    for (const wrongOnly of [true, false]) {
      for (let y = GH - 2; y >= Math.max(6, cy - 46) && sucked < maxSuck; y--) {
        for (let x = Math.max(1, cx - 46); x <= Math.min(GW - 2, cx + 46) && sucked < maxSuck; x++) {
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rSq) continue;
          const i = gridIdx(x, y);
          const c = this.grid[i];
          if (!isSand(c)) continue;

          const color = c as SandColorId;
          const matchesActive =
            color === GOLD_SAND || this.bucketSys.active.some(b => !b.done && b.color === color);
          if (wrongOnly && matchesActive) continue;

          const taggedBucket = this.tag[i] > 0 ? this.bucketSys.buckets[this.tag[i] - 1] : undefined;
          const target =
            color === GOLD_SAND
              ? taggedBucket && !taggedBucket.done
                ? taggedBucket
                : this.bucketSys.active[0] || this.bucketSys.buckets.find(b => !b.done)
              : this.bucketSys.active.find(b => !b.done && b.color === color) ||
                (taggedBucket && !taggedBucket.done && taggedBucket.color === color ? taggedBucket : undefined) ||
                this.bucketSys.buckets.find(b => !b.done && b.color === color);

          this.grid[i] = EMPTY;
          this.tag[i] = 0;
          sucked++;

          if (target && !target.done) {
            target.cur++;
            const slotIdx = Math.max(0, this.bucketSys.active.indexOf(target));
            if (sucked % 16 === 0) {
              this.callbacks.onDrainParticle?.(x, y, slotIdx, target.color, color === GOLD_SAND);
            }
            const res = this.bucketSys.checkBucketProgress(
              target,
              this.grid,
              this.tag,
              nowMs,
              step => this.callbacks.onBucketStepFill?.(step)
            );
            if (res) {
              this.handleBucketCompleted(res.completedBucket.idx, res.unlockedColor, res.sweptCells);
            }
          }
        }
      }
    }

    if (sucked > 0) {
      this.vacuumUsedCount++;
      this.vacuumAnimMs = 450;
      this.bucketSys.clogFrames = 0;
      if (this.bucketSys.clogWarningActive) {
        this.bucketSys.clogWarningActive = false;
        this.callbacks.onClogWarningChange?.(false);
      }
      this.checkWinCondition();
    }
    return sucked;
  }

  private handleBucketCompleted(
    bucketIdx: number,
    unlockedColor: SandColorId,
    sweptCells: { cellIdx: number; color: number }[]
  ): void {
    this.callbacks.onBucketFull?.(bucketIdx, unlockedColor, sweptCells);
    for (const bd of this.boards) {
      if (!bd.removed && bd.lockColor === unlockedColor) {
        this.pullBoard(bd.id, true);
      }
    }
  }

  private checkWinCondition(): void {
    if (!this.won && this.bucketSys.allDone()) {
      this.won = true;
      // 通关瞬间自动将剩余未入兜盲盒磁吸飞入战利品袋（PRD §2.3）
      for (const cap of this.capsules) {
        if (!cap.collected) {
          this.collectCapsule(cap, false);
        }
      }
      this.callbacks.onWin?.();
    }
  }

  private collectCapsule(cap: CapsuleRuntime, naturally: boolean): void {
    if (cap.collected) return;
    cap.collected = true;
    cap.naturally = naturally;
    cap.flyStartX = cap.x;
    cap.flyStartY = cap.y;
    cap.flyProgressMs = 1;
    this.lootBag.push(cap.boxType);
    this.callbacks.onCapsulePocket?.(cap);
  }

  public updateVisualTimers(dtMs: number): void {
    if (this.screenShakeMs > 0) this.screenShakeMs = Math.max(0, this.screenShakeMs - dtMs);
    if (this.vacuumAnimMs > 0) this.vacuumAnimMs = Math.max(0, this.vacuumAnimMs - dtMs);
    for (const b of this.boards) {
      if (b.pullAnimMs > 0) b.pullAnimMs = Math.max(0, b.pullAnimMs - dtMs);
      if (b.pushAnimMs > 0) b.pushAnimMs = Math.max(0, b.pushAnimMs - dtMs);
      if (b.lockShakeMs > 0) b.lockShakeMs = Math.max(0, b.lockShakeMs - dtMs);
    }
    for (const c of this.capsules) {
      if (c.collected && c.flyProgressMs > 0 && c.flyProgressMs < 400) {
        c.flyProgressMs = Math.min(400, c.flyProgressMs + dtMs);
      }
    }
  }

  /**
   * 固定步长 60Hz 单帧推进（严格对齐 tools/lib/sim.js）
   */
  public step(nowMs = performance.now()): number {
    if (this.won) return 0;
    this.frame++;
    let activity = 0;
    const g = this.grid;
    const tag = this.tag;
    const shade = this.shade;

    // 1. 出沙口自动吸沙
    let drained = 0;
    let wrongAtOutlet = false;
    for (let y = OUTLET.y1; y >= OUTLET.y0 && drained < 32; y--) {
      const leftFirst = y % 2 === 0;
      for (let s = OUTLET.x0; s <= OUTLET.x1 && drained < 32; s++) {
        const x = leftFirst ? s : OUTLET.x0 + OUTLET.x1 - s;
        const i = gridIdx(x, y);
        const c = g[i];
        if (!isSand(c)) continue;

        let target =
          c === GOLD_SAND
            ? this.bucketSys.buckets[tag[i] - 1] || this.bucketSys.active[0]
            : this.bucketSys.active.find(b => !b.done && b.color === c);

        if (target && target.done && c === GOLD_SAND) {
          target = this.bucketSys.active[0] || this.bucketSys.buckets.find(b => !b.done)!;
        }

        if (target && !target.done) {
          const slotIdx = Math.max(0, this.bucketSys.active.indexOf(target));
          g[i] = EMPTY;
          tag[i] = 0;
          drained++;
          target.cur++;

          if (drained % 3 === 1) {
            this.callbacks.onDrainParticle?.(x, y, slotIdx, target.color, c === GOLD_SAND);
          }

          const res = this.bucketSys.checkBucketProgress(
            target,
            g,
            tag,
            nowMs,
            step => this.callbacks.onBucketStepFill?.(step)
          );
          if (res) {
            this.handleBucketCompleted(res.completedBucket.idx, res.unlockedColor, res.sweptCells);
          }
        } else {
          wrongAtOutlet = true;
        }
      }
    }
    activity += drained;

    // 检测是否有未碎冰砖堵在出沙口
    if (!wrongAtOutlet && drained === 0) {
      for (let y = OUTLET.y0 - 4; y <= OUTLET.y1 && !wrongAtOutlet; y++) {
        for (let x = OUTLET.x0; x <= OUTLET.x1; x++) {
          if (g[gridIdx(x, y)] >= FROZEN_BASE) {
            wrongAtOutlet = true;
            break;
          }
        }
      }
    }

    if (wrongAtOutlet && drained === 0) {
      this.bucketSys.clogFrames++;
      if (this.bucketSys.clogFrames >= 90 && !this.bucketSys.clogWarningActive) {
        this.bucketSys.clogWarningActive = true;
        this.callbacks.onClogWarningChange?.(true);
      }
    } else if (drained > 0) {
      this.bucketSys.clogFrames = 0;
      if (this.bucketSys.clogWarningActive) {
        this.bucketSys.clogWarningActive = false;
        this.callbacks.onClogWarningChange?.(false);
      }
    }

    // 2. 流沙元胞自动机（每帧 2 子步，奇偶帧交替扫描方向）
    let movedParticles = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = GH - 3; y >= 6; y--) {
        const dir = (y + pass + this.frame) % 2 === 0;
        for (let s = 1; s < GW - 1; s++) {
          const x = dir ? s : GW - 1 - s;
          const i = gridIdx(x, y);
          const c = g[i];
          if (!isSand(c)) continue;

          const moveTo = (j: number): void => {
            let nextColor = c;
            const dyeTarget = this.dye[j];
            if (
              dyeTarget &&
              c !== GOLD_SAND &&
              c !== dyeTarget &&
              (!this.dyeFrom[j] || (this.dyeFrom[j] & (1 << c)) !== 0)
            ) {
              nextColor = dyeTarget;
              if (movedParticles % 16 === 0) {
                this.callbacks.onDyePass?.(j % GW, (j / GW) | 0, dyeTarget as SandColorId);
              }
            }
            g[j] = nextColor;
            tag[j] = tag[i];
            shade[j] = shade[i];
            g[i] = EMPTY;
            tag[i] = 0;
            activity++;
            movedParticles++;
          };

          const b0 = gridIdx(x, y + 1);
          if (g[b0] === EMPTY) {
            moveTo(b0);
            continue;
          }
          const d1 = this.rng() < 0.5 ? -1 : 1;
          const d2 = -d1;
          const b1 = gridIdx(x + d1, y + 1);
          const b2 = gridIdx(x + d2, y + 1);
          if (g[b1] === EMPTY) {
            moveTo(b1);
          } else if (g[b2] === EMPTY) {
            moveTo(b2);
          } else {
            const nx = x + d1 * 2;
            if (
              nx > 0 &&
              nx < GW - 1 &&
              g[gridIdx(x + d1, y)] === EMPTY &&
              g[gridIdx(nx, y + 1)] === EMPTY
            ) {
              moveTo(gridIdx(nx, y + 1));
            }
          }
        }
      }
    }
    this.lastFlowParticles = drained + Math.min(35, Math.floor(movedParticles / 35));

    // 3. 冰砖刚体下落与 >=28 格碎裂判定
    for (const ic of this.ice) {
      if (ic.shattered) continue;
      const own = new Set(ic.cells);
      let free = true;
      for (const idx of ic.cells) {
        const below = idx + GW;
        if (below >= TOTAL_CELLS || (!own.has(below) && g[below] !== EMPTY)) {
          free = false;
          break;
        }
      }
      if (free) {
        const tags = ic.cells.map(idx => tag[idx]);
        const shades = ic.cells.map(idx => shade[idx]);
        for (const idx of ic.cells) {
          g[idx] = EMPTY;
          tag[idx] = 0;
        }
        const moved: number[] = [];
        for (let k = 0; k < ic.cells.length; k++) {
          const j = ic.cells[k] + GW;
          g[j] = ic.val;
          tag[j] = tags[k];
          shade[j] = shades[k];
          moved.push(j);
        }
        ic.cells = moved;
        ic.fall++;
        ic.moving = true;
        activity++;
      } else if (ic.moving) {
        ic.moving = false;
        if (ic.fall >= ic.shatterDrop) {
          let sumX = 0;
          let maxY = 0;
          for (const idx of ic.cells) {
            g[idx] = ic.color;
            sumX += idx % GW;
            maxY = Math.max(maxY, (idx / GW) | 0);
          }
          ic.shattered = true;
          this.screenShakeMs = 95;
          const cx = ic.cells.length ? sumX / ic.cells.length : 75;
          this.callbacks.onIceShatter?.(cx, maxY);
          activity++;
        }
        ic.fall = 0;
      }
    }

    // 4. 盲盒胶囊重力与斜面滚动
    for (const cap of this.capsules) {
      if (cap.collected) continue;
      const gx = Math.round(cap.x);
      const gy = Math.round(cap.y);
      const prevX = cap.x;
      const prevY = cap.y;

      if (this.capsuleClear(gx, gy + 1, cap.r)) {
        cap.y += 1.25;
      } else {
        const tc = cap.x < GW / 2 ? 1 : -1;
        if (this.capsuleClear(gx + tc, gy + 1, cap.r)) {
          cap.x += tc * 0.9;
          cap.y += 0.9;
        } else if (this.capsuleClear(gx - tc, gy + 1, cap.r)) {
          cap.x -= tc * 0.9;
          cap.y += 0.9;
        } else {
          const [lh, rh] = this.supportBalance(gx, gy, cap.r);
          if (lh !== rh) {
            const d = lh > rh ? 1 : -1;
            if (this.capsuleClear(gx + d, gy, cap.r)) {
              cap.x += d * 0.7;
            }
          }
        }
      }

      if (cap.x !== prevX || cap.y !== prevY) activity++;
      if (cap.y >= CAPSULE_COLLECT_Y) {
        this.collectCapsule(cap, true);
      }
    }

    this.checkWinCondition();
    return activity;
  }

  private capsuleClear(gx: number, gy: number, r: number): boolean {
    const R = Math.ceil(r);
    let hits = 0;
    for (let dy = 0; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = gx + dx;
        const y = gy + dy;
        if (x < 0 || x >= GW || y < 0 || y >= GH) return false;
        if (this.grid[gridIdx(x, y)] !== EMPTY) hits++;
        if (hits > 1) return false;
      }
    }
    return true;
  }

  private supportBalance(gx: number, gy: number, r: number): [number, number] {
    const R = Math.ceil(r) + 1;
    let l = 0;
    let rr = 0;
    for (let dy = 1; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx === 0 || dx * dx + dy * dy > (r + 1) * (r + 1)) continue;
        const x = gx + dx;
        const y = gy + dy;
        if (x < 0 || x >= GW || y >= GH) continue;
        if (this.grid[gridIdx(x, y)] !== EMPTY) {
          if (dx < 0) l++;
          else rr++;
        }
      }
    }
    return [l, rr];
  }
}
