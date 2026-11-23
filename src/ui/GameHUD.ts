import type { BucketRuntime } from '../engine/BucketSystem';
import type { SandEngine } from '../engine/SandEngine';
import type { SandColorShades, SandRenderer } from '../engine/SandRenderer';
import { GH, GW } from '../engine/SandGrid';
import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { RewardManager } from '../systems/RewardManager';
import type { SandColorId } from '../types/level';
import type { Rect, UiTokensFile } from '../types/ui';
import { computeCandidateTroughMetrics } from './FtueOverlay';
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
  | { type: 'BACK_ROW_BLOCKED'; colIdx: number }
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

function mixHex(hexA: string, hexB: string, t: number): string {
  const pa = parseInt(hexA.replace('#', ''), 16);
  const pb = parseInt(hexB.replace('#', ''), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const b = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * 1:1 严格还原日系手绘绘本风《局内主界面.webp》设计稿：
 * 1. 顶栏：和纸圆角胶囊 [⊞ 08] + 浅桦木手绘圆钮 [?] [↻]
 * 2. 流沙入瓶：宽出细入的漏斗状柔光 S 曲线沙带（带起止生长/收尾过渡与入瓶涟漪）
 * 3. 接沙位（4+1）：同色陶瓷圆杯托 + 修长双层领圈有色玻璃药剂瓶（饱满双耳长飘带蝴蝶结）+ 满瓶封塞弧线离场动画
 * 4. 候选木槽（最多显露 3 只）：短巧透视暖木凹槽（第 3 只瓶塞微露槽后沿），严格前排顺序限制（仅最前排高亮可取，误触后排摇动提示）
 * 5. 底栏道具：4 枚日系和纸圆角方卡（纤巧 C 形撤回、左上开口 -44° U 形磁铁、鼠尾草绿 + 药剂瓶、穿插断口双 S 洗牌）
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
  private deadlockUndoBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 } as unknown as Rect;
  private deadlockRestartBtnRect: Rect = { x: 0, y: 0, w: 140, h: 40 };

  private trackedSignature = '';
  private seenDoneSet = new Set<number>();
  private lastKnownSlotPos = new Map<
    number,
    { slotIdx: number; x: number; y: number; w: number; h: number }
  >();
  private lastKnownFrontPos = new Map<
    number,
    { colIdx: number; x: number; y: number; w: number; h: number }
  >();

  private flyingDispatches: FlyingDispatchBottle[] = [];
  private completedGhosts: CompletedBottleGhost[] = [];

  /** 平滑插值显示槽内彩沙液面高度（0..1）与落地弹性缩放 */
  private smoothSlotFill: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  private smoothSlotBottleIdx: [number, number, number, number, number] = [-1, -1, -1, -1, -1];
  private slotLandBounceMs: [number, number, number, number, number] = [0, 0, 0, 0, 0];

  /** 流沙光带首尾生长/收尾状态（消除光带瞬间闪现与瞬断生硬感） */
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

  /** 候选列派走前排瓶时的顺移过渡 & 误点后排摇晃反馈 */
  private prevColLengths: number[] = [0, 0, 0, 0];
  private colSlideAnim: number[] = [0, 0, 0, 0];
  private backRowShakeMs: number[] = [0, 0, 0, 0];
  private frontOrderHintMs: number[] = [0, 0, 0, 0];

  public setMechanicBanner(text: string | null): void {
    this.mechanicBannerText = text;
    this.mechanicBannerTimerMs = text ? 3600 : 0;
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
        this.colSlideAnim[c] = Math.max(0, this.colSlideAnim[c] - safeDt / 240);
      }
      if (this.backRowShakeMs[c] > 0) {
        this.backRowShakeMs[c] = Math.max(0, this.backRowShakeMs[c] - safeDt);
      }
      if (this.frontOrderHintMs[c] > 0) {
        this.frontOrderHintMs[c] = Math.max(0, this.frontOrderHintMs[c] - safeDt);
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
    const coasterY = sr.y + sr.h - 7.5;
    const bh = Math.min(64, Math.round(sr.h * 0.91));
    const bw = Math.min(38, Math.round(bh * 0.575));
    const cx = sr.x + sr.w * 0.5;
    return {
      cx,
      coasterY,
      bw,
      bh,
      mouthY: coasterY - 1.5 - bh + 2.5,
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

    // 候选瓶区：严格执行“仅最前排瓶（Row 0）可点选使用”，点按后排瓶触发摇晃与顺序引导
    const expandedCandArea: Rect = {
      x: layout.candidateAreaRect.x - 6,
      y: layout.candidateAreaRect.y - 4,
      w: layout.candidateAreaRect.w + 12,
      h: layout.candidateAreaRect.h + 10,
    };
    if (hitRect(px, py, expandedCandArea) && !engine.won) {
      const numCols = engine.bucketSys.numCols;
      for (let c = 0; c < numCols; c++) {
        const col = engine.bucketSys.columns[c] || [];
        if (col.length === 0) continue;
        const tm = computeCandidateTroughMetrics(layout, c, numCols);
        if (hitRect(px, py, tm.frontHitRect) || (col.length === 1 && hitRect(px, py, tm.colRect))) {
          return { type: 'DISPATCH_COL', colIdx: c };
        }
        if (col.length > 1 && hitRect(px, py, tm.rearHitRect)) {
          this.backRowShakeMs[c] = 320;
          this.frontOrderHintMs[c] = 800;
          return { type: 'BACK_ROW_BLOCKED', colIdx: c };
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
    // 2. 温暖实木工作台 + 4+1 圆盘接沙位 + 3 瓶透视木凹槽 + 漏斗流沙光带 & 进出槽动画
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
      this.lastKnownFrontPos.clear();
      this.flyingDispatches = [];
      this.completedGhosts = [];
      this.smoothSlotFill = [0, 0, 0, 0, 0];
      this.smoothSlotBottleIdx = [-1, -1, -1, -1, -1];
      this.slotLandBounceMs = [0, 0, 0, 0, 0];
      this.streamActive = [false, false, false, false, false];
      this.streamHead = [0, 0, 0, 0, 0];
      this.streamTail = [0, 0, 0, 0, 0];
      for (let c = 0; c < 4; c++) {
        this.prevColLengths[c] = engine.bucketSys.columns[c]?.length || 0;
        this.colSlideAnim[c] = 0;
        this.backRowShakeMs[c] = 0;
        this.frontOrderHintMs[c] = 0;
      }
    }

    const numCols = engine.bucketSys.numCols;
    for (let c = 0; c < numCols; c++) {
      const col = engine.bucketSys.columns[c] || [];
      const curLen = col.length;
      if (curLen < this.prevColLengths[c]) {
        this.colSlideAnim[c] = 1.0;
      }
      this.prevColLengths[c] = curLen;
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

          // 若该瓶刚从下方木槽最前排被点选派出，触发抛物拔塞飞入杯托动画
          const origin = this.lastKnownFrontPos.get(bk.idx);
          if (origin && engine.frame > 2) {
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
              durationMs: 225,
            });
          }
        } else {
          this.smoothSlotFill[s] += (targetRatio - this.smoothSlotFill[s]) * 0.24;
        }

        this.lastKnownSlotPos.set(bk.idx, {
          slotIdx: s,
          x: sg.cx,
          y: sg.coasterY - 1.5,
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

    // 2. 记录当前各木槽最前排瓶坐标，供下一帧点选飞入杯托动画作为起点
    for (let c = 0; c < numCols; c++) {
      const frontBk = engine.bucketSys.columns[c]?.[0];
      if (frontBk && !frontBk.done) {
        const tm = computeCandidateTroughMetrics(layout, c, numCols);
        this.lastKnownFrontPos.set(frontBk.idx, {
          colIdx: c,
          x: tm.colRect.x + tm.colRect.w * 0.5,
          y: tm.frontBaseY,
          w: tm.frontW,
          h: tm.frontH,
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
          y: layout.slotRowRect.y + layout.slotRowRect.h - 9,
          w: 37,
          h: 63,
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
    // 实木桌面后沿恰好穿过接沙瓶中下腹，让修长瓶颈、蝴蝶结与双层领圈清透立于星夜背景中
    const tableBackY = Math.round(layout.slotRowRect.y + layout.slotRowRect.h * 0.50);
    const tableFrontY = layout.propRowRect.y - 7;

    this.syncWorkbenchAnimations(layout, engine);

    // ========================================================================
    // 1. 绘制日系温润浅桦木实木工作台 + 前沿木桌边 + 桌下深可可暗影栏
    // ========================================================================
    ctx.save();

    const woodGrad = ctx.createLinearGradient(0, tableBackY, 0, tableFrontY);
    woodGrad.addColorStop(0, '#DFBA8B');
    woodGrad.addColorStop(0.55, '#D2A875');
    woodGrad.addColorStop(1, '#C59863');
    ctx.fillStyle = woodGrad;
    ctx.fillRect(0, tableBackY, W, Math.max(10, tableFrontY - tableBackY));

    ctx.strokeStyle = '#382417';
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    ctx.moveTo(0, tableBackY);
    ctx.lineTo(W, tableBackY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 248, 232, 0.36)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, tableBackY + 1.8);
    ctx.lineTo(W, tableBackY + 1.8);
    ctx.stroke();

    // 手绘纤细自然木纹
    ctx.strokeStyle = 'rgba(102, 64, 30, 0.14)';
    ctx.lineWidth = 0.9;
    for (let k = 1; k <= 4; k++) {
      const gy = tableBackY + ((tableFrontY - tableBackY) * k) / 4.6;
      ctx.beginPath();
      ctx.moveTo(10, gy);
      ctx.bezierCurveTo(W * 0.32, gy - 1.8, W * 0.68, gy + 2.0, W - 10, gy - 0.5);
      ctx.stroke();
    }

    // 桌面最前缘立体木边（7px）
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

    // 桌下深可可暗影底栏（对齐设计图底部柔和深棕灰底色）
    const underGrad = ctx.createLinearGradient(0, layout.propRowRect.y, 0, H);
    underGrad.addColorStop(0, '#443225');
    underGrad.addColorStop(1, '#332419');
    ctx.fillStyle = underGrad;
    ctx.fillRect(0, layout.propRowRect.y, W, Math.max(0, H - layout.propRowRect.y));
    ctx.restore();

    // ========================================================================
    // 2. 上层 4+1 圆形杯托与修长双层领圈丝带玻璃瓶（先绘杯托与瓶体，再叠入瓶流沙束）
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
      const coasterRx = Math.min(26.5, sr.w * 0.445);
      const coasterRy = 6.5;

      if (locked5th) {
        this.drawRoundCoasterDisc(ctx, cx, coasterY, coasterRx, coasterRy, '#B2A89C', '#8C8277');
        drawStorybookNumber(ctx, '+1', cx, coasterY - 0.3, 11.5, tokens, {
          color: '#2E1E12',
          slant: 0,
          embossColor: 'rgba(255,255,255,0.35)',
        });
        this.drawStandingSlotPadlock(ctx, cx, coasterY - 12.5);
      } else if (bk && !bk.done) {
        const shades = sandRenderer.getSandShades(bk.color);
        const discTop = mixHex(shades.highlightHex, '#FFFFFF', 0.24);
        const discSide = mixHex(shades.baseHex, '#8C7A68', 0.22);
        this.drawRoundCoasterDisc(ctx, cx, coasterY, coasterRx, coasterRy, discTop, discSide, isReceiving);

        // 若瓶子正在从下方木槽抛物线飞入该杯托，杯托先亮起等待，落定后再绘静态瓶体
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
          ctx.translate(cx, coasterY - 1.5);
          ctx.scale(sx, sy);
          this.drawApothecaryGlassBottle(ctx, 0, 0, sg.bw, sg.bh, shades, tokens, timeSec, {
            hasCork: false,
            fillRatio: this.smoothSlotFill[s],
            isPouringInto: isReceiving,
            isMystery: false,
            highlightActive: true,
          });
          ctx.restore();
        }
      } else {
        this.drawCeramicEmptySaucer(ctx, cx, coasterY, coasterRx, coasterRy);
        // 满瓶刚离座时的杯托金色扩散光圈余韵
        if (exitingFromThisSlot) {
          const rp = exitingFromThisSlot.elapsedMs / (exitingFromThisSlot.durationMs * 0.45);
          const shades = sandRenderer.getSandShades(exitingFromThisSlot.color);
          ctx.save();
          ctx.globalAlpha = (1 - rp) * 0.65;
          ctx.strokeStyle = shades.highlightHex;
          ctx.lineWidth = 2.0 * (1 - rp * 0.5);
          ctx.beginPath();
          ctx.ellipse(cx, coasterY - 0.5, coasterRx * (0.75 + 0.45 * rp), coasterRy * (0.75 + 0.45 * rp), 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // ========================================================================
    // 3. 宽出细入柔光漏斗 S 曲线流沙束（顶端贴滤网宽散，尾端精准收细钻入敞口瓶领！）
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
    // 4. 下层 3~4 条短巧暖木凹槽托盘 + 最多显露 3 只候选软木塞丝带瓶（严格最前排可用）
    // ========================================================================
    const numCols = engine.bucketSys.numCols;
    const slotsHaveSpace = engine.bucketSys.occupiedSlotCount < maxSlots;
    const shuffleJitter =
      engine.shuffleAnimMs > 0 ? Math.sin(engine.shuffleAnimMs * 0.08) * 3.0 : 0;

    for (let c = 0; c < numCols; c++) {
      const tm = computeCandidateTroughMetrics(layout, c, numCols);
      const col = engine.bucketSys.columns[c] || [];

      // 绘制短巧透视暖木凹槽托盘（第 3 只后排瓶软木塞自然探出槽后沿，1:1 还原设计图！）
      this.drawWoodenRecessedTrough(ctx, tm.troughRect);

      if (col.length === 0) continue;

      // 每槽最多绘制 3 只瓶子，彻底告别密集拥挤，保证触控舒展清晰
      const visibleCount = Math.min(3, col.length);

      // 顺滑三次缓出前移过渡（当列首瓶飞向杯托时，后排瓶柔和滑向前排）
      const rawSlide = this.colSlideAnim[c];
      const slidePx = rawSlide * rawSlide * (3 - 2 * rawSlide) * tm.stepUpY;
      const rearShakeX =
        this.backRowShakeMs[c] > 0
          ? Math.sin((this.backRowShakeMs[c] / 320) * Math.PI * 5) * 4.2 * (this.backRowShakeMs[c] / 320)
          : 0;

      for (let r = visibleCount - 1; r >= 0; r--) {
        const bk = col[r];
        const isFront = r === 0;
        const scale = isFront ? 1.0 : r === 1 ? 0.90 : 0.82;
        const bw = tm.frontW * scale;
        const bh = tm.frontH * scale;
        const iceShake = bk.iceShakeMs > 0 ? Math.sin(bk.iceShakeMs * 0.12) * 3.0 : 0;
        const orderShake = !isFront ? rearShakeX : 0;
        const cx =
          tm.colRect.x +
          tm.colRect.w * 0.5 +
          iceShake +
          orderShake +
          (r % 2 === 0 ? shuffleJitter : -shuffleJitter);
        const baseY = tm.frontBaseY - r * tm.stepUpY - slidePx;

        ctx.save();
        // 严格顺序视觉层级：后排瓶轻微柔暗退后，唯独最前排瓶（Row 0）清透高亮并带暖光托底
        if (!isFront) {
          ctx.globalAlpha = r === 1 ? 0.91 : 0.84;
        } else if (bk.iceLayers === 0 && slotsHaveSpace) {
          const hintBoost = this.frontOrderHintMs[c] > 0 ? 0.35 * Math.sin(timeSec * 16) + 0.35 : 0;
          ctx.fillStyle = `rgba(255, 238, 168, ${(0.28 + hintBoost * 0.35).toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(cx, baseY - 2, bw * 0.64, 5.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        this.drawCandidateBottle(ctx, bk, cx, baseY, bw, bh, r, sandRenderer, tokens, timeSec);

        // 若玩家误触了后排瓶，在最前排瓶周身闪现柔和金色引导描边提示“先用最前排”
        if (isFront && this.frontOrderHintMs[c] > 0) {
          const ha = Math.min(1, this.frontOrderHintMs[c] / 260) * (0.65 + 0.35 * Math.sin(timeSec * 18));
          ctx.strokeStyle = `rgba(255, 230, 120, ${ha.toFixed(3)})`;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          roundRectPath(ctx, cx - bw * 0.56, baseY - bh - 3, bw * 1.12, bh + 6, 10);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (col.length > 3) {
        drawStatusPill(
          ctx,
          tm.troughRect.x + tm.troughRect.w - 11,
          tm.troughRect.y + 8,
          `+${col.length - 3}`,
          tokens,
          {
            bgHex: '#FAF2E1',
            borderHex: '#382417',
            textColor: '#382417',
            fontSize: 9.0,
            padX: 5.5,
            height: 14,
          }
        );
      }
    }

    // ========================================================================
    // 5. 动画层 A：点选前排瓶 -> 拔开软木塞抛物线飞入上方圆形杯托
    // ========================================================================
    for (const fd of this.flyingDispatches) {
      const t = Math.min(1, fd.elapsedMs / fd.durationMs);
      const ease = 1 - Math.pow(1 - t, 3);
      const sg = this.getSlotBottleGeometry(layout, fd.slotIdx);
      const curX = fd.fromX + (sg.cx - fd.fromX) * ease;
      const curY =
        fd.fromY + (sg.coasterY - 1.5 - fd.fromY) * ease - Math.sin(t * Math.PI) * 26;
      const curW = fd.fromW + (sg.bw - fd.fromW) * ease;
      const curH = fd.fromH + (sg.bh - fd.fromH) * ease;
      const tilt = Math.max(-0.18, Math.min(0.18, (sg.cx - fd.fromX) * 0.0022)) * Math.sin(t * Math.PI);
      const shades = sandRenderer.getSandShades(fd.color);

      ctx.save();
      ctx.translate(curX, curY);
      ctx.rotate(tilt);
      this.drawApothecaryGlassBottle(ctx, 0, 0, curW, curH, shades, tokens, timeSec, {
        hasCork: false,
        fillRatio: (1 - ease) * 0.55,
        isPouringInto: false,
        isMystery: false,
        highlightActive: true,
      });

      // 拔塞轻跳飞散的小软木塞细节
      if (t < 0.78) {
        const ct = t / 0.78;
        ctx.save();
        ctx.globalAlpha = 1 - ct;
        ctx.translate(ct * (sg.cx >= fd.fromX ? -10 : 10), -curH - 4 - Math.sin(ct * Math.PI) * 14);
        ctx.rotate(-ct * 1.4);
        ctx.fillStyle = '#BA8552';
        ctx.strokeStyle = '#382417';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        roundRectPath(ctx, -4.2, -3.5, 8.4, 7.0, 1.5);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    // ========================================================================
    // 6. 动画层 B：满瓶两段式离槽过渡（1. 软木塞落下封口微弹 -> 2. 优美星光弧线飞离槽位）
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
        // 第一阶段（0~150ms）：软木塞清脆落入瓶口封塞 + 原地欢快弹性挤压
        const sp = p / 0.25;
        corkDropOffset = Math.pow(1 - sp, 2) * 13;
        const bounce = Math.sin(sp * Math.PI);
        scaleX = 1 + 0.12 * bounce;
        scaleY = 1 - 0.10 * bounce;
        drawY = gh.y + 1.5 * bounce;
      } else {
        // 第二阶段（150~600ms）：封好塞子的满沙瓶在净空层沿优雅抛物弧线向侧上方轻跳离槽（不遮碰上方滤网）
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

        // 离槽尾迹闪烁四角小星芒
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
      this.drawApothecaryGlassBottle(ctx, 0, 0, gh.w, gh.h, shades, tokens, timeSec, {
        hasCork: true,
        corkDropOffset,
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
    const ink = '#382417';
    const thick = 4.0;
    ctx.save();

    if (glow) {
      ctx.fillStyle = 'rgba(255, 228, 138, 0.36)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 1, rx + 3.5, ry + 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(38, 22, 10, 0.20)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + thick + 1.2, rx + 0.8, ry + 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = sideHex;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.35;
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
    ctx.strokeStyle = 'rgba(120, 98, 76, 0.30)';
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 0.3, rx * 0.72, ry * 0.65, 0, 0, Math.PI * 2);
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

  private drawWoodenRecessedTrough(ctx: CanvasRenderingContext2D, r: Rect): void {
    const ink = '#382417';
    const topTap = 5.2; // 上窄下宽手绘俯视透视
    const wallSide = 5.0;
    const wallBack = 7.5;

    const tlX = r.x + topTap;
    const trX = r.x + r.w - topTap;
    const blX = r.x;
    const brX = r.x + r.w;

    const inTlX = tlX + wallSide;
    const inTrX = trX - wallSide;
    const inTopY = r.y + wallBack;
    const inBlX = blX + wallSide;
    const inBrX = brX - wallSide;
    const inBotY = r.y + r.h - 2.6;

    const traceOuter = () => {
      ctx.beginPath();
      ctx.moveTo(tlX + 4.5, r.y);
      ctx.lineTo(trX - 4.5, r.y);
      ctx.quadraticCurveTo(trX, r.y, trX + 0.4, r.y + 4.5);
      ctx.lineTo(brX, r.y + r.h - 4.5);
      ctx.quadraticCurveTo(brX, r.y + r.h, brX - 5.5, r.y + r.h);
      ctx.lineTo(blX + 5.5, r.y + r.h);
      ctx.quadraticCurveTo(blX, r.y + r.h, blX, r.y + r.h - 4.5);
      ctx.lineTo(tlX - 0.4, r.y + 4.5);
      ctx.quadraticCurveTo(tlX, r.y, tlX + 4.5, r.y);
      ctx.closePath();
    };

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.fillStyle = '#7E5633';
    traceOuter();
    ctx.fill();

    ctx.save();
    traceOuter();
    ctx.clip();

    // 顶部内后壁梯形暗面
    ctx.fillStyle = '#6A4627';
    ctx.beginPath();
    ctx.moveTo(tlX, r.y);
    ctx.lineTo(trX, r.y);
    ctx.lineTo(inTrX, inTopY);
    ctx.lineTo(inTlX, inTopY);
    ctx.closePath();
    ctx.fill();

    // 左右斜切内壁面
    ctx.fillStyle = '#7A5230';
    ctx.beginPath();
    ctx.moveTo(tlX, r.y);
    ctx.lineTo(inTlX, inTopY);
    ctx.lineTo(inBlX, inBotY);
    ctx.lineTo(blX, r.y + r.h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#875C37';
    ctx.beginPath();
    ctx.moveTo(trX, r.y);
    ctx.lineTo(brX, r.y + r.h);
    ctx.lineTo(inBrX, inBotY);
    ctx.lineTo(inTrX, inTopY);
    ctx.closePath();
    ctx.fill();

    // 温润肉桂木槽底面
    const floorGrad = ctx.createLinearGradient(0, inTopY, 0, inBotY);
    floorGrad.addColorStop(0, '#92663E');
    floorGrad.addColorStop(0.45, '#A17349');
    floorGrad.addColorStop(1, '#AB7D51');
    ctx.fillStyle = floorGrad;
    ctx.beginPath();
    ctx.moveTo(inTlX, inTopY);
    ctx.lineTo(inTrX, inTopY);
    ctx.lineTo(inBrX, inBotY);
    ctx.lineTo(inBlX, inBotY);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(50, 28, 12, 0.58)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(inBlX, inBotY);
    ctx.lineTo(inTlX, inTopY);
    ctx.lineTo(inTrX, inTopY);
    ctx.lineTo(inBrX, inBotY);
    ctx.moveTo(tlX + 1.2, r.y + 1.2);
    ctx.lineTo(inTlX, inTopY);
    ctx.moveTo(trX - 1.2, r.y + 1.2);
    ctx.lineTo(inTrX, inTopY);
    ctx.stroke();

    ctx.restore();

    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.55;
    traceOuter();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 244, 222, 0.42)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(blX + 5.5, r.y + r.h + 1.2);
    ctx.lineTo(brX - 5.5, r.y + r.h + 1.2);
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
    rowIdx: number,
    sandRenderer: SandRenderer,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    const isFront = rowIdx === 0;
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
      // 未揭晓的后排「燕麦奶油雾面问号瓶」（第 2 排完整显露 ?，最远端第 3 排按设计图仅露纯净雾面瓶肩与木塞）
      const mysteryShades: SandColorShades = {
        baseHex: '#E5DAC4',
        highlightHex: '#F6EFE0',
        shadowHex: '#CEBFA4',
        outlineHex: '#382417',
        pebbleDarkHex: '#9E8E74',
      };
      this.drawApothecaryGlassBottle(ctx, cx, baseY, w, h, mysteryShades, tokens, timeSec, {
        hasCork: true,
        fillRatio: 0,
        isPouringInto: false,
        isMystery: true,
        hideMysteryGlyph: rowIdx >= 2,
        highlightActive: false,
      });
    } else {
      const shades = sandRenderer.getSandShades(bk.color);
      this.drawApothecaryGlassBottle(ctx, cx, baseY, w, h, shades, tokens, timeSec, {
        hasCork: true,
        fillRatio: isFront ? 0.72 : 0.56,
        isPouringInto: false,
        isMystery: false,
        highlightActive: isFront && bk.iceLayers === 0,
      });
    }

    // 冰晶冻结玻璃瓶护壳
    if (bk.iceLayers > 0) {
      const topY = baseY - h;
      ctx.save();
      const iceGrad = ctx.createLinearGradient(cx - w * 0.46, topY + h * 0.14, cx + w * 0.46, baseY);
      iceGrad.addColorStop(0, 'rgba(232, 250, 255, 0.80)');
      iceGrad.addColorStop(0.5, 'rgba(154, 214, 246, 0.60)');
      iceGrad.addColorStop(1, 'rgba(104, 180, 228, 0.70)');
      ctx.fillStyle = iceGrad;
      ctx.strokeStyle = '#2D5E82';
      ctx.lineWidth = 1.4;
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

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(cx, topY + h * 0.12);
      ctx.lineTo(cx - w * 0.12, baseY);
      ctx.moveTo(cx - w * 0.44, topY + h * 0.32);
      ctx.lineTo(cx + w * 0.44, topY + h * 0.42);
      ctx.stroke();

      const pillW = isFront ? 28 : 25;
      const pillH = isFront ? 13.5 : 12;
      const py = topY + h * 0.50;
      ctx.fillStyle = 'rgba(246, 252, 255, 0.94)';
      ctx.strokeStyle = '#2D5E82';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      roundRectPath(ctx, cx - pillW * 0.5, py - pillH * 0.5, pillW, pillH, pillH * 0.5);
      ctx.fill();
      ctx.stroke();

      drawHandDrawnGlyph(ctx, 'snowflake', cx - pillW * 0.22, py, isFront ? 9.0 : 7.8, tokens);
      drawInkText(ctx, `×${bk.iceLayers}`, cx + pillW * 0.17, py + 0.4, tokens, {
        font: `700 ${isFront ? 9.0 : 7.8}px ${tokens.typography.numeralFontFamily}`,
        color: '#1E4868',
        embossColor: '',
      });
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * 1:1 严格还原《局内主界面.webp》的日系手绘有色水晶药剂玻璃瓶：
   * - 修长挺拔比例（w:h ≈ 0.57），通体同色粉彩半透明玻璃 + 清晰可见的左右与瓶底内壁玻璃厚度
   * - 瓶口圆润双层玻璃领圈（接沙态显露椭圆开口，候选态插入高圆柱暖棕软木塞）
   * - 饱满心形双耳蝴蝶结 + 自然垂落胸前的长弧飘带
   * - 未揭晓后排瓶为温润燕麦奶油雾面陶瓷「?」瓶
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
      corkDropOffset?: number;
      fillRatio: number;
      isPouringInto: boolean;
      isMystery: boolean;
      hideMysteryGlyph?: boolean;
      highlightActive: boolean;
    }
  ): void {
    const ink = '#382417';
    const bounce = opts.isPouringInto ? Math.sin(timeSec * 18) * 0.45 : 0;
    const corkProtrude = opts.hasCork ? h * 0.105 : 0;
    const mouthY = baseY - h + corkProtrude + bounce;

    const lipHalfW = w * 0.295;
    const lipH = Math.max(3.6, h * 0.068);
    const ring2H = Math.max(2.6, h * 0.045);
    const neckHalfW = w * 0.225;
    const neckBotY = mouthY + lipH + ring2H + h * 0.048;
    const shoulderBotY = neckBotY + h * 0.135;
    const bellyHalfW = w * 0.445;
    const bottomCurveH = Math.max(4.2, w * 0.145);
    const wallThick = Math.max(2.1, w * 0.065);

    const traceBottleBody = (inset = 0) => {
      const nw = Math.max(3, neckHalfW - inset * 0.65);
      const bw = Math.max(5, bellyHalfW - inset);
      const yTop = mouthY + lipH * 0.55 + inset * 0.4;
      const yNeck = neckBotY + inset * 0.15;
      const ySh = shoulderBotY + inset * 0.15;
      const yBot = baseY - inset * 1.15;
      const bCurve = Math.max(2.6, bottomCurveH - inset * 0.4);

      ctx.beginPath();
      ctx.moveTo(cx - nw, yTop);
      ctx.lineTo(cx - nw, yNeck);
      ctx.bezierCurveTo(
        cx - nw,
        yNeck + (ySh - yNeck) * 0.44,
        cx - bw,
        ySh - (ySh - yNeck) * 0.44,
        cx - bw,
        ySh
      );
      ctx.lineTo(cx - bw, yBot - bCurve);
      ctx.quadraticCurveTo(cx - bw, yBot, cx, yBot);
      ctx.quadraticCurveTo(cx + bw, yBot, cx + bw, yBot - bCurve);
      ctx.lineTo(cx + bw, ySh);
      ctx.bezierCurveTo(
        cx + bw,
        ySh - (ySh - yNeck) * 0.44,
        cx + nw,
        yNeck + (ySh - yNeck) * 0.44,
        cx + nw,
        yNeck
      );
      ctx.lineTo(cx + nw, yTop);
      ctx.closePath();
    };

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1. 瓶底紧贴杯托/槽底的柔和微接触影（无悬浮黑圆斑）
    ctx.fillStyle = 'rgba(30, 18, 8, 0.16)';
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 0.8, bellyHalfW * 0.82, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. 通体同色粉彩半透明药剂玻璃底衬（或燕麦奶油雾面 ? 瓶）
    const bodyGrad = ctx.createLinearGradient(cx - bellyHalfW, mouthY, cx + bellyHalfW, baseY);
    if (opts.isMystery) {
      bodyGrad.addColorStop(0, '#F5EDE0');
      bodyGrad.addColorStop(0.55, '#E7DAC2');
      bodyGrad.addColorStop(1, '#D5C4A7');
    } else {
      bodyGrad.addColorStop(0, mixHex(shades.highlightHex, '#F2FAFF', 0.40));
      bodyGrad.addColorStop(0.5, mixHex(shades.baseHex, '#DCEFFA', 0.34));
      bodyGrad.addColorStop(1, mixHex(shades.shadowHex, '#C5E2F4', 0.30));
    }

    ctx.save();
    if (!opts.isMystery) {
      ctx.globalAlpha = opts.hasCork ? 0.86 : 0.78;
    }
    ctx.fillStyle = bodyGrad;
    traceBottleBody(0);
    ctx.fill();
    ctx.restore();

    // 2b. 空瓶与半满瓶均可见的内壁圆柱玻璃腔体与玻璃厚底椭圆环（1:1 还原设计图第 3 只绿空瓶质感！）
    if (!opts.isMystery) {
      const innerRx = bellyHalfW - wallThick;
      ctx.save();
      ctx.fillStyle = mixHex(shades.highlightHex, '#FFFFFF', 0.52);
      ctx.globalAlpha = 0.26;
      traceBottleBody(wallThick);
      ctx.fill();

      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = mixHex(shades.shadowHex, '#3D5468', 0.25);
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.ellipse(cx, baseY - wallThick * 1.35, innerRx * 0.92, Math.max(2.0, innerRx * 0.19), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 3. 瓶内腔体彩沙柱（严格裁剪在内壁厚度之内，保留左右与底部晶莹玻璃壁厚！）
    if (!opts.isMystery && (opts.fillRatio > 0.008 || opts.isPouringInto)) {
      ctx.save();
      traceBottleBody(wallThick);
      ctx.clip();

      const innerBotY = baseY - wallThick * 1.2;
      const innerTopBoundY = shoulderBotY - 1.5;
      const usableH = Math.max(10, innerBotY - innerTopBoundY);
      const clampedFill = Math.min(1, Math.max(0, opts.fillRatio));
      const sandTopY = innerBotY - usableH * clampedFill;
      const ripple = opts.isPouringInto ? Math.sin(timeSec * 19) * 1.0 : 0;

      // 接沙瞬间透过玻璃瓶颈直落沙面的细腻入瓶沙丝
      if (opts.isPouringInto) {
        const innerStreamGrad = ctx.createLinearGradient(cx, mouthY, cx, sandTopY);
        innerStreamGrad.addColorStop(0, '#FFFDF6');
        innerStreamGrad.addColorStop(0.45, shades.highlightHex);
        innerStreamGrad.addColorStop(1, shades.baseHex);
        ctx.strokeStyle = innerStreamGrad;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(cx, mouthY + 2);
        ctx.lineTo(cx + ripple * 0.35, Math.min(innerBotY - 1, sandTopY + 1.5));
        ctx.stroke();
      }

      if (clampedFill > 0.008) {
        ctx.save();
        if (opts.hasCork && clampedFill < 0.95) {
          ctx.globalAlpha = 0.78;
        }
        const sGrad = ctx.createLinearGradient(cx - bellyHalfW, sandTopY, cx + bellyHalfW, innerBotY);
        sGrad.addColorStop(0, shades.highlightHex);
        sGrad.addColorStop(0.48, shades.baseHex);
        sGrad.addColorStop(1, shades.shadowHex);
        ctx.fillStyle = sGrad;
        ctx.fillRect(cx - bellyHalfW, sandTopY, bellyHalfW * 2, innerBotY - sandTopY + 3);

        // 细微彩沙颗粒噪点
        ctx.fillStyle = 'rgba(255, 253, 244, 0.38)';
        for (let gIdx = 0; gIdx < 8; gIdx++) {
          const gx = cx + (((gIdx * 37) % 14) - 7) * ((bellyHalfW - wallThick) * 0.11);
          const gy = sandTopY + 3.5 + ((gIdx * 19) % Math.max(3, Math.floor(innerBotY - sandTopY - 4)));
          if (gy < innerBotY - 1.5) {
            ctx.fillRect(gx, gy, 1.2, 1.2);
          }
        }

        // 立体椭圆沙面顶盖（对齐《局内主界面.webp》蓝瓶与黄瓶内的清亮椭圆沙面）
        const meniscusRx = Math.max(4, bellyHalfW - wallThick - 0.4);
        const meniscusRy = Math.max(2.4, meniscusRx * 0.23);
        ctx.fillStyle = mixHex(shades.highlightHex, '#FFFFFF', 0.26);
        ctx.strokeStyle = mixHex(shades.shadowHex, '#5E4230', 0.22);
        ctx.lineWidth = 0.85;
        ctx.beginPath();
        ctx.ellipse(cx, sandTopY + ripple * 0.45, meniscusRx, meniscusRy, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 接沙冲击涟漪与微溅沙珠
        if (opts.isPouringInto) {
          const ripPhase = (timeSec * 3.4) % 1;
          ctx.strokeStyle = `rgba(255, 253, 244, ${(0.7 * (1 - ripPhase)).toFixed(3)})`;
          ctx.lineWidth = 1.0;
          ctx.beginPath();
          ctx.ellipse(
            cx,
            sandTopY + ripple * 0.45,
            meniscusRx * (0.22 + 0.68 * ripPhase),
            meniscusRy * (0.22 + 0.68 * ripPhase),
            0,
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.restore();
    }

    // 4. 瓶体外轮廓细钢笔线 + 左右两侧清透玻璃壁竖向高光丝
    ctx.strokeStyle = ink;
    ctx.lineWidth = opts.highlightActive ? 1.45 : 1.3;
    traceBottleBody(0);
    ctx.stroke();

    if (!opts.isMystery) {
      // 左侧通透长竖玻璃壁高光丝
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.lineWidth = Math.max(1.3, w * 0.042);
      ctx.beginPath();
      ctx.moveTo(cx - bellyHalfW + wallThick * 0.72, shoulderBotY + 1);
      ctx.lineTo(cx - bellyHalfW + wallThick * 0.72, baseY - bottomCurveH - 1.5);
      ctx.stroke();

      // 右侧玻璃内壁柔光细边
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.48)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(cx + bellyHalfW - wallThick * 0.72, shoulderBotY + 2);
      ctx.lineTo(cx + bellyHalfW - wallThick * 0.72, baseY - bottomCurveH - 2.5);
      ctx.stroke();
    } else if (!opts.hideMysteryGlyph) {
      // 燕麦雾面问号瓶：手绘深棕「?」排布于瓶胸上段，确保完整露出于前排瓶木塞之上
      const qY = shoulderBotY + (baseY - shoulderBotY) * 0.19;
      drawInkText(ctx, '?', cx, qY, tokens, {
        font: `700 ${Math.max(12, Math.round(h * 0.25))}px ${tokens.typography.numeralFontFamily}`,
        color: '#4A3624',
        boldStrokeWidth: 0.35,
        embossColor: 'rgba(255,255,255,0.45)',
      });
    }

    // 5. 瓶口双层圆润玻璃领圈 + 软木塞（候选瓶/满瓶离场）或椭圆敞口（接沙瓶）
    const collarFill = opts.isMystery
      ? '#F5EDE0'
      : mixHex(shades.highlightHex, '#F2FAFF', 0.48);

    if (opts.hasCork) {
      const dropY = opts.corkDropOffset || 0;
      const corkTopW = neckHalfW * 1.54;
      const corkBotW = neckHalfW * 1.32;
      const corkTopY = mouthY - corkProtrude - dropY + 0.5;
      const corkBotY = mouthY + lipH * 0.55 - dropY;

      // 高圆柱暖棕软木塞（先绘塞体，再由玻璃领圈前缘自然包住塞脚）
      const cGrad = ctx.createLinearGradient(cx - corkTopW * 0.5, corkTopY, cx + corkTopW * 0.5, corkBotY);
      cGrad.addColorStop(0, '#D6A472');
      cGrad.addColorStop(0.55, '#B8824F');
      cGrad.addColorStop(1, '#986638');
      ctx.fillStyle = cGrad;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx - corkTopW * 0.5, corkTopY + 1.6);
      ctx.quadraticCurveTo(cx, corkTopY - 1.2, cx + corkTopW * 0.5, corkTopY + 1.6);
      ctx.lineTo(cx + corkBotW * 0.5, corkBotY);
      ctx.quadraticCurveTo(cx, corkBotY + 1.3, cx - corkBotW * 0.5, corkBotY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 软木塞顶面浅圈细节
      ctx.strokeStyle = 'rgba(255, 238, 212, 0.45)';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.ellipse(cx, corkTopY + 1.4, corkTopW * 0.36, 1.1, 0, 0, Math.PI * 2);
      ctx.stroke();

      // 下层颈圈 + 上层瓶唇双环
      ctx.fillStyle = collarFill;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      roundRectPath(ctx, cx - lipHalfW * 0.88, mouthY + lipH * 0.72, lipHalfW * 1.76, ring2H, ring2H * 0.48);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      roundRectPath(ctx, cx - lipHalfW, mouthY, lipHalfW * 2, lipH, lipH * 0.48);
      ctx.fill();
      ctx.stroke();
    } else {
      // 接沙态敞口药剂瓶：下层玻璃护颈圈 + 上层饱满圆环玻璃厚唇 + 椭圆瓶口内孔
      ctx.fillStyle = collarFill;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      roundRectPath(ctx, cx - lipHalfW * 0.88, mouthY + lipH * 0.72, lipHalfW * 1.76, ring2H, ring2H * 0.48);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      roundRectPath(ctx, cx - lipHalfW, mouthY, lipHalfW * 2, lipH, lipH * 0.5);
      ctx.fill();
      ctx.stroke();

      const mouthHoleY = mouthY + lipH * 0.42;
      ctx.fillStyle = opts.isPouringInto
        ? mixHex(shades.highlightHex, '#FFFFFF', 0.35)
        : mixHex(shades.shadowHex, '#23364C', 0.42);
      ctx.strokeStyle = 'rgba(56, 36, 23, 0.55)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(cx, mouthHoleY, lipHalfW * 0.62, Math.max(1.3, lipH * 0.28), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 6. 瓶颈饱满双耳蝴蝶结 + 优雅垂落胸前的长弧双飘带（1:1 还原设计图丝带比例！）
    if (!opts.isMystery) {
      const ribBase = mixHex(shades.baseHex, '#FFFFFF', 0.08);
      const ribHi = mixHex(shades.highlightHex, '#FFFFFF', 0.28);
      const ribDark = mixHex(shades.shadowHex, '#382417', 0.14);
      const bowY = neckBotY - 0.8;
      const loopW = Math.max(7.2, w * 0.32);
      const loopH = Math.max(4.4, h * 0.088);
      const tailLen = Math.max(11.0, h * 0.235);

      // 环绕瓶颈丝带束圈
      ctx.fillStyle = ribBase;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      roundRectPath(ctx, cx - neckHalfW - 0.8, bowY - 1.6, (neckHalfW + 0.8) * 2, 3.2, 1.4);
      ctx.fill();
      ctx.stroke();

      // 自然向外微张并垂落至上胸腹的长弧双飘带（对齐设计图长丝带特征！）
      const tailGrad = ctx.createLinearGradient(cx, bowY, cx, bowY + tailLen);
      tailGrad.addColorStop(0, ribHi);
      tailGrad.addColorStop(1, ribBase);
      ctx.fillStyle = tailGrad;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + dir * 1.1, bowY + 0.8);
        ctx.bezierCurveTo(
          cx + dir * (loopW * 0.52),
          bowY + tailLen * 0.35,
          cx + dir * (loopW * 0.72),
          bowY + tailLen * 0.72,
          cx + dir * (loopW * 0.54),
          bowY + tailLen
        );
        ctx.lineTo(cx + dir * (loopW * 0.20), bowY + tailLen * 0.88);
        ctx.bezierCurveTo(
          cx + dir * (loopW * 0.30),
          bowY + tailLen * 0.56,
          cx + dir * (loopW * 0.16),
          bowY + tailLen * 0.28,
          cx + dir * 0.2,
          bowY + 1.2
        );
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // 左右饱满圆润双蝴蝶结耳（带内部折痕细线）
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
          bowY - loopH * 1.28,
          cx + dir * (loopW * 1.18),
          bowY - loopH * 0.78,
          cx + dir * (loopW * 1.02),
          bowY + loopH * 0.18
        );
        ctx.bezierCurveTo(
          cx + dir * (loopW * 0.88),
          bowY + loopH * 1.04,
          cx + dir * (loopW * 0.36),
          bowY + loopH * 0.78,
          cx,
          bowY + 0.7
        );
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 耳内手绘丝带折痕短线
        ctx.beginPath();
        ctx.moveTo(cx + dir * 2.2, bowY + 0.1);
        ctx.quadraticCurveTo(cx + dir * (loopW * 0.45), bowY - loopH * 0.15, cx + dir * (loopW * 0.66), bowY + 0.4);
        ctx.stroke();
      }

      // 蝴蝶结圆润中心结扣
      ctx.fillStyle = ribHi;
      ctx.beginPath();
      roundRectPath(ctx, cx - 2.2, bowY - 2.0, 4.4, 4.1, 1.8);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 宽出细入柔光漏斗 S 曲线流沙束：
   * - 顶端从木格栅多齿缝宽幅（~20px）柔光涌出，中段呈柔美 S 弯飘带摆动，末端精准收束为 ~3.2px 细沙线钻入敞口瓶领
   * - 支持 tStart..tEnd 起止动态延伸与收尾流尽过渡，彻底消除生硬瞬现管线感
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
    // 当落沙点与瓶口接近垂直时，赋予自然的柔光 S 弧度，还原《局内主界面.webp》丝滑流光曲线
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
    const coreHex = rainbowDrain ? '#FFFDF5' : mixHex(shades.highlightHex, '#FFFDF4', 0.58);

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
    const leftPts: [number, number, number][] = [];
    const rightPts: [number, number, number][] = [];

    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = t0 + (t1 - t0) * u;
      const [px, py] = evalPoint(t);
      const [tx, ty] = evalTangent(t);
      const nx = -ty;
      const ny = tx;

      // 漏斗状宽出细入：滤网出口宽柔（~9.8px 半宽），入瓶口收束为 1.6px 细沙柱，且首尾圆滑收尖
      const funnelHalfW = Math.pow(1 - t, 1.25) * 8.6 + 1.55;
      const tipCap =
        (t0 > 0.02 && i < 3 ? (i + 0.5) / 3 : 1) *
        (t1 < 0.98 && i > steps - 3 ? (steps - i + 0.5) / 3 : 1);
      const hw = funnelHalfW * tipCap;
      leftPts.push([px + nx * hw, py + ny * hw, hw]);
      rightPts.push([px - nx * hw, py - ny * hw, hw]);
    }

    const traceTaperedRibbon = (widthScale: number) => {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const t = t0 + (t1 - t0) * u;
        const [px, py] = evalPoint(t);
        const [tx, ty] = evalTangent(t);
        const hw = leftPts[i][2] * widthScale;
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
        const hw = rightPts[i][2] * widthScale;
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

    // 0. 滤网多齿缝漏斗汇流丝（还原《局内主界面.webp》沙从多道格栅缝隙漏出汇成一束的质感！）
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

    // 1. 外层星夜柔光晕染带
    ctx.globalAlpha = 0.28 * visAlpha;
    ctx.fillStyle = glowHex;
    traceTaperedRibbon(1.82);
    ctx.fill();

    // 2. 中层温润彩沙流光带
    const midGrad = ctx.createLinearGradient(spoutX, spoutY, endX, targetY);
    midGrad.addColorStop(0, glowHex);
    midGrad.addColorStop(0.5, midHex);
    midGrad.addColorStop(1, shades.baseHex);
    ctx.globalAlpha = 0.68 * visAlpha;
    ctx.fillStyle = midGrad;
    traceTaperedRibbon(1.06);
    ctx.fill();

    // 3. 内核高亮流萤细沙芯（顺滑钻入瓶口）
    const coreGrad = ctx.createLinearGradient(spoutX, spoutY, endX, targetY);
    coreGrad.addColorStop(0, midHex);
    coreGrad.addColorStop(0.5, coreHex);
    coreGrad.addColorStop(1, '#FFFDF6');
    ctx.globalAlpha = 0.86 * visAlpha;
    ctx.fillStyle = coreGrad;
    traceTaperedRibbon(0.38);
    ctx.fill();

    // 4. 沿漏斗光带加速坠落的星砂微粒（出口蓬松宽散，入瓶口收束成一线）
    for (let k = 0; k < 26; k++) {
      const phase = ((k / 26) + timeSec * 2.5 + (k % 5) * 0.04) % 1;
      const t = Math.pow(phase, 1.2); // 重力加速感
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
   * 底部四枚日系和纸圆角方卡道具钮（1:1 还原《局内主界面.webp》底栏！）
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
