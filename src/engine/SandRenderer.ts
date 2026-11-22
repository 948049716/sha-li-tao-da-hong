import type { BlindBoxConfig } from '../types/blindbox';
import type { SandColorId } from '../types/level';
import type { Rect, SandPaletteEntry, UiTokensFile } from '../types/ui';
import { FROZEN_BASE, GH, GOLD_SAND, GW, TOTAL_CELLS, WALL, isSand } from './SandGrid';
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

/**
 * 流沙 150x165 Uint32Array 离屏像素缓冲渲染器 + 玻璃沙罐、木板、冰砖、染色环、盲盒混合绘制
 * 严格遵循《UI/UX交互与视听资产规范》§1.1 & §3.2（含银河闪粉流沙皮肤）
 */
export class SandRenderer {
  private offscreen: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private imgData: ImageData;
  private buf32: Uint32Array;
  // 5 种颜色 × 37 档亮度查找表
  private lut = new Uint32Array(6 * 37);
  private starWhiteAbgr = packAbgr(255, 251, 235, 255);
  private iceBaseAbgr = new Uint32Array(6);

  constructor(
    tokens: UiTokensFile,
    createCanvasFn: () => HTMLCanvasElement
  ) {
    this.offscreen = createCanvasFn();
    this.offscreen.width = GW;
    this.offscreen.height = GH;
    const ctx = this.offscreen.getContext('2d');
    if (!ctx) throw new Error('无法创建离屏 2D 上下文');
    this.offCtx = ctx;
    this.imgData = this.offCtx.createImageData(GW, GH);
    this.buf32 = new Uint32Array(this.imgData.data.buffer);
    this.buildLut(tokens);
  }

  private buildLut(tokens: UiTokensFile): void {
    for (let cid = 1; cid <= 5; cid++) {
      const entry = tokens.sandPalette[String(cid)] as SandPaletteEntry | undefined;
      const [br, bg, bb] = hexToRgb(entry?.baseHex || '#FF7EB6');
      for (let s = 0; s <= 36; s++) {
        const d = s - 18;
        const r = Math.max(0, Math.min(255, br + d * 2));
        const g = Math.max(0, Math.min(255, bg + d * 2));
        const b = Math.max(0, Math.min(255, bb + d * 2));
        this.lut[cid * 37 + s] = packAbgr(r, g, b, 255);
      }
      // 冰冻沙砖：混合冰蓝白高透色
      const ir = Math.round(br * 0.42 + 216 * 0.58);
      const ig = Math.round(bg * 0.42 + 242 * 0.58);
      const ib = Math.round(bb * 0.42 + 255 * 0.58);
      this.iceBaseAbgr[cid] = packAbgr(ir, ig, ib, 242);
    }
  }

  public getSandColorHex(cid: SandColorId, tokens: UiTokensFile): string {
    const entry = tokens.sandPalette[String(cid)] as SandPaletteEntry | undefined;
    return entry?.bucketTint || entry?.baseHex || '#FF85BA';
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
    const shakeOffset =
      engine.screenShakeMs > 0 ? Math.sin(engine.frame * 1.8) * 3 : 0;

    const rx = chamberRect.x;
    const ry = chamberRect.y + shakeOffset;
    const rw = chamberRect.w;
    const rh = chamberRect.h;
    const sx = rw / GW;
    const sy = rh / GH;

    // 1. 更新 150x165 离屏像素缓冲（单帧零对象分配）
    const g = engine.grid;
    const sh = engine.shade;
    const b32 = this.buf32;
    const f = engine.frame;
    const chamberFill = packAbgr(255, 250, 240, 178); // 温润高透玻璃底衬

    for (let i = 0; i < TOTAL_CELLS; i++) {
      const v = g[i];
      if (v === 0) {
        b32[i] = engine.interior[i] ? chamberFill : 0;
      } else if (isSand(v)) {
        const s = sh[i];
        let col = this.lut[v * 37 + s];
        if (v === GOLD_SAND && ((i * 7 + (f >> 3)) % 13 === 0)) {
          col = this.starWhiteAbgr;
        } else if (galaxySkinActive && ((i * 19 + s) % 17 === 0) && ((f + i) % 24 < 5)) {
          col = this.starWhiteAbgr;
        }
        b32[i] = col;
      } else if (v >= FROZEN_BASE) {
        const iceIdx = v - FROZEN_BASE;
        const ic = engine.ice[iceIdx];
        b32[i] = ic ? this.iceBaseAbgr[ic.color] : packAbgr(210, 240, 255, 245);
      } else if (v === WALL) {
        // 内部隔墙将在矢量层叠绘蜂蜜木/玻璃描边，此处给柔和木褐底
        b32[i] = packAbgr(138, 92, 52, 235);
      } else {
        b32[i] = 0;
      }
    }
    this.offCtx.putImageData(this.imgData, 0, 0);

    ctx.save();

    // 2. 绘制像素锐利的流沙缓冲层
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.offscreen, rx, ry, rw, rh);
    ctx.imageSmoothingEnabled = true;

