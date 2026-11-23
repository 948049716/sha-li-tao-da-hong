import type { BucketDef, SandColorId } from '../types/level';
import {
  DEFAULT_ACTIVE_SLOTS,
  EMPTY,
  FILL_RATIO,
  GOLD_SAND,
  GW,
  GH,
  MAX_ACTIVE_SLOTS,
  isSand,
} from './SandGrid';

export interface BucketRuntime {
  idx: number;
  color: SandColorId;
  zones: string[];
  col: number;
  mystery: boolean;
  mysteryRevealed: boolean;
  iceLayers: number;
  maxIceLayers: number;
  cur: number;
  max: number;
  done: boolean;
  slotIdx: number; // -1=未上槽或已完成, 0..4=在槽索引
  placedSeq: number;
  idleDrainFrames: number;
  lastStepNotified: number; // 0..5，每 16% 触发一次五声音阶
  justCompletedAtMs: number;
  iceShakeMs: number;
  revealAnimMs: number;
}

export interface SweepResult {
  completedBucket: BucketRuntime;
  sweptCells: { cellIdx: number; color: number }[];
  unlockedColor: SandColorId;
  thawedBuckets: BucketRuntime[];
}

export interface DispatchBucketResult {
  ok: boolean;
  reason?: 'empty_col' | 'iced' | 'slots_full' | 'out_of_bounds';
  slotIdx?: number;
  bucket?: BucketRuntime;
  revealedBucket?: BucketRuntime;
}

export class BucketSystem {
  public buckets: BucketRuntime[] = [];
  public numCols = 4;
  public columns: BucketRuntime[][] = [];
  public activeSlots: (BucketRuntime | null)[] = [null, null, null, null, null];
  public maxActiveSlots = DEFAULT_ACTIVE_SLOTS;
  public placementCounter = 0;

  public clogFrames = 0;
  public clogWarningActive = false; // Stage 1 软提示条
  public hardDeadlockActive = false; // Stage 2 卡槽全满无沙可吸硬卡死救援窗
  public residueRemoved = 0;

  /** 零 GC 缓存在槽有序木桶列表与 O(1) 颜色路由表（仅在槽位状态变动时刷新，消除吸沙热路径每帧数百次 new Array + sort） */
  private activeCache: BucketRuntime[] = [];
  private colorLut = new Int16Array(6);
  private occupiedCache = 0;
  private hasUnfinishedGold = false;
  private cacheDirty = true;
  /** 当前滤网可接收沙色位掩码（bit 1..5），供物理吸沙循环单指令快速过滤不匹配底沙 */
  public receivableMask = 0;

  public markDirty(): void {
    this.cacheDirty = true;
  }

