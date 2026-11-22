import { roundRectPath } from '../platform/CanvasPolyfill';
import type { BlindBoxConfig } from '../types/blindbox';
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

export interface SpoutStreamSegment {
  /** 漏斗底口起始网格 X（69.4 .. 79.6） */
  startGridX: number;
  /** 漏斗底口处流束半宽（网格单位，随真实流量缩放） */
  lipHalfGridW: number;
  /** 该股流沙的实际出沙速率（粒/步，约 0.06 .. 32） */
  flowRate: number;
  /** 沙色 ID */
  color: SandColorId;
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
  /** 每一行玻璃内腔可见左右边界网格列（用于漏斗底尖嘴真实沙量映射） */
  coneMinX: Uint8Array;
  coneMaxX: Uint8Array;
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
  /** 漏斗尖嘴真实过境沙粒缓冲（承接 OUTLET 在 y=154 提前吸走的真实沙粒，沿玻璃壁自然滑至 y=163 出口） */
  private throatColor = new Uint8Array(TOTAL_CELLS);
  private throatShade = new Uint8Array(TOTAL_CELLS);
  private lastThroatFrame = -1;
  private throatEpoch = -1;
  /** 漏斗底口 14 列（x=68..81）实时出沙流量 EMA 与沙色，驱动按真实沙量缩放的落沙柱 */
  private spoutColFlow = new Float32Array(14);
  private spoutColColor = new Uint8Array(14);
  private spoutColStepCnt = new Uint8Array(14);
  private spoutColStepCol = new Uint8Array(14);
  private spoutSegPool: [SpoutStreamSegment, SpoutStreamSegment] = [
    { startGridX: 74.5, lipHalfGridW: 2, flowRate: 0, color: 1 },
    { startGridX: 74.5, lipHalfGridW: 2, flowRate: 0, color: 1 },
  ];
  private spoutSegOut: SpoutStreamSegment[] = [];

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
    const leftSide = cc(ptsOf(0, [[5, 6], [5, 130]]));
    const rightSide = cc(ptsOf(1, [[144, 6], [144, 130]]));
    const leftSlope = cc(ptsOf(2, [[7, 128], [56, 158]]));
    const rightSlope = cc(ptsOf(3, [[142, 128], [93, 158]]));

    const topInnerY = 6.2;
    const topOuterY = 2.0;
    const wallThick = 4.2;
    const sideInset = 1.3; // 侧壁：玻璃内沿位于物理墙中心线内侧 1.3 格（与流沙外扩 1 格无缝衔接）
    const slopeInset = 2.2; // 斜坡墙更厚（thickness 3），内沿相应内收

    const spoutTipY = 164.2;
    const spoutNeckLeftIn = 57.5;
    const spoutNeckRightIn = 91.5;
    const spoutNeckLeftOut = 53.8;
    const spoutNeckRightOut = 95.2;
    const spoutTipLeftIn = 69.2;
    const spoutTipRightIn = 79.8;
    const spoutTipLeftOut = 65.6;
    const spoutTipRightOut = 83.4;

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
      // 斗底斜面玻璃夹层中线（用于斜切面明暗）
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

    // 圆角：顶角 15/22，侧壁折点与侧壁-斜坡转角 12/15，漏斗颈 4.5/5.5
    const toCorner = (pts: P2[], topR: number, midR: number, neckR: number): CornerPoint[] =>
      pts.map(([x, y], i) => ({
        x,
        y,
        rPx: i === 0 ? topR : i === pts.length - 1 ? neckR : midR,
      }));
    const leftInC = toCorner(L.inner, 15, 12, 4.5);
    const rightInC = toCorner(R.inner, 15, 12, 4.5);
    const leftOutC = toCorner(L.outer, 22, 15, 5.5);
    const rightOutC = toCorner(R.outer, 22, 15, 5.5);

    // 内腔闭合轮廓（用于裁剪流沙与前玻璃反光）
    const innerLoop: CornerPoint[] = [
      ...leftInC,
      { x: spoutTipLeftIn, y: spoutTipY + 0.6, rPx: 0 },
      { x: spoutTipRightIn, y: spoutTipY + 0.6, rPx: 0 },
      ...[...rightInC].reverse(),
    ];

    // 外壁闭合轮廓（用于容器外投影与半透明厚玻璃夹层奇偶填充）
    const outerLoop: CornerPoint[] = [
      ...leftOutC,
      { x: spoutTipLeftOut, y: spoutTipY + 0.3, rPx: 2.5 },
      { x: spoutTipRightOut, y: spoutTipY + 0.3, rPx: 2.5 },
      ...[...rightOutC].reverse(),
    ];

    // 内腔敞口描边路径（从左漏斗尖嘴内沿 -> 左斗底 -> 左壁 -> 顶梁 -> 右壁 -> 右斗底 -> 右漏斗尖嘴内沿）
    const innerOpenLeftToRight: CornerPoint[] = [
      { x: spoutTipLeftIn, y: spoutTipY, rPx: 0 },
      ...[...leftInC].reverse(),
      ...rightInC,
      { x: spoutTipRightIn, y: spoutTipY, rPx: 0 },
    ];

    // 外壁敞口描边路径（从右漏斗尖嘴外沿 -> 右斗底 -> 右壁 -> 顶梁 -> 左壁 -> 左斗底 -> 左漏斗尖嘴外沿）
    const outerOpenRightToLeft: CornerPoint[] = [
      { x: spoutTipRightOut, y: spoutTipY, rPx: 0 },
      ...[...rightOutC].reverse(),
      ...leftOutC,
      { x: spoutTipLeftOut, y: spoutTipY, rPx: 0 },
    ];

    const leftCornerY = L.inner[L.inner.length - 2][1];
    const rightCornerY = R.inner[R.inner.length - 2][1];

