import type { BucketDef, SandColorId } from '../types/level';
import { FILL_RATIO, FROZEN_BASE, isSand } from './SandGrid';

export interface BucketRuntime {
  idx: number;
  color: SandColorId;
  zones: string[];
  cur: number;
  max: number;
  done: boolean;
  lastStepNotified: number; // 0..6，每 16% 触发一次五声音阶
  justCompletedAtMs: number;
}

export interface SweepResult {
  completedBucket: BucketRuntime;
  sweptCells: { cellIdx: number; color: number }[];
  unlockedColor: SandColorId;
}

export class BucketSystem {
  public buckets: BucketRuntime[] = [];
  public active: BucketRuntime[] = [];
  public queuePtr = 0;
  public maxActiveSlots = 1;
  public clogFrames = 0;
  public clogWarningActive = false;
  public residueRemoved = 0;

  public init(bucketDefs: BucketDef[], zoneCellCounts: Record<string, number>): void {
    this.buckets = bucketDefs.map((b, k) => ({
      idx: k,
      color: b.color,
      zones: [...b.zones],
      cur: 0,
      max: Math.max(1, b.zones.reduce((s, z) => s + (zoneCellCounts[z] || 0), 0)),
      done: false,
      lastStepNotified: 0,
      justCompletedAtMs: 0,
    }));
    this.maxActiveSlots = 1;
    this.queuePtr = 0;
    this.active = [];
    this.clogFrames = 0;
    this.clogWarningActive = false;
    this.residueRemoved = 0;
    this.refillActiveSlots();
  }

  public refillActiveSlots(): void {
    this.active = this.active.filter(x => !x.done);
    while (this.active.length < this.maxActiveSlots && this.queuePtr < this.buckets.length) {
      const nb = this.buckets[this.queuePtr++];
      if (!nb.done) {
        this.active.push(nb);
      }
    }
  }

  public canEnableExtraSlot(): boolean {
    if (this.maxActiveSlots >= 2) return false;
    const remaining = this.buckets.filter(b => !b.done).length;
    return remaining > 1;
  }

  public enableExtraSlot(): boolean {
    if (!this.canEnableExtraSlot()) return false;
    this.maxActiveSlots = 2;
    this.refillActiveSlots();
    this.clogFrames = 0;
    this.clogWarningActive = false;
    return true;
  }

  public allDone(): boolean {
    return this.buckets.length > 0 && this.buckets.every(b => b.done);
  }

  /**
   * 检查目标桶是否达到 16% 五声音阶节点或 >=98.5% 满桶阈值（严格对齐 tools/lib/sim.js）。
   */
  public checkBucketProgress(
    b: BucketRuntime,
    grid: Uint8Array,
    tag: Uint8Array,
    nowMs: number,
    onStepNote?: (stepIdx: number) => void
  ): SweepResult | null {
    if (b.done) return null;

    const pct = (b.cur / b.max) * 100;
    const stepIdx = Math.min(5, Math.floor(pct / 16));
    if (stepIdx > b.lastStepNotified) {
      b.lastStepNotified = stepIdx;
      onStepNote?.(stepIdx);
    }

    if (b.cur < Math.ceil(b.max * FILL_RATIO)) {
      return null;
    }

    b.done = true;
    b.cur = b.max;
    b.justCompletedAtMs = nowMs;

    const leftovers: number[] = [];
    for (let i = 0; i < grid.length; i++) {
      if (tag[i] === b.idx + 1 && (isSand(grid[i]) || grid[i] >= FROZEN_BASE)) {
        leftovers.push(i);
      }
    }

    const sweptCells: { cellIdx: number; color: number }[] = [];
    const nextSame = this.buckets.find(x => !x.done && x.idx > b.idx && x.color === b.color);
    const tailLimit = Math.ceil(b.max * 0.03);

    if (nextSame && leftovers.length > tailLimit) {
      for (const i of leftovers) {
        tag[i] = nextSame.idx + 1;
      }
      let cnt = 0;
      for (let i = 0; i < grid.length; i++) {
        if (tag[i] === nextSame.idx + 1 && (isSand(grid[i]) || grid[i] >= FROZEN_BASE)) {
          cnt++;
        }
      }
      nextSame.max = Math.max(1, nextSame.cur + cnt);
    } else {
      for (const i of leftovers) {
        if (isSand(grid[i])) {
          sweptCells.push({ cellIdx: i, color: grid[i] });
          grid[i] = 0;
          tag[i] = 0;
          this.residueRemoved++;
        }
      }
    }

    this.refillActiveSlots();
    // 若新补入的桶已被吸尘器提前预充满，连锁完成结算
    for (const ab of [...this.active]) {
      if (!ab.done && ab.cur >= Math.ceil(ab.max * FILL_RATIO)) {
        this.checkBucketProgress(ab, grid, tag, nowMs, onStepNote);
      }
    }

    return {
      completedBucket: b,
      sweptCells,
      unlockedColor: b.color,
    };
  }
}
