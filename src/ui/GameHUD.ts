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
  drawRecessedTileCard,
  drawStatusPill,
  drawStorybookNumber,
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
  w: number;
  h: number;
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
 * 1:1 严格还原《局内主界面.webp》设计稿：
 * 1. 背景：深邃星夜玻璃花房天窗
 * 2. 顶栏：左侧羊皮纸胶囊 [⊞ 08] | 右侧两枚浅橡木圆木牌 [?] [↻]
 * 3. 流沙入瓶效果：柔光流萤 S 曲线彩沙粒子束穿过星夜净空注入敞口玻璃瓶口，并在瓶颈内拉出落沙细柱
 * 4. 温暖实木工作台第 1 层：4+1 立体圆盘底座（同色陶瓷杯托 + 高透雕塑造型的系丝带敞口许愿瓶；空位为象牙白圆碟；第5位为灰石+1挂锁圆盘）
 * 5. 温暖实木工作台第 2 层：4 条近大远小深木凹槽托盘（最下端近景为当前可点击的已揭晓软木塞丝带瓶，后排向凹槽远端递进，永不遮挡瓶颈与 ? 号）
 * 6. 桌下深棕暗影底栏：4 枚暖奶油立体圆角方卡道具钮（右上角贴同质地圆角小方章展示次数）
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
  private lastKnownSlotPos = new Map<number, { x: number; y: number; w: number; h: number }>();
  private completedGhosts: CompletedBottleGhost[] = [];

  /** 平滑插值显示槽内彩沙液面高度（0..1），杜绝跳变生硬感 */
  private smoothSlotFill: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  private smoothSlotBottleIdx: [number, number, number, number, number] = [-1, -1, -1, -1, -1];

  /** 候选列派走前排瓶时的向下顺移过渡动画（0..1） */
  private prevColLengths: number[] = [0, 0, 0, 0];
  private colSlideAnim: number[] = [0, 0, 0, 0];

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
    for (let c = 0; c < 4; c++) {
      if (this.colSlideAnim[c] > 0) {
        this.colSlideAnim[c] = Math.max(0, this.colSlideAnim[c] - dtMs / 180);
      }
    }
  }

  public isPropUnlocked(propIdx: number, currentLevel: number, maxClearedLevel: number): boolean {
    const req = PROP_UNLOCK_LEVELS[propIdx] ?? 2;
    return Math.max(currentLevel, maxClearedLevel + 1) >= req;
  }

  /**
   * 计算指定接沙槽（0..4）内敞口玻璃瓶口中心屏幕坐标（供流沙光带与粒子精准入瓶）
   */
  public getActiveBucketMouthPos(
    layout: ComputedLayout,
    slotIdx: number,
    _dualMode = false
  ): { x: number; y: number } {
    const clamped = Math.max(0, Math.min(4, slotIdx));
    const sr = layout.activeSlotRects[clamped];
    const coasterBaseY = sr.y + sr.h - 7.5;
    const bh = Math.min(58, sr.h * 0.91);
    return {
      x: sr.x + sr.w * 0.5,
      y: coasterBaseY - bh + 2.5,
    };
  }

  public handleTap(
    px: number,
    py: number,
    layout: ComputedLayout,
    engine: SandEngine,
    maxClearedLevel = 20
  ): HudAction | 'CONSUMED' | null {
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

    if (hitRect(px, py, layout.candidateAreaRect) && !engine.won) {
      const numCols = engine.bucketSys.numCols;
      for (let c = 0; c < numCols; c++) {
        const colRect = computeCandidateColRect(layout, c, numCols);
        if (hitRect(px, py, colRect)) {
          return { type: 'DISPATCH_COL', colIdx: c };
        }
      }
    }

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
      ctx.fillStyle = tokens.theme.starryNightBg;
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
    // 1. 顶栏：左侧羊皮纸胶囊 [⊞ 08] + 右侧两枚浅橡木圆木牌 [?] [↻]
    // ========================================================================
    const sp = layout.settingsPill;
    drawDoubleRimPlaque(ctx, sp, tokens, {
      variant: 'parchment',
      radius: sp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'grid', sp.x + 23, sp.y + sp.h * 0.5, 16.5, tokens);
    drawStorybookNumber(
      ctx,
      String(engine.level.levelId).padStart(2, '0'),
      sp.x + 23 + (sp.w - 23) * 0.52,
      sp.y + sp.h * 0.5 + 0.5,
      23.5,
      tokens,
      { slant: -0.04, boldStroke: 0.7 }
    );

    const gp = layout.guidePill;
    drawDoubleRimPlaque(ctx, gp, tokens, {
      variant: 'walnut',
      radius: gp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'question', gp.x + gp.w * 0.5, gp.y + gp.h * 0.5, 18.5, tokens);

    const rp = layout.restartPill;
    drawDoubleRimPlaque(ctx, rp, tokens, {
      variant: 'walnut',
      radius: rp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'restart', rp.x + rp.w * 0.5, rp.y + rp.h * 0.5, 17.5, tokens);

    // ========================================================================
    // 2. 温暖实木工作台 + 4+1 圆盘接沙位 + 4 条近大远小木凹槽候选瓶列 + 发光流沙入瓶
    // ========================================================================
    this.renderDualTierWorkbench(ctx, layout, engine, sandRenderer, tokens, timeSec, false, maxClearedLevel);

    // ========================================================================
    // 3. Stage 1 软性停滞轻提示条
    // ========================================================================
    const clogActive = engine.bucketSys.clogWarningActive;
    const hardDeadlock = engine.bucketSys.hardDeadlockActive;
    if (clogActive && !hardDeadlock && !engine.won) {
      const cw = Math.min(284, layout.chamberRect.w - 16);
      const cx = (layout.screenW - cw) * 0.5;
      const cy = layout.chamberRect.y + layout.chamberRect.h - 38;
      drawDoubleRimPlaque(ctx, { x: cx, y: cy, w: cw, h: 28 }, tokens, {
        variant: 'amber',
        radius: 14,
      });
      drawInkText(
        ctx,
        '瓶口未匹配底沙 · 可抽拨片或用下方道具',
        cx + cw * 0.5,
        cy + 14.5,
        tokens,
        {
          font: `700 11.5px ${tokens.typography.fontFamily}`,
          color: '#3B2416',
          maxWidth: cw - 20,
        }
      );
    }

    // ========================================================================
    // 4. 桌下深棕暗影区与四枚暖奶油立体方卡道具钮
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

  private syncWorkbenchAnimations(layout: ComputedLayout, engine: SandEngine): void {
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
      this.smoothSlotFill = [0, 0, 0, 0, 0];
      this.smoothSlotBottleIdx = [-1, -1, -1, -1, -1];
      for (let c = 0; c < 4; c++) {
        this.prevColLengths[c] = engine.bucketSys.columns[c]?.length || 0;
        this.colSlideAnim[c] = 0;
      }
    }

    for (let c = 0; c < engine.bucketSys.numCols; c++) {
      const curLen = engine.bucketSys.columns[c]?.length || 0;
      if (curLen < this.prevColLengths[c]) {
        this.colSlideAnim[c] = 1.0;
      }
      this.prevColLengths[c] = curLen;
    }

    for (let s = 0; s < 5; s++) {
      const bk = engine.bucketSys.activeSlots[s];
      const sr = layout.activeSlotRects[s];
      const bw = Math.min(sr.w * 0.76, 44);
      const bh = Math.min(58, sr.h * 0.91);
      const baseY = sr.y + sr.h - 7.5;

      if (bk && !bk.done) {
        const targetRatio = Math.min(1, bk.cur / Math.max(1, bk.max));
        if (this.smoothSlotBottleIdx[s] !== bk.idx) {
          this.smoothSlotBottleIdx[s] = bk.idx;
          this.smoothSlotFill[s] = targetRatio;
        } else {
          this.smoothSlotFill[s] += (targetRatio - this.smoothSlotFill[s]) * 0.28;
        }
        this.lastKnownSlotPos.set(bk.idx, {
          x: sr.x + sr.w * 0.5,
          y: baseY,
          w: bw,
          h: bh,
        });
      } else {
        this.smoothSlotBottleIdx[s] = -1;
        this.smoothSlotFill[s] = 0;
      }
    }

    for (const bk of engine.bucketSys.buckets) {
      if (bk.done && !this.seenDoneSet.has(bk.idx)) {
        this.seenDoneSet.add(bk.idx);
        const pos = this.lastKnownSlotPos.get(bk.idx) || {
          x: layout.screenW * 0.5,
          y: layout.slotRowRect.y + layout.slotRowRect.h - 7,
          w: 38,
          h: 50,
        };
        this.completedGhosts.push({
          idx: bk.idx,
          color: bk.color,
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          timerMs: 360,
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
    // 实木桌面后沿恰好穿过接沙瓶下半腰部，让晶莹瓶颈与蝴蝶结立于星夜背景之中！
    const tableBackY = Math.round(layout.slotRowRect.y + layout.slotRowRect.h * 0.46);
    const tableFrontY = layout.propRowRect.y - 7;

    this.syncWorkbenchAnimations(layout, engine);

    // ========================================================================
    // 1. 绘制蜂蜜浅橡木实木工作台桌面 + 前沿厚木桌边 + 桌下深棕暗影栏
    // ========================================================================
    ctx.save();

    // 桌面主体
    const woodGrad = ctx.createLinearGradient(0, tableBackY, 0, tableFrontY);
    woodGrad.addColorStop(0, '#D8AE7B');
    woodGrad.addColorStop(0.55, '#C99B65');
    woodGrad.addColorStop(1, '#BA8A53');
    ctx.fillStyle = woodGrad;
    ctx.fillRect(0, tableBackY, W, Math.max(10, tableFrontY - tableBackY));

    // 桌面后沿深棕钢笔地平线与高光细线
    ctx.strokeStyle = '#3B2416';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(0, tableBackY);
    ctx.lineTo(W, tableBackY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 244, 222, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, tableBackY + 2);
    ctx.lineTo(W, tableBackY + 2);
    ctx.stroke();

    // 手绘水平自然木纹细线
    ctx.strokeStyle = 'rgba(96, 56, 24, 0.16)';
    ctx.lineWidth = 1.0;
    for (let k = 1; k <= 4; k++) {
      const gy = tableBackY + ((tableFrontY - tableBackY) * k) / 4.6;
      ctx.beginPath();
      ctx.moveTo(12, gy);
      ctx.bezierCurveTo(W * 0.32, gy - 2, W * 0.68, gy + 2.5, W - 12, gy - 0.5);
      ctx.stroke();
    }

    // 桌面最前缘立体厚木边（7px）
    const lipGrad = ctx.createLinearGradient(0, tableFrontY, 0, layout.propRowRect.y);
    lipGrad.addColorStop(0, '#9B6B3E');
    lipGrad.addColorStop(1, '#6E4725');
    ctx.fillStyle = lipGrad;
    ctx.fillRect(0, tableFrontY, W, 7);

    ctx.strokeStyle = '#2B190D';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, tableFrontY);
    ctx.lineTo(W, tableFrontY);
    ctx.moveTo(0, layout.propRowRect.y);
    ctx.lineTo(W, layout.propRowRect.y);
    ctx.stroke();

    // 桌下深胡桃暗影底栏（衬托 4 枚暖奶油立体道具方卡）
    const underGrad = ctx.createLinearGradient(0, layout.propRowRect.y, 0, H);
    underGrad.addColorStop(0, '#3D2718');
    underGrad.addColorStop(1, '#2D1C10');
    ctx.fillStyle = underGrad;
    ctx.fillRect(0, layout.propRowRect.y, W, Math.max(0, H - layout.propRowRect.y));
    ctx.restore();

    // ========================================================================
    // 2. 流沙入瓶发光粒子光带（先绘制外段星夜柔光束，再与敞口玻璃瓶融合！）
    // ========================================================================
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

    // ========================================================================
    // 3. 上层 4+1 圆形杯托与高精敞口丝带玻璃瓶（1:1 还原《局内主界面.webp》）
    // ========================================================================
    const maxSlots = engine.bucketSys.maxActiveSlots;
    const slotPropUnlocked = this.isPropUnlocked(2, engine.level.levelId, maxClearedLevel);

    for (let s = 0; s < 5; s++) {
      const sr = layout.activeSlotRects[s];
      const locked5th = s >= maxSlots;
      if (locked5th && !slotPropUnlocked) continue;

      const bk = engine.bucketSys.activeSlots[s];
      const isReceiving = Boolean(bk && !bk.done && engine.slotPourMs[s] > 0);
      const cx = sr.x + sr.w * 0.5;
      const coasterY = sr.y + sr.h - 7.5;
      const coasterRx = Math.min(27, sr.w * 0.45);
      const coasterRy = 6.8;

      if (locked5th) {
        // 第 5 位未解锁：灰石色立体圆盘底座（印 +1）+ 立式小挂锁（1:1 还原设计图右侧！）
        this.drawRoundCoasterDisc(ctx, cx, coasterY, coasterRx, coasterRy, '#ACA397', '#867D72');
        drawStorybookNumber(ctx, '+1', cx, coasterY - 0.5, 11.5, tokens, {
          color: '#2B1B10',
          slant: 0,
          embossColor: 'rgba(255,255,255,0.35)',
        });
        // 立在圆盘上的精致小挂锁
        this.drawStandingSlotPadlock(ctx, cx, coasterY - 13);
      } else if (bk && !bk.done) {
        const shades = sandRenderer.getSandShades(bk.color);
        // 同色马卡龙圆盘杯托
        const discTop = mixHex(shades.highlightHex, '#FFFFFF', 0.25);
        const discSide = mixHex(shades.baseHex, '#8C7A68', 0.22);
        this.drawRoundCoasterDisc(ctx, cx, coasterY, coasterRx, coasterRy, discTop, discSide, isReceiving);

        const bw = Math.min(sr.w * 0.76, 44);
        const bh = Math.min(58, sr.h * 0.91);
        const smoothRatio = Math.max(0.02, this.smoothSlotFill[s]);
        this.drawApothecaryGlassBottle(ctx, cx, coasterY - 1.5, bw, bh, shades, tokens, timeSec, {
          hasCork: false,
          fillRatio: smoothRatio,
          isPouringInto: isReceiving,
          isMystery: false,
          highlightActive: true,
        });
      } else {
        // 空置接沙位：象牙白陶瓷小圆碟（1:1 还原设计图第 4 位空碟！）
        this.drawCeramicEmptySaucer(ctx, cx, coasterY, coasterRx, coasterRy);
      }
    }

    // ========================================================================
    // 4. 下层 3~4 条深胡桃木凹槽托盘 + 近大远小（下近上远）软木塞候选玻璃瓶队列
    // ========================================================================
    const numCols = engine.bucketSys.numCols;
    const slotsHaveSpace = engine.bucketSys.occupiedSlotCount < maxSlots;
    const shuffleJitter =
      engine.shuffleAnimMs > 0 ? Math.sin(engine.shuffleAnimMs * 0.08) * 3.0 : 0;

    for (let c = 0; c < numCols; c++) {
      const colRect = computeCandidateColRect(layout, c, numCols);
      const col = engine.bucketSys.columns[c] || [];

      // 绘制近宽远窄微透视的深胡桃木凹槽托盘
      this.drawWoodenRecessedTrough(ctx, colRect);

      if (col.length === 0) continue;

      const visibleCount = Math.min(4, col.length);
      const frontH = Math.min(58, colRect.h * 0.44);
      const frontW = Math.min(44, colRect.w * 0.60);
      const frontBaseY = colRect.y + colRect.h - 6.5;
      const availDepth = Math.max(20, colRect.h - frontH - 11);
      const stepUpY =
        visibleCount > 1 ? Math.min(28, availDepth / Math.max(1, visibleCount - 1)) : 0;

      // 当列超过 4 瓶时，在凹槽最远端微露第 5 只软木塞瓶头！
      if (col.length > 4) {
        const fifth = col[4];
        const topPeekY = frontBaseY - 3 * stepUpY - 13;
        this.drawPeekingCorkTop(ctx, colRect.x + colRect.w * 0.5, Math.max(colRect.y + 14, topPeekY), frontW * 0.68, fifth);
      }

      // 从远端（r = visibleCount - 1，上方）向近端（r = 0，下方最前排）依次绘制！
      // 近景瓶自然遮挡后排瓶的下半瓶肚，100% 完整露出每一只后排瓶的软木塞、瓶颈与「?」号！
      const slideT = this.colSlideAnim[c];
      const slidePx = slideT * slideT * stepUpY;

      for (let r = visibleCount - 1; r >= 0; r--) {
        const bk = col[r];
        const isFront = r === 0;
        const scale = isFront ? 1.0 : r === 1 ? 0.91 : r === 2 ? 0.83 : 0.76;
        const bw = frontW * scale;
        const bh = frontH * scale;
        const iceShake = bk.iceShakeMs > 0 ? Math.sin(bk.iceShakeMs * 0.12) * 3.0 : 0;
        const cx =
          colRect.x + colRect.w * 0.5 + iceShake + (r % 2 === 0 ? shuffleJitter : -shuffleJitter);
        const baseY = frontBaseY - r * stepUpY - slidePx;

        ctx.save();
        if (isFront && bk.iceLayers === 0 && slotsHaveSpace) {
          // 最前排可点选瓶底柔和暖金光晕
          ctx.fillStyle = 'rgba(255, 232, 146, 0.28)';
          ctx.beginPath();
          ctx.ellipse(cx, baseY - 3, bw * 0.62, 6.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        this.drawCandidateBottle(ctx, bk, cx, baseY, bw, bh, isFront, sandRenderer, tokens, timeSec);
        ctx.restore();
      }

      if (col.length > 4) {
        drawStatusPill(
          ctx,
          colRect.x + colRect.w - 13,
          colRect.y + 11,
          `+${col.length - 4}`,
          tokens,
          {
            bgHex: '#FAF0DC',
            borderHex: '#3B2416',
            textColor: '#3B2416',
            fontSize: 9.5,
            padX: 6,
            height: 15,
          }
        );
      }
    }

    // ========================================================================
    // 5. 满瓶瞬间软木塞封口欢跃离场演出（替代生硬纯文字胶囊！）
    // ========================================================================
    for (const gh of this.completedGhosts) {
      const p = 1 - gh.timerMs / 360;
      const hopY = -28 * Math.sin(p * Math.PI * 0.88);
      const squashX = p < 0.25 ? 1 + 0.14 * Math.sin((p / 0.25) * Math.PI) : 1 - 0.08 * p;
      const squashY = p < 0.25 ? 1 - 0.12 * Math.sin((p / 0.25) * Math.PI) : 1 + 0.08 * p;
      const alpha = p < 0.65 ? 1 : Math.max(0, (1 - p) / 0.35);
      const shades = sandRenderer.getSandShades(gh.color);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(gh.x, gh.y + hopY);
      ctx.scale(squashX, squashY);
      this.drawApothecaryGlassBottle(ctx, 0, 0, gh.w, gh.h, shades, tokens, timeSec, {
        hasCork: true,
        fillRatio: 1.0,
        isPouringInto: false,
        isMystery: false,
        highlightActive: true,
      });
      ctx.restore();
    }
  }

  private drawRoundCoasterDisc(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    topHex: string,
    sideHex: string,
    glow = false
  ): void {
    const ink = '#3B2416';
    const thick = 4.2;
    ctx.save();

    if (glow) {
      ctx.fillStyle = 'rgba(255, 224, 128, 0.38)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 1, rx + 4, ry + 3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(38, 22, 10, 0.26)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + thick + 1.5, rx + 1, ry + 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 圆盘侧壁厚度
    ctx.fillStyle = sideHex;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.45;
    ctx.beginPath();
    ctx.ellipse(cx, cy + thick, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(cx - rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 圆盘顶面
    ctx.fillStyle = topHex;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawCeramicEmptySaucer(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    rx: number,
    ry: number
  ): void {
    this.drawRoundCoasterDisc(ctx, cx, cy, rx, ry, '#F6EFE2', '#D4C7B2');
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 98, 76, 0.35)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 0.3, rx * 0.72, ry * 0.66, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawStandingSlotPadlock(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const ink = '#3B2416';
    ctx.save();
    ctx.translate(cx, cy);

    // 锁梁半圆环
    ctx.strokeStyle = ink;
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.arc(0, -6.5, 5.2, Math.PI, 0, false);
    ctx.stroke();
    ctx.strokeStyle = '#CFC5B6';
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // 锁身圆角方牌
    const g = ctx.createLinearGradient(-8, -6, 8, 7);
    g.addColorStop(0, '#DFCEB4');
    g.addColorStop(1, '#B89F7E');
    ctx.fillStyle = g;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundRectPath(ctx, -8.2, -6.2, 16.4, 13.5, 3.0);
    ctx.fill();
    ctx.stroke();

    // 钥匙孔
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(0, -0.8, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-0.9, -0.4, 1.8, 3.8);
    ctx.restore();
  }

  private drawWoodenRecessedTrough(ctx: CanvasRenderingContext2D, r: Rect): void {
    const ink = '#3B2416';
    const topTap = 4.5; // 上窄下宽真实俯视透视
    const wallSide = 5.5;
    const wallBack = 8.5;

    const tlX = r.x + topTap;
    const trX = r.x + r.w - topTap;
    const blX = r.x;
    const brX = r.x + r.w;

    const inTlX = tlX + wallSide;
    const inTrX = trX - wallSide;
    const inTopY = r.y + wallBack;
    const inBlX = blX + wallSide;
    const inBrX = brX - wallSide;
    const inBotY = r.y + r.h - 3.0;

    const traceOuter = () => {
      ctx.beginPath();
      ctx.moveTo(tlX + 5, r.y);
      ctx.lineTo(trX - 5, r.y);
      ctx.quadraticCurveTo(trX, r.y, trX + 0.4, r.y + 5);
      ctx.lineTo(brX, r.y + r.h - 5);
      ctx.quadraticCurveTo(brX, r.y + r.h, brX - 6, r.y + r.h);
      ctx.lineTo(blX + 6, r.y + r.h);
      ctx.quadraticCurveTo(blX, r.y + r.h, blX, r.y + r.h - 5);
      ctx.lineTo(tlX - 0.4, r.y + 5);
      ctx.quadraticCurveTo(tlX, r.y, tlX + 5, r.y);
      ctx.closePath();
    };

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1. 凹槽内侧壁基础底色
    ctx.fillStyle = '#6C4423';
    traceOuter();
    ctx.fill();

    ctx.save();
    traceOuter();
    ctx.clip();

    // 2. 顶部背光深胡桃内后壁梯形面
    ctx.fillStyle = '#55341A';
    ctx.beginPath();
    ctx.moveTo(tlX, r.y);
    ctx.lineTo(trX, r.y);
    ctx.lineTo(inTrX, inTopY);
    ctx.lineTo(inTlX, inTopY);
    ctx.closePath();
    ctx.fill();

    // 3. 左侧与右侧立体斜切内壁面
    ctx.fillStyle = '#684121';
    ctx.beginPath();
    ctx.moveTo(tlX, r.y);
    ctx.lineTo(inTlX, inTopY);
    ctx.lineTo(inBlX, inBotY);
    ctx.lineTo(blX, r.y + r.h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#734926';
    ctx.beginPath();
    ctx.moveTo(trX, r.y);
    ctx.lineTo(brX, r.y + r.h);
    ctx.lineTo(inBrX, inBotY);
    ctx.lineTo(inTrX, inTopY);
    ctx.closePath();
    ctx.fill();

    // 4. 凹槽下沉平坦槽底（带温润木纹渐变）
    const floorGrad = ctx.createLinearGradient(0, inTopY, 0, inBotY);
    floorGrad.addColorStop(0, '#7E522B');
    floorGrad.addColorStop(0.35, '#8F5E34');
    floorGrad.addColorStop(1, '#9A683B');
    ctx.fillStyle = floorGrad;
    ctx.beginPath();
    ctx.moveTo(inTlX, inTopY);
    ctx.lineTo(inTrX, inTopY);
    ctx.lineTo(inBrX, inBotY);
    ctx.lineTo(inBlX, inBotY);
    ctx.closePath();
    ctx.fill();

    // 5. 槽底转角折线与斜接棱线（塑造真实 3D 挖槽木工结构！）
    ctx.strokeStyle = 'rgba(42, 22, 8, 0.72)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(inBlX, inBotY);
    ctx.lineTo(inTlX, inTopY);
    ctx.lineTo(inTrX, inTopY);
    ctx.lineTo(inBrX, inBotY);
    ctx.moveTo(tlX + 1.5, r.y + 1.5);
    ctx.lineTo(inTlX, inTopY);
    ctx.moveTo(trX - 1.5, r.y + 1.5);
    ctx.lineTo(inTrX, inTopY);
    ctx.stroke();

    ctx.restore();

    // 6. 外框深棕手绘钢笔描边 + 前沿桌面受光亮线
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.75;
    traceOuter();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 243, 218, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(blX + 6, r.y + r.h + 1.3);
    ctx.lineTo(brX - 6, r.y + r.h + 1.3);
    ctx.stroke();

    ctx.restore();
  }

  private drawPeekingCorkTop(
    ctx: CanvasRenderingContext2D,
    cx: number,
    topY: number,
    w: number,
    _bk: BucketRuntime
  ): void {
    const corkW = w * 0.34;
    ctx.save();
    ctx.fillStyle = '#B88452';
    ctx.strokeStyle = '#3B2416';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    roundRectPath(ctx, cx - corkW * 0.5, topY - 4, corkW, 6.5, 1.8);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

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
      // 未揭晓的后排「雾面羊皮纸软木塞问号瓶」（1:1 还原《局内主界面.webp》后排 ? 瓶！）
      const mysteryShades: SandColorShades = {
        baseHex: '#E5DAC2',
        highlightHex: '#F7EFE0',
        shadowHex: '#C7B89B',
        outlineHex: '#3B2416',
        pebbleDarkHex: '#9E8E74',
      };
      this.drawApothecaryGlassBottle(ctx, cx, baseY, w, h, mysteryShades, tokens, timeSec, {
        hasCork: true,
        fillRatio: 0,
        isPouringInto: false,
        isMystery: true,
        highlightActive: false,
      });
    } else {
      const shades = sandRenderer.getSandShades(bk.color);
      this.drawApothecaryGlassBottle(ctx, cx, baseY, w, h, shades, tokens, timeSec, {
        hasCork: true,
        fillRatio: 0.64,
        isPouringInto: false,
        isMystery: false,
        highlightActive: isFront && bk.iceLayers === 0,
      });
    }

    // 冰晶冻结玻璃瓶：几何折面淡蓝冰晶护壳 + 清晰雪花层数角标
    if (bk.iceLayers > 0) {
      const topY = baseY - h;
      ctx.save();
      const iceGrad = ctx.createLinearGradient(cx - w * 0.46, topY + h * 0.14, cx + w * 0.46, baseY);
      iceGrad.addColorStop(0, 'rgba(232, 250, 255, 0.80)');
      iceGrad.addColorStop(0.5, 'rgba(154, 214, 246, 0.62)');
      iceGrad.addColorStop(1, 'rgba(104, 180, 228, 0.72)');
      ctx.fillStyle = iceGrad;
      ctx.strokeStyle = '#2D5E82';
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      ctx.moveTo(cx, topY + h * 0.12);
      ctx.lineTo(cx + w * 0.46, topY + h * 0.30);
      ctx.lineTo(cx + w * 0.44, baseY - 3);
      ctx.lineTo(cx, baseY + 1);
      ctx.lineTo(cx - w * 0.44, baseY - 3);
      ctx.lineTo(cx - w * 0.46, topY + h * 0.30);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 冰晶棱线
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
      ctx.lineWidth = 1.05;
      ctx.beginPath();
      ctx.moveTo(cx, topY + h * 0.12);
      ctx.lineTo(cx - w * 0.12, baseY);
      ctx.moveTo(cx - w * 0.44, topY + h * 0.32);
      ctx.lineTo(cx + w * 0.44, topY + h * 0.42);
      ctx.stroke();

      const pillW = isFront ? 30 : 26;
      const pillH = isFront ? 14 : 12.5;
      const py = topY + h * 0.48;
      ctx.fillStyle = 'rgba(246, 252, 255, 0.94)';
      ctx.strokeStyle = '#2D5E82';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      roundRectPath(ctx, cx - pillW * 0.5, py - pillH * 0.5, pillW, pillH, pillH * 0.5);
      ctx.fill();
      ctx.stroke();

      drawHandDrawnGlyph(ctx, 'snowflake', cx - pillW * 0.22, py, isFront ? 9.5 : 8, tokens);
      drawInkText(ctx, `×${bk.iceLayers}`, cx + pillW * 0.17, py + 0.5, tokens, {
        font: `700 ${isFront ? 9.5 : 8}px ${tokens.typography.numeralFontFamily}`,
        color: '#1E4868',
        embossColor: '',
      });
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * 1:1 雕塑级还原《局内主界面.webp》的高透药剂许愿玻璃瓶：
   * - 候选槽态（hasCork=true）：带立体软木塞 + 瓶颈蝴蝶结（或雾面羊皮纸 ? 瓶，? 置于胸口偏上位置确保后排清晰露出！）
   * - 接沙台态（hasCork=false）：立体椭圆敞口玻璃瓶唇 + 瓶颈落沙细柱 + 带颗粒噪点与椭圆液面的彩沙柱 + 双侧玻璃高光弧 + 精致双耳蝴蝶结丝带
   */
  private drawApothecaryGlassBottle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
    w: number,
    h: number,
    shades: SandColorShades,
    tokens: UiTokensFile,
    timeSec: number,
    opts: {
      hasCork: boolean;
      fillRatio: number;
      isPouringInto: boolean;
      isMystery: boolean;
      highlightActive: boolean;
    }
  ): void {
    const ink = '#3B2416';
    const bounce = opts.isPouringInto ? Math.sin(timeSec * 20) * 0.55 : 0;
    const corkReserve = opts.hasCork ? h * 0.12 : 0;
    const mouthY = baseY - h + corkReserve + bounce;

    const lipHalfW = w * 0.27;
    const lipH = Math.max(3.2, h * 0.068);
    const neckHalfW = w * 0.20;
    const neckBotY = mouthY + lipH + h * 0.095;
    const shoulderBotY = neckBotY + h * 0.13;
    const bellyHalfW = w * 0.45;
    const bottomCurveH = Math.max(4.5, w * 0.14);

    const traceBottleBody = (inset = 0) => {
      const nw = Math.max(3, neckHalfW - inset * 0.7);
      const bw = Math.max(5, bellyHalfW - inset);
      const yTop = mouthY + lipH * 0.5 + inset * 0.5;
      const yNeck = neckBotY + inset * 0.2;
      const ySh = shoulderBotY + inset * 0.2;
      const yBot = baseY - inset;

      ctx.beginPath();
      ctx.moveTo(cx - nw, yTop);
      ctx.lineTo(cx - nw, yNeck);
      ctx.bezierCurveTo(cx - nw, yNeck + (ySh - yNeck) * 0.45, cx - bw, ySh - (ySh - yNeck) * 0.42, cx - bw, ySh);
      ctx.lineTo(cx - bw, yBot - bottomCurveH);
      ctx.quadraticCurveTo(cx - bw, yBot, cx, yBot);
      ctx.quadraticCurveTo(cx + bw, yBot, cx + bw, yBot - bottomCurveH);
      ctx.lineTo(cx + bw, ySh);
      ctx.bezierCurveTo(cx + bw, ySh - (ySh - yNeck) * 0.42, cx + nw, yNeck + (ySh - yNeck) * 0.45, cx + nw, yNeck);
      ctx.lineTo(cx + nw, yTop);
      ctx.closePath();
    };

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1. 瓶底柔和贴台阴影
    ctx.fillStyle = 'rgba(28, 16, 8, 0.22)';
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 1.2, bellyHalfW * 0.86, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. 玻璃瓶体底衬（雾面羊皮纸 ? 瓶 vs 清透微着色水晶玻璃）
    const bodyGrad = ctx.createLinearGradient(cx - bellyHalfW, mouthY, cx + bellyHalfW, baseY);
    if (opts.isMystery) {
      bodyGrad.addColorStop(0, '#F6EFE0');
      bodyGrad.addColorStop(0.55, '#E7DAC0');
      bodyGrad.addColorStop(1, '#D2C1A3');
    } else {
      bodyGrad.addColorStop(0, mixHex(shades.highlightHex, '#E8F6FF', 0.55));
      bodyGrad.addColorStop(0.5, mixHex(shades.baseHex, '#D2ECFA', 0.62));
      bodyGrad.addColorStop(1, mixHex(shades.shadowHex, '#B8DCFA', 0.55));
    }

    ctx.save();
    if (!opts.isMystery) {
      ctx.globalAlpha = opts.hasCork ? 0.88 : 0.72;
    }
    ctx.fillStyle = bodyGrad;
    traceBottleBody(0);
    ctx.fill();
    ctx.restore();

    // 3. 瓶腹内部颗粒彩沙柱 + 立体椭圆沙面 + 接沙时瓶颈垂直细沙流
    if (!opts.isMystery && opts.fillRatio > 0.01) {
      ctx.save();
      traceBottleBody(1.6);
      ctx.clip();

      const usableH = baseY - 2.5 - (shoulderBotY - 2);
      const clampedFill = Math.min(1, Math.max(0, opts.fillRatio));
      const sandTopY = baseY - 2.2 - usableH * clampedFill;
      const ripple = opts.isPouringInto ? Math.sin(timeSec * 18) * 1.1 : 0;

      // 接沙瞬间透过透明瓶颈看到的垂直入瓶细沙丝！
      if (opts.isPouringInto) {
        const innerStreamGrad = ctx.createLinearGradient(cx, mouthY, cx, sandTopY);
        innerStreamGrad.addColorStop(0, '#FFFDF4');
        innerStreamGrad.addColorStop(0.45, shades.highlightHex);
        innerStreamGrad.addColorStop(1, shades.baseHex);
        ctx.strokeStyle = innerStreamGrad;
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.moveTo(cx, mouthY + 2);
        ctx.lineTo(cx + ripple * 0.4, sandTopY + 1);
        ctx.stroke();
      }

      // 瓶内彩沙柱主体
      const sGrad = ctx.createLinearGradient(cx - bellyHalfW, sandTopY, cx + bellyHalfW, baseY);
      sGrad.addColorStop(0, shades.highlightHex);
      sGrad.addColorStop(0.45, shades.baseHex);
      sGrad.addColorStop(1, shades.shadowHex);
      ctx.fillStyle = sGrad;
      ctx.fillRect(cx - bellyHalfW - 2, sandTopY, bellyHalfW * 2 + 4, baseY - sandTopY + 4);

      // 瓶内沙体细微颗粒质感点
      ctx.fillStyle = 'rgba(255, 253, 244, 0.42)';
      for (let gIdx = 0; gIdx < 9; gIdx++) {
        const gx = cx + (((gIdx * 37) % 16) - 8) * (bellyHalfW * 0.085);
        const gy = sandTopY + 4 + ((gIdx * 23) % Math.max(4, Math.floor(baseY - sandTopY - 5)));
        if (gy < baseY - 2) {
          ctx.fillRect(gx, gy, 1.3, 1.3);
        }
      }

      // 立体椭圆沙面顶盖（还原《局内主界面.webp》瓶内立体椭圆液面！）
      const meniscusRx = bellyHalfW - 2.2;
      const meniscusRy = Math.max(2.6, bellyHalfW * 0.21);
      ctx.fillStyle = mixHex(shades.highlightHex, '#FFFFFF', 0.22);
      ctx.strokeStyle = mixHex(shades.shadowHex, '#5E4230', 0.25);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(cx, sandTopY + ripple * 0.5, meniscusRx, meniscusRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 入瓶沙花微溅小沙粒
      if (opts.isPouringInto) {
        ctx.fillStyle = '#FFFDF5';
        for (let k = 0; k < 4; k++) {
          const ang = timeSec * 12 + k * 1.57;
          const sx = cx + Math.cos(ang) * (meniscusRx * 0.42);
          const sy = sandTopY - 1.5 - Math.abs(Math.sin(ang * 1.3)) * 3.8;
          ctx.beginPath();
          ctx.arc(sx, sy, 1.05, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    // 4. 瓶体外轮廓手绘墨线 + 左右高透水晶玻璃折射高光弧 + 厚玻璃底折射弧
    ctx.strokeStyle = ink;
    ctx.lineWidth = opts.highlightActive ? 1.55 : 1.4;
    traceBottleBody(0);
    ctx.stroke();

    if (!opts.isMystery) {
      // 左侧长条月牙玻璃高光
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
      ctx.lineWidth = Math.max(1.6, w * 0.055);
      ctx.beginPath();
      ctx.moveTo(cx - bellyHalfW + 3.4, shoulderBotY + 1.5);
      ctx.lineTo(cx - bellyHalfW + 3.4, baseY - bottomCurveH - 2.5);
      ctx.stroke();

      // 右肩清透反光短弧 + 瓶底厚水晶折射亮弧
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + bellyHalfW - 3.4, shoulderBotY + 2);
      ctx.lineTo(cx + bellyHalfW - 3.4, shoulderBotY + (baseY - shoulderBotY) * 0.42);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, baseY - bottomCurveH * 0.9, bellyHalfW * 0.65, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    } else {
      // 雾面问号瓶：将手绘「?」绘制在瓶胸偏上位置，确保在木槽后排时 100% 不被前瓶遮挡！
      const qY = shoulderBotY + (baseY - shoulderBotY) * 0.28;
      drawInkText(ctx, '?', cx, qY, tokens, {
        font: `700 ${Math.max(13, Math.round(h * 0.28))}px ${tokens.typography.numeralFontFamily}`,
        color: '#4A3828',
        boldStrokeWidth: 0.45,
        embossColor: 'rgba(255,255,255,0.55)',
      });
    }

    // 5. 软木塞（候选瓶态） vs 立体椭圆敞口厚玻璃瓶唇（接沙台态）
    if (opts.hasCork) {
      const corkTopW = neckHalfW * 1.58;
      const corkBotW = neckHalfW * 1.28;
      const corkTopY = mouthY - corkReserve + 1.0;
      const corkBotY = mouthY + lipH * 0.55;

      const cGrad = ctx.createLinearGradient(cx - corkTopW * 0.5, corkTopY, cx + corkTopW * 0.5, corkBotY);
      cGrad.addColorStop(0, '#D7A673');
      cGrad.addColorStop(0.55, '#B8834E');
      cGrad.addColorStop(1, '#946234');
      ctx.fillStyle = cGrad;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.moveTo(cx - corkTopW * 0.5, corkTopY + 1.5);
      ctx.quadraticCurveTo(cx, corkTopY - 1.2, cx + corkTopW * 0.5, corkTopY + 1.5);
      ctx.lineTo(cx + corkBotW * 0.5, corkBotY);
      ctx.quadraticCurveTo(cx, corkBotY + 1.4, cx - corkBotW * 0.5, corkBotY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 瓶口玻璃护圈（位于软木塞下方）
      ctx.fillStyle = opts.isMystery ? '#F5EDE0' : 'rgba(236, 248, 255, 0.90)';
      ctx.beginPath();
      roundRectPath(ctx, cx - lipHalfW, mouthY, lipHalfW * 2, lipH, lipH * 0.48);
      ctx.fill();
      ctx.stroke();
    } else {
      // 接沙台敞口玻璃瓶：立体椭圆开口玻璃厚唇，真实呈现“沙流钻入敞口”！
      const mouthCenterY = mouthY + lipH * 0.45;
      ctx.fillStyle = 'rgba(232, 248, 255, 0.88)';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.ellipse(cx, mouthCenterY, lipHalfW, lipH * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 椭圆瓶口内腔深孔
      ctx.fillStyle = opts.isPouringInto ? shades.highlightHex : 'rgba(32, 54, 86, 0.55)';
      ctx.beginPath();
      ctx.ellipse(cx, mouthCenterY, lipHalfW * 0.68, lipH * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. 瓶颈立体双耳丝缎蝴蝶结（仅已揭晓玻璃瓶系彩色丝带，雾面 ? 瓶按设计图不系彩带！）
    if (!opts.isMystery) {
      const ribBase = shades.baseHex;
      const ribHi = mixHex(shades.highlightHex, '#FFFFFF', 0.24);
      const ribDark = mixHex(shades.shadowHex, '#3B2416', 0.16);
      const bowY = neckBotY - h * 0.015;
      const loopW = Math.max(5.8, w * 0.24);
      const loopH = Math.max(3.6, h * 0.082);

      // 环绕瓶颈丝带圈
      ctx.fillStyle = ribBase;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      roundRectPath(ctx, cx - neckHalfW - 0.8, bowY - 1.7, (neckHalfW + 0.8) * 2, 3.4, 1.5);
      ctx.fill();
      ctx.stroke();

      // 垂落在玻璃瓶肩上的优雅双飘带
      ctx.fillStyle = ribBase;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + dir * 1.2, bowY + 0.8);
        ctx.quadraticCurveTo(
          cx + dir * (loopW * 0.68),
          bowY + loopH * 1.45,
          cx + dir * (loopW * 0.88),
          bowY + loopH * 2.55
        );
        ctx.lineTo(cx + dir * (loopW * 0.52), bowY + loopH * 2.25);
        ctx.lineTo(cx + dir * (loopW * 0.32), bowY + loopH * 2.60);
        ctx.quadraticCurveTo(
          cx + dir * (loopW * 0.25),
          bowY + loopH * 1.5,
          cx + dir * 0.4,
          bowY + 1.2
        );
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // 左右饱满立体双蝴蝶结耳
      const bowGrad = ctx.createLinearGradient(cx, bowY - loopH, cx, bowY + loopH);
      bowGrad.addColorStop(0, ribHi);
      bowGrad.addColorStop(0.55, ribBase);
      bowGrad.addColorStop(1, ribDark);
      ctx.fillStyle = bowGrad;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx, bowY);
        ctx.bezierCurveTo(
          cx + dir * (loopW * 0.52),
          bowY - loopH * 1.38,
          cx + dir * (loopW * 1.32),
          bowY - loopH * 0.82,
          cx + dir * (loopW * 1.12),
          bowY + loopH * 0.16
        );
        ctx.bezierCurveTo(
          cx + dir * (loopW * 0.94),
          bowY + loopH * 1.08,
          cx + dir * (loopW * 0.38),
          bowY + loopH * 0.82,
          cx,
          bowY + 0.6
        );
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // 蝴蝶结中心结扣
      ctx.fillStyle = ribHi;
      ctx.beginPath();
      roundRectPath(ctx, cx - 2.1, bowY - 2.0, 4.2, 4.0, 1.7);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 1:1 还原《局内主界面.webp》的流萤星砂 S 曲线发光入瓶沙流（无生硬黑框管线！）
   */
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
    const spoutY = ch.y + shakeY + ch.h * (163.8 / GH);

    const fade = Math.min(1, pourMs / 80);
    const dy = Math.max(12, endY - spoutY);
    const c1x = spoutX;
    const c1y = spoutY + dy * 0.54;
    const c2x = endX;
    const c2y = spoutY + dy * 0.46;

    const shades = sandRenderer.getSandShades(cid);
    const baseHue = (timeSec * 220) % 360;
    const glowHex = rainbowDrain ? `hsl(${baseHue}, 90%, 72%)` : shades.baseHex;
    const midHex = rainbowDrain ? `hsl(${(baseHue + 50) % 360}, 92%, 82%)` : shades.highlightHex;

    const sampleCurve = (t: number): [number, number] => {
      const u = 1 - t;
      return [
        u * u * u * spoutX + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * endX,
        u * u * u * spoutY + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * endY,
      ];
    };

    const traceStreamBezier = () => {
      ctx.beginPath();
      ctx.moveTo(spoutX, spoutY);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, endX, endY + 1.5);
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 第 1 层：宽幅柔和星夜荧光外晕
    ctx.globalAlpha = 0.20 * fade;
    ctx.strokeStyle = glowHex;
    ctx.lineWidth = 17;
    traceStreamBezier();
    ctx.stroke();

    // 第 2 层：中层丝滑彩沙光带
    ctx.globalAlpha = 0.42 * fade;
    ctx.strokeStyle = midHex;
    ctx.lineWidth = 9.5;
    traceStreamBezier();
    ctx.stroke();

    // 第 3 层：高亮暖白流沙核心束（在瓶口处自然收细钻入瓶内）
    const coreGrad = ctx.createLinearGradient(spoutX, spoutY, endX, endY);
    coreGrad.addColorStop(0, midHex);
    coreGrad.addColorStop(0.5, '#FFFDF4');
    coreGrad.addColorStop(1, midHex);
    ctx.globalAlpha = 0.90 * fade;
    ctx.strokeStyle = coreGrad;
    ctx.lineWidth = 4.2;
    traceStreamBezier();
    ctx.stroke();

    // 第 4 层：沿光带飞舞跳跃的 24 颗发光星砂细粒（中段微散、入瓶口精准收束！）
    for (let k = 0; k < 24; k++) {
      const t = ((k / 24) + timeSec * 2.9 + (k % 3) * 0.07) % 1;
      const [bx, by] = sampleCurve(t);
      const spreadEnv = Math.sin(t * Math.PI); // 两端 0，中段最大 1
      const jitter = Math.sin(k * 17.3 + timeSec * 9.0) * 5.2 * spreadEnv;
      const px = bx + jitter;
      const py = by + Math.cos(k * 11.1 + timeSec * 7.0) * 1.8 * spreadEnv;
      const r = (k % 4 === 0 ? 1.55 : 1.05) * (0.7 + 0.3 * fade);

      ctx.globalAlpha = (0.55 + 0.42 * (1 - Math.abs(t - 0.5))) * fade;
      ctx.fillStyle = k % 2 === 0 ? '#FFFDF6' : midHex;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * 底部四枚暖奶油立体圆角方卡道具钮（1:1 还原《局内主界面.webp》底栏！）
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
    }[] = [
      {
        glyph: 'undo',
        disabled: !canUndo,
        pulse: false,
        medallion: canUndo ? `${engine.snapshots.depth}` : '0',
        medallionVariant: canUndo ? 'wood' : 'muted',
      },
      {
        glyph: 'magnet',
        disabled: !canMagnet,
        pulse: jamPulse && canMagnet,
        medallion: String(magLeft),
        medallionVariant: magLeft === 0 ? 'muted' : jamPulse && canMagnet ? 'amber' : 'wood',
      },
      {
        glyph: 'extra_slot',
        disabled: !canExtraSlot && !fifthActive,
        pulse: jamPulse && canExtraSlot,
        medallion: fifthActive ? '✓' : '+1',
        medallionVariant: fifthActive ? 'sage' : canExtraSlot ? 'wood' : 'muted',
      },
      {
        glyph: 'shuffle',
        disabled: !canShuffle,
        pulse: jamPulse && canShuffle && engine.bucketSys.occupiedSlotCount < engine.bucketSys.maxActiveSlots,
        medallion: String(shufLeft),
        medallionVariant: shufLeft === 0 || !canShuffle ? 'muted' : 'wood',
      },
    ];

    specs.forEach((sp, idx) => {
      const btnRect = layout.propButtons[idx];
      const unlocked = this.isPropUnlocked(idx, engine.level.levelId, maxClearedLevel);
      const isPressed = this.pressedBtnIdx === idx;

      if (!unlocked) {
        const inner = drawRecessedTileCard(ctx, btnRect, tokens, {
          variant: 'locked',
          radius: 12,
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
        variant: sp.pulse ? 'amber' : 'parchment',
        radius: 12,
        pressed: isPressed,
        disabled: sp.disabled,
        pulse: sp.pulse,
        pulsePhase,
        medallionText: sp.medallion,
        medallionVariant: sp.medallionVariant,
        medallionRadius: 8.6,
      });

      ctx.save();
      if (sp.disabled) {
        ctx.globalAlpha = 0.52;
      }
      const iconSize = Math.min(30, inner.h * 0.72);
      drawHandDrawnGlyph(
        ctx,
        sp.glyph,
        inner.x + inner.w * 0.5,
        inner.y + inner.h * 0.5 + 0.5,
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
    const ph = 118 + actionCount * 48;
    const panel: Rect = {
      x: (layout.screenW - pw) * 0.5,
      y: Math.max(layout.topHudY + 44, (layout.screenH - ph) * 0.5 - 10),
      w: pw,
      h: ph,
    };

    drawParchmentModalFrame(ctx, layout.screenW, layout.screenH, panel, '接沙台已满', tokens, assets);

    drawInkText(ctx, '玻璃瓶与当前底沙暂不匹配，可选道具破局：', panel.x + pw * 0.5, panel.y + 54, tokens, {
      font: `600 12.5px ${tokens.typography.fontFamily}`,
      color: '#3B2416',
    });

    this.deadlockSlotBtnRect = null;
    this.deadlockMagnetBtnRect = null;
    this.deadlockUndoBtnRect = null;

    const btnW = pw - 44;
    const btnX = panel.x + 22;
    let curY = panel.y + 84;

    if (canSlot) {
      this.deadlockSlotBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
      drawWoodButton(ctx, this.deadlockSlotBtnRect, '加开第 5 玻璃瓶位', tokens, assets, {
        fillHex: '#1F7A44',
        glyph: 'extra_slot',
        fontSize: 13.5,
      });
      curY += 46;
    }

    if (canMag) {
      this.deadlockMagnetBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
      drawWoodButton(ctx, this.deadlockMagnetBtnRect, '磁吸灌满 1 只瓶腾位', tokens, assets, {
        fillHex: '#C2410C',
        glyph: 'magnet',
        fontSize: 13.5,
      });
      curY += 46;
    }

    if (canUndo) {
      this.deadlockUndoBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
      drawWoodButton(ctx, this.deadlockUndoBtnRect, '撤回上一步', tokens, assets, {
        fillHex: '#0369A1',
        glyph: 'undo',
        fontSize: 13.5,
      });
      curY += 46;
    }

    this.deadlockRestartBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
    drawWoodButton(ctx, this.deadlockRestartBtnRect, '重新挑战本关', tokens, assets, {
      glyph: 'restart',
      fontSize: 13.5,
    });
  }

  private renderRestartConfirmModal(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    const pw = Math.min(312, layout.screenW - 34);
    const ph = 180;
    const panel: Rect = {
      x: (layout.screenW - pw) * 0.5,
      y: (layout.screenH - ph) * 0.5,
      w: pw,
      h: ph,
    };
    drawParchmentModalFrame(ctx, layout.screenW, layout.screenH, panel, '重新挑战？', tokens, assets);

    drawInkText(ctx, '重玩将重置当前流沙与临时瓶位进度', panel.x + pw * 0.5, panel.y + 68, tokens, {
      font: `600 13px ${tokens.typography.fontFamily}`,
      color: '#3B2416',
    });

    const bw = 118;
    this.confirmCancelRect = { x: panel.x + 22, y: panel.y + ph - 58, w: bw, h: 40 };
    this.confirmOkRect = { x: panel.x + pw - 22 - bw, y: panel.y + ph - 58, w: bw, h: 40 };

    drawWoodButton(ctx, this.confirmCancelRect, '继续', tokens, assets, { fillHex: '#1F7A44', fontSize: 13.5 });
    drawWoodButton(ctx, this.confirmOkRect, '重玩', tokens, assets, { glyph: 'restart', fontSize: 13.5 });
  }
}