    const leftFullPts: P2[] = [...L.inner, [spoutTipLeftIn, spoutTipY + 0.6]];
    const rightFullPts: P2[] = [...R.inner, [spoutTipRightIn, spoutTipY + 0.6]];
    const coneMinX = new Uint8Array(GH);
    const coneMaxX = new Uint8Array(GH);
    for (let y = 0; y < GH; y++) {
      const glL = samplePolylineXAtY(leftFullPts, y + 0.5);
      const glR = samplePolylineXAtY(rightFullPts, y + 0.5);
      coneMinX[y] = Math.max(3, Math.ceil(glL + 0.25));
      coneMaxX[y] = Math.min(GW - 4, Math.floor(glR - 0.25));
    }

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
      coneMinX,
      coneMaxX,
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
   * 推进漏斗尖嘴真实过境沙粒（0 GC，绝不改动引擎状态或随机数）：
   * 物理引擎在 y=154..163 提前吸走的沙粒在此沿玻璃内壁继续自然滑落至 y=163 出口，并统计底口各列真实出沙速率。
   */
  private stepVisualThroat(engine: SandEngine, geom: GlassVesselGeometry): void {
    if (engine.stateEpoch !== this.throatEpoch || engine.frame < this.lastThroatFrame) {
      this.throatEpoch = engine.stateEpoch;
      this.lastThroatFrame = engine.frame;
      this.throatColor.fill(0);
      this.throatShade.fill(0);
      this.spoutColFlow.fill(0);
      this.spoutColColor.fill(0);
    }

    let stepsDelta = engine.frame - this.lastThroatFrame;
    this.lastThroatFrame = engine.frame;
    if (stepsDelta <= 0 && engine.won) {
      // 通关结算延时期间 engine.frame 不再递增，让尖嘴内最后几粒余沙自然流尽并收束流柱
      let anyLeft = false;
      for (let k = 0; k < 14; k++) {
        if (this.spoutColFlow[k] >= 0.04) {
          anyLeft = true;
          break;
        }
      }
      if (!anyLeft) {
        for (let y = 154; y <= 163 && !anyLeft; y++) {
          const row = y * GW;
          for (let x = geom.coneMinX[y]; x <= geom.coneMaxX[y]; x++) {
            if (this.throatColor[row + x] !== 0) {
              anyLeft = true;
              break;
            }
          }
        }
      }
      if (anyLeft) stepsDelta = 1;
    }
    if (stepsDelta <= 0) return;

    const tc = this.throatColor;
    const ts = this.throatShade;
    const cMin = geom.coneMinX;
    const cMax = geom.coneMaxX;
    const stepCnt = this.spoutColStepCnt;
    const stepCol = this.spoutColStepCol;
    stepCnt.fill(0);
    stepCol.fill(0);

    // 1. 注入本帧被 OUTLET 吸走的真实沙粒（保持原有的左右分布与颗粒色阶；若咽喉已满则直接计入溢出出沙量，100% 质量守恒）
    const dvCount = engine.drainVisCount;
    const dvBuf = engine.drainVisBuf;
    engine.drainVisCount = 0;
    for (let k = 0; k < dvCount; k++) {
      const o = k * 4;
      const px = dvBuf[o];
      const py = dvBuf[o + 1];
      const col = dvBuf[o + 2];
      const shd = dvBuf[o + 3];
      const y0 = py < 154 ? 154 : py > 163 ? 163 : py;
      const l0 = cMin[y0];
      const r0 = cMax[y0];
      const u = (px - 58) / 33;
      let xv = Math.round(l0 + u * (r0 - l0));
      if (xv < l0) xv = l0;
      else if (xv > r0) xv = r0;

      let placed = false;
      const firstDir = px < 75 ? 1 : -1;
      for (let dyStep = 0; dyStep < 5 && !placed; dyStep++) {
        const dy = dyStep === 0 ? 0 : dyStep === 1 ? -1 : dyStep === 2 ? 1 : dyStep === 3 ? -2 : 2;
        const yy = y0 + dy;
        if (yy < 154 || yy > 163) continue;
        const ly = cMin[yy];
        const ry = cMax[yy];
        const row = yy * GW;
        for (let d = 0; d <= 3 && !placed; d++) {
          for (let s = 0; s < 2; s++) {
            if (d === 0 && s === 1) break;
            const xx = xv + (s === 0 ? firstDir : -firstDir) * d;
            if (xx >= ly && xx <= ry && tc[row + xx] === 0) {
              tc[row + xx] = col;
              ts[row + xx] = shd;
              placed = true;
              break;
            }
          }
        }
      }
      if (!placed) {
        const bin = Math.max(0, Math.min(13, Math.round(u * 13)));
        if (stepCnt[bin] < 255) stepCnt[bin]++;
        stepCol[bin] = col;
      }
    }

    // 2. 沿玻璃漏斗斜壁以与主物理一致的 2 子步/帧滑落推进至 y=163 尖嘴出口（保持上下斜坡流束厚度连续一致）
    const runSteps = stepsDelta > 2 ? 2 : stepsDelta;
    for (let st = 0; st < runSteps; st++) {
      for (let sub = 0; sub < 2; sub++) {
        const row163 = 163 * GW;
        const l163 = cMin[163];
        const r163 = cMax[163];
        for (let x = l163; x <= r163; x++) {
          const c = tc[row163 + x];
          if (c !== 0) {
            tc[row163 + x] = 0;
            ts[row163 + x] = 0;
            const bin = Math.max(0, Math.min(13, Math.round(((x - l163) * 13) / Math.max(1, r163 - l163))));
            if (stepCnt[bin] < 255) stepCnt[bin]++;
            stepCol[bin] = c;
          }
        }
        const leftFirst = ((engine.frame + st + sub) & 1) === 0;
        for (let y = 162; y >= 154; y--) {
          const l0 = cMin[y];
          const r0 = cMax[y];
          const l1 = cMin[y + 1];
          const r1 = cMax[y + 1];
          const row0 = y * GW;
          const row1 = (y + 1) * GW;
          for (let q = l0; q <= r0; q++) {
            const x = leftFirst ? q : l0 + r0 - q;
            const i = row0 + x;
            const c = tc[i];
            if (c === 0) continue;
            const inDir = x < 74.5 ? 1 : -1;
            for (let m = 0; m < 4; m++) {
              const nx = m === 0 ? x : m === 1 ? x + inDir : m === 2 ? x + inDir * 2 : x - inDir;
              if (nx >= l1 && nx <= r1 && tc[row1 + nx] === 0) {
                tc[row1 + nx] = c;
                ts[row1 + nx] = ts[i];
                tc[i] = 0;
                ts[i] = 0;
                break;
              }
            }
          }
        }
      }
    }

    const invSteps = 1 / runSteps;
    for (let k = 0; k < 14; k++) {
      const perStep = stepCnt[k] * invSteps;
      let next = this.spoutColFlow[k] * 0.78 + perStep * 0.22;
      if (next < 0.015) next = 0;
      this.spoutColFlow[k] = next;
      if (stepCnt[k] > 0) this.spoutColColor[k] = stepCol[k];
    }
  }

  /** 是否存在正在从漏斗底嘴流出的真实沙流 */
  public hasActiveSpoutFlow(): boolean {
    for (let k = 0; k < 14; k++) {
      if (this.spoutColFlow[k] >= 0.06) return true;
    }
    return false;
  }

