import type { BucketRuntime } from '../engine/BucketSystem';
import type { SandEngine } from '../engine/SandEngine';
import type { SandColorShades, SandRenderer } from '../engine/SandRenderer';
import { GH, GW } from '../engine/SandGrid';
import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { RewardManager } from '../systems/RewardManager';
import type { SandColorId } from '../types/level';
import type { Rect, UiTokensFile } from '../types/ui';
import { computeCandidateColRect } from './FtueOverlay';
import {
  drawCoverImage,
  drawDoubleRimPlaque,
  drawHandDrawnGlyph,
  drawInkText,
  drawParchmentModalFrame,
  drawPlaqueText,
  drawRecessedTileCard,
  drawStatusPill,
  drawWoodButton,
  hitRect,
  roundRectPath,
} from './UIHelpers';

export type HudAction =
  | { type: 'OPEN_DRAWER' }
  | { type: 'OPEN_GUIDE' }
  | { type: 'DISPATCH_COL'; colIdx: number }
  | { type: 'PROP_UNDO' }
  | { type: 'PROP_VACUUM' }
  | { type: 'PROP_EXTRA_SLOT' }
  | { type: 'PROP_SHUFFLE' }
  | { type: 'PROP_LOCKED'; unlockLevel: number }
  | { type: 'PROP_RESTART_CONFIRMED' };

interface CompletedBottleGhost {
  idx: number;
  color: SandColorId;
  x: number;
  y: number;
  timerMs: number;
}

export const PROP_UNLOCK_LEVELS: readonly [number, number, number, number] = [2, 3, 2, 4];

