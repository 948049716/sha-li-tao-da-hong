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
  V_CHUTE_MAX,
  V_GRAV,
  V_IMPACT_FX,
  V_INIT,
  V_MAX,
  V_MOMENTUM,
  V_SPLASH,
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

/** 预计算网格 X/Y 坐标查表（消除物理内循环取模与整除开销） */
const CELL_X = new Uint8Array(TOTAL_CELLS);
const CELL_Y = new Uint8Array(TOTAL_CELLS);
for (let i = 0; i < TOTAL_CELLS; i++) {
  CELL_X[i] = i % GW;
  CELL_Y[i] = (i / GW) | 0;
}

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
  /** 斜导流木板与漏斗斜壁切向下坡方向引导表（-1=左下坡, 0=无斜率, 1=右下坡） */
  public readonly slopeDir = new Int8Array(TOTAL_CELLS);
  /** 活跃行休眠掩码（静止行 0 开销跳过，运动/吸沙/抽板时自动唤醒邻行） */
  private readonly rowAwake = new Uint8Array(GH);
  private readonly nextRowAwake = new Uint8Array(GH);
  /** 渲染脏版本号与累计变动行区间（取代渲染层每帧 18KB 数组全扫比对） */
  public visualRevision = 1;
  private renderDirtyMinY = 0;
  private renderDirtyMaxY = GH - 1;
  /** 冰砖自身格标记与零 GC 排沙缓冲（用后立即清零） */
  private readonly iceMark = new Uint8Array(TOTAL_CELLS);
  private iceTmpTag = new Uint8Array(256);
  private iceTmpShade = new Uint8Array(256);
  private readonly iceSandSrc = new Int32Array(64);
  private readonly iceSandDst = new Int32Array(64);
  private readonly bfsQueue = new Int32Array(1024);
  private readonly bfsSeen = new Uint8Array(TOTAL_CELLS);
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

  public wakeRows(y0: number, y1: number): void {
    const a = y0 <= 7 ? 5 : y0 - 2;
    const b = y1 >= GH - 4 ? GH - 2 : y1 + 2;
    for (let y = a; y <= b; y++) {
      this.rowAwake[y] = 1;
      this.nextRowAwake[y] = 1;
    }
    if (a < this.renderDirtyMinY) this.renderDirtyMinY = a;
    if (b > this.renderDirtyMaxY) this.renderDirtyMaxY = b;
  }

  public wakeAllRows(): void {
    this.rowAwake.fill(1);
    this.nextRowAwake.fill(1);
    this.renderDirtyMinY = 0;
    this.renderDirtyMaxY = GH - 1;
  }

  public consumeRenderDirtyRange(): [number, number] {
    const y0 = this.renderDirtyMinY;
    const y1 = this.renderDirtyMaxY;
    this.renderDirtyMinY = GH;
    this.renderDirtyMaxY = -1;
    return [y0, y1];
  }

  /** 构建斜导流木板与漏斗斜壁切向下坡方向引导场（与 tools/lib/sim.js 严格对齐） */
  public rebuildSlopeGuide(): void {
    const sd = this.slopeDir;
    sd.fill(0);
    const markSeg = (x0: number, y0: number, x1: number, y1: number, th: number): void => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (Math.abs(dx) <= 1 || Math.abs(dy) <= 1) return;
      const dir = dx * dy > 0 ? 1 : -1;
      stampLine(x0, y0, x1, y1, th + 1, (rx, ry) => {
        sd[ry * GW + rx] = dir;
      });
    };
    if (this.vessel) {
      for (const poly of this.vessel.walls) {
        for (let i = 0; i < poly.points.length - 1; i++) {
          const [ax, ay] = poly.points[i];
          const [bx, by] = poly.points[i + 1];
          markSeg(ax, ay, bx, by, poly.thickness);
        }
      }
    }
    if (this.level) {
      for (const w of this.level.staticWalls || []) {
        markSeg(w.x0, w.y0, w.x1, w.y1, w.thickness ?? 2);
      }
    }
    for (const b of this.boards) {
      if (!b.removed && !b.isOpen) {
        markSeg(b.x0, b.y0, b.x1, b.y1, 2);
      }
    }
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
    this.rebuildSlopeGuide();
    this.wakeAllRows();
    this.settleInitialState();
  }

  /**
   * 开局静默预沉降：在首帧渲染与玩家交互前将各仓流沙自然沉降至稳定安息角，
   * 杜绝进入关卡未操作时出现空中落沙、侧向塌方与误触白噪音（与 tools/lib/sim.js 严格同源对齐）。
   */
  public settleInitialState(maxFrames = 360): void {
    const savedCb = this.callbacks;
    this.callbacks = {};
    this.wakeAllRows();
    try {
      let idle = 0;
      for (let f = 0; f < maxFrames; f++) {
        if (idle === 1) this.wakeAllRows(); // 全图复核扫描，100% 确保无任何遗漏未稳颗粒
        const act = this.step(0);
        idle = act === 0 ? idle + 1 : 0;
        if (idle >= 6) break;
      }
    } finally {
      this.callbacks = savedCb;
    }
    this.frame = 0;
    this.vel.fill(0);
    this.rowAwake.fill(0);
    this.nextRowAwake.fill(0);
    this.renderDirtyMinY = 0;
    this.renderDirtyMaxY = GH - 1;
    this.visualRevision++;
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
    let changed = false;
    for (const b of this.boards) {
      if (!b.release) continue;
      const g = this.grid;
      for (let k = b.releasePtr; k < b.release.length; k++) {
        const i = b.release[k];
        if (g[i] === b.val) {
          g[i] = EMPTY;
          this.wakeRows(CELL_Y[i], CELL_Y[i]);
          changed = true;
        }
      }
      b.release = null;
    }
    if (changed) this.visualRevision++;
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

  /**
   * 关门安全排沙：沿连通内腔射线/近邻挤开流沙，严禁穿越 WALL/其他木板，严守 1:1 颗粒守恒不吞沙
   */
  private displaceSandConnected(startIdx: number, gateVal: number): number {
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

    // 若竖直方向被沙堆填满，局部连通 BFS 搜索最近空位（绝不穿墙、绝不吞沙）
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

  private closeGateInGrid(b: BoardRuntime): void {
    const g = this.grid;
    const tag = this.tag;
    const shade = this.shade;
    const vel = this.vel;
    b.release = null;
    let minY = GH;
    let maxY = 0;
    stampLine(b.x0, b.y0, b.x1, b.y1, 2, (x, y) => {
      const i = gridIdx(x, y);
      if (!this.interior[i] || g[i] === WALL || g[i] === b.val) return;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (isSand(g[i])) {
        const dest = this.displaceSandConnected(i, b.val);
        if (dest >= 0) {
          g[dest] = g[i];
          tag[dest] = tag[i];
          shade[dest] = shade[i];
          vel[dest] = 0;
          const dy = CELL_Y[dest];
          if (dy < minY) minY = dy;
          if (dy > maxY) maxY = dy;
          g[i] = b.val;
          tag[i] = 0;
          vel[i] = 0;
        }
        return;
      }
      if (g[i] === EMPTY) {
        g[i] = b.val;
        vel[i] = 0;
      }
    });
    if (maxY >= minY) {
      this.wakeRows(minY, maxY);
      this.visualRevision++;
    }
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
    this.rebuildSlopeGuide();

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
    this.bucketSys.markDirty();
    this.bucketSys.clogFrames = 0;
    this.setClogAndDeadlock(false, false);

    this.rebuildSlopeGuide();
    this.wakeAllRows();
    this.visualRevision++;
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
          sumX += CELL_X[idx];
          maxY = Math.max(maxY, CELL_Y[idx]);
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
        CELL_X[cell],
        CELL_Y[cell],
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
    this.wakeAllRows();
    this.visualRevision++;
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
      this.wakeAllRows();
      this.visualRevision++;
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
    let velDecayed = false;
    const g = this.grid;
    const tag = this.tag;
    const shade = this.shade;
    const vel = this.vel;
    const slopeDir = this.slopeDir;
    const rowAwake = this.rowAwake;
    const nextRowAwake = this.nextRowAwake;

    // 1. 宽底原木滤网均匀吸沙（O(1) 颜色位掩码过滤 + 互质步长全域采样；单帧上限 42 粒）
    let drained = 0;
    let drainedSlotMask = 0;
    const maxDrain = 42;
    const outletW = OUTLET.x1 - OUTLET.x0 + 1; // 106 (gcd(29, 106) === 1)
    const slotSumX = [0, 0, 0, 0, 0];
    const slotCnt = [0, 0, 0, 0, 0];
    if (this.bucketSys.occupiedSlotCount > 0) {
      let recvMask = this.bucketSys.receivableMask;
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
          vel[i] = 0;
          drained++;
          rowDrained = true;
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
            recvMask = this.bucketSys.receivableMask;
            if (recvMask === 0) break;
          }
        }
        if (rowDrained) this.wakeRows(y - 1, y);
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
      for (const sc of res.sweptCells) {
        vel[sc.cellIdx] = 0;
        const sy = CELL_Y[sc.cellIdx];
        this.wakeRows(sy, sy);
      }
      activity += res.sweptCells.length + 1;
      this.handleSweepResult(res);
    }

    // 1b. 抽板渐进释放（木板从远端向拉手端逐段抽离，沙体随之由远及近塌落）
    activity += this.advanceBoardRelease();

    // 2. 真实感散体速度场元胞自动机（每帧 2 子步，活跃行带剪枝，严格对齐 tools/lib/sim.js）
    //    · 散体松动波与 V 型下陷锥：初动沙层引入微相位剪切竞争，消除刚体方砖平移与垂直激光井
    //    · 子步碰撞偏转与平底飞溅：高速落沙触底即时转化为斜向偏转或同层横向飞溅，杜绝触底粘死与竖直僵停柱
    //    · 光滑斜板导流：沿斜木板/漏斗壁顺下坡加速滑行并平滑跨越像素台阶，末端带抛射弧线
    //    · 扫掠路径防穿墙：马步滑落严格校验中间格通畅并完整触发染色环
    let movedParticles = 0;
    let airborne = 0;
    const dye = this.dye;
    const dyeFrom = this.dyeFrom;
    const impactBuf = this.impactBuf;
    let dirtyMinY = this.renderDirtyMinY;
    let dirtyMaxY = this.renderDirtyMaxY;

    const dyeAt = (cell: number, col: number): number => {
      const dt = dye[cell];
      if (dt && col !== GOLD_SAND && col !== dt && (!dyeFrom[cell] || (dyeFrom[cell] & (1 << col)) !== 0)) {
        if ((movedParticles & 15) === 0) {
          this.callbacks.onDyePass?.(CELL_X[cell], CELL_Y[cell], dt as SandColorId);
        }
        return dt;
      }
      return col;
    };

    const keepCellAwake = (cell: number): void => {
      const cy = CELL_Y[cell];
      const y0 = cy > 6 ? cy - 1 : 5;
      const y1 = cy + 1 < GH - 2 ? cy + 1 : GH - 2;
      rowAwake[y0] = 1;
      nextRowAwake[y0] = 1;
      nextRowAwake[cy] = 1;
      nextRowAwake[y1] = 1;
      if (y0 < dirtyMinY) dirtyMinY = y0;
      if (y1 > dirtyMaxY) dirtyMaxY = y1;
    };

    const step1 = (from: number, to: number, col: number): number => {
      const nc = dyeAt(to, col);
      g[to] = nc;
      tag[to] = tag[from];
      shade[to] = shade[from];
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
      if (y0 < dirtyMinY) dirtyMinY = y0;
      if (y1 > dirtyMaxY) dirtyMaxY = y1;
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

          // ---- 分支 A：正下方为空（自由落体 + 散体松动剪切 + 中途触障偏转/飞溅） ----
          if (g[b0] === EMPTY) {
            let n: number;
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
                // 散体松动波：25% 初动颗粒先松动预热 1 子步，让左右邻格斜向坍塌汇入，形成自然漏斗下陷锥并消除刚体方砖瞬移
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
              // 子步中途触碰障碍：区分「追上运动沙团」与「真实碰撞硬面/静止沙堆」
              const nb = cur + GW;
              if (nb < TOTAL_CELLS - GW && isSand(g[nb]) && vel[nb] >= V_INIT) {
                vel[cur] = vel[nb];
                keepCellAwake(cur);
                continue;
              }

              const cx = CELL_X[cur];
              const cy = CELL_Y[cur];
              if (v >= V_IMPACT_FX && this.impactCount < 32 && ((cx + cy + this.frame) & 3) === 0) {
                const o = this.impactCount * 3;
                impactBuf[o] = cx;
                impactBuf[o + 1] = cy;
                impactBuf[o + 2] = col;
                this.impactCount++;
              }

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
                  velDecayed = true;
                }
              } else {
                vel[cur] = 0;
                velDecayed = true;
              }
              continue;
            }

            vel[cur] = v;
            keepCellAwake(cur);
            if (pass === 1 && v >= 32) airborne++;
            continue;
          }

          // ---- 分支 B：正下方是悬空自由下落的沙团 → 同速跟落（触底沙粒不阻塞上方横向散开） ----
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

          if (v >= V_IMPACT_FX && this.impactCount < 32 && ((x + y + this.frame) & 3) === 0) {
            const o = this.impactCount * 3;
            impactBuf[o] = x;
            impactBuf[o + 1] = y;
            impactBuf[o + 2] = c;
            this.impactCount++;
          }

          // ---- 分支 C：接触滑移、斜板顺坡导流、扫掠防穿墙与双态安息角 ----
          const sd = slopeDir[b0] || slopeDir[i];
          const bLEmpty = x > 1 && g[b0 - 1] === EMPTY && !(g[b0] >= WALL && g[i - 1] >= WALL);
          const bREmpty = x < GW - 2 && g[b0 + 1] === EMPTY && !(g[b0] >= WALL && g[i + 1] >= WALL);
          const allow2 = v >= 8 || y >= GH - 26 || sd !== 0;

          if (!bLEmpty && !bREmpty) {
            if (!allow2 && v < V_SPLASH) {
              if (v !== 0) {
                vel[i] = 0;
                velDecayed = true;
                if (y < dirtyMinY) dirtyMinY = y;
                if (y > dirtyMaxY) dirtyMaxY = y;
              }
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
              if (v !== 0) {
                vel[i] = 0;
                velDecayed = true;
                if (y < dirtyMinY) dirtyMinY = y;
                if (y > dirtyMaxY) dirtyMaxY = y;
              }
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
            if (v !== 0) velDecayed = true;
            continue;
          }

          // 至少一侧 45° 斜下为空
          const d1 = sd !== 0 ? sd : bLEmpty !== bREmpty ? (bLEmpty ? -1 : 1) : this.rng() < 0.5 ? -1 : 1;
          const d2 = -d1;
          const dd = (d1 === -1 ? bLEmpty : bREmpty) ? d1 : d2;

          let cur = b0 + dd;
          let col = step1(i, cur, c);
          if (g[cur + GW] === EMPTY) {
            // 斜板末端抛射弧线：沿斜导流板高速滑出悬崖时保持切向水平前冲一步
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

          // 沿斜木板/漏斗壁或沙坡连续动量滑行
          const underCur = cur + GW;
          const onChute =
            underCur < TOTAL_CELLS && !isSand(g[underCur]) && (slopeDir[underCur] === dd || sd === dd);
          let nv: number;
          let extra: number;
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
    this.renderDirtyMinY = dirtyMinY;
    this.renderDirtyMaxY = dirtyMaxY;
    this.airborneCount = airborne;
    this.lastFlowParticles = drained + Math.min(35, Math.floor(movedParticles / 35));

    // 3. 冰砖刚体下落（重物排开零星浮沙） / 脆冰砸硬底碎裂（厚沙床缓冲不碎） / 万年寒冰冲刷解冻
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
              let minY = GH;
              let maxY = 0;
              for (const idx of ic.cells) {
                g[idx] = ic.color;
                vel[idx] = 0;
                sumX += CELL_X[idx];
                const cy = CELL_Y[idx];
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;
              }
              ic.shattered = true;
              this.wakeRows(minY, maxY);
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

      // 冰砖重力加速与重物排沙下落（严格对齐 tools/lib/sim.js）
      let rows = 0;
      const prevVy = ic.vy;
      const nextVy = ic.moving ? Math.min(ICE_VMAX, ic.vy + ICE_G) : ICE_V0;
      const nextAcc = ic.acc + nextVy;
      let want = Math.floor(nextAcc);
      if (want < 1) want = 1;

      while (rows < want) {
        const stepped = this.iceTryStepDown(ic);
        if (!stepped.moved) break;
        activity += stepped.displaced;
        rows++;
      }

      if (rows > 0) {
        ic.vy = nextVy;
        ic.acc = Math.max(0, nextAcc - want);
        ic.moving = true;
        activity++;
      } else if (ic.moving) {
        ic.moving = false;
        const landVy = prevVy;
        ic.vy = 0;
        ic.acc = 0;
        const ownNow = this.iceMark;
        for (let k = 0; k < ic.cells.length; k++) ownNow[ic.cells[k]] = 1;
        let sandContacts = 0;
        let hardContacts = 0;
        for (const idx of ic.cells) {
          const below = idx + GW;
          if (below >= TOTAL_CELLS) {
            hardContacts++;
            continue;
          }
          if (ownNow[below]) continue;
          const bv = g[below];
          if (bv === EMPTY) continue;
          if (isSand(bv) || bv >= FROZEN_BASE) sandContacts++;
          else hardContacts++;
        }
        const cushionedBySand = sandContacts > 0 && sandContacts >= hardContacts;

        if (landVy >= 1.6) {
          this.screenShakeMs = Math.max(this.screenShakeMs, 55);
          let emitted = 0;
          for (let k = 0; k < ic.cells.length && emitted < 6; k += 7) {
            const idx = ic.cells[k];
            if (ownNow[idx + GW] || this.impactCount >= 32) continue;
            const o = this.impactCount * 3;
            this.impactBuf[o] = CELL_X[idx];
            this.impactBuf[o + 1] = CELL_Y[idx];
            this.impactBuf[o + 2] = ic.color;
            this.impactCount++;
            emitted++;
          }
        }
        for (let k = 0; k < ic.cells.length; k++) ownNow[ic.cells[k]] = 0;
        if (ic.iceType !== 'permafrost' && !cushionedBySand && ic.fall >= ic.shatterDrop) {
          let sumX = 0;
          let minY = GH;
          let maxY = 0;
          for (const idx of ic.cells) {
            g[idx] = ic.color;
            vel[idx] = 0;
            sumX += CELL_X[idx];
            const cy = CELL_Y[idx];
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;
          }
          ic.shattered = true;
          this.wakeRows(minY, maxY);
          this.screenShakeMs = 95;
          const cx = ic.cells.length ? sumX / ic.cells.length : 75;
          this.callbacks.onIceShatter?.(cx, maxY);
          activity++;
        }
        ic.fall = 0;
      }
    }

    // 3b. 终局零卡关保底收尾
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
            vel[i] = 0;
            this.bucketSys.residueRemoved++;
          }
          for (const bk of [...this.bucketSys.active]) {
            if (bk.done) continue;
            const swept = sweptByColor.get(bk.color) || [];
            const res = this.bucketSys.completeBucket(bk, nowMs, swept);
            sweptByColor.delete(bk.color);
            this.handleSweepResult(res);
          }
          this.wakeAllRows();
          activity++;
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

    if (activity > 0 || velDecayed) {
      this.visualRevision++;
    }
    this.checkWinCondition();
    return activity;
  }

  /**
   * 尝试让冰砖下移 1 行：若底面仅接触零星松散浮沙（非密实沙床），重冰砖将浮沙向下方/两侧排开后继续顺畅下落
   */
  private iceTryStepDown(ic: IceRuntime): { moved: boolean; displaced: number } {
    const g = this.grid;
    const inter = this.interior;
    const own = this.iceMark;
    const cells = ic.cells;
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
      this.iceMoveDown(ic);
      return { moved: true, displaced: 0 };
    }

    // 若底面接触的是大面积密实沙床（超过底面宽度 28% 且 > 3 粒），作为软沙缓冲垫停住冰砖
    if (sandCnt > Math.max(3, Math.floor(bottomFace * 0.28))) {
      for (let k = 0; k < n; k++) own[cells[k]] = 0;
      return { moved: false, displaced: 0 };
    }

    // 尝试将零星浮沙向下或向底缘左右空位挤压排开（100% 严守 1:1 颗粒守恒）
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
    const shade = this.shade;
    const vel = this.vel;
    const dye = this.dye;
    const dyeFrom = this.dyeFrom;
    for (let m = 0; m < sandCnt; m++) {
      const from = srcBuf[m];
      const to = dstBuf[m];
      let col = g[from];
      const dt = dye[to];
      if (dt && col !== GOLD_SAND && col !== dt && (!dyeFrom[to] || (dyeFrom[to] & (1 << col)) !== 0)) {
        col = dt;
      }
      g[to] = col;
      tag[to] = tag[from];
      shade[to] = shade[from];
      vel[to] = V_INIT;
      g[from] = EMPTY;
      tag[from] = 0;
      vel[from] = 0;
      this.wakeRows(CELL_Y[from], CELL_Y[to]);
    }

    this.iceMoveDown(ic);
    return { moved: true, displaced: sandCnt };
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
    let minY = GH;
    let maxY = 0;
    for (let k = 0; k < n; k++) {
      const idx = cells[k];
      const cy = CELL_Y[idx];
      if (cy < minY) minY = cy;
      if (cy + 1 > maxY) maxY = cy + 1;
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
    if (maxY >= minY) this.wakeRows(minY, maxY);
  }
}
