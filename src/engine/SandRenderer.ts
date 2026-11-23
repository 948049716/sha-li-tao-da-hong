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
import { SandWebGLRenderer } from './SandWebGLRenderer';

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

const SUB_SCALE = 2;
const SUB_W = GW * SUB_SCALE; // 300
const SUB_H = GH * SUB_SCALE; // 336

/**
 * 1:1 严格还原《局内主界面.webp》设计图的双线清透圆角玻璃沙箱与细腻水粉流沙渲染器：
 * 1. 容器造型：清透双轮廓圆角玻璃沙箱 + 沿物理斜坡收束的漏斗斗底 + 倒梯形蜂蜜原木梳齿滤口
 * 2. 流沙质感：原生 WebGL 高清 SDF 丝滑沙丘轮廓 + 2.5D 受光/背光坡面体积光影 + 视网膜级随流石英细砂肌理
 * 3. 兼容兜底：支持离屏 WebGL 全分辩率直出（GPU < 0.4ms），无 WebGL 环境自动回退 3 参数整幅 putImageData 2D 光栅
 */
interface CachedOuterAttachment {
  b: BoardRuntime;
  wallOuterScreenX: number;
  anchorScreenY: number;
  outerDir: -1 | 1;
  bh: number;
  alpha: number;
  slideScreenX: number;
}

interface CachedGrateMetrics {
  grateTopXOff: number;
  grateYOff: number;
  grateH: number;
  taper: number;
  slitCount: number;
  slitStep: number;
}

const VESSEL_CACHE_PAD = 16;

export class SandRenderer {
  private readonly createCanvasFn: () => HTMLCanvasElement;
  private glSand: SandWebGLRenderer | null = null;
  private offscreen: HTMLCanvasElement | null = null;
  private offCtx: CanvasRenderingContext2D | null = null;
  private imgData: ImageData | null = null;
  private buf32: Uint32Array = new Uint32Array(0);

  // 零 GC 预分配空间场缓冲（仅 2D 兜底路径使用）
  private visColor = new Uint8Array(TOTAL_CELLS);
  private visShade = new Uint8Array(TOTAL_CELLS);
  private solidMask = new Uint8Array(TOTAL_CELLS);
  private airDepth = new Uint8Array(TOTAL_CELLS);
  private airSmooth = new Uint8Array(TOTAL_CELLS);
  private aoWeight = new Uint8Array(TOTAL_CELLS);
  private surfColY = new Int16Array(GW);
  private surfSmoothY = new Int16Array(GW);
  private slopeCol = new Int8Array(GW);
  /** 逐格渲染输入签名（脏检测，签名不变则复用上一帧像素） */
  private cellKeyA = new Uint32Array(TOTAL_CELLS);
  private cellKeyB = new Uint32Array(TOTAL_CELLS);
  private rasterLevel: unknown = null;
  private rasterLoadGen = -1;
  private rasterGalaxy = false;
  /** 2x 超采样纸纹微噪表（-1..1，柔和细腻无竖纹） */
  private paperNoise = new Int8Array(SUB_W * SUB_H);
  /** 漏斗咽喉砂纹滚动位移（随实时出沙速率加速） */
  private funnelScroll = 0;
  /** O(1) 盘面变动修订号检测（取代每帧 18KB 全盘数组对比） */
  private srcEngine: SandEngine | null = null;
  private prevLoadGen = -1;
  private prevVisualRev = -1;
  /** 上一帧光栅化中带动画的格子数（流金闪烁等），为 0 且盘面静止时整帧跳过 */
  private lastAnimatedCells = 1;

  // 5 种沙色 × 64 档温润水粉色阶 + 柔和细砂色表
  private lut = new Uint32Array(6 * 64);
  private lutPebbleDark = new Uint32Array(6);
  private lutPebbleMid = new Uint32Array(6);
  private lutPebbleLight = new Uint32Array(6);
  private lutOutline = new Uint32Array(6);
  private lutOutlineSoft = new Uint32Array(6);
  private starCreamAbgr = packAbgr(255, 249, 224, 255);
  private iceBaseAbgr = new Uint32Array(6);
  private iceRimAbgr = new Uint32Array(6);
  private shadeInfo: Record<number, SandColorShades> = {};
  /** 玻璃几何体缓存（按容器模板，避免每帧重建路径数组造成 GC） */
  private glassVessel: VesselDef | null = null;
  private glassGeom: GlassVesselGeometry | null = null;

  /** 静态容器图层离屏缓存（彻底消除每帧 clip('evenodd')、渐变与静态几何重绘开销） */
  private vesselCacheKey = '';
  private vesselBackCanvas: HTMLCanvasElement | null = null;
  private vesselMidCanvas: HTMLCanvasElement | null = null;
  private hasVesselMidContent = false;
  private vesselFrontCanvas: HTMLCanvasElement | null = null;
  private cachedGrate: CachedGrateMetrics | null = null;
  private outerAttachmentsBuf: CachedOuterAttachment[] = [];

  constructor(tokens: UiTokensFile, createCanvasFn: () => HTMLCanvasElement) {
    this.createCanvasFn = createCanvasFn;
    this.buildLut(tokens);
    this.glSand = SandWebGLRenderer.tryCreate(tokens, createCanvasFn);
    if (!this.glSand) {
      const off = createCanvasFn();
      off.width = SUB_W;
      off.height = SUB_H;
      const ctx = off.getContext('2d');
      if (!ctx) throw new Error('无法创建离屏 2D 上下文');
      this.offscreen = off;
      this.offCtx = ctx;
      this.imgData = ctx.createImageData(SUB_W, SUB_H);
      this.buf32 = new Uint32Array(this.imgData.data.buffer);
      for (let gy2 = 0; gy2 < SUB_H; gy2++) {
        for (let gx2 = 0; gx2 < SUB_W; gx2++) {
          const h = ((gx2 * 374761393 + gy2 * 668265263) ^ (gx2 * gy2 * 1274126177)) >>> 0;
          this.paperNoise[gy2 * SUB_W + gx2] = ((h >> 11) % 3) - 1;
        }
      }
    }
  }

