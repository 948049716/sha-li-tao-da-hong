import { roundRectPath } from '../platform/CanvasPolyfill';
import type { SandColorId, VesselDef } from '../types/level';
import type { Rect, SandPaletteEntry, UiTokensFile } from '../types/ui';
import {
  BOARD_BASE,
  EMPTY,
  FROZEN_BASE,
  GH,
  GOLD_SAND,
  GW,
  TOTAL_CELLS,
  WALL,
  isSand,
} from './SandGrid';
import type { BoardRuntime, SandEngine } from './SandEngine';

export interface SpriteProvider {
  get(assetId: string): CanvasImageSource | null;
  getTinted(assetId: string, hexColor: string): CanvasImageSource | null;
}

export interface SandColorShades {
  baseHex: string;
  highlightHex: string;
  shadowHex: string;
  pebbleDarkHex: string;
  outlineHex: string;
}

interface CornerPoint {
  x: number;
  y: number;
  rPx: number;
}

interface GlassVesselGeometry {
  innerLoop: CornerPoint[];
  outerLoop: CornerPoint[];
  innerOpenLeftToRight: CornerPoint[];
  outerOpenRightToLeft: CornerPoint[];
  topLeftInner: [number, number];
  topRightInner: [number, number];
  bottomFloorInnerY: number;
  spoutInnerLeftX: number;
  spoutInnerRightX: number;
  spoutTipY: number;
  /** 左/右斗底斜面玻璃夹层中线（斜切面明暗） */
  leftSlopeMid: [P2, P2];
  rightSlopeMid: [P2, P2];
  leftWallInnerAtY: (gy: number) => number;
  rightWallInnerAtY: (gy: number) => number;
  leftWallOuterAtY: (gy: number) => number;
  rightWallOuterAtY: (gy: number) => number;
}

type P2 = [number, number];

/** 几何直线：过点 p、方向 d */
interface GLine {
  p: P2;
  d: P2;
}

/** 将线段 a->b 沿法线 side*(dy,-dx) 平移 off */
function offsetLine(a: P2, b: P2, side: 1 | -1, off: number): GLine {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (side * dy) / len;
  const ny = (-side * dx) / len;
  return { p: [a[0] + nx * off, a[1] + ny * off], d: [dx, dy] };
}

function shiftLine(l: GLine, side: 1 | -1, off: number): GLine {
  const len = Math.hypot(l.d[0], l.d[1]) || 1;
  const nx = (side * l.d[1]) / len;
  const ny = (-side * l.d[0]) / len;
  return { p: [l.p[0] + nx * off, l.p[1] + ny * off], d: l.d };
}

function lineIntersect(a: GLine, b: GLine): P2 | null {
  const den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / den;
  return [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t];
}

function pointAtY(l: GLine, y: number): P2 {
  if (Math.abs(l.d[1]) < 1e-6) return [l.p[0], y];
  const t = (y - l.p[1]) / l.d[1];
  return [l.p[0] + l.d[0] * t, y];
}