function mixHex(hexA: string, hexB: string, t: number): string {
  const pa = parseInt(hexA.replace('#', ''), 16);
  const pb = parseInt(hexB.replace('#', ''), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const b = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * 日系治愈极简局内主界面（GameHUD · 静谧星夜轻绘风）：
 * 1. 顶栏：左侧纯序号胶囊（四宫格图标 + 01~20），右侧两枚纯图标圆钮（? 玩法 / ↻ 重玩，零文字）
 * 2. 台面第 1 层：4+1 磨砂奶油接沙杯垫（装入圆润系丝带糖果玻璃瓶，瓶内彩沙自底向上渐满）
 * 3. 台面第 2 层：3~4 列高密度纵深候选玻璃瓶滑道（同屏清晰展示最多 4 排玻璃瓶，支持和纸问号瓶与冰晶瓶）
 * 4. 底栏：4 枚纯图标治愈道具钮（撤回 / 磁吸 / +加瓶槽 / 洗牌，L2~L4 渐进解锁，零底文字）
 */
export class GameHUD {
  public mechanicBannerText: string | null = null;
  public mechanicBannerTimerMs = 0;
  public showRestartConfirm = false;
  public pressedBtnIdx: number | null = null;

  private confirmCancelRect: Rect = { x: 0, y: 0, w: 120, h: 40 };
  private confirmOkRect: Rect = { x: 0, y: 0, w: 120, h: 40 };

  private deadlockSlotBtnRect: Rect | null = null;
  private deadlockMagnetBtnRect: Rect | null = null;
  private deadlockUndoBtnRect: Rect | null = null;
  private deadlockRestartBtnRect: Rect = { x: 0, y: 0, w: 140, h: 40 };

  private trackedSignature = '';
  private seenDoneSet = new Set<number>();
  private lastKnownSlotPos = new Map<number, { x: number; y: number }>();
  private completedGhosts: CompletedBottleGhost[] = [];

  public setMechanicBanner(text: string | null): void {
    this.mechanicBannerText = text;
    this.mechanicBannerTimerMs = text ? 3600 : 0;
  }

  public update(dtMs: number): void {
    if (this.mechanicBannerTimerMs > 0) {
      this.mechanicBannerTimerMs = Math.max(0, this.mechanicBannerTimerMs - dtMs);
    }
    for (let i = this.completedGhosts.length - 1; i >= 0; i--) {
      this.completedGhosts[i].timerMs -= dtMs;
      if (this.completedGhosts[i].timerMs <= 0) {
        this.completedGhosts.splice(i, 1);
      }
    }
  }

  public isPropUnlocked(propIdx: number, currentLevel: number, maxClearedLevel: number): boolean {
    const req = PROP_UNLOCK_LEVELS[propIdx] ?? 2;
    return Math.max(currentLevel, maxClearedLevel + 1) >= req;
  }

  /**
   * 计算指定接沙槽（0..4）内玻璃瓶口屏幕坐标
   */
  public getActiveBucketMouthPos(
    layout: ComputedLayout,
    slotIdx: number,
    _dualMode = false
  ): { x: number; y: number } {
    const clamped = Math.max(0, Math.min(4, slotIdx));
    const sr = layout.activeSlotRects[clamped];
    return {
      x: sr.x + sr.w * 0.5,
      y: sr.y + sr.h * 0.16,
    };
  }

  public handleTap(
    px: number,
    py: number,
    layout: ComputedLayout,
    engine: SandEngine,
    maxClearedLevel = 20
  ): HudAction | 'CONSUMED' | null {
    // 1. 确认重玩弹窗最高优先
    if (this.showRestartConfirm) {
      if (hitRect(px, py, this.confirmCancelRect)) {
        this.showRestartConfirm = false;
        return 'CONSUMED';
      }
      if (hitRect(px, py, this.confirmOkRect)) {
        this.showRestartConfirm = false;
        return { type: 'PROP_RESTART_CONFIRMED' };
      }
      return 'CONSUMED';
    }

    // 2. 硬死局救援弹窗拦截
    if (engine.bucketSys.hardDeadlockActive && !engine.won) {
      if (this.deadlockSlotBtnRect && hitRect(px, py, this.deadlockSlotBtnRect)) {
        return { type: 'PROP_EXTRA_SLOT' };
      }
      if (this.deadlockMagnetBtnRect && hitRect(px, py, this.deadlockMagnetBtnRect)) {
        return { type: 'PROP_VACUUM' };
      }
      if (this.deadlockUndoBtnRect && hitRect(px, py, this.deadlockUndoBtnRect)) {
        return { type: 'PROP_UNDO' };
      }
      if (hitRect(px, py, this.deadlockRestartBtnRect)) {
        return { type: 'PROP_RESTART_CONFIRMED' };
      }
      return 'CONSUMED';
    }

    // 3. 极简顶栏三钮：序号选关胶囊 | ? | ↻
    if (hitRect(px, py, layout.settingsPill)) return { type: 'OPEN_DRAWER' };
    if (hitRect(px, py, layout.guidePill)) return { type: 'OPEN_GUIDE' };
    if (hitRect(px, py, layout.restartPill)) {
      const usedPaidProps =
        engine.vacuumUsedCount > 0 ||
        engine.shuffleUsedCount > 0 ||
        engine.bucketSys.maxActiveSlots > 4;
      if (usedPaidProps && !engine.won) {
        this.showRestartConfirm = true;
        return 'CONSUMED';
      }
      return { type: 'PROP_RESTART_CONFIRMED' };
    }

    // 4. 点选未解锁的第 5 接沙槽快捷加槽
    if (
      engine.bucketSys.maxActiveSlots < 5 &&
      hitRect(px, py, layout.activeSlotRects[4]) &&
      !engine.won
    ) {
      if (!this.isPropUnlocked(2, engine.level.levelId, maxClearedLevel)) {
        return { type: 'PROP_LOCKED', unlockLevel: PROP_UNLOCK_LEVELS[2] };
      }
      return { type: 'PROP_EXTRA_SLOT' };
    }

    // 5. 点选下方 3~4 列候选玻璃瓶槽道
    if (hitRect(px, py, layout.candidateAreaRect) && !engine.won) {
      const numCols = engine.bucketSys.numCols;
      for (let c = 0; c < numCols; c++) {
        const colRect = computeCandidateColRect(layout, c, numCols);
        if (hitRect(px, py, colRect)) {
          return { type: 'DISPATCH_COL', colIdx: c };
        }
      }
    }

    // 6. 底栏四枚纯图标道具钮（L1 首通前隐藏，L2~L4 渐进解锁）
    if (engine.level.levelId === 1 && maxClearedLevel === 0) {
      return null;
    }
    const actions: HudAction['type'][] = ['PROP_UNDO', 'PROP_VACUUM', 'PROP_EXTRA_SLOT', 'PROP_SHUFFLE'];
    for (let i = 0; i < 4; i++) {
      if (hitRect(px, py, layout.propButtons[i])) {
        if (!this.isPropUnlocked(i, engine.level.levelId, maxClearedLevel)) {
          return { type: 'PROP_LOCKED', unlockLevel: PROP_UNLOCK_LEVELS[i] };
        }
        return { type: actions[i] } as HudAction;
      }
    }

    return null;
  }

  public renderBackground(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    const bg = assets.get('ui_bg_gameplay');
    if (bg) {
      drawCoverImage(ctx, bg, layout.screenW, layout.screenH);
    } else {
      ctx.fillStyle = tokens.theme.parchmentBg;
      ctx.fillRect(0, 0, layout.screenW, layout.screenH);
    }
  }

  public renderForeground(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    engine: SandEngine,
    sandRenderer: SandRenderer,
    assets: AssetLoader,
    rewardMgr: RewardManager,
    tokens: UiTokensFile,
    timeSec: number,
    maxClearedLevel = 20
  ): void {
    // ========================================================================
    // 1. 极简顶栏：左侧纯序号胶囊（四宫格 + 01~20） | 右侧纯图标圆钮（? / ↻）
    // ========================================================================
    const sp = layout.settingsPill;
    drawDoubleRimPlaque(ctx, sp, tokens, {
      variant: 'parchment',
      radius: sp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'grid', sp.x + 21, sp.y + sp.h * 0.5, 16, tokens);
    drawInkText(
      ctx,
      String(engine.level.levelId).padStart(2, '0'),
      sp.x + sp.w * 0.5 + 11,
      sp.y + sp.h * 0.5 + 0.5,
      tokens,
      {
        font: `700 15.5px ${tokens.typography.numeralFontFamily}`,
        color: '#4B403B',
      }
    );

    const gp = layout.guidePill;
    drawDoubleRimPlaque(ctx, gp, tokens, {
      variant: 'sky',
      radius: gp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'question', gp.x + gp.w * 0.5, gp.y + gp.h * 0.5, 17, tokens);

    const rp = layout.restartPill;
    drawDoubleRimPlaque(ctx, rp, tokens, {
      variant: 'amber',
      radius: rp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'restart', rp.x + rp.w * 0.5, rp.y + rp.h * 0.5, 16.5, tokens);

    // ========================================================================
    // 2. Stage 1 软性卡槽停滞轻提示胶囊
    // ========================================================================
    const clogActive = engine.bucketSys.clogWarningActive;
    const hardDeadlock = engine.bucketSys.hardDeadlockActive;
    if (clogActive && !hardDeadlock && !engine.won) {
      const cw = Math.min(286, layout.chamberRect.w - 16);
      const cx = (layout.screenW - cw) * 0.5;
      const cy = layout.chamberRect.y + layout.chamberRect.h - 38;
      drawDoubleRimPlaque(ctx, { x: cx, y: cy, w: cw, h: 28 }, tokens, {
        variant: 'rose',
        radius: 14,
      });
      drawInkText(
        ctx,
        '瓶口未匹配底沙 · 可抽拨片或用下方道具',
        cx + cw * 0.5,
        cy + 14.5,
        tokens,
        {
          font: `600 10.5px ${tokens.typography.fontFamily}`,
          color: '#7A3E46',
          maxWidth: cw - 20,
        }
      );
    }

    // ========================================================================
    // 3. 双层磨砂奶油玻璃瓶台（4+1 接沙杯垫 + 最多 4 排纵深系丝带糖果玻璃瓶）
    // ========================================================================
    this.renderDualTierWorkbench(ctx, layout, engine, sandRenderer, tokens, timeSec, false, maxClearedLevel);

    // ========================================================================
    // 4. 底部四枚纯图标治愈道具钮（L1 首通前留白，L2~L4 渐进解锁）
    // ========================================================================
    if (!(engine.level.levelId === 1 && maxClearedLevel === 0)) {
      this.renderPropBar(
        ctx,
        layout,
        engine,
        rewardMgr,
        clogActive || hardDeadlock,
        tokens,
        timeSec,
        maxClearedLevel
      );
    }

    // ========================================================================
    // 5. Stage 2 硬死局救援弹窗 & 确认重玩弹窗
    // ========================================================================
    if (hardDeadlock && !engine.won && !this.showRestartConfirm) {
      this.renderDeadlockRescueModal(ctx, layout, engine, assets, tokens);
    }
    if (this.showRestartConfirm) {
      this.renderRestartConfirmModal(ctx, layout, assets, tokens);
    }
  }

  private syncCompletedSlotGhosts(layout: ComputedLayout, engine: SandEngine): void {
    const sig = `${engine.level.levelId}|${engine.bucketSys.buckets.length}`;
    const isFresh =
      sig !== this.trackedSignature ||
      (engine.frame <= 2 &&
        engine.boardsPulledCount === 0 &&
        engine.bucketsDispatchedCount === 0 &&
        engine.bucketSys.buckets.every(b => !b.done));

    if (isFresh) {
      this.trackedSignature = sig;
      this.seenDoneSet.clear();
      this.lastKnownSlotPos.clear();
      this.completedGhosts = [];
    }

    for (let s = 0; s < 5; s++) {
      const bk = engine.bucketSys.activeSlots[s];
      if (bk && !bk.done) {
        const sr = layout.activeSlotRects[s];
        this.lastKnownSlotPos.set(bk.idx, {
          x: sr.x + sr.w * 0.5,
          y: sr.y + 6,
        });
      }
    }

    for (const bk of engine.bucketSys.buckets) {
      if (bk.done && !this.seenDoneSet.has(bk.idx)) {
        this.seenDoneSet.add(bk.idx);
        const pos = this.lastKnownSlotPos.get(bk.idx) || {
          x: layout.screenW * 0.5,
          y: layout.slotRowRect.y + 6,
        };
        this.completedGhosts.push({
          idx: bk.idx,
          color: bk.color,
          x: pos.x,
          y: pos.y,
          timerMs: 260,
        });
      } else if (!bk.done && this.seenDoneSet.has(bk.idx)) {
        this.seenDoneSet.delete(bk.idx);
      }
    }
  }

  private renderDualTierWorkbench(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    engine: SandEngine,
    sandRenderer: SandRenderer,
    tokens: UiTokensFile,
    timeSec: number,
    rainbowDrain: boolean,
    maxClearedLevel: number
  ): void {
    const W = layout.screenW;
    const H = layout.screenH;
    const topY = layout.bucketRowRect.y;
    const candTopY = layout.candidateAreaRect.y;

    this.syncCompletedSlotGhosts(layout, engine);

    // 1. 轻盈磨砂奶油双层玻璃瓶陈列台（告别深暗胡桃木重柜）
    ctx.save();
    const backShadow = ctx.createLinearGradient(0, topY - 12, 0, topY);
    backShadow.addColorStop(0, 'rgba(30, 28, 48, 0)');
    backShadow.addColorStop(1, 'rgba(30, 28, 48, 0.10)');
    ctx.fillStyle = backShadow;
    ctx.fillRect(0, topY - 12, W, 12);

    // 上层：磨砂象牙白接沙托盘
    const shelfGrad = ctx.createLinearGradient(0, topY, 0, candTopY);
    shelfGrad.addColorStop(0, 'rgba(255, 254, 251, 0.90)');
    shelfGrad.addColorStop(1, 'rgba(245, 240, 231, 0.92)');
    ctx.fillStyle = shelfGrad;
    ctx.beginPath();
    roundRectPath(ctx, 4, topY, W - 8, H - topY + 18, 22);
    ctx.fill();

    ctx.strokeStyle = 'rgba(122, 107, 99, 0.36)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(22, topY + 1.5);
    ctx.lineTo(W - 22, topY + 1.5);
    ctx.stroke();

    // 下层：柔和暖米雾面玻璃瓶陈列底盘
    const trayGrad = ctx.createLinearGradient(0, candTopY, 0, H);
    trayGrad.addColorStop(0, 'rgba(241, 236, 226, 0.82)');
    trayGrad.addColorStop(1, 'rgba(233, 228, 218, 0.90)');
    ctx.fillStyle = trayGrad;
    ctx.fillRect(6, candTopY, W - 12, Math.max(0, H - candTopY));

    ctx.strokeStyle = 'rgba(122, 107, 99, 0.20)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(16, candTopY);
    ctx.lineTo(W - 16, candTopY);
    ctx.stroke();
    ctx.restore();

    // 2. 绘制上层 4+1 磨砂奶油杯垫与槽内系丝带糖果玻璃瓶（零文字编号）
    const maxSlots = engine.bucketSys.maxActiveSlots;
    const slotPropUnlocked = this.isPropUnlocked(2, engine.level.levelId, maxClearedLevel);
    for (let s = 0; s < 5; s++) {
      const sr = layout.activeSlotRects[s];
      const locked5th = s >= maxSlots;
      if (locked5th && !slotPropUnlocked) continue;
      const bk = engine.bucketSys.activeSlots[s];
      const isReceiving = Boolean(bk && !bk.done && engine.slotPourMs[s] > 0);

      ctx.save();
      ctx.fillStyle = locked5th
        ? 'rgba(235, 231, 223, 0.65)'
        : isReceiving
          ? 'rgba(255, 248, 214, 0.86)'
          : 'rgba(255, 255, 255, 0.68)';
      ctx.strokeStyle = isReceiving ? '#E5B24C' : 'rgba(122, 107, 99, 0.34)';
      ctx.lineWidth = isReceiving ? 1.8 : 1.25;
      ctx.beginPath();
      roundRectPath(ctx, sr.x, sr.y, sr.w, sr.h, 13);
      ctx.fill();
      ctx.stroke();

      if (locked5th) {
        drawHandDrawnGlyph(ctx, 'extra_slot', sr.x + sr.w * 0.5, sr.y + sr.h * 0.5, 22, tokens);
      } else if (bk && !bk.done) {
        const pct = Math.min(100, Math.floor((bk.cur / Math.max(1, bk.max)) * 100));
        const shades = sandRenderer.getSandShades(bk.color);
        const bw = Math.min(sr.w * 0.76, 44);
        const bh = Math.min(sr.h * 0.88, 45);
        this.drawRibbonGlassBottle(
          ctx,
          sr.x + sr.w * 0.5,
          sr.y + sr.h - 2.5,
          bw,
          bh,
          pct,
          shades,
          true,
          isReceiving,
          tokens,
          timeSec
        );
      } else {
        // 空杯垫中心极简虚线圆环（无「槽1」文字）
        ctx.strokeStyle = 'rgba(138, 124, 114, 0.28)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(sr.x + sr.w * 0.5, sr.y + sr.h * 0.54, Math.min(sr.w, sr.h) * 0.24, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. 绘制下层 3~4 列纵深候选系丝带玻璃瓶滑道（同屏展示最多 4 排！）
    const numCols = engine.bucketSys.numCols;
    const slotsHaveSpace = engine.bucketSys.occupiedSlotCount < maxSlots;
    const shuffleJitter =
      engine.shuffleAnimMs > 0 ? Math.sin(engine.shuffleAnimMs * 0.08) * 3.0 : 0;

    for (let c = 0; c < numCols; c++) {
      const colRect = computeCandidateColRect(layout, c, numCols);
      const col = engine.bucketSys.columns[c] || [];

      ctx.save();
      const grooveGrad = ctx.createLinearGradient(colRect.x, colRect.y, colRect.x, colRect.y + colRect.h);
      grooveGrad.addColorStop(0, 'rgba(255, 255, 255, 0.62)');
      grooveGrad.addColorStop(1, 'rgba(246, 243, 236, 0.48)');
      ctx.fillStyle = grooveGrad;
      ctx.strokeStyle = 'rgba(122, 107, 99, 0.28)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      roundRectPath(ctx, colRect.x, colRect.y, colRect.w, colRect.h, 14);
      ctx.fill();
      ctx.stroke();

      if (col.length === 0) {
        ctx.strokeStyle = 'rgba(122, 107, 99, 0.22)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(colRect.x + colRect.w * 0.5, colRect.y + colRect.h * 0.5, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      const visibleCount = Math.min(4, col.length);
      const frontH = Math.min(43, colRect.h * 0.39);
      const frontW = Math.min(46, colRect.w * 0.68);
      const availDepth = Math.max(18, colRect.h - frontH - 9);
      const rowStepY =
        visibleCount > 1 ? Math.min(23, availDepth / (visibleCount - 1)) : 0;

      // 从后排向前排绘制，第 0 排最清晰饱满且自然遮挡后排瓶身下半部，露出后排瓶颈蝴蝶结丝带！
      for (let r = visibleCount - 1; r >= 0; r--) {
        const bk = col[r];
        const isFront = r === 0;
        const scale = isFront ? 1.0 : r === 1 ? 0.87 : r === 2 ? 0.77 : 0.69;
        const bw = frontW * scale;
        const bh = frontH * scale;
        const iceShake = bk.iceShakeMs > 0 ? Math.sin(bk.iceShakeMs * 0.12) * 3.2 : 0;
        const cx = colRect.x + colRect.w * 0.5 + iceShake + (r % 2 === 0 ? shuffleJitter : -shuffleJitter);
        const baseY = colRect.y + 5 + frontH + r * rowStepY;

        ctx.save();
        if (!isFront) {
          ctx.globalAlpha = r === 1 ? 0.92 : r === 2 ? 0.82 : 0.72;
        }

        if (isFront && bk.iceLayers === 0 && slotsHaveSpace) {
          ctx.fillStyle = 'rgba(250, 224, 130, 0.24)';
          ctx.beginPath();
          ctx.ellipse(cx, baseY - bh * 0.36, bw * 0.62, bh * 0.44, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        this.drawCandidateBottle(ctx, bk, cx, baseY, bw, bh, isFront, sandRenderer, tokens, timeSec);
        ctx.restore();
      }

      if (col.length > 4) {
        drawStatusPill(
          ctx,
          colRect.x + colRect.w - 14,
          colRect.y + colRect.h - 10,
          `+${col.length - 4}`,
          tokens,
          {
            bgHex: 'rgba(255, 253, 249, 0.94)',
            borderHex: 'rgba(122, 107, 99, 0.45)',
            textColor: '#4B403B',
            fontSize: 8.5,
            padX: 5,
            height: 14,
          }
        );
      }

      ctx.restore();
    }

    // 4. 满瓶瞬间轻盈星芒浮升反馈（极简纯符号 ✦100%）
    for (const gh of this.completedGhosts) {
      const p = 1 - gh.timerMs / 260;
      const liftY = -18 * Math.sin(p * Math.PI * 0.85);
      const alpha = Math.max(0, 1 - p);
      const shades = sandRenderer.getSandShades(gh.color);
      ctx.save();
      ctx.globalAlpha = alpha;
      drawStatusPill(ctx, gh.x, gh.y + liftY, '✦ 100%', tokens, {
        bgHex: shades.highlightHex,
        borderHex: '#6A5B53',
        textColor: '#4B403B',
        fontSize: 9.5,
      });
      ctx.restore();
    }

    // 5. 多束流沙柱倾入对应玻璃瓶口
    for (let s = 0; s < 5; s++) {
      const pourMs = engine.slotPourMs[s];
      const cid = engine.slotPourColor[s] as SandColorId | 0;
      const targetBk = engine.bucketSys.activeSlots[s];
      if (pourMs > 0 && cid >= 1 && cid <= 5 && targetBk && !targetBk.done) {
        const mouth = this.getActiveBucketMouthPos(layout, s);
        this.renderPouringSandStream(
          ctx,
          layout,
          engine,
          sandRenderer,
          engine.slotPourX[s] || 75,
          cid as SandColorId,
          pourMs,
          mouth.x,
          mouth.y,
          timeSec,
          rainbowDrain
        );
      }
    }
  }

  /**
   * 绘制候选列中的系丝带糖果玻璃瓶：支持正常彩丝带瓶、和纸雾面「?」盲瓶与冰晶冻结瓶（零汉字）
   */
  private drawCandidateBottle(
    ctx: CanvasRenderingContext2D,
    bk: BucketRuntime,
    cx: number,
    baseY: number,
    w: number,
    h: number,
    isFront: boolean,
    sandRenderer: SandRenderer,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    const flipScaleX =
      bk.revealAnimMs > 0
        ? Math.max(0.18, Math.abs(Math.cos((bk.revealAnimMs / 380) * Math.PI)))
        : 1;

    ctx.save();
    if (flipScaleX < 0.999) {
      ctx.translate(cx, baseY - h * 0.5);
      ctx.scale(flipScaleX, 1);
      ctx.translate(-cx, -(baseY - h * 0.5));
    }

    if (!bk.mysteryRevealed) {
      // 未揭晓的后排「和纸雾面问号瓶」：柔白磨砂瓶身 + 亚麻奶白蝴蝶结 + 极简「?」
      const mysteryShades: SandColorShades = {
        baseHex: '#DDD4C6',
        highlightHex: '#F7F2E8',
        shadowHex: '#B8AD9E',
        outlineHex: '#6E6259',
        pebbleDarkHex: '#9C9082',
      };
      this.drawRibbonGlassBottle(
        ctx,
        cx,
        baseY,
        w,
        h,
        0,
        mysteryShades,
        false,
        false,
        tokens,
        timeSec,
        true
      );
    } else {
      const shades = sandRenderer.getSandShades(bk.color);
      this.drawRibbonGlassBottle(
        ctx,
        cx,
        baseY,
        w,
        h,
        0,
        shades,
        isFront && bk.iceLayers === 0,
        false,
        tokens,
        timeSec,
        false
      );
    }

    // 冰封玻璃瓶：外覆清透淡蓝冰晶壳 + 极简雪花 ×N 角标（零汉字）
    if (bk.iceLayers > 0) {
      const topY = baseY - h;
      ctx.save();
      const iceGrad = ctx.createLinearGradient(cx - w * 0.48, topY, cx + w * 0.48, baseY);
      iceGrad.addColorStop(0, 'rgba(232, 249, 255, 0.76)');
      iceGrad.addColorStop(0.55, 'rgba(165, 221, 248, 0.56)');
      iceGrad.addColorStop(1, 'rgba(116, 189, 232, 0.64)');
      ctx.fillStyle = iceGrad;
      ctx.strokeStyle = '#4B82AB';
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      roundRectPath(ctx, cx - w * 0.48, topY + h * 0.16, w * 0.96, h * 0.84, w * 0.36);
      ctx.fill();
      ctx.stroke();

      // 极简雪花数字胶囊（❄ + ×N）
      const pillW = isFront ? 32 : 27;
      const pillH = isFront ? 15 : 13;
      const py = baseY - h * 0.36;
      ctx.fillStyle = 'rgba(244, 251, 255, 0.94)';
      ctx.strokeStyle = '#4B82AB';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      roundRectPath(ctx, cx - pillW * 0.5, py - pillH * 0.5, pillW, pillH, pillH * 0.5);
      ctx.fill();
      ctx.stroke();

      drawHandDrawnGlyph(ctx, 'snowflake', cx - pillW * 0.22, py, isFront ? 10 : 8.5, tokens);
      drawInkText(ctx, `×${bk.iceLayers}`, cx + pillW * 0.16, py + 0.5, tokens, {
        font: `700 ${isFront ? 9.5 : 8}px ${tokens.typography.numeralFontFamily}`,
        color: '#2B5B80',
      });
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * 绘制日系治愈系丝带透明糖果玻璃瓶（彻底取代旧木桶！）
   * - 圆润晶莹玻璃瓶腹 + 外翻圆玻璃瓶唇
   * - 瓶颈系着与沙色 1:1 对应的丝缎蝴蝶结双飘带
   * - 接沙时彩沙在透明玻璃瓶腹内自底向上真实堆积升高，透过玻璃清晰可见
   */
  private drawRibbonGlassBottle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
    w: number,
    h: number,
    pct: number,
    shades: SandColorShades,
    isActive: boolean,
    isPouringInto: boolean,
    tokens: UiTokensFile,
    timeSec: number,
    isMystery = false
  ): void {
    const ink = '#5A4D46';
    const bounce = isPouringInto ? Math.sin(timeSec * 22) * 0.7 : 0;
    const topY = baseY - h + bounce;

    const lipHalfW = w * 0.29;
    const lipH = Math.max(3.4, h * 0.095);
    const neckHalfW = w * 0.22;
    const neckY = topY + lipH + h * 0.08;
    const bellyTopY = neckY + h * 0.05;
    const bellyHalfW = w * 0.46;
    const bellyR = Math.min(bellyHalfW * 0.82, (baseY - bellyTopY) * 0.48);

    const traceBellyPath = (inset = 0) => {
      const bx0 = cx - (bellyHalfW - inset);
      const bx1 = cx + (bellyHalfW - inset);
      const by0 = bellyTopY + inset * 0.6;
      const by1 = baseY - inset;
      const br = Math.max(3, bellyR - inset * 0.75);
      ctx.beginPath();
      roundRectPath(ctx, bx0, by0, bx1 - bx0, Math.max(6, by1 - by0), br);
    };

    ctx.save();

    // 1. 瓶底柔和漫射投影
    ctx.fillStyle = isActive ? 'rgba(36, 30, 52, 0.18)' : 'rgba(36, 30, 52, 0.12)';
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 1.0, bellyHalfW * 0.84, Math.max(2.4, h * 0.065), 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. 瓶颈与透明糖果圆瓶腹底衬
    const glassGrad = ctx.createLinearGradient(cx - bellyHalfW, bellyTopY, cx + bellyHalfW, baseY);
    if (isMystery) {
      glassGrad.addColorStop(0, 'rgba(252, 248, 240, 0.95)');
      glassGrad.addColorStop(0.6, 'rgba(238, 230, 216, 0.93)');
      glassGrad.addColorStop(1, 'rgba(224, 214, 198, 0.95)');
    } else {
      glassGrad.addColorStop(0, 'rgba(255, 255, 255, 0.84)');
      glassGrad.addColorStop(0.45, mixHex(shades.highlightHex, '#F2F9FF', 0.78));
      glassGrad.addColorStop(1, mixHex(shades.baseHex, '#DCECF8', 0.74));
    }

    // 瓶颈短柱
    ctx.fillStyle = glassGrad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    roundRectPath(ctx, cx - neckHalfW, topY + lipH * 0.7, neckHalfW * 2, neckY - topY, 3);
    ctx.fill();
    ctx.stroke();

    // 圆润瓶腹主体
    ctx.fillStyle = glassGrad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = isActive ? 1.55 : 1.4;
    traceBellyPath(0);
    ctx.fill();

    // 3. 瓶腹内部彩沙堆积（或候选态瓶底微垫同色星砂底韵）
    const fillRatio = isMystery ? 0 : pct > 0 ? Math.min(1, pct / 100) : 0.16;
    if (fillRatio > 0) {
      ctx.save();
      traceBellyPath(1.8);
      ctx.clip();

      const innerH = baseY - 1.8 - (bellyTopY + 1.2);
      const sandTopY = baseY - 1.8 - innerH * (0.14 + 0.84 * fillRatio);
      const waveAmp = isPouringInto ? Math.sin(timeSec * 16) * 1.6 : 1.2;

      const sGrad = ctx.createLinearGradient(cx, sandTopY - 3, cx, baseY);
      sGrad.addColorStop(0, shades.highlightHex);
      sGrad.addColorStop(0.45, shades.baseHex);
      sGrad.addColorStop(1, shades.shadowHex);

      ctx.fillStyle = sGrad;
      ctx.beginPath();
      ctx.moveTo(cx - bellyHalfW - 2, baseY + 2);
      ctx.lineTo(cx - bellyHalfW - 2, sandTopY + 1.5);
      ctx.quadraticCurveTo(cx, sandTopY - 2.2 + waveAmp, cx + bellyHalfW + 2, sandTopY + 1.5);
      ctx.lineTo(cx + bellyHalfW + 2, baseY + 2);
      ctx.closePath();
      ctx.fill();

      // 沙面柔亮顶线
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.58)';
      ctx.lineWidth = 1.05;
      ctx.beginPath();
      ctx.moveTo(cx - bellyHalfW + 2, sandTopY + 1.2);
      ctx.quadraticCurveTo(cx, sandTopY - 2.0 + waveAmp, cx + bellyHalfW - 2, sandTopY + 1.2);
      ctx.stroke();
      ctx.restore();
    }

    // 瓶腹外轮廓描边与玻璃高光弯弧（叠在彩沙上方呈现真实通透玻璃质感）
    ctx.strokeStyle = ink;
    ctx.lineWidth = isActive ? 1.55 : 1.4;
    traceBellyPath(0);
    ctx.stroke();

    // 左侧月牙形高透玻璃反光带 + 右上水滴光斑
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.lineWidth = Math.max(1.5, w * 0.055);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - bellyHalfW + 3.6, bellyTopY + 4.8);
    ctx.quadraticCurveTo(
      cx - bellyHalfW + 2.4,
      (bellyTopY + baseY) * 0.5,
      cx - bellyHalfW + 4.4,
      baseY - 5.2
    );
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
    ctx.beginPath();
    ctx.arc(cx + bellyHalfW - 4.8, bellyTopY + 5.2, Math.max(1.2, w * 0.038), 0, Math.PI * 2);
    ctx.fill();

    // 4. 瓶口晶莹厚翻唇与瓶口微椭圆内腔
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    roundRectPath(ctx, cx - lipHalfW, topY, lipHalfW * 2, lipH, lipH * 0.5);
    ctx.fill();
    ctx.stroke();

    // 5. 瓶颈同色丝缎蝴蝶结（Satin Ribbon Bow：系带 + 左右饱满双耳 + 飘逸燕尾双飘带 + 中心圆结）
    const ribBase = isMystery ? '#E5DAC8' : shades.baseHex;
    const ribHi = isMystery ? '#FAF5EC' : mixHex(shades.highlightHex, '#FFFFFF', 0.22);
    const ribDark = isMystery ? '#B9AC98' : mixHex(shades.shadowHex, '#4A3B36', 0.14);
    const ribStroke = isMystery ? '#6E6259' : mixHex(shades.shadowHex, '#3E312C', 0.48);
    const bowY = neckY + 0.5;
    const loopW = Math.max(5.2, w * 0.19);
    const loopH = Math.max(3.2, h * 0.088);

    // 瓶颈环绕丝带箍
    ctx.fillStyle = ribBase;
    ctx.strokeStyle = ribStroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    roundRectPath(ctx, cx - neckHalfW - 0.8, bowY - 1.8, (neckHalfW + 0.8) * 2, 3.6, 1.6);
    ctx.fill();
    ctx.stroke();

    // 下垂飘逸双丝带尾
    ctx.fillStyle = ribDark;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + dir * 1.2, bowY + 0.8);
      ctx.quadraticCurveTo(
        cx + dir * (loopW * 0.72),
        bowY + loopH * 1.4,
        cx + dir * (loopW * 0.98),
        bowY + loopH * 2.25
      );
      ctx.lineTo(cx + dir * (loopW * 0.45), bowY + loopH * 1.95);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 左右饱满蝴蝶结丝带环
    const bowGrad = ctx.createLinearGradient(cx, bowY - loopH, cx, bowY + loopH);
    bowGrad.addColorStop(0, ribHi);
    bowGrad.addColorStop(0.6, ribBase);
    bowGrad.addColorStop(1, ribDark);
    ctx.fillStyle = bowGrad;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx, bowY);
      ctx.bezierCurveTo(
        cx + dir * (loopW * 0.55),
        bowY - loopH * 1.35,
        cx + dir * (loopW * 1.28),
        bowY - loopH * 0.85,
        cx + dir * (loopW * 1.08),
        bowY + loopH * 0.15
      );
      ctx.bezierCurveTo(
        cx + dir * (loopW * 0.92),
        bowY + loopH * 1.05,
        cx + dir * (loopW * 0.38),
        bowY + loopH * 0.82,
        cx,
        bowY + 0.6
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 蝴蝶结中心丝缎小结
    ctx.fillStyle = ribHi;
    ctx.beginPath();
    roundRectPath(ctx, cx - 2.1, bowY - 2.0, 4.2, 4.0, 1.8);
    ctx.fill();
    ctx.stroke();

    // 6. 问号瓶符号或接沙百分比轻盈数字（候选已知瓶保持纯净玻璃视觉，不贴冗余纸标签）
    if (isMystery) {
      drawInkText(ctx, '?', cx, (bellyTopY + baseY) * 0.5 + 2, tokens, {
        font: `700 ${Math.max(11, Math.round(h * 0.30))}px ${tokens.typography.numeralFontFamily}`,
        color: '#6B5E54',
      });
    } else if (pct > 0) {
      drawPlaqueText(ctx, `${pct}%`, cx, (bellyTopY + baseY) * 0.5 + 3, tokens, {
        font: `700 9.5px ${tokens.typography.numeralFontFamily}`,
        fill: '#FFFDFB',
        stroke: 'rgba(74, 62, 56, 0.78)',
        strokeWidth: 1.35,
        shadowColor: '',
      });
    }

    ctx.restore();
  }

  private renderPouringSandStream(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    engine: SandEngine,
    sandRenderer: SandRenderer,
    sourceGridX: number,
    cid: SandColorId,
    pourMs: number,
    endX: number,
    endY: number,
    timeSec: number,
    rainbowDrain: boolean
  ): void {
    const ch = layout.chamberRect;
    const shakeY = engine.screenShakeMs > 0 ? Math.sin(engine.frame * 1.8) * 3 : 0;
    const spoutX = ch.x + ch.w * (Math.max(24, Math.min(125, sourceGridX)) / GW);
    const spoutY = ch.y + shakeY + ch.h * (163.5 / GH);

    const fade = Math.min(1, pourMs / 75);
    const widthScale = 0.72 + 0.28 * fade;
    const dy = Math.max(12, endY - spoutY);
    const c1x = spoutX;
    const c1y = spoutY + dy * 0.48;
    const c2x = endX;
    const c2y = spoutY + dy * 0.52;

    const shades = sandRenderer.getSandShades(cid);

    ctx.save();
    ctx.globalAlpha = Math.min(0.95, 0.45 + 0.5 * fade);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const steps = 12;
    const leftPts: [number, number][] = [];
    const rightPts: [number, number][] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      const px = u * u * u * spoutX + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * endX;
      const py = u * u * u * spoutY + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * endY;
      const halfW = (2.5 + (1 - t) * 1.3) * widthScale;
      leftPts.push([px - halfW, py]);
      rightPts.push([px + halfW, py]);
    }

    ctx.beginPath();
    ctx.moveTo(leftPts[0][0], leftPts[0][1]);
    for (let s = 1; s <= steps; s++) ctx.lineTo(leftPts[s][0], leftPts[s][1]);
    for (let s = steps; s >= 0; s--) ctx.lineTo(rightPts[s][0], rightPts[s][1]);
    ctx.closePath();

    if (rainbowDrain) {
      const rGrad = ctx.createLinearGradient(spoutX, spoutY, endX, endY);
      const baseHue = (timeSec * 220) % 360;
      rGrad.addColorStop(0, `hsl(${baseHue}, 85%, 74%)`);
      rGrad.addColorStop(0.5, `hsl(${(baseHue + 90) % 360}, 85%, 74%)`);
      rGrad.addColorStop(1, `hsl(${(baseHue + 180) % 360}, 85%, 74%)`);
      ctx.fillStyle = rGrad;
    } else {
      const sGrad = ctx.createLinearGradient(spoutX, spoutY, endX, endY);
      sGrad.addColorStop(0, shades.baseHex);
      sGrad.addColorStop(0.5, shades.highlightHex);
      sGrad.addColorStop(1, shades.baseHex);
      ctx.fillStyle = sGrad;
    }
    ctx.fill();

    ctx.strokeStyle = shades.outlineHex;
    ctx.lineWidth = 0.95;
    ctx.stroke();

    for (let k = 0; k < 6; k++) {
      const t = ((k / 6) + timeSec * 2.8) % 1;
      const u = 1 - t;
      const px = u * u * u * spoutX + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * endX;
      const py = u * u * u * spoutY + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * endY;
      ctx.fillStyle = k % 2 === 0 ? shades.highlightHex : shades.pebbleDarkHex;
      ctx.beginPath();
      ctx.arc(px, py, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 底部四枚纯图标治愈道具钮（零底文字，右上角微圆章展示可用次数，L2~L4 渐进解锁）
   */
  private renderPropBar(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    engine: SandEngine,
    _rewardMgr: RewardManager,
    jamPulse: boolean,
    tokens: UiTokensFile,
    timeSec: number,
    maxClearedLevel: number
  ): void {
    const pulsePhase = timeSec * 5.6;
    const canUndo = engine.snapshots.canUndo() && !engine.won;
    const magLeft = Math.max(0, 3 - engine.vacuumUsedCount);
    const canMagnet = engine.canUseMagnet();
    const fifthActive = engine.bucketSys.maxActiveSlots >= 5;
    const canExtraSlot = engine.bucketSys.canEnableExtraSlot() && !engine.won;
    const shufLeft = Math.max(0, 3 - engine.shuffleUsedCount);
    const canShuffle = engine.canUseShuffle();

    const specs: {
      glyph: 'undo' | 'magnet' | 'extra_slot' | 'shuffle';
      disabled: boolean;
      pulse: boolean;
      medallion: string;
      medallionVariant: 'wood' | 'amber' | 'sage' | 'muted';
      cardVariant: 'parchment' | 'sky' | 'rose' | 'mint' | 'amber';
    }[] = [
      {
        glyph: 'undo',
        disabled: !canUndo,
        pulse: false,
        medallion: canUndo ? '1' : '0',
        medallionVariant: canUndo ? 'wood' : 'muted',
        cardVariant: 'sky',
      },
      {
        glyph: 'magnet',
        disabled: !canMagnet,
        pulse: jamPulse && canMagnet,
        medallion: String(magLeft),
        medallionVariant: magLeft === 0 ? 'muted' : jamPulse && canMagnet ? 'amber' : 'wood',
        cardVariant: 'rose',
      },
      {
        glyph: 'extra_slot',
        disabled: !canExtraSlot && !fifthActive,
        pulse: jamPulse && canExtraSlot,
        medallion: fifthActive ? '✓' : '+1',
        medallionVariant: fifthActive ? 'sage' : canExtraSlot ? 'wood' : 'muted',
        cardVariant: fifthActive ? 'mint' : 'parchment',
      },
      {
        glyph: 'shuffle',
        disabled: !canShuffle,
        pulse: jamPulse && canShuffle && engine.bucketSys.occupiedSlotCount < engine.bucketSys.maxActiveSlots,
        medallion: String(shufLeft),
        medallionVariant: shufLeft === 0 || !canShuffle ? 'muted' : 'wood',
        cardVariant: 'amber',
      },
    ];

    specs.forEach((sp, idx) => {
      const btnRect = layout.propButtons[idx];
      const unlocked = this.isPropUnlocked(idx, engine.level.levelId, maxClearedLevel);
      const isPressed = this.pressedBtnIdx === idx;

      if (!unlocked) {
        const inner = drawRecessedTileCard(ctx, btnRect, tokens, {
          variant: 'locked',
          radius: 15,
          disabled: true,
        });
        drawHandDrawnGlyph(
          ctx,
          'lock',
          inner.x + inner.w * 0.5,
          inner.y + inner.h * 0.5,
          20,
          tokens
        );
        return;
      }

      const inner = drawRecessedTileCard(ctx, btnRect, tokens, {
        variant: sp.pulse ? 'amber' : sp.cardVariant,
        radius: 15,
        pressed: isPressed,
        disabled: sp.disabled,
        pulse: sp.pulse,
        pulsePhase,
        medallionText: sp.medallion,
        medallionVariant: sp.medallionVariant,
        medallionRadius: 9.6,
      });

      ctx.save();
      if (sp.disabled) {
        ctx.globalAlpha = 0.58;
      }
      const iconSize = Math.min(28, inner.h * 0.68);
      drawHandDrawnGlyph(
        ctx,
        sp.glyph,
        inner.x + inner.w * 0.5,
        inner.y + inner.h * 0.5,
        iconSize,
        tokens
      );
      ctx.restore();
    });
  }

  private renderDeadlockRescueModal(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    engine: SandEngine,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    const canSlot = engine.bucketSys.canEnableExtraSlot();
    const canMag = engine.canUseMagnet();
    const canUndo = engine.snapshots.canUndo();

    const actionCount = (canSlot ? 1 : 0) + (canMag ? 1 : 0) + (canUndo ? 1 : 0) + 1;
    const pw = Math.min(324, layout.screenW - 30);
    const ph = 114 + actionCount * 48;
    const panel: Rect = {
      x: (layout.screenW - pw) * 0.5,
      y: Math.max(layout.topHudY + 44, (layout.screenH - ph) * 0.5 - 10),
      w: pw,
      h: ph,
    };

    drawParchmentModalFrame(ctx, layout.screenW, layout.screenH, panel, '接沙台已满', tokens, assets);

    drawInkText(ctx, '玻璃瓶与当前底沙暂不匹配，可选道具破局：', panel.x + pw * 0.5, panel.y + 52, tokens, {
      font: `600 12px ${tokens.typography.fontFamily}`,
      color: '#5C4F48',
    });

    this.deadlockSlotBtnRect = null;
    this.deadlockMagnetBtnRect = null;
    this.deadlockUndoBtnRect = null;

    const btnW = pw - 44;
    const btnX = panel.x + 22;
    let curY = panel.y + 82;

    if (canSlot) {
      this.deadlockSlotBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
      drawWoodButton(ctx, this.deadlockSlotBtnRect, '加开第 5 玻璃瓶位', tokens, assets, {
        fillHex: '#15803D',
        glyph: 'extra_slot',
        fontSize: 13,
      });
      curY += 46;
    }

    if (canMag) {
      this.deadlockMagnetBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
      drawWoodButton(ctx, this.deadlockMagnetBtnRect, '磁吸灌满 1 只瓶腾位', tokens, assets, {
        fillHex: '#C2410C',
        glyph: 'magnet',
        fontSize: 13,
      });
      curY += 46;
    }

    if (canUndo) {
      this.deadlockUndoBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
      drawWoodButton(ctx, this.deadlockUndoBtnRect, '撤回上一步', tokens, assets, {
        fillHex: '#0369A1',
        glyph: 'undo',
        fontSize: 13,
      });
      curY += 46;
    }

    this.deadlockRestartBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
    drawWoodButton(ctx, this.deadlockRestartBtnRect, '重新挑战本关', tokens, assets, {
      glyph: 'restart',
      fontSize: 13,
    });
  }

  private renderRestartConfirmModal(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    const pw = Math.min(312, layout.screenW - 34);
    const ph = 176;
    const panel: Rect = {
      x: (layout.screenW - pw) * 0.5,
      y: (layout.screenH - ph) * 0.5,
      w: pw,
      h: ph,
    };
    drawParchmentModalFrame(ctx, layout.screenW, layout.screenH, panel, '重新挑战？', tokens, assets);

    drawInkText(ctx, '重玩将重置当前流沙与临时瓶位进度', panel.x + pw * 0.5, panel.y + 66, tokens, {
      font: `600 12.5px ${tokens.typography.fontFamily}`,
      color: '#5C4F48',
    });

    const bw = 118;
    this.confirmCancelRect = { x: panel.x + 22, y: panel.y + ph - 56, w: bw, h: 40 };
    this.confirmOkRect = { x: panel.x + pw - 22 - bw, y: panel.y + ph - 56, w: bw, h: 40 };

    drawWoodButton(ctx, this.confirmCancelRect, '继续', tokens, assets, { fillHex: '#15803D', fontSize: 13 });
    drawWoodButton(ctx, this.confirmOkRect, '重玩', tokens, assets, { glyph: 'restart', fontSize: 13 });
  }
}
