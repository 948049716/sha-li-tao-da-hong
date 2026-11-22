import type { SandZoneDef } from '../types/level';

export const GW = 150;
export const GH = 165;
export const TOTAL_CELLS = GW * GH;

export const EMPTY = 0;
export const GOLD_SAND = 5;
export const OUTSIDE = 8;
export const WALL = 9;
export const BOARD_BASE = 20;  // 20..59
export const FROZEN_BASE = 60; // 60..89

export const OUTLET = { x0: 58, x1: 91, y0: GH - 11, y1: GH - 2 } as const;
export const CAPSULE_COLLECT_Y = GH - 15;
export const FILL_RATIO = 0.985;
export const DEFAULT_SHATTER_DROP = 52;
export const DEFAULT_THAW_CONTACTS = 1200;

// ---- 速度场物理常量（必须与 tools/lib/sim.js 保持一致，保证"校验通过 = 真机可通关"）----
export const V_INIT = 16;        // 悬空起始速度（1 格/子步，单位 1/16 格）
export const V_GRAV = 3;         // 每子步重力加速度
export const V_MAX = 60;         // 终端速度（约 3.75 格/子步 ≈ 7.5 格/帧）
export const V_MOMENTUM = 36;    // 着陆后触发沿坡动量滑落的速度阈值
export const V_IMPACT_FX = 40;   // 达到该速度的着陆触发扬尘特效（纯视觉）
export const RELEASE_FRAMES = 3; // 抽板渐进释放帧数（短促由远及近；过长会在释放边界产生侧向挤入的逐粒滴落）
export const ICE_V0 = 1;         // 冰砖起始下落速度（格/帧）
export const ICE_G = 0.16;       // 冰砖重力加速度（格/帧²）
export const ICE_VMAX = 4;       // 冰砖终端速度
export const CAP_V0 = 0.8;       // 盲盒起始下落速度
export const CAP_G = 0.12;       // 盲盒重力加速度
export const CAP_VMAX = 3.2;     // 盲盒终端速度
export const CAP_SUBSTEP = 1.25; // 盲盒单次碰撞检测最大位移

/** 抽板释放顺序：从远离拉手（墙侧）的一端开始，向拉手端逐段抽离 */
export function boardReleaseOrder(
  b: { x0: number; x1: number },
  cells: number[]
): number[] {
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

export function isSand(v: number): boolean {
  return v >= 1 && v <= 5;
}

export function gridIdx(x: number, y: number): number {
  return y * GW + x;
}

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function rand(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stampLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  th: number,
  fn: (rx: number, ry: number) => void
): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps;
    const y = y0 + ((y1 - y0) * s) / steps;
    for (let dy = -th; dy <= th; dy++) {
      for (let dx = -th; dx <= th; dx++) {
        if (dx * dx + dy * dy <= th * th + 1) {
          const rx = Math.round(x + dx);
          const ry = Math.round(y + dy);
          if (rx >= 0 && rx < GW && ry >= 0 && ry < GH) {
            fn(rx, ry);
          }
        }
      }
    }
  }
}

export function pointInPoly(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function zoneContains(zone: SandZoneDef, x: number, y: number): boolean {
  if (zone.shape === 'poly' && zone.points) {
    return pointInPoly(x + 0.5, y + 0.5, zone.points);
  }
  return (
    zone.x0 !== undefined &&
    zone.x1 !== undefined &&
    zone.y0 !== undefined &&
    zone.y1 !== undefined &&
    x >= zone.x0 &&
    x <= zone.x1 &&
    y >= zone.y0 &&
    y <= zone.y1
  );
}