  /**
   * 获取漏斗底口实时流沙束（0~2 股，零分配复用缓冲）：
   * - 大流量满口倾泻时合并为 1 股饱满宽沙柱；
   * - 双侧斜壁残沙细流滑下时自然分为左右 2 股纤细沙线；
   * - 单侧滑下时锚定在该侧底唇，无沙流出时返回空数组。
   */
  public getSpoutStreams(fallbackColor: SandColorId | 0): readonly SpoutStreamSegment[] {
    const out = this.spoutSegOut;
    out.length = 0;
    const flow = this.spoutColFlow;
    const cols = this.spoutColColor;

    // 扫描连续活跃列区间（允许 <=2 列微小间隙合并，避免湍流闪烁；左右远隔细流则自然保持 2 股）
    let s0 = -1;
    let e0 = -1;
    let s1 = -1;
    let e1 = -1;
    let k = 0;
    while (k < 14) {
      if (flow[k] < 0.06) {
        k++;
        continue;
      }
      const start = k;
      let end = k;
      while (k < 14) {
        if (flow[k] >= 0.06) {
          end = k;
          k++;
        } else if (k + 1 < 14 && flow[k + 1] >= 0.06) {
          end = k + 1;
          k += 2;
        } else if (k + 2 < 14 && flow[k + 2] >= 0.06) {
          end = k + 2;
          k += 3;
        } else {
          break;
        }
      }
      if (s0 < 0) {
        s0 = start;
        e0 = end;
      } else if (s1 < 0) {
        s1 = start;
        e1 = end;
      } else {
        e1 = end;
      }
    }
    if (s0 < 0) return out;

    const fillSeg = (slot: number, a: number, b: number): void => {
      let sumF = 0;
      let sumX = 0;
      const cWeights = [0, 0, 0, 0, 0, 0];
      for (let i = a; i <= b; i++) {
        const f = flow[i];
        if (f <= 0) continue;
        const gx = 69.5 + (i / 13) * 10.0;
        sumF += f;
        sumX += gx * f;
        const c = cols[i];
        if (c >= 1 && c <= 5) cWeights[c] += f;
      }
      if (sumF < 0.06) return;
      let bestC = (fallbackColor || 1) as SandColorId;
      let bestW = -1;
      for (let c = 1; c <= 5; c++) {
        if (cWeights[c] > bestW && cWeights[c] > 0) {
          bestW = cWeights[c];
          bestC = c as SandColorId;
        }
      }
      const binCount = b - a + 1;
      const spanGridW = binCount * (10.2 / 14);
      const densityScale = Math.min(1, 0.34 + 0.66 * Math.min(1, sumF / Math.max(1.4, binCount * 1.35)));
      const seg = this.spoutSegPool[slot];
      seg.startGridX = sumX / sumF;
      seg.lipHalfGridW = Math.max(0.42, Math.min(5.0, spanGridW * 0.5 * densityScale));
      seg.flowRate = sumF;
      seg.color = bestC;
      out.push(seg);
    };

    fillSeg(0, s0, e0);
    if (s1 >= 0) fillSeg(1, s1, e1);
    return out;
  }