    // 3. 绘制染色环装置（ui_dye_ring 程序着色）
    for (const ring of engine.dyeRings) {
      const cx = rx + ((ring.x0 + ring.x1) * 0.5) * sx;
      const cy = ry + ((ring.y0 + ring.y1) * 0.5) * sy;
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

    // 4. 绘制脆冰砖（🧊高空砸硬底）与万年寒冰（❄️流沙冲刷解冻进度条）
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
      const zDef = engine.level.sandZones.find((z) => z.id === ic.zoneId);
      const polyPts = zDef?.shape === 'poly' && zDef.points && zDef.points.length >= 3 ? zDef.points : null;
      const origMinY = polyPts ? Math.min(...polyPts.map((p) => p[1])) : minY;
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
        ctx.globalAlpha = isPerma ? 0.65 : 0.52;
        ctx.drawImage(iceTex, ix - 2, iy - 2, iw + 4, ih + 4);
        ctx.restore();
      }

      if (isPerma) {
        ctx.save();
        traceIceShape();
        ctx.strokeStyle = ic.primed ? '#FDE047' : '#1D4ED8';
        ctx.lineWidth = 2.8;
        ctx.stroke();
        ctx.strokeStyle = '#BAE6FD';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();

        // 万年寒冰冲刷融化进度胶囊条（紧贴冰柱躯干中央，不遮挡斜坡导流面）
        const pct = Math.min(100, Math.floor((ic.thawProgress / Math.max(1, ic.thawContacts)) * 100));
        const barW = Math.min(iw - 4, 60);
        const barH = 14;
        const bx = ix + (iw - barW) * 0.5;
        const by = iy + ih * 0.62 - barH * 0.5;
        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
        ctx.beginPath();
        ctx.roundRect(bx, by, barW, barH, 6);
        ctx.fill();
        if (pct > 0) {
          ctx.fillStyle = ic.primed ? '#FACC15' : '#38BDF8';
          ctx.beginPath();
          ctx.roundRect(bx + 1.5, by + 1.5, Math.max(4, ((barW - 3) * pct) / 100), barH - 3, 5);
          ctx.fill();
        }
        ctx.fillStyle = '#FFFBEB';
        ctx.font = 'bold 9.5px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pct > 0 ? `❄️融${pct}%` : '❄️冲刷融', bx + barW * 0.5, by + barH * 0.5 + 0.5);
        ctx.restore();
      } else {
        ctx.save();
        traceIceShape();
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        if (iw >= 36 && ih >= 16) {
          const midGridX = (minX + maxX) * 0.5;
          const midGridY = (minY + maxY) * 0.5;
          const hasCenterCap = engine.capsules.some(
            (c) => !c.collected && Math.abs(c.x - midGridX) < 15 && Math.abs(c.y - midGridY) < 12
          );
          const tagY = hasCenterCap ? iy + ih + 18 : iy + ih * 0.5;
          ctx.save();
          ctx.fillStyle = 'rgba(12, 74, 110, 0.82)';
          ctx.beginPath();
          ctx.roundRect(ix + iw * 0.5 - 21, tagY - 7, 42, 14, 5);
          ctx.fill();
          ctx.fillStyle = '#E0F2FE';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🧊砸硬底', ix + iw * 0.5, tagY + 0.5);
          ctx.restore();
        }
      }
    }

    // 5. 绘制玻璃容器外壁手绘深棕双线与顶部木质罐口 / 底部黄铜出沙口
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const seg of engine.vessel.walls) {
      ctx.beginPath();
      seg.points.forEach(([px, py], k) => {
        const vx = rx + px * sx;
        const vy = ry + py * sy;
        if (k === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      });
      ctx.strokeStyle = tokens.theme.inkOutline;
      ctx.lineWidth = seg.thickness * sx * 1.65;
      ctx.stroke();

      ctx.strokeStyle = '#F3D5A5';
      ctx.lineWidth = Math.max(2, seg.thickness * sx * 0.65);
      ctx.stroke();
    }

    // 内部静态隔墙美化
    for (const w of engine.level.staticWalls || []) {
      ctx.beginPath();
      ctx.moveTo(rx + w.x0 * sx, ry + w.y0 * sy);
      ctx.lineTo(rx + w.x1 * sx, ry + w.y1 * sy);
      ctx.strokeStyle = tokens.theme.inkOutline;
      ctx.lineWidth = (w.thickness ?? 2) * sx * 1.9;
      ctx.stroke();
      ctx.strokeStyle = tokens.theme.woodPrimary;
      ctx.lineWidth = (w.thickness ?? 2) * sx * 1.05;
      ctx.stroke();
    }

    // 顶部罐口箍圈与底部黄铜出沙口贴图
    const rimImg = sprites.get('ui_vessel_rim');
    const firstWallX = engine.vessel.walls[0]?.points[0]?.[0] ?? 8;
    const secondWallX = engine.vessel.walls[1]?.points[0]?.[0] ?? 141;
    const rimX = rx + (firstWallX - 3) * sx;
    const rimW = (secondWallX - firstWallX + 6) * sx;
    if (rimImg) {
      ctx.drawImage(rimImg, rimX, ry + 1 * sy, rimW, 13 * sy);
    }

    const nozzleImg = sprites.get('ui_vessel_nozzle');
    const nozzleX = rx + 53 * sx;
    const nozzleY = ry + 148 * sy;
    const nozzleW = 44 * sx;
    const nozzleH = 20 * sy;
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
      ctx.strokeStyle = `rgba(92, 200, 255, ${0.8 * vt})`;
      ctx.lineWidth = 3;
      for (let ringIdx = 1; ringIdx <= 3; ringIdx++) {
        ctx.beginPath();
        ctx.arc(0, 0, ringIdx * 14 * (1.2 - 0.4 * vt), 0, Math.PI * 1.45);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 6. 绘制联动绳索、推入式关合闸门、可抽拉木板、斜坡滑板与颜色锁头
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
      ctx.lineWidth = 4.2;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2.2;
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
      const bh = Math.max(12, 5.2 * sy);
      const isLeftAnchored = Math.min(b.x0, b.x1) <= 22 && Math.max(b.x0, b.x1) < 126;
      const outerDir = isLeftAnchored ? -1 : 1;

      // 6a. 推入式闸门（初始开口态 isOpen = true）：绘制琥珀虚线导槽 + 外侧待推入插销头
      if (b.isOpen && !b.removed) {
        ctx.save();
        ctx.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5);
        ctx.rotate(angle);

        ctx.strokeStyle = 'rgba(74, 47, 29, 0.72)';
        ctx.lineWidth = Math.max(4, bh * 0.52);
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.moveTo(-len * 0.5, 0);
        ctx.lineTo(len * 0.5, 0);
        ctx.stroke();

        ctx.strokeStyle = '#FBBF24';
        ctx.lineWidth = Math.max(2, bh * 0.26);
        ctx.stroke();
        ctx.setLineDash([]);

        // 外侧待推入木栓短柄
        const stubLen = Math.min(34, Math.max(22, len * 0.34));
        const stubCenter = outerDir * (len * 0.5 + stubLen * 0.28);
        const gateTex = boardPushGate || boardWood;
        if (gateTex) {
          ctx.drawImage(gateTex, stubCenter - stubLen * 0.5, -bh * 0.8, stubLen, bh * 1.6);
        } else {
          ctx.fillStyle = '#D97706';
          ctx.strokeStyle = tokens.theme.inkOutline;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(stubCenter - stubLen * 0.5, -bh * 0.55, stubLen, bh * 1.1, 4);
          ctx.fill();
          ctx.stroke();
        }

        // 醒目“推”字微章提示
        ctx.save();
        ctx.translate(outerDir * (len * 0.5 - 4), 0);
        ctx.rotate(-angle);
        ctx.fillStyle = '#FEF3C7';
        ctx.strokeStyle = tokens.theme.inkOutline;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-17, -10, 34, 20, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#92400E';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(outerDir < 0 ? '推▶' : '◀推', 0, 0.5);
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

      const tex =
        b.kind === 'slant'
          ? boardSlant || boardWood
          : b.startsOpen || b.reusable
          ? boardPushGate || boardWood
          : boardWood;
      if (tex) {
        ctx.drawImage(tex, -len * 0.5 - 6, -bh * 0.75, len + 18, bh * 1.5);
      } else {
        ctx.fillStyle = tokens.theme.woodPrimary;
        ctx.strokeStyle = tokens.theme.inkOutline;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.roundRect(-len * 0.5, -bh * 0.5, len, bh, 5);
        ctx.fill();
        ctx.stroke();
      }

      // 外侧拉环木牌提示（往复活门闭合态显示“拉”字微章，与开启态“推”字呼应）
      if (!b.lockColor && !b.removed) {
        if (b.reusable) {
          ctx.save();
          ctx.translate(outerDir * (len * 0.5 - 2), 0);
          ctx.rotate(-angle);
          ctx.fillStyle = '#FDE68A';
          ctx.strokeStyle = tokens.theme.inkOutline;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(-16, -9.5, 32, 19, 8);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#78350F';
          ctx.font = 'bold 9.5px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(outerDir < 0 ? '◀拉' : '拉▶', 0, 0.5);
          ctx.restore();
        } else {
          const handleX = outerDir * (len * 0.5 + 4);
          ctx.fillStyle = b.startsOpen ? '#FBBF24' : '#F3C78B';
          ctx.strokeStyle = tokens.theme.inkOutline;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(handleX, 0, 7.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // 联动双栓黄铜滑轮徽章
      if (linkedIds.has(b.id) && !b.removed) {
        ctx.save();
        const gearOffsetX = b.lockColor ? 18 : 0;
        ctx.translate(gearOffsetX, 0);
        ctx.rotate(-angle);
        if (linkedGear) {
          ctx.drawImage(linkedGear, -12, -12, 24, 24);
        } else {
          ctx.fillStyle = '#F59E0B';
          ctx.strokeStyle = tokens.theme.inkOutline;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // 颜色锁徽章
      if (b.lockColor && !b.removed) {
        const lockTint = this.getSandColorHex(b.lockColor, tokens);
        const lockImg = sprites.getTinted('ui_lock_badge', lockTint);
        const shakeRot =
          b.lockShakeMs > 0 ? Math.sin(b.lockShakeMs * 0.08) * 0.25 : 0;
        ctx.save();
        ctx.rotate(-angle + shakeRot);
        if (lockImg) {
          ctx.drawImage(lockImg, -14, -15, 28, 30);
        } else {
          ctx.fillStyle = lockTint;
          ctx.strokeStyle = tokens.theme.inkOutline;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
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
      const size = cap.r * sx * 2.25 * scale;
      const pulse = 0.72 + 0.28 * Math.sin(engine.frame * 0.1 + cap.id);

      ctx.save();
      ctx.globalAlpha = alpha;
      // 品质呼吸光环
      ctx.fillStyle = boxCfg?.shellStyle.glowColor || 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.58 * pulse, 0, Math.PI * 2);
      ctx.fill();

      const boxSprite = sprites.get(cap.boxType);
      if (boxSprite) {
        ctx.drawImage(boxSprite, cx - size * 0.5, cy - size * 0.5, size, size);
      } else {
        ctx.fillStyle = boxCfg?.shellStyle.fill || '#F59E0B';
        ctx.strokeStyle = tokens.theme.inkOutline;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(cx - size * 0.42, cy - size * 0.42, size * 0.84, size * 0.84, 6);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  }
}
