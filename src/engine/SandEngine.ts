import type { BlindBoxId } from '../types/blindbox';
import type {
  BoardDef,
  DyeRingDef,
  IceKind,
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
  CAP_G,
  CAP_SUBSTEP,
  CAP_V0,
  CAP_VMAX,
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
  /** 物理下落速度（格/帧，参与确定性模拟） */
  vy: number;
  /** 斜面滚动方向迟滞（参与确定性模拟，0 = 无） */
  rollDir: number;
  /** 纯视觉：滚动倾角（弧度）与落地压扁量 0..1 */
  tilt: number;
  squash: number;
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
  /** 每格竖直速度（1/16 格/子步），驱动重力加速与动量滑落 */
  public readonly vel = new Uint8Array(TOTAL_CELLS);
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
  public pourStreamColor: SandColorId | 0 = 0;
  public pourStreamSlot = 0;
  public pourStreamMs = 0;

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
    this.vel.fill(0);
    this.impactCount = 0;
    this.airborneCount = 0;

    this.frame = 0;
    this.won = false;
    this.lastFlowParticles = 0;
    this.screenShakeMs = 0;
    this.vacuumAnimMs = 0;
    this.vacuumUsedCount = 0;
    this.boardsPulledCount = 0;
    this.pourStreamColor = 0;
    this.pourStreamSlot = 0;
    this.pourStreamMs = 0;
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
      vy: 0,
      rollDir: 0,
      tilt: 0,
      squash: 0,
    }));
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

      // 兼容点击箱内垂挂的「抽」字木牌区域
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
        // 同一列的木板格同帧整列抽离（避免半列残留导致侧向挤入、逐粒滴落）
        if (b.releasePtr === target && target < b.release.length && b.release[target] % GW === i % GW) target++;
      }
      act++;
      if (b.releasePtr >= b.release.length) b.release = null;
    }
    return act;
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

  public undo(): boolean {
    const snap = this.snapshots.pop();
    if (!snap) return false;

    const keepDualSlot = this.bucketSys.maxActiveSlots;

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
        // 清除快照中可能残留的已抽离木板格
        if (target.removed || target.isOpen) {
          for (let i = 0; i < TOTAL_CELLS; i++) {
            if (this.grid[i] === target.val) this.grid[i] = EMPTY;
          }
        }
      }
    }

    this.ice = snap.ice.map(ic => ({ ...ic, cells: [...ic.cells], vy: 0, acc: 0 }));
    this.capsules = snap.capsules.map(c => ({
      ...c,
      flyStartX: c.x,
      flyStartY: c.y,
      flyProgressMs: 0,
      vy: 0,
      rollDir: 0,
      tilt: 0,
      squash: 0,
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

    this.pourStreamMs = 0;
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
  public useVacuum(
    nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  ): number {
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
          this.vel[idx] = 0;
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
          this.vel[i] = 0;
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
    if (this.pourStreamMs > 0) this.pourStreamMs = Math.max(0, this.pourStreamMs - dtMs);
    for (const b of this.boards) {
      if (b.pullAnimMs > 0) b.pullAnimMs = Math.max(0, b.pullAnimMs - dtMs);
      if (b.pushAnimMs > 0) b.pushAnimMs = Math.max(0, b.pushAnimMs - dtMs);
      if (b.lockShakeMs > 0) b.lockShakeMs = Math.max(0, b.lockShakeMs - dtMs);
    }
    for (const c of this.capsules) {
      if (c.squash > 0) c.squash = Math.max(0, c.squash - dtMs / 160);
      if (c.collected && c.flyProgressMs > 0 && c.flyProgressMs < 400) {
        c.flyProgressMs = Math.min(400, c.flyProgressMs + dtMs);
      }
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
          this.vel[i] = 0;
          drained++;
          target.cur++;
          this.pourStreamColor = (c === GOLD_SAND ? GOLD_SAND : target.color) as SandColorId;
          this.pourStreamSlot = slotIdx;
          this.pourStreamMs = 150;

          if (drained % 5 === 1) {
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

    // 检测是否有未碎冰砖楔死在底部漏斗咽喉 (y >= 138)
    if (!wrongAtOutlet && drained === 0) {
      for (const ic of this.ice) {
        if (ic.shattered || ic.moving || ic.primed) continue;
        for (const idx of ic.cells) {
          const y = (idx / GW) | 0;
          const x = idx % GW;
          if (y >= 138 && x >= 44 && x <= 105) {
            wrongAtOutlet = true;
            break;
          }
        }
        if (wrongAtOutlet) break;
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

    // 1b. 抽板渐进释放（木板从远端向拉手端逐段抽离，沙体随之由远及近塌落）
    activity += this.advanceBoardRelease();

    // 2. 速度场流沙元胞自动机（每帧 2 子步，奇偶帧交替扫描方向；严格对齐 tools/lib/sim.js）
    //    · 悬空：每格携带竖直速度 vel，重力加速 V_INIT → V_MAX，每子步可连续下落多格（逐格检测绝不穿透）
    //    · 着陆：高速颗粒保留动量沿斜面连续滑落（仅进入原规则同样允许的斜下空位），随后衰减归零
    //    · 跟随：正下方是仍在下落的沙粒时原地等待并同步速度，下落沙体保持整体不被侧向回填撕裂
    //    · rng 仅在正下方受阻（且非跟随等待）时调用 1 次；与 tools/lib/sim.js 严格一致，保持 20 关确定性
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
            v = v < V_INIT ? V_INIT : Math.min(V_MAX, v + V_GRAV);
            let n = (v + ((this.frame + pass * 8 + x) & 15)) >> 4;
            if (n < 1) n = 1;
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
          // 跟随：正下方是仍在自由下落的沙粒 → 原地等待并同步其速度（自由落体中不横向散开，
          // 避免同排斜向回填级联导致下落沙体被撕成“剥落横纹”）
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
            // 动量沿坡连续滑落
            let extra = v >= V_MOMENTUM ? Math.min(3, (v - V_INIT) >> 4) : 0;
            let nv = v - (v >> 2);
            while (extra-- > 0) {
              const nb = cur + GW + dd;
              const cx = cur % GW;
              if (cx + dd <= 0 || cx + dd >= GW - 1 || g[nb] !== EMPTY) break;
              col = step1(cur, nb, col);
              cur = nb;
              nv -= nv >> 2;
            }
            vel[cur] = nv;
          } else {
            const nx = x + d1 * 2;
            if (nx > 0 && nx < GW - 1 && g[i + d1] === EMPTY && g[b0 + d1 * 2] === EMPTY) {
              const j = b0 + d1 * 2;
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
      const own = new Set(ic.cells);

      // 3a. 万年寒冰：摔不碎，必须靠外缘接触的松散流沙冲刷融化
      if (ic.iceType === 'permafrost') {
        let touchingSand = 0;
        let touchingForeign = 0;
        for (const idx of ic.cells) {
          const nbs = [idx - GW, idx - 1, idx + 1];
          for (const nb of nbs) {
            if (nb < 0 || nb >= TOTAL_CELLS || own.has(nb)) continue;
            const c = g[nb];
            if (isSand(c)) {
              touchingSand++;
              if (c !== ic.color && c !== GOLD_SAND) touchingForeign++;
            }
          }
        }
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
        const ownNow = new Set(ic.cells);
        let cushionedBySand = false;
        for (const idx of ic.cells) {
          const below = idx + GW;
          if (below < TOTAL_CELLS && !ownNow.has(below) && g[below] !== EMPTY) {
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
            if (ownNow.has(idx + GW) || this.impactCount >= 32) continue;
            const o = this.impactCount * 3;
            this.impactBuf[o] = idx % GW;
            this.impactBuf[o + 1] = (idx / GW) | 0;
            this.impactBuf[o + 2] = ic.color;
            this.impactCount++;
            emitted++;
          }
        }
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

    // 4. 盲盒胶囊重力加速下落与斜面滚动（严格对齐 tools/lib/sim.js）
    for (const cap of this.capsules) {
      if (cap.collected) continue;
      const gx = Math.round(cap.x);
      const gy = Math.round(cap.y);
      const prevX = cap.x;
      const prevY = cap.y;
      const prevVy = cap.vy;

      if (this.capsuleClear(gx, gy + 1, cap.r)) {
        cap.vy = Math.min(CAP_VMAX, Math.max(CAP_V0, cap.vy + CAP_G));
        cap.rollDir = 0;
        let rem = cap.vy;
        while (rem > 0) {
          if (!this.capsuleClear(Math.round(cap.x), Math.round(cap.y) + 1, cap.r)) break;
          const d = rem < CAP_SUBSTEP ? rem : CAP_SUBSTEP;
          cap.y += d;
          rem -= d;
        }
      } else {
        cap.vy = 0;
        const tc = cap.x < GW / 2 ? 1 : -1;
        if (this.capsuleClear(gx + tc, gy + 1, cap.r)) {
          cap.x += tc * 0.9;
          cap.y += 0.9;
          cap.rollDir = 0;
        } else if (this.capsuleClear(gx - tc, gy + 1, cap.r)) {
          cap.x -= tc * 0.9;
          cap.y += 0.9;
          cap.rollDir = 0;
        } else {
          const [lh, rh] = this.supportBalance(gx, gy, cap.r);
          if (lh !== rh) {
            const d = lh > rh ? 1 : -1;
            // 滚动迟滞：一旦出现反向滚动即视为落稳（防止在两格之间无限来回抖动）
            if (!cap.rollDir || cap.rollDir === d) {
              if (this.capsuleClear(gx + d, gy, cap.r)) {
                cap.x += d * 0.7;
                cap.rollDir = d;
              }
            }
          }
        }
      }

      // 纯视觉：沿滚动方向倾斜、落地压扁回弹
      const dxMove = cap.x - prevX;
      const tiltTarget = Math.max(-0.42, Math.min(0.42, dxMove * 0.55));
      cap.tilt += (tiltTarget - cap.tilt) * (dxMove !== 0 ? 0.35 : 0.12);
      if (prevVy >= 1.6 && cap.vy === 0) {
        cap.squash = Math.min(1, prevVy / CAP_VMAX + 0.25);
        this.screenShakeMs = Math.max(this.screenShakeMs, 35);
      }

      if (cap.x !== prevX || cap.y !== prevY) activity++;
      if (cap.y >= CAPSULE_COLLECT_Y) {
        this.collectCapsule(cap, true);
      }
    }

    this.checkWinCondition();
    return activity;
  }

  /** 冰砖整体下方是否全部为空（或自身） */
  private iceFree(ic: IceRuntime): boolean {
    const g = this.grid;
    const own = new Set(ic.cells);
    for (const idx of ic.cells) {
      const below = idx + GW;
      if (below >= TOTAL_CELLS || (!own.has(below) && g[below] !== EMPTY)) return false;
    }
    return true;
  }

  /** 冰砖整体下移 1 行 */
  private iceMoveDown(ic: IceRuntime): void {
    const g = this.grid;
    const tag = this.tag;
    const shade = this.shade;
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
