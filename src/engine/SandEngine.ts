import type {
  BoardDef,
  DyeRingDef,
  IceKind,
  LevelConfig,
  SandColorId,
  VesselCatalog,
  VesselDef,
} from '../types/level';
import { BucketSystem } from './BucketSystem';
import {
  BOARD_BASE,
  ICE_G,
  ICE_V0,
  ICE_VMAX,
  RELEASE_FRAMES,
  V_GRAV,
  V_IMPACT_FX,
  V_INIT,
  V_MAX,
  V_MOMENTUM,
  boardReleaseOrder,
  DEFAULT_SHATTER_DROP,
  DEFAULT_THAW_CONTACTS,
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
  /** 渐进释放队列（远端先空），null 表示无待释放格 */
  release: number[] | null;
  releasePtr: number;
  releaseTick: number;
}

export interface IceRuntime {
  zoneId: string;
  val: number;
  color: SandColorId;
  iceType: IceKind;
  cells: number[];
  fall: number;
  /** 当前下落速度（格/帧）与亚格累计位移 */
  vy: number;
  acc: number;
  moving: boolean;
  shattered: boolean;
  shatterDrop: number;
  thawContacts: number;
  thawProgress: number;
  primed: boolean;
  clearFrames: number;
}

export interface SandEngineCallbacks {
  onBoardPull?: (board: BoardRuntime) => void;
  onBoardLockedTap?: (board: BoardRuntime) => void;
  onLockAutoBreak?: (board: BoardRuntime) => void;
  onDyePass?: (x: number, y: number, toColor: SandColorId) => void;
  onIceShatter?: (cx: number, cy: number) => void;
  onBucketDispatch?: (bucketIdx: number, colIdx: number, slotIdx: number, color: SandColorId) => void;
  onBucketBlockedTap?: (
    colIdx: number,
    reason: 'empty_col' | 'iced' | 'slots_full' | 'out_of_bounds'
  ) => void;
  onMysteryReveal?: (bucketIdx: number, colIdx: number, color: SandColorId) => void;
  onBucketIceCrack?: (thawedBucketIndices: number[]) => void;
  onBucketStepFill?: (stepIdx: number) => void;
  onBucketFull?: (
    bucketIdx: number,
    color: SandColorId,
    sweptCells: { cellIdx: number; color: number }[]
  ) => void;
  onDrainParticle?: (
    gx: number,
    gy: number,
    bucketSlotIdx: number,
    color: SandColorId,
    isGold: boolean
  ) => void;
  onClogWarningChange?: (active: boolean) => void;
  onDeadlockChange?: (active: boolean) => void;
  onWin?: () => void;
}

export class SandEngine {
  public readonly grid = new Uint8Array(TOTAL_CELLS);
  public readonly shade = new Uint8Array(TOTAL_CELLS);
  public readonly tag = new Uint8Array(TOTAL_CELLS);
  public readonly interior = new Uint8Array(TOTAL_CELLS);
  public readonly dye = new Uint8Array(TOTAL_CELLS);
  public readonly dyeFrom = new Uint8Array(TOTAL_CELLS);
  /** 每格竖直速度（1/16 格/子步），驱动重力加速与动量滑落 */
  public readonly vel = new Uint8Array(TOTAL_CELLS);
  /** 冰砖自身格标记（替代每帧 new Set，零 GC；用后立即清零） */
  private readonly iceMark = new Uint8Array(TOTAL_CELLS);
  private iceTmpTag = new Uint8Array(256);
  private iceTmpShade = new Uint8Array(256);
  /** 纯视觉：本帧高速着陆冲击点 [gx, gy, color] 环形缓冲（渲染层消费后清零） */
  public readonly impactBuf = new Int16Array(3 * 32);
  public impactCount = 0;
  /** 纯视觉：本帧悬空高速下落的颗粒数量 */
  public airborneCount = 0;

  public level!: LevelConfig;
  public vessel!: VesselDef;
  public boards: BoardRuntime[] = [];
  public dyeRings: DyeRingDef[] = [];
  public ice: IceRuntime[] = [];

  public readonly bucketSys = new BucketSystem();
  public readonly snapshots = new SnapshotStack();

  public frame = 0;
  public won = false;
  public lastFlowParticles = 0;
  private lastMovedParticles = 0;
  private endGameIdleFrames = 0;
  public screenShakeMs = 0;
  public vacuumAnimMs = 0;
  public shuffleAnimMs = 0;
  public vacuumUsedCount = 0;
  public shuffleUsedCount = 0;
  public boardsPulledCount = 0;
  public bucketsDispatchedCount = 0;
  public loadGeneration = 0;