  private ensureCache(): void {
    if (!this.cacheDirty) return;
    this.cacheDirty = false;
    const list = this.activeCache;
    list.length = 0;
    for (let s = 0; s < this.maxActiveSlots; s++) {
      const bk = this.activeSlots[s];
      if (bk && !bk.done) list.push(bk);
    }
    if (list.length > 1) {
      list.sort((a, b) => a.placedSeq - b.placedSeq);
    }
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
      if (!b.done && b.color === GOLD_SAND) {
        unfinishedGold = true;
        break;
      }
    }
    this.hasUnfinishedGold = unfinishedGold;
    if (list.length > 0 && !unfinishedGold) {
      mask |= 1 << GOLD_SAND;
    }
    this.receivableMask = mask;
  }

  /** 按入槽先后（placedSeq 升序）返回当前所有在槽未满木桶，保障同色多桶时先入槽者 100% 优先吸满腾位 */
  public get active(): readonly BucketRuntime[] {
    this.ensureCache();
    return this.activeCache;
  }

  public init(
    bucketDefs: BucketDef[],
    zoneCellCounts: Record<string, number>,
    explicitNumCols?: number
  ): void {
    const inferredCols = bucketDefs.reduce((m, b, i) => Math.max(m, (b.col ?? i % 4) + 1), 3);
    this.numCols = Math.max(3, Math.min(4, explicitNumCols || inferredCols));
    this.columns = Array.from({ length: this.numCols }, () => []);
    this.activeSlots = [null, null, null, null, null];
    this.maxActiveSlots = DEFAULT_ACTIVE_SLOTS;
    this.placementCounter = 0;
    this.clogFrames = 0;
    this.clogWarningActive = false;
    this.hardDeadlockActive = false;
    this.residueRemoved = 0;

    this.buckets = bucketDefs.map((b, k) => {
      const col = Math.max(0, Math.min(this.numCols - 1, b.col ?? k % this.numCols));
      const isFront = this.columns[col].length === 0;
      const mystery = Boolean(b.mystery);
      const iceLayers = Math.max(0, Math.floor(b.iceLayers ?? 0));
      const rt: BucketRuntime = {
        idx: k,
        color: b.color,
        zones: [...b.zones],
        col,
        mystery,
        mysteryRevealed: !mystery || isFront,
        iceLayers,
        maxIceLayers: iceLayers,
        cur: 0,
        max: Math.max(1, b.zones.reduce((s, z) => s + (zoneCellCounts[z] || 0), 0)),
        done: false,
        slotIdx: -1,
        placedSeq: 0,
        idleDrainFrames: 0,
        lastStepNotified: 0,
        justCompletedAtMs: 0,
        iceShakeMs: 0,
        revealAnimMs: 0,
      };
      this.columns[col].push(rt);
      return rt;
    });
    this.cacheDirty = true;
    this.ensureCache();
  }

  public get occupiedSlotCount(): number {
    this.ensureCache();
    return this.occupiedCache;
  }

  public get areAllSlotsFull(): boolean {
    return this.occupiedSlotCount >= this.maxActiveSlots;
  }

  public get remainingCandidateCount(): number {
    let n = 0;
    for (const col of this.columns) n += col.length;
    return n;
  }

  public findFirstEmptySlot(): number {
    for (let s = 0; s < this.maxActiveSlots; s++) {
      if (!this.activeSlots[s]) return s;
    }
    return -1;
  }

  /** 从指定候选列（0..numCols-1）点选列首 row 0 木桶送入空余小卡槽 */
  public dispatchFromColumn(colIdx: number): DispatchBucketResult {
    if (colIdx < 0 || colIdx >= this.numCols) {
      return { ok: false, reason: 'out_of_bounds' };
    }
    const col = this.columns[colIdx];
    if (!col || col.length === 0) {
      return { ok: false, reason: 'empty_col' };
    }
    const front = col[0];
    if (front.iceLayers > 0) {
      front.iceShakeMs = 300;
      return { ok: false, reason: 'iced', bucket: front };
    }
    const slotIdx = this.findFirstEmptySlot();
    if (slotIdx < 0) {
      return { ok: false, reason: 'slots_full', bucket: front };
    }

    col.shift();
    front.slotIdx = slotIdx;
    front.placedSeq = ++this.placementCounter;
    front.idleDrainFrames = 0;
    this.activeSlots[slotIdx] = front;
    this.cacheDirty = true;

    let revealedBucket: BucketRuntime | undefined;
    if (col.length > 0 && !col[0].mysteryRevealed) {
      col[0].mysteryRevealed = true;
      col[0].revealAnimMs = 380;
      revealedBucket = col[0];
    }

    this.clogFrames = 0;
    this.clogWarningActive = false;
    this.hardDeadlockActive = false;

    return { ok: true, slotIdx, bucket: front, revealedBucket };
  }

  /** 根据滤网流沙颜色 O(1) 查找最先入槽的匹配木桶（零分配） */
  public findReceivingBucket(sandColor: SandColorId, ownerBucketIdx = -1): BucketRuntime | null {
    this.ensureCache();
    const list = this.activeCache;
    if (list.length === 0) return null;
    const exactIdx = this.colorLut[sandColor];
    if (exactIdx >= 0) return this.buckets[exactIdx];
    if (sandColor === GOLD_SAND && !this.hasUnfinishedGold) {
      if (ownerBucketIdx >= 0) {
        for (let i = 0; i < list.length; i++) {
          if (list[i].idx === ownerBucketIdx) return list[i];
        }
      }
      return list[0];
    }
    return null;
  }

  public canEnableExtraSlot(): boolean {
    if (this.maxActiveSlots >= MAX_ACTIVE_SLOTS) return false;
    let unfinished = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      if (!this.buckets[i].done && ++unfinished > 1) return true;
    }
    return false;
  }

  public enableExtraSlot(): boolean {
    if (!this.canEnableExtraSlot()) return false;
    this.maxActiveSlots = MAX_ACTIVE_SLOTS;
    this.cacheDirty = true;
    this.clogFrames = 0;
    this.clogWarningActive = false;
    this.hardDeadlockActive = false;
    return true;
  }

  public allDone(): boolean {
    const bks = this.buckets;
    if (bks.length === 0) return false;
    for (let i = 0; i < bks.length; i++) {
      if (!bks[i].done) return false;
    }
    return true;
  }

  public notifyStepNoteIfCrossed(b: BucketRuntime, onStepNote?: (stepIdx: number) => void): void {
    const pct = (b.cur / b.max) * 100;
    const stepIdx = Math.min(5, Math.floor(pct / 16));
    if (stepIdx > b.lastStepNotified) {
      b.lastStepNotified = stepIdx;
      onStepNote?.(stepIdx);
    }
  }

  /** 完成指定在槽木桶：移出卡槽腾位 + 震裂所有候选冰封桶 1 层寒冰 */
  public completeBucket(
    b: BucketRuntime,
    nowMs: number,
    sweptCells: { cellIdx: number; color: number }[] = []
  ): SweepResult {
    b.done = true;
    b.cur = b.max;
    b.justCompletedAtMs = nowMs;
    if (b.slotIdx >= 0 && b.slotIdx < this.activeSlots.length && this.activeSlots[b.slotIdx] === b) {
      this.activeSlots[b.slotIdx] = null;
    }
    b.slotIdx = -1;
    this.cacheDirty = true;

    const thawedBuckets: BucketRuntime[] = [];
    for (const col of this.columns) {
      for (const cb of col) {
        if (cb.iceLayers > 0) {
          cb.iceLayers--;
          cb.iceShakeMs = 260;
          thawedBuckets.push(cb);
        }
      }
    }

    this.clogFrames = 0;
    this.clogWarningActive = false;
    this.hardDeadlockActive = false;

    return {
      completedBucket: b,
      sweptCells,
      unlockedColor: b.color,
      thawedBuckets,
    };
  }

  /**
   * 精确 1:1 守恒清尾 + 同色等外观瓶智能配额互换机制：
   * 1. 当盘面完全静止且玩家点选了同色但预设配额更大的玻璃瓶吸完当前小沙区时，自动与未上槽的同色小配额瓶无损互换配额（总容量 100% 守恒）；
   * 2. 当装填率达到 `>= 98.5%` 且连续 18 帧未在滤网吸到同色沙时，从盘面吸附至多 `need = max - cur` 粒同色边角散沙补满；
   * 3. 当该瓶为同色最后 1 只未满瓶、无待碎冰/待染沙源且盘面仅剩少量静止死角散沙（或已无同色沙残留）时，自动吸净收尾，彻底杜绝终局卡关。
   */
  public checkIdleTailSweeps(
    grid: Uint8Array,
    tag: Uint8Array,
    hasPendingIceOrDyeForColor: (color: SandColorId) => boolean,
    isChamberSettled: boolean,
    nowMs: number
  ): SweepResult[] {
    const results: SweepResult[] = [];
    for (const b of this.active) {
      if (b.done) continue;
      if (b.cur >= b.max) {
        results.push(this.completeBucket(b, nowMs, []));
        continue;
      }
      if (b.idleDrainFrames < 18) {
        continue;
      }

      // 1. 同色异量候选瓶无损配额互换（仅在全场流沙静止时触发，确保总颗粒配额严格守恒）
      if (isChamberSettled && b.cur > 0 && b.cur < Math.ceil(b.max * FILL_RATIO)) {
        let bestSwap: BucketRuntime | null = null;
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
            results.push(this.completeBucket(b, nowMs, []));
            continue;
          }
        }
      }

      const otherUnfinishedSameColor = this.buckets.some(
        o => !o.done && o.idx !== b.idx && o.color === b.color
      );
      const pendingSource = hasPendingIceOrDyeForColor(b.color);

      // 2. 标准 >= 98.5% 严格守恒清尾
      if (b.cur >= Math.ceil(b.max * FILL_RATIO)) {
        const need = b.max - b.cur;
        const found: number[] = [];
        for (let y = GH - 2; y >= 6 && found.length < need; y--) {
          for (let x = 1; x < GW - 1 && found.length < need; x++) {
            const i = y * GW + x;
            const v = grid[i];
            if (isSand(v) && v === b.color) {
              found.push(i);
            }
          }
        }

        const canSweepNow = found.length >= need || (!otherUnfinishedSameColor && !pendingSource);
        if (canSweepNow) {
          const sweptCells: { cellIdx: number; color: number }[] = [];
          for (const i of found) {
            sweptCells.push({ cellIdx: i, color: grid[i] });
            grid[i] = EMPTY;
            tag[i] = 0;
            this.residueRemoved++;
          }
          results.push(this.completeBucket(b, nowMs, sweptCells));
        }
        continue;
      }

      // 3. 该颜色最后一只瓶的静止死角残沙兜底收尾（防止隔墙顶端/死角残留 >1.5% 导致 94%~98.4% 永远卡死）
      if (isChamberSettled && b.idleDrainFrames >= 24 && b.cur > 0 && !otherUnfinishedSameColor && !pendingSource) {
        const allMatching: number[] = [];
        let allGoldCount = 0;
        let heldByBoardOrForeign = false;
        for (let y = GH - 2; y >= 6; y--) {
          for (let x = 1; x < GW - 1; x++) {
            const i = y * GW + x;
            const v = grid[i];
            if (v === b.color) {
              allMatching.push(i);
              const below = i + GW < grid.length ? grid[i + GW] : 0;
              // 50..99 为未抽开木板；1..5 且异色说明压在其他未排空沙层上方
              if ((below >= 50 && below < 100) || (isSand(below) && below !== b.color)) {
                heldByBoardOrForeign = true;
              }
            } else if (v === GOLD_SAND) {
              allGoldCount++;
            }
          }
        }

        if (allMatching.length === 0 && allGoldCount === 0) {
          results.push(this.completeBucket(b, nowMs, []));
        } else if (
          allMatching.length > 0 &&
          allGoldCount === 0 &&
          !heldByBoardOrForeign &&
          allMatching.length <= Math.max(55, Math.ceil(b.max * 0.09)) &&
          b.cur + allMatching.length >= Math.ceil(b.max * 0.88)
        ) {
          const sweptCells: { cellIdx: number; color: number }[] = [];
          for (const i of allMatching) {
            sweptCells.push({ cellIdx: i, color: grid[i] });
            grid[i] = EMPTY;
            tag[i] = 0;
            this.residueRemoved++;
          }
          results.push(this.completeBucket(b, nowMs, sweptCells));
        }
      }
    }
    return results;
  }
}