  private buildLut(tokens: UiTokensFile): void {
    const inkRgb = hexToRgb(tokens.theme.inkOutline || '#4E2E18');
    const creamRgb: [number, number, number] = [255, 249, 236];

    for (let cid = 1; cid <= 5; cid++) {
      const entry = tokens.sandPalette[String(cid)] as SandPaletteEntry | undefined;
      const baseRgb = hexToRgb(entry?.baseHex || '#EC9FA0');
      const hiRgb = hexToRgb(entry?.highlightHex || '#F7C9C4');
      const shRgb = hexToRgb(entry?.shadowHex || '#C46E70');

      const deepShadow = lerpRgb(shRgb, inkRgb, 0.06);
      // 鲜艳饱和：受光脊仅微量提亮（不再混入大比例奶白），保证彩沙浓郁不发灰发浅
      const crestBright = lerpRgb(hiRgb, creamRgb, cid === GOLD_SAND ? 0.18 : 0.04);

      for (let k = 0; k < 64; k++) {
        let rgb: [number, number, number];
        if (k < 14) {
          rgb = lerpRgb(deepShadow, shRgb, k / 14);
        } else if (k < 36) {
          rgb = lerpRgb(shRgb, baseRgb, (k - 14) / 22);
        } else if (k < 54) {
          rgb = lerpRgb(baseRgb, hiRgb, (k - 36) / 18);
        } else {
          rgb = lerpRgb(hiRgb, crestBright, (k - 54) / 9);
        }
        this.lut[cid * 64 + k] = packAbgr(rgb[0], rgb[1], rgb[2], 255);
      }

      const pebDark = lerpRgb(baseRgb, shRgb, cid === GOLD_SAND ? 0.5 : 0.4);
      const pebMid = lerpRgb(baseRgb, shRgb, 0.2);
      // 浅色细砂：同色相柔和提亮（取代刺眼白噪点）
      const pebLight = lerpRgb(baseRgb, hiRgb, cid === GOLD_SAND ? 0.7 : 0.42);
      const outline = lerpRgb(shRgb, inkRgb, 0.22);
      const outlineSoft = lerpRgb(baseRgb, shRgb, 0.38);

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
   * O(1) 检测盘面是否与上一帧不同（直接读取 SandEngine.visualRevision，避免每帧扫描 18KB 数组）。
   */
  private detectFieldChange(engine: SandEngine): boolean {
    let dirty = false;
    if (this.srcEngine !== engine) {
      this.srcEngine = engine;
      dirty = true;
    }
    if (engine.loadGeneration !== this.prevLoadGen) {
      this.prevLoadGen = engine.loadGeneration;
      dirty = true;
    }
    if (engine.visualRevision !== this.prevVisualRev) {
      this.prevVisualRev = engine.visualRevision;
      dirty = true;
    }
    if (engine.lastFlowParticles > 0 || engine.pourStreamMs > 0) {
      dirty = true;
    }
    return dirty;
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

    // 2. 下落与吸沙流内部微空隙双向弥合（纯显示，不改物理）：
    //    既弥合上下 1~3 格竖向下落间隙，也弥合两侧均为沙粒的单列微缝，彻底消灭沙堆内部透底竖纹！
    for (let y = 7; y < GH - 2; y++) {
      const row = y * GW;
      for (let x = 2; x < GW - 2; x++) {
        const i = row + x;
        if (g[i] !== EMPTY || !inter[i]) continue;
        const up1 = g[i - GW];
        const dn1 = g[i + GW];
        const lf1 = g[i - 1];
        const rt1 = g[i + 1];
        const a1 = isSand(up1);
        const a2 = !a1 && up1 === EMPTY && isSand(g[i - GW * 2]);
        const b1 = isSand(dn1);
        const b2 = !b1 && dn1 === EMPTY && isSand(g[i + GW * 2]);
        const b3 = !b1 && !b2 && y + 3 < GH && dn1 === EMPTY && g[i + GW * 2] === EMPTY && isSand(g[i + GW * 3]);

        const vertical = (a1 && (b1 || b2 || b3)) || (a2 && (b1 || b2));
        const narrowShaft = isSand(lf1) && isSand(rt1) && (a1 || b1);
        if (!vertical && !narrowShaft) continue;

        const src = a1 ? i - GW : b1 ? i + GW : isSand(lf1) ? i - 1 : a2 ? i - GW * 2 : i + GW * 2;
        vc[i] = g[src];
        vs[i] = sh[src] & 31;
        sm[i] = 1;
      }
    }

    // 3. 宽底滤网底缘贴合
    if (engine.lastFlowParticles > 0 || engine.pourStreamMs > 0) {
      this.funnelScroll = (this.funnelScroll + 0.7 + Math.min(50, engine.lastFlowParticles) * 0.05) % 1700;
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
          const gk = mod < 7 ? 5 : mod < 14 ? 6 : mod < 20 ? 7 : 0;
          vs[idx] = (gk << 5) | 16;
        }
      }
    }

    // 4. 逐列计算受光深度 airDepth、板下/箱底接触暗部 AO 与真实露天沙面高度
    //    关键修正：仅当连续开阔空气 >= 5 格且左右不处于单列窄井内时才重置顶光 depthAir=0，
    //    彻底根除吸沙或落沙时沙堆内部出现纵向发白亮条！
    for (let x = 1; x < GW - 1; x++) {
      let depthAir = 0; // 顶部初始即为开阔空气
      let underBoard = 0;
      let foundTop = false;
      let gapRun = 6;

      for (let y = 6; y < GH - 1; y++) {
        const i = y * GW + x;
        const rawV = g[i];
        const vCid = vc[i];
        if (rawV === EMPTY && inter[i] && vCid === 0) {
          gapRun++;
          const openSide = vc[i - 1] === 0 || vc[i + 1] === 0;
          if (gapRun >= 5 && openSide) {
            depthAir = 0;
          }
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
          if (x <= 8 || x >= GW - 9) localAo += 2;
          for (let dy = 1; dy <= 3; dy++) {
            const dv = y + dy < GH ? g[i + GW * dy] : WALL;
            if (dv === WALL || (dv >= BOARD_BASE && dv < FROZEN_BASE)) {
              localAo += (4 - dy) * 2;
              break;
            }
          }
          ao[i] = localAo > 12 ? 12 : localAo;
        }
      }
    }

    // 5. 横向双遍平滑 airDepth 与 5 点平滑沙脊坡向 slopeCol，彻底消除逐列明暗条纹
    const as = this.airSmooth;
    for (let y = 6; y < GH - 1; y++) {
      const row = y * GW;
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x;
        const c = vc[i];
        if (c < 1 || c > 5 || g[i] >= BOARD_BASE) {
          as[i] = ad[i];
          continue;
        }
        const a = ad[i];
        const l1 = vc[i - 1] >= 1 && vc[i - 1] <= 5 ? ad[i - 1] : a;
        const r1 = vc[i + 1] >= 1 && vc[i + 1] <= 5 ? ad[i + 1] : a;
        const l2 = x > 2 && vc[i - 2] >= 1 && vc[i - 2] <= 5 ? ad[i - 2] : l1;
        const r2 = x < GW - 3 && vc[i + 2] >= 1 && vc[i + 2] <= 5 ? ad[i + 2] : r1;
        as[i] = (l2 + 2 * l1 + 3 * a + 2 * r1 + r2 + 4) / 9;
      }
    }
    ad.set(as);

