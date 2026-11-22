import { roundRectPath } from '../platform/CanvasPolyfill';
import type { BlindBoxConfig } from '../types/blindbox';
import type { SandColorId } from '../types/level';
import type { Rect, SandPaletteEntry, UiTokensFile } from '../types/ui';
import { FROZEN_BASE, GH, GOLD_SAND, GW, WALL, isSand } from './SandGrid';
import type { SandEngine } from './SandEngine';

export interface SpriteProvider {
  get(assetId: string): CanvasImageSource | null;
  getTinted(assetId: string, hexColor: string): CanvasImageSource | null;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function packAbgr(r: number, g: number, b: number, a = 255): number {
  return ((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
}

const SUB_W = GW * 2;
const SUB_H = GH * 2;

/**
 * 严格对齐封面 cover.jpg 的绘本玻璃沙罐、圆木底座、2x 超采样水彩柔砂与分段「抽」字木栓渲染器
 */
export class SandRenderer {
  private offscreen: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private imgData: ImageData;
  private buf32: Uint32Array;
  // 5 种颜色 × 37 档柔和亮度查找表 + 顶面奶白受光高光表 + 纸纹微暗表
  private lut = new Uint32Array(6 * 37);
  private lutCrest = new Uint32Array(6);
  private lutGrainDark = new Uint32Array(6 * 37);
  private starWhiteAbgr = packAbgr(255, 252, 238, 255);
  private iceBaseAbgr = new Uint32Array(6);

  constructor(tokens: UiTokensFile, createCanvasFn: () => HTMLCanvasElement) {
    this.offscreen = createCanvasFn();
    this.offscreen.width = SUB_W;
    this.offscreen.height = SUB_H;
    const ctx = this.offscreen.getContext('2d');
    if (!ctx) throw new Error('无法创建离屏 2D 上下文');
    this.offCtx = ctx;
    this.imgData = this.offCtx.createImageData(SUB_W, SUB_H);
    this.buf32 = new Uint32Array(this.imgData.data.buffer);
    this.buildLut(tokens);
  }

  private buildLut(tokens: UiTokensFile): void {
    for (let cid = 1; cid <= 5; cid++) {
      const entry = tokens.sandPalette[String(cid)] as SandPaletteEntry | undefined;
      const [br, bg, bb] = hexToRgb(entry?.baseHex || '#F497B8');
      const [hr, hg, hb] = hexToRgb(entry?.highlightHex || '#FFC6DC');

      // 沙丘顶部受光奶油边（复刻 cover.jpg 沙浪交界处的柔和浅色高光带）
      this.lutCrest[cid] = packAbgr(
        Math.min(255, Math.round(hr * 0.72 + 255 * 0.28)),
        Math.min(255, Math.round(hg * 0.72 + 252 * 0.28)),
        Math.min(255, Math.round(hb * 0.72 + 242 * 0.28)),
        255
      );

      for (let s = 0; s <= 36; s++) {
        // 细腻水彩纸纹微色阶（±6），彻底消除马赛克方块感
        const d = Math.round((s - 18) * 0.36);
        const r = Math.max(0, Math.min(255, br + d));
        const g = Math.max(0, Math.min(255, bg + d));
        const b = Math.max(0, Math.min(255, bb + d));
        this.lut[cid * 37 + s] = packAbgr(r, g, b, 255);
        this.lutGrainDark[cid * 37 + s] = packAbgr(
          Math.max(0, r - 3),
          Math.max(0, g - 3),
          Math.max(0, b - 2),
          255
        );
      }

      // 冰冻沙砖：混合清透水彩冰蓝
      const ir = Math.round(br * 0.38 + 220 * 0.62);
      const ig = Math.round(bg * 0.38 + 244 * 0.62);
      const ib = Math.round(bb * 0.38 + 255 * 0.62);
      this.iceBaseAbgr[cid] = packAbgr(ir, ig, ib, 238);
    }
  }

  public getSandColorHex(cid: SandColorId, tokens: UiTokensFile): string {
    const entry = tokens.sandPalette[String(cid)] as SandPaletteEntry | undefined;
    return entry?.bucketTint || entry?.baseHex || '#F6A2C0';
  }

  /**
   * 绘制封面同款手绘圆木托盘底座（精准承托于沙罐漏斗底圈下方，不侵入罐内流沙净空区）
   */
  private renderWoodenPedestal(
    ctx: CanvasRenderingContext2D,
    rx: number,
    ry: number,
    rw: number,
    sx: number,
    sy: number,
    tokens: UiTokensFile
  ): void {
    const cx = rx + rw * 0.5;
    const pedW = Math.min(rw * 0.80, 118 * sx);
    const topY = ry + 151 * sy;
    const baseH = 14 * sy;
    const rxE = pedW * 0.5;
    const ryE = 6 * sy;
    const ink = tokens.theme.inkOutline;

    ctx.save();
    ctx.fillStyle = 'rgba(58, 32, 12, 0.24)';
    ctx.beginPath();
    ctx.ellipse(cx, topY + baseH + 2.5, rxE * 1.04, ryE * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();

    const sideGrad = ctx.createLinearGradient(cx - rxE, topY, cx + rxE, topY);
    sideGrad.addColorStop(0, '#8C5324');
    sideGrad.addColorStop(0.28, '#BC7E42');
    sideGrad.addColorStop(0.68, '#A96B32');
    sideGrad.addColorStop(1, '#78441B');
    ctx.fillStyle = sideGrad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(cx - rxE, topY);
    ctx.lineTo(cx - rxE, topY + baseH);
    ctx.ellipse(cx, topY + baseH, rxE, ryE, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rxE, topY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#D99E5B';
    ctx.beginPath();
    ctx.ellipse(cx, topY, rxE, ryE, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(78, 46, 24, 0.32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, topY, rxE * 0.76, ryE * 0.65, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();
    ctx.restore();
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

    // 0. 先绘制沙罐底圈下方的封面同款圆木托座
    this.renderWoodenPedestal(ctx, rx, ry, rw, sx, sy, tokens);

    // 1. 更新 300x330 (2x 超采样) 水彩柔砂离屏缓冲
    const g = engine.grid;
    const sh = engine.shade;
    const inter = engine.interior;
    const b32 = this.buf32;
    const f = engine.frame;
    const chamberFill = packAbgr(255, 251, 243, 56);
    const wallAbgr = packAbgr(146, 96, 52, 240);

    for (let y = 0; y < GH; y++) {
      const rowOff = y * GW;
      const subRow0 = y * 2 * SUB_W;
      const subRow1 = subRow0 + SUB_W;
      const waveBias = Math.round(Math.sin(y * 0.28) * 6);

      for (let x = 0; x < GW; x++) {
        const i = rowOff + x;
        const v = g[i];
        const sx0 = x * 2;

        if (v === 0) {
          const emptyCol = inter[i] ? chamberFill : 0;
          b32[subRow0 + sx0] = emptyCol;
          b32[subRow0 + sx0 + 1] = emptyCol;
          b32[subRow1 + sx0] = emptyCol;
          b32[subRow1 + sx0 + 1] = emptyCol;
        } else if (isSand(v)) {
          // 柔和波浪水彩层理叠加微纸纹
          const s = Math.max(0, Math.min(36, sh[i] + waveBias + Math.round(Math.sin(x * 0.11 + y * 0.19) * 5)));
          const lutIdx = v * 37 + s;
          let cMain = this.lut[lutIdx];
          let cAlt = this.lutGrainDark[lutIdx];

          if (v === GOLD_SAND && (i * 7 + (f >> 3)) % 13 === 0) {
            cMain = this.starWhiteAbgr;
          } else if (galaxySkinActive && (i * 19 + s) % 17 === 0 && (f + i) % 24 < 5) {
            cMain = this.starWhiteAbgr;
          }

          const aboveEmpty = y > 0 && g[i - GW] === 0;
          const leftEmpty = x > 0 && g[i - 1] === 0;
          const rightEmpty = x < GW - 1 && g[i + 1] === 0;

          // 顶部暴露在空气中的沙粒叠一层浅奶油受光边，斜坡角点柔化消除阶梯锯齿
          let tl = aboveEmpty ? this.lutCrest[v] : cMain;
          let tr = aboveEmpty ? this.lutCrest[v] : cAlt;
          if (aboveEmpty && leftEmpty) tl = chamberFill;
          if (aboveEmpty && rightEmpty) tr = chamberFill;

          b32[subRow0 + sx0] = tl;
          b32[subRow0 + sx0 + 1] = tr;
          b32[subRow1 + sx0] = cAlt;
          b32[subRow1 + sx0 + 1] = cMain;
        } else if (v >= FROZEN_BASE) {
          const iceIdx = v - FROZEN_BASE;
          const ic = engine.ice[iceIdx];
          const iceCol = ic ? this.iceBaseAbgr[ic.color] : packAbgr(215, 242, 255, 238);
          b32[subRow0 + sx0] = iceCol;
          b32[subRow0 + sx0 + 1] = iceCol;
          b32[subRow1 + sx0] = iceCol;
          b32[subRow1 + sx0 + 1] = iceCol;
        } else if (v === WALL) {
          b32[subRow0 + sx0] = wallAbgr;
          b32[subRow0 + sx0 + 1] = wallAbgr;
          b32[subRow1 + sx0] = wallAbgr;
          b32[subRow1 + sx0 + 1] = wallAbgr;
        } else {
          b32[subRow0 + sx0] = 0;
          b32[subRow0 + sx0 + 1] = 0;
          b32[subRow1 + sx0] = 0;
          b32[subRow1 + sx0 + 1] = 0;
        }
      }
    }
    this.offCtx.putImageData(this.imgData, 0, 0);

    ctx.save();

    // 2. 启用双线性平滑绘制 2x 水彩柔砂缓冲（告别大颗粒马赛克方块感！）
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.offscreen, rx, ry, rw, rh);

    // 2b. 在彩沙层内点缀少量封面同款奶白四角星微闪点（✦）
    ctx.fillStyle = 'rgba(255, 252, 238, 0.82)';
    for (let k = 0; k < 14; k++) {
      const gx = 20 + ((k * 37 + 13) % 110);
      const gy = 26 + ((k * 29 + 7) % 108);
      const gi = gy * GW + gx;
      if (isSand(g[gi]) && ((f >> 4) + k) % 5 !== 0) {
        const px = rx + gx * sx;
        const py = ry + gy * sy;
        const rStar = 2.6;
        ctx.beginPath();
        ctx.moveTo(px, py - rStar);
        ctx.lineTo(px + rStar * 0.35, py - rStar * 0.35);
        ctx.lineTo(px + rStar, py);
        ctx.lineTo(px + rStar * 0.35, py + rStar * 0.35);
        ctx.lineTo(px, py + rStar);
        ctx.lineTo(px - rStar * 0.35, py + rStar * 0.35);
        ctx.lineTo(px - rStar, py);
        ctx.lineTo(px - rStar * 0.35, py - rStar * 0.35);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 3. 绘制染色环装置（ui_dye_ring 程序着色）
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

    // 4. 绘制手绘水彩脆冰砖与万年寒冰（去除系统 3D Emoji，改用手绘冰晶星标与木屋色卡）
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
          ctx.rect(ix, iy, iw, ih);
        }
      };

      if (iceTex) {
        ctx.save();
        traceIceShape();
        ctx.clip();
        ctx.globalAlpha = isPerma ? 0.68 : 0.54;
        ctx.drawImage(iceTex, ix - 2, iy - 2, iw + 4, ih + 4);
        ctx.restore();
      }

      if (isPerma) {
        ctx.save();
        traceIceShape();
        ctx.strokeStyle = ic.primed ? '#EAB308' : '#3B6E9C';
        ctx.lineWidth = 2.6;
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
        ctx.strokeStyle = '#5BA8D6';
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.lineWidth = 1;
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

    // 5. 绘制封面同款手绘厚壁玻璃沙罐轮廓 + 奶白弧形玻璃高光带 + 干净瓶口与黄铜漏斗
    const firstWallX = engine.vessel.walls[0]?.points[0]?.[0] ?? 8;
    const secondWallX = engine.vessel.walls[1]?.points[0]?.[0] ?? 141;

    // 5a. 罐体左右内侧奶白色竖向高光折射带（复刻 cover.jpg 玻璃罐通透反光感）
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 253, 246, 0.48)';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(5, 3.2 * sx);
    ctx.beginPath();
    ctx.moveTo(rx + (firstWallX + 4.5) * sx, ry + 18 * sy);
    ctx.lineTo(rx + (firstWallX + 4.5) * sx, ry + 96 * sy);
    ctx.stroke();

    ctx.lineWidth = Math.max(2.5, 1.5 * sx);
    ctx.beginPath();
    ctx.moveTo(rx + (firstWallX + 4.5) * sx, ry + 105 * sy);
    ctx.lineTo(rx + (firstWallX + 4.5) * sx, ry + 114 * sy);
    ctx.moveTo(rx + (secondWallX - 4.5) * sx, ry + 22 * sy);
    ctx.lineTo(rx + (secondWallX - 4.5) * sx, ry + 78 * sy);
    ctx.stroke();
    ctx.restore();

    // 5b. 玻璃罐外壁深棕手绘双墨线 + 乳白玻璃厚边（顶部自然顺接圆弧玻璃瓶肩）
    const rimImg = sprites.get('ui_vessel_rim');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const seg of engine.vessel.walls) {
      ctx.beginPath();
      seg.points.forEach(([px, py], k) => {
        const clampedY = rimImg && k === 0 && py < 12 ? 12.5 : py;
        const vx = rx + px * sx;
        const vy = ry + clampedY * sy;
        if (k === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      });
      ctx.strokeStyle = tokens.theme.inkOutline;
      ctx.lineWidth = seg.thickness * sx * 1.85;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 249, 236, 0.88)';
      ctx.lineWidth = Math.max(2.2, seg.thickness * sx * 0.78);
      ctx.stroke();
    }

    // 内部静态木隔板手绘美化
    for (const w of engine.level.staticWalls || []) {
      ctx.beginPath();
      ctx.moveTo(rx + w.x0 * sx, ry + w.y0 * sy);
      ctx.lineTo(rx + w.x1 * sx, ry + w.y1 * sy);
      ctx.strokeStyle = tokens.theme.inkOutline;
      ctx.lineWidth = (w.thickness ?? 2) * sx * 1.95;
      ctx.stroke();
      ctx.strokeStyle = '#C98A46';
      ctx.lineWidth = (w.thickness ?? 2) * sx * 1.08;
      ctx.stroke();
    }

    // 5c. 顶部厚玻璃广口瓶沿（无缝覆盖并衔接两侧竖向玻璃罐壁）
    const rimX = rx + (firstWallX - 3) * sx;
    const rimW = (secondWallX - firstWallX + 6) * sx;
    if (rimImg) {
      ctx.drawImage(rimImg, rimX, ry - 4 * sy, rimW, 19 * sy);
    }

    // 5d. 底部摆正铆钉黄铜漏斗（使用去污扶正后的纯净 ui_vessel_nozzle）
    const nozzleImg = sprites.get('ui_vessel_nozzle');
    const nozzleW = 36 * sx;
    const nozzleH = 26 * sy;
    const nozzleX = rx + 75 * sx - nozzleW * 0.5;
    const nozzleY = ry + 146 * sy;
    if (nozzleImg) {
      ctx.drawImage(nozzleImg, nozzleX, nozzleY, nozzleW, nozzleH);
    }

    // 万能吸尘器清堵旋风视觉演出
    if (engine.vacuumAnimMs > 0) {
      const vt = engine.vacuumAnimMs / 450;
      const vcx = rx + 75 * sx;
      const vcy = ry + 156 * sy;
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

    // 6. 绘制联动麻绳、往复活门闸、封面同款分段「抽」字木栓与颜色锁头
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

    for (const b of engine.boards) {
      if (b.removed && b.pullAnimMs <= 0) continue;

      const x0 = rx + b.x0 * sx;
      const y0 = ry + b.y0 * sy;
      const x1 = rx + b.x1 * sx;
      const y1 = ry + b.y1 * sy;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const bh = Math.max(12, 5.4 * sy);
      const isLeftAnchored = Math.min(b.x0, b.x1) <= 22 && Math.max(b.x0, b.x1) < 126;
      const outerDir = isLeftAnchored ? -1 : 1;

      // 6a. 推入式闸门（初始开口态 isOpen = true）
      if (b.isOpen && !b.removed) {
        ctx.save();
        ctx.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5);
        ctx.rotate(angle);

        ctx.strokeStyle = 'rgba(78, 46, 24, 0.68)';
        ctx.lineWidth = Math.max(4, bh * 0.5);
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.moveTo(-len * 0.5, 0);
        ctx.lineTo(len * 0.5, 0);
        ctx.stroke();

        ctx.strokeStyle = '#F6D59E';
        ctx.lineWidth = Math.max(2, bh * 0.24);
        ctx.stroke();
        ctx.setLineDash([]);

        const stubLen = Math.min(34, Math.max(22, len * 0.34));
        const stubCenter = outerDir * (len * 0.5 + stubLen * 0.28);
        const gateTex = boardPushGate || boardWood;
        if (gateTex) {
          ctx.drawImage(gateTex, stubCenter - stubLen * 0.5, -bh * 0.8, stubLen, bh * 1.6);
        } else {
          ctx.fillStyle = '#C98A46';
          ctx.strokeStyle = tokens.theme.inkOutline;
          ctx.lineWidth = 2;
          ctx.beginPath();
          roundRectPath(ctx, stubCenter - stubLen * 0.5, -bh * 0.55, stubLen, bh * 1.1, 4);
          ctx.fill();
          ctx.stroke();
        }

        ctx.save();
        ctx.translate(outerDir * (len * 0.5 - 4), 0);
        ctx.rotate(-angle);
        ctx.fillStyle = '#FFF5DE';
        ctx.strokeStyle = tokens.theme.inkOutline;
        ctx.lineWidth = 1.9;
        ctx.beginPath();
        roundRectPath(ctx, -17, -9.5, 34, 19, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = tokens.theme.inkOutline;
        ctx.font = `700 10px ${tokens.typography.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(outerDir < 0 ? '推▸' : '◂推', 0, 0.5);
        ctx.restore();

        if (linkedIds.has(b.id)) {
          ctx.save();
          ctx.rotate(-angle);
          if (linkedGear) {
            ctx.drawImage(linkedGear, -11, -11, 22, 22);
          }
          ctx.restore();
        }

        ctx.restore();
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

      // 6b. 分段绘制木杆躯干与外侧 1:1 悬垂铁链「抽」字木牌（彻底消除压扁变形与多余几何圆圈！）
      if (b.kind === 'slant' && boardSlant) {
        ctx.drawImage(boardSlant, -len * 0.5 - 4, -bh * 0.72, len + 8, bh * 1.44);
      } else if ((b.startsOpen || b.reusable) && boardPushGate) {
        ctx.drawImage(boardPushGate, -len * 0.5 - 4, -bh * 0.75, len + 12, bh * 1.5);
      } else if (boardWood) {
        // 1) 纯木杆段 (source x:14..202, y:10..40) 饱满拉伸覆盖整根板长
        ctx.drawImage(boardWood, 14, 10, 188, 30, -len * 0.5 - 2, -bh * 0.65, len + 4, bh * 1.3);

        // 2) 外侧圆木栓头 + 铁链「抽」字木吊牌 (source x:202..256, y:4..81)，保持 1:1 原比例垂挂！
        if (!b.lockColor && !b.removed && !b.reusable) {
          const pegW = 30;
          const pegH = 43;
          ctx.save();
          ctx.translate(outerDir * (len * 0.5 + 3), 0);
          ctx.rotate(-angle); // 让「抽」字木牌顺着重力自然竖直垂挂，与 cover.jpg 完全一致！
          if (outerDir < 0) {
            // 左侧伸出时先画翻转圆栓头，再正向叠字或镜像悬挂
            ctx.scale(-1, 1);
          }
          ctx.drawImage(boardWood, 202, 4, 54, 77, -8, -11, pegW, pegH);
          ctx.restore();
        }
      } else {
        ctx.fillStyle = tokens.theme.woodPrimary;
        ctx.strokeStyle = tokens.theme.inkOutline;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        roundRectPath(ctx, -len * 0.5, -bh * 0.5, len, bh, 5);
        ctx.fill();
        ctx.stroke();
      }

      // 往复活门闭合态“拉”字手绘木签
      if (!b.lockColor && !b.removed && b.reusable) {
        ctx.save();
        ctx.translate(outerDir * (len * 0.5 - 2), 0);
        ctx.rotate(-angle);
        ctx.fillStyle = '#FFF5DE';
        ctx.strokeStyle = tokens.theme.inkOutline;
        ctx.lineWidth = 1.9;
        ctx.beginPath();
        roundRectPath(ctx, -16, -9.5, 32, 19, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = tokens.theme.inkOutline;
        ctx.font = `700 9.5px ${tokens.typography.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(outerDir < 0 ? '◂拉' : '拉▸', 0, 0.5);
        ctx.restore();
      }

      // 联动双栓黄铜滑轮徽章
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

      // 颜色锁徽章
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
    }

    // 7. 绘制沙盘内的盲盒宝箱与飞入战利品袋抛物线动画
    for (const cap of engine.capsules) {
      let cx = rx + cap.x * sx;
      let cy = ry + cap.y * sy;
      let scale = 1;
      let alpha = 1;

      if (cap.collected) {
        if (cap.flyProgressMs <= 0 || cap.flyProgressMs >= 400) continue;
        const t = cap.flyProgressMs / 400;
        const sx0 = rx + cap.flyStartX * sx;
        const sy0 = ry + cap.flyStartY * sy;
        const ctrlX = (sx0 + lootBagCenter.x) * 0.5;
        const ctrlY = Math.min(sy0, lootBagCenter.y) - 65;
        cx = (1 - t) * (1 - t) * sx0 + 2 * (1 - t) * t * ctrlX + t * t * lootBagCenter.x;
        cy = (1 - t) * (1 - t) * sy0 + 2 * (1 - t) * t * ctrlY + t * t * lootBagCenter.y;
        scale = 1 + Math.sin(t * Math.PI) * 0.35;
        alpha = 1 - t * 0.15;
      }

      const boxCfg = boxMap.get(cap.boxType);
      const size = cap.r * sx * 2.28 * scale;
      const pulse = 0.76 + 0.24 * Math.sin(engine.frame * 0.1 + cap.id);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = boxCfg?.shellStyle.glowColor || 'rgba(255, 246, 214, 0.55)';
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.56 * pulse, 0, Math.PI * 2);
      ctx.fill();

      const boxSprite = sprites.get(cap.boxType);
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

    ctx.restore();
  }
}
