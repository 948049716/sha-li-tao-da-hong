import type { BucketRuntime } from '../engine/BucketSystem';
import type { SandEngine } from '../engine/SandEngine';
import type { SandColorShades, SandRenderer } from '../engine/SandRenderer';
import { GH, GW } from '../engine/SandGrid';
import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { RewardManager } from '../systems/RewardManager';
import type { SandColorId } from '../types/level';
import type { Rect, UiTokensFile } from '../types/ui';
import { computeCandidateColumnSlots } from './FtueOverlay';
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
  | { type: 'DISPATCH_COL'; colIdx: number; bucketIdx: number }
  | { type: 'BOTTLE_UNAVAILABLE'; bucketIdx: number }
  | { type: 'PROP_UNDO' }
  | { type: 'PROP_VACUUM' }
  | { type: 'PROP_EXTRA_SLOT' }
  | { type: 'PROP_SHUFFLE' }
  | { type: 'PROP_LOCKED'; unlockLevel: number }
  | { type: 'PROP_RESTART_CONFIRMED' };

interface FlyingDispatchBottle {
  idx: number;
  slotIdx: number;
  color: SandColorId;
  fromX: number;
  fromY: number;
  fromW: number;
  fromH: number;
  elapsedMs: number;
  durationMs: number;
}

interface CompletedBottleGhost {
  idx: number;
  slotIdx: number;
  color: SandColorId;
  x: number;
  y: number;
  w: number;
  h: number;
  elapsedMs: number;
  durationMs: number;
}

export const PROP_UNLOCK_LEVELS: readonly [number, number, number, number] = [2, 3, 2, 4];

const TOP_FLIP_DURATION_MS = 360;
const BLOCKED_ANIM_DURATION_MS = 360;