function pointAtX(l: GLine, x: number): P2 {
  if (Math.abs(l.d[0]) < 1e-6) return [x, l.p[1]];
  const t = (x - l.p[0]) / l.d[0];
  return [x, l.p[1] + l.d[1] * t];
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  const u = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

function packAbgr(r: number, g: number, b: number, a = 255): number {
  return ((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
}

function samplePolylineXAtY(pts: [number, number][], gy: number): number {
  if (pts.length === 0) return 6;
  if (pts.length === 1 || gy <= pts[0][1]) return pts[0][0];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (gy <= y1 || i === pts.length - 2) {
      const dy = y1 - y0;
      if (Math.abs(dy) < 0.001) return x1;
      const t = Math.max(0, (gy - y0) / dy);
      return x0 + (x1 - x0) * t;
    }
  }
  return pts[pts.length - 1][0];
}

const SUB_SCALE = 3;
const SUB_W = GW * SUB_SCALE; // 450
const SUB_H = GH * SUB_SCALE; // 495

/**
 * 1:1 严格还原局内实机参考图 docs/assets/gameplay_ref.jpg 的厚壁圆角玻璃沙箱与颗粒流沙渲染器：
 * 1. 容器造型：双轮廓半透明厚玻璃圆角方箱 + 沿物理导流斜坡收束的漏斗斗底（所见即物理，沙子停在可见斜面上）
 * 2. 光学质感：外浓棕钢笔线 + 半透明暖乳白玻璃壁夹层 + 四角高光弯弧 + 掠过木板/沙面的前玻璃反光带
 * 3. 木栓装配：木杆真实穿过半透明玻璃壁插槽、外壁紧贴圆盘卡箍与六瓣雕花拉手、「抽」字木吊牌归位箱内
 * 4. 流沙肌理：3x 超采样平滑蓬松沙脊 + 水粉立体光影/板下接触暗部 + 随粒子流动的温润粗细双阶砂砾
 */
export class SandRenderer {
  private offscreen: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private imgData: ImageData;
  private buf32: Uint32Array;

  // 零 GC 预分配空间场缓冲
  private visColor = new Uint8Array(TOTAL_CELLS);
  private visShade = new Uint8Array(TOTAL_CELLS);
  private solidMask = new Uint8Array(TOTAL_CELLS);
  private airDepth = new Uint8Array(TOTAL_CELLS);
  private aoWeight = new Uint8Array(TOTAL_CELLS);
  private surfColY = new Int16Array(GW);
  private slopeCol = new Int8Array(GW);
  /** 逐格渲染输入签名（脏检测，签名不变则复用上一帧像素） */
  private cellKeyA = new Uint32Array(TOTAL_CELLS);
  private cellKeyB = new Uint32Array(TOTAL_CELLS);
  private rasterLevel: unknown = null;
  private rasterGalaxy = false;
  /** 3x 超采样纸纹噪声表（-2..2，预计算替代逐像素哈希） */
  private paperNoise = new Int8Array(SUB_W * SUB_H);
  /** 漏斗咽喉砂纹滚动位移（随实时出沙速率加速） */
  private funnelScroll = 0;

  // 5 种沙色 × 64 档水粉体积色阶 + 粗细砂砾色表
  private lut = new Uint32Array(6 * 64);
  private lutPebbleDark = new Uint32Array(6);
  private lutPebbleMid = new Uint32Array(6);
  private lutPebbleLight = new Uint32Array(6);
  private lutOutline = new Uint32Array(6);
  private lutOutlineSoft = new Uint32Array(6);
  private starCreamAbgr = packAbgr(255, 251, 232, 255);
  private iceBaseAbgr = new Uint32Array(6);
  private iceRimAbgr = new Uint32Array(6);
  private shadeInfo: Record<number, SandColorShades> = {};
  /** 玻璃几何体缓存（按容器模板，避免每帧重建路径数组造成 GC） */
  private glassVessel: VesselDef | null = null;
  private glassGeom: GlassVesselGeometry | null = null;

  constructor(tokens: UiTokensFile, createCanvasFn: () => HTMLCanvasElement) {
    this.offscreen = createCanvasFn();
    this.offscreen.width = SUB_W;
    this.offscreen.height = SUB_H;
    const ctx = this.offscreen.getContext('2d');
    if (!ctx) throw new Error('无法创建离屏 2D 上下文');
    this.offCtx = ctx;
    this.imgData = this.offCtx.createImageData(SUB_W, SUB_H);
    this.buf32 = new Uint32Array(this.imgData.data.buffer);
    for (let gy3 = 0; gy3 < SUB_H; gy3++) {
      for (let gx3 = 0; gx3 < SUB_W; gx3++) {
        this.paperNoise[gy3 * SUB_W + gx3] = (((gx3 * 73 + gy3 * 199) ^ (gx3 >> 1)) % 5) - 2;
      }
    }
    this.buildLut(tokens);
  }

  private buildLut(tokens: UiTokensFile): void {
    const inkRgb = hexToRgb(tokens.theme.inkOutline || '#4E2E18');
    const creamRgb: [number, number, number] = [255, 251, 238];

    for (let cid = 1; cid <= 5; cid++) {
      const entry = tokens.sandPalette[String(cid)] as SandPaletteEntry | undefined;
      const baseRgb = hexToRgb(entry?.baseHex || '#EC9FA0');
      const hiRgb = hexToRgb(entry?.highlightHex || '#FAD0CA');
      const shRgb = hexToRgb(entry?.shadowHex || '#C46E70');

      const deepShadow = lerpRgb(shRgb, inkRgb, 0.12);
      const crestBright = lerpRgb(hiRgb, creamRgb, cid === GOLD_SAND ? 0.46 : 0.32);

      for (let k = 0; k < 64; k++) {
        let rgb: [number, number, number];
        if (k < 14) {
          rgb = lerpRgb(deepShadow, shRgb, k / 14);
        } else if (k < 34) {
          rgb = lerpRgb(shRgb, baseRgb, (k - 14) / 20);
        } else if (k < 52) {
          rgb = lerpRgb(baseRgb, hiRgb, (k - 34) / 18);
        } else {
          rgb = lerpRgb(hiRgb, crestBright, (k - 52) / 11);
        }
        this.lut[cid * 64 + k] = packAbgr(rgb[0], rgb[1], rgb[2], 255);
      }

      const pebDark = lerpRgb(baseRgb, shRgb, cid === GOLD_SAND ? 0.85 : 0.68);
      const pebMid = lerpRgb(baseRgb, shRgb, 0.42);
      const pebLight = lerpRgb(hiRgb, creamRgb, cid === GOLD_SAND ? 0.55 : 0.36);
      const outline = lerpRgb(shRgb, inkRgb, 0.28);
      const outlineSoft = lerpRgb(baseRgb, shRgb, 0.52);

      this.lutPebbleDark[cid] = packAbgr(pebDark[0], pebDark[1], pebDark[2], 255);
      this.lutPebbleMid[cid] = packAbgr(pebMid[0], pebMid[1], pebMid[2], 255);
      this.lutPebbleLight[cid] = packAbgr(pebLight[0], pebLight[1], pebLight[2], 255);
      this.lutOutline[cid] = packAbgr(outline[0], outline[1], outline[2], 235);
      this.lutOutlineSoft[cid] = packAbgr(outlineSoft[0], outlineSoft[1], outlineSoft[2], 245);

      const iceRgb = lerpRgb(baseRgb, [210, 240, 255], 0.62);
      const iceRim = lerpRgb(iceRgb, [255, 255, 255], 0.55);
      this.iceBaseAbgr[cid] = packAbgr(iceRgb[0], iceRgb[1], iceRgb[2], 238);
      this.iceRimAbgr[cid] = packAbgr(iceRim[0], iceRim[1], iceRim[2], 248);

      this.shadeInfo[cid] = {
        baseHex: entry?.baseHex || rgbToHex(baseRgb[0], baseRgb[1], baseRgb[2]),
        highlightHex: entry?.highlightHex || rgbToHex(hiRgb[0], hiRgb[1], hiRgb[2]),
        shadowHex: entry?.shadowHex || rgbToHex(shRgb[0], shRgb[1], shRgb[2]),
        pebbleDarkHex: rgbToHex(pebDark[0], pebDark[1], pebDark[2]),
        outlineHex: rgbToHex(outline[0], outline[1], outline[2]),
      };
    }
  }

  public getSandColorHex(cid: SandColorId, tokens: UiTokensFile): string {
    const entry = tokens.sandPalette[String(cid)] as SandPaletteEntry | undefined;
    return entry?.bucketTint || entry?.baseHex || '#EE9FA0';
  }

  public getSandShades(cid: SandColorId): SandColorShades {
    return this.shadeInfo[cid] || this.shadeInfo[1];
  }

  /**
   * 构造 gameplay_ref.jpg 同款双轮廓厚壁圆角玻璃沙箱 + 漏斗斗底几何体
   * （兼容标准方箱 / 窄高箱 / 沙漏箱 / 奶茶杯全部 4 套容器模板）
   *
   * 玻璃斗底严格沿物理导流斜坡（vessels.json walls[2]/[3]）绘制：
   * 沙子停在哪、往哪流，玻璃就画在哪——不再出现“看起来是平底、沙子却自己流走”的视觉/物理错位。
   */
  private getGlassGeometry(vessel: VesselDef): GlassVesselGeometry {
    if (this.glassVessel !== vessel || !this.glassGeom) {
      this.glassVessel = vessel;
      this.glassGeom = this.buildGlassGeometry(vessel);
    }
    return this.glassGeom;
  }

  private buildGlassGeometry(vessel: VesselDef): GlassVesselGeometry {
    const w = vessel.walls;
    const ptsOf = (k: number, fallback: P2[]): P2[] => {
      const pts = w[k]?.points;
      return pts && pts.length >= 2 ? (pts as P2[]) : fallback;
    };
    // 物理墙以格子中心 (+0.5) 为中心线
    const cc = (pts: P2[]): P2[] => pts.map(([x, y]) => [x + 0.5, y + 0.5] as P2);
    const leftSide = cc(ptsOf(0, [[8, 6], [8, 142]]));
    const rightSide = cc(ptsOf(1, [[141, 6], [141, 142]]));
    const leftSlope = cc(ptsOf(2, [[9, 141], [22, 158]]));
    const rightSlope = cc(ptsOf(3, [[140, 141], [127, 158]]));
    const leftCollar = cc(ptsOf(4, [[22, 156], [22, 164]]));
    const rightCollar = cc(ptsOf(5, [[127, 156], [127, 164]]));

    const topInnerY = 6.2;
    const topOuterY = 2.0;
    const wallThick = 4.2;
    const sideInset = 1.3; // 侧壁：玻璃内沿位于物理墙中心线内侧 1.3 格（与流沙外扩 1 格无缝衔接）
    const slopeInset = 2.0; // 底肩斜坡内沿内收

    const collarLeftCenter = leftCollar[0][0];
    const collarRightCenter = rightCollar[0][0];

    const spoutTipY = 163.8;
    const spoutNeckLeftIn = collarLeftCenter + 1.35;
    const spoutNeckRightIn = collarRightCenter - 1.35;
    const spoutNeckLeftOut = spoutNeckLeftIn - wallThick;
    const spoutNeckRightOut = spoutNeckRightIn + wallThick;
    const spoutTipLeftIn = spoutNeckLeftIn + 0.6;
    const spoutTipRightIn = spoutNeckRightIn - 0.6;
    const spoutTipLeftOut = spoutNeckLeftOut + 0.6;
    const spoutTipRightOut = spoutNeckRightOut - 0.6;

    // side=+1：左侧（自上而下走向，内法线为 (dy,-dx)）；side=-1：右侧
    const buildSide = (side: 1 | -1, sidePts: P2[], slope: P2[], neckIn: number, neckOut: number) => {
      const innerLines: GLine[] = [];
      for (let k = 0; k < sidePts.length - 1; k++) {
        innerLines.push(offsetLine(sidePts[k], sidePts[k + 1], side, sideInset));
      }
      innerLines.push(offsetLine(slope[0], slope[slope.length - 1], side, slopeInset));
      const outerLines = innerLines.map(l => shiftLine(l, side, -wallThick));

      const trace = (lines: GLine[], topY: number, neckX: number): P2[] => {
        const out: P2[] = [pointAtY(lines[0], topY)];
        for (let k = 1; k < lines.length; k++) {
          out.push(lineIntersect(lines[k - 1], lines[k]) ?? lines[k].p);
        }
        out.push(pointAtX(lines[lines.length - 1], neckX));
        return out;
      };
      const inner = trace(innerLines, topInnerY, neckIn);
      const outer = trace(outerLines, topOuterY, neckOut);
      const slopeDir = innerLines[innerLines.length - 1].d;
      const sl = Math.hypot(slopeDir[0], slopeDir[1]) || 1;
      const mo = wallThick * 0.5;
      const nx = (-side * slopeDir[1]) / sl;
      const ny = (side * slopeDir[0]) / sl;
      const cornerIn = inner[inner.length - 2];
      const neckPt = inner[inner.length - 1];
      const slopeMid: [P2, P2] = [
        [cornerIn[0] + nx * mo, cornerIn[1] + ny * mo],
        [neckPt[0] + nx * mo, neckPt[1] + ny * mo],
      ];
      return { inner, outer, slopeMid };
    };

    const L = buildSide(1, leftSide, leftSlope, spoutNeckLeftIn, spoutNeckLeftOut);
    const R = buildSide(-1, rightSide, rightSlope, spoutNeckRightIn, spoutNeckRightOut);

    const toCorner = (pts: P2[], topR: number, midR: number, neckR: number): CornerPoint[] =>
      pts.map(([x, y], i) => ({
        x,
        y,
        rPx: i === 0 ? topR : i === pts.length - 1 ? neckR : midR,
      }));
    const leftInC = toCorner(L.inner, 15, 11, 5.0);
    const rightInC = toCorner(R.inner, 15, 11, 5.0);
    const leftOutC = toCorner(L.outer, 22, 14, 6.5);
    const rightOutC = toCorner(R.outer, 22, 14, 6.5);

    // 内腔闭合轮廓（用于裁剪流沙与前玻璃反光）
    const innerLoop: CornerPoint[] = [
      ...leftInC,
      { x: spoutTipLeftIn, y: spoutTipY + 0.5, rPx: 0 },
      { x: spoutTipRightIn, y: spoutTipY + 0.5, rPx: 0 },
      ...[...rightInC].reverse(),
    ];

    // 外壁闭合轮廓（用于容器外投影与半透明厚玻璃夹层奇偶填充）
    const outerLoop: CornerPoint[] = [
      ...leftOutC,
      { x: spoutTipLeftOut, y: spoutTipY + 0.2, rPx: 3.0 },
      { x: spoutTipRightOut, y: spoutTipY + 0.2, rPx: 3.0 },
      ...[...rightOutC].reverse(),
    ];

    const innerOpenLeftToRight: CornerPoint[] = [
      { x: spoutTipLeftIn, y: spoutTipY, rPx: 0 },
      ...[...leftInC].reverse(),
      ...rightInC,
      { x: spoutTipRightIn, y: spoutTipY, rPx: 0 },
    ];

    const outerOpenRightToLeft: CornerPoint[] = [
      { x: spoutTipRightOut, y: spoutTipY, rPx: 0 },
      ...[...rightOutC].reverse(),
      ...leftOutC,
      { x: spoutTipLeftOut, y: spoutTipY, rPx: 0 },
    ];

    const leftCornerY = L.inner[L.inner.length - 2][1];
    const rightCornerY = R.inner[R.inner.length - 2][1];

    return {
      innerLoop,
      outerLoop,
      innerOpenLeftToRight,
      outerOpenRightToLeft,
      topLeftInner: L.inner[0],
      topRightInner: R.inner[0],
      bottomFloorInnerY: Math.min(leftCornerY, rightCornerY),
      spoutInnerLeftX: spoutTipLeftIn,
      spoutInnerRightX: spoutTipRightIn,
      spoutTipY,
      leftSlopeMid: L.slopeMid,
      rightSlopeMid: R.slopeMid,
      leftWallInnerAtY: gy => samplePolylineXAtY(L.inner, gy),
      rightWallInnerAtY: gy => samplePolylineXAtY(R.inner, gy),
      leftWallOuterAtY: gy => samplePolylineXAtY(L.outer, gy),
      rightWallOuterAtY: gy => samplePolylineXAtY(R.outer, gy),
    };
  }

  private traceCornerSubpath(
    ctx: CanvasRenderingContext2D,
    pts: CornerPoint[],
    rx: number,
    ry: number,
    sx: number,
    sy: number,
    closed: boolean,
    connectFromCurrent = false
  ): void {
    if (pts.length < 2) return;
    const scr = (p: CornerPoint): [number, number] => [rx + p.x * sx, ry + p.y * sy];

    if (closed) {
      const n = pts.length;
      const p0 = scr(pts[0]);
      const pLast = scr(pts[n - 1]);
      ctx.moveTo((pLast[0] + p0[0]) * 0.5, (pLast[1] + p0[1]) * 0.5);
      for (let i = 0; i < n; i++) {
        const prev = scr(pts[(i - 1 + n) % n]);
        const cur = scr(pts[i]);
        const next = scr(pts[(i + 1) % n]);
        const maxR = Math.min(
          Math.hypot(cur[0] - prev[0], cur[1] - prev[1]),
          Math.hypot(next[0] - cur[0], next[1] - cur[1])
        ) * 0.45;
        const r = Math.min(pts[i].rPx, maxR);
        if (r <= 0.2) ctx.lineTo(cur[0], cur[1]);
        else ctx.arcTo(cur[0], cur[1], next[0], next[1], r);
      }
      ctx.closePath();
    } else {
      const first = scr(pts[0]);
      if (connectFromCurrent) ctx.lineTo(first[0], first[1]);
      else ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const prev = scr(pts[i - 1]);
        const cur = scr(pts[i]);
        const next = scr(pts[i + 1]);
        const maxR = Math.min(
          Math.hypot(cur[0] - prev[0], cur[1] - prev[1]),
          Math.hypot(next[0] - cur[0], next[1] - cur[1])
        ) * 0.45;
        const r = Math.min(pts[i].rPx, maxR);
        if (r <= 0.2) ctx.lineTo(cur[0], cur[1]);
        else ctx.arcTo(cur[0], cur[1], next[0], next[1], r);
      }
      const last = scr(pts[pts.length - 1]);
      ctx.lineTo(last[0], last[1]);
    }
  }

  /**
   * 预计算当前帧流沙空间体积光影场 + 下落缝隙弥合（0 GC，100% 不改动物理）
   */
  private prepareSandFields(engine: SandEngine): void {
    const g = engine.grid;
    const sh = engine.shade;
    const inter = engine.interior;
    const vc = this.visColor;
    const vs = this.visShade;
    const sm = this.solidMask;
    const ad = this.airDepth;
    const ao = this.aoWeight;
    const scy = this.surfColY;

    vc.fill(0);
    sm.fill(0);
    ad.fill(0);
    ao.fill(0);
    scy.fill(GH);

    for (let i = 0; i < TOTAL_CELLS; i++) {
      const v = g[i];
      if (isSand(v)) {
        vc[i] = v;
        vs[i] = sh[i];
        sm[i] = 1;
      } else if (v >= FROZEN_BASE || v === WALL || (v >= BOARD_BASE && v < FROZEN_BASE)) {
        sm[i] = 1;
      }
    }

    // 1. 向相邻 1 格墙体/木板外扩，确保沙体紧贴玻璃内壁与斜木桥无锯齿缝隙
    for (let y = 1; y < GH - 1; y++) {
      const row = y * GW;
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x;
        const v = g[i];
        if (v === WALL || (v >= BOARD_BASE && v < FROZEN_BASE)) {
          let nbIdx = -1;
          if (isSand(g[i - GW])) nbIdx = i - GW;
          else if (isSand(g[i + GW])) nbIdx = i + GW;
          else if (isSand(g[i - 1])) nbIdx = i - 1;
          else if (isSand(g[i + 1])) nbIdx = i + 1;
          if (nbIdx >= 0) {
            vc[i] = g[nbIdx];
            vs[i] = sh[nbIdx];
          }
        }
      }
    }
    // 1b. 斗底斜坡台阶补齐：墙体再向下外扩 1 格（自下而上遍历避免级联），
    // 消除玻璃斜面内沿与台阶状沙边之间透出背景的三角小缝
    for (let y = GH - 2; y >= 2; y--) {
      const row = y * GW;
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x;
        if (g[i] !== WALL || vc[i] !== 0 || g[i - GW] !== WALL || vc[i - GW] === 0) continue;
        vc[i] = vc[i - GW];
        vs[i] = vs[i - GW];
      }
    }

    // 2. 下落沙体缝隙弥合（纯显示，不改物理）：
    // 高速下落时各列颗粒间会出现 1~2 格竖向空隙，直接透出背景就是“纵向白色条纹”。
    // 上下（或左右+上方）都被同一股沙包住的短空隙按邻格沙色补齐显示。
    for (let y = 7; y < GH - 3; y++) {
      const row = y * GW;
      for (let x = 2; x < GW - 2; x++) {
        const i = row + x;
        if (g[i] !== EMPTY || !inter[i]) continue;
        const up1 = g[i - GW];
        const a1 = isSand(up1);
        const a2 = !a1 && up1 === EMPTY && isSand(g[i - GW * 2]);
        if (!a1 && !a2) continue;
        const dn1 = g[i + GW];
        const b1 = isSand(dn1);
        const b2 = !b1 && dn1 === EMPTY && isSand(g[i + GW * 2]);
        const vertical = (a1 && (b1 || b2)) || (a2 && b1);
        if (!vertical && !(a1 && isSand(g[i - 1]) && isSand(g[i + 1]))) continue;
        const src = a1 ? i - GW : i + GW;
        vc[i] = g[src];
        vs[i] = sh[src] & 31;
        sm[i] = 1;
      }
    }

    // 3. 宽底滤网底缘贴合：仅在实际有流沙接触滤网的 X 列向下补齐 1 格，静止态零滚动闪烁
    if (engine.lastFlowParticles > 0 || engine.pourStreamMs > 0) {
      this.funnelScroll = (this.funnelScroll + 0.8 + Math.min(60, engine.lastFlowParticles) * 0.07) % 1700;
    }
    const scroll = this.funnelScroll | 0;
    for (let x = 18; x <= 131; x++) {
      const topRef = g[(GH - 3) * GW + x];
      const botRef = g[(GH - 2) * GW + x];
      const refColor = isSand(botRef) ? botRef : isSand(topRef) ? topRef : 0;
      if (refColor >= 1 && refColor <= 5) {
        const idx = (GH - 2) * GW + x;
        if (!isSand(vc[idx])) {
          vc[idx] = refColor;
          sm[idx] = 1;
          const h = ((x * 73856093) ^ ((GH - 2 - (scroll % 17)) * 19349663)) >>> 0;
          const mod = h % 100;
          const gk = mod < 9 ? 5 : mod < 18 ? 6 : mod < 25 ? 7 : 0;
          vs[idx] = (gk << 5) | 16;
        }
      }
    }

    // 4. 逐列计算受光深度 airDepth、板下/箱底接触暗部 AO 与顶坡列高
    for (let x = 1; x < GW - 1; x++) {
      let depthAir = 15;
      let underBoard = 0;
      let foundTop = false;
      let gapRun = 0;

      for (let y = 6; y < GH - 1; y++) {
        const i = y * GW + x;
        const rawV = g[i];
        const vCid = vc[i];
        if (rawV === EMPTY && inter[i] && vCid === 0) {
          // 下落沙体内部 ≤2 格的短空隙不算“露天”，避免空隙下方整列被顶光提亮成竖向亮纹
          if (++gapRun >= 3) depthAir = 0;
          underBoard = 0;
        } else if ((rawV >= BOARD_BASE && rawV < FROZEN_BASE) || rawV >= FROZEN_BASE) {
          depthAir = 15;
          underBoard = 5;
          gapRun = 0;
        } else if (vCid >= 1 && vCid <= 5) {
          gapRun = 0;
          if (!foundTop && depthAir === 0) {
            scy[x] = y;
            foundTop = true;
          }
          ad[i] = depthAir;
          if (depthAir < 15) depthAir++;

          let localAo = 0;
          if (underBoard > 0) {
            localAo += underBoard * 2;
            underBoard--;
          }
          if (x <= 8 || x >= GW - 9) localAo += 3;
          // 木板 / 玻璃斗底斜面上方的接触暗部
          for (let dy = 1; dy <= 3; dy++) {
            const dv = y + dy < GH ? g[i + GW * dy] : WALL;
            if (dv === WALL || (dv >= BOARD_BASE && dv < FROZEN_BASE)) {
              localAo += (4 - dy) * 2;
              break;
            }
          }
          ao[i] = localAo > 14 ? 14 : localAo;
        }
      }
    }

    // 5. 受光深度横向 1-2-1 平滑：下落沙体各列顶端参差时，逐列独立的顶光高亮会形成竖向明暗条纹
    for (let y = 6; y < GH - 1; y++) {
      const row = y * GW;
      let prev = -1;
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x;
        const c = vc[i];
        if (c < 1 || c > 5 || g[i] >= BOARD_BASE) {
          prev = -1;
          continue;
        }
        const a = ad[i];
        const cr = vc[i + 1];
        const r = cr >= 1 && cr <= 5 && g[i + 1] < BOARD_BASE ? ad[i + 1] : a;
        const l = prev >= 0 ? prev : a;
        prev = a;
        ad[i] = (l + 2 * a + r + 2) >> 2;
      }
    }
  }

  private sampleInteriorSubpixel(
    cid: number,
    rawShade: number,
    depth: number,
    aoVal: number,
    slopeBias: number,
    sxSub: number,
    sySub: number,
    gx3: number,
    gy3: number,
    frame: number,
    galaxySkinActive: boolean
  ): number {
    const tone = rawShade & 31;
    const grainKind = rawShade >> 5;
    const paperNoise = this.paperNoise[gy3 * SUB_W + gx3];
    const crestBoost = depth < 8 ? Math.round((8 - depth) * 2.4) : 0;
    let k = 22 + ((tone * 22) >> 5) + crestBoost + slopeBias - aoVal + paperNoise;
    if (k < 0) k = 0;
    else if (k > 63) k = 63;

    if (galaxySkinActive && grainKind === 7 && ((gx3 * 13 + gy3 * 7 + (frame >> 2)) % 19) < 3) {
      return this.starCreamAbgr;
    }

    if (grainKind === 5 && depth >= 2) {
      const ox = tone & 1;
      const oy = (tone >> 1) & 1;
      const dx = sxSub - ox;
      const dy = sySub - oy;
      if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) {
        if (dx === 1 && dy === 1) return this.lutPebbleMid[cid];
        return depth <= 3 ? this.lutPebbleMid[cid] : this.lutPebbleDark[cid];
      }
    } else if (grainKind === 6 && depth >= 1) {
      const ox = (tone >> 2) & 1;
      if (sySub === ((tone & 1) + 1) % 3 && sxSub >= ox && sxSub <= ox + 1) {
        return this.lutPebbleMid[cid];
      }
    } else if (grainKind === 7) {
      const ox = tone & 1;
      const oy = (tone >> 1) & 1;
      if (sxSub >= ox && sxSub <= ox + 1 && sySub === oy) {
        if (cid === GOLD_SAND && ((tone + (frame >> 3)) & 7) === 0) {
          return this.starCreamAbgr;
        }
        return this.lutPebbleLight[cid];
      }
    }

    return this.lut[cid * 64 + k];
  }

  /**
   * 对齐《局内主界面》设计图：圆润立体的温润原木圆球拉手（穿过玻璃壁伸出，无箭头文字）
   */
  private drawMinimalMapleKnob(
    ctx: CanvasRenderingContext2D,
    wallOuterScreenX: number,
    anchorScreenY: number,
    outerDir: -1 | 1,
    bh: number,
    mode: 'pull' | 'push' | 'reusable_pull' = 'pull'
  ): void {
    ctx.save();
    ctx.translate(wallOuterScreenX, anchorScreenY);
    if (outerDir > 0) {
      ctx.scale(-1, 1);
    }

    const inkHex = '#3B2416';
    const rodH = Math.max(7.6, bh * 0.74);
    const stemLen = mode === 'push' ? 6.5 : 10.5;
    const bulbCx = -stemLen - 6.8;
    const bulbR = Math.max(7.8, bh * 0.72);

    // 柔和下投影
    ctx.fillStyle = 'rgba(12, 16, 30, 0.34)';
    ctx.beginPath();
    ctx.arc(bulbCx, 2.2, bulbR + 0.6, 0, Math.PI * 2);
    ctx.fill();

    // 伸出玻璃外壁的圆木短轴
    const stemGrad = ctx.createLinearGradient(0, -rodH * 0.5, 0, rodH * 0.5);
    if (mode === 'push' || mode === 'reusable_pull') {
      stemGrad.addColorStop(0, '#DDF2E3');
      stemGrad.addColorStop(0.5, '#9FD0B2');
      stemGrad.addColorStop(1, '#6EA383');
    } else {
      stemGrad.addColorStop(0, '#F0CCA0');
      stemGrad.addColorStop(0.5, '#CE9B63');
      stemGrad.addColorStop(1, '#9B6938');
    }
    ctx.fillStyle = stemGrad;
    ctx.strokeStyle = inkHex;
    ctx.lineWidth = 1.45;
    ctx.beginPath();
    roundRectPath(ctx, bulbCx + bulbR * 0.55, -rodH * 0.5, Math.abs(bulbCx) - bulbR * 0.45 + 1.5, rodH, 2.5);
    ctx.fill();
    ctx.stroke();

    // 饱满立体实木圆球拉手
    const ballGrad = ctx.createRadialGradient(
      bulbCx - bulbR * 0.28,
      -bulbR * 0.3,
      bulbR * 0.12,
      bulbCx,
      0,
      bulbR
    );
    if (mode === 'push' || mode === 'reusable_pull') {
      ballGrad.addColorStop(0, '#F3FCF5');
      ballGrad.addColorStop(0.52, '#A7D8B8');
      ballGrad.addColorStop(1, '#6B9F80');
    } else {
      ballGrad.addColorStop(0, '#FCE3BE');
      ballGrad.addColorStop(0.48, '#D7A56D');
      ballGrad.addColorStop(1, '#966334');
    }
    ctx.fillStyle = ballGrad;
    ctx.strokeStyle = inkHex;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(bulbCx, 0, bulbR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 木球柔和高光点
    ctx.fillStyle = 'rgba(255, 250, 238, 0.62)';
    ctx.beginPath();
    ctx.ellipse(bulbCx - bulbR * 0.28, -bulbR * 0.3, bulbR * 0.28, bulbR * 0.18, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * 对齐《局内主界面》设计图：温润蜂蜜原木圆杆与斜导流木板（带自然细木纹）
   */
  private drawMinimalPullSlat(
    ctx: CanvasRenderingContext2D,
    len: number,
    bh: number,
    variant: 'maple' | 'slant' | 'reusable',
    pullEndSign: -1 | 1 = -1
  ): void {
    const h = variant === 'slant' ? Math.max(10.5, bh * 0.96) : Math.max(9.2, bh * 0.86);
    const r = variant === 'slant' ? 2.8 : h * 0.44;
    const ink = '#3B2416';

    // 柔和下投影
    ctx.fillStyle = 'rgba(10, 16, 30, 0.28)';
    ctx.beginPath();
    roundRectPath(ctx, -len * 0.5, -h * 0.5 + 2.0, len, h, r);
    ctx.fill();

    const grad = ctx.createLinearGradient(0, -h * 0.5, 0, h * 0.5);
    if (variant === 'reusable') {
      grad.addColorStop(0, '#E4F6EA');
      grad.addColorStop(0.5, '#A6D7B7');
      grad.addColorStop(1, '#75A888');
    } else {
      grad.addColorStop(0, '#F1CE9F');
      grad.addColorStop(0.46, '#D3A068');
      grad.addColorStop(1, '#A4703D');
    }
    ctx.fillStyle = grad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.55;
    ctx.beginPath();
    roundRectPath(ctx, -len * 0.5, -h * 0.5, len, h, r);
    ctx.fill();
    ctx.stroke();

    // 顶部暖木高光边与手绘细木纹
    ctx.strokeStyle = 'rgba(255, 246, 226, 0.58)';
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.moveTo(-len * 0.5 + r + 1, -h * 0.5 + 1.5);
    ctx.lineTo(len * 0.5 - r - 1, -h * 0.5 + 1.5);
    ctx.stroke();

    if (len >= 28) {
      ctx.strokeStyle = 'rgba(92, 54, 24, 0.26)';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(-len * 0.36, 0.6);
      ctx.bezierCurveTo(-len * 0.1, -0.8, len * 0.12, 1.4, len * 0.38, 0.2);
      ctx.stroke();
    }

    // 斜向可抽木板在拉拔端附带精致原木小圆珠，与冰白磨砂固定隔条一眼区分
    if (variant === 'slant') {
      const ringX = pullEndSign * (len * 0.5 + 4.5);
      const bGrad = ctx.createRadialGradient(ringX - 1.5, -1.5, 1, ringX, 0, 5.2);
      bGrad.addColorStop(0, '#FCE3BE');
      bGrad.addColorStop(0.55, '#D5A26A');
      bGrad.addColorStop(1, '#966334');
      ctx.fillStyle = bGrad;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      ctx.arc(ringX, 0, 5.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /**
   * 绘制冰砖中心极简冰晶雪花几何图标（无文字）
   */
  private drawMiniCrystalIcon(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    strokeHex: string
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = strokeHex;
    ctx.lineWidth = 1.35;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3;
      const dx = Math.cos(a) * r;
      const dy = Math.sin(a) * r;
      ctx.beginPath();
      ctx.moveTo(-dx, -dy);
      ctx.lineTo(dx, dy);
      ctx.stroke();
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 3x 超采样流沙光栅化（独立方法，便于 JS 引擎整体优化热循环）
   */
  private rasterize(engine: SandEngine, galaxySkinActive: boolean): void {
    const g = engine.grid;
    const inter = engine.interior;
    const vc = this.visColor;
    const vs = this.visShade;
    const sm = this.solidMask;
    const ad = this.airDepth;
    const ao = this.aoWeight;
    const scy = this.surfColY;
    const b32 = this.buf32;
    const f = engine.frame;
    const vel = engine.vel;

    // 2. 光栅化 450x495 (3x 超采样) 水粉颗粒彩沙离屏缓冲
    //    逐格「输入签名」脏检测：签名未变的格子直接复用上一帧像素（静止沙堆零重绘），
    //    只重绘流动 / 受光变化 / 动画中的格子；输出与全量重绘逐像素一致。
    if (engine.level !== this.rasterLevel || galaxySkinActive !== this.rasterGalaxy) {
      this.rasterLevel = engine.level;
      this.rasterGalaxy = galaxySkinActive;
      this.cellKeyB.fill(0);
      b32.fill(0);
    }
    const keyA = this.cellKeyA;
    const keyB = this.cellKeyB;
    const pn = this.paperNoise;
    const lut = this.lut;
    const slopeCol = this.slopeCol;
    for (let x = 1; x < GW - 1; x++) {
      const yL = scy[x > 2 ? x - 2 : x];
      const yR = scy[x < GW - 3 ? x + 2 : x];
      slopeCol[x] = yR !== GH && yL !== GH ? Math.max(-4, Math.min(4, yR - yL)) : 0;
    }

    for (let y = 5; y < GH - 1; y++) {
      const rowOff = y * GW;
      const baseSubY = y * SUB_SCALE;

      for (let x = 1; x < GW - 1; x++) {
        const i = rowOff + x;
        const rawV = g[i];
        const cid = vc[i];
        const baseSubX = x * SUB_SCALE;
        const o0 = baseSubY * SUB_W + baseSubX;
        const slopeDiff = slopeCol[x];

        // ---- 本格渲染输入签名 ----
        // mode: 0 空白 / 1 冰砖 / 2 流沙 / 3 空格边缘补圆 / 4 下落拖尾
        let mode = 0;
        let kA = 0;
        let kB = 0x4000000;
        let animated = false;
        let fillCid = 0;
        let refShade = 0;
        if (rawV >= FROZEN_BASE) {
          mode = 1;
          kA = rawV;
          kB = 0x1000000 | (g[i - GW] !== rawV ? 1 : 0);
        } else if (cid >= 1 && cid <= 5) {
          mode = 2;
          const cUp = vc[i - GW];
          const cDown = vc[i + GW];
          const cLeft = vc[i - 1];
          const cRight = vc[i + 1];
          const nb =
            sm[i - GW - 1] |
            (sm[i - GW] << 1) |
            (sm[i - GW + 1] << 2) |
            (sm[i - 1] << 3) |
            (sm[i + 1] << 4) |
            (sm[i + GW - 1] << 5) |
            (sm[i + GW] << 6) |
            (sm[i + GW + 1] << 7);
          const rawShade = vs[i];
          kA = cid | (rawShade << 3) | (ad[i] << 11) | (ao[i] << 15) | ((slopeDiff + 4) << 19) | (nb << 23);
          kB =
            0x2000000 |
            (cUp === 0 ? 1 : 0) |
            (cDown === 0 ? 2 : 0) |
            (cLeft === 0 ? 4 : 0) |
            (cRight === 0 ? 8 : 0) |
            (cUp >= 1 && cUp <= 5 && cUp !== cid ? 16 : 0) |
            (cLeft >= 1 && cLeft <= 5 && cLeft !== cid ? 32 : 0);
          animated = rawShade >> 5 === 7 && (cid === GOLD_SAND || galaxySkinActive);
        } else if (rawV === EMPTY && inter[i]) {
          // 拖尾只给细流/零散颗粒；整块下坠沙体顶面不画（否则顶边一排细竖线像白色毛刺）
          if (
            vel[i + GW] >= 26 &&
            isSand(g[i + GW]) &&
            vc[i - GW] === 0 &&
            !(isSand(g[i + GW - 1]) && isSand(g[i + GW + 1]))
          ) {
            mode = 4;
            animated = true;
          } else {
            const sDown = vc[i + GW];
            const sUp = vc[i - GW];
            const sLeft = vc[i - 1];
            const sRight = vc[i + 1];
            const adjCount = sm[i + GW] + sm[i - GW] + sm[i - 1] + sm[i + 1];
            if (adjCount >= 2) {
              fillCid =
                (sDown >= 1 && sDown <= 5 ? sDown : 0) ||
                (sLeft >= 1 && sLeft <= 5 ? sLeft : 0) ||
                (sRight >= 1 && sRight <= 5 ? sRight : 0) ||
                (sUp >= 1 && sUp <= 5 ? sUp : 0);
              if (fillCid) {
                mode = 3;
                const refIdx =
                  sDown === fillCid
                    ? i + GW
                    : sLeft === fillCid
                      ? i - 1
                      : sRight === fillCid
                        ? i + 1
                        : i - GW;
                refShade = vs[refIdx];
                const nb =
                  sm[i - GW - 1] |
                  (sm[i - GW] << 1) |
                  (sm[i - GW + 1] << 2) |
                  (sm[i - 1] << 3) |
                  (sm[i + 1] << 4) |
                  (sm[i + GW - 1] << 5) |
                  (sm[i + GW] << 6) |
                  (sm[i + GW + 1] << 7);
                kA = nb | (sDown << 8) | (sLeft << 11) | (sRight << 14) | (sUp << 17) | ((slopeDiff + 4) << 20);
                kB = 0x3000000 | refShade;
                animated = refShade >> 5 === 7 && (fillCid === GOLD_SAND || galaxySkinActive);
              }
            }
          }
        }

        if (!animated && kA === keyA[i] && kB === keyB[i]) continue;
        keyA[i] = kA;
        keyB[i] = animated ? 0 : kB;

        const o1 = o0 + SUB_W;
        const o2 = o1 + SUB_W;
        b32[o0] = 0;
        b32[o0 + 1] = 0;
        b32[o0 + 2] = 0;
        b32[o1] = 0;
        b32[o1 + 1] = 0;
        b32[o1 + 2] = 0;
        b32[o2] = 0;
        b32[o2 + 1] = 0;
        b32[o2 + 2] = 0;
        if (mode === 0) continue;

        if (mode === 1) {
          const iceIdx = rawV - FROZEN_BASE;
          const ic = engine.ice[iceIdx];
          const iceCol = ic ? this.iceBaseAbgr[ic.color] : packAbgr(210, 240, 255, 238);
          const rimCol = ic ? this.iceRimAbgr[ic.color] : packAbgr(242, 252, 255, 248);
          const top = (kB & 1) === 1 ? rimCol : iceCol;
          b32[o0] = top;
          b32[o0 + 1] = top;
          b32[o0 + 2] = top;
          b32[o1] = iceCol;
          b32[o1 + 1] = iceCol;
          b32[o1 + 2] = iceCol;
          b32[o2] = iceCol;
          b32[o2 + 1] = iceCol;
          b32[o2 + 2] = iceCol;
          continue;
        }

        if (mode === 2) {
          const rawShade = vs[i];
          const depth = ad[i];
          const aoVal = ao[i];
          const cDown = vc[i + GW];
          const cLeft = vc[i - 1];
          const cRight = vc[i + 1];

          const solid4 = kA >>> 23 === 255;

          if (solid4) {
            const diffUp = (kB & 16) !== 0;
            const diffLeft = (kB & 32) !== 0;
            const tone = rawShade & 31;
            const plain = rawShade >> 5 < 5;
            const crestBoost = depth < 8 ? Math.round((8 - depth) * 2.4) : 0;
            const baseK = 22 + ((tone * 22) >> 5) + crestBoost + slopeDiff - aoVal;
            const lutBase = cid * 64;
            const outlineSoft = this.lutOutlineSoft[cid];
            for (let sySub = 0; sySub < 3; sySub++) {
              const gy3 = baseSubY + sySub;
              const outRow = o0 + sySub * SUB_W;
              for (let sxSub = 0; sxSub < 3; sxSub++) {
                const gx3 = baseSubX + sxSub;
                const o = outRow + sxSub;
                if (
                  (diffUp && sySub === 0 && ((gx3 * 19 + gy3 * 7) & 3) !== 0) ||
                  (diffLeft && sxSub === 0 && ((gx3 * 11 + gy3 * 23) & 3) !== 0)
                ) {
                  b32[o] = outlineSoft;
                } else if (plain) {
                  let k = baseK + pn[o];
                  if (k < 0) k = 0;
                  else if (k > 63) k = 63;
                  b32[o] = lut[lutBase + k];
                } else {
                  b32[o] = this.sampleInteriorSubpixel(
                    cid,
                    rawShade,
                    depth,
                    aoVal,
                    slopeDiff,
                    sxSub,
                    sySub,
                    gx3,
                    gy3,
                    f,
                    galaxySkinActive
                  );
                }
              }
            }
          } else {
            const topExposed = (kB & 1) !== 0;
            for (let sySub = 0; sySub < 3; sySub++) {
              const fy = (sySub - 1) * 0.3333333;
              const iy = fy < 0 ? -GW : GW;
              const ay = fy < 0 ? -fy : fy;
              const gy3 = baseSubY + sySub;
              const outRow = o0 + sySub * SUB_W;

              for (let sxSub = 0; sxSub < 3; sxSub++) {
                const fx = (sxSub - 1) * 0.3333333;
                const ix = fx < 0 ? -1 : 1;
                const ax = fx < 0 ? -fx : fx;
                const gx3 = baseSubX + sxSub;

                const density =
                  (1 - ax) * (1 - ay) +
                  ax * (1 - ay) * sm[i + ix] +
                  (1 - ax) * ay * sm[i + iy] +
                  ax * ay * sm[i + iy + ix];

                const grainHash = ((gx3 * 374761393 + gy3 * 668265263) ^ (rawShade * 2246822519)) >>> 0;
                const grainBump = ((grainHash & 31) / 31 - 0.46) * 0.17;
                const dEff = density + grainBump;

                if (dEff < 0.48) {
                  b32[outRow + sxSub] = 0;
                } else if (dEff < 0.57 && (topExposed || cDown === 0 || cLeft === 0 || cRight === 0)) {
                  if (topExposed) {
                    b32[outRow + sxSub] =
                      (grainHash & 3) === 0 ? this.lutOutlineSoft[cid] : this.lutPebbleLight[cid];
                  } else {
                    b32[outRow + sxSub] = this.lutOutlineSoft[cid];
                  }
                } else {
                  b32[outRow + sxSub] = this.sampleInteriorSubpixel(
                    cid,
                    rawShade,
                    depth,
                    aoVal,
                    slopeDiff,
                    sxSub,
                    sySub,
                    gx3,
                    gy3,
                    f,
                    galaxySkinActive
                  );
                }
              }
            }
          }
          continue;
        }

        if (mode === 4) {
          // 悬空高速下落颗粒的竖向动态模糊拖尾（与沙体同色调的柔和中间色，不再是发白亮线）
          const vBelow = vel[i + GW];
          const tc = g[i + GW];
          const trail = vBelow >= 46 ? 3 : vBelow >= 34 ? 2 : 1;
          const trailCol = lut[tc * 64 + 30];
          const trailSoft = this.lutOutlineSoft[tc];
          for (let r = 0; r < trail; r++) {
            const outRow = o0 + (2 - r) * SUB_W;
            b32[outRow + 1] = r === 0 ? trailCol : trailSoft;
            if (r === 0 && ((x + y + f) & 1) === 0) b32[outRow + ((x & 1) === 0 ? 0 : 2)] = trailSoft;
          }
          continue;
        }

        // mode === 3：空格与沙体接壤处的平滑补圆
        const sDown = vc[i + GW];
        const sUp = vc[i - GW];
        const isTopStep = sDown >= 1 && sDown <= 5 && sUp === 0;
        for (let sySub = 0; sySub < 3; sySub++) {
          const fy = (sySub - 1) * 0.3333333;
          const iy = fy < 0 ? -GW : GW;
          const ay = fy < 0 ? -fy : fy;
          const gy3 = baseSubY + sySub;
          const outRow = o0 + sySub * SUB_W;

          for (let sxSub = 0; sxSub < 3; sxSub++) {
            const fx = (sxSub - 1) * 0.3333333;
            const ix = fx < 0 ? -1 : 1;
            const ax = fx < 0 ? -fx : fx;
            const gx3 = baseSubX + sxSub;

            const density =
              ax * (1 - ay) * sm[i + ix] +
              (1 - ax) * ay * sm[i + iy] +
              ax * ay * sm[i + iy + ix];

            const grainHash = ((gx3 * 374761393 + gy3 * 668265263) ^ (refShade * 2246822519)) >>> 0;
            const grainBump = ((grainHash & 31) / 31 - 0.46) * 0.17;
            const dEff = density + grainBump;

            if (dEff >= 0.58) {
              b32[outRow + sxSub] = this.sampleInteriorSubpixel(
                fillCid,
                refShade,
                0,
                0,
                slopeDiff,
                sxSub,
                sySub,
                gx3,
                gy3,
                f,
                galaxySkinActive
              );
            } else if (dEff >= 0.48) {
              b32[outRow + sxSub] = isTopStep
                ? (grainHash & 3) === 0
                  ? this.lutOutlineSoft[fillCid]
                  : this.lutPebbleLight[fillCid]
                : this.lutOutlineSoft[fillCid];
            }
          }
        }
      }
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    engine: SandEngine,
    chamberRect: Rect,
    sprites: SpriteProvider,
    tokens: UiTokensFile
  ): void {
    const shakeOffset = engine.screenShakeMs > 0 ? Math.sin(engine.frame * 1.8) * 3 : 0;

    const rx = chamberRect.x;
    const ry = chamberRect.y + shakeOffset;
    const rw = chamberRect.w;
    const rh = chamberRect.h;
    const sx = rw / GW;
    const sy = rh / GH;

    const geom = this.getGlassGeometry(engine.vessel);

    // 1. 预计算流沙光影场与下落缝隙弥合
    this.prepareSandFields(engine);

    this.rasterize(engine, false);

    this.offCtx.putImageData(this.imgData, 0, 0);

    ctx.save();

    // 3. 容器外壁柔和木工坊环境背影（让厚玻璃箱浮出于背景之上）
    ctx.save();
    ctx.translate(0, 4);
    ctx.beginPath();
    this.traceCornerSubpath(ctx, geom.outerLoop, rx, ry, sx, sy, true);
    ctx.strokeStyle = 'rgba(26, 13, 5, 0.24)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();

    // 4. 在玻璃内腔裁剪区内绘制：清透微暖底 + 颗粒彩沙 + 染色环 + 冰砖 + 内部隔板与拨片
    ctx.save();
    ctx.beginPath();
    this.traceCornerSubpath(ctx, geom.innerLoop, rx, ry, sx, sy, true);
    ctx.clip();

    // 4a. 星夜玻璃花房通透微蓝底衬（透出后方星空与窗格）
    ctx.fillStyle = 'rgba(28, 48, 84, 0.24)';
    ctx.fillRect(rx, ry, rw, rh);

    // 4b. 绘制 450x495 颗粒彩沙缓冲
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.offscreen, rx, ry, rw, rh);

    // 4c. 玻璃内侧边缘清透折光立体感
    const leftEdgeX = rx + geom.topLeftInner[0] * sx;
    const rightEdgeX = rx + geom.topRightInner[0] * sx;
    const cylGrad = ctx.createLinearGradient(leftEdgeX, ry, rightEdgeX, ry);
    cylGrad.addColorStop(0, 'rgba(180, 220, 255, 0.14)');
    cylGrad.addColorStop(0.06, 'rgba(180, 220, 255, 0.0)');
    cylGrad.addColorStop(0.94, 'rgba(180, 220, 255, 0.0)');
    cylGrad.addColorStop(1, 'rgba(180, 220, 255, 0.14)');
    ctx.fillStyle = cylGrad;
    ctx.fillRect(rx, ry, rw, rh);

    // 4d. 荧光翡翠/糖果玻璃胶囊染色环（对齐《局内主界面》右侧发光玻璃胶囊）
    for (const ring of engine.dyeRings) {
      const cx = rx + (ring.x0 + ring.x1) * 0.5 * sx;
      const cy = ry + (ring.y0 + ring.y1) * 0.5 * sy;
      const w = Math.max(46, (ring.x1 - ring.x0) * sx);
      const h = Math.max(18, (ring.y1 - ring.y0) * sy * 1.9);
      const shades = this.getSandShades(ring.toColor);
      ctx.save();
      // 外层柔和荧光光晕
      const glowGrad = ctx.createRadialGradient(cx, cy, h * 0.2, cx, cy, w * 0.68);
      glowGrad.addColorStop(0, `${shades.highlightHex}66`);
      glowGrad.addColorStop(0.55, `${shades.baseHex}38`);
      glowGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.68, h * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();

      // 半透明发光胶囊玻璃管体
      const capGrad = ctx.createLinearGradient(cx, cy - h * 0.5, cx, cy + h * 0.5);
      capGrad.addColorStop(0, shades.highlightHex);
      capGrad.addColorStop(0.5, shades.baseHex);
      capGrad.addColorStop(1, shades.shadowHex);
      ctx.globalAlpha = 0.86;
      ctx.fillStyle = capGrad;
      ctx.strokeStyle = '#1E3A2F';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      roundRectPath(ctx, cx - w * 0.5, cy - h * 0.5, w, h, h * 0.5);
      ctx.fill();
      ctx.stroke();

      // 内腔深透槽与顶部玻璃高光条
      ctx.globalAlpha = 0.52;
      ctx.fillStyle = shades.shadowHex;
      ctx.beginPath();
      roundRectPath(ctx, cx - w * 0.38, cy - h * 0.24, w * 0.76, h * 0.48, h * 0.24);
      ctx.fill();

      ctx.globalAlpha = 0.92;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.34, cy - h * 0.3);
      ctx.lineTo(cx + w * 0.34, cy - h * 0.3);
      ctx.stroke();
      ctx.restore();
    }

    // 4e. 脆冰砖与万年寒冰
    const iceTex = sprites.get('ui_ice_block');
    for (const ic of engine.ice) {
      if (ic.shattered || ic.cells.length === 0) continue;
      let minX = GW;
      let maxX = 0;
      let minY = GH;
      let maxY = 0;
      for (const idx of ic.cells) {
        const x = idx % GW;
        const y = (idx / GW) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const ix = rx + minX * sx;
      const iy = ry + minY * sy;
      const iw = (maxX - minX + 1) * sx;
      const ih = (maxY - minY + 1) * sy;
      const isPerma = ic.iceType === 'permafrost';
      const zDef = engine.level.sandZones.find(z => z.id === ic.zoneId);
      const polyPts =
        zDef?.shape === 'poly' && zDef.points && zDef.points.length >= 3 ? zDef.points : null;
      const origMinY = polyPts ? Math.min(...polyPts.map(p => p[1])) : minY;
      const dyShift = (minY - origMinY) * sy;

      const traceIceShape = () => {
        ctx.beginPath();
        if (polyPts) {
          polyPts.forEach(([px, py], idx) => {
            const cxp = rx + Math.max(minX, Math.min(maxX + 1, px)) * sx;
            const cyp = ry + py * sy + dyShift;
            if (idx === 0) ctx.moveTo(cxp, cyp);
            else ctx.lineTo(cxp, cyp);
          });
          ctx.closePath();
        } else {
          roundRectPath(ctx, ix, iy, iw, ih, 5);
        }
      };

      if (iceTex) {
        ctx.save();
        traceIceShape();
        ctx.clip();
        ctx.globalAlpha = isPerma ? 0.74 : 0.62;
        ctx.drawImage(iceTex, ix - 2, iy - 2, iw + 4, ih + 4);
        ctx.restore();
      }

      if (isPerma) {
        ctx.save();
        traceIceShape();
        ctx.strokeStyle = ic.primed ? '#EAB308' : '#588BB8';
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.strokeStyle = '#EAF6FF';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();

        const pct = Math.min(100, Math.floor((ic.thawProgress / Math.max(1, ic.thawContacts)) * 100));
        const barW = Math.min(iw - 6, 48);
        const barH = 7.5;
        const bx = ix + (iw - barW) * 0.5;
        const by = iy + ih * 0.64 - barH * 0.5;
        this.drawMiniCrystalIcon(ctx, ix + iw * 0.5, iy + ih * 0.36, 4.2, '#FFFDF9');
        ctx.save();
        ctx.fillStyle = 'rgba(42, 64, 88, 0.68)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        roundRectPath(ctx, bx, by, barW, barH, 4);
        ctx.fill();
        ctx.stroke();
        if (pct > 0) {
          ctx.fillStyle = ic.primed ? '#FACC15' : '#8AD4F8';
          ctx.beginPath();
          roundRectPath(ctx, bx + 1.2, by + 1.2, Math.max(3.5, ((barW - 2.4) * pct) / 100), barH - 2.4, 3);
          ctx.fill();
        }
        ctx.restore();
      } else {
        ctx.save();
        traceIceShape();
        ctx.strokeStyle = '#5B98C2';
        ctx.lineWidth = 2.0;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();
        if (iw >= 26 && ih >= 14) {
          ctx.save();
          ctx.fillStyle = 'rgba(255, 253, 250, 0.72)';
          ctx.strokeStyle = 'rgba(91, 152, 194, 0.75)';
          ctx.lineWidth = 1.15;
          ctx.beginPath();
          ctx.arc(ix + iw * 0.5, iy + ih * 0.5, 7.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          this.drawMiniCrystalIcon(ctx, ix + iw * 0.5, iy + ih * 0.5, 4.3, '#4982AD');
          ctx.restore();
        }
      }
    }

    // 4f. 内部静态磨砂石英玻璃隔条（与外层圆角玻璃沙箱材质浑然一体，告别突兀暗棕斜木棍）
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const w of engine.level.staticWalls || []) {
      const th = (w.thickness ?? 2) * sx;
      ctx.beginPath();
      ctx.moveTo(rx + w.x0 * sx, ry + w.y0 * sy);
      ctx.lineTo(rx + w.x1 * sx, ry + w.y1 * sy);
      ctx.strokeStyle = 'rgba(98, 110, 128, 0.52)';
      ctx.lineWidth = th * 2.15;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(244, 249, 255, 0.82)';
      ctx.lineWidth = th * 1.48;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.lineWidth = Math.max(1.15, th * 0.42);
      ctx.stroke();
    }

    ctx.restore(); // 结束基础内腔裁剪

    // 5. 绘制浅枫木奶油拨片杆身、香槟丝线联动绳与锁扣（位于厚玻璃壁之下，使穿墙拨片呈现真实透玻插槽感）
    const linkedGear = sprites.get('ui_linked_gear');

    const linkedIds = new Set<string>();
    const drawnPairs = new Set<string>();
    for (const b of engine.boards) {
      if (!b.linkedTo) continue;
      const partner = engine.boards.find(o => o.id === b.linkedTo);
      if (!partner) continue;
      linkedIds.add(b.id);
      linkedIds.add(partner.id);
      if (b.removed || partner.removed) continue;
      const pairKey = b.id < partner.id ? `${b.id}:${partner.id}` : `${partner.id}:${b.id}`;
      if (drawnPairs.has(pairKey)) continue;
      drawnPairs.add(pairKey);

      const ax = rx + (b.x0 + b.x1) * 0.5 * sx;
      const ay = ry + (b.y0 + b.y1) * 0.5 * sy;
      const bx = rx + (partner.x0 + partner.x1) * 0.5 * sx;
      const by = ry + (partner.y0 + partner.y1) * 0.5 * sy;
      const cpx = (ax + bx) * 0.5 + (ay === by ? 0 : 10);
      const cpy = (ay + by) * 0.5 - 8;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(cpx, cpy, bx, by);
      ctx.strokeStyle = 'rgba(94, 79, 70, 0.55)';
      ctx.lineWidth = 3.0;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.strokeStyle = '#F7DF9C';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [ex, ey] of [
        [ax, ay],
        [bx, by],
      ]) {
        ctx.fillStyle = '#FFFBF0';
        ctx.strokeStyle = '#5E4F46';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(ex, ey, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    interface OuterAttachment {
      b: BoardRuntime;
      wallOuterScreenX: number;
      anchorScreenY: number;
      outerDir: -1 | 1;
      bh: number;
      alpha: number;
      slideScreenX: number;
    }
    const outerAttachments: OuterAttachment[] = [];
    const wallSlotTicks: { xIn: number; xOut: number; y: number; halfH: number }[] = [];

    for (const b of engine.boards) {
      if (b.removed && b.pullAnimMs <= 0) continue;

      const minBx = Math.min(b.x0, b.x1);
      const maxBx = Math.max(b.x0, b.x1);
      const anchorGy = b.x0 <= b.x1 ? b.y0 : b.y1;
      const rightAnchorGy = b.x1 >= b.x0 ? b.y1 : b.y0;

      const leftInnerWallX = geom.leftWallInnerAtY(anchorGy);
      const rightInnerWallX = geom.rightWallInnerAtY(rightAnchorGy);
      const touchesLeftWall = minBx <= leftInnerWallX + 4.5;
      const touchesRightWall = maxBx >= rightInnerWallX - 4.5;
      const isHorizontal = Math.abs(b.y1 - b.y0) <= 2;

      const isLeftAnchored = touchesLeftWall && (!touchesRightWall || minBx < GW - maxBx);
      const outerDir: -1 | 1 = isLeftAnchored ? -1 : 1;
      const wallSideTouches = isLeftAnchored ? touchesLeftWall : touchesRightWall;

      let gx0 = b.x0;
      let gx1 = b.x1;
      const outerGy = isLeftAnchored ? anchorGy : rightAnchorGy;
      const wallOutGx = isLeftAnchored
        ? geom.leftWallOuterAtY(outerGy)
        : geom.rightWallOuterAtY(outerGy);
      const wallInGx = isLeftAnchored
        ? geom.leftWallInnerAtY(outerGy)
        : geom.rightWallInnerAtY(outerGy);

      if (isHorizontal && wallSideTouches && b.kind !== 'slant') {
        if (isLeftAnchored) {
          if (b.x0 <= b.x1) {
            gx0 = Math.min(gx0, wallOutGx + 0.4);
            if (touchesRightWall) gx1 = Math.max(gx1, rightInnerWallX + 0.3);
          } else {
            gx1 = Math.min(gx1, wallOutGx + 0.4);
            if (touchesRightWall) gx0 = Math.max(gx0, rightInnerWallX + 0.3);
          }
        } else {
          if (b.x1 >= b.x0) {
            gx1 = Math.max(gx1, wallOutGx - 0.4);
            if (touchesLeftWall) gx0 = Math.min(gx0, leftInnerWallX - 0.3);
          } else {
            gx0 = Math.max(gx0, wallOutGx - 0.4);
            if (touchesLeftWall) gx1 = Math.min(gx1, leftInnerWallX - 0.3);
          }
        }
      }

      const x0 = rx + gx0 * sx;
      const y0 = ry + b.y0 * sy;
      const x1 = rx + gx1 * sx;
      const y1 = ry + b.y1 * sy;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const bh = Math.max(10.5, 4.8 * sy);

      if (wallSideTouches && isHorizontal && b.kind !== 'slant') {
        wallSlotTicks.push({
          xIn: rx + wallInGx * sx,
          xOut: rx + wallOutGx * sx,
          y: ry + outerGy * sy,
          halfH: bh * 0.52,
        });
      }

      if (b.isOpen && !b.removed) {
        ctx.save();
        ctx.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5);
        ctx.rotate(angle);

        ctx.strokeStyle = 'rgba(92, 114, 102, 0.45)';
        ctx.lineWidth = Math.max(3.0, bh * 0.36);
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(-len * 0.5 + 4, 0);
        ctx.lineTo(len * 0.5 - 4, 0);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(235, 248, 238, 0.88)';
        ctx.lineWidth = Math.max(1.4, bh * 0.16);
        ctx.stroke();
        ctx.setLineDash([]);

        if (linkedIds.has(b.id) && linkedGear) {
          ctx.save();
          ctx.rotate(-angle);
          ctx.drawImage(linkedGear, -9, -9, 18, 18);
          ctx.restore();
        }
        ctx.restore();

        outerAttachments.push({
          b,
          wallOuterScreenX: rx + (wallSideTouches ? wallOutGx : isLeftAnchored ? minBx : maxBx) * sx,
          anchorScreenY: ry + outerGy * sy,
          outerDir,
          bh,
          alpha: 1,
          slideScreenX: 0,
        });
        continue;
      }

      let slideOffset = 0;
      let alpha = 1;
      if (b.removed && b.pullAnimMs > 0) {
        const progress = 1 - b.pullAnimMs / 120;
        slideOffset = outerDir * progress * progress * (len * 0.85 + 36);
        alpha = 1 - progress;
      } else if (!b.isOpen && b.pushAnimMs > 0) {
        const remain = b.pushAnimMs / 120;
        slideOffset = outerDir * remain * remain * (len * 0.65);
      }

      const pullEndSign: -1 | 1 =
        b.kind === 'slant'
          ? b.y0 <= b.y1
            ? -1
            : 1
          : isLeftAnchored
            ? b.x0 <= b.x1
              ? -1
              : 1
            : b.x1 >= b.x0
              ? 1
              : -1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5);
      ctx.rotate(angle);
      ctx.translate(slideOffset, 0);

      const slatVariant =
        b.kind === 'slant' ? 'slant' : b.startsOpen || b.reusable ? 'reusable' : 'maple';
      this.drawMinimalPullSlat(ctx, len, bh, slatVariant, pullEndSign);

      if (linkedIds.has(b.id) && !b.removed) {
        ctx.save();
        const gearOffsetX = b.lockColor ? 16 : 0;
        ctx.translate(gearOffsetX, 0);
        ctx.rotate(-angle);
        if (linkedGear) {
          ctx.drawImage(linkedGear, -10, -10, 20, 20);
        }
        ctx.restore();
      }

      if (b.lockColor && !b.removed) {
        const lockTint = this.getSandColorHex(b.lockColor, tokens);
        const lockImg = sprites.getTinted('ui_lock_badge', lockTint);
        const shakeRot = b.lockShakeMs > 0 ? Math.sin(b.lockShakeMs * 0.08) * 0.25 : 0;
        ctx.save();
        ctx.rotate(-angle + shakeRot);
        if (lockImg) {
          ctx.drawImage(lockImg, -12, -13, 24, 26);
        }
        ctx.restore();
      }
      ctx.restore();

      // 记录外壁极简奶油浅枫木圆扣（无「抽/推/拉」汉字挂牌）
      if (b.kind !== 'slant' && (wallSideTouches || b.reusable || !b.lockColor)) {
        const outX = wallSideTouches
          ? rx + wallOutGx * sx
          : rx + (isLeftAnchored ? minBx : maxBx) * sx;
        outerAttachments.push({
          b,
          wallOuterScreenX: outX,
          anchorScreenY: ry + outerGy * sy,
          outerDir,
          bh,
          alpha,
          slideScreenX: slideOffset * Math.cos(angle),
        });
      }
    }

    // 6. 绘制双轮廓半透明磨砂厚玻璃壁夹层
    ctx.save();

    // 6a. 奇偶环绕填充半透明月白磨砂厚玻璃壁体
    ctx.save();
    ctx.beginPath();
    this.traceCornerSubpath(ctx, geom.outerLoop, rx, ry, sx, sy, true);
    this.traceCornerSubpath(ctx, geom.innerLoop, rx, ry, sx, sy, true);

    const glassWallGrad = ctx.createLinearGradient(rx, ry, rx, ry + rh);
    glassWallGrad.addColorStop(0, 'rgba(205, 232, 252, 0.42)');
    glassWallGrad.addColorStop(0.15, 'rgba(166, 206, 238, 0.24)');
    glassWallGrad.addColorStop(0.82, 'rgba(166, 206, 238, 0.24)');
    glassWallGrad.addColorStop(1, 'rgba(198, 228, 250, 0.38)');
    ctx.fillStyle = glassWallGrad;
    ctx.fill('evenodd');

    ctx.clip('evenodd');

    const tlCx = rx + geom.topLeftInner[0] * sx;
    const tlCy = ry + geom.topLeftInner[1] * sy;
    const trCx = rx + geom.topRightInner[0] * sx;
    const trCy = ry + geom.topRightInner[1] * sy;
    for (const [cxCorner, cyCorner] of [
      [tlCx - 4, tlCy - 4],
      [trCx + 4, trCy - 4],
    ]) {
      const cGrad = ctx.createRadialGradient(cxCorner, cyCorner, 2, cxCorner, cyCorner, 34);
      cGrad.addColorStop(0, 'rgba(235, 248, 255, 0.78)');
      cGrad.addColorStop(1, 'rgba(235, 248, 255, 0)');
      ctx.fillStyle = cGrad;
      ctx.fillRect(cxCorner - 36, cyCorner - 36, 72, 72);
    }

    ctx.lineCap = 'round';
    ctx.lineWidth = 2.4 * sx;
    ctx.strokeStyle = 'rgba(232, 248, 255, 0.46)';
    ctx.beginPath();
    ctx.moveTo(rx + geom.leftSlopeMid[0][0] * sx, ry + geom.leftSlopeMid[0][1] * sy);
    ctx.lineTo(rx + geom.leftSlopeMid[1][0] * sx, ry + geom.leftSlopeMid[1][1] * sy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(210, 236, 255, 0.32)';
    ctx.beginPath();
    ctx.moveTo(rx + geom.rightSlopeMid[0][0] * sx, ry + geom.rightSlopeMid[0][1] * sy);
    ctx.lineTo(rx + geom.rightSlopeMid[1][0] * sx, ry + geom.rightSlopeMid[1][1] * sy);
    ctx.stroke();
    ctx.restore();

    // 6b. 玻璃壁穿墙插槽细刻度线
    ctx.strokeStyle = 'rgba(215, 238, 255, 0.46)';
    ctx.lineWidth = 1.15;
    for (const slot of wallSlotTicks) {
      ctx.beginPath();
      ctx.moveTo(slot.xOut, slot.y - slot.halfH);
      ctx.lineTo(slot.xIn, slot.y - slot.halfH);
      ctx.moveTo(slot.xOut, slot.y + slot.halfH);
      ctx.lineTo(slot.xIn, slot.y + slot.halfH);
      ctx.stroke();
    }

    // 6c. 玻璃内腔清透亮白折光边缘
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.traceCornerSubpath(ctx, geom.innerOpenLeftToRight, rx, ry, sx, sy, false);
    ctx.strokeStyle = 'rgba(228, 246, 255, 0.86)';
    ctx.lineWidth = 1.75;
    ctx.stroke();

    // 6d. 玻璃外壁晶莹双线轮廓（对齐《局内主界面》清透双层白青玻璃边）
    ctx.beginPath();
    const rLipInX = rx + geom.spoutInnerRightX * sx;
    const rLipOutX = rx + (geom.spoutInnerRightX + 3.6) * sx;
    const lLipInX = rx + geom.spoutInnerLeftX * sx;
    const lLipOutX = rx + (geom.spoutInnerLeftX - 3.6) * sx;
    const lipY = ry + geom.spoutTipY * sy;

    ctx.moveTo(rLipInX, lipY - 0.5);
    ctx.lineTo(rLipOutX, lipY - 0.5);
    this.traceCornerSubpath(ctx, geom.outerOpenRightToLeft, rx, ry, sx, sy, false, true);
    ctx.lineTo(lLipInX, lipY - 0.5);
    ctx.strokeStyle = 'rgba(18, 30, 52, 0.72)';
    ctx.lineWidth = 2.8;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(224, 244, 255, 0.90)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 6e. 倒梯形蜂蜜原木竖齿滤沙格栅（1:1 还原《局内主界面》底部原木梳齿滤口）
    const grateTopX = lLipOutX - 1;
    const grateTopW = Math.max(48, rLipOutX - lLipOutX + 2);
    const grateH = Math.max(10.5, 4.8 * sy);
    const grateY = lipY - grateH * 0.52;
    const taper = 5.5;

    const woodGrad = ctx.createLinearGradient(0, grateY, 0, grateY + grateH);
    woodGrad.addColorStop(0, '#F1CE9E');
    woodGrad.addColorStop(0.52, '#D7A770');
    woodGrad.addColorStop(1, '#B3804B');

    ctx.fillStyle = woodGrad;
    ctx.strokeStyle = '#3B2416';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(grateTopX, grateY);
    ctx.lineTo(grateTopX + grateTopW, grateY);
    ctx.lineTo(grateTopX + grateTopW - taper, grateY + grateH);
    ctx.lineTo(grateTopX + taper, grateY + grateH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 248, 232, 0.65)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(grateTopX + 3, grateY + 1.4);
    ctx.lineTo(grateTopX + grateTopW - 3, grateY + 1.4);
    ctx.stroke();

    const innerW = grateTopW - taper * 2 - 14;
    const slitCount = Math.max(20, Math.floor(innerW / 6.2));
    const slitStep = innerW / Math.max(1, slitCount - 1);
    for (let hIdx = 0; hIdx < slitCount; hIdx++) {
      const hx = grateTopX + taper + 7 + hIdx * slitStep;
      const hGridX = (hx - rx) / sx;
      let activeTint: string | null = null;
      for (let s = 0; s < 5; s++) {
        if (engine.slotPourMs[s] > 0 && Math.abs(engine.slotPourX[s] - hGridX) <= 9) {
          activeTint = this.getSandShades((engine.slotPourColor[s] || 1) as SandColorId).highlightHex;
          break;
        }
      }
      ctx.fillStyle = activeTint || '#3B2416';
      ctx.fillRect(hx - 0.9, grateY + 2.3, 1.8, Math.max(3.6, grateH - 4.6));
    }

    ctx.restore();

    // 7. 前层玻璃面板高光与贯穿反光带
    ctx.save();
    ctx.beginPath();
    this.traceCornerSubpath(ctx, geom.innerLoop, rx, ry, sx, sy, true);
    ctx.clip();

    const sheenLeftX = rx + (geom.topLeftInner[0] + 4.2) * sx;
    const sheenRightX = rx + (geom.topRightInner[0] - 4.8) * sx;
    const topGlintY = ry + (geom.topLeftInner[1] + 2.2) * sy;
    const botGlintY = ry + (geom.bottomFloorInnerY - 6) * sy;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(7, 3.4 * sx);
    ctx.beginPath();
    ctx.moveTo(sheenLeftX, topGlintY + 4);
    ctx.lineTo(sheenLeftX, botGlintY - 12);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(sheenLeftX - 2.2, topGlintY + 2);
    ctx.lineTo(sheenLeftX - 2.2, ry + 96 * sy);
    ctx.moveTo(sheenLeftX - 2.2, ry + 104 * sy);
    ctx.lineTo(sheenLeftX - 2.2, ry + 120 * sy);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = Math.max(5.5, 2.6 * sx);
    ctx.beginPath();
    ctx.moveTo(sheenRightX, topGlintY + 6);
    ctx.lineTo(sheenRightX, botGlintY - 18);
    ctx.stroke();

    const topBarGrad = ctx.createLinearGradient(0, ry + geom.topLeftInner[1] * sy, 0, ry + (geom.topLeftInner[1] + 5) * sy);
    topBarGrad.addColorStop(0, 'rgba(255, 255, 255, 0.30)');
    topBarGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = topBarGrad;
    ctx.fillRect(rx, ry + geom.topLeftInner[1] * sy, rw, 5.5 * sy);

    ctx.restore();

    // 隔空磁吸满瓶旋风视觉演出
    if (engine.vacuumAnimMs > 0) {
      const vt = engine.vacuumAnimMs / 450;
      const vcx = rx + 75 * sx;
      const vcy = ry + 112 * sy;
      ctx.save();
      ctx.translate(vcx, vcy);
      ctx.rotate(engine.frame * 0.45);
      ctx.strokeStyle = `rgba(246, 206, 108, ${0.88 * vt})`;
      ctx.lineWidth = 2.6;
      for (let ringIdx = 1; ringIdx <= 3; ringIdx++) {
        ctx.beginPath();
        ctx.arc(0, 0, ringIdx * 18 * (1.2 - 0.35 * vt), 0, Math.PI * 1.45);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 8. 在玻璃外壁外侧绘制日系极简奶油浅枫木圆扣（无文字）
    for (const att of outerAttachments) {
      const { b, wallOuterScreenX, anchorScreenY, outerDir, bh, alpha, slideScreenX } = att;
      ctx.save();
      ctx.globalAlpha = alpha;

      if (b.isOpen && !b.removed) {
        this.drawMinimalMapleKnob(ctx, wallOuterScreenX, anchorScreenY, outerDir, bh, 'push');
      } else if (b.reusable && !b.lockColor) {
        this.drawMinimalMapleKnob(
          ctx,
          wallOuterScreenX + slideScreenX,
          anchorScreenY,
          outerDir,
          bh,
          'reusable_pull'
        );
      } else if (!b.lockColor) {
        this.drawMinimalMapleKnob(
          ctx,
          wallOuterScreenX + slideScreenX,
          anchorScreenY,
          outerDir,
          bh,
          'pull'
        );
      }
      ctx.restore();
    }

    ctx.restore();
  }
}
