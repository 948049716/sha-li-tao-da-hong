import type { BlindBoxId } from '../types/blindbox';
import type { SandColorId } from '../types/level';
import type { BucketRuntime } from './BucketSystem';

export interface BoardRuntimeSnapshot {
  id: string;
  val: number;
  removed: boolean;
  pullAnimMs: number;
  lockShakeMs: number;
  lockColor?: SandColorId;
}

export interface IceRuntimeSnapshot {
  zoneId: string;
  val: number;
  color: SandColorId;
  cells: number[];
  fall: number;
  moving: boolean;
  shattered: boolean;
  shatterDrop: number;
}

export interface CapsuleRuntimeSnapshot {
  id: number;
  boxType: BlindBoxId;
  x: number;
  y: number;
  r: number;
  collected: boolean;
  naturally: boolean;
}

export interface SandSnapshot {
  grid: Uint8Array;
  shade: Uint8Array;
  tag: Uint8Array;
  boards: BoardRuntimeSnapshot[];
  ice: IceRuntimeSnapshot[];
  capsules: CapsuleRuntimeSnapshot[];
  buckets: BucketRuntime[];
  activeIndices: number[];
  queuePtr: number;
  lootBag: BlindBoxId[];
}

/**
 * 环形 3 步状态快照栈（内存占用 < 160KB，精准零漂移，防盲盒重复入袋漏洞）
 */
export class SnapshotStack {
  private readonly maxDepth = 3;
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