function mixHex(hexA: string, hexB: string, t: number): string {
  const pa = parseInt(hexA.replace('#', ''), 16);
  const pb = parseInt(hexB.replace('#', ''), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const b = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * 日系手绘绘本风 3/4 斜俯视无槽实木工作台 HUD：
 * 1. 去除深木凹槽，采用更斜俯视（3/4 Top-Front Oblique）开放实木桌面，瓶体更宽大圆润易点触
 * 2. 候选空瓶按列纵向无重叠排布：
 *    - 最顶部（r = 0，紧邻上方接沙杯托）为唯一可点选的【正放敞口空瓶】
 *    - 下方排队空瓶（r >= 1）默认全部【倒扣放置】（瓶口贴桌面、3D 椭圆厚玻璃瓶底朝上），互不遮挡重叠
 *    - 当最顶空瓶被点选入杯托后，下方倒扣空瓶上移补位并在空中完成 180°【倒扣 → 正放】翻转动画
 * 3. 点触不可用瓶（下方倒扣瓶 / 冰封瓶 / 满槽时顶瓶）仅在该被点瓶自身播放独立阻尼不可用动画，其余瓶保持静止，且不弹任何文字提示
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
  private deadlockUndoBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private deadlockRestartBtnRect: Rect = { x: 0, y: 0, w: 140, h: 40 };

  private trackedSignature = '';
  private seenDoneSet = new Set<number>();
  private lastKnownSlotPos = new Map<
    number,
    { slotIdx: number; x: number; y: number; w: number; h: number }
  >();
  private lastKnownTopPos = new Map<
    number,
    { colIdx: number; x: number; y: number; w: number; h: number }
  >();

  private flyingDispatches: FlyingDispatchBottle[] = [];
  private completedGhosts: CompletedBottleGhost[] = [];

  /** 平滑插值显示槽内彩沙液面高度（0..1）与落地弹性缩放 */
  private smoothSlotFill: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  private smoothSlotBottleIdx: [number, number, number, number, number] = [-1, -1, -1, -1, -1];
  private slotLandBounceMs: [number, number, number, number, number] = [0, 0, 0, 0, 0];

  /** 流沙光带首尾生长/收尾状态 */
  private streamActive: [boolean, boolean, boolean, boolean, boolean] = [
    false,
    false,
    false,
    false,
    false,
  ];
  private streamHead: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  private streamTail: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  private streamColor: [SandColorId, SandColorId, SandColorId, SandColorId, SandColorId] = [
    1, 1, 1, 1, 1,
  ];
  private streamSourceGx: [number, number, number, number, number] = [75, 75, 75, 75, 75];

  /** 各列上移推进动画 & 轮到最顶时的 180° 倒扣翻正动画 */
  private prevColLengths: number[] = [0, 0, 0, 0];
  private prevTopBottleIdx: number[] = [-1, -1, -1, -1];
  private prevSecondWasUnrevealed: boolean[] = [false, false, false, false];
  private flipStartedUnrevealed: boolean[] = [false, false, false, false];
  private colSlideAnim: number[] = [0, 0, 0, 0];
  private colFlipElapsedMs: number[] = [-1, -1, -1, -1];

  /** 单瓶独立不可用反馈动画（严格按 bucketIdx 绑定，绝不牵连其他瓶子） */
  private blockedBottleMs = new Map<number, number>();

  public setMechanicBanner(text: string | null): void {
    this.mechanicBannerText = text;
    this.mechanicBannerTimerMs = text ? 3600 : 0;
  }

  /**
   * 仅对被点击的那一只不可用瓶触发阻尼摇晃回弹动画（其他瓶保持完全静止）
   */
  public triggerBlockedBottle(bucketIdx: number): void {
    if (bucketIdx >= 0) {
      this.blockedBottleMs.set(bucketIdx, BLOCKED_ANIM_DURATION_MS);
    }
  }

  /**
   * 关卡载入时立即初始化工作台队列与顶瓶快照，确保首帧点击也能精准触发翻正与入槽过渡
   */
  public resetForLevel(layout: ComputedLayout, engine: SandEngine): void {
    this.trackedSignature = `${engine.level.levelId}|${engine.loadGeneration}`;
    this.seenDoneSet.clear();
    this.lastKnownSlotPos.clear();
    this.lastKnownTopPos.clear();
    this.flyingDispatches = [];
    this.completedGhosts = [];
    this.blockedBottleMs.clear();
    this.smoothSlotFill = [0, 0, 0, 0, 0];
    this.smoothSlotBottleIdx = [-1, -1, -1, -1, -1];
    this.slotLandBounceMs = [0, 0, 0, 0, 0];
    this.streamActive = [false, false, false, false, false];
    this.streamHead = [0, 0, 0, 0, 0];
    this.streamTail = [0, 0, 0, 0, 0];

    const numCols = engine.bucketSys.numCols;
    for (let c = 0; c < 4; c++) {
      const col = engine.bucketSys.columns[c] || [];
      this.prevColLengths[c] = col.length;
      this.prevTopBottleIdx[c] = col[0]?.idx ?? -1;
      this.prevSecondWasUnrevealed[c] = Boolean(col[1] && !col[1].mysteryRevealed);
      this.flipStartedUnrevealed[c] = false;
      this.colSlideAnim[c] = 0;
      this.colFlipElapsedMs[c] = -1;
      if (c < numCols && col[0] && !col[0].done) {
        const cm = computeCandidateColumnSlots(layout, c, numCols);
        const s0 = cm.slots[0];
        this.lastKnownTopPos.set(col[0].idx, {
          colIdx: c,
          x: s0.cx,
          y: s0.baseY,
          w: s0.w,
          h: s0.h,
        });
      }
    }
  }

  /**
   * 当某列最顶部正放瓶被派出入槽时确定性触发：
   * 1. 被点选的顶瓶沿抛物线跃入上方对应圆杯托
   * 2. 若该列下方仍有倒扣空瓶补位至 r=0，立即启动上移 + 180°【倒扣 → 正放】翻转动画
   */
  public notifyColumnDispatched(
    dispatchedIdx: number,
    colIdx: number,
    slotIdx: number,
    color: SandColorId,
    layout: ComputedLayout,
    engine: SandEngine
  ): void {
    const numCols = engine.bucketSys.numCols;
    const cm = computeCandidateColumnSlots(layout, colIdx, numCols);
    const s0 = cm.slots[0];
    const origin = this.lastKnownTopPos.get(dispatchedIdx) || {
      colIdx,
      x: s0.cx,
      y: s0.baseY,
      w: s0.w,
      h: s0.h,
    };

    this.smoothSlotBottleIdx[slotIdx] = dispatchedIdx;
    this.smoothSlotFill[slotIdx] = 0;
    this.flyingDispatches = this.flyingDispatches.filter(
      f => f.slotIdx !== slotIdx && f.idx !== dispatchedIdx
    );
    this.flyingDispatches.push({
      idx: dispatchedIdx,
      slotIdx,
      color,
      fromX: origin.x,
      fromY: origin.y,
      fromW: origin.w,
      fromH: origin.h,
      elapsedMs: 0,
      durationMs: 210,
    });

    const colAfter = engine.bucketSys.columns[colIdx] || [];
    if (colAfter.length > 0) {
      this.colSlideAnim[colIdx] = 1.0;
      this.colFlipElapsedMs[colIdx] = 0;
      this.flipStartedUnrevealed[colIdx] = this.prevSecondWasUnrevealed[colIdx];
    }
    this.prevColLengths[colIdx] = colAfter.length;
    this.prevTopBottleIdx[colIdx] = colAfter[0]?.idx ?? -1;
    this.prevSecondWasUnrevealed[colIdx] = Boolean(colAfter[1] && !colAfter[1].mysteryRevealed);
  }

  /**
   * 若刚补位至列顶的倒扣瓶原本是未揭晓「?」盲盒瓶，标记翻转前半程仍显示雾面问号态、后半程翻正揭晓真色
   */
  public markFlipStartedUnrevealed(colIdx: number): void {
    if (colIdx >= 0 && colIdx < 4 && this.colFlipElapsedMs[colIdx] >= 0) {
      this.flipStartedUnrevealed[colIdx] = true;
    }
  }

  public update(dtMs: number): void {
    const safeDt = Number.isFinite(dtMs) && dtMs > 0 ? Math.min(80, dtMs) : 16.67;

    if (this.mechanicBannerTimerMs > 0) {
      this.mechanicBannerTimerMs = Math.max(0, this.mechanicBannerTimerMs - safeDt);
    }

    for (let i = this.flyingDispatches.length - 1; i >= 0; i--) {
      const fd = this.flyingDispatches[i];
      fd.elapsedMs += safeDt;
      if (fd.elapsedMs >= fd.durationMs) {
        this.slotLandBounceMs[fd.slotIdx] = 130;
        this.flyingDispatches.splice(i, 1);
      }
    }

    for (let i = this.completedGhosts.length - 1; i >= 0; i--) {
      const gh = this.completedGhosts[i];
      gh.elapsedMs += safeDt;
      if (gh.elapsedMs >= gh.durationMs) {
        this.completedGhosts.splice(i, 1);
      }
    }

    for (let s = 0; s < 5; s++) {
      if (this.slotLandBounceMs[s] > 0) {
        this.slotLandBounceMs[s] = Math.max(0, this.slotLandBounceMs[s] - safeDt);
      }
    }

    for (let c = 0; c < 4; c++) {
      if (this.colSlideAnim[c] > 0) {
        this.colSlideAnim[c] = Math.max(0, this.colSlideAnim[c] - safeDt / 260);
      }
      if (this.colFlipElapsedMs[c] >= 0) {
        this.colFlipElapsedMs[c] += safeDt;
        if (this.colFlipElapsedMs[c] >= TOP_FLIP_DURATION_MS) {
          this.colFlipElapsedMs[c] = -1;
        }
      }
    }

    for (const [bIdx, rem] of this.blockedBottleMs.entries()) {
      const next = rem - safeDt;
      if (next <= 0) {
        this.blockedBottleMs.delete(bIdx);
      } else {
        this.blockedBottleMs.set(bIdx, next);
      }
    }
  }

  public isPropUnlocked(propIdx: number, currentLevel: number, maxClearedLevel: number): boolean {
    const req = PROP_UNLOCK_LEVELS[propIdx] ?? 2;
    return Math.max(currentLevel, maxClearedLevel + 1) >= req;
  }

  private getSlotBottleGeometry(
    layout: ComputedLayout,
    slotIdx: number
  ): { cx: number; coasterY: number; bw: number; bh: number; mouthY: number } {
    const clamped = Math.max(0, Math.min(4, slotIdx));
    const sr = layout.activeSlotRects[clamped];
    const coasterY = sr.y + sr.h - 13.5;
    const bh = Math.min(55, Math.round(sr.h * 0.80));
    const bw = Math.min(45, Math.round(bh * 0.82));
    const cx = sr.x + sr.w * 0.5;
    return {
      cx,
      coasterY,
      bw,
      bh,
      mouthY: coasterY - 1.0 - bh + 4.0,
    };
  }

  /**
   * 计算指定接沙槽（0..4）内敞口玻璃瓶口中心屏幕坐标（供流沙光带与粒子精准入瓶）
   */
  public getActiveBucketMouthPos(
    layout: ComputedLayout,
    slotIdx: number,
    _dualMode = false
  ): { x: number; y: number } {
    const g = this.getSlotBottleGeometry(layout, slotIdx);
    return { x: g.cx, y: g.mouthY };
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
      if (this.deadlockUndoBtnRect && this.deadlockUndoBtnRect.w > 0 && hitRect(px, py, this.deadlockUndoBtnRect)) {
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

    // 候选空瓶区：仅每列最顶部正放空瓶（r = 0）可用；点击下方倒扣空瓶（r >= 1）仅触发该瓶自身不可用动画，不弹文字提示
    const expandedCandArea: Rect = {
      x: layout.candidateAreaRect.x - 6,
      y: layout.candidateAreaRect.y - 6,
      w: layout.candidateAreaRect.w + 12,
      h: layout.candidateAreaRect.h + 12,
    };
    if (hitRect(px, py, expandedCandArea) && !engine.won) {
      const numCols = engine.bucketSys.numCols;
      for (let c = 0; c < numCols; c++) {
        const col = engine.bucketSys.columns[c] || [];
        if (col.length === 0) continue;
        const cm = computeCandidateColumnSlots(layout, c, numCols);
        const visibleCount = Math.min(cm.maxVisibleRows, col.length);

        // 1. 先检查最顶正放可用瓶（r = 0；若该列仅剩 1 只瓶，整列区域均可顺畅点选该瓶）
        const topSlot = cm.slots[0];
        if (hitRect(px, py, topSlot.hitRect) || (col.length === 1 && hitRect(px, py, cm.colRect))) {
          return { type: 'DISPATCH_COL', colIdx: c, bucketIdx: col[0].idx };
        }

        // 2. 再精确命中下方各只倒扣空瓶（r = 1 .. visibleCount - 1），仅对该被点瓶触发不可用动画
        for (let r = 1; r < visibleCount; r++) {
          const sl = cm.slots[r];
          if (sl && hitRect(px, py, sl.hitRect)) {
            this.triggerBlockedBottle(col[r].idx);
            return { type: 'BOTTLE_UNAVAILABLE', bucketIdx: col[r].idx };
          }
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
    // 1. 顶栏：左侧日系和纸胶囊 [⊞ 08] + 右侧两枚浅桦木手绘圆钮 [?] [↻]
    // ========================================================================
    const sp = layout.settingsPill;
    drawDoubleRimPlaque(ctx, sp, tokens, {
      variant: 'parchment',
      radius: sp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'grid', sp.x + 23, sp.y + sp.h * 0.5, 16.0, tokens);
    drawStorybookNumber(
      ctx,
      String(engine.level.levelId).padStart(2, '0'),
      sp.x + 23 + (sp.w - 23) * 0.51,
      sp.y + sp.h * 0.5 + 0.5,
      23.0,
      tokens,
      { slant: -0.02, boldStroke: 0.55 }
    );

    const gp = layout.guidePill;
    drawDoubleRimPlaque(ctx, gp, tokens, {
      variant: 'walnut',
      radius: gp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'question', gp.x + gp.w * 0.5, gp.y + gp.h * 0.5, 18.0, tokens);

    const rp = layout.restartPill;
    drawDoubleRimPlaque(ctx, rp, tokens, {
      variant: 'walnut',
      radius: rp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'restart', rp.x + rp.w * 0.5, rp.y + rp.h * 0.5, 17.5, tokens);

    // ========================================================================
    // 2. 3/4 斜俯视开放实木工作台 + 4+1 圆杯托 + 上正下倒零重叠空瓶队列 + 翻转/进出槽动画
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
          color: '#382417',
          maxWidth: cw - 20,
        }
      );
    }

    // ========================================================================
    // 4. 桌下深棕暗影区与四枚日系和纸圆角方卡道具钮
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
    const sig = `${engine.level.levelId}|${engine.loadGeneration}`;
    if (sig !== this.trackedSignature) {
      this.resetForLevel(layout, engine);
    }

    const numCols = engine.bucketSys.numCols;
    for (let c = 0; c < numCols; c++) {
      const col = engine.bucketSys.columns[c] || [];
      const curLen = col.length;
      const curTopIdx = col[0]?.idx ?? -1;

      // 当洗牌等操作使新瓶轮到最顶时，同样触发 180° 倒扣翻正动画
      if (curTopIdx >= 0 && curTopIdx !== this.prevTopBottleIdx[c]) {
        if (curLen <= this.prevColLengths[c] || engine.shuffleAnimMs > 0) {
          this.colSlideAnim[c] = 1.0;
          this.colFlipElapsedMs[c] = 0;
          this.flipStartedUnrevealed[c] = this.prevSecondWasUnrevealed[c];
        }
      }

      this.prevColLengths[c] = curLen;
      this.prevTopBottleIdx[c] = curTopIdx;
      this.prevSecondWasUnrevealed[c] = Boolean(col[1] && !col[1].mysteryRevealed);
    }

    // 1. 追踪接沙位新入座飞跃过渡 & 液面平滑插值 & 流沙带首尾生长/收尾
    for (let s = 0; s < 5; s++) {
      const bk = engine.bucketSys.activeSlots[s];
      const sg = this.getSlotBottleGeometry(layout, s);

      if (bk && !bk.done) {
        const targetRatio = Math.min(1, bk.cur / Math.max(1, bk.max));
        if (this.smoothSlotBottleIdx[s] !== bk.idx) {
          this.smoothSlotBottleIdx[s] = bk.idx;
          this.smoothSlotFill[s] = targetRatio;

          // 兜底：若直接设置槽位尚未经过 notifyColumnDispatched，同样补建飞跃过渡
          const origin = this.lastKnownTopPos.get(bk.idx);
          if (origin) {
            this.flyingDispatches = this.flyingDispatches.filter(f => f.slotIdx !== s && f.idx !== bk.idx);
            this.flyingDispatches.push({
              idx: bk.idx,
              slotIdx: s,
              color: bk.color,
              fromX: origin.x,
              fromY: origin.y,
              fromW: origin.w,
              fromH: origin.h,
              elapsedMs: 0,
              durationMs: 210,
            });
          }
        } else {
          this.smoothSlotFill[s] += (targetRatio - this.smoothSlotFill[s]) * 0.24;
        }

        this.lastKnownSlotPos.set(bk.idx, {
          slotIdx: s,
          x: sg.cx,
          y: sg.coasterY - 1.0,
          w: sg.bw,
          h: sg.bh,
        });
      } else {
        this.smoothSlotBottleIdx[s] = -1;
        this.smoothSlotFill[s] = 0;
      }

      // 同步流沙光带的起流延伸（head 0->1）与断流收尾（tail 0->1）
      const pourMs = engine.slotPourMs[s];
      const cid = engine.slotPourColor[s] as SandColorId | 0;
      const isFlyingIn = this.flyingDispatches.some(f => f.slotIdx === s && f.elapsedMs < f.durationMs * 0.85);
      if (pourMs > 0 && cid >= 1 && cid <= 5 && bk && !bk.done && !isFlyingIn) {
        if (!this.streamActive[s]) {
          this.streamActive[s] = true;
          this.streamHead[s] = 0.12;
          this.streamTail[s] = 0;
        } else {
          this.streamTail[s] = Math.max(0, this.streamTail[s] - 0.22);
          this.streamHead[s] = Math.min(1, this.streamHead[s] + 0.14);
        }
        this.streamColor[s] = cid as SandColorId;
        this.streamSourceGx[s] = engine.slotPourX[s] || 75;
      } else if (this.streamActive[s]) {
        this.streamHead[s] = 1;
        this.streamTail[s] += 0.11;
        if (this.streamTail[s] >= 0.96) {
          this.streamActive[s] = false;
          this.streamHead[s] = 0;
          this.streamTail[s] = 0;
        }
      }
    }

    // 2. 记录当前各列最顶瓶（r = 0）坐标，供下一帧点选飞入杯托动画作为起点
    for (let c = 0; c < numCols; c++) {
      const topBk = engine.bucketSys.columns[c]?.[0];
      if (topBk && !topBk.done) {
        const cm = computeCandidateColumnSlots(layout, c, numCols);
        const s0 = cm.slots[0];
        this.lastKnownTopPos.set(topBk.idx, {
          colIdx: c,
          x: s0.cx,
          y: s0.baseY,
          w: s0.w,
          h: s0.h,
        });
      }
    }

    // 3. 满瓶瞬间触发两段式「落塞封口 -> 弧线星光飞离槽位」过渡动画
    for (const bk of engine.bucketSys.buckets) {
      if (bk.done && !this.seenDoneSet.has(bk.idx)) {
        this.seenDoneSet.add(bk.idx);
        const pos = this.lastKnownSlotPos.get(bk.idx) || {
          slotIdx: 1,
          x: layout.screenW * 0.5,
          y: layout.slotRowRect.y + layout.slotRowRect.h - 11,
          w: 44,
          h: 56,
        };
        this.completedGhosts.push({
          idx: bk.idx,
          slotIdx: pos.slotIdx,
          color: bk.color,
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          elapsedMs: 0,
          durationMs: 600,
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
    // 更斜俯视（3/4 视角）开放实木大桌面：桌后沿略高，完整承托圆润椭圆杯托与下方无槽空瓶阵列
    const tableBackY = Math.round(layout.slotRowRect.y + layout.slotRowRect.h * 0.34);
    const tableFrontY = layout.propRowRect.y - 7;

    this.syncWorkbenchAnimations(layout, engine);

    // ========================================================================
    // 1. 绘制 3/4 斜俯视温润浅桦木开放大桌面（去除深木凹槽，带自然透视拼板木纹）
    // ========================================================================
    ctx.save();

    const woodGrad = ctx.createLinearGradient(0, tableBackY, 0, tableFrontY);
    woodGrad.addColorStop(0, '#E3C093');
    woodGrad.addColorStop(0.52, '#D5AC7A');
    woodGrad.addColorStop(1, '#C69964');
    ctx.fillStyle = woodGrad;
    ctx.fillRect(0, tableBackY, W, Math.max(10, tableFrontY - tableBackY));

    // 3/4 斜俯视透视桌面木拼板细缝（向远方中心微聚拢，强化俯视景深）
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, tableBackY, W, Math.max(10, tableFrontY - tableBackY));
    ctx.clip();
    const vanishX = W * 0.5;
    const vanishY = tableBackY - 260;
    ctx.strokeStyle = 'rgba(108, 68, 32, 0.12)';
    ctx.lineWidth = 1.0;
    for (const frac of [0.14, 0.38, 0.62, 0.86]) {
      const frontX = W * frac;
      const tBack = (tableBackY - vanishY) / Math.max(1, tableFrontY - vanishY);
      const backX = vanishX + (frontX - vanishX) * tBack;
      ctx.beginPath();
      ctx.moveTo(backX, tableBackY);
      ctx.lineTo(frontX, tableFrontY);
      ctx.stroke();
    }

    // 柔和横向手绘木纹丝
    ctx.strokeStyle = 'rgba(102, 64, 30, 0.11)';
    ctx.lineWidth = 0.9;
    for (let k = 1; k <= 5; k++) {
      const gy = tableBackY + ((tableFrontY - tableBackY) * k) / 5.5;
      ctx.beginPath();
      ctx.moveTo(8, gy);
      ctx.bezierCurveTo(W * 0.32, gy - 1.6, W * 0.68, gy + 1.8, W - 8, gy - 0.4);
      ctx.stroke();
    }
    ctx.restore();

    // 桌后沿深棕细墨边与亮线
    ctx.strokeStyle = '#382417';
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    ctx.moveTo(0, tableBackY);
    ctx.lineTo(W, tableBackY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 248, 232, 0.38)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, tableBackY + 1.8);
    ctx.lineTo(W, tableBackY + 1.8);
    ctx.stroke();

    // 桌面最前缘立体厚木边（7px）
    const lipGrad = ctx.createLinearGradient(0, tableFrontY, 0, layout.propRowRect.y);
    lipGrad.addColorStop(0, '#A8784B');
    lipGrad.addColorStop(1, '#7D5430');
    ctx.fillStyle = lipGrad;
    ctx.fillRect(0, tableFrontY, W, 7);

    ctx.strokeStyle = '#2E1C10';
    ctx.lineWidth = 1.65;
    ctx.beginPath();
    ctx.moveTo(0, tableFrontY);
    ctx.lineTo(W, tableFrontY);
    ctx.moveTo(0, layout.propRowRect.y);
    ctx.lineTo(W, layout.propRowRect.y);
    ctx.stroke();

    // 桌下深可可暗影底栏
    const underGrad = ctx.createLinearGradient(0, layout.propRowRect.y, 0, H);
    underGrad.addColorStop(0, '#443225');
    underGrad.addColorStop(1, '#332419');
    ctx.fillStyle = underGrad;
    ctx.fillRect(0, layout.propRowRect.y, W, Math.max(0, H - layout.propRowRect.y));
    ctx.restore();

    // ========================================================================
    // 2. 上层 4+1 斜俯视圆润杯托与宽大敞口丝带玻璃瓶
    // ========================================================================
    const maxSlots = engine.bucketSys.maxActiveSlots;
    const slotPropUnlocked = this.isPropUnlocked(2, engine.level.levelId, maxClearedLevel);

    for (let s = 0; s < 5; s++) {
      const sr = layout.activeSlotRects[s];
      const locked5th = s >= maxSlots;
      if (locked5th && !slotPropUnlocked) continue;

      const bk = engine.bucketSys.activeSlots[s];
      const flyingIntoThisSlot = this.flyingDispatches.find(f => f.slotIdx === s);
      const exitingFromThisSlot = this.completedGhosts.find(
        g => g.slotIdx === s && g.elapsedMs < g.durationMs * 0.45
      );
      const isReceiving = Boolean(
        bk && !bk.done && (engine.slotPourMs[s] > 0 || this.streamActive[s]) && !flyingIntoThisSlot
      );

      const sg = this.getSlotBottleGeometry(layout, s);
      const cx = sg.cx;
      const coasterY = sg.coasterY;
      // 3/4 更斜俯视视角下更饱满圆润的椭圆陶瓷杯托（ry/rx ≈ 0.36）
      const coasterRx = Math.min(28.5, sr.w * 0.445);
      const coasterRy = Math.max(9.2, coasterRx * 0.36);

      if (locked5th) {
        this.drawRoundCoasterDisc(ctx, cx, coasterY, coasterRx, coasterRy, '#B2A89C', '#8C8277');
        drawStorybookNumber(ctx, '+1', cx, coasterY + 0.5, 11.5, tokens, {
          color: '#2E1E12',
          slant: 0,
          embossColor: 'rgba(255,255,255,0.35)',
        });
        this.drawStandingSlotPadlock(ctx, cx, coasterY - 14);
      } else if (bk && !bk.done) {
        const shades = sandRenderer.getSandShades(bk.color);
        const discTop = mixHex(shades.highlightHex, '#FFFFFF', 0.06);
        const discSide = mixHex(shades.baseHex, '#8C7A68', 0.14);
        this.drawRoundCoasterDisc(ctx, cx, coasterY, coasterRx, coasterRy, discTop, discSide, isReceiving);

        if (!flyingIntoThisSlot) {
          let sx = 1;
          let sy = 1;
          if (this.slotLandBounceMs[s] > 0) {
            const bt = 1 - this.slotLandBounceMs[s] / 130;
            const wave = Math.sin(bt * Math.PI);
            sx = 1 + 0.08 * wave;
            sy = 1 - 0.07 * wave;
          }
          ctx.save();
          ctx.translate(cx, coasterY - 0.5);
          ctx.scale(sx, sy);
          this.drawObliqueUprightBottle(ctx, 0, 0, sg.bw, sg.bh, shades, tokens, timeSec, {
            hasCork: false,
            fillRatio: this.smoothSlotFill[s],
            isPouringInto: isReceiving,
            highlightActive: true,
          });
          ctx.restore();
        }
      } else {
        this.drawCeramicEmptySaucer(ctx, cx, coasterY, coasterRx, coasterRy);
        if (exitingFromThisSlot) {
          const rp = exitingFromThisSlot.elapsedMs / (exitingFromThisSlot.durationMs * 0.45);
          const shades = sandRenderer.getSandShades(exitingFromThisSlot.color);
          ctx.save();
          ctx.globalAlpha = (1 - rp) * 0.65;
          ctx.strokeStyle = shades.highlightHex;
          ctx.lineWidth = 2.0 * (1 - rp * 0.5);
          ctx.beginPath();
          ctx.ellipse(cx, coasterY, coasterRx * (0.75 + 0.45 * rp), coasterRy * (0.75 + 0.45 * rp), 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // ========================================================================
    // 3. 宽出细入柔光漏斗 S 曲线流沙束
    // ========================================================================
    for (let s = 0; s < 5; s++) {
      if (this.streamActive[s]) {
        const mouth = this.getActiveBucketMouthPos(layout, s);
        this.renderPouringSandStream(
          ctx,
          layout,
          engine,
          sandRenderer,
          s,
          this.streamSourceGx[s],
          this.streamColor[s],
          this.streamTail[s],
          this.streamHead[s],
          mouth.x,
          mouth.y,
          timeSec,
          rainbowDrain
        );
      }
    }

    // ========================================================================
    // 4. 下层无瓶槽开放桌面候选空瓶队列（上顶正放可用 · 下排默认倒扣 · 零重叠 · 轮到最顶翻正动画）
    // ========================================================================
    const numCols = engine.bucketSys.numCols;
    const slotsHaveSpace = engine.bucketSys.occupiedSlotCount < maxSlots;
    const shuffleJitter =
      engine.shuffleAnimMs > 0 ? Math.sin(engine.shuffleAnimMs * 0.08) * 3.0 : 0;

    for (let c = 0; c < numCols; c++) {
      const cm = computeCandidateColumnSlots(layout, c, numCols);
      const col = engine.bucketSys.columns[c] || [];
      const s0 = cm.slots[0];

      // 桌面最顶就绪位轻柔浅木印圆垫线（指示此处为最顶正放取瓶位，即便列空也温润自然）
      ctx.save();
      ctx.strokeStyle = col.length > 0 && slotsHaveSpace ? 'rgba(255, 244, 206, 0.52)' : 'rgba(110, 72, 36, 0.16)';
      ctx.fillStyle = col.length > 0 && slotsHaveSpace ? 'rgba(255, 238, 172, 0.20)' : 'rgba(92, 58, 28, 0.05)';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.ellipse(s0.cx, s0.baseY - s0.w * 0.15, s0.w * 0.56, s0.w * 0.21, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (col.length === 0) continue;

      const visibleCount = Math.min(cm.maxVisibleRows, col.length);
      const rawSlide = this.colSlideAnim[c];
      const slideRemain = rawSlide * rawSlide * (3 - 2 * rawSlide); // 1 -> 0 平滑上移

      // 从上至下按 3/4 俯视近远次序绘制（每行留有净空完全不重叠！）
      for (let r = 0; r < visibleCount; r++) {
        const bk = col[r];
        const slot = cm.slots[r];
        const nextBelowBaseY =
          r + 1 < cm.slots.length ? cm.slots[r + 1].baseY : slot.baseY + slot.h + 6;
        const stepDist = nextBelowBaseY - slot.baseY;

        // 仅当该瓶自身被点击触发不可用反馈（或自身冰层震动）时才计算微幅阻尼动画，绝不影响同列其他瓶！
        const remBlock = this.blockedBottleMs.get(bk.idx) || 0;
        let blockDx = 0;
        let blockRot = 0;
        let blockSx = 1;
        let blockSy = 1;
        if (remBlock > 0) {
          const bp = 1 - remBlock / BLOCKED_ANIM_DURATION_MS;
          const damp = 1 - bp;
          blockDx = Math.sin(bp * Math.PI * 5) * 5.6 * damp;
          blockRot = Math.sin(bp * Math.PI * 5) * 0.11 * damp;
          const squish = Math.sin(Math.min(1, bp * 3.2) * Math.PI);
          blockSx = 1 + 0.08 * squish;
          blockSy = 1 - 0.07 * squish;
        } else if (bk.iceShakeMs > 0) {
          blockDx = Math.sin(bk.iceShakeMs * 0.14) * 3.5;
        }

        const drawCx = slot.cx + blockDx + (r % 2 === 0 ? shuffleJitter : -shuffleJitter);

        if (r === 0) {
          // ------------------------------------------------------------------
          // 最顶部可用瓶（r = 0）：常态为【正放敞口空瓶】；刚从下方补位上来时播放 180°【倒扣 → 正放】翻转动画！
          // ------------------------------------------------------------------
          const flipElapsed = this.colFlipElapsedMs[c];
          if (flipElapsed >= 0 && flipElapsed < TOP_FLIP_DURATION_MS) {
            const ft = Math.min(1, flipElapsed / TOP_FLIP_DURATION_MS);
            const posEase = 1 - Math.pow(1 - ft, 3);
            const curBaseY =
              slot.baseY + stepDist * (1 - posEase) - Math.sin(ft * Math.PI) * 16;
            const curW = (cm.slots[1]?.w ?? slot.w) + (slot.w - (cm.slots[1]?.w ?? slot.w)) * posEase;
            const curH = (cm.slots[1]?.h ?? slot.h) + (slot.h - (cm.slots[1]?.h ?? slot.h)) * posEase;

            ctx.save();
            ctx.translate(drawCx, curBaseY - curH * 0.5);

            if (ft < 0.46) {
              // 翻转前半程（0° ~ 90°）：由倒扣态向上腾空收扁（若原本是未揭晓 ? 瓶，前半程仍保持雾面状态！）
              const u = ft / 0.46;
              const cosScale = Math.max(0.15, Math.cos(u * Math.PI * 0.5));
              const stretchX = 1 + (1 - cosScale) * 0.16;
              ctx.rotate(Math.sin(u * Math.PI) * 0.18);
              ctx.scale(stretchX * blockSx, cosScale * blockSy);
              this.drawCandidateInvertedState(
                ctx,
                bk,
                0,
                curH * 0.5,
                curW,
                curH,
                this.flipStartedUnrevealed[c],
                sandRenderer,
                tokens
              );
            } else {
              // 翻转后半程（90° ~ 180°）：翻转显露为正放敞口空瓶并带弹性落定于最顶可用位！
              const u = (ft - 0.46) / 0.54;
              // 柔和微弹曲线 0.15 -> 1.07 -> 1.00
              const backOvershoot =
                u < 0.72
                  ? 0.15 + 0.92 * (1 - Math.pow(1 - u / 0.72, 2.2))
                  : 1.07 - 0.07 * ((u - 0.72) / 0.28);
              const stretchX = 1 + (1 - Math.min(1.06, backOvershoot)) * 0.18;
              ctx.rotate(-Math.sin((1 - u) * Math.PI) * 0.12);
              ctx.scale(stretchX * blockSx, backOvershoot * blockSy);
              this.drawCandidateUprightState(
                ctx,
                bk,
                0,
                curH * 0.5,
                curW,
                curH,
                sandRenderer,
                tokens,
                timeSec
              );
            }
            ctx.restore();
          } else {
            // 常态正放最顶空瓶（可用！）
            ctx.save();
            ctx.translate(drawCx, slot.baseY);
            ctx.rotate(blockRot);
            ctx.scale(blockSx, blockSy);
            this.drawCandidateUprightState(
              ctx,
              bk,
              0,
              0,
              slot.w,
              slot.h,
              sandRenderer,
              tokens,
              timeSec
            );
            ctx.restore();
          }
        } else {
          // ------------------------------------------------------------------
          // 下方排队瓶（r >= 1）：默认全部【倒扣放置】（瓶底朝上、瓶口贴桌），补位时平滑上滑且互不重叠
          // ------------------------------------------------------------------
          const curBaseY = slot.baseY + stepDist * slideRemain;
          ctx.save();
          ctx.translate(drawCx, curBaseY);
          ctx.rotate(blockRot);
          ctx.scale(blockSx, blockSy);
          this.drawCandidateInvertedState(
            ctx,
            bk,
            0,
            0,
            slot.w,
            slot.h,
            !bk.mysteryRevealed,
            sandRenderer,
            tokens
          );
          ctx.restore();
        }
      }

      // 若该列总瓶数超出当前可见非重叠行数，在末行右下角轻贴小巧余量标
      if (col.length > visibleCount) {
        const lastSlot = cm.slots[visibleCount - 1];
        drawStatusPill(
          ctx,
          lastSlot.cx + lastSlot.w * 0.58,
          lastSlot.baseY - 7,
          `+${col.length - visibleCount}`,
          tokens,
          {
            bgHex: '#FAF2E1',
            borderHex: '#382417',
            textColor: '#382417',
            fontSize: 9.0,
            padX: 5.0,
            height: 14,
          }
        );
      }
    }

    // ========================================================================
    // 5. 动画层 A：点选最顶正放空瓶 -> 抛物线轻跃入上方圆形杯托
    // ========================================================================
    for (const fd of this.flyingDispatches) {
      const t = Math.min(1, fd.elapsedMs / fd.durationMs);
      const ease = 1 - Math.pow(1 - t, 3);
      const sg = this.getSlotBottleGeometry(layout, fd.slotIdx);
      const curX = fd.fromX + (sg.cx - fd.fromX) * ease;
      const curY =
        fd.fromY + (sg.coasterY - 0.5 - fd.fromY) * ease - Math.sin(t * Math.PI) * 22;
      const curW = fd.fromW + (sg.bw - fd.fromW) * ease;
      const curH = fd.fromH + (sg.bh - fd.fromH) * ease;
      const tilt = Math.max(-0.16, Math.min(0.16, (sg.cx - fd.fromX) * 0.0020)) * Math.sin(t * Math.PI);
      const shades = sandRenderer.getSandShades(fd.color);

      ctx.save();
      ctx.translate(curX, curY);
      ctx.rotate(tilt);
      this.drawObliqueUprightBottle(ctx, 0, 0, curW, curH, shades, tokens, timeSec, {
        hasCork: false,
        fillRatio: 0,
        isPouringInto: false,
        highlightActive: true,
      });
      ctx.restore();
    }

    // ========================================================================
    // 6. 动画层 B：满瓶两段式离槽过渡（1. 软木塞落下封口微弹 -> 2. 侧上方抛物弧线伴星芒离槽）
    // ========================================================================
    for (const gh of this.completedGhosts) {
      const p = Math.min(1, gh.elapsedMs / gh.durationMs);
      const shades = sandRenderer.getSandShades(gh.color);

      let drawX = gh.x;
      let drawY = gh.y;
      let scaleX = 1;
      let scaleY = 1;
      let rot = 0;
      let alpha = 1;
      let corkDropOffset = 0;

      if (p < 0.25) {
        const sp = p / 0.25;
        corkDropOffset = Math.pow(1 - sp, 2) * 13;
        const bounce = Math.sin(sp * Math.PI);
        scaleX = 1 + 0.12 * bounce;
        scaleY = 1 - 0.10 * bounce;
        drawY = gh.y + 1.5 * bounce;
      } else {
        const u = (p - 0.25) / 0.75;
        const easeOut = 1 - Math.pow(1 - u, 2.2);
        const dirSign = gh.slotIdx < 1.5 ? -1 : gh.slotIdx > 2.5 ? 1 : (gh.idx % 2 === 0 ? -0.75 : 0.75);
        const driftX = dirSign * 34 * easeOut;
        const liftY = -24 * easeOut - Math.sin(u * Math.PI) * 16;
        drawX = gh.x + driftX;
        drawY = gh.y + liftY;
        const shrink = 1.04 - 0.36 * easeOut;
        scaleX = shrink;
        scaleY = shrink;
        rot = dirSign * 0.20 * Math.sin(u * Math.PI * 0.92);
        alpha = u < 0.50 ? 1 : Math.max(0, (1 - u) / 0.50);

        ctx.save();
        for (let k = 0; k < 4; k++) {
          const trailU = Math.max(0, u - (k + 1) * 0.09);
          if (trailU <= 0) continue;
          const te = 1 - Math.pow(1 - trailU, 2.2);
          const sx = gh.x + dirSign * 34 * te + Math.sin(k * 2.3 + timeSec * 8) * 5;
          const sy = gh.y - gh.h * 0.45 - 22 * te - Math.sin(trailU * Math.PI) * 14 + k * 3;
          const sr = (3.8 - k * 0.65) * alpha;
          if (sr <= 0.4) continue;
          ctx.globalAlpha = alpha * (0.80 - k * 0.15);
          ctx.fillStyle = k % 2 === 0 ? '#FFF9D6' : shades.highlightHex;
          ctx.beginPath();
          ctx.moveTo(sx, sy - sr);
          ctx.quadraticCurveTo(sx, sy, sx + sr, sy);
          ctx.quadraticCurveTo(sx, sy, sx, sy + sr);
          ctx.quadraticCurveTo(sx, sy, sx - sr, sy);
          ctx.quadraticCurveTo(sx, sy, sx, sy - sr);
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(drawX, drawY);
      ctx.rotate(rot);
      ctx.scale(scaleX, scaleY);
      this.drawObliqueUprightBottle(ctx, 0, 0, gh.w, gh.h, shades, tokens, timeSec, {
        hasCork: true,
        corkDropOffset,
        fillRatio: 1.0,
        isPouringInto: false,
        highlightActive: true,
      });
      ctx.restore();
    }
  }

  private drawCandidateUprightState(
    ctx: CanvasRenderingContext2D,
    bk: BucketRuntime,
    cx: number,
    baseY: number,
    w: number,
    h: number,
    sandRenderer: SandRenderer,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    const shades = sandRenderer.getSandShades(bk.color);
    this.drawObliqueUprightBottle(ctx, cx, baseY, w, h, shades, tokens, timeSec, {
      hasCork: false,
      fillRatio: 0,
      isPouringInto: false,
      highlightActive: bk.iceLayers === 0,
    });
    if (bk.iceLayers > 0) {
      this.drawIceCrystalOverlay(ctx, cx, baseY, w, h, bk.iceLayers, true, tokens);
    }
  }

  private drawCandidateInvertedState(
    ctx: CanvasRenderingContext2D,
    bk: BucketRuntime,
    cx: number,
    baseY: number,
    w: number,
    h: number,
    forceMystery: boolean,
    sandRenderer: SandRenderer,
    tokens: UiTokensFile
  ): void {
    const isMystery = forceMystery || !bk.mysteryRevealed;
    const shades: SandColorShades = isMystery
      ? {
          baseHex: '#E5DAC4',
          highlightHex: '#F6EFE0',
          shadowHex: '#CEBFA4',
          outlineHex: '#382417',
          pebbleDarkHex: '#9E8E74',
        }
      : sandRenderer.getSandShades(bk.color);

    this.drawObliqueUpsideDownBottle(ctx, cx, baseY, w, h, shades, tokens, isMystery);
    if (bk.iceLayers > 0) {
      this.drawIceCrystalOverlay(ctx, cx, baseY, w, h, bk.iceLayers, false, tokens);
    }
  }

  private drawIceCrystalOverlay(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
    w: number,
    h: number,
    iceLayers: number,
    isTopRow: boolean,
    tokens: UiTokensFile
  ): void {
    const topY = baseY - h;
    ctx.save();
    const iceGrad = ctx.createLinearGradient(cx - w * 0.46, topY + h * 0.1, cx + w * 0.46, baseY);
    iceGrad.addColorStop(0, 'rgba(232, 250, 255, 0.80)');
    iceGrad.addColorStop(0.5, 'rgba(154, 214, 246, 0.58)');
    iceGrad.addColorStop(1, 'rgba(104, 180, 228, 0.68)');
    ctx.fillStyle = iceGrad;
    ctx.strokeStyle = '#2D5E82';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, topY + h * 0.08);
    ctx.lineTo(cx + w * 0.47, topY + h * 0.28);
    ctx.lineTo(cx + w * 0.45, baseY - 3);
    ctx.lineTo(cx, baseY + 1);
    ctx.lineTo(cx - w * 0.45, baseY - 3);
    ctx.lineTo(cx - w * 0.47, topY + h * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(cx, topY + h * 0.08);
    ctx.lineTo(cx - w * 0.12, baseY);
    ctx.moveTo(cx - w * 0.45, topY + h * 0.30);
    ctx.lineTo(cx + w * 0.45, topY + h * 0.42);
    ctx.stroke();

    const pillW = isTopRow ? 30 : 27;
    const pillH = isTopRow ? 14 : 12.5;
    const py = topY + h * 0.52;
    ctx.fillStyle = 'rgba(246, 252, 255, 0.94)';
    ctx.strokeStyle = '#2D5E82';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    roundRectPath(ctx, cx - pillW * 0.5, py - pillH * 0.5, pillW, pillH, pillH * 0.5);
    ctx.fill();
    ctx.stroke();

    drawHandDrawnGlyph(ctx, 'snowflake', cx - pillW * 0.22, py, isTopRow ? 9.2 : 8.0, tokens);
    drawInkText(ctx, `×${iceLayers}`, cx + pillW * 0.17, py + 0.4, tokens, {
      font: `700 ${isTopRow ? 9.2 : 8.0}px ${tokens.typography.numeralFontFamily}`,
      color: '#1E4868',
      embossColor: '',
    });
    ctx.restore();
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
    const ink = '#382417';
    const thick = 4.6;
    ctx.save();

    if (glow) {
      ctx.fillStyle = 'rgba(255, 228, 138, 0.38)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 1, rx + 4, ry + 3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(38, 22, 10, 0.20)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + thick + 1.4, rx + 1, ry + 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = sideHex;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(cx, cy + thick, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(cx - rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

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
    ctx.strokeStyle = 'rgba(120, 98, 76, 0.32)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 0.3, rx * 0.72, ry * 0.68, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawStandingSlotPadlock(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const ink = '#382417';
    ctx.save();
    ctx.translate(cx, cy);

    ctx.strokeStyle = ink;
    ctx.lineWidth = 3.9;
    ctx.beginPath();
    ctx.arc(0, -6.2, 4.9, Math.PI, 0, false);
    ctx.stroke();
    ctx.strokeStyle = '#D4CABB';
    ctx.lineWidth = 1.9;
    ctx.stroke();

    const g = ctx.createLinearGradient(-7.8, -6, 7.8, 7);
    g.addColorStop(0, '#E2D2BA');
    g.addColorStop(1, '#BCA484');
    ctx.fillStyle = g;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    roundRectPath(ctx, -7.8, -5.8, 15.6, 13.0, 2.8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(0, -0.6, 1.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-0.85, -0.2, 1.7, 3.6);
    ctx.restore();
  }

  /**
   * 3/4 斜俯视【正放】有色玻璃药剂瓶（用于接沙杯托瓶 & 候选列最顶部 r=0 正放可用空瓶）：
   * - 更斜俯视透视（椭圆纵横比 ~0.35）：顶部清晰展现饱满 3D 椭圆瓶口内孔，底部透出 3D 椭圆厚玻璃瓶底圈
   * - 候选最顶瓶为晶莹空瓶（fillRatio=0），凭清透有色玻璃与蝴蝶结丝带直观辨识颜色
   */
  private drawObliqueUprightBottle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
    w: number,
    h: number,
    shades: SandColorShades,
    _tokens: UiTokensFile,
    timeSec: number,
    opts: {
      hasCork: boolean;
      corkDropOffset?: number;
      fillRatio: number;
      isPouringInto: boolean;
      highlightActive: boolean;
    }
  ): void {
    const ink = '#382417';
    const bounce = opts.isPouringInto ? Math.sin(timeSec * 18) * 0.45 : 0;
    const corkProtrude = opts.hasCork ? h * 0.10 : 0;
    const mouthCy = baseY - h + corkProtrude + h * 0.065 + bounce;

    const bellyHalfW = w * 0.45;
    const bottomRy = Math.max(4.8, bellyHalfW * 0.34);
    const bodyBotCy = baseY - bottomRy;

    const lipHalfW = w * 0.305;
    const lipRy = Math.max(3.2, lipHalfW * 0.37);
    const neckHalfW = w * 0.225;
    const neckBotY = mouthCy + lipRy + h * 0.085;
    const shoulderBotY = neckBotY + h * 0.145;
    const wallThick = Math.max(2.2, w * 0.058);

    const traceBody = (inset = 0) => {
      const nw = Math.max(3.2, neckHalfW - inset * 0.65);
      const bw = Math.max(5.5, bellyHalfW - inset);
      const bRy = Math.max(3.2, bottomRy - inset * 0.38);
      const yTop = mouthCy + inset * 0.3;
      const yNeck = neckBotY + inset * 0.15;
      const ySh = shoulderBotY + inset * 0.15;
      const yBotCy = bodyBotCy - inset * 0.75;

      ctx.beginPath();
      ctx.moveTo(cx - nw, yTop);
      ctx.lineTo(cx - nw, yNeck);
      ctx.bezierCurveTo(
        cx - nw,
        yNeck + (ySh - yNeck) * 0.45,
        cx - bw,
        ySh - (ySh - yNeck) * 0.45,
        cx - bw,
        ySh
      );
      ctx.lineTo(cx - bw, yBotCy);
      ctx.ellipse(cx, yBotCy, bw, bRy, 0, Math.PI, 0, true);
      ctx.lineTo(cx + bw, ySh);
      ctx.bezierCurveTo(
        cx + bw,
        ySh - (ySh - yNeck) * 0.45,
        cx + nw,
        yNeck + (ySh - yNeck) * 0.45,
        cx + nw,
        yNeck
      );
      ctx.lineTo(cx + nw, yTop);
      ctx.closePath();
    };

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1. 3/4 斜俯视桌面椭圆柔和落影
    ctx.fillStyle = 'rgba(34, 20, 8, 0.18)';
    ctx.beginPath();
    ctx.ellipse(cx, bodyBotCy + 1.8, bellyHalfW * 0.96, bottomRy * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. 清透有色水晶药剂玻璃体（与鲜艳彩沙同步：仅微量玻璃冷光混合）
    const bodyGrad = ctx.createLinearGradient(cx - bellyHalfW, mouthCy, cx + bellyHalfW, baseY);
    bodyGrad.addColorStop(0, mixHex(shades.highlightHex, '#F4FBFF', 0.12));
    bodyGrad.addColorStop(0.5, mixHex(shades.baseHex, '#DCEFFA', 0.06));
    bodyGrad.addColorStop(1, mixHex(shades.shadowHex, '#C5E2F4', 0.04));

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = bodyGrad;
    traceBody(0);
    ctx.fill();
    ctx.restore();

    // 2b. 3/4 俯视透过空瓶清晰可见的【立体椭圆厚玻璃内底盘与内腔壁】
    const innerRx = bellyHalfW - wallThick;
    const innerBotRy = Math.max(3.0, innerRx * 0.34);
    const innerBotCy = bodyBotCy - wallThick * 0.85;
    ctx.save();
    ctx.fillStyle = mixHex(shades.highlightHex, '#FFFFFF', 0.3);
    ctx.globalAlpha = 0.22;
    traceBody(wallThick);
    ctx.fill();

    // 透视瓶底内凹玻璃椭圆环
    ctx.globalAlpha = 0.50;
    ctx.fillStyle = mixHex(shades.baseHex, '#FFFFFF', 0.18);
    ctx.strokeStyle = mixHex(shades.shadowHex, '#3D5468', 0.28);
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.ellipse(cx, innerBotCy, innerRx * 0.92, innerBotRy * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 瓶肩 3/4 俯视柔和前弧反光线
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.ellipse(cx, shoulderBotY + 1, innerRx * 0.86, innerBotRy * 0.72, 0, Math.PI * 0.12, Math.PI * 0.88);
    ctx.stroke();
    ctx.restore();

    // 3. 接沙态瓶内彩沙柱与饱满 3D 椭圆液面（候选列空瓶 fillRatio=0 不绘沙柱）
    if (opts.fillRatio > 0.008 || opts.isPouringInto) {
      ctx.save();
      traceBody(wallThick);
      ctx.clip();

      const usableH = Math.max(10, innerBotCy - (shoulderBotY - 1));
      const clampedFill = Math.min(1, Math.max(0, opts.fillRatio));
      const sandTopCy = innerBotCy - usableH * clampedFill;
      const ripple = opts.isPouringInto ? Math.sin(timeSec * 19) * 1.0 : 0;

      if (opts.isPouringInto) {
        const innerStreamGrad = ctx.createLinearGradient(cx, mouthCy, cx, sandTopCy);
        innerStreamGrad.addColorStop(0, '#FFFDF6');
        innerStreamGrad.addColorStop(0.45, shades.highlightHex);
        innerStreamGrad.addColorStop(1, shades.baseHex);
        ctx.strokeStyle = innerStreamGrad;
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.moveTo(cx, mouthCy + 2);
        ctx.lineTo(cx + ripple * 0.35, Math.min(innerBotCy, sandTopCy + 1.5));
        ctx.stroke();
      }

      if (clampedFill > 0.008) {
        const sGrad = ctx.createLinearGradient(cx - innerRx, sandTopCy, cx + innerRx, innerBotCy + innerBotRy);
        sGrad.addColorStop(0, shades.highlightHex);
        sGrad.addColorStop(0.48, shades.baseHex);
        sGrad.addColorStop(1, shades.shadowHex);
        ctx.fillStyle = sGrad;
        ctx.beginPath();
        ctx.moveTo(cx - innerRx - 1, sandTopCy);
        ctx.lineTo(cx - innerRx - 1, innerBotCy);
        ctx.ellipse(cx, innerBotCy, innerRx + 1, innerBotRy + 0.5, 0, Math.PI, 0, true);
        ctx.lineTo(cx + innerRx + 1, sandTopCy);
        ctx.closePath();
        ctx.fill();

        // 3/4 斜俯视饱满立体椭圆沙面
        const meniscusRx = Math.max(4.5, innerRx - 0.3);
        const meniscusRy = Math.max(3.2, meniscusRx * 0.34);
        ctx.fillStyle = mixHex(shades.highlightHex, '#FFFFFF', 0.08);
        ctx.strokeStyle = mixHex(shades.shadowHex, '#5E4230', 0.22);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.ellipse(cx, sandTopCy + ripple * 0.45, meniscusRx, meniscusRy, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (opts.isPouringInto) {
          const ripPhase = (timeSec * 3.4) % 1;
          ctx.strokeStyle = `rgba(255, 253, 244, ${(0.72 * (1 - ripPhase)).toFixed(3)})`;
          ctx.lineWidth = 1.05;
          ctx.beginPath();
          ctx.ellipse(
            cx,
            sandTopCy + ripple * 0.45,
            meniscusRx * (0.22 + 0.68 * ripPhase),
            meniscusRy * (0.22 + 0.68 * ripPhase),
            0,
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 4. 瓶身手绘细墨轮廓与左右玻璃壁折射高光丝
    ctx.strokeStyle = ink;
    ctx.lineWidth = opts.highlightActive ? 1.5 : 1.35;
    traceBody(0);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.80)';
    ctx.lineWidth = Math.max(1.5, w * 0.045);
    ctx.beginPath();
    ctx.moveTo(cx - bellyHalfW + wallThick * 0.72, shoulderBotY + 2);
    ctx.lineTo(cx - bellyHalfW + wallThick * 0.72, bodyBotCy - 1);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.46)';
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.moveTo(cx + bellyHalfW - wallThick * 0.72, shoulderBotY + 3);
    ctx.lineTo(cx + bellyHalfW - wallThick * 0.72, bodyBotCy - 2);
    ctx.stroke();

    // 5. 3/4 斜俯视立体双层椭圆瓶口领圈（满瓶离场态插入立体软木塞，接沙/候选正放态显露敞口内孔）
    const collarFill = mixHex(shades.highlightHex, '#F2FAFF', 0.2);
    const collarSide = mixHex(shades.baseHex, '#C8E2F2', 0.12);

    // 下层护颈椭圆环
    ctx.fillStyle = collarSide;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.ellipse(cx, mouthCy + lipRy * 1.15, lipHalfW * 0.88, lipRy * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 上层厚玻璃瓶唇侧壁与椭圆顶面
    const rimThick = 2.6;
    ctx.fillStyle = collarSide;
    ctx.beginPath();
    ctx.ellipse(cx, mouthCy + rimThick, lipHalfW, lipRy, 0, 0, Math.PI);
    ctx.lineTo(cx - lipHalfW, mouthCy);
    ctx.ellipse(cx, mouthCy, lipHalfW, lipRy, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = collarFill;
    ctx.beginPath();
    ctx.ellipse(cx, mouthCy, lipHalfW, lipRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (opts.hasCork) {
      const dropY = opts.corkDropOffset || 0;
      const corkTopW = neckHalfW * 1.56;
      const corkBotW = neckHalfW * 1.32;
      const corkBotY = mouthCy + 0.8 - dropY;
      const corkTopY = corkBotY - Math.max(6.2, h * 0.115);
      const corkRy = corkTopW * 0.34 * 0.5;

      const cGrad = ctx.createLinearGradient(cx - corkTopW * 0.5, corkTopY, cx + corkTopW * 0.5, corkBotY);
      cGrad.addColorStop(0, '#D8A775');
      cGrad.addColorStop(0.55, '#B98350');
      cGrad.addColorStop(1, '#986638');
      ctx.fillStyle = cGrad;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx - corkTopW * 0.5, corkTopY);
      ctx.lineTo(cx - corkBotW * 0.5, corkBotY);
      ctx.ellipse(cx, corkBotY, corkBotW * 0.5, corkRy * 0.9, 0, Math.PI, 0, true);
      ctx.lineTo(cx + corkTopW * 0.5, corkTopY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#E5B98A';
      ctx.beginPath();
      ctx.ellipse(cx, corkTopY, corkTopW * 0.5, corkRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // 3/4 斜俯视清晰敞口椭圆深孔
      ctx.fillStyle = opts.isPouringInto
        ? mixHex(shades.highlightHex, '#FFFFFF', 0.15)
        : mixHex(shades.shadowHex, '#263B52', 0.36);
      ctx.strokeStyle = 'rgba(56, 36, 23, 0.62)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.ellipse(cx, mouthCy + 0.2, lipHalfW * 0.64, Math.max(1.8, lipRy * 0.62), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 6. 瓶颈饱满双耳蝴蝶结 + 长弧双飘带
    this.drawBottleRibbonBow(ctx, cx, neckBotY + 0.5, w, h, neckHalfW, shades, false);

    ctx.restore();
  }

  /**
   * 3/4 斜俯视【倒扣放置】空玻璃瓶（用于候选列 r >= 1 下方不可用空瓶）：
   * - 瓶口双层玻璃领圈平贴实木桌面（底部带贴桌椭圆投影与倒系丝带）
   * - 瓶底朝上正对 3/4 俯视镜头，清晰呈现立体椭圆厚玻璃瓶底面与内凹玻璃圈（一眼看出“倒扣在桌面”）
   * - 未揭晓 mystery 瓶呈燕麦奶油雾面磨砂质感并印有手绘「?」
   */
  private drawObliqueUpsideDownBottle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
    w: number,
    h: number,
    shades: SandColorShades,
    tokens: UiTokensFile,
    isMystery: boolean
  ): void {
    const ink = '#382417';
    const bellyHalfW = w * 0.445;
    const topDomeApexY = baseY - h + 1.2; // 朝上的圆润实心玻璃瓶底最高点
    const topArcSag = Math.max(3.6, bellyHalfW * 0.24);
    const heelR = Math.max(5.2, w * 0.135); // 瓶底左右圆润倒角半径（彻底消除敞口杯错觉）

    const lipHalfW = w * 0.305;
    const lipRy = Math.max(3.0, lipHalfW * 0.35);
    const mouthFloorCy = baseY - lipRy - 0.5; // 平贴在实木桌面上的倒扣瓶口中心
    const neckHalfW = w * 0.23;
    const neckTopY = mouthFloorCy - 1.6 - h * 0.072;
    const shoulderTopY = neckTopY - h * 0.148;
    const wallThick = Math.max(2.1, w * 0.056);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1. 倒扣瓶口与瓶身投在实木桌面上的 3/4 斜俯视椭圆落影
    ctx.fillStyle = 'rgba(36, 20, 8, 0.20)';
    ctx.beginPath();
    ctx.ellipse(cx, mouthFloorCy + 1.6, bellyHalfW * 0.82, lipRy * 1.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. 先绘制平贴在桌面上的倒扣厚玻璃卷边瓶口（双层领圈朝下压在木桌面上）
    const collarFill = isMystery ? '#EFE6D5' : mixHex(shades.highlightHex, '#E8F6FF', 0.18);
    const collarSide = isMystery ? '#D6C7AE' : mixHex(shades.baseHex, '#BFDDF0', 0.12);

    // 贴桌最底外卷唇
    ctx.fillStyle = collarSide;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.ellipse(cx, mouthFloorCy + 1.0, lipHalfW, lipRy, 0, 0, Math.PI);
    ctx.lineTo(cx - lipHalfW, mouthFloorCy - 1.4);
    ctx.ellipse(cx, mouthFloorCy - 1.4, lipHalfW, lipRy, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = collarFill;
    ctx.beginPath();
    ctx.ellipse(cx, mouthFloorCy - 1.4, lipHalfW, lipRy * 0.90, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 紧贴上方的护颈细环（倒置）
    ctx.fillStyle = collarSide;
    ctx.beginPath();
    ctx.ellipse(cx, mouthFloorCy - 3.3, lipHalfW * 0.84, lipRy * 0.76, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 透过倒扣瓶口隐约可见贴木桌面的瓶口内孔暗影
    if (!isMystery) {
      ctx.fillStyle = 'rgba(68, 42, 20, 0.22)';
      ctx.beginPath();
      ctx.ellipse(cx, mouthFloorCy - 0.8, lipHalfW * 0.56, lipRy * 0.50, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. 倒扣药剂瓶主体外轮廓（顶部为圆润厚实玻璃瓶底倒角拱顶，绝不在顶部画深色全椭圆杯口线！）
    const traceInvertedBody = (inset = 0) => {
      const nw = Math.max(3.0, neckHalfW - inset * 0.65);
      const bw = Math.max(5.5, bellyHalfW - inset);
      const hr = Math.max(2.6, heelR - inset * 0.55);
      const yBot = mouthFloorCy - 2.6 - inset * 0.25;
      const yNeck = neckTopY - inset * 0.12;
      const ySh = shoulderTopY - inset * 0.12;
      const yApex = topDomeApexY + inset * 1.15;
      const yWallTop = yApex + topArcSag + hr * 0.55;

      ctx.beginPath();
      ctx.moveTo(cx - nw, yBot);
      ctx.lineTo(cx - nw, yNeck);
      // 倒置瓶肩（由下窄瓶颈向上平滑外扩至宽圆瓶腹）
      ctx.bezierCurveTo(
        cx - nw,
        yNeck - (yNeck - ySh) * 0.46,
        cx - bw,
        ySh + (yNeck - ySh) * 0.46,
        cx - bw,
        ySh
      );
      // 左侧竖直玻璃瓶腹壁
      ctx.lineTo(cx - bw, yWallTop);
      // 左上圆润瓶底倒角 -> 3/4 俯视微拱实心瓶底顶弧 -> 右上圆润瓶底倒角
      ctx.quadraticCurveTo(cx - bw, yApex + topArcSag * 0.32, cx - bw + hr, yApex + topArcSag * 0.16);
      ctx.quadraticCurveTo(cx, yApex - topArcSag * 0.18, cx + bw - hr, yApex + topArcSag * 0.16);
      ctx.quadraticCurveTo(cx + bw, yApex + topArcSag * 0.32, cx + bw, yWallTop);
      // 右侧竖直玻璃瓶腹壁
      ctx.lineTo(cx + bw, ySh);
      ctx.bezierCurveTo(
        cx + bw,
        ySh + (yNeck - ySh) * 0.46,
        cx + nw,
        yNeck - (yNeck - ySh) * 0.46,
        cx + nw,
        yNeck
      );
      ctx.lineTo(cx + nw, yBot);
      ctx.closePath();
    };

    const bodyGrad = ctx.createLinearGradient(cx - bellyHalfW, topDomeApexY, cx + bellyHalfW, mouthFloorCy);
    if (isMystery) {
      bodyGrad.addColorStop(0, '#F7F0E2');
      bodyGrad.addColorStop(0.52, '#E5D7BE');
      bodyGrad.addColorStop(1, '#D1C0A2');
    } else {
      bodyGrad.addColorStop(0, mixHex(shades.highlightHex, '#F2FAFF', 0.12));
      bodyGrad.addColorStop(0.52, mixHex(shades.baseHex, '#D8EEFC', 0.06));
      bodyGrad.addColorStop(1, mixHex(shades.shadowHex, '#BEDCF0', 0.04));
    }

    ctx.save();
    if (!isMystery) {
      ctx.globalAlpha = 0.9;
    }
    ctx.fillStyle = bodyGrad;
    traceInvertedBody(0);
    ctx.fill();
    ctx.restore();

    // 4. 顶部朝上的【厚实水晶玻璃瓶底块（Solid Glass Base Slab）】与柔和折射高光（无黑线割裂！）
    ctx.save();
    traceInvertedBody(0);
    ctx.clip();

    const slabCenterY = topDomeApexY + topArcSag * 0.72;
    const slabRy = Math.max(3.6, bellyHalfW * 0.26);

    // 实心厚瓶底高折射亮色层
    ctx.fillStyle = isMystery
      ? 'rgba(255, 251, 242, 0.58)'
      : mixHex(shades.highlightHex, '#FFFFFF', 0.32);
    ctx.globalAlpha = isMystery ? 0.65 : 0.46;
    ctx.beginPath();
    ctx.ellipse(cx, slabCenterY - 1.2, bellyHalfW * 0.96, slabRy * 1.28, 0, 0, Math.PI * 2);
    ctx.fill();

    // 瓶底内凹圆润浅窝（Punt Dimple，仅用柔和半透明玻璃色，不画深色硬边）
    ctx.globalAlpha = isMystery ? 0.36 : 0.42;
    ctx.fillStyle = isMystery ? '#C9B89A' : mixHex(shades.shadowHex, '#FFFFFF', 0.08);
    ctx.beginPath();
    ctx.ellipse(cx, slabCenterY - 1.6, bellyHalfW * 0.46, slabRy * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3/4 俯视瓶底前缘柔和白高光弧线（表现圆润玻璃底转折面）
    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.ellipse(cx, slabCenterY + 1.0, bellyHalfW * 0.84, slabRy * 0.78, 0, Math.PI * 0.12, Math.PI * 0.88);
    ctx.stroke();

    if (!isMystery) {
      // 清透内腔壁与下方倒置收肩透视反光弧
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = mixHex(shades.highlightHex, '#FFFFFF', 0.3);
      traceInvertedBody(wallThick);
      ctx.fill();

      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.ellipse(
        cx,
        shoulderTopY - 0.5,
        (bellyHalfW - wallThick) * 0.86,
        slabRy * 0.68,
        0,
        Math.PI * 0.14,
        Math.PI * 0.86
      );
      ctx.stroke();
    }
    ctx.restore();

    // 5. 外轮廓手绘墨线（仅勾勒平滑圆顶瓶身外缘）与左右玻璃壁竖高光丝 / 盲盒「?」
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    traceInvertedBody(0);
    ctx.stroke();

    if (!isMystery) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.lineWidth = Math.max(1.4, w * 0.044);
      ctx.beginPath();
      ctx.moveTo(cx - bellyHalfW + wallThick * 0.72, topDomeApexY + topArcSag + heelR * 0.45);
      ctx.lineTo(cx - bellyHalfW + wallThick * 0.72, shoulderTopY - 1.2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.44)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(cx + bellyHalfW - wallThick * 0.72, topDomeApexY + topArcSag + heelR * 0.55);
      ctx.lineTo(cx + bellyHalfW - wallThick * 0.72, shoulderTopY - 2.0);
      ctx.stroke();
    } else {
      const qY = topDomeApexY + (shoulderTopY - topDomeApexY) * 0.56;
      drawInkText(ctx, '?', cx, qY, tokens, {
        font: `700 ${Math.max(13, Math.round(h * 0.33))}px ${tokens.typography.numeralFontFamily}`,
        color: '#4E3926',
        boldStrokeWidth: 0.35,
        embossColor: 'rgba(255,255,255,0.45)',
      });
    }

    // 6. 已揭晓倒扣瓶在下方贴桌瓶颈处系有小巧同色蝴蝶结（短飘带自然垂搭在桌面瓶口两侧）
    if (!isMystery) {
      this.drawBottleRibbonBow(ctx, cx, neckTopY + 1.5, w * 0.88, h * 0.56, neckHalfW, shades, true);
    }

    ctx.restore();
  }

  private drawBottleRibbonBow(
    ctx: CanvasRenderingContext2D,
    cx: number,
    bowY: number,
    w: number,
    h: number,
    neckHalfW: number,
    shades: SandColorShades,
    compactInverted: boolean
  ): void {
    const ink = '#382417';
    const ribBase = shades.baseHex;
    const ribHi = mixHex(shades.highlightHex, '#FFFFFF', 0.1);
    const ribDark = mixHex(shades.shadowHex, '#382417', 0.14);
    const loopW = Math.max(6.8, w * (compactInverted ? 0.26 : 0.30));
    const loopH = Math.max(4.0, h * (compactInverted ? 0.078 : 0.088));
    const tailLen = compactInverted ? Math.max(6.5, h * 0.12) : Math.max(10.5, h * 0.22);

    ctx.fillStyle = ribBase;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    roundRectPath(ctx, cx - neckHalfW - 0.8, bowY - 1.5, (neckHalfW + 0.8) * 2, 3.0, 1.4);
    ctx.fill();
    ctx.stroke();

    const tailGrad = ctx.createLinearGradient(cx, bowY, cx, bowY + tailLen);
    tailGrad.addColorStop(0, ribHi);
    tailGrad.addColorStop(1, ribBase);
    ctx.fillStyle = tailGrad;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + dir * 1.1, bowY + 0.7);
      ctx.bezierCurveTo(
        cx + dir * (loopW * 0.52),
        bowY + tailLen * 0.35,
        cx + dir * (loopW * 0.72),
        bowY + tailLen * 0.72,
        cx + dir * (loopW * 0.56),
        bowY + tailLen
      );
      ctx.lineTo(cx + dir * (loopW * 0.22), bowY + tailLen * 0.88);
      ctx.bezierCurveTo(
        cx + dir * (loopW * 0.30),
        bowY + tailLen * 0.56,
        cx + dir * (loopW * 0.16),
        bowY + tailLen * 0.28,
        cx + dir * 0.2,
        bowY + 1.1
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    const bowGrad = ctx.createLinearGradient(cx, bowY - loopH, cx, bowY + loopH);
    bowGrad.addColorStop(0, ribHi);
    bowGrad.addColorStop(0.58, ribBase);
    bowGrad.addColorStop(1, ribDark);
    ctx.fillStyle = bowGrad;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx, bowY);
      ctx.bezierCurveTo(
        cx + dir * (loopW * 0.45),
        bowY - loopH * 1.26,
        cx + dir * (loopW * 1.16),
        bowY - loopH * 0.76,
        cx + dir * (loopW * 1.0),
        bowY + loopH * 0.18
      );
      ctx.bezierCurveTo(
        cx + dir * (loopW * 0.86),
        bowY + loopH * 1.02,
        cx + dir * (loopW * 0.36),
        bowY + loopH * 0.76,
        cx,
        bowY + 0.65
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx + dir * 2.0, bowY + 0.1);
      ctx.quadraticCurveTo(cx + dir * (loopW * 0.44), bowY - loopH * 0.14, cx + dir * (loopW * 0.64), bowY + 0.35);
      ctx.stroke();
    }

    ctx.fillStyle = ribHi;
    ctx.beginPath();
    roundRectPath(ctx, cx - 2.1, bowY - 1.9, 4.2, 3.9, 1.7);
    ctx.fill();
    ctx.stroke();
  }

  /**
   * 宽出细入柔光漏斗 S 曲线流沙束
   */
  private renderPouringSandStream(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    engine: SandEngine,
    sandRenderer: SandRenderer,
    slotIdx: number,
    sourceGridX: number,
    cid: SandColorId,
    tStart: number,
    tEnd: number,
    endX: number,
    endY: number,
    timeSec: number,
    rainbowDrain: boolean
  ): void {
    const t0 = Math.max(0, Math.min(0.95, tStart));
    const t1 = Math.max(t0 + 0.04, Math.min(1, tEnd));
    if (t1 - t0 <= 0.03) return;

    const ch = layout.chamberRect;
    const shakeY = engine.screenShakeMs > 0 ? Math.sin(engine.frame * 1.8) * 3 : 0;
    const spoutX = ch.x + ch.w * (Math.max(24, Math.min(125, sourceGridX)) / GW);
    const spoutY = ch.y + shakeY + ch.h * (163.6 / GH);

    const dy = Math.max(14, endY - spoutY);
    const dx = endX - spoutX;
    const sInflect = Math.abs(dx) < 28 ? (slotIdx <= 1 ? 16 : -16) * (1 - Math.abs(dx) / 36) : 0;
    const breeze = Math.sin(timeSec * 4.4 + slotIdx * 1.9) * 3.6;
    const c1x = spoutX + sInflect + breeze * 0.6;
    const c1y = spoutY + dy * 0.52;
    const c2x = endX - sInflect * 0.7 + breeze * 0.3;
    const c2y = spoutY + dy * 0.42;
    const targetY = endY + 2.0;

    const shades = sandRenderer.getSandShades(cid);
    const baseHue = (timeSec * 220) % 360;
    const glowHex = rainbowDrain ? `hsl(${baseHue}, 90%, 72%)` : shades.baseHex;
    const midHex = rainbowDrain ? `hsl(${(baseHue + 50) % 360}, 92%, 82%)` : shades.highlightHex;
    const coreHex = rainbowDrain ? '#FFFDF5' : mixHex(shades.highlightHex, '#FFFDF4', 0.3);

    const evalPoint = (t: number): [number, number] => {
      const u = 1 - t;
      return [
        u * u * u * spoutX + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * endX,
        u * u * u * spoutY + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * targetY,
      ];
    };

    const evalTangent = (t: number): [number, number] => {
      const u = 1 - t;
      const tx =
        3 * u * u * (c1x - spoutX) + 6 * u * t * (c2x - c1x) + 3 * t * t * (endX - c2x);
      const ty =
        3 * u * u * (c1y - spoutY) + 6 * u * t * (c2y - c1y) + 3 * t * t * (targetY - c2y);
      const len = Math.hypot(tx, ty) || 1;
      return [tx / len, ty / len];
    };

    const steps = 16;
    const halfWidths: number[] = [];

    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = t0 + (t1 - t0) * u;
      const funnelHalfW = Math.pow(1 - t, 1.25) * 8.6 + 1.55;
      const tipCap =
        (t0 > 0.02 && i < 3 ? (i + 0.5) / 3 : 1) *
        (t1 < 0.98 && i > steps - 3 ? (steps - i + 0.5) / 3 : 1);
      halfWidths.push(funnelHalfW * tipCap);
    }

    const traceTaperedRibbon = (widthScale: number) => {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const t = t0 + (t1 - t0) * u;
        const [px, py] = evalPoint(t);
        const [tx, ty] = evalTangent(t);
        const hw = halfWidths[i] * widthScale;
        const lx = px - ty * hw;
        const ly = py + tx * hw;
        if (i === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      }
      for (let i = steps; i >= 0; i--) {
        const u = i / steps;
        const t = t0 + (t1 - t0) * u;
        const [px, py] = evalPoint(t);
        const [tx, ty] = evalTangent(t);
        const hw = halfWidths[i] * widthScale;
        const rx = px + ty * hw;
        const ry = py - tx * hw;
        ctx.lineTo(rx, ry);
      }
      ctx.closePath();
    };

    const visAlpha = Math.min(1, (t1 - t0) * 2.2);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (t0 < 0.14) {
      const [mergeX, mergeY] = evalPoint(Math.min(t1, 0.20));
      const spoutFade = (1 - t0 / 0.14) * visAlpha;
      ctx.strokeStyle = midHex;
      ctx.lineWidth = 2.6;
      for (const slitOff of [-7.5, -2.5, 2.5, 7.5]) {
        ctx.globalAlpha = 0.42 * spoutFade;
        ctx.beginPath();
        ctx.moveTo(spoutX + slitOff, spoutY - 0.5);
        ctx.quadraticCurveTo(
          spoutX + slitOff * 0.45,
          spoutY + (mergeY - spoutY) * 0.55,
          mergeX,
          mergeY
        );
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 0.28 * visAlpha;
    ctx.fillStyle = glowHex;
    traceTaperedRibbon(1.82);
    ctx.fill();

    const midGrad = ctx.createLinearGradient(spoutX, spoutY, endX, targetY);
    midGrad.addColorStop(0, glowHex);
    midGrad.addColorStop(0.5, midHex);
    midGrad.addColorStop(1, shades.baseHex);
    ctx.globalAlpha = 0.68 * visAlpha;
    ctx.fillStyle = midGrad;
    traceTaperedRibbon(1.06);
    ctx.fill();

    const coreGrad = ctx.createLinearGradient(spoutX, spoutY, endX, targetY);
    coreGrad.addColorStop(0, midHex);
    coreGrad.addColorStop(0.5, coreHex);
    coreGrad.addColorStop(1, '#FFFDF6');
    ctx.globalAlpha = 0.86 * visAlpha;
    ctx.fillStyle = coreGrad;
    traceTaperedRibbon(0.38);
    ctx.fill();

    for (let k = 0; k < 26; k++) {
      const phase = ((k / 26) + timeSec * 2.5 + (k % 5) * 0.04) % 1;
      const t = Math.pow(phase, 1.2);
      if (t < t0 || t > t1) continue;

      const [bx, by] = evalPoint(t);
      const [tx, ty] = evalTangent(t);
      const funnelSpread = (Math.pow(1 - t, 1.15) * 6.8 + 0.6) * Math.sin(Math.min(1, (t - t0) * 6) * Math.PI * 0.5);
      const lat = Math.sin(k * 19.7 + timeSec * 8.2) * funnelSpread;
      const px = bx - ty * lat;
      const py = by + tx * lat;
      const r = (k % 4 === 0 ? 1.45 : 0.95) * (1 - t * 0.22);

      ctx.globalAlpha = (0.52 + 0.42 * (1 - t * 0.3)) * visAlpha;
      ctx.fillStyle = k % 2 === 0 ? '#FFFDF6' : midHex;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * 底部四枚日系和纸圆角方卡道具钮
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
        medallion: canUndo ? `${engine.snapshots.depth}` : '',
        medallionVariant: canUndo ? 'wood' : 'muted',
      },
      {
        glyph: 'magnet',
        disabled: !canMagnet,
        pulse: jamPulse && canMagnet,
        medallion: magLeft < 3 ? String(magLeft) : '',
        medallionVariant: magLeft === 0 ? 'muted' : jamPulse && canMagnet ? 'amber' : 'wood',
      },
      {
        glyph: 'extra_slot',
        disabled: !canExtraSlot && !fifthActive,
        pulse: jamPulse && canExtraSlot,
        medallion: fifthActive ? '✓' : '+',
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
          radius: 13,
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
        radius: 13,
        pressed: isPressed,
        disabled: sp.disabled,
        pulse: sp.pulse,
        pulsePhase,
        medallionText: sp.medallion || undefined,
        medallionVariant: sp.medallionVariant,
        medallionRadius: 8.2,
      });

      ctx.save();
      if (sp.disabled) {
        ctx.globalAlpha = 0.54;
      }
      const iconSize = Math.min(31, inner.h * 0.72);
      drawHandDrawnGlyph(
        ctx,
        sp.glyph,
        inner.x + inner.w * 0.5,
        inner.y + inner.h * 0.5 + 0.4,
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
      color: '#382417',
    });

    this.deadlockSlotBtnRect = null;
    this.deadlockMagnetBtnRect = null;
    this.deadlockUndoBtnRect = { x: 0, y: 0, w: 0, h: 0 };

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
      color: '#382417',
    });

    const bw = 118;
    this.confirmCancelRect = { x: panel.x + 22, y: panel.y + ph - 58, w: bw, h: 40 };
    this.confirmOkRect = { x: panel.x + pw - 22 - bw, y: panel.y + ph - 58, w: bw, h: 40 };

    drawWoodButton(ctx, this.confirmCancelRect, '继续', tokens, assets, { fillHex: '#1F7A44', fontSize: 13.5 });
    drawWoodButton(ctx, this.confirmOkRect, '重玩', tokens, assets, { glyph: 'restart', fontSize: 13.5 });
  }
}