    const ssy = this.surfSmoothY;
    for (let x = 1; x < GW - 1; x++) {
      let sum = 0;
      let wSum = 0;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = Math.max(1, Math.min(GW - 2, x + dx));
        if (scy[nx] < GH) {
          const w = 3 - Math.abs(dx);
          sum += scy[nx] * w;
          wSum += w;
        }
      }
      ssy[x] = wSum > 0 ? Math.round(sum / wSum) : GH;
    }
    for (let x = 1; x < GW - 1; x++) {
      const yL = ssy[x > 3 ? x - 3 : x];
      const yR = ssy[x < GW - 4 ? x + 3 : x];
      this.slopeCol[x] = yR !== GH && yL !== GH ? Math.max(-2, Math.min(2, Math.round((yR - yL) * 0.4))) : 0;
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
    gx2: number,
    gy2: number,
    frame: number,
    galaxySkinActive: boolean
  ): number {
    const tone = rawShade & 31;
    const grainKind = rawShade >> 5;
    const paperNoise = this.paperNoise[gy2 * SUB_W + gx2];
    const crestBoost = depth < 5 ? Math.round((5 - depth) * 1.6) : 0;
    let k = 25 + ((tone * 16) >> 5) + crestBoost + slopeBias - aoVal + paperNoise;
    if (k < 0) k = 0;
    else if (k > 63) k = 63;

    if (galaxySkinActive && grainKind === 7 && ((gx2 * 13 + gy2 * 7 + (frame >> 2)) % 19) < 2) {
      return this.starCreamAbgr;
    }

    if (grainKind === 5 && depth >= 2 && sxSub === (tone & 1) && sySub === ((tone >> 1) & 1)) {
      return depth <= 3 ? this.lutPebbleMid[cid] : this.lutPebbleDark[cid];
    }
    if (grainKind === 6 && depth >= 1 && sxSub === ((tone >> 2) & 1) && sySub === (tone & 1)) {
      return this.lutPebbleMid[cid];
    }
    if (grainKind === 7 && sxSub === (tone & 1) && sySub === ((tone >> 1) & 1)) {
      if (cid === GOLD_SAND && ((tone + (frame >> 3)) & 7) === 0) {
        return this.starCreamAbgr;
      }
      return this.lutPebbleLight[cid];
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
   * 对齐《局内主界面》设计图：温润蜂蜜原木圆杆与立体斜切导流木板（带浅桦木顶面厚度边与细木纹）
   */
  private drawMinimalPullSlat(
    ctx: CanvasRenderingContext2D,
    len: number,
    bh: number,
    variant: 'maple' | 'slant' | 'reusable',
    _pullEndSign: -1 | 1 = -1
  ): void {
    const h = variant === 'slant' ? Math.max(11.0, bh * 0.98) : Math.max(9.2, bh * 0.86);
    const r = variant === 'slant' ? 2.2 : h * 0.44;
    const ink = '#3A2416';

    // 柔和下投影
    ctx.fillStyle = 'rgba(10, 16, 30, 0.24)';
    ctx.beginPath();
    roundRectPath(ctx, -len * 0.5, -h * 0.5 + 2.0, len, h, r);
    ctx.fill();

    if (variant === 'slant') {
      // 还原设计图斜导流木板：上层浅桦木受光顶面 + 下层暖蜜木侧厚面（平齐斜切木端，无突兀外挂球）
      ctx.fillStyle = '#C9955B';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      roundRectPath(ctx, -len * 0.5, -h * 0.5, len, h, r);
      ctx.fill();

      // 顶层浅奶油桦木受光面
      ctx.fillStyle = '#F2D5AC';
      ctx.beginPath();
      roundRectPath(ctx, -len * 0.5 + 0.8, -h * 0.5 + 0.8, len - 1.6, h * 0.42, 1.4);
      ctx.fill();

      // 顶面与侧面交界细线
      ctx.strokeStyle = 'rgba(110, 68, 32, 0.42)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-len * 0.5 + 1.5, -h * 0.06);
      ctx.lineTo(len * 0.5 - 1.5, -h * 0.06);
      ctx.stroke();

      // 外轮廓钢笔细线
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      roundRectPath(ctx, -len * 0.5, -h * 0.5, len, h, r);
      ctx.stroke();

      if (len >= 28) {
        ctx.strokeStyle = 'rgba(92, 54, 24, 0.22)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-len * 0.36, h * 0.2);
        ctx.bezierCurveTo(-len * 0.08, h * 0.1, len * 0.14, h * 0.3, len * 0.38, h * 0.18);
        ctx.stroke();
      }
      return;
    }

    const grad = ctx.createLinearGradient(0, -h * 0.5, 0, h * 0.5);
    if (variant === 'reusable') {
      grad.addColorStop(0, '#E4F6EA');
      grad.addColorStop(0.5, '#A6D7B7');
      grad.addColorStop(1, '#75A888');
    } else {
      grad.addColorStop(0, '#F3D6AE');
      grad.addColorStop(0.48, '#D7A772');
      grad.addColorStop(1, '#AC7946');
    }
    ctx.fillStyle = grad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.45;
    ctx.beginPath();
    roundRectPath(ctx, -len * 0.5, -h * 0.5, len, h, r);
    ctx.fill();
    ctx.stroke();

    // 顶部暖木高光边与手绘细木纹
    ctx.strokeStyle = 'rgba(255, 248, 232, 0.55)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(-len * 0.5 + r + 1, -h * 0.5 + 1.5);
    ctx.lineTo(len * 0.5 - r - 1, -h * 0.5 + 1.5);
    ctx.stroke();

    if (len >= 28) {
      ctx.strokeStyle = 'rgba(92, 54, 24, 0.22)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-len * 0.36, 0.6);
      ctx.bezierCurveTo(-len * 0.1, -0.8, len * 0.12, 1.4, len * 0.38, 0.2);
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
   * 2x 超采样流沙光栅化 + 脏行区间追踪（静止帧 0 字节上传，流动帧仅上传变动带）
   */
  private rasterize(engine: SandEngine, galaxySkinActive: boolean): [number, number] {
    const g = engine.grid;
    const inter = engine.interior;
    const vc = this.visColor;
    const vs = this.visShade;
    const sm = this.solidMask;
    const ad = this.airDepth;
    const ao = this.aoWeight;
    const b32 = this.buf32;
    const f = engine.frame;
    const vel = engine.vel;

    let dirtyMinY = GH;
    let dirtyMaxY = -1;
    let animatedCells = 0;
    if (
      engine.level !== this.rasterLevel ||
      engine.loadGeneration !== this.rasterLoadGen ||
      galaxySkinActive !== this.rasterGalaxy
    ) {
      this.rasterLevel = engine.level;
      this.rasterLoadGen = engine.loadGeneration;
      this.rasterGalaxy = galaxySkinActive;
      this.cellKeyA.fill(0);
      this.cellKeyB.fill(0);
      b32.fill(0);
      dirtyMinY = 0;
      dirtyMaxY = GH - 1;
    }
    const keyA = this.cellKeyA;
    const keyB = this.cellKeyB;
    const pn = this.paperNoise;
    const lut = this.lut;
    const slopeCol = this.slopeCol;

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
          if (
            vel[i + GW] >= 28 &&
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

        if (animated) animatedCells++;
        else if (kA === keyA[i] && kB === keyB[i]) continue;
        keyA[i] = kA;
        keyB[i] = animated ? 0 : kB;
        if (y < dirtyMinY) dirtyMinY = y;
        if (y > dirtyMaxY) dirtyMaxY = y;

        const o1 = o0 + SUB_W;
        b32[o0] = 0;
        b32[o0 + 1] = 0;
        b32[o1] = 0;
        b32[o1 + 1] = 0;
        if (mode === 0) continue;

        if (mode === 1) {
          const iceIdx = rawV - FROZEN_BASE;
          const ic = engine.ice[iceIdx];
          const iceCol = ic ? this.iceBaseAbgr[ic.color] : packAbgr(210, 240, 255, 238);
          const rimCol = ic ? this.iceRimAbgr[ic.color] : packAbgr(242, 252, 255, 248);
          const top = (kB & 1) === 1 ? rimCol : iceCol;
          b32[o0] = top;
          b32[o0 + 1] = top;
          b32[o1] = iceCol;
          b32[o1 + 1] = iceCol;
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
            const crestBoost = depth < 5 ? Math.round((5 - depth) * 1.6) : 0;
            const baseK = 25 + ((tone * 16) >> 5) + crestBoost + slopeDiff - aoVal;
            const lutBase = cid * 64;
            const outlineSoft = this.lutOutlineSoft[cid];
            for (let sySub = 0; sySub < 2; sySub++) {
              const gy2 = baseSubY + sySub;
              const outRow = o0 + sySub * SUB_W;
              for (let sxSub = 0; sxSub < 2; sxSub++) {
                const gx2 = baseSubX + sxSub;
                const o = outRow + sxSub;
                if (
                  (diffUp && sySub === 0 && ((gx2 * 19 + gy2 * 7) & 3) !== 0) ||
                  (diffLeft && sxSub === 0 && ((gx2 * 11 + gy2 * 23) & 3) !== 0)
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
                    gx2,
                    gy2,
                    f,
                    galaxySkinActive
                  );
                }
              }
            }
          } else {
            const topExposed = (kB & 1) !== 0;
            for (let sySub = 0; sySub < 2; sySub++) {
              const iy = sySub === 0 ? -GW : GW;
              const ay = 0.25;
              const gy2 = baseSubY + sySub;
              const outRow = o0 + sySub * SUB_W;

              for (let sxSub = 0; sxSub < 2; sxSub++) {
                const ix = sxSub === 0 ? -1 : 1;
                const ax = 0.25;
                const gx2 = baseSubX + sxSub;

                const density =
                  (1 - ax) * (1 - ay) +
                  ax * (1 - ay) * sm[i + ix] +
                  (1 - ax) * ay * sm[i + iy] +
                  ax * ay * sm[i + iy + ix];

                const grainHash = ((gx2 * 374761393 + gy2 * 668265263) ^ (rawShade * 2246822519)) >>> 0;
                const grainBump = ((grainHash & 31) / 31 - 0.46) * 0.14;
                const dEff = density + grainBump;

                if (dEff < 0.56) {
                  b32[outRow + sxSub] = 0;
                } else if (dEff < 0.64 && (topExposed || cDown === 0 || cLeft === 0 || cRight === 0)) {
                  b32[outRow + sxSub] = topExposed ? this.lutPebbleLight[cid] : this.lutOutlineSoft[cid];
                } else {
                  b32[outRow + sxSub] = this.sampleInteriorSubpixel(
                    cid,
                    rawShade,
                    depth,
                    aoVal,
                    slopeDiff,
                    sxSub,
                    sySub,
                    gx2,
                    gy2,
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
          const tc = g[i + GW];
          const dotCol = lut[tc * 64 + 32];
          b32[o1 + (x & 1)] = dotCol;
          continue;
        }

        // mode === 3：空格与沙体接壤处的圆润微颗粒过渡
        const sDown = vc[i + GW];
        const sUp = vc[i - GW];
        const isTopStep = sDown >= 1 && sDown <= 5 && sUp === 0;
        for (let sySub = 0; sySub < 2; sySub++) {
          const iy = sySub === 0 ? -GW : GW;
          const ay = 0.25;
          const gy2 = baseSubY + sySub;
          const outRow = o0 + sySub * SUB_W;

          for (let sxSub = 0; sxSub < 2; sxSub++) {
            const ix = sxSub === 0 ? -1 : 1;
            const ax = 0.25;
            const gx2 = baseSubX + sxSub;

            const density =
              ax * (1 - ay) * sm[i + ix] +
              (1 - ax) * ay * sm[i + iy] +
              ax * ay * sm[i + iy + ix];

            const grainHash = ((gx2 * 374761393 + gy2 * 668265263) ^ (refShade * 2246822519)) >>> 0;
            const grainBump = ((grainHash & 31) / 31 - 0.46) * 0.14;
            const dEff = density + grainBump;

            if (dEff >= 0.36) {
              b32[outRow + sxSub] = this.sampleInteriorSubpixel(
                fillCid,
                refShade,
                0,
                0,
                slopeDiff,
                sxSub,
                sySub,
                gx2,
                gy2,
                f,
                galaxySkinActive
              );
            } else if (dEff >= 0.28) {
              b32[outRow + sxSub] = isTopStep ? this.lutPebbleLight[fillCid] : this.lutOutlineSoft[fillCid];
            }
          }
        }
      }
    }
    this.lastAnimatedCells = animatedCells;
    return [dirtyMinY, dirtyMaxY];
  }

  private ensureVesselCaches(
    engine: SandEngine,
    geom: GlassVesselGeometry,
    rw: number,
    rh: number,
    cacheDpr: number
  ): boolean {
    const key = `${engine.level.levelId}|${engine.loadGeneration}|${rw.toFixed(1)}|${rh.toFixed(1)}|${cacheDpr.toFixed(2)}`;
    if (key === this.vesselCacheKey && this.vesselBackCanvas && this.vesselFrontCanvas) {
      return true;
    }

    const pad = VESSEL_CACHE_PAD;
    const cssW = rw + pad * 2;
    const cssH = rh + pad * 2;
    const pw = Math.max(1, Math.round(cssW * cacheDpr));
    const ph = Math.max(1, Math.round(cssH * cacheDpr));
    const lx = pad;
    const ly = pad;
    const sx = rw / GW;
    const sy = rh / GH;

    if (!this.vesselBackCanvas) this.vesselBackCanvas = this.createCanvasFn();
    if (!this.vesselFrontCanvas) this.vesselFrontCanvas = this.createCanvasFn();
    this.vesselBackCanvas.width = pw;
    this.vesselBackCanvas.height = ph;
    this.vesselFrontCanvas.width = pw;
    this.vesselFrontCanvas.height = ph;

    const bCtx = this.vesselBackCanvas.getContext('2d');
    const fCtx = this.vesselFrontCanvas.getContext('2d');
    if (!bCtx || !fCtx) return false;

    // --- 1. 静态底层缓存：外壁柔和投影 + 星夜玻璃底色 ---
    bCtx.save();
    bCtx.setTransform(cacheDpr, 0, 0, cacheDpr, 0, 0);
    bCtx.clearRect(0, 0, cssW, cssH);

    bCtx.save();
    bCtx.translate(0, 3.5);
    bCtx.beginPath();
    this.traceCornerSubpath(bCtx, geom.outerLoop, lx, ly, sx, sy, true);
    bCtx.strokeStyle = 'rgba(10, 14, 26, 0.28)';
    bCtx.lineWidth = 4;
    bCtx.stroke();
    bCtx.restore();

    bCtx.beginPath();
    this.traceCornerSubpath(bCtx, geom.innerLoop, lx, ly, sx, sy, true);
    bCtx.fillStyle = 'rgba(20, 36, 66, 0.18)';
    bCtx.fill();
    bCtx.restore();

    // --- 2. 静态中层缓存：内腔染色胶囊环 + 内部静态磨砂隔条 ---
    const staticWalls = engine.level.staticWalls || [];
    const hasMid = engine.dyeRings.length > 0 || staticWalls.length > 0;
    this.hasVesselMidContent = hasMid;
    if (hasMid) {
      if (!this.vesselMidCanvas) this.vesselMidCanvas = this.createCanvasFn();
      this.vesselMidCanvas.width = pw;
      this.vesselMidCanvas.height = ph;
      const mCtx = this.vesselMidCanvas.getContext('2d');
      if (mCtx) {
        mCtx.save();
        mCtx.setTransform(cacheDpr, 0, 0, cacheDpr, 0, 0);
        mCtx.clearRect(0, 0, cssW, cssH);
        mCtx.beginPath();
        this.traceCornerSubpath(mCtx, geom.innerLoop, lx, ly, sx, sy, true);
        mCtx.clip();

        for (const ring of engine.dyeRings) {
          const cx = lx + (ring.x0 + ring.x1) * 0.5 * sx;
          const cy = ly + (ring.y0 + ring.y1) * 0.5 * sy;
          const w = Math.max(42, (ring.x1 - ring.x0) * sx * 0.88);
          const h = Math.max(15, (ring.y1 - ring.y0) * sy * 1.55);
          const shades = this.getSandShades(ring.toColor);
          mCtx.save();

          const glowRx = w * 0.68;
          const glowRy = h * 1.25;
          mCtx.save();
          mCtx.translate(cx, cy);
          mCtx.scale(1, glowRy / glowRx);
          const glowGrad = mCtx.createRadialGradient(0, 0, glowRx * 0.22, 0, 0, glowRx);
          glowGrad.addColorStop(0, `${shades.highlightHex}58`);
          glowGrad.addColorStop(0.52, `${shades.baseHex}26`);
          glowGrad.addColorStop(1, 'rgba(255,255,255,0)');
          mCtx.fillStyle = glowGrad;
          mCtx.beginPath();
          mCtx.arc(0, 0, glowRx, 0, Math.PI * 2);
          mCtx.fill();
          mCtx.restore();

          mCtx.globalAlpha = 0.28;
          mCtx.fillStyle = shades.highlightHex;
          mCtx.beginPath();
          roundRectPath(mCtx, cx - w * 0.5, cy - h * 0.5, w, h, h * 0.5);
          mCtx.fill();

          mCtx.globalAlpha = 0.88;
          const rimThick = 3.2;
          const capGrad = mCtx.createLinearGradient(cx, cy - h * 0.5, cx, cy + h * 0.5);
          capGrad.addColorStop(0, '#E8FFF4');
          capGrad.addColorStop(0.4, shades.highlightHex);
          capGrad.addColorStop(1, shades.baseHex);
          mCtx.fillStyle = capGrad;
          mCtx.beginPath();
          roundRectPath(mCtx, cx - w * 0.5, cy - h * 0.5, w, h, h * 0.5);
          roundRectPath(
            mCtx,
            cx - w * 0.5 + rimThick,
            cy - h * 0.5 + rimThick,
            Math.max(4, w - rimThick * 2),
            Math.max(4, h - rimThick * 2),
            Math.max(2, h * 0.5 - rimThick)
          );
          mCtx.fill('evenodd');

          mCtx.globalAlpha = 0.92;
          mCtx.strokeStyle = '#1D4736';
          mCtx.lineWidth = 1.25;
          mCtx.beginPath();
          roundRectPath(mCtx, cx - w * 0.5, cy - h * 0.5, w, h, h * 0.5);
          mCtx.stroke();

          mCtx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
          mCtx.lineWidth = 1.3;
          mCtx.lineCap = 'round';
          mCtx.beginPath();
          mCtx.moveTo(cx - w * 0.34, cy - h * 0.5 + 1.8);
          mCtx.lineTo(cx + w * 0.34, cy - h * 0.5 + 1.8);
          mCtx.stroke();
          mCtx.restore();
        }

        for (const w of staticWalls) {
          const x0 = lx + w.x0 * sx;
          const y0 = ly + w.y0 * sy;
          const x1 = lx + w.x1 * sx;
          const y1 = ly + w.y1 * sy;
          const len = Math.hypot(x1 - x0, y1 - y0);
          const ang = Math.atan2(y1 - y0, x1 - x0);
          const barH = Math.max(6.5, (w.thickness ?? 2) * sx * 1.65);

          mCtx.save();
          mCtx.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5);
          mCtx.rotate(ang);
          const gBar = mCtx.createLinearGradient(0, -barH * 0.5, 0, barH * 0.5);
          gBar.addColorStop(0, 'rgba(236, 246, 255, 0.92)');
          gBar.addColorStop(0.55, 'rgba(202, 220, 238, 0.84)');
          gBar.addColorStop(1, 'rgba(164, 186, 208, 0.86)');
          mCtx.fillStyle = gBar;
          mCtx.strokeStyle = 'rgba(72, 92, 118, 0.68)';
          mCtx.lineWidth = 1.15;
          mCtx.beginPath();
          roundRectPath(mCtx, -len * 0.5, -barH * 0.5, len, barH, 1.5);
          mCtx.fill();
          mCtx.stroke();

          mCtx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
          mCtx.lineWidth = 1.0;
          mCtx.beginPath();
          mCtx.moveTo(-len * 0.5 + 2, -barH * 0.5 + 1.4);
          mCtx.lineTo(len * 0.5 - 2, -barH * 0.5 + 1.4);
          mCtx.stroke();
          mCtx.restore();
        }

        mCtx.restore();
      }
    }

    // --- 3. 静态前景玻璃层缓存：磨砂厚玻璃壁 (evenodd) + 插槽刻度 + 双线轮廓 + 原木滤栅底 + 顶沿反光 ---
    fCtx.save();
    fCtx.setTransform(cacheDpr, 0, 0, cacheDpr, 0, 0);
    fCtx.clearRect(0, 0, cssW, cssH);

    // 6a. 奇偶环绕填充半透明月白磨砂厚玻璃壁体
    fCtx.save();
    fCtx.beginPath();
    this.traceCornerSubpath(fCtx, geom.outerLoop, lx, ly, sx, sy, true);
    this.traceCornerSubpath(fCtx, geom.innerLoop, lx, ly, sx, sy, true);

    const glassWallGrad = fCtx.createLinearGradient(lx, ly, lx, ly + rh);
    glassWallGrad.addColorStop(0, 'rgba(205, 232, 252, 0.42)');
    glassWallGrad.addColorStop(0.15, 'rgba(166, 206, 238, 0.24)');
    glassWallGrad.addColorStop(0.82, 'rgba(166, 206, 238, 0.24)');
    glassWallGrad.addColorStop(1, 'rgba(198, 228, 250, 0.38)');
    fCtx.fillStyle = glassWallGrad;
    fCtx.fill('evenodd');
    fCtx.clip('evenodd');

    const tlCx = lx + geom.topLeftInner[0] * sx;
    const tlCy = ly + geom.topLeftInner[1] * sy;
    const trCx = lx + geom.topRightInner[0] * sx;
    const trCy = ly + geom.topRightInner[1] * sy;
    for (const [cxCorner, cyCorner] of [
      [tlCx - 4, tlCy - 4],
      [trCx + 4, trCy - 4],
    ]) {
      const cGrad = fCtx.createRadialGradient(cxCorner, cyCorner, 2, cxCorner, cyCorner, 34);
      cGrad.addColorStop(0, 'rgba(235, 248, 255, 0.78)');
      cGrad.addColorStop(1, 'rgba(235, 248, 255, 0)');
      fCtx.fillStyle = cGrad;
      fCtx.fillRect(cxCorner - 36, cyCorner - 36, 72, 72);
    }

    fCtx.lineCap = 'round';
    fCtx.lineWidth = 2.4 * sx;
    fCtx.strokeStyle = 'rgba(232, 248, 255, 0.46)';
    fCtx.beginPath();
    fCtx.moveTo(lx + geom.leftSlopeMid[0][0] * sx, ly + geom.leftSlopeMid[0][1] * sy);
    fCtx.lineTo(lx + geom.leftSlopeMid[1][0] * sx, ly + geom.leftSlopeMid[1][1] * sy);
    fCtx.stroke();
    fCtx.strokeStyle = 'rgba(210, 236, 255, 0.32)';
    fCtx.beginPath();
    fCtx.moveTo(lx + geom.rightSlopeMid[0][0] * sx, ly + geom.rightSlopeMid[0][1] * sy);
    fCtx.lineTo(lx + geom.rightSlopeMid[1][0] * sx, ly + geom.rightSlopeMid[1][1] * sy);
    fCtx.stroke();
    fCtx.restore();

    // 6b. 玻璃壁穿墙插槽细刻度线
    const bhSlot = Math.max(10.5, 4.8 * sy);
    fCtx.strokeStyle = 'rgba(215, 238, 255, 0.46)';
    fCtx.lineWidth = 1.15;
    for (const b of engine.boards) {
      if (b.kind === 'slant') continue;
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
      const wallSideTouches = isLeftAnchored ? touchesLeftWall : touchesRightWall;
      if (!wallSideTouches || !isHorizontal) continue;
      const outerGy = isLeftAnchored ? anchorGy : rightAnchorGy;
      const wallOutGx = isLeftAnchored
        ? geom.leftWallOuterAtY(outerGy)
        : geom.rightWallOuterAtY(outerGy);
      const wallInGx = isLeftAnchored
        ? geom.leftWallInnerAtY(outerGy)
        : geom.rightWallInnerAtY(outerGy);
      const xIn = lx + wallInGx * sx;
      const xOut = lx + wallOutGx * sx;
      const ySlot = ly + outerGy * sy;
      const halfH = bhSlot * 0.52;
      fCtx.beginPath();
      fCtx.moveTo(xOut, ySlot - halfH);
      fCtx.lineTo(xIn, ySlot - halfH);
      fCtx.moveTo(xOut, ySlot + halfH);
      fCtx.lineTo(xIn, ySlot + halfH);
      fCtx.stroke();
    }

    // 6c. 玻璃内腔清透亮白折光边缘
    fCtx.lineCap = 'round';
    fCtx.lineJoin = 'round';
    fCtx.beginPath();
    this.traceCornerSubpath(fCtx, geom.innerOpenLeftToRight, lx, ly, sx, sy, false);
    fCtx.strokeStyle = 'rgba(228, 246, 255, 0.86)';
    fCtx.lineWidth = 1.75;
    fCtx.stroke();

    // 6d. 玻璃外壁晶莹双线轮廓
    fCtx.beginPath();
    const rLipInX = lx + geom.spoutInnerRightX * sx;
    const rLipOutX = lx + (geom.spoutInnerRightX + 3.6) * sx;
    const lLipInX = lx + geom.spoutInnerLeftX * sx;
    const lLipOutX = lx + (geom.spoutInnerLeftX - 3.6) * sx;
    const lipY = ly + geom.spoutTipY * sy;

    fCtx.moveTo(rLipInX, lipY - 0.5);
    fCtx.lineTo(rLipOutX, lipY - 0.5);
    this.traceCornerSubpath(fCtx, geom.outerOpenRightToLeft, lx, ly, sx, sy, false, true);
    fCtx.lineTo(lLipInX, lipY - 0.5);
    fCtx.strokeStyle = 'rgba(18, 30, 52, 0.72)';
    fCtx.lineWidth = 2.8;
    fCtx.stroke();
    fCtx.strokeStyle = 'rgba(224, 244, 255, 0.90)';
    fCtx.lineWidth = 1.5;
    fCtx.stroke();

    // 6e. 倒梯形蜂蜜原木竖齿滤沙格栅（静态底与常态深棕梳齿）
    const grateTopX = lLipOutX - 1;
    const grateTopW = Math.max(48, rLipOutX - lLipOutX + 2);
    const grateH = Math.max(10.5, 4.8 * sy);
    const grateY = lipY - grateH * 0.52;
    const taper = 5.5;

    const woodGrad = fCtx.createLinearGradient(0, grateY, 0, grateY + grateH);
    woodGrad.addColorStop(0, '#F1CE9E');
    woodGrad.addColorStop(0.52, '#D7A770');
    woodGrad.addColorStop(1, '#B3804B');

    fCtx.fillStyle = woodGrad;
    fCtx.strokeStyle = '#3B2416';
    fCtx.lineWidth = 1.6;
    fCtx.beginPath();
    fCtx.moveTo(grateTopX, grateY);
    fCtx.lineTo(grateTopX + grateTopW, grateY);
    fCtx.lineTo(grateTopX + grateTopW - taper, grateY + grateH);
    fCtx.lineTo(grateTopX + taper, grateY + grateH);
    fCtx.closePath();
    fCtx.fill();
    fCtx.stroke();

    fCtx.strokeStyle = 'rgba(255, 248, 232, 0.65)';
    fCtx.lineWidth = 1.0;
    fCtx.beginPath();
    fCtx.moveTo(grateTopX + 3, grateY + 1.4);
    fCtx.lineTo(grateTopX + grateTopW - 3, grateY + 1.4);
    fCtx.stroke();

    const innerW = grateTopW - taper * 2 - 14;
    const slitCount = Math.max(20, Math.floor(innerW / 6.2));
    const slitStep = innerW / Math.max(1, slitCount - 1);
    const slitH = Math.max(3.6, grateH - 4.6);
    fCtx.fillStyle = '#3B2416';
    for (let hIdx = 0; hIdx < slitCount; hIdx++) {
      const hx = grateTopX + taper + 7 + hIdx * slitStep;
      fCtx.fillRect(hx - 0.9, grateY + 2.3, 1.8, slitH);
    }
    this.cachedGrate = {
      grateTopXOff: grateTopX - lx,
      grateYOff: grateY - ly,
      grateH,
      taper,
      slitCount,
      slitStep,
    };

    // 7. 顶沿轻薄玻璃反光细线
    fCtx.save();
    fCtx.beginPath();
    this.traceCornerSubpath(fCtx, geom.innerLoop, lx, ly, sx, sy, true);
    fCtx.clip();
    const topBarGrad = fCtx.createLinearGradient(
      0,
      ly + geom.topLeftInner[1] * sy,
      0,
      ly + (geom.topLeftInner[1] + 3.5) * sy
    );
    topBarGrad.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    topBarGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    fCtx.fillStyle = topBarGrad;
    fCtx.fillRect(lx, ly + geom.topLeftInner[1] * sy, rw, 3.5 * sy);
    fCtx.restore();

    fCtx.restore();
    this.vesselCacheKey = key;
    return true;
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

    let hostDpr = 2;
    try {
      if (typeof ctx.getTransform === 'function') {
        const m = ctx.getTransform();
        if (m && m.a > 0.5) hostDpr = m.a;
      } else if (ctx.canvas && ctx.canvas.width > 0) {
        hostDpr = ctx.canvas.width / Math.max(320, rw / 0.84);
      }
    } catch {
      // Ejecta 宿主若无 getTransform 则按默认倍率回退
    }

    // 1. O(1) 检测盘面变动 + 局部脏行子带上传：静止帧零 WebGL 开销，流动帧仅重算脏行带
    const fieldsDirty = this.detectFieldChange(engine);
    const [rawDirtyY0, rawDirtyY1] = engine.consumeRenderDirtyRange();
    const pourAnimActive = engine.lastFlowParticles > 0 || engine.pourStreamMs > 0;
    const dirtyY0 = pourAnimActive ? Math.min(rawDirtyY0, GH - 5) : rawDirtyY0;
    const dirtyY1 = pourAnimActive ? Math.max(rawDirtyY1, GH - 1) : rawDirtyY1;

    let sandSource: HTMLCanvasElement | null = null;
    if (this.glSand) {
      const sandDpr = Math.max(1.5, Math.min(1.75, hostDpr));
      sandSource = this.glSand.renderToSource(
        engine,
        rw * sandDpr,
        rh * sandDpr,
        fieldsDirty,
        dirtyY0,
        dirtyY1
      );
    } else if (this.offCtx && this.imgData) {
      if (fieldsDirty) this.prepareSandFields(engine);
      if (
        fieldsDirty ||
        this.lastAnimatedCells > 0 ||
        engine.level !== this.rasterLevel ||
        engine.loadGeneration !== this.rasterLoadGen
      ) {
        const [dirtyMinY, dirtyMaxY] = this.rasterize(engine, false);
        if (dirtyMaxY >= dirtyMinY) {
          this.offCtx.putImageData(this.imgData, 0, 0);
        }
      }
      sandSource = this.offscreen;
    }

    const vesselDpr = Math.max(1, Math.min(2.25, hostDpr));
    const cacheOk = this.ensureVesselCaches(engine, geom, rw, rh, vesselDpr);
    const pad = VESSEL_CACHE_PAD;

    ctx.save();

    // 3. 贴出预烘焙外壁阴影与星夜内腔底色（0 clip / 0 渐变）
    if (cacheOk && this.vesselBackCanvas) {
      ctx.drawImage(this.vesselBackCanvas, rx - pad, ry - pad, rw + pad * 2, rh + pad * 2);
    }

    // 4. 在玻璃内腔裁剪区内绘制：高清彩沙 + 预烘焙染色胶囊/磨砂隔条 + 动态冰砖
    ctx.save();
    ctx.beginPath();
    this.traceCornerSubpath(ctx, geom.innerLoop, rx, ry, sx, sy, true);
    ctx.clip();

    if (!cacheOk) {
      ctx.fillStyle = 'rgba(20, 36, 66, 0.18)';
      ctx.fillRect(rx, ry, rw, rh);
    }

    ctx.imageSmoothingEnabled = true;
    if (sandSource) {
      ctx.drawImage(sandSource, rx, ry, rw, rh);
    }

    if (cacheOk && this.hasVesselMidContent && this.vesselMidCanvas) {
      ctx.drawImage(this.vesselMidCanvas, rx - pad, ry - pad, rw + pad * 2, rh + pad * 2);
    }

    // 4e. 脆冰砖与万年寒冰（仅在存在未碎裂冰砖时执行）
    if (engine.ice.length > 0) {
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
        let origMinY = minY;
        if (polyPts) {
          origMinY = polyPts[0][1];
          for (let pIdx = 1; pIdx < polyPts.length; pIdx++) {
            if (polyPts[pIdx][1] < origMinY) origMinY = polyPts[pIdx][1];
          }
        }
        const dyShift = (minY - origMinY) * sy;

        const traceIceShape = () => {
          ctx.beginPath();
          if (polyPts) {
            for (let idx = 0; idx < polyPts.length; idx++) {
              const [px, py] = polyPts[idx];
              const cxp = rx + Math.max(minX, Math.min(maxX + 1, px)) * sx;
              const cyp = ry + py * sy + dyShift;
              if (idx === 0) ctx.moveTo(cxp, cyp);
              else ctx.lineTo(cxp, cyp);
            }
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
    }

    ctx.restore(); // 结束基础内腔裁剪

    // 5. 绘制浅枫木奶油拨片杆身、香槟丝线联动绳与锁扣（位于厚玻璃壁之下）
    const linkedGear = sprites.get('ui_linked_gear');
    let hasLinkedBoards = false;
    for (let i = 0; i < engine.boards.length; i++) {
      if (engine.boards[i].linkedTo) {
        hasLinkedBoards = true;
        break;
      }
    }

    if (hasLinkedBoards) {
      for (let i = 0; i < engine.boards.length; i++) {
        const b = engine.boards[i];
        if (!b.linkedTo || b.removed) continue;
        const partner = engine.boards.find(o => o.id === b.linkedTo);
        if (!partner || partner.removed || b.id > partner.id) continue;

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
    }

    const outerAttachments = this.outerAttachmentsBuf;
    outerAttachments.length = 0;

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
      const isLinked =
        hasLinkedBoards &&
        (Boolean(b.linkedTo) || engine.boards.some(o => o.linkedTo === b.id));

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

        if (isLinked && linkedGear) {
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

      if (isLinked && !b.removed) {
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

    // 6 & 7. 贴出预烘焙前景厚玻璃壁、双轮廓、原木滤栅与顶沿反光（彻底免除每帧 clip('evenodd') 与多重渐变）
    if (cacheOk && this.vesselFrontCanvas) {
      ctx.drawImage(this.vesselFrontCanvas, rx - pad, ry - pad, rw + pad * 2, rh + pad * 2);
    }

    // 6e-active. 仅当存在正在接沙的流束时，局部高亮对应格栅梳齿
    const anySlotPouring =
      engine.slotPourMs[0] > 0 ||
      engine.slotPourMs[1] > 0 ||
      engine.slotPourMs[2] > 0 ||
      engine.slotPourMs[3] > 0 ||
      engine.slotPourMs[4] > 0;
    if (anySlotPouring && this.cachedGrate) {
      const gm = this.cachedGrate;
      const grateTopX = rx + gm.grateTopXOff;
      const grateY = ry + gm.grateYOff;
      const slitH = Math.max(3.6, gm.grateH - 4.6);
      for (let hIdx = 0; hIdx < gm.slitCount; hIdx++) {
        const hx = grateTopX + gm.taper + 7 + hIdx * gm.slitStep;
        const hGridX = (hx - rx) / sx;
        for (let s = 0; s < 5; s++) {
          if (engine.slotPourMs[s] > 0 && Math.abs(engine.slotPourX[s] - hGridX) <= 9) {
            ctx.fillStyle = this.getSandShades((engine.slotPourColor[s] || 1) as SandColorId).highlightHex;
            ctx.fillRect(hx - 0.9, grateY + 2.3, 1.8, slitH);
            break;
          }
        }
      }
    }

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
    for (let i = 0; i < outerAttachments.length; i++) {
      const { b, wallOuterScreenX, anchorScreenY, outerDir, bh, alpha, slideScreenX } =
        outerAttachments[i];
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