  /**
   * 预计算当前帧流沙空间体积光影场 + 下落缝隙弥合 + 漏斗尖嘴真实沙量映射（0 GC，100% 不改动物理）
   */
  private prepareSandFields(engine: SandEngine, geom: GlassVesselGeometry): void {
    this.stepVisualThroat(engine, geom);

    const g = engine.grid;
    const sh = engine.shade;
    const inter = engine.interior;
    const vc = this.visColor;
    const vs = this.visShade;
    const sm = this.solidMask;
    const ad = this.airDepth;
    const ao = this.aoWeight;
    const scy = this.surfColY;
    const cMin = geom.coneMinX;
    const cMax = geom.coneMaxX;

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

    // 3. 漏斗尖嘴真实沙量映射与过境滑落显示（彻底移除旧版固定高度假滚动遮挡块）：
    //    - 静态堵口沙 / 大流量堆积沙：将 y=156..163 物理喉道 [pL..pR] 等比映射至可见玻璃锥口 [coneMinX..coneMaxX]，
    //      哪怕只有十几粒残沙也真实停在尖嘴底部且静止不动；
    //    - 正在排出的细流：叠加 throatColor 中沿左右斜壁滑向底口的真实过境沙粒。
    const tc = this.throatColor;
    const ts = this.throatShade;
    for (let y = 156; y <= 163; y++) {
      const row = y * GW;
      let pL = 58;
      let pR = 91;
      while (pL < 75 && !inter[row + pL]) pL++;
      while (pR > 75 && !inter[row + pR]) pR--;

      for (let x = 55; x <= 94; x++) {
        const idx = row + x;
        const gv = g[idx];
        if (gv < BOARD_BASE && gv !== WALL) {
          vc[idx] = 0;
          sm[idx] = 0;
        }
      }

      const l = cMin[y];
      const r = cMax[y];
      for (let x = 54; x < l; x++) sm[row + x] = 1;
      for (let x = r + 1; x <= 95; x++) sm[row + x] = 1;

      const vSpan = Math.max(1, r - l);
      const pSpan = Math.max(1, pR - pL);
      for (let xv = l; xv <= r; xv++) {
        const xp = Math.round(pL + ((xv - l) * pSpan) / vSpan);
        const srcIdx = row + xp;
        const c = g[srcIdx];
        if (isSand(c)) {
          const dst = row + xv;
          vc[dst] = c;
          vs[dst] = sh[srcIdx];
          sm[dst] = 1;
        }
      }
      for (let xp = pL; xp <= pR; xp++) {
        const srcIdx = row + xp;
        const c = g[srcIdx];
        if (!isSand(c)) continue;
        const xv = l + Math.round(((xp - pL) * vSpan) / pSpan);
        const dst = row + xv;
        if (vc[dst] === 0) {
          vc[dst] = c;
          vs[dst] = sh[srcIdx];
          sm[dst] = 1;
        }
      }
    }

    for (let y = 154; y <= 163; y++) {
      const row = y * GW;
      const l = cMin[y];
      const r = cMax[y];
      for (let xv = l; xv <= r; xv++) {
        const dst = row + xv;
        if (vc[dst] === 0 && tc[dst] !== 0) {
          vc[dst] = tc[dst];
          vs[dst] = ts[dst];
          sm[dst] = 1;
        }
      }
      // 紧贴漏斗尖嘴斜玻璃壁向壁内延展，消除 dx/dy≈1.5 斜率下的 1 格跳步缝隙与超采样细流侵蚀
      const leftSrc = vc[row + l] !== 0 ? row + l : vc[row + l + 1] !== 0 ? row + l + 1 : -1;
      if (leftSrc >= 0) {
        const leftCid = vc[leftSrc];
        const leftSh = vs[leftSrc];
        if (vc[row + l] === 0) {
          vc[row + l] = leftCid;
          vs[row + l] = leftSh;
          sm[row + l] = 1;
        }
        if (vc[row + l + 1] === 0 && (tc[row + l] !== 0 || tc[row + l + 1] !== 0)) {
          vc[row + l + 1] = leftCid;
          vs[row + l + 1] = leftSh;
          sm[row + l + 1] = 1;
        }
        for (let k = 1; k <= 3; k++) {
          vc[row + l - k] = leftCid;
          vs[row + l - k] = leftSh;
          sm[row + l - k] = 1;
        }
      }
      const rightSrc = vc[row + r] !== 0 ? row + r : vc[row + r - 1] !== 0 ? row + r - 1 : -1;
      if (rightSrc >= 0) {
        const rightCid = vc[rightSrc];
        const rightSh = vs[rightSrc];
        if (vc[row + r] === 0) {
          vc[row + r] = rightCid;
          vs[row + r] = rightSh;
          sm[row + r] = 1;
        }
        if (vc[row + r - 1] === 0 && (tc[row + r] !== 0 || tc[row + r - 1] !== 0)) {
          vc[row + r - 1] = rightCid;
          vs[row + r - 1] = rightSh;
          sm[row + r - 1] = 1;
        }
        for (let k = 1; k <= 3; k++) {
          vc[row + r + k] = rightCid;
          vs[row + r + k] = rightSh;
          sm[row + r + k] = 1;
        }
      }
    }

    // 底口 y=164 衔接行：与 y=163 保持一致，消除底唇暗轮廓线并与落沙柱无缝相接
    for (let x = 65; x <= 84; x++) {
      const src = 163 * GW + x;
      const dst = 164 * GW + x;
      vc[dst] = vc[src];
      vs[dst] = vs[src];
      sm[dst] = sm[src];
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
            const yy = y + dy;
            const dv = yy < GH ? g[i + GW * dy] : WALL;
            const hitsConeWall = yy >= 155 && yy < GH && (x < cMin[yy] || x > cMax[yy]);
            if (dv === WALL || hitsConeWall || (dv >= BOARD_BASE && dv < FROZEN_BASE)) {
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
   * 绘制 gameplay_ref.jpg 同款外壁雕花圆盘卡箍木拉手（圆木卡箍紧贴外壁 + 车削弧颈 + 六瓣小花木球）
   */
  private drawCarvedOuterHandle(
    ctx: CanvasRenderingContext2D,
    wallOuterScreenX: number,
    anchorScreenY: number,
    outerDir: -1 | 1,
    bh: number,
    inkHex: string
  ): void {
    ctx.save();
    ctx.translate(wallOuterScreenX, anchorScreenY);
    if (outerDir > 0) {
      ctx.scale(-1, 1); // 统一在向左侧 (-X) 伸出的局部坐标系中绘制
    }

    const collarW = 4.6;
    const collarH = Math.max(15, bh * 1.38);
    const bulbCx = -19.5;
    const bulbR = 7.6;

    // 柔和底部投影
    ctx.fillStyle = 'rgba(28, 14, 5, 0.24)';
    ctx.beginPath();
    ctx.arc(bulbCx, 2.2, bulbR + 1, 0, Math.PI * 2);
    ctx.fill();

    // 1. 车削葫芦形木拉手主体（弧颈 + 饱满圆球）
    const woodGrad = ctx.createLinearGradient(0, -bulbR, 0, bulbR);
    woodGrad.addColorStop(0, '#F3C283');
    woodGrad.addColorStop(0.45, '#C8843E');
    woodGrad.addColorStop(1, '#7D481B');

    ctx.fillStyle = woodGrad;
    ctx.strokeStyle = inkHex;
    ctx.lineWidth = 2.0;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-collarW + 0.5, -collarH * 0.32);
    ctx.quadraticCurveTo(-10.5, -3.4, bulbCx + 4.5, -bulbR * 0.84);
    ctx.arc(bulbCx, 0, bulbR, -0.98, Math.PI * 2 + 0.98, true);
    ctx.quadraticCurveTo(-10.5, 3.4, -collarW + 0.5, collarH * 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 球面暖高光弯月
    ctx.strokeStyle = 'rgba(255, 240, 208, 0.55)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(bulbCx, 0, bulbR - 2.1, -Math.PI * 0.78, -Math.PI * 0.25);
    ctx.stroke();

    // 2. 六瓣手绘木雕小花纹（1:1 复刻 ref_jar_left_pins.png 木球端面雕花！）
    ctx.fillStyle = '#F7D9A8';
    ctx.strokeStyle = '#522C12';
    ctx.lineWidth = 1.05;
    for (let p = 0; p < 6; p++) {
      const ang = (p * Math.PI) / 3;
      const px = bulbCx - 0.6 + Math.cos(ang) * 3.1;
      const py = Math.sin(ang) * 3.1;
      ctx.beginPath();
      ctx.arc(px, py, 1.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#6E3B16';
    ctx.beginPath();
    ctx.arc(bulbCx - 0.6, 0, 1.35, 0, Math.PI * 2);
    ctx.fill();

    // 3. 紧贴玻璃外壁的圆角竖向木卡箍（Collar Flange）
    const colGrad = ctx.createLinearGradient(0, -collarH * 0.5, 0, collarH * 0.5);
    colGrad.addColorStop(0, '#F5CA90');
    colGrad.addColorStop(0.5, '#CA8640');
    colGrad.addColorStop(1, '#7A4519');
    ctx.fillStyle = colGrad;
    ctx.strokeStyle = inkHex;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    roundRectPath(ctx, -collarW, -collarH * 0.5, collarW + 0.6, collarH, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 绘制箱内木杆上悬挂的铁环「抽」字木吊牌（1:1 复刻 ref_jar_left_pins.png 箱内挂牌位置与造型）
   */
  private drawInternalHangingTag(
    ctx: CanvasRenderingContext2D,
    tagScreenX: number,
    boardScreenY: number,
    bh: number,
    tokens: UiTokensFile
  ): void {
    const ink = '#3E2311';
    ctx.save();
    ctx.translate(tagScreenX, boardScreenY);

    // 1. 钉在木板正面的小木座与金属挂环
    ctx.fillStyle = '#DDA05D';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundRectPath(ctx, -2.8, -bh * 0.28, 5.6, bh * 0.52, 1.8);
    ctx.fill();
    ctx.stroke();

    // 金属小圆环穿过吊牌顶孔
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, bh * 0.34, 3.0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#E5C69B';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // 2. 斜肩切角绘本木牌（顶部三角挂耳 + 圆角矩形牌身，对应 ref_jar_left_pins.png）
    const tw = 20.5;
    const th = 21.5;
    const topPeakY = bh * 0.36;
    const shoulderY = topPeakY + 4.2;
    const botY = topPeakY + th;

    // 吊牌投影
    ctx.fillStyle = 'rgba(46, 24, 10, 0.20)';
    ctx.beginPath();
    roundRectPath(ctx, -tw * 0.5 + 1, shoulderY, tw, botY - shoulderY + 1.5, 3);
    ctx.fill();

    const tagGrad = ctx.createLinearGradient(0, topPeakY, 0, botY);
    tagGrad.addColorStop(0, '#F7DCB2');
    tagGrad.addColorStop(0.55, '#E9BA7D');
    tagGrad.addColorStop(1, '#D39652');

    ctx.fillStyle = tagGrad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, topPeakY);
    ctx.lineTo(tw * 0.5, shoulderY);
    ctx.lineTo(tw * 0.5, botY - 2.5);
    ctx.quadraticCurveTo(tw * 0.5, botY, tw * 0.5 - 2.5, botY);
    ctx.lineTo(-tw * 0.5 + 2.5, botY);
    ctx.quadraticCurveTo(-tw * 0.5, botY, -tw * 0.5, botY - 2.5);
    ctx.lineTo(-tw * 0.5, shoulderY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 顶孔小圆点
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(0, topPeakY + 3.4, 1.35, 0, Math.PI * 2);
    ctx.fill();

    // 正向手绘深棕「抽」字
    ctx.fillStyle = ink;
    ctx.font = `800 11.5px ${tokens.typography.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('抽', 0, shoulderY + (botY - shoulderY) * 0.52 + 0.5);

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

    // 漏斗底口 y=164 (子像素行 492..494, x=66..83) 延续 y=163 底边像素，使沙流严丝合缝抵达 spoutTipY=164.2
    const srcRow = (163 * SUB_SCALE + 2) * SUB_W;
    const dstRow0 = 164 * SUB_SCALE * SUB_W;
    const dstRow1 = dstRow0 + SUB_W;
    const dstRow2 = dstRow1 + SUB_W;
    for (let gx3 = 66 * SUB_SCALE; gx3 < 84 * SUB_SCALE; gx3++) {
      const p = b32[srcRow + gx3];
      b32[dstRow0 + gx3] = p;
      b32[dstRow1 + gx3] = p;
      b32[dstRow2 + gx3] = p;
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    engine: SandEngine,
    chamberRect: Rect,
    lootBagCenter: { x: number; y: number },
    sprites: SpriteProvider,
    tokens: UiTokensFile,
    boxMap: Map<string, BlindBoxConfig>,
    galaxySkinActive: boolean
  ): void {
    const shakeOffset = engine.screenShakeMs > 0 ? Math.sin(engine.frame * 1.8) * 3 : 0;

    const rx = chamberRect.x;
    const ry = chamberRect.y + shakeOffset;
    const rw = chamberRect.w;
    const rh = chamberRect.h;
    const sx = rw / GW;
    const sy = rh / GH;

    const geom = this.getGlassGeometry(engine.vessel);

    // 1. 预计算流沙光影场、下落缝隙弥合与漏斗尖嘴真实沙量
    this.prepareSandFields(engine, geom);

    this.rasterize(engine, galaxySkinActive);

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

    // 4. 在玻璃内腔裁剪区内绘制：清透微暖底 + 颗粒彩沙 + 染色环 + 冰砖 + 内部木隔板 + 未入兜盲盒
    ctx.save();
    ctx.beginPath();
    this.traceCornerSubpath(ctx, geom.innerLoop, rx, ry, sx, sy, true);
    ctx.clip();

    // 4a. 清透玻璃底衬
    ctx.fillStyle = 'rgba(255, 249, 238, 0.035)';
    ctx.fillRect(rx, ry, rw, rh);

    // 4b. 绘制 450x495 颗粒彩沙缓冲
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.offscreen, rx, ry, rw, rh);

    // 4c. 玻璃内侧边缘微弱立体包裹感
    const leftEdgeX = rx + geom.topLeftInner[0] * sx;
    const rightEdgeX = rx + geom.topRightInner[0] * sx;
    const cylGrad = ctx.createLinearGradient(leftEdgeX, ry, rightEdgeX, ry);
    cylGrad.addColorStop(0, 'rgba(68, 38, 16, 0.12)');
    cylGrad.addColorStop(0.06, 'rgba(68, 38, 16, 0.0)');
    cylGrad.addColorStop(0.94, 'rgba(68, 38, 16, 0.0)');
    cylGrad.addColorStop(1, 'rgba(68, 38, 16, 0.12)');
    ctx.fillStyle = cylGrad;
    ctx.fillRect(rx, ry, rw, rh);

    // 4d. 染色环装置
    for (const ring of engine.dyeRings) {
      const cx = rx + (ring.x0 + ring.x1) * 0.5 * sx;
      const cy = ry + (ring.y0 + ring.y1) * 0.5 * sy;
      const w = Math.max(36, (ring.x1 - ring.x0) * sx);
      const h = Math.max(18, (ring.y1 - ring.y0) * sy * 2.2);
      const tintHex = this.getSandColorHex(ring.toColor, tokens);
      const tinted = sprites.getTinted('ui_dye_ring', tintHex);
      if (tinted) {
        ctx.drawImage(tinted, cx - w * 0.5, cy - h * 0.5, w, h);
      } else {
        ctx.strokeStyle = tintHex;
        ctx.lineWidth = 3;
        ctx.strokeRect(cx - w * 0.5, cy - h * 0.35, w, h * 0.7);
      }
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
        ctx.strokeStyle = ic.primed ? '#EAB308' : '#3B6E9C';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.strokeStyle = '#E0F2FE';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();

        const pct = Math.min(100, Math.floor((ic.thawProgress / Math.max(1, ic.thawContacts)) * 100));
        const barW = Math.min(iw - 4, 62);
        const barH = 14;
        const bx = ix + (iw - barW) * 0.5;
        const by = iy + ih * 0.62 - barH * 0.5;
        ctx.save();
        ctx.fillStyle = 'rgba(44, 68, 94, 0.88)';
        ctx.strokeStyle = tokens.theme.inkOutline;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        roundRectPath(ctx, bx, by, barW, barH, 6);
        ctx.fill();
        ctx.stroke();
        if (pct > 0) {
          ctx.fillStyle = ic.primed ? '#FACC15' : '#7EC8F0';
          ctx.beginPath();
          roundRectPath(ctx, bx + 1.5, by + 1.5, Math.max(4, ((barW - 3) * pct) / 100), barH - 3, 5);
          ctx.fill();
        }
        ctx.fillStyle = '#FFFDF7';
        ctx.font = `700 9.5px ${tokens.typography.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pct > 0 ? `✦融${pct}%` : '✦冲刷融', bx + barW * 0.5, by + barH * 0.5 + 0.5);
        ctx.restore();
      } else {
        ctx.save();
        traceIceShape();
        ctx.strokeStyle = '#4A8AB5';
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.84)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();
        if (iw >= 36 && ih >= 16) {
          const midGridX = (minX + maxX) * 0.5;
          const midGridY = (minY + maxY) * 0.5;
          const hasCenterCap = engine.capsules.some(
            c => !c.collected && Math.abs(c.x - midGridX) < 15 && Math.abs(c.y - midGridY) < 12
          );
          const tagY = hasCenterCap ? iy + ih + 18 : iy + ih * 0.5;
          ctx.save();
          ctx.fillStyle = 'rgba(255, 248, 236, 0.90)';
          ctx.strokeStyle = tokens.theme.inkOutline;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          roundRectPath(ctx, ix + iw * 0.5 - 22, tagY - 7.5, 44, 15, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = tokens.theme.inkOutline;
          ctx.font = `700 9px ${tokens.typography.fontFamily}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('◇砸硬底', ix + iw * 0.5, tagY + 0.5);
          ctx.restore();
        }
      }
    }

    // 4f. 内部静态木隔板
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const w of engine.level.staticWalls || []) {
      const th = (w.thickness ?? 2) * sx;
      ctx.beginPath();
      ctx.moveTo(rx + w.x0 * sx, ry + w.y0 * sy);
      ctx.lineTo(rx + w.x1 * sx, ry + w.y1 * sy);
      ctx.strokeStyle = tokens.theme.inkOutline;
      ctx.lineWidth = th * 2.1;
      ctx.stroke();
      ctx.strokeStyle = '#C98A46';
      ctx.lineWidth = th * 1.22;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(246, 213, 158, 0.55)';
      ctx.lineWidth = Math.max(1, th * 0.35);
      ctx.stroke();
    }

    // 4g. 箱内未入兜盲盒宝箱（绘制在前层玻璃反光之下，体现被玻璃包裹的景深）
    for (const cap of engine.capsules) {
      if (cap.collected) continue;
      const cx = rx + cap.x * sx;
      const cy = ry + cap.y * sy;
      const boxCfg = boxMap.get(cap.boxType);
      const size = cap.r * sx * 2.28;
      const pulse = 0.82 + 0.18 * Math.sin(engine.frame * 0.09 + cap.id);

      ctx.save();
      ctx.fillStyle = boxCfg?.shellStyle.glowColor || 'rgba(255, 244, 206, 0.42)';
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.52 * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(72, 42, 18, 0.22)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + size * 0.27, size * 0.33, size * 0.085, 0, 0, Math.PI * 2);
      ctx.fill();

      const boxSprite = sprites.get(cap.boxType);
      // 滚动倾斜 + 落地压扁回弹（以底部为锚点，保持接触沙面不穿模）
      const sq = cap.squash > 0 ? Math.sin(cap.squash * Math.PI * 0.5) : 0;
      ctx.translate(cx, cy + size * 0.42);
      ctx.rotate(cap.tilt);
      ctx.scale(1 + sq * 0.13, 1 - sq * 0.15);
      ctx.translate(-cx, -(cy + size * 0.42));
      if (boxSprite) {
        ctx.drawImage(boxSprite, cx - size * 0.5, cy - size * 0.5, size, size);
      } else {
        ctx.fillStyle = boxCfg?.shellStyle.fill || '#F59E0B';
        ctx.strokeStyle = tokens.theme.inkOutline;
        ctx.lineWidth = 2;
        ctx.beginPath();
        roundRectPath(ctx, cx - size * 0.42, cy - size * 0.42, size * 0.84, size * 0.84, 6);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore(); // 结束基础内腔裁剪

    // 5. 绘制木板杆身、联动麻绳、箱内「抽」字木吊牌与锁扣（位于厚玻璃壁之下，使穿墙木杆呈现真实透玻插槽感！）
    const boardWood = sprites.get('ui_board_wood');
    const boardSlant = sprites.get('ui_board_slant');
    const boardPushGate = sprites.get('ui_board_push_gate');
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
      const cpx = (ax + bx) * 0.5 + (ay === by ? 0 : 12);
      const cpy = (ay + by) * 0.5 - 10;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(cpx, cpy, bx, by);
      ctx.strokeStyle = tokens.theme.inkOutline;
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.strokeStyle = '#EAB308';
      ctx.lineWidth = 2;
      ctx.stroke();
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

      // 让穿墙木栓杆身精确延伸至玻璃外壁边缘，穿过整道厚玻璃插槽
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
      const bh = Math.max(11.5, 5.1 * sy);

      if (wallSideTouches && isHorizontal && b.kind !== 'slant') {
        wallSlotTicks.push({
          xIn: rx + wallInGx * sx,
          xOut: rx + wallOutGx * sx,
          y: ry + outerGy * sy,
          halfH: bh * 0.55,
        });
      }

      if (b.isOpen && !b.removed) {
        ctx.save();
        ctx.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5);
        ctx.rotate(angle);

        ctx.strokeStyle = 'rgba(78, 46, 24, 0.65)';
        ctx.lineWidth = Math.max(3.8, bh * 0.46);
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.moveTo(-len * 0.5 + 4, 0);
        ctx.lineTo(len * 0.5 - 4, 0);
        ctx.stroke();

        ctx.strokeStyle = '#F6D59E';
        ctx.lineWidth = Math.max(1.8, bh * 0.22);
        ctx.stroke();
        ctx.setLineDash([]);

        if (linkedIds.has(b.id) && linkedGear) {
          ctx.save();
          ctx.rotate(-angle);
          ctx.drawImage(linkedGear, -11, -11, 22, 22);
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

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5);
      ctx.rotate(angle);
      ctx.translate(slideOffset, 0);

      if (b.kind === 'slant' && boardSlant) {
        ctx.drawImage(boardSlant, -len * 0.5 - 3, -bh * 0.7, len + 6, bh * 1.4);
      } else if ((b.startsOpen || b.reusable) && boardPushGate) {
        ctx.drawImage(boardPushGate, -len * 0.5, -bh * 0.72, len + 4, bh * 1.44);
      } else if (boardWood) {
        ctx.drawImage(boardWood, 14, 10, 188, 30, -len * 0.5, -bh * 0.62, len, bh * 1.24);
      } else {
        ctx.fillStyle = tokens.theme.woodPrimary;
        ctx.strokeStyle = tokens.theme.inkOutline;
        ctx.lineWidth = 2.1;
        ctx.beginPath();
        roundRectPath(ctx, -len * 0.5, -bh * 0.5, len, bh, 4);
        ctx.fill();
        ctx.stroke();
      }

      if (linkedIds.has(b.id) && !b.removed) {
        ctx.save();
        const gearOffsetX = b.lockColor ? 18 : 0;
        ctx.translate(gearOffsetX, 0);
        ctx.rotate(-angle);
        if (linkedGear) {
          ctx.drawImage(linkedGear, -12, -12, 24, 24);
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
          ctx.drawImage(lockImg, -14, -15, 28, 30);
        }
        ctx.restore();
      }
      ctx.restore();

      // 箱内垂挂「抽」字木吊牌（紧贴玻璃内壁向内约 8.8 格处，1:1 对齐 ref_jar_left_pins.png！）
      if (!b.lockColor && !b.removed && !b.reusable && b.kind !== 'slant') {
        const spanGrid = maxBx - minBx;
        const insetGrid = Math.min(8.8, Math.max(6.5, spanGrid * 0.22));
        const tagGx = wallSideTouches
          ? isLeftAnchored
            ? Math.min(maxBx - 5, wallInGx + insetGrid)
            : Math.max(minBx + 5, wallInGx - insetGrid)
          : (b.x0 + b.x1) * 0.5;
        const tagGy = (b.y0 + b.y1) * 0.5;
        ctx.save();
        ctx.globalAlpha = alpha;
        this.drawInternalHangingTag(
          ctx,
          rx + tagGx * sx + slideOffset * Math.cos(angle),
          ry + tagGy * sy + slideOffset * Math.sin(angle),
          bh,
          tokens
        );
        ctx.restore();
      }

      // 记录外壁雕花拉手与活门外标签（待玻璃壁绘制完毕后画在玻璃外侧）
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

    // 6. 绘制 gameplay_ref.jpg 同款双轮廓半透明厚玻璃壁夹层（木杆穿过半透明玻璃壁插槽！）
    ctx.save();

    // 6a. 奇偶环绕填充半透明暖乳白厚玻璃壁体
    ctx.save();
    ctx.beginPath();
    this.traceCornerSubpath(ctx, geom.outerLoop, rx, ry, sx, sy, true);
    this.traceCornerSubpath(ctx, geom.innerLoop, rx, ry, sx, sy, true);

    const glassWallGrad = ctx.createLinearGradient(rx, ry, rx, ry + rh);
    glassWallGrad.addColorStop(0, 'rgba(254, 250, 242, 0.86)');
    glassWallGrad.addColorStop(0.10, 'rgba(242, 234, 219, 0.62)');
    glassWallGrad.addColorStop(0.76, 'rgba(238, 229, 213, 0.58)');
    glassWallGrad.addColorStop(0.88, 'rgba(246, 239, 225, 0.86)');
    glassWallGrad.addColorStop(1, 'rgba(244, 236, 220, 0.90)');
    ctx.fillStyle = glassWallGrad;
    ctx.fill('evenodd');

    // 在玻璃壁夹层内部叠绘左上/右上圆角纯白高光与底部 V 形漏斗斜切面明暗
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
      cGrad.addColorStop(0, 'rgba(255, 255, 253, 0.92)');
      cGrad.addColorStop(1, 'rgba(255, 255, 253, 0)');
      ctx.fillStyle = cGrad;
      ctx.fillRect(cxCorner - 36, cyCorner - 36, 72, 72);
    }

    // 漏斗斗底斜面立体切面：左斜面受光亮带、右斜面微暖灰折射暗带（对齐 ref_jar_bottom.png）
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.6 * sx;
    ctx.strokeStyle = 'rgba(255, 253, 248, 0.40)';
    ctx.beginPath();
    ctx.moveTo(rx + geom.leftSlopeMid[0][0] * sx, ry + geom.leftSlopeMid[0][1] * sy);
    ctx.lineTo(rx + geom.leftSlopeMid[1][0] * sx, ry + geom.leftSlopeMid[1][1] * sy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(136, 98, 64, 0.16)';
    ctx.beginPath();
    ctx.moveTo(rx + geom.rightSlopeMid[0][0] * sx, ry + geom.rightSlopeMid[0][1] * sy);
    ctx.lineTo(rx + geom.rightSlopeMid[1][0] * sx, ry + geom.rightSlopeMid[1][1] * sy);
    ctx.stroke();
    ctx.restore();

    // 6b. 玻璃壁穿墙木栓插槽细刻度线
    ctx.strokeStyle = 'rgba(62, 35, 17, 0.55)';
    ctx.lineWidth = 1.25;
    for (const slot of wallSlotTicks) {
      ctx.beginPath();
      ctx.moveTo(slot.xOut, slot.y - slot.halfH);
      ctx.lineTo(slot.xIn, slot.y - slot.halfH);
      ctx.moveTo(slot.xOut, slot.y + slot.halfH);
      ctx.lineTo(slot.xIn, slot.y + slot.halfH);
      ctx.stroke();
    }

    // 6c. 玻璃内腔折光边缘（亮白内侧反光线 + 柔和细暖棕内缘线）
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.traceCornerSubpath(ctx, geom.innerOpenLeftToRight, rx, ry, sx, sy, false);
    ctx.strokeStyle = 'rgba(255, 253, 248, 0.72)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(104, 68, 38, 0.38)';
    ctx.lineWidth = 1.05;
    ctx.stroke();

    // 6d. 玻璃外壁手绘浓棕钢笔主轮廓 + 漏斗底嘴圆润弧形唇边收口
    ctx.beginPath();
    const rLipInX = rx + geom.spoutInnerRightX * sx;
    const rLipOutX = rx + (geom.spoutInnerRightX + 3.6) * sx;
    const lLipInX = rx + geom.spoutInnerLeftX * sx;
    const lLipOutX = rx + (geom.spoutInnerLeftX - 3.6) * sx;
    const lipY = ry + geom.spoutTipY * sy;

    ctx.moveTo(rLipInX, lipY - 0.5);
    ctx.quadraticCurveTo((rLipInX + rLipOutX) * 0.5, lipY + 2.2, rLipOutX, lipY);
    this.traceCornerSubpath(ctx, geom.outerOpenRightToLeft, rx, ry, sx, sy, false, true);
    ctx.quadraticCurveTo((lLipOutX + lLipInX) * 0.5, lipY + 2.2, lLipInX, lipY - 0.5);
    ctx.strokeStyle = '#3E2311';
    ctx.lineWidth = 2.35;
    ctx.stroke();

    ctx.restore();

    // 7. 前层玻璃面板高光与贯穿反光带（轻柔掠过箱内木板与彩沙，建立真实玻璃前罩景深！）
    ctx.save();
    ctx.beginPath();
    this.traceCornerSubpath(ctx, geom.innerLoop, rx, ry, sx, sy, true);
    ctx.clip();

    const sheenLeftX = rx + (geom.topLeftInner[0] + 4.2) * sx;
    const sheenRightX = rx + (geom.topRightInner[0] - 4.8) * sx;
    const topGlintY = ry + (geom.topLeftInner[1] + 2.2) * sy;
    const botGlintY = ry + (geom.bottomFloorInnerY - 6) * sy;

    // 左侧宽柔玻璃反光幕 + 细亮棱线（对齐 ref_jar_left_pins.png 贯穿木栓的前玻璃反光）
    ctx.strokeStyle = 'rgba(255, 254, 249, 0.13)';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(7, 3.4 * sx);
    ctx.beginPath();
    ctx.moveTo(sheenLeftX, topGlintY + 4);
    ctx.lineTo(sheenLeftX, botGlintY - 12);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 254, 250, 0.30)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(sheenLeftX - 2.2, topGlintY + 2);
    ctx.lineTo(sheenLeftX - 2.2, ry + 96 * sy);
    ctx.moveTo(sheenLeftX - 2.2, ry + 104 * sy);
    ctx.lineTo(sheenLeftX - 2.2, ry + 120 * sy);
    ctx.stroke();

    // 右侧柔光带
    ctx.strokeStyle = 'rgba(255, 254, 249, 0.11)';
    ctx.lineWidth = Math.max(5.5, 2.6 * sx);
    ctx.beginPath();
    ctx.moveTo(sheenRightX, topGlintY + 6);
    ctx.lineTo(sheenRightX, botGlintY - 18);
    ctx.stroke();

    // 顶部玻璃横梁柔白下沿反光
    const topBarGrad = ctx.createLinearGradient(0, ry + geom.topLeftInner[1] * sy, 0, ry + (geom.topLeftInner[1] + 5) * sy);
    topBarGrad.addColorStop(0, 'rgba(255, 254, 250, 0.28)');
    topBarGrad.addColorStop(1, 'rgba(255, 254, 250, 0)');
    ctx.fillStyle = topBarGrad;
    ctx.fillRect(rx, ry + geom.topLeftInner[1] * sy, rw, 5.5 * sy);

    ctx.restore();

    // 万能吸尘器清堵旋风视觉演出
    if (engine.vacuumAnimMs > 0) {
      const vt = engine.vacuumAnimMs / 450;
      const vcx = rx + 75 * sx;
      const vcy = ry + 154 * sy;
      ctx.save();
      ctx.translate(vcx, vcy);
      ctx.rotate(engine.frame * 0.45);
      ctx.strokeStyle = `rgba(126, 200, 240, ${0.85 * vt})`;
      ctx.lineWidth = 3;
      for (let ringIdx = 1; ringIdx <= 3; ringIdx++) {
        ctx.beginPath();
        ctx.arc(0, 0, ringIdx * 14 * (1.2 - 0.4 * vt), 0, Math.PI * 1.45);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 8. 在玻璃外壁外侧绘制雕花圆盘木拉手与往复活门推拉签（完全不被玻璃壁遮挡，紧贴外壁！）
    for (const att of outerAttachments) {
      const { b, wallOuterScreenX, anchorScreenY, outerDir, bh, alpha, slideScreenX } = att;
      ctx.save();
      ctx.globalAlpha = alpha;

      if (b.isOpen && !b.removed) {
        // 开口态活门：在外壁外侧露出待推入的短栓头与“推”字木签
        const hx = wallOuterScreenX + outerDir * 8;
        this.drawCarvedOuterHandle(ctx, hx, anchorScreenY, outerDir, bh, '#3E2311');
        ctx.fillStyle = '#FFF5DE';
        ctx.strokeStyle = tokens.theme.inkOutline;
        ctx.lineWidth = 1.8;
        const badgeX = wallOuterScreenX - outerDir * 14;
        ctx.beginPath();
        roundRectPath(ctx, badgeX - 16, anchorScreenY - 9, 32, 18, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = tokens.theme.inkOutline;
        ctx.font = `700 9.5px ${tokens.typography.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(outerDir < 0 ? '推▸' : '◂推', badgeX, anchorScreenY + 0.5);
      } else if (b.reusable && !b.lockColor) {
        this.drawCarvedOuterHandle(
          ctx,
          wallOuterScreenX + slideScreenX,
          anchorScreenY,
          outerDir,
          bh,
          '#3E2311'
        );
        const badgeX = wallOuterScreenX - outerDir * 15 + slideScreenX;
        ctx.fillStyle = '#FFF5DE';
        ctx.strokeStyle = tokens.theme.inkOutline;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        roundRectPath(ctx, badgeX - 15, anchorScreenY - 9, 30, 18, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = tokens.theme.inkOutline;
        ctx.font = `700 9.5px ${tokens.typography.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(outerDir < 0 ? '◂拉' : '拉▸', badgeX, anchorScreenY + 0.5);
      } else if (!b.lockColor) {
        // 标准可抽木栓：外壁紧贴圆盘卡箍与六瓣雕花拉手
        this.drawCarvedOuterHandle(
          ctx,
          wallOuterScreenX + slideScreenX,
          anchorScreenY,
          outerDir,
          bh,
          '#3E2311'
        );
      }
      ctx.restore();
    }

    // 9. 已入兜正在飞向右上角战利品袋的盲盒抛物线动画（绘制在最顶层越过玻璃框飞入袋中）
    for (const cap of engine.capsules) {
      if (!cap.collected || cap.flyProgressMs <= 0 || cap.flyProgressMs >= 400) continue;
      const t = cap.flyProgressMs / 400;
      const sx0 = rx + cap.flyStartX * sx;
      const sy0 = ry + cap.flyStartY * sy;
      const ctrlX = (sx0 + lootBagCenter.x) * 0.5;
      const ctrlY = Math.min(sy0, lootBagCenter.y) - 65;
      const cx = (1 - t) * (1 - t) * sx0 + 2 * (1 - t) * t * ctrlX + t * t * lootBagCenter.x;
      const cy = (1 - t) * (1 - t) * sy0 + 2 * (1 - t) * t * ctrlY + t * t * lootBagCenter.y;
      const scale = 1 + Math.sin(t * Math.PI) * 0.35;
      const alpha = 1 - t * 0.15;
      const boxCfg = boxMap.get(cap.boxType);
      const size = cap.r * sx * 2.28 * scale;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = boxCfg?.shellStyle.glowColor || 'rgba(255, 244, 206, 0.5)';
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.55, 0, Math.PI * 2);
      ctx.fill();

      const boxSprite = sprites.get(cap.boxType);
      if (boxSprite) {
        ctx.drawImage(boxSprite, cx - size * 0.5, cy - size * 0.5, size, size);
      }
      ctx.restore();
    }

    ctx.restore();
  }
}
