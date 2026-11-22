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

  /** 按入槽先后（placedSeq 升序）返回当前所有在槽未满木桶，保障同色多桶时先入槽者 100% 优先吸满腾位 */
  public get active(): BucketRuntime[] {
    const list: BucketRuntime[] = [];
    for (let s = 0; s < this.maxActiveSlots; s++) {
      const bk = this.activeSlots[s];
      if (bk && !bk.done) list.push(bk);
    }
    list.sort((a, b) => a.placedSeq - b.placedSeq);
    return list;
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
  }

  public get occupiedSlotCount(): number {
    let n = 0;
    for (let s = 0; s < this.maxActiveSlots; s++) {
      if (this.activeSlots[s] && !this.activeSlots[s]!.done) n++;
    }
    return n;
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

  /** 根据滤网流沙颜色查找最先入槽的匹配木桶（黄金狂热沙优先进金桶，无金桶在槽时可通配最早入槽桶） */
  public findReceivingBucket(sandColor: SandColorId): BucketRuntime | null {
    const act = this.active;
    if (act.length === 0) return null;
    const exact = act.find(b => b.color === sandColor);
    if (exact) return exact;
    if (sandColor === GOLD_SAND) {
      const hasAnyUnfinishedGoldBucket = this.buckets.some(b => !b.done && b.color === GOLD_SAND);
      if (!hasAnyUnfinishedGoldBucket) {
        return act[0];
      }
    }
    return null;
  }

  public canEnableExtraSlot(): boolean {
    if (this.maxActiveSlots >= MAX_ACTIVE_SLOTS) return false;
    const unfinished = this.buckets.filter(b => !b.done).length;
    return unfinished > 1;
  }

  public enableExtraSlot(): boolean {
    if (!this.canEnableExtraSlot()) return false;
    this.maxActiveSlots = MAX_ACTIVE_SLOTS;
    this.clogFrames = 0;
    this.clogWarningActive = false;
    this.hardDeadlockActive = false;
    return true;
  }

  public allDone(): boolean {
    return this.buckets.length > 0 && this.buckets.every(b => b.done);
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
   * 精确 1:1 守恒清尾机制：
   * - 当某在槽木桶达到 100% (`cur >= max`) 时已在吸沙帧当场完成；
   * - 当装填率达到 `>= 98.5%` 且连续 18 帧未在滤网吸到同色沙时，仅从盘面吸附至多 `need = max - cur` 粒同色边角散沙补满，
   *   绝不多吸哪怕 1 粒属于后续同色桶的配额！
   */
  public checkIdleTailSweeps(
    grid: Uint8Array,
    hasPendingIceOrDyeForColor: (color: SandColorId) => boolean,
    nowMs: number
  ): SweepResult[] {
    const results: SweepResult[] = [];
    for (const b of this.active) {
      if (b.done) continue;
      if (b.cur >= b.max) {
        results.push(this.completeBucket(b, nowMs, []));
        continue;
      }
      if (b.cur < Math.ceil(b.max * FILL_RATIO) || b.idleDrainFrames < 18) {
        continue;
      }

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

      const otherUnfinishedSameColor = this.buckets.some(
        o => !o.done && o.idx !== b.idx && o.color === b.color
      );
      const canSweepNow =
        found.length >= need ||
        (!otherUnfinishedSameColor && !hasPendingIceOrDyeForColor(b.color));

      if (canSweepNow) {
        const sweptCells: { cellIdx: number; color: number }[] = [];
        for (const i of found) {
          sweptCells.push({ cellIdx: i, color: grid[i] });
          grid[i] = EMPTY;
          this.residueRemoved++;
        }
        results.push(this.completeBucket(b, nowMs, sweptCells));
      }
    }
    return results;
  }
}