  /** 兼容主注沙状态 + 5 个独立小卡槽各自对应的宽滤网吸沙 X 坐标与流束计时 */
  public pourStreamColor: SandColorId | 0 = 0;
  public pourStreamSlot = 0;
  public pourStreamMs = 0;
  public readonly slotPourX = new Float32Array(5);
  public readonly slotPourColor = new Uint8Array(5);
  public readonly slotPourMs = new Float32Array(5);

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
    seed = 20261121
  ): void {
    const vessel = vessels[level.vesselTemplate];
    if (!vessel) {
      throw new Error(`未知容器模板: ${level.vesselTemplate}`);
    }
    this.level = level;
    this.vessel = vessel;
    this.loadGeneration++;
    this.rng = mulberry32(seed);

    this.grid.fill(EMPTY);
    this.shade.fill(18);
    this.tag.fill(0);
    this.interior.fill(0);
    this.dye.fill(0);
    this.dyeFrom.fill(0);
    this.vel.fill(0);
    this.impactCount = 0;
    this.airborneCount = 0;

    this.frame = 0;
    this.won = false;
    this.lastFlowParticles = 0;
    this.lastMovedParticles = 0;
    this.endGameIdleFrames = 0;
    this.screenShakeMs = 0;
    this.vacuumAnimMs = 0;
    this.shuffleAnimMs = 0;
    this.vacuumUsedCount = 0;
    this.shuffleUsedCount = 0;
    this.boardsPulledCount = 0;
    this.bucketsDispatchedCount = 0;
    this.pourStreamColor = 0;
    this.pourStreamSlot = 0;
    this.pourStreamMs = 0;
    this.slotPourX.fill(75);
    this.slotPourColor.fill(0);
    this.slotPourMs.fill(0);
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
    for (let x = 0; x < GW; x++) {
      this.grid[gridIdx(x, GH - 1)] = WALL;
    }

    // 先对容器外壁内部泛洪求 interior，再落内部静态隔墙（严格与 tools/lib/sim.js 对齐）
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
    for (const w of level.staticWalls || []) {
      stampLine(w.x0, w.y0, w.x1, w.y1, w.thickness ?? 2, (x, y) => {
        const i = gridIdx(x, y);
        this.grid[i] = WALL;
        this.interior[i] = 0;
      });
    }

    // 光栅化木板
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
        release: null,
        releasePtr: 0,
        releaseTick: 0,
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

    // 放置冰砖与流沙颗粒，编码水粉体积色阶 (低 5 位 0..31) + 粗细双阶砂砾标记 (高 3 位 0..7)
    this.ice = [];
    const zoneCellCounts: Record<string, number> = {};
    for (const z of level.sandZones) {
      const bIdx = zoneBucket[z.id];
      let count = 0;
      const val = z.frozen ? FROZEN_BASE + this.ice.length : z.color;
      const cells: number[] = [];
      const isGoldZone = z.color === GOLD_SAND;

      for (let y = 6; y < GH - 1; y++) {
        for (let x = 0; x < GW; x++) {
          if (!zoneContains(z, x, y)) continue;
          const i = gridIdx(x, y);
          if (!this.interior[i] || this.grid[i] !== EMPTY) continue;
          this.grid[i] = val;
          this.tag[i] = bIdx !== undefined ? bIdx + 1 : 0;
          const r01 = this.rng(); // 保持每格唯一 1 次 rng 调用，100% 锁定物理确定性
          const cloud =
            Math.sin(x * 0.085 + y * 0.105) * 3.8 +
            Math.cos(x * 0.042 - y * 0.075) * 2.6;
          const jitter = (r01 * 2 - 1) * (isGoldZone ? 6.2 : 4.2);
          const tone = Math.max(0, Math.min(31, Math.round(16 + cloud + jitter)));
          const hash = ((x * 73856093) ^ (y * 19349663) ^ ((r01 * 65535) | 0)) >>> 0;
          const mod = hash % 100;
          let grainKind = 0;
          if (mod < (isGoldZone ? 10 : 8)) {
            grainKind = 5; // 粗砂暗砾
          } else if (mod < (isGoldZone ? 20 : 17)) {
            grainKind = 6; // 中砂暖粒
          } else if (mod < (isGoldZone ? 32 : 24)) {
            grainKind = 7; // 细亮石英砂
          }
          this.shade[i] = (grainKind << 5) | tone;
          count++;
          cells.push(i);
        }
      }
      zoneCellCounts[z.id] = count;
      if (z.frozen) {
        const iceType: IceKind =
          z.iceType || (z.thawContacts && z.thawContacts > 0 ? 'permafrost' : 'brittle');
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

    this.bucketSys.init(level.bucketQueue, zoneCellCounts, level.numCols);
    this.settleInitialState();
  }

  /**
   * 开局静默预沉降：在首帧渲染与玩家交互前将各仓流沙自然沉降至稳定安息角，
   * 杜绝进入关卡未操作时出现空中落沙、侧向塌方与误触白噪音（与 tools/lib/sim.js 严格同源对齐）。
   */
  public settleInitialState(maxFrames = 360): void {
    const savedCb = this.callbacks;
    this.callbacks = {};
    try {
      let idle = 0;
      for (let f = 0; f < maxFrames; f++) {
        const act = this.step(0);
        idle = act === 0 ? idle + 1 : 0;
        if (idle >= 6) break;
      }
    } finally {
      this.callbacks = savedCb;
    }
    this.frame = 0;
    this.vel.fill(0);
    this.impactCount = 0;
    this.airborneCount = 0;
    this.lastFlowParticles = 0;
    this.lastMovedParticles = 0;
    this.endGameIdleFrames = 0;
    this.screenShakeMs = 0;
    this.pourStreamColor = 0;
    this.pourStreamMs = 0;
    this.slotPourMs.fill(0);
    this.bucketSys.clogFrames = 0;
    this.bucketSys.clogWarningActive = false;
    this.bucketSys.hardDeadlockActive = false;
  }

  /**
   * 命中检测：覆盖木板本体、外壁外伸雕花木拉手及箱内垂挂「抽」字木吊牌
   */
  public hitTestBoard(gx: number, gy: number, hitPaddingGrid = 6.5): BoardRuntime | null {
    let best: BoardRuntime | null = null;
    let bestDist = hitPaddingGrid;
    for (const b of this.boards) {
      if (b.removed) continue;
      const isLeft = Math.min(b.x0, b.x1) <= 34 && Math.max(b.x0, b.x1) < 126;
      const ax0 = isLeft ? Math.min(b.x0, b.x1) - 14 : b.x0;
      const ax1 = !isLeft ? Math.max(b.x0, b.x1) + 14 : b.x1;
      const dx = ax1 - ax0;
      const dy = b.y1 - b.y0;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((gx - ax0) * dx + (gy - b.y0) * dy) / lenSq));
      const px = ax0 + t * dx;
      const py = b.y0 + t * dy;
      let dist = Math.hypot(gx - px, gy - py);

      if (!b.lockColor && !b.isOpen) {
        const tagX = isLeft ? Math.min(b.x0, b.x1) + 10 : Math.max(b.x0, b.x1) - 10;
        const tagY = (b.y0 + b.y1) * 0.5 + 7;
        const tagDist = Math.hypot(gx - tagX, gy - tagY);
        if (tagDist < dist) dist = tagDist;
      }

      if (dist <= bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    return best;
  }

  /** 立即完成所有木板的渐进释放（快照/撤回前调用，保证快照中不残留隐形木板格） */
  private flushBoardReleases(): void {
    for (const b of this.boards) {
      if (!b.release) continue;
      const g = this.grid;
      for (let k = b.releasePtr; k < b.release.length; k++) {
        const i = b.release[k];
        if (g[i] === b.val) g[i] = EMPTY;
      }
      b.release = null;
    }
  }

  private beginBoardRelease(b: BoardRuntime): void {
    const cells: number[] = [];
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (this.grid[i] === b.val) cells.push(i);
    }
    b.release = boardReleaseOrder(b, cells);
    b.releasePtr = 0;
    b.releaseTick = 0;
  }

  /** 每帧推进木板释放（缓入二次曲线，对齐抽板滑出动画；严格对齐 tools/lib/sim.js） */
  private advanceBoardRelease(): number {
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

  private setClogAndDeadlock(softWarn: boolean, hardDeadlock: boolean): void {
    if (this.bucketSys.clogWarningActive !== softWarn) {
      this.bucketSys.clogWarningActive = softWarn;
      this.callbacks.onClogWarningChange?.(softWarn);
    }
    if (this.bucketSys.hardDeadlockActive !== hardDeadlock) {
      this.bucketSys.hardDeadlockActive = hardDeadlock;
      this.callbacks.onDeadlockChange?.(hardDeadlock);
    }
  }

  private captureSnapshot(): void {
    this.flushBoardReleases();
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
        iceType: ic.iceType,
        cells: [...ic.cells],
        fall: ic.fall,
        moving: ic.moving,
        shattered: ic.shattered,
        shatterDrop: ic.shatterDrop,
        thawContacts: ic.thawContacts,
        thawProgress: ic.thawProgress,
        primed: ic.primed,
        clearFrames: ic.clearFrames,
      })),
      buckets: this.bucketSys.buckets.map(bk => ({ ...bk, zones: [...bk.zones] })),
      activeSlotIndices: this.bucketSys.activeSlots.map(bk => (bk ? bk.idx : null)),
      columnIndices: this.bucketSys.columns.map(col => col.map(bk => bk.idx)),
      placementCounter: this.bucketSys.placementCounter,
    });
  }

  private closeGateInGrid(b: BoardRuntime): void {
    const g = this.grid;
    const tag = this.tag;
    const shade = this.shade;
    const vel = this.vel;
    b.release = null;
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
              vel[ni] = 0;
              moved = true;
              break;
            }
          }
        }
        tag[i] = 0;
      }
      if (g[i] === EMPTY || isSand(g[i])) {
        g[i] = b.val;
        vel[i] = 0;
      }
    });
  }

  /**
   * 点选下方候选队列第 colIdx 列的列首木桶送入小卡槽（推入 5 步撤回栈）
   */
  public dispatchBucket(colIdx: number): {
    ok: boolean;
    slotIdx?: number;
    reason?: 'won' | 'empty_col' | 'iced' | 'slots_full' | 'out_of_bounds';
  } {
    if (this.won) return { ok: false, reason: 'won' };
    if (colIdx < 0 || colIdx >= this.bucketSys.numCols) {
      this.callbacks.onBucketBlockedTap?.(colIdx, 'out_of_bounds');
      return { ok: false, reason: 'out_of_bounds' };
    }
    const col = this.bucketSys.columns[colIdx];
    if (!col || col.length === 0) {
      this.callbacks.onBucketBlockedTap?.(colIdx, 'empty_col');
      return { ok: false, reason: 'empty_col' };
    }
    if (col[0].iceLayers > 0) {
      col[0].iceShakeMs = 300;
      this.callbacks.onBucketBlockedTap?.(colIdx, 'iced');
      return { ok: false, reason: 'iced' };
    }
    if (this.bucketSys.findFirstEmptySlot() < 0) {
      this.callbacks.onBucketBlockedTap?.(colIdx, 'slots_full');
      return { ok: false, reason: 'slots_full' };
    }

    this.captureSnapshot();
    const res = this.bucketSys.dispatchFromColumn(colIdx);
    if (!res.ok || !res.bucket || res.slotIdx === undefined) {
      return { ok: false, reason: res.reason };
    }
    this.bucketsDispatchedCount++;
    this.bucketSys.clogFrames = 0;
    this.setClogAndDeadlock(false, false);

    this.callbacks.onBucketDispatch?.(res.bucket.idx, colIdx, res.slotIdx, res.bucket.color);
    if (res.revealedBucket) {
      this.callbacks.onMysteryReveal?.(
        res.revealedBucket.idx,
        colIdx,
        res.revealedBucket.color
      );
    }
    return { ok: true, slotIdx: res.slotIdx };
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
      this.bucketSys.clogFrames = 0;
      this.setClogAndDeadlock(false, false);
    }

    if (b.isOpen) {
      b.isOpen = false;
      b.pushAnimMs = 120;
      this.closeGateInGrid(b);
    } else {
      this.beginBoardRelease(b);
      if (b.reusable) {
        b.isOpen = true;
        b.pullAnimMs = 120;
      } else {
        b.removed = true;
        b.pullAnimMs = 120;
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

    if (auto) {
      this.callbacks.onLockAutoBreak?.(b);
    } else if (!fromLink) {
      this.callbacks.onBoardPull?.(b);
    }
    return { ok: true };
  }

  /**
   * 解锁第 5 格临时小卡槽（单局 1 次，撤回时保留）
   */
  public enableExtraSlot(): boolean {
    const ok = this.bucketSys.enableExtraSlot();
    if (ok) {
      this.setClogAndDeadlock(false, false);
    }
    return ok;
  }

  public undo(): boolean {
    const snap = this.snapshots.pop();
    if (!snap) return false;

    const keepMaxSlots = this.bucketSys.maxActiveSlots;

    this.grid.set(snap.grid);
    this.shade.set(snap.shade);
    this.tag.set(snap.tag);
    this.vel.fill(0);
    this.impactCount = 0;

    for (const sb of snap.boards) {
      const target = this.boards.find(x => x.id === sb.id);
      if (target) {
        target.isOpen = sb.isOpen;
        target.removed = sb.removed;
        target.pullAnimMs = 0;
        target.pushAnimMs = 0;
        target.lockShakeMs = 0;
        target.release = null;
        if (target.removed || target.isOpen) {
          for (let i = 0; i < TOTAL_CELLS; i++) {
            if (this.grid[i] === target.val) this.grid[i] = EMPTY;
          }
        }
      }
    }

    this.ice = snap.ice.map(ic => ({ ...ic, cells: [...ic.cells], vy: 0, acc: 0 }));

    this.bucketSys.buckets = snap.buckets.map(bk => ({
      ...bk,
      zones: [...bk.zones],
      iceShakeMs: 0,
      revealAnimMs: 0,
    }));
    this.bucketSys.placementCounter = snap.placementCounter;
    this.bucketSys.activeSlots = [null, null, null, null, null];
    for (let s = 0; s < snap.activeSlotIndices.length && s < 5; s++) {
      const idx = snap.activeSlotIndices[s];
      const bk = idx !== null && idx !== undefined ? this.bucketSys.buckets[idx] ?? null : null;
      if (bk) bk.slotIdx = s;
      this.bucketSys.activeSlots[s] = bk;
    }
    this.bucketSys.columns = snap.columnIndices.map((colIndices, cIdx) =>
      colIndices
        .map(idx => {
          const bk = this.bucketSys.buckets[idx];
          if (bk) {
            bk.col = cIdx;
            bk.slotIdx = -1;
          }
          return bk;
        })
        .filter(Boolean)
    );
    this.bucketSys.maxActiveSlots = keepMaxSlots;
    this.bucketSys.clogFrames = 0;
    this.setClogAndDeadlock(false, false);

    this.pourStreamMs = 0;
    this.slotPourMs.fill(0);
    return true;
  }

  /**
   * 检测当前是否可使用【🌪️ 磁吸满桶】（单局上限 3 次，要求小卡槽内至少有 1 只未满木桶）
   */
  public canUseMagnet(): boolean {
    return !this.won && this.vacuumUsedCount < 3 && this.bucketSys.occupiedSlotCount > 0;
  }

  /** 向后兼容旧命名 */
  public canUseVacuum(): boolean {
    return this.canUseMagnet();
  }

  /**
   * 执行【🌪️ 磁吸满桶】——隔空从沙箱任意层（含冰砖与待染色沙源）精准抽取 `need = max - cur` 粒目标同色沙，
   * 100% 瞬间灌满并清走 1 只在槽木桶腾出卡槽，严格遵守 1:1 颗粒守恒铁律！
   */
  public useMagnetFill(
    nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  ): number {
    if (!this.canUseMagnet()) return 0;
    const act = this.bucketSys.active;
    if (act.length === 0) return 0;

    // 优先救援当前吸不到底沙而停滞的在槽木桶（腾位破局），否则取最早入槽木桶
    const target = act.find(b => b.idleDrainFrames >= 8) || act[0];
    const need = Math.max(1, target.max - target.cur);
    const sweptCells: { cellIdx: number; color: number }[] = [];
    let taken = 0;

    const takeCell = (i: number): void => {
      const c = this.grid[i];
      const ownerIdx = this.tag[i] > 0 ? this.tag[i] - 1 : -1;
      if (c === GOLD_SAND && target.color !== GOLD_SAND && ownerIdx >= 0 && ownerIdx !== target.idx) {
        const owner = this.bucketSys.buckets[ownerIdx];
        if (owner && !owner.done && owner.max > owner.cur + 1) {
          owner.max--;
        }
      }
      sweptCells.push({ cellIdx: i, color: c });
      this.grid[i] = EMPTY;
      this.tag[i] = 0;
      this.vel[i] = 0;
      taken++;
    };

    // Tier 1：自底向上优先吸取沙箱中现有的同色松散沙粒（顺带剥开压在滤网上的该色沙层）
    for (let y = GH - 2; y >= 6 && taken < need; y--) {
      for (let x = 1; x < GW - 1 && taken < need; x++) {
        const i = gridIdx(x, y);
        if (this.grid[i] === target.color) {
          takeCell(i);
        }
      }
    }

    // Tier 2：若松散同色沙不足（部分沙尚封在同色冰砖内），震碎对应冰砖并补齐差额
    if (taken < need) {
      for (const ic of this.ice) {
        if (ic.shattered || taken >= need) continue;
        const firstTag = ic.cells.length > 0 ? this.tag[ic.cells[0]] : 0;
        const taggedColor = firstTag > 0 ? this.bucketSys.buckets[firstTag - 1]?.color : undefined;
        if (ic.color !== target.color && taggedColor !== target.color) continue;

        let sumX = 0;
        let maxY = 0;
        for (const idx of ic.cells) {
          this.grid[idx] = target.color;
          this.vel[idx] = 0;
          sumX += idx % GW;
          maxY = Math.max(maxY, (idx / GW) | 0);
        }
        ic.shattered = true;
        this.callbacks.onIceShatter?.(ic.cells.length ? sumX / ic.cells.length : 75, maxY);

        for (let k = ic.cells.length - 1; k >= 0 && taken < need; k--) {
          const idx = ic.cells[k];
          if (this.grid[idx] === target.color) {
            takeCell(idx);
          }
        }
      }
    }

    // Tier 3：若仍有差额（沙源尚在染色环上方未染色），按 tag 归属精准抽取待染为 target.color 的原沙
    if (taken < need) {
      for (let y = GH - 2; y >= 6 && taken < need; y--) {
        for (let x = 1; x < GW - 1 && taken < need; x++) {
          const i = gridIdx(x, y);
          const c = this.grid[i];
          if (!isSand(c)) continue;
          const bOwner = this.tag[i] > 0 ? this.bucketSys.buckets[this.tag[i] - 1] : undefined;
          if (bOwner && bOwner.color === target.color) {
            takeCell(i);
          }
        }
      }
    }

    // Tier 4：兜底匹配黄金通配沙
    if (taken < need) {
      for (let y = GH - 2; y >= 6 && taken < need; y--) {
        for (let x = 1; x < GW - 1 && taken < need; x++) {
          const i = gridIdx(x, y);
          if (this.grid[i] === GOLD_SAND) {
            takeCell(i);
          }
        }
      }
    }

    const slotIdx = Math.max(0, target.slotIdx);
    for (let k = 0; k < sweptCells.length; k += Math.max(1, Math.floor(sweptCells.length / 10))) {
      const cell = sweptCells[k].cellIdx;
      this.callbacks.onDrainParticle?.(
        cell % GW,
        (cell / GW) | 0,
        slotIdx,
        target.color,
        sweptCells[k].color === GOLD_SAND
      );
    }

    const res = this.bucketSys.completeBucket(target, nowMs, sweptCells);
    this.vacuumUsedCount++;
    this.vacuumAnimMs = 450;
    this.screenShakeMs = Math.max(this.screenShakeMs, 65);
    this.bucketSys.clogFrames = 0;
    this.setClogAndDeadlock(false, false);
    this.handleSweepResult(res);
    this.checkWinCondition();
    return Math.max(1, taken);
  }

  public useVacuum(nowMs?: number): number {
    return this.useMagnetFill(nowMs);
  }

  /**
   * 检测当前是否可使用【🔀 候选洗牌】（单局上限 3 次，要求候选列剩余至少 2 只木桶）
   */
  public canUseShuffle(): boolean {
    return !this.won && this.shuffleUsedCount < 3 && this.bucketSys.remainingCandidateCount >= 2;
  }

  /**
   * 执行【🔀 候选洗牌】——重排所有候选列剩余木桶，并智能保底将至少 1 只匹配当前滤网裸露沙色的非冰封木桶推至列首 Row 0！
   */
  public useShuffleColumns(): boolean {
    if (!this.canUseShuffle()) return false;

    const pool = this.bucketSys.columns.flat();
    if (pool.length < 2) return false;

    // 采集当前宽底滤网及近底区裸露沙色
    const exposedColors = new Set<SandColorId>();
    for (let y = OUTLET.y1; y >= Math.max(142, OUTLET.y0 - 12); y--) {
      for (let x = OUTLET.x0; x <= OUTLET.x1; x++) {
        const c = this.grid[gridIdx(x, y)];
        if (isSand(c)) exposedColors.add(c as SandColorId);
      }
      if (y <= OUTLET.y0 && exposedColors.size > 0) break;
    }

    // 独立伪随机洗牌（不干扰主物理确定性流 rng）
    const localRng = mulberry32(
      (this.frame * 2654435761 + (this.shuffleUsedCount + 1) * 1013904223 + pool.length * 7919) >>> 0
    );
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(localRng() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }

    // 保底：优先把一只「未冰封 + 颜色匹配滤网底沙 + 尚未在卡槽中」的木桶置顶到第 0 列排头
    const activeColors = new Set(this.bucketSys.active.map(b => b.color));
    let rescueIdx = pool.findIndex(
      b => b.iceLayers === 0 && exposedColors.has(b.color) && !activeColors.has(b.color)
    );
    if (rescueIdx < 0) {
      rescueIdx = pool.findIndex(b => b.iceLayers === 0 && exposedColors.has(b.color));
    }
    if (rescueIdx < 0) {
      rescueIdx = pool.findIndex(b => b.iceLayers === 0);
    }
    if (rescueIdx > 0) {
      const [rescued] = pool.splice(rescueIdx, 1);
      pool.unshift(rescued);
    }

    const numCols = this.bucketSys.numCols;
    this.bucketSys.columns = Array.from({ length: numCols }, () => []);
    pool.forEach((bk, idx) => {
      const colIdx = idx % numCols;
      bk.col = colIdx;
      const isNewFront = this.bucketSys.columns[colIdx].length === 0;
      this.bucketSys.columns[colIdx].push(bk);
      if (isNewFront && bk.mystery && !bk.mysteryRevealed) {
        bk.mysteryRevealed = true;
        bk.revealAnimMs = 380;
        this.callbacks.onMysteryReveal?.(bk.idx, colIdx, bk.color);
      }
    });

    this.shuffleUsedCount++;
    this.shuffleAnimMs = 380;
    this.bucketSys.clogFrames = 0;
    this.setClogAndDeadlock(false, false);
    return true;
  }

  private hasPendingIceOrDyeForColor(color: SandColorId): boolean {
    for (const ic of this.ice) {
      if (!ic.shattered && ic.color === color) return true;
    }
    for (const ring of this.dyeRings) {
      if (ring.toColor !== color) continue;
      for (let y = 6; y <= Math.min(GH - 2, ring.y1 + 2); y++) {
        for (let x = 1; x < GW - 1; x++) {
          const c = this.grid[gridIdx(x, y)];
          if (isSand(c) && c !== color && c !== GOLD_SAND) return true;
        }
      }
    }
    return false;
  }

  private handleSweepResult(res: {
    completedBucket: { idx: number };
    unlockedColor: SandColorId;
    sweptCells: { cellIdx: number; color: number }[];
    thawedBuckets: { idx: number }[];
  }): void {
    this.callbacks.onBucketFull?.(res.completedBucket.idx, res.unlockedColor, res.sweptCells);
    if (res.thawedBuckets.length > 0) {
      this.callbacks.onBucketIceCrack?.(res.thawedBuckets.map(b => b.idx));
    }
    for (const bd of this.boards) {
      if (!bd.removed && bd.lockColor === res.unlockedColor) {
        this.pullBoard(bd.id, true);
      }
    }
  }

  private checkWinCondition(): void {
    if (!this.won && this.bucketSys.allDone()) {
      for (let i = 0; i < TOTAL_CELLS; i++) {
        if (isSand(this.grid[i])) {
          this.grid[i] = EMPTY;
          this.tag[i] = 0;
          this.vel[i] = 0;
          this.bucketSys.residueRemoved++;
        }
      }
      this.won = true;
      this.callbacks.onWin?.();
    }
  }

  public updateVisualTimers(dtMs: number): void {
    if (this.screenShakeMs > 0) this.screenShakeMs = Math.max(0, this.screenShakeMs - dtMs);
    if (this.vacuumAnimMs > 0) this.vacuumAnimMs = Math.max(0, this.vacuumAnimMs - dtMs);
    if (this.shuffleAnimMs > 0) this.shuffleAnimMs = Math.max(0, this.shuffleAnimMs - dtMs);
    if (this.pourStreamMs > 0) this.pourStreamMs = Math.max(0, this.pourStreamMs - dtMs);
    for (let s = 0; s < 5; s++) {
      if (this.slotPourMs[s] > 0) this.slotPourMs[s] = Math.max(0, this.slotPourMs[s] - dtMs);
    }
    for (const bk of this.bucketSys.buckets) {
      if (bk.iceShakeMs > 0) bk.iceShakeMs = Math.max(0, bk.iceShakeMs - dtMs);
      if (bk.revealAnimMs > 0) bk.revealAnimMs = Math.max(0, bk.revealAnimMs - dtMs);
    }
    for (const b of this.boards) {
      if (b.pullAnimMs > 0) b.pullAnimMs = Math.max(0, b.pullAnimMs - dtMs);
      if (b.pushAnimMs > 0) b.pushAnimMs = Math.max(0, b.pushAnimMs - dtMs);
      if (b.lockShakeMs > 0) b.lockShakeMs = Math.max(0, b.lockShakeMs - dtMs);
    }
  }

  /**
   * 固定步长 60Hz 单帧推进（严格对齐 tools/lib/sim.js）
   */
  public step(
    nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  ): number {
    if (this.won) return 0;
    this.frame++;
    let activity = 0;
    const g = this.grid;
    const tag = this.tag;
    const shade = this.shade;

    // 1. 宽底原木滤网均匀吸沙（互质步长全域均匀采样，消除左右偏吸造成的竖向剪切条纹；单帧上限 42 粒）
    let drained = 0;
    let drainedSlotMask = 0;
    const maxDrain = 42;
    const outletW = OUTLET.x1 - OUTLET.x0 + 1; // 106 (gcd(29, 106) === 1)
    const slotSumX = [0, 0, 0, 0, 0];
    const slotCnt = [0, 0, 0, 0, 0];
    if (this.bucketSys.occupiedSlotCount > 0) {
      for (let y = OUTLET.y1; y >= OUTLET.y0 && drained < maxDrain; y--) {
        const startOff = (this.frame * 37 + y * 53) % outletW;
        for (let k = 0; k < outletW && drained < maxDrain; k++) {
          const x = OUTLET.x0 + ((startOff + k * 29) % outletW);
          const i = gridIdx(x, y);
          const c = g[i];
          if (!isSand(c)) continue;

          const ownerIdx = tag[i] > 0 ? tag[i] - 1 : -1;
          const target = this.bucketSys.findReceivingBucket(c as SandColorId, ownerIdx);
          if (!target || target.done) continue;

          if (c === GOLD_SAND && target.color !== GOLD_SAND && ownerIdx >= 0 && ownerIdx !== target.idx) {
            const owner = this.bucketSys.buckets[ownerIdx];
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
          slotSumX[slotIdx] += x;
          slotCnt[slotIdx]++;

          const visColor = (c === GOLD_SAND ? GOLD_SAND : target.color) as SandColorId;
          this.pourStreamColor = visColor;
          this.pourStreamSlot = slotIdx;
          this.pourStreamMs = 200;
          this.slotPourColor[slotIdx] = visColor;

          if (drained % 8 === 1) {
            this.callbacks.onDrainParticle?.(x, y, slotIdx, target.color, c === GOLD_SAND);
          }
          this.bucketSys.notifyStepNoteIfCrossed(target, step =>
            this.callbacks.onBucketStepFill?.(step)
          );

          if (target.cur >= target.max) {
            const res = this.bucketSys.completeBucket(target, nowMs, []);
            this.handleSweepResult(res);
          }
        }
      }
      for (let s = 0; s < 5; s++) {
        if (slotCnt[s] > 0) {
          const avgX = slotSumX[s] / slotCnt[s];
          this.slotPourX[s] = this.slotPourMs[s] > 0 ? this.slotPourX[s] * 0.86 + avgX * 0.14 : avgX;
          this.slotPourMs[s] = 200;
        }
      }
    }
    activity += drained;

    // 1a. 更新未吸到沙的在槽木桶空闲帧，并执行 1:1 严格守恒尾沙吸附补满
    for (const bk of this.bucketSys.active) {
      if ((drainedSlotMask & (1 << bk.slotIdx)) === 0) {
        bk.idleDrainFrames++;
      }
    }
    const isChamberSettled =
      drained === 0 &&
      this.lastMovedParticles === 0 &&
      !this.boards.some(bd => bd.release !== null) &&
      !this.ice.some(ic => !ic.shattered && ic.moving);
    const tailSweeps = this.bucketSys.checkIdleTailSweeps(
      g,
      tag,
      color => this.hasPendingIceOrDyeForColor(color),
      isChamberSettled,
      nowMs
    );
    for (const res of tailSweeps) {
      activity += res.sweptCells.length + 1;
      this.handleSweepResult(res);
    }

    // 1b. 抽板渐进释放（木板从远端向拉手端逐段抽离，沙体随之由远及近塌落）
    activity += this.advanceBoardRelease();

    // 2. 速度场流沙元胞自动机（每帧 2 子步，奇偶帧交替扫描方向；严格对齐 tools/lib/sim.js）
    //    · 层流沉降：厚沙堆内部初动颗粒首步平稳下沉 1 格，彻底消除底滤吸沙在沙堆内撕出竖向空腔白条
    //    · 悬空加速：自由落体采用二维去相关抖动加速，无列周期条纹
    //    · 双侧滑落：着陆冲击保留斜坡与双侧浅安息角连续扩散，堆出自然圆润沙丘
    let movedParticles = 0;
    let airborne = 0;
    const vel = this.vel;
    const dye = this.dye;
    const dyeFrom = this.dyeFrom;
    const impactBuf = this.impactBuf;
    const step1 = (from: number, to: number, col: number): number => {
      let nc = col;
      const dt = dye[to];
      if (dt && col !== GOLD_SAND && col !== dt && (!dyeFrom[to] || (dyeFrom[to] & (1 << col)) !== 0)) {
        nc = dt;
        if (movedParticles % 16 === 0) {
          this.callbacks.onDyePass?.(to % GW, (to / GW) | 0, dt as SandColorId);
        }
      }
      g[to] = nc;
      tag[to] = tag[from];
      shade[to] = shade[from];
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
          const i = gridIdx(x, y);
          const c = g[i];
          if (!isSand(c)) continue;
          let v = vel[i];
          const b0 = i + GW;
          if (g[b0] === EMPTY) {
            let n: number;
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
            if (pass === 1 && v >= 32) airborne++;
            continue;
          }
          // 跟随：正下方是仍在自由下落的沙粒 → 原地等待并同步其速度
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

          // 纯视觉：高速着陆冲击点（不影响物理，不调用 rng）
          if (v >= V_IMPACT_FX && this.impactCount < 32 && ((x + y + this.frame) & 3) === 0) {
            const o = this.impactCount * 3;
            impactBuf[o] = x;
            impactBuf[o + 1] = y;
            impactBuf[o + 2] = c;
            this.impactCount++;
          }

          if (dd !== 0) {
            let cur = b0 + dd;
            let col = step1(i, cur, c);
            // 动量沿坡连续滑落（支持滑出斜板末端顺畅直落）
            let extra = v >= V_MOMENTUM ? Math.min(3, (v - V_INIT) >> 4) : 0;
            let nv = v - (v >> 2);
            while (extra-- > 0) {
              const downCell = cur + GW;
              if (cur + GW < TOTAL_CELLS - GW && g[downCell] === EMPTY) {
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
    this.airborneCount = airborne;
    this.lastFlowParticles = drained + Math.min(35, Math.floor(movedParticles / 35));

    // 3. 冰砖刚体下落 / 脆冰高空砸硬底碎裂(软沙缓冲不碎) / 万年寒冰流沙冲刷解冻
    for (const ic of this.ice) {
      if (ic.shattered) continue;
      const own = this.iceMark;

      // 3a. 万年寒冰：摔不碎，必须靠外缘接触的松散流沙冲刷融化
      if (ic.iceType === 'permafrost') {
        let touchingSand = 0;
        let touchingForeign = 0;
        const cells = ic.cells;
        for (let k = 0; k < cells.length; k++) own[cells[k]] = 1;
        for (let k = 0; k < cells.length; k++) {
          const idx = cells[k];
          for (let q = 0; q < 3; q++) {
            const nb = q === 0 ? idx - GW : q === 1 ? idx - 1 : idx + 1;
            if (nb < 0 || nb >= TOTAL_CELLS || own[nb]) continue;
            const c = g[nb];
            if (isSand(c)) {
              touchingSand++;
              if (c !== ic.color && c !== GOLD_SAND) touchingForeign++;
            }
          }
        }
        for (let k = 0; k < cells.length; k++) own[cells[k]] = 0;
        if (!ic.primed && touchingSand > 0) {
          ic.thawProgress = Math.min(ic.thawContacts, ic.thawProgress + touchingSand);
          activity++;
          if (ic.thawProgress >= ic.thawContacts) {
            ic.primed = true;
          }
        }
        if (ic.primed) {
          if (touchingForeign <= 3) {
            ic.clearFrames++;
            activity++;
            if (ic.clearFrames >= 8) {
              let sumX = 0;
              let maxY = 0;
              for (const idx of ic.cells) {
                g[idx] = ic.color;
                this.vel[idx] = 0;
                sumX += idx % GW;
                maxY = Math.max(maxY, (idx / GW) | 0);
              }
              ic.shattered = true;
              this.screenShakeMs = 80;
              const cx = ic.cells.length ? sumX / ic.cells.length : 75;
              this.callbacks.onIceShatter?.(cx, maxY);
              activity++;
              continue;
            }
          } else {
            ic.clearFrames = 0;
          }
        }
      }

      // 冰砖重力加速：每帧下落 floor(累计位移) 行，逐行检测碰撞（严格对齐 tools/lib/sim.js）
      let rows = 0;
      if (this.iceFree(ic)) {
        ic.vy = ic.moving ? Math.min(ICE_VMAX, ic.vy + ICE_G) : ICE_V0;
        ic.acc += ic.vy;
        let want = Math.floor(ic.acc);
        if (want < 1) want = 1;
        ic.acc -= want;
        if (ic.acc < 0) ic.acc = 0;
        while (rows < want && this.iceFree(ic)) {
          this.iceMoveDown(ic);
          rows++;
        }
      }
      if (rows > 0) {
        ic.moving = true;
        activity++;
      } else if (ic.moving) {
        ic.moving = false;
        const landVy = ic.vy;
        ic.vy = 0;
        ic.acc = 0;
        const ownNow = this.iceMark;
        for (let k = 0; k < ic.cells.length; k++) ownNow[ic.cells[k]] = 1;
        let cushionedBySand = false;
        for (const idx of ic.cells) {
          const below = idx + GW;
          if (below < TOTAL_CELLS && !ownNow[below] && g[below] !== EMPTY) {
            if (isSand(g[below]) || g[below] >= FROZEN_BASE) {
              cushionedBySand = true;
              break;
            }
          }
        }
        // 纯视觉：冰砖落地震屏 + 底缘扬尘
        if (landVy >= 1.6) {
          this.screenShakeMs = Math.max(this.screenShakeMs, 55);
          let emitted = 0;
          for (let k = 0; k < ic.cells.length && emitted < 6; k += 7) {
            const idx = ic.cells[k];
            if (ownNow[idx + GW] || this.impactCount >= 32) continue;
            const o = this.impactCount * 3;
            this.impactBuf[o] = idx % GW;
            this.impactBuf[o + 1] = (idx / GW) | 0;
            this.impactBuf[o + 2] = ic.color;
            this.impactCount++;
            emitted++;
          }
        }
        for (let k = 0; k < ic.cells.length; k++) ownNow[ic.cells[k]] = 0;
        if (ic.iceType !== 'permafrost' && !cushionedBySand && ic.fall >= ic.shatterDrop) {
          let sumX = 0;
          let maxY = 0;
          for (const idx of ic.cells) {
            g[idx] = ic.color;
            this.vel[idx] = 0;
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

    // 3b. 终局零卡关保底收尾：当全部拨片已拉开、全部冰砖已碎、候选槽已空（所有未满瓶均已在台），且全场静止 >= 28 帧时，
    //     若盘面仅剩少量静止残沙且无大面积错色污染，自动将其归入对应在槽瓶完成收尾，彻底杜绝过关前最后 1 瓶卡在界面
    this.lastMovedParticles = movedParticles;
    if (!this.bucketSys.allDone()) {
      if (drained === 0 && movedParticles === 0 && activity === 0) {
        this.endGameIdleFrames++;
      } else {
        this.endGameIdleFrames = 0;
      }

      if (
        this.endGameIdleFrames >= 28 &&
        this.bucketSys.remainingCandidateCount === 0 &&
        this.boards.every(bd => bd.removed || bd.isOpen) &&
        this.ice.every(ic => ic.shattered)
      ) {
        const activeColors = new Set(this.bucketSys.active.map(b => b.color));
        const totalMax = this.bucketSys.buckets.reduce((s, b) => s + b.max, 0);
        const remainingCells: number[] = [];
        let foreignCount = 0;
        for (let y = GH - 2; y >= 6; y--) {
          for (let x = 1; x < GW - 1; x++) {
            const i = gridIdx(x, y);
            const c = g[i];
            if (!isSand(c)) continue;
            remainingCells.push(i);
            if (c !== GOLD_SAND && !activeColors.has(c as SandColorId)) {
              foreignCount++;
            }
          }
        }
        if (
          foreignCount <= Math.max(20, Math.ceil(totalMax * 0.015)) &&
          remainingCells.length <= Math.max(180, Math.ceil(totalMax * 0.09))
        ) {
          const sweptByColor = new Map<SandColorId, { cellIdx: number; color: number }[]>();
          for (const i of remainingCells) {
            const c = g[i] as SandColorId;
            const recv = this.bucketSys.findReceivingBucket(c) || this.bucketSys.active[0];
            if (recv) {
              let arr = sweptByColor.get(recv.color);
              if (!arr) {
                arr = [];
                sweptByColor.set(recv.color, arr);
              }
              arr.push({ cellIdx: i, color: c });
            }
            g[i] = EMPTY;
            tag[i] = 0;
            this.vel[i] = 0;
            this.bucketSys.residueRemoved++;
          }
          for (const bk of [...this.bucketSys.active]) {
            if (bk.done) continue;
            const swept = sweptByColor.get(bk.color) || [];
            const res = this.bucketSys.completeBucket(bk, nowMs, swept);
            sweptByColor.delete(bk.color);
            this.handleSweepResult(res);
          }
        }
      }
    }

    // 4. 软硬两段式卡槽停滞与死局救援检测
    if (!this.bucketSys.allDone()) {
      const occupied = this.bucketSys.occupiedSlotCount;
      const hasDispatchableFront = this.bucketSys.columns.some(
        col => col.length > 0 && col[0].iceLayers === 0
      );
      const slotsBlocked = this.bucketSys.areAllSlotsFull || !hasDispatchableFront;

      if ((occupied > 0 || !hasDispatchableFront) && drained === 0 && activity === 0) {
        this.bucketSys.clogFrames++;
        let emptyGrateFloor = 0;
        const rowBase = OUTLET.y1 * GW;
        for (let x = OUTLET.x0; x <= OUTLET.x1; x++) {
          const idx = rowBase + x;
          if (this.interior[idx] && g[idx] === EMPTY) {
            emptyGrateFloor++;
          }
        }
        const hasUnlockedPin = this.boards.some(b => !b.removed && !b.lockColor);
        const canStillChangeGrate = hasUnlockedPin && emptyGrateFloor >= 4;

        if (slotsBlocked && !canStillChangeGrate && this.bucketSys.clogFrames >= 72) {
          this.setClogAndDeadlock(false, true);
        } else if (this.bucketSys.clogFrames >= 90 && !this.bucketSys.hardDeadlockActive) {
          this.setClogAndDeadlock(true, false);
        }
      } else if (drained > 0) {
        this.bucketSys.clogFrames = 0;
        this.setClogAndDeadlock(false, false);
      }
    }

    this.checkWinCondition();
    return activity;
  }

  /** 冰砖整体下方是否全部为空（或自身） */
  private iceFree(ic: IceRuntime): boolean {
    const g = this.grid;
    const own = this.iceMark;
    const cells = ic.cells;
    const n = cells.length;
    for (let k = 0; k < n; k++) own[cells[k]] = 1;
    let free = true;
    for (let k = 0; k < n; k++) {
      const below = cells[k] + GW;
      if (below >= TOTAL_CELLS || (!own[below] && g[below] !== EMPTY)) {
        free = false;
        break;
      }
    }
    for (let k = 0; k < n; k++) own[cells[k]] = 0;
    return free;
  }

  /** 冰砖整体下移 1 行 */
  private iceMoveDown(ic: IceRuntime): void {
    const g = this.grid;
    const tag = this.tag;
    const shade = this.shade;
    const cells = ic.cells;
    const n = cells.length;
    if (this.iceTmpTag.length < n) {
      this.iceTmpTag = new Uint8Array(n);
      this.iceTmpShade = new Uint8Array(n);
    }
    const tags = this.iceTmpTag;
    const shades = this.iceTmpShade;
    for (let k = 0; k < n; k++) {
      const idx = cells[k];
      tags[k] = tag[idx];
      shades[k] = shade[idx];
      g[idx] = EMPTY;
      tag[idx] = 0;
    }
    // 原地整体下移一行（零分配）
    for (let k = 0; k < n; k++) {
      const j = cells[k] + GW;
      g[j] = ic.val;
      tag[j] = tags[k];
      shade[j] = shades[k];
      cells[k] = j;
    }
    ic.fall++;
  }
}
