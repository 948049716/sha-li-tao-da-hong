import type { IceKind, SandColorId } from '../types/level';
import type { BucketRuntime } from './BucketSystem';

export interface BoardRuntimeSnapshot {
  id: string;
  val: number;
  isOpen: boolean;
  removed: boolean;
  pullAnimMs: number;
  lockShakeMs: number;
  lockColor?: SandColorId;
}

export interface IceRuntimeSnapshot {
  zoneId: string;
  val: number;
  color: SandColorId;
  iceType: IceKind;
  cells: number[];
  fall: number;
  moving: boolean;
  shattered: boolean;
  shatterDrop: number;
  thawContacts: number;
  thawProgress: number;
  primed: boolean;
  clearFrames: number;
}

export interface SandSnapshot {
  grid: Uint8Array;
  shade: Uint8Array;
  tag: Uint8Array;
  boards: BoardRuntimeSnapshot[];
  ice: IceRuntimeSnapshot[];
  buckets: BucketRuntime[];
  activeSlotIndices: (number | null)[];
  columnIndices: number[][];
  placementCounter: number;
}

/**
 * 环形 5 步状态快照栈（支持撤回「选桶入槽」与「抽拉木栓」双操作，内存占用 < 260KB）
 */
export class SnapshotStack {
  private readonly maxDepth = 5;
  private stack: SandSnapshot[] = [];

  public clear(): void {
    this.stack = [];
  }

  public get depth(): number {
    return this.stack.length;
  }

  public canUndo(): boolean {
    return this.stack.length > 0;
  }

  public push(snap: SandSnapshot): void {
    if (this.stack.length >= this.maxDepth) {
      this.stack.shift();
    }
    this.stack.push(snap);
  }

  public pop(): SandSnapshot | undefined {
    return this.stack.pop();
  }
}
