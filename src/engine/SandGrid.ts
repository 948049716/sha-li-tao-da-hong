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
