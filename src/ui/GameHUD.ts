import type { BucketRuntime } from '../engine/BucketSystem';
import type { SandEngine } from '../engine/SandEngine';
import type { SandColorShades, SandRenderer } from '../engine/SandRenderer';
import { GH, GW } from '../engine/SandGrid';
import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { RewardManager } from '../systems/RewardManager';
import type { SaveManager } from '../systems/SaveManager';
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
  drawWoodButton,
  formatNetWorth,
  hitRect,
  roundRectPath,
} from './UIHelpers';

export type HudAction =
  | { type: 'GO_HOME' }
  | { type: 'OPEN_DRAWER' }
  | { type: 'OPEN_GALLERY' }
  | { type: 'TAP_LOOT_BAG' }
  | { type: 'DISPATCH_COL'; colIdx: number }
  | { type: 'PROP_UNDO' }
  | { type: 'PROP_VACUUM' }
  | { type: 'PROP_EXTRA_SLOT' }
  | { type: 'PROP_SHUFFLE' }
  | { type: 'PROP_RESTART_CONFIRMED' };

interface CompletedBucketGhost {
  idx: number;
  color: SandColorId;
  x: number;
  y: number;
  timerMs: number;
}

function mixHex(hexA: string, hexB: string, t: number): string {
  const pa = parseInt(hexA.replace('#', ''), 16);
  const pb = parseInt(hexB.replace('#', ''), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const b = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * 局内主界面（GameHUD）—— 上下双核耦合绘本木工坊版：
 * 1. 顶栏五枚木镶边牌匾与圆钮（主页 / 免费重玩 / 第X关设置 / 身价藏馆 / 战利品兜）
 * 2. 木工台第 1 层：4+1 临时接沙小卡槽（承接上方宽幅黄铜滤沙格栅的多束同色流沙柱，满 100% 即刻弹飞腾空）
 * 3. 木工台第 2 层：3~4 列前后排纵深候选木桶槽道（前排高亮可点选，支持 ？ 问号盲桶翻牌与冰封木桶破冰震动）
 * 4. 底栏四枚嵌芯木框道具卡（撤回 / 磁吸满桶 / 加第5槽 / 候选洗牌） + 两阶段卡槽预警与硬死局救援弹窗
 */
export class GameHUD {
  public displayedNetWorth = 0;
  public lootBagBounceMs = 0;
  public mechanicBannerText: string | null = null;
  public mechanicBannerTimerMs = 0;
  public showRestartConfirm = false;
  public pressedBtnIdx: number | null = null;

  private confirmCancelRect: Rect = { x: 0, y: 0, w: 120, h: 40 };
  private confirmOkRect: Rect = { x: 0, y: 0, w: 120, h: 40 };

  // 硬死局救援弹窗按钮热区
  private deadlockSlotBtnRect: Rect | null = null;
  private deadlockMagnetBtnRect: Rect | null = null;
  private deadlockUndoBtnRect: Rect | null = null;
  private deadlockRestartBtnRect: Rect = { x: 0, y: 0, w: 140, h: 40 };

  private trackedSignature = '';
  private seenDoneSet = new Set<number>();
  private lastKnownSlotPos = new Map<number, { x: number; y: number }>();
  private completedGhosts: CompletedBucketGhost[] = [];

  public setMechanicBanner(text: string | null): void {
    this.mechanicBannerText = text;
    this.mechanicBannerTimerMs = text ? 4400 : 0;
  }

  public triggerLootBagBounce(): void {
    this.lootBagBounceMs = 280;
  }

  public update(dtMs: number, targetNetWorth: number): void {
    if (this.lootBagBounceMs > 0) {
      this.lootBagBounceMs = Math.max(0, this.lootBagBounceMs - dtMs);
    }
    if (this.mechanicBannerTimerMs > 0) {
      this.mechanicBannerTimerMs = Math.max(0, this.mechanicBannerTimerMs - dtMs);
    }
    for (let i = this.completedGhosts.length - 1; i >= 0; i--) {
      this.completedGhosts[i].timerMs -= dtMs;
      if (this.completedGhosts[i].timerMs <= 0) {
        this.completedGhosts.splice(i, 1);
      }
    }
    const diff = targetNetWorth - this.displayedNetWorth;
    if (Math.abs(diff) < 2) {
      this.displayedNetWorth = targetNetWorth;
    } else {
      this.displayedNetWorth += diff * Math.min(1, dtMs / 160);
    }
  }

  /**
   * 计算指定小卡槽（0..4）内木桶口屏幕坐标（供宽底滤网吸沙飞线与流沙柱精准汇入对应卡槽）
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
      y: sr.y + sr.h * 0.22,
    };
  }

  public handleTap(
    px: number,
    py: number,
    layout: ComputedLayout,
    engine: SandEngine
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

    // 3. 顶栏五枚圆钮与牌匾
    if (hitRect(px, py, layout.homePill)) return { type: 'GO_HOME' };
    if (hitRect(px, py, layout.restartPill)) {
      const hasProgress =
        engine.boardsPulledCount > 0 ||
        engine.bucketsDispatchedCount > 0 ||
        engine.vacuumUsedCount > 0 ||
        engine.bucketSys.maxActiveSlots > 4 ||
        engine.lootBag.length > 0;
      if (hasProgress && !engine.won) {
        this.showRestartConfirm = true;
        return 'CONSUMED';
      }
      return { type: 'PROP_RESTART_CONFIRMED' };
    }
    if (hitRect(px, py, layout.settingsPill)) return { type: 'OPEN_DRAWER' };
    if (hitRect(px, py, layout.netWorthPill)) return { type: 'OPEN_GALLERY' };
    if (hitRect(px, py, layout.lootBagPill)) return { type: 'TAP_LOOT_BAG' };

    // 4. 点选未解锁的第 5 小卡槽快捷加槽
    if (
      engine.bucketSys.maxActiveSlots < 5 &&
      hitRect(px, py, layout.activeSlotRects[4]) &&
      !engine.won
    ) {
      return { type: 'PROP_EXTRA_SLOT' };
    }

    // 5. 点选下方 3~4 列候选桶槽道（派遣前排第 0 行木桶入小卡槽）
    if (hitRect(px, py, layout.candidateAreaRect) && !engine.won) {
      const numCols = engine.bucketSys.numCols;
      for (let c = 0; c < numCols; c++) {
        const colRect = computeCandidateColRect(layout, c, numCols);
        if (hitRect(px, py, colRect)) {
          return { type: 'DISPATCH_COL', colIdx: c };
        }
      }
    }

    // 6. 底栏四枚道具卡（撤回 / 磁吸满桶 / 加第5槽 / 候选洗牌）
    if (hitRect(px, py, layout.propButtons[0])) return { type: 'PROP_UNDO' };
    if (hitRect(px, py, layout.propButtons[1])) return { type: 'PROP_VACUUM' };
    if (hitRect(px, py, layout.propButtons[2])) return { type: 'PROP_EXTRA_SLOT' };
    if (hitRect(px, py, layout.propButtons[3])) return { type: 'PROP_SHUFFLE' };

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
    saveMgr: SaveManager,
    rewardMgr: RewardManager,
    hasCraftableRedDot: boolean,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    // ========================================================================
    // 1. 顶栏双圈木镶边牌匾与圆钮（主页 / 免费重玩 / 第X关设置 / 身价藏馆 / 战利品兜）
    // ========================================================================
    const hp = layout.homePill;
    drawDoubleRimPlaque(ctx, hp, tokens, {
      variant: 'parchment',
      rimThickness: 3.4,
      radius: hp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'home', hp.x + hp.w * 0.5, hp.y + hp.h * 0.5 + 0.5, 18, tokens);

    const rp = layout.restartPill;
    drawDoubleRimPlaque(ctx, rp, tokens, {
      variant: 'parchment',
      rimThickness: 3.4,
      radius: rp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'restart', rp.x + rp.w * 0.5, rp.y + rp.h * 0.5, 17, tokens);

    const sp = layout.settingsPill;
    const spInner = drawDoubleRimPlaque(ctx, sp, tokens, {
      variant: 'parchment',
      rimThickness: 3.6,
      radius: sp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'gear', spInner.x + 11, sp.y + sp.h * 0.5, 14, tokens);
    drawInkText(
      ctx,
      `第 ${engine.level.levelId} 关`,
      spInner.x + spInner.w * 0.5 + 6,
      sp.y + sp.h * 0.5 + 0.5,
      tokens,
      {
        font: `800 12.5px ${tokens.typography.fontFamily}`,
        color: '#3E2311',
        maxWidth: spInner.w - 20,
      }
    );

    const np = layout.netWorthPill;
    const npInner = drawDoubleRimPlaque(ctx, np, tokens, {
      variant: 'amber',
      rimThickness: 3.5,
      radius: np.h * 0.5,
    });
    const rank = saveMgr.getRankBadge(tokens);
    const badgeImg =
      rank.level >= 6
        ? assets.get('ui_badge_collector')
        : assets.get('ui_networth_coin') || assets.getTinted('ui_badge_rank_base', rank.tintHex);
    if (badgeImg) {
      ctx.drawImage(badgeImg, npInner.x + 3, np.y + (np.h - 19) * 0.5, 19, 19);
    }
    drawInkText(
      ctx,
      formatNetWorth(this.displayedNetWorth),
      npInner.x + npInner.w * 0.5 + 7,
      np.y + np.h * 0.5 + 0.5,
      tokens,
      {
        font: `800 12px ${tokens.typography.numeralFontFamily}`,
        color: '#5A2E0E',
        maxWidth: npInner.w - 24,
      }
    );
    if (hasCraftableRedDot) {
      ctx.save();
      ctx.fillStyle = '#DC2626';
      ctx.strokeStyle = '#FFF9EE';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(np.x + np.w - 5, np.y + 5, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    const lp = layout.lootBagPill;
    const bagScale =
      this.lootBagBounceMs > 0
        ? 1 + Math.sin((this.lootBagBounceMs / 280) * Math.PI) * 0.26
        : 1;
    ctx.save();
    ctx.translate(lp.x + lp.w * 0.5, lp.y + lp.h * 0.5);
    ctx.scale(bagScale, bagScale);
    drawDoubleRimPlaque(
      ctx,
      { x: -lp.w * 0.5, y: -lp.h * 0.5, w: lp.w, h: lp.h },
      tokens,
      { variant: 'parchment', rimThickness: 3.4, radius: lp.h * 0.5 }
    );
    const bagImg = assets.get('ui_loot_bag');
    if (bagImg) {
      ctx.drawImage(bagImg, -lp.w * 0.5 + 4, -12, 23, 23);
    }
    drawInkText(ctx, `×${engine.lootBag.length}`, 9, 0.5, tokens, {
      font: `800 12px ${tokens.typography.numeralFontFamily}`,
      color: '#3E2311',
    });
    ctx.restore();

    // ========================================================================
    // 2. 顶部新机关微横幅 & Stage 1 软性卡槽停滞提示条
    // ========================================================================
    if (
      this.mechanicBannerText &&
      this.mechanicBannerTimerMs > 0 &&
      engine.boardsPulledCount === 0 &&
      engine.bucketsDispatchedCount === 0
    ) {
      const alpha = Math.min(1, this.mechanicBannerTimerMs / 400);
      ctx.save();
      ctx.globalAlpha = alpha;
      const bw = layout.chamberRect.w - 8;
      const bx = layout.chamberRect.x + 4;
      const by = layout.chamberRect.y + 7;
      drawDoubleRimPlaque(ctx, { x: bx, y: by, w: bw, h: 30 }, tokens, {
        variant: 'parchment',
        rimThickness: 3,
        radius: 15,
      });
      drawInkText(ctx, this.mechanicBannerText, bx + bw * 0.5, by + 15.5, tokens, {
        font: `700 10.8px ${tokens.typography.fontFamily}`,
        color: '#4A2A12',
        maxWidth: bw - 16,
      });
      ctx.restore();
    }

    const clogActive = engine.bucketSys.clogWarningActive;
    const hardDeadlock = engine.bucketSys.hardDeadlockActive;
    if (clogActive && !hardDeadlock && !engine.won) {
      const cw = Math.min(324, layout.chamberRect.w - 10);
      const cx = (layout.screenW - cw) * 0.5;
      const cy = layout.chamberRect.y + layout.chamberRect.h - 42;
      drawDoubleRimPlaque(ctx, { x: cx, y: cy, w: cw, h: 30 }, tokens, {
        variant: 'amber',
        rimThickness: 3.0,
        radius: 15,
      });
      const warnImg = assets.get('ui_jam_warning');
      if (warnImg) {
        ctx.drawImage(warnImg, cx + 8, cy + 4, 21, 21);
      }
      drawInkText(
        ctx,
        '小卡槽暂未进沙：请选匹配底沙的桶、抽木栓或用道具',
        cx + cw * 0.5 + 9,
        cy + 15.5,
        tokens,
        {
          font: `700 10.5px ${tokens.typography.fontFamily}`,
          color: '#8C2D12',
          maxWidth: cw - 36,
        }
      );
    }

    // ========================================================================
    // 3. 双层木工排桶台（4+1 小卡槽 + 3~4 列纵深候选木桶 + 宽滤网多束流沙柱）
    // ========================================================================
    const rainbowDrain = saveMgr.data.equippedSuctionFxId === 'fx_rainbow_drain';
    this.renderDualTierWorkbench(ctx, layout, engine, sandRenderer, tokens, timeSec, rainbowDrain);

    // ========================================================================
    // 4. 底部四枚圆角双层嵌芯木框道具卡（撤回 / 磁吸满桶 / 加第5槽 / 候选洗牌）
    // ========================================================================
    this.renderPropBar(ctx, layout, engine, rewardMgr, clogActive || hardDeadlock, tokens, timeSec);

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
          y: sr.y + 4,
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
          timerMs: 280,
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
    rainbowDrain: boolean
  ): void {
    const W = layout.screenW;
    const H = layout.screenH;
    const topY = layout.bucketRowRect.y;
    const candTopY = layout.candidateAreaRect.y;

    this.syncCompletedSlotGhosts(layout, engine);

    // 1. 绘制双层木工台整体蜂蜜雪松木台面与下方深胡桃木柜裙
    ctx.save();
    const backShadow = ctx.createLinearGradient(0, topY - 14, 0, topY);
    backShadow.addColorStop(0, 'rgba(28, 15, 6, 0)');
    backShadow.addColorStop(1, 'rgba(28, 15, 6, 0.24)');
    ctx.fillStyle = backShadow;
    ctx.fillRect(0, topY - 14, W, 14);

    // 第 1 层：4+1 小卡槽承沙木梁面板
    const shelfGrad = ctx.createLinearGradient(0, topY, 0, candTopY);
    shelfGrad.addColorStop(0, '#E2AF74');
    shelfGrad.addColorStop(0.65, '#C88D4F');
    shelfGrad.addColorStop(1, '#9E622E');
    ctx.fillStyle = shelfGrad;
    ctx.fillRect(0, topY, W, candTopY - topY);

    ctx.strokeStyle = '#3E2311';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(0, topY);
    ctx.lineTo(W, topY);
    ctx.moveTo(0, candTopY);
    ctx.lineTo(W, candTopY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 244, 218, 0.45)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, topY + 2);
    ctx.lineTo(W, topY + 2);
    ctx.stroke();

    // 第 2 层：候选纵深槽道胡桃木斜坡背板 + 底部道具柜深木底
    const deskGrad = ctx.createLinearGradient(0, candTopY, 0, H);
    deskGrad.addColorStop(0, '#8A5429');
    deskGrad.addColorStop(0.55, '#683D1C');
    deskGrad.addColorStop(1, '#442611');
    ctx.fillStyle = deskGrad;
    ctx.fillRect(0, candTopY, W, Math.max(0, H - candTopY));

    ctx.strokeStyle = '#3E2311';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, layout.propRowRect.y);
    ctx.lineTo(W, layout.propRowRect.y);
    ctx.stroke();
    ctx.restore();

    // 2. 绘制上层 4+1 小卡槽（Slots 0..4）及槽内正在接沙的小木桶
    const maxSlots = engine.bucketSys.maxActiveSlots;
    for (let s = 0; s < 5; s++) {
      const sr = layout.activeSlotRects[s];
      const locked5th = s >= maxSlots;
      const bk = engine.bucketSys.activeSlots[s];
      const isReceiving = Boolean(bk && !bk.done && engine.slotPourMs[s] > 0);

      ctx.save();
      // 凹陷木卡槽底座
      ctx.fillStyle = locked5th
        ? 'rgba(54, 32, 16, 0.42)'
        : isReceiving
          ? 'rgba(255, 232, 162, 0.42)'
          : 'rgba(72, 40, 18, 0.36)';
      ctx.strokeStyle = isReceiving ? '#F59E0B' : '#3E2311';
      ctx.lineWidth = isReceiving ? 2.1 : 1.6;
      ctx.beginPath();
      roundRectPath(ctx, sr.x, sr.y, sr.w, sr.h, 10);
      ctx.fill();
      ctx.stroke();

      // 槽底内凹高光边
      ctx.strokeStyle = 'rgba(255, 245, 222, 0.25)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      roundRectPath(ctx, sr.x + 2, sr.y + 2, sr.w - 4, sr.h - 4, 8);
      ctx.stroke();

      if (locked5th) {
        drawHandDrawnGlyph(ctx, 'extra_slot', sr.x + sr.w * 0.5, sr.y + sr.h * 0.38, 18, tokens);
        drawInkText(ctx, '+第5槽', sr.x + sr.w * 0.5, sr.y + sr.h - 9, tokens, {
          font: `800 9.5px ${tokens.typography.fontFamily}`,
          color: '#FFF4DC',
        });
      } else if (bk && !bk.done) {
        const pct = Math.min(100, Math.floor((bk.cur / Math.max(1, bk.max)) * 100));
        const shades = sandRenderer.getSandShades(bk.color);
        const bw = Math.min(sr.w * 0.76, 46);
        const bh = Math.min(sr.h * 0.86, 46);
        this.drawStorybookStaveBucket(
          ctx,
          sr.x + sr.w * 0.5,
          sr.y + sr.h - 3,
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
        drawInkText(ctx, `槽${s + 1}`, sr.x + sr.w * 0.5, sr.y + sr.h * 0.52, tokens, {
          font: `700 10px ${tokens.typography.fontFamily}`,
          color: 'rgba(62, 35, 17, 0.48)',
        });
      }
      ctx.restore();
    }

    // 3. 绘制下层 3~4 列纵深候选彩桶槽道（前排高亮在最上方紧邻小卡槽，后排依次向槽道下方纵深排布）
    const numCols = engine.bucketSys.numCols;
    const slotsHaveSpace = engine.bucketSys.occupiedSlotCount < maxSlots;
    const shuffleJitter =
      engine.shuffleAnimMs > 0 ? Math.sin(engine.shuffleAnimMs * 0.08) * 3.2 : 0;

    for (let c = 0; c < numCols; c++) {
      const colRect = computeCandidateColRect(layout, c, numCols);
      const col = engine.bucketSys.columns[c] || [];

      ctx.save();
      // 纵向实木滑槽导轨
      const grooveGrad = ctx.createLinearGradient(colRect.x, colRect.y, colRect.x, colRect.y + colRect.h);
      grooveGrad.addColorStop(0, 'rgba(44, 24, 10, 0.46)');
      grooveGrad.addColorStop(1, 'rgba(28, 14, 5, 0.56)');
      ctx.fillStyle = grooveGrad;
      ctx.strokeStyle = '#3E2311';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      roundRectPath(ctx, colRect.x, colRect.y, colRect.w, colRect.h, 11);
      ctx.fill();
      ctx.stroke();

      // 导轨内侧双木条滑道线
      ctx.strokeStyle = 'rgba(238, 194, 138, 0.16)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(colRect.x + 8, colRect.y + 6);
      ctx.lineTo(colRect.x + 8, colRect.y + colRect.h - 6);
      ctx.moveTo(colRect.x + colRect.w - 8, colRect.y + 6);
      ctx.lineTo(colRect.x + colRect.w - 8, colRect.y + colRect.h - 6);
      ctx.stroke();

      if (col.length === 0) {
        drawInkText(ctx, '已排空', colRect.x + colRect.w * 0.5, colRect.y + colRect.h * 0.5, tokens, {
          font: `700 10.5px ${tokens.typography.fontFamily}`,
          color: 'rgba(255, 238, 210, 0.34)',
        });
        ctx.restore();
        continue;
      }

      const visibleCount = Math.min(3, col.length);
      const frontH = Math.min(46, colRect.h * 0.45);
      const frontW = Math.min(50, colRect.w * 0.72);
      const rowStepY = Math.min(30, (colRect.h - frontH - 6) / Math.max(1, visibleCount - 1 || 1));

      // 从后排向前排绘制，保证第 0 排（最前排可点击桶）自然遮挡后排桶上部，直观体现「前排挡后排」
      for (let r = visibleCount - 1; r >= 0; r--) {
        const bk = col[r];
        const isFront = r === 0;
        const scale = isFront ? 1.0 : r === 1 ? 0.84 : 0.72;
        const bw = frontW * scale;
        const bh = frontH * scale;
        const iceShake = bk.iceShakeMs > 0 ? Math.sin(bk.iceShakeMs * 0.12) * 3.5 : 0;
        const cx = colRect.x + colRect.w * 0.5 + iceShake + (r % 2 === 0 ? shuffleJitter : -shuffleJitter);
        const baseY = colRect.y + 6 + frontH + r * rowStepY;

        ctx.save();
        if (!isFront) {
          ctx.globalAlpha = r === 1 ? 0.88 : 0.74;
        }

        // 前排可派遣状态柔光底座提示
        if (isFront && bk.iceLayers === 0 && slotsHaveSpace) {
          ctx.fillStyle = 'rgba(253, 224, 71, 0.18)';
          ctx.beginPath();
          ctx.ellipse(cx, baseY - bh * 0.42, bw * 0.64, bh * 0.54, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        this.drawCandidateBucket(ctx, bk, cx, baseY, bw, bh, isFront, sandRenderer, tokens, timeSec);
        ctx.restore();
      }

      // 若该列超过 3 只桶，在列右下角标示剩余深度 +N
      if (col.length > 3) {
        drawStatusPill(
          ctx,
          colRect.x + colRect.w - 16,
          colRect.y + colRect.h - 11,
          `+${col.length - 3}`,
          tokens,
          {
            bgHex: '#FFF6E2',
            borderHex: '#5A3418',
            textColor: '#3E2311',
            fontSize: 9,
            padX: 5,
            height: 14,
          }
        );
      }

      ctx.restore();
    }

    // 4. 绘制满桶瞬间的欢庆弹升光效残影
    for (const gh of this.completedGhosts) {
      const p = 1 - gh.timerMs / 280;
      const liftY = -20 * Math.sin(p * Math.PI * 0.85);
      const alpha = Math.max(0, 1 - p);
      const shades = sandRenderer.getSandShades(gh.color);
      ctx.save();
      ctx.globalAlpha = alpha;
      drawStatusPill(ctx, gh.x, gh.y + liftY, '100% 满桶✦', tokens, {
        bgHex: shades.highlightHex,
        borderHex: '#3E2311',
        textColor: '#3E2311',
        fontSize: 10,
      });
      ctx.restore();
    }

    // 5. 绘制从宽幅黄铜滤沙格栅各出沙点倾入对应小卡槽的多束水粉流沙柱
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
   * 绘制候选列中的木桶：支持正常彩桶、？ 问号盲桶（含翻牌翻转动画）与冰封木桶覆冰晶壳
   */
  private drawCandidateBucket(
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
      // 未揭晓的后排「问号盲桶」：深胡桃神秘漆桶 + 奶油羊皮纸「？」封签
      const mysteryShades: SandColorShades = {
        baseHex: '#8B5A34',
        highlightHex: '#BA8556',
        shadowHex: '#523018',
        outlineHex: '#3E2311',
        pebbleDarkHex: '#432510',
      };
      this.drawStorybookStaveBucket(
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
        '?'
      );
    } else {
      const shades = sandRenderer.getSandShades(bk.color);
      this.drawStorybookStaveBucket(
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
        timeSec
      );
    }

    // 若候选桶带有冰封层数（iceLayers > 0），外覆手绘半透明冰晶护甲与层数角标
    if (bk.iceLayers > 0) {
      const topY = baseY - h;
      ctx.save();
      const iceGrad = ctx.createLinearGradient(cx - w * 0.5, topY, cx + w * 0.5, baseY);
      iceGrad.addColorStop(0, 'rgba(224, 247, 255, 0.78)');
      iceGrad.addColorStop(0.55, 'rgba(147, 213, 246, 0.62)');
      iceGrad.addColorStop(1, 'rgba(86, 168, 218, 0.70)');
      ctx.fillStyle = iceGrad;
      ctx.strokeStyle = '#1E4E79';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.52, topY + h * 0.12);
      ctx.lineTo(cx - w * 0.34, topY - 2);
      ctx.lineTo(cx + w * 0.34, topY - 2);
      ctx.lineTo(cx + w * 0.52, topY + h * 0.12);
      ctx.lineTo(cx + w * 0.42, baseY + 1);
      ctx.lineTo(cx - w * 0.42, baseY + 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 冰晶高光折线与冰裂纹
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.28, topY + 5);
      ctx.lineTo(cx - w * 0.08, topY + h * 0.45);
      ctx.lineTo(cx + w * 0.2, topY + h * 0.32);
      ctx.stroke();

      drawStatusPill(ctx, cx, baseY - h * 0.38, `冰×${bk.iceLayers}`, tokens, {
        bgHex: '#E0F2FE',
        borderHex: '#1E4E79',
        textColor: '#0C4A6E',
        fontSize: isFront ? 10 : 8.5,
        padX: 6,
        height: isFront ? 16 : 14,
      });
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * 手绘竖条箍木桶（兼容上层小卡槽与下层候选列尺寸）
   */
  private drawStorybookStaveBucket(
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
    customBadgeText?: string
  ): void {
    const ink = '#3E2311';
    const bounce = isPouringInto ? Math.sin(timeSec * 22) * 0.8 : 0;

    const topY = baseY - h + bounce;
    const rimRx = w * 0.5;
    const rimRy = Math.max(4.2, h * 0.12);
    const hoopH = Math.max(4.8, h * 0.13);
    const botRx = w * 0.36;
    const botRy = Math.max(3.4, h * 0.085);
    const botCy = baseY - botRy;

    const staveLight = isActive
      ? mixHex(shades.highlightHex, '#FFF4E0', 0.22)
      : mixHex(shades.highlightHex, '#FFFDF9', 0.14);
    const staveMid = shades.baseHex;
    const staveDark = mixHex(shades.shadowHex, '#5E3A22', 0.26);

    ctx.save();

    // 1. 底部投影
    ctx.fillStyle = isActive ? 'rgba(30, 14, 4, 0.34)' : 'rgba(30, 14, 4, 0.24)';
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 1.2, botRx * 1.12, botRy * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. 双侧弧形小挂耳
    for (const dir of [-1, 1]) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(2.4, w * 0.055);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + dir * (rimRx - 1), topY + rimRy + 2.5);
      ctx.quadraticCurveTo(
        cx + dir * (rimRx + 4.2),
        topY + h * 0.34,
        cx + dir * (botRx + 3.6),
        topY + h * 0.56
      );
      ctx.stroke();

      ctx.strokeStyle = mixHex(shades.baseHex, '#D99B52', 0.35);
      ctx.lineWidth = Math.max(1.1, w * 0.025);
      ctx.stroke();
    }

    // 3. 梯形圆底木桶主体
    const bodyGrad = ctx.createLinearGradient(cx - rimRx, topY, cx + rimRx, topY);
    bodyGrad.addColorStop(0, staveLight);
    bodyGrad.addColorStop(0.28, staveMid);
    bodyGrad.addColorStop(0.72, staveMid);
    bodyGrad.addColorStop(1, staveDark);

    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - rimRx + 1.2, topY + rimRy + 1.5);
    ctx.lineTo(cx - botRx, botCy);
    ctx.ellipse(cx, botCy, botRx, botRy, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rimRx - 1.2, topY + rimRy + 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 4. 竖向木桶板缝墨线
    const staveFracs = [-0.52, 0, 0.52];
    ctx.strokeStyle = 'rgba(62, 35, 17, 0.40)';
    ctx.lineWidth = 1.0;
    for (const f of staveFracs) {
      const xTop = cx + f * (rimRx - 2);
      const xBot = cx + f * (botRx - 1);
      const curveDip = Math.sqrt(Math.max(0, 1 - f * f)) * botRy * 0.9;
      ctx.beginPath();
      ctx.moveTo(xTop, topY + rimRy + hoopH * 0.65);
      ctx.lineTo(xBot, botCy + curveDip);
      ctx.stroke();
    }

    // 5. 桶口外翻箍圈
    const bandTopY = topY + rimRy * 0.35;
    const bandBotY = bandTopY + hoopH;
    const bandGrad = ctx.createLinearGradient(cx - rimRx, bandTopY, cx + rimRx, bandTopY);
    bandGrad.addColorStop(0, mixHex(shades.highlightHex, '#FFF5E0', 0.25));
    bandGrad.addColorStop(0.5, shades.baseHex);
    bandGrad.addColorStop(1, staveDark);

    ctx.fillStyle = bandGrad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(cx - rimRx - 0.8, bandTopY);
    ctx.lineTo(cx - rimRx + 0.5, bandBotY);
    ctx.ellipse(cx, bandBotY, rimRx - 0.5, rimRy * 0.9, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rimRx + 0.8, bandTopY);
    ctx.ellipse(cx, bandTopY, rimRx + 0.8, rimRy, 0, 0, Math.PI, false);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 6. 桶口俯视椭圆与深棕内腔
    const mouthCy = bandTopY;
    ctx.fillStyle = mixHex(shades.highlightHex, '#FFFDF8', 0.32);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.65;
    ctx.beginPath();
    ctx.ellipse(cx, mouthCy, rimRx + 0.8, rimRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const innerRx = Math.max(3, rimRx - 3.2);
    const innerRy = Math.max(2.2, rimRy - 1.8);
    ctx.fillStyle = mixHex(staveDark, '#3B2212', 0.58);
    ctx.beginPath();
    ctx.ellipse(cx, mouthCy + 0.3, innerRx, innerRy, 0, 0, Math.PI * 2);
    ctx.fill();

    // 7. 桶内动态颗粒沙堆
    if (pct > 0) {
      const ratio = Math.min(1, pct / 100);
      const mRx = innerRx * Math.min(0.98, 0.45 + ratio * 0.53);
      const mRy = innerRy * 0.88;
      const baseMoundY = mouthCy + innerRy * (0.42 - 0.30 * ratio);
      const peakH = 2.0 + ratio * (h * 0.17);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - innerRx - 2, mouthCy - peakH - 6);
      ctx.lineTo(cx + innerRx + 2, mouthCy - peakH - 6);
      ctx.lineTo(cx + innerRx + 2, mouthCy);
      ctx.ellipse(cx, mouthCy + 0.3, innerRx, innerRy, 0, 0, Math.PI, false);
      ctx.closePath();
      ctx.clip();

      const mGrad = ctx.createLinearGradient(cx, baseMoundY - peakH, cx, baseMoundY + mRy);
      mGrad.addColorStop(0, shades.highlightHex);
      mGrad.addColorStop(0.55, shades.baseHex);
      mGrad.addColorStop(1, shades.shadowHex);

      ctx.fillStyle = mGrad;
      ctx.strokeStyle = shades.outlineHex;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(cx - mRx, baseMoundY + 1.2);
      ctx.quadraticCurveTo(cx - mRx * 0.38, baseMoundY - peakH * 0.88, cx, baseMoundY - peakH);
      ctx.quadraticCurveTo(cx + mRx * 0.38, baseMoundY - peakH * 0.88, cx + mRx, baseMoundY + 1.2);
      ctx.ellipse(cx, baseMoundY + 1.2, mRx, mRy, 0, 0, Math.PI, false);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 8. 桶身正面纸签（激活槽百分比 / 问号盲桶封签）
    const badgeStr = customBadgeText ?? (pct > 0 || w >= 42 ? `${pct}%` : '');
    if (badgeStr) {
      const labelW = customBadgeText ? w * 0.50 : w * 0.64;
      const labelH = Math.max(13, h * 0.32);
      const labelCy = topY + h * 0.63;
      ctx.fillStyle = customBadgeText ? '#FFF7E2' : mixHex(shades.highlightHex, '#FFFDF7', 0.45);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      roundRectPath(ctx, cx - labelW * 0.5, labelCy - labelH * 0.5, labelW, labelH, 4);
      ctx.fill();
      ctx.stroke();

      drawInkText(ctx, badgeStr, cx, labelCy + 0.5, tokens, {
        font: `800 ${customBadgeText ? 12 : 9.5}px ${tokens.typography.numeralFontFamily}`,
        color: customBadgeText ? '#5A2D0C' : '#2E180A',
      });
    }

    ctx.restore();
  }

  /**
   * 绘制从宽底黄铜滤沙格栅实际吸沙横坐标 `sourceGridX` 倾泻入对应小卡槽木桶口的水粉流沙柱
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
    ctx.globalAlpha = Math.min(0.96, 0.45 + 0.52 * fade);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const steps = 12;
    const leftPts: [number, number][] = [];
    const rightPts: [number, number][] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      const px =
        u * u * u * spoutX +
        3 * u * u * t * c1x +
        3 * u * t * t * c2x +
        t * t * t * endX;
      const py =
        u * u * u * spoutY +
        3 * u * u * t * c1y +
        3 * u * t * t * c2y +
        t * t * t * endY;
      const halfW = (2.8 + (1 - t) * 1.4) * widthScale;
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
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // 流沙束中的下落微粒
    for (let k = 0; k < 7; k++) {
      const t = ((k / 7) + timeSec * 2.8) % 1;
      const u = 1 - t;
      const px =
        u * u * u * spoutX +
        3 * u * u * t * c1x +
        3 * u * t * t * c2x +
        t * t * t * endX;
      const py =
        u * u * u * spoutY +
        3 * u * u * t * c1y +
        3 * u * t * t * c2y +
        t * t * t * endY;
      ctx.fillStyle = k % 2 === 0 ? shades.highlightHex : shades.pebbleDarkHex;
      ctx.beginPath();
      ctx.arc(px, py, 0.95, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 底部四枚圆角双层嵌芯木框道具卡：撤回 / 磁吸满桶 / 加第5槽 / 候选洗牌
   */
  private renderPropBar(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    engine: SandEngine,
    rewardMgr: RewardManager,
    jamPulse: boolean,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    const pulsePhase = timeSec * 5.8;
    const canUndo = engine.snapshots.canUndo() && !engine.won;
    const magLeft = Math.max(0, 3 - engine.vacuumUsedCount);
    const canMagnet = engine.canUseMagnet();
    const fifthActive = engine.bucketSys.maxActiveSlots >= 5;
    const canExtraSlot = engine.bucketSys.canEnableExtraSlot() && !engine.won;
    const shufLeft = Math.max(0, 3 - engine.shuffleUsedCount);
    const canShuffle = engine.canUseShuffle();
    const freeQuota = rewardMgr.getFreeRemaining();

    const specs: {
      label: string;
      glyph: 'undo' | 'magnet' | 'extra_slot' | 'shuffle';
      disabled: boolean;
      pulse: boolean;
      medallion: string;
      medallionVariant: 'wood' | 'amber' | 'sage' | 'muted';
      subHint?: string;
    }[] = [
      {
        label: '撤回',
        glyph: 'undo',
        disabled: !canUndo,
        pulse: false,
        medallion: canUndo ? '+1' : '0',
        medallionVariant: canUndo ? 'wood' : 'muted',
        subHint: freeQuota === 0 && canUndo ? '分享' : undefined,
      },
      {
        label: '磁吸满桶',
        glyph: 'magnet',
        disabled: !canMagnet,
        pulse: jamPulse && canMagnet,
        medallion: String(magLeft),
        medallionVariant: magLeft === 0 ? 'muted' : jamPulse && canMagnet ? 'amber' : 'wood',
        subHint: freeQuota === 0 && magLeft > 0 ? '分享' : undefined,
      },
      {
        label: fifthActive ? '五槽中' : '加第5槽',
        glyph: 'extra_slot',
        disabled: !canExtraSlot && !fifthActive,
        pulse: jamPulse && canExtraSlot,
        medallion: fifthActive ? '✓' : '1',
        medallionVariant: fifthActive ? 'sage' : canExtraSlot ? 'wood' : 'muted',
        subHint: !fifthActive && freeQuota === 0 && canExtraSlot ? '分享' : undefined,
      },
      {
        label: '候选洗牌',
        glyph: 'shuffle',
        disabled: !canShuffle,
        pulse: jamPulse && canShuffle && engine.bucketSys.occupiedSlotCount < engine.bucketSys.maxActiveSlots,
        medallion: String(shufLeft),
        medallionVariant: shufLeft === 0 || !canShuffle ? 'muted' : 'wood',
        subHint: freeQuota === 0 && canShuffle ? '分享' : undefined,
      },
    ];

    specs.forEach((sp, idx) => {
      const btnRect = layout.propButtons[idx];
      const isPressed = this.pressedBtnIdx === idx;
      const inner = drawRecessedTileCard(ctx, btnRect, tokens, {
        variant: idx === 2 && fifthActive ? 'mint' : sp.pulse ? 'amber' : 'parchment',
        radius: 13,
        rimWidth: 3.8,
        pressed: isPressed,
        disabled: sp.disabled,
        pulse: sp.pulse,
        pulsePhase,
        medallionText: sp.medallion,
        medallionVariant: sp.medallionVariant,
        medallionRadius: 10.2,
      });

      ctx.save();
      if (sp.disabled) {
        ctx.globalAlpha = 0.62;
      }

      const iconSize = Math.min(28, inner.h * 0.54);
      const iconCy = inner.y + inner.h * 0.38;
      drawHandDrawnGlyph(ctx, sp.glyph, inner.x + inner.w * 0.5, iconCy, iconSize, tokens);

      drawInkText(
        ctx,
        sp.label,
        inner.x + inner.w * 0.5,
        inner.y + inner.h - 9,
        tokens,
        {
          font: `800 11px ${tokens.typography.fontFamily}`,
          color: '#3A1F0E',
          maxWidth: inner.w - 4,
        }
      );

      if (sp.subHint) {
        drawStatusPill(ctx, btnRect.x + 15, btnRect.y + 8, sp.subHint, tokens, {
          bgHex: '#E0F2FE',
          borderHex: '#0284C7',
          textColor: '#075985',
          fontSize: 8.5,
          padX: 6,
          height: 14,
        });
      }
      ctx.restore();
    });
  }

  /**
   * Stage 2 硬死局救援弹窗：当小卡槽塞满（或列首全冰封）且无任何同色沙可吸、无木栓可救时弹出
   */
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
    const pw = Math.min(332, layout.screenW - 28);
    const ph = 132 + actionCount * 48;
    const panel: Rect = {
      x: (layout.screenW - pw) * 0.5,
      y: Math.max(layout.topHudY + 44, (layout.screenH - ph) * 0.5 - 12),
      w: pw,
      h: ph,
    };

    drawParchmentModalFrame(ctx, layout.screenW, layout.screenH, panel, '小卡槽已塞满受阻', tokens, assets);

    drawInkText(
      ctx,
      '当前在槽木桶与滤网底沙颜色不匹配，',
      panel.x + pw * 0.5,
      panel.y + 56,
      tokens,
      {
        font: `700 12.5px ${tokens.typography.fontFamily}`,
        color: '#3E2311',
      }
    );
    drawInkText(
      ctx,
      '可任选以下木工道具破局或免费重玩本关：',
      panel.x + pw * 0.5,
      panel.y + 78,
      tokens,
      {
        font: `600 11.5px ${tokens.typography.fontFamily}`,
        color: '#6E4728',
      }
    );

    this.deadlockSlotBtnRect = null;
    this.deadlockMagnetBtnRect = null;
    this.deadlockUndoBtnRect = null;

    const btnW = pw - 44;
    const btnX = panel.x + 22;
    let curY = panel.y + 100;

    if (canSlot) {
      this.deadlockSlotBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
      drawWoodButton(ctx, this.deadlockSlotBtnRect, '+ 加开第 5 临时槽救援', tokens, assets, {
        fillHex: '#15803D',
        fontSize: 13,
      });
      curY += 47;
    }

    if (canMag) {
      this.deadlockMagnetBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
      drawWoodButton(ctx, this.deadlockMagnetBtnRect, '磁吸灌满 1 只在槽桶腾位', tokens, assets, {
        fillHex: '#C2410C',
        fontSize: 13,
      });
      curY += 47;
    }

    if (canUndo) {
      this.deadlockUndoBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
      drawWoodButton(ctx, this.deadlockUndoBtnRect, '撤回上一步操作', tokens, assets, {
        fillHex: '#0369A1',
        fontSize: 13,
      });
      curY += 47;
    }

    this.deadlockRestartBtnRect = { x: btnX, y: curY, w: btnW, h: 40 };
    drawWoodButton(ctx, this.deadlockRestartBtnRect, '免费重新挑战本关', tokens, assets, {
      fillHex: '#B45309',
      fontSize: 13,
    });
  }

  private renderRestartConfirmModal(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    const pw = Math.min(320, layout.screenW - 32);
    const ph = 192;
    const panel: Rect = {
      x: (layout.screenW - pw) * 0.5,
      y: (layout.screenH - ph) * 0.5,
      w: pw,
      h: ph,
    };
    drawParchmentModalFrame(ctx, layout.screenW, layout.screenH, panel, '确认重玩本关？', tokens, assets);

    drawInkText(ctx, '重玩将重置本关沙盘进度与暂存盲盒，', panel.x + pw * 0.5, panel.y + 62, tokens, {
      font: `700 13px ${tokens.typography.fontFamily}`,
      color: '#3E2311',
    });
    drawInkText(ctx, '确定要免费重新开始挑战吗？', panel.x + pw * 0.5, panel.y + 88, tokens, {
      font: `600 12.5px ${tokens.typography.fontFamily}`,
      color: '#6E4728',
    });

    const bw = 124;
    this.confirmCancelRect = { x: panel.x + 22, y: panel.y + ph - 56, w: bw, h: 42 };
    this.confirmOkRect = { x: panel.x + pw - 22 - bw, y: panel.y + ph - 56, w: bw, h: 42 };

    drawWoodButton(ctx, this.confirmCancelRect, '继续挑战', tokens, assets, { fillHex: '#15803D', fontSize: 13.5 });
    drawWoodButton(ctx, this.confirmOkRect, '确定重玩', tokens, assets, { fillHex: '#D97706', fontSize: 13.5 });
  }
}
