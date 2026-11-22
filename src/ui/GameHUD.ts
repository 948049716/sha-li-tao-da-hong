import type { BucketRuntime } from '../engine/BucketSystem';
import type { SandEngine } from '../engine/SandEngine';
import type { SandColorShades, SandRenderer } from '../engine/SandRenderer';
import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { RewardManager } from '../systems/RewardManager';
import type { SaveManager } from '../systems/SaveManager';
import type { SandColorId } from '../types/level';
import type { Rect, UiTokensFile } from '../types/ui';
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
} from './UIHelpers';

export type HudAction =
  | 'GO_HOME'
  | 'OPEN_DRAWER'
  | 'OPEN_GALLERY'
  | 'TAP_LOOT_BAG'
  | 'PROP_UNDO'
  | 'PROP_VACUUM'
  | 'PROP_EXTRA_SLOT'
  | 'PROP_RESTART_CONFIRMED';

interface CompletedBucketGhost {
  idx: number;
  color: SandColorId;
  x: number;
  timerMs: number; // 260 -> 0
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
 * 局内主界面（GameHUD）—— 1:1 严格遵循实机参考图 docs/assets/gameplay_ref.jpg：
 * 1. 顶栏双圈木镶边羊皮纸匾额与圆钮（主页圆钮 /「第 X 关」牌匾 / 身价藏馆匾 / 战利品兜）
 * 2. 底部木工坊实木接沙台面 + 严格对齐参考图的接沙桶顺序与空间逻辑：
 *    - 单槽态：当前激活接沙桶居中坐落于玻璃 V 形漏斗正下方（X = spoutX），流沙垂直倾泻入桶；
 *      后续待接桶严格在右侧按序排队（Next 1 位于右邻，Next 2 在屏幕右缘探出半身），满桶后右侧队列丝滑左移补位！
 *    - 双槽态（加开槽开启）：两只激活桶对称承接中央漏斗口（active[0] 左、active[1] 右），预告队列继续在右侧延伸，100% 保持从左至右单调顺序！
 * 3. 底栏四枚圆角双层嵌芯木框羊皮纸道具卡 + 手绘木雕图标 + 右上角圆形木币角标（撤回 / 吸尘器 / 加开槽 / 重玩）
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

  // 接沙桶传送带平滑补位状态
  private trackedSignature = '';
  private bucketVisualX = new Map<number, number>();
  private seenDoneSet = new Set<number>();
  private completedGhosts: CompletedBucketGhost[] = [];
  private lastDtMs = 16.6;

  public setMechanicBanner(text: string | null): void {
    this.mechanicBannerText = text;
    this.mechanicBannerTimerMs = text ? 4200 : 0;
  }

  public triggerLootBagBounce(): void {
    this.lootBagBounceMs = 280;
  }

  public update(dtMs: number, targetNetWorth: number): void {
    this.lastDtMs = dtMs;
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

  private getSpoutScreenX(layout: ComputedLayout): number {
    return layout.chamberRect.x + layout.chamberRect.w * (74.5 / 150);
  }

  /**
   * 计算接沙台面的木桶几何规格与目标中心 X（严格遵循 gameplay_ref.jpg 中央接沙 + 右侧排队顺序）
   */
  private getBucketMetrics(layout: ComputedLayout, activeCount: number): {
    spoutX: number;
    counterTopY: number;
    bucketBaseY: number;
    activeW: number;
    activeH: number;
    queueW: number;
    queueH: number;
    dualOffset: number;
    stepX: number;
  } {
    const r = layout.bucketRowRect;
    const compact = r.h <= 84;
    const spoutX = this.getSpoutScreenX(layout);
    const counterTopY = r.y + r.h - (compact ? 21 : 24);
    const bucketBaseY = counterTopY + 7;

    const isDualActive = activeCount >= 2;
    const activeW = isDualActive ? (compact ? 64 : 70) : compact ? 74 : 82;
    const activeH = isDualActive ? (compact ? 60 : 66) : compact ? 68 : 76;
    const queueW = compact ? 64 : 72;
    const queueH = compact ? 58 : 66;
    const dualOffset = Math.round(activeW * 0.60);
    const stepX = isDualActive
      ? Math.round(Math.max(78, layout.screenW * 0.225))
      : Math.round(Math.max(92, layout.screenW * 0.258));

    return {
      spoutX,
      counterTopY,
      bucketBaseY,
      activeW,
      activeH,
      queueW,
      queueH,
      dualOffset,
      stepX,
    };
  }

  /**
   * 计算指定激活桶槽位的桶口屏幕坐标（供吸沙飞线与漏斗流沙柱精准落入桶心）
   */
  public getActiveBucketMouthPos(
    layout: ComputedLayout,
    slotIdx: number,
    dualMode: boolean
  ): { x: number; y: number } {
    const m = this.getBucketMetrics(layout, dualMode ? 2 : 1);
    const mouthY = m.bucketBaseY - m.activeH + m.activeH * 0.14;
    if (!dualMode) {
      return { x: m.spoutX, y: mouthY };
    }
    const targetX = slotIdx === 0 ? m.spoutX - m.dualOffset : m.spoutX + m.dualOffset;
    return { x: targetX, y: mouthY };
  }

  public handleTap(
    px: number,
    py: number,
    layout: ComputedLayout,
    engine: SandEngine
  ): HudAction | 'CONSUMED' | null {
    if (this.showRestartConfirm) {
      if (hitRect(px, py, this.confirmCancelRect)) {
        this.showRestartConfirm = false;
        return 'CONSUMED';
      }
      if (hitRect(px, py, this.confirmOkRect)) {
        this.showRestartConfirm = false;
        return 'PROP_RESTART_CONFIRMED';
      }
      return 'CONSUMED';
    }

    if (hitRect(px, py, layout.homePill)) return 'GO_HOME';
    if (hitRect(px, py, layout.settingsPill)) return 'OPEN_DRAWER';
    if (hitRect(px, py, layout.netWorthPill)) return 'OPEN_GALLERY';
    if (hitRect(px, py, layout.lootBagPill)) return 'TAP_LOOT_BAG';

    if (hitRect(px, py, layout.propButtons[0])) return 'PROP_UNDO';
    if (hitRect(px, py, layout.propButtons[1])) return 'PROP_VACUUM';
    if (hitRect(px, py, layout.propButtons[2])) return 'PROP_EXTRA_SLOT';
    if (hitRect(px, py, layout.propButtons[3])) {
      const usedProps = engine.vacuumUsedCount > 0 || engine.bucketSys.maxActiveSlots > 1;
      if (usedProps || engine.lootBag.length > 0) {
        this.showRestartConfirm = true;
        return 'CONSUMED';
      }
      return 'PROP_RESTART_CONFIRMED';
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
    saveMgr: SaveManager,
    rewardMgr: RewardManager,
    hasCraftableRedDot: boolean,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    // ========================================================================
    // 1. 顶栏双圈木镶边牌匾与圆钮（复刻 gameplay_ref.jpg 顶栏精致手绘木镶羊皮纸风格）
    // ========================================================================
    const hp = layout.homePill;
    drawDoubleRimPlaque(ctx, hp, tokens, {
      variant: 'parchment',
      rimThickness: 3.6,
      radius: hp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'home', hp.x + hp.w * 0.5, hp.y + hp.h * 0.5 + 0.5, 19, tokens);

    // 关卡与设置主牌匾（对齐 gameplay_ref.jpg「第 8 关」奶油羊皮纸木框匾额）
    const sp = layout.settingsPill;
    const spInner = drawDoubleRimPlaque(ctx, sp, tokens, {
      variant: 'parchment',
      rimThickness: 3.8,
      radius: sp.h * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'gear', spInner.x + 12, sp.y + sp.h * 0.5, 15, tokens);
    drawInkText(
      ctx,
      `第 ${engine.level.levelId} 关`,
      spInner.x + spInner.w * 0.5 + 6,
      sp.y + sp.h * 0.5 + 0.5,
      tokens,
      {
        font: `800 13px ${tokens.typography.fontFamily}`,
        color: '#3E2311',
        maxWidth: spInner.w - 22,
      }
    );

    // 身价与大红藏馆入口牌匾
    const np = layout.netWorthPill;
    const npInner = drawDoubleRimPlaque(ctx, np, tokens, {
      variant: 'amber',
      rimThickness: 3.6,
      radius: np.h * 0.5,
    });
    const rank = saveMgr.getRankBadge(tokens);
    const badgeImg =
      rank.level >= 6
        ? assets.get('ui_badge_collector')
        : assets.get('ui_networth_coin') || assets.getTinted('ui_badge_rank_base', rank.tintHex);
    if (badgeImg) {
      ctx.drawImage(badgeImg, npInner.x + 4, np.y + (np.h - 20) * 0.5, 20, 20);
    }
    drawInkText(
      ctx,
      formatNetWorth(this.displayedNetWorth),
      npInner.x + npInner.w * 0.5 + 8,
      np.y + np.h * 0.5 + 0.5,
      tokens,
      {
        font: `800 12.5px ${tokens.typography.numeralFontFamily}`,
        color: '#5A2E0E',
        maxWidth: npInner.w - 26,
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

    // 右侧本关战利品盲盒袋
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
      { variant: 'parchment', rimThickness: 3.6, radius: lp.h * 0.5 }
    );
    const bagImg = assets.get('ui_loot_bag');
    if (bagImg) {
      ctx.drawImage(bagImg, -lp.w * 0.5 + 5, -13, 25, 25);
    }
    drawInkText(ctx, `×${engine.lootBag.length}`, 10, 0.5, tokens, {
      font: `800 12.5px ${tokens.typography.numeralFontFamily}`,
      color: '#3E2311',
    });
    ctx.restore();

    // ========================================================================
    // 2. 顶部新机关微横幅 & 底部异色堵口预警条
    // ========================================================================
    if (this.mechanicBannerText && this.mechanicBannerTimerMs > 0 && engine.boardsPulledCount === 0) {
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
        font: `700 11px ${tokens.typography.fontFamily}`,
        color: '#4A2A12',
        maxWidth: bw - 18,
      });
      ctx.restore();
    }

    const clogActive = engine.bucketSys.clogWarningActive;
    if (clogActive && !engine.won) {
      const cw = Math.min(320, layout.chamberRect.w - 14);
      const cx = (layout.screenW - cw) * 0.5;
      const cy = layout.chamberRect.y + layout.chamberRect.h - 46;
      drawDoubleRimPlaque(ctx, { x: cx, y: cy, w: cw, h: 32 }, tokens, {
        variant: 'amber',
        rimThickness: 3.2,
        radius: 16,
      });
      const warnImg = assets.get('ui_jam_warning');
      if (warnImg) {
        ctx.drawImage(warnImg, cx + 9, cy + 4, 23, 23);
      }
      drawInkText(ctx, '漏斗口被异色沙堵住啦！可抽板、吸尘或加开槽', cx + cw * 0.5 + 10, cy + 16.5, tokens, {
        font: `700 11px ${tokens.typography.fontFamily}`,
        color: '#8C2D12',
        maxWidth: cw - 38,
      });
    }

    // ========================================================================
    // 3. 木工接沙台面 + 严格遵循参考图的接沙桶队列 + 连贯流沙柱
    // ========================================================================
    const rainbowDrain = saveMgr.data.equippedSuctionFxId === 'fx_rainbow_drain';
    this.renderWorkbenchAndBuckets(ctx, layout, engine, sandRenderer, tokens, timeSec, rainbowDrain);

    // ========================================================================
    // 4. 底部四枚圆角双层嵌芯木框道具卡（1:1 对齐 gameplay_ref.jpg 底栏）
    // ========================================================================
    this.renderPropBar(ctx, layout, engine, rewardMgr, clogActive, tokens, timeSec);

    if (this.showRestartConfirm) {
      this.renderRestartConfirmModal(ctx, layout, assets, tokens);
    }
  }

  private syncBucketConveyorState(layout: ComputedLayout, engine: SandEngine): {
    ordered: BucketRuntime[];
    activeSet: Set<number>;
    metrics: ReturnType<GameHUD['getBucketMetrics']>;
  } {
    const active = engine.bucketSys.active.filter(b => !b.done);
    const waiting = engine.bucketSys.buckets.slice(engine.bucketSys.queuePtr).filter(b => !b.done);
    const ordered: BucketRuntime[] = [...active];
    for (const wb of waiting) {
      if (!ordered.some(x => x.idx === wb.idx)) {
        ordered.push(wb);
      }
    }

    const activeSet = new Set(active.map(b => b.idx));
    const metrics = this.getBucketMetrics(layout, active.length);

    const sig = `${engine.level.levelId}|${engine.bucketSys.buckets.length}`;
    const isFreshLevel =
      sig !== this.trackedSignature ||
      (engine.frame <= 2 && engine.boardsPulledCount === 0 && engine.bucketSys.buckets.every(b => !b.done));

    const computeTargetX = (posInOrdered: number): number => {
      if (active.length >= 2) {
        if (posInOrdered === 0) return metrics.spoutX - metrics.dualOffset;
        if (posInOrdered === 1) return metrics.spoutX + metrics.dualOffset;
        return metrics.spoutX + metrics.dualOffset + (posInOrdered - 1) * metrics.stepX;
      }
      // 标准单槽模式：第 0 号激活桶死死居中在漏斗正下方，后续第 1、2... 号依次向右排队！
      return metrics.spoutX + posInOrdered * metrics.stepX;
    };

    if (isFreshLevel) {
      this.trackedSignature = sig;
      this.bucketVisualX.clear();
      this.seenDoneSet.clear();
      this.completedGhosts = [];
      ordered.forEach((bk, idx) => {
        this.bucketVisualX.set(bk.idx, computeTargetX(idx));
      });
      return { ordered, activeSet, metrics };
    }

    // 检测刚满桶完成的木桶，生成原地欢庆上浮残影，同时右侧队列平滑左滑入中央位
    for (const bk of engine.bucketSys.buckets) {
      if (bk.done && !this.seenDoneSet.has(bk.idx)) {
        this.seenDoneSet.add(bk.idx);
        const lastX = this.bucketVisualX.get(bk.idx) ?? metrics.spoutX;
        this.completedGhosts.push({
          idx: bk.idx,
          color: bk.color,
          x: lastX,
          timerMs: 250,
        });
      } else if (!bk.done && this.seenDoneSet.has(bk.idx)) {
        // 撤回恢复了已完成桶
        this.seenDoneSet.delete(bk.idx);
      }
    }

    const lerpFactor = 1 - Math.exp(-Math.max(8, this.lastDtMs) / 62);
    ordered.forEach((bk, posIdx) => {
      const tx = computeTargetX(posIdx);
      const prevX = this.bucketVisualX.get(bk.idx);
      if (prevX === undefined) {
        // 新滚入视野右侧边缘的待接桶从更右侧平滑滑入
        this.bucketVisualX.set(bk.idx, tx + metrics.stepX * 0.65);
      } else {
        const nextX = Math.abs(tx - prevX) < 0.4 ? tx : prevX + (tx - prevX) * lerpFactor;
        this.bucketVisualX.set(bk.idx, nextX);
      }
    });

    return { ordered, activeSet, metrics };
  }

  private renderWorkbenchAndBuckets(
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
    const { ordered, activeSet, metrics } = this.syncBucketConveyorState(layout, engine);
    const { counterTopY, bucketBaseY, spoutX } = metrics;

    // 1. 绘制实木工作台面与下方深胡桃木道具柜裙板（1:1 复刻 gameplay_ref.jpg 底部木台透视结构）
    ctx.save();
    // 台面后上方微暗景深过渡（衬托彩色木桶轮廓）
    const backShadow = ctx.createLinearGradient(0, counterTopY - 26, 0, counterTopY);
    backShadow.addColorStop(0, 'rgba(28, 15, 6, 0)');
    backShadow.addColorStop(1, 'rgba(28, 15, 6, 0.26)');
    ctx.fillStyle = backShadow;
    ctx.fillRect(0, counterTopY - 26, W, 26);

    // 桌面水平透视顶板（counterTopY .. counterTopY + 13）
    const plankH = 13;
    const lipH = 8;
    const topPlankGrad = ctx.createLinearGradient(0, counterTopY, 0, counterTopY + plankH);
    topPlankGrad.addColorStop(0, '#DFAA6E');
    topPlankGrad.addColorStop(0.55, '#C88D50');
    topPlankGrad.addColorStop(1, '#AE7238');
    ctx.fillStyle = topPlankGrad;
    ctx.fillRect(0, counterTopY, W, plankH);

    // 桌面木纹横线与高光棱
    ctx.strokeStyle = '#3E2311';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(0, counterTopY);
    ctx.lineTo(W, counterTopY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 244, 218, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, counterTopY + 2);
    ctx.lineTo(W, counterTopY + 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(92, 50, 20, 0.28)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(18, counterTopY + 7);
    ctx.lineTo(W * 0.36, counterTopY + 7);
    ctx.moveTo(W * 0.58, counterTopY + 8);
    ctx.lineTo(W - 14, counterTopY + 8);
    ctx.stroke();

    // 桌沿立体前唇（counterTopY + plankH .. + lipH）
    const lipY = counterTopY + plankH;
    const lipGrad = ctx.createLinearGradient(0, lipY, 0, lipY + lipH);
    lipGrad.addColorStop(0, '#9C612D');
    lipGrad.addColorStop(1, '#6E3F19');
    ctx.fillStyle = lipGrad;
    ctx.fillRect(0, lipY, W, lipH);

    ctx.strokeStyle = '#3E2311';
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(0, lipY);
    ctx.lineTo(W, lipY);
    ctx.moveTo(0, lipY + lipH);
    ctx.lineTo(W, lipY + lipH);
    ctx.stroke();

    // 下方深胡桃木道具栏柜体背板
    const apronY = lipY + lipH;
    const apronGrad = ctx.createLinearGradient(0, apronY, 0, H);
    apronGrad.addColorStop(0, '#6B4121');
    apronGrad.addColorStop(0.35, '#593419');
    apronGrad.addColorStop(1, '#442611');
    ctx.fillStyle = apronGrad;
    ctx.fillRect(0, apronY, W, Math.max(0, H - apronY));
    ctx.restore();

    // 2. 左侧空旷台面角微缩余桶序列提示签（既不破坏右侧排队实木桶，又让解谜玩家看清完整后续颜色序列）
    const totalRemaining = ordered.length;
    const activeCount = activeSet.size;
    const waitingBuckets = ordered.slice(activeCount);
    const leftSafeMaxX =
      (activeCount >= 2 ? spoutX - metrics.dualOffset : spoutX) - metrics.activeW * 0.5 - 10;

    if (waitingBuckets.length > 0 && leftSafeMaxX >= 84) {
      const chipW = Math.min(112, leftSafeMaxX - 10);
      const chipH = 38;
      const chipX = 10;
      const chipY = counterTopY - chipH - 6;

      ctx.save();
      drawDoubleRimPlaque(ctx, { x: chipX, y: chipY, w: chipW, h: chipH }, tokens, {
        variant: 'parchment',
        rimThickness: 2.8,
        radius: 11,
      });

      drawInkText(ctx, `后续 ${waitingBuckets.length} 桶`, chipX + chipW * 0.5, chipY + 12, tokens, {
        font: `700 9.5px ${tokens.typography.fontFamily}`,
        color: '#5C3518',
      });

      // 按严格从左到右队列顺序展示接下来至多 5 颗彩桶色珠
      const showDots = waitingBuckets.slice(0, 5);
      const dotR = 4.5;
      const dotStep = Math.min(14, (chipW - 18) / Math.max(1, showDots.length));
      const dotsStartX = chipX + (chipW - (showDots.length - 1) * dotStep) * 0.5;
      const dotsY = chipY + 26.5;
      showDots.forEach((wb, idx) => {
        const dx = dotsStartX + idx * dotStep;
        const hex = sandRenderer.getSandColorHex(wb.color, tokens);
        ctx.fillStyle = hex;
        ctx.strokeStyle = '#3E2311';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(dx, dotsY, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();
    } else if (totalRemaining === 0) {
      drawStatusPill(ctx, spoutX, counterTopY - 28, '✓ 全部彩桶已装满清罐！', tokens, {
        bgHex: '#ECFDF3',
        borderHex: '#2F6F3E',
        textColor: '#1E562B',
        fontSize: 11.5,
      });
    }

    // 3. 从右向左逆序先画右侧预告排队桶，再画中央激活主桶（保证相邻边缘透视遮挡自然正确）
    const visibleOrdered = ordered.slice(0, 5);
    for (let i = visibleOrdered.length - 1; i >= 0; i--) {
      const bk = visibleOrdered[i];
      const vx = this.bucketVisualX.get(bk.idx) ?? spoutX + i * metrics.stepX;
      const isAct = activeSet.has(bk.idx);
      const bw = isAct ? metrics.activeW : metrics.queueW;
      const bh = isAct ? metrics.activeH : metrics.queueH;

      // 屏幕右侧完全越界外的预备桶无需绘制
      if (vx - bw * 0.6 > W + 8) continue;

      const pct = Math.min(100, Math.floor((bk.cur / Math.max(1, bk.max)) * 100));
      const shades = sandRenderer.getSandShades(bk.color);
      const isReceivingNow =
        isAct &&
        engine.pourStreamMs > 0 &&
        ordered.indexOf(bk) === engine.pourStreamSlot;

      this.drawStorybookStaveBucket(
        ctx,
        vx,
        bucketBaseY,
        bw,
        bh,
        pct,
        shades,
        isAct,
        isReceivingNow,
        tokens,
        timeSec
      );
    }

    // 4. 绘制满桶瞬间的欢庆弹升光效残影
    for (const gh of this.completedGhosts) {
      const p = 1 - gh.timerMs / 250;
      const liftY = -22 * Math.sin(p * Math.PI * 0.85);
      const alpha = Math.max(0, 1 - p);
      const shades = sandRenderer.getSandShades(gh.color);
      ctx.save();
      ctx.globalAlpha = alpha;
      drawStatusPill(ctx, gh.x, bucketBaseY - metrics.activeH - 10 + liftY, '100% 满桶✦', tokens, {
        bgHex: shades.highlightHex,
        borderHex: '#3E2311',
        textColor: '#3E2311',
        fontSize: 10.5,
      });
      ctx.restore();
    }

    // 5. 绘制从玻璃沙箱 V 形漏斗口垂直倾泻入激活桶心的连贯颗粒流沙柱
    if (engine.pourStreamMs > 0 && engine.pourStreamColor) {
      const targetBk = engine.bucketSys.active[engine.pourStreamSlot];
      const liveMouthX = targetBk
        ? (this.bucketVisualX.get(targetBk.idx) ?? spoutX)
        : spoutX;
      const liveMouthY = bucketBaseY - metrics.activeH + metrics.activeH * 0.14;
      this.renderPouringSandStream(
        ctx,
        layout,
        engine,
        sandRenderer,
        liveMouthX,
        liveMouthY,
        timeSec,
        rainbowDrain
      );
    }
  }

  /**
   * 1:1 复刻 gameplay_ref.jpg 手绘竖条箍木桶：
   * - 上宽下窄圆锥透视桶身 + 5 道手绘竖向木桶板缝 + 左右双耳弧形提手
   * - 空桶时露出深色真实桶腔，装沙时随进度抬升水粉颗粒沙尖
   * - 激活桶正面贴有同色弧面梯形百分比纸签（如「75%」）
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
    timeSec: number
  ): void {
    const ink = '#3E2311';
    const bounce = isPouringInto ? Math.sin(timeSec * 22) * 0.9 : 0;

    const topY = baseY - h + bounce;
    const rimRx = w * 0.5;
    const rimRy = Math.max(6.5, h * 0.12);
    const hoopH = Math.max(7, h * 0.13);
    const botRx = w * 0.36;
    const botRy = Math.max(4.8, h * 0.085);
    const botCy = baseY - botRy;

    // 调配绘本木染水彩色阶（激活桶融入蜂蜜暖雪松木光泽，排队桶呈柔和粉彩木漆质感，1:1 对齐参考图！）
    const staveLight = isActive
      ? mixHex(shades.highlightHex, '#F2C594', 0.30)
      : mixHex(shades.highlightHex, '#FFFDF9', 0.15);
    const staveMid = isActive
      ? mixHex(shades.baseHex, '#CE8B54', 0.34)
      : shades.baseHex;
    const staveDark = isActive
      ? mixHex(shades.shadowHex, '#8A4E24', 0.42)
      : mixHex(shades.shadowHex, '#5E3A22', 0.22);

    ctx.save();

    // 1. 工作台面接触椭圆阴影
    ctx.fillStyle = isActive ? 'rgba(30, 14, 4, 0.38)' : 'rgba(30, 14, 4, 0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 1.5, botRx * 1.14, botRy * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. 左右两侧弧形挂耳提手（如 gameplay_ref.jpg 桶侧垂下的弯耳）
    for (const dir of [-1, 1]) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + dir * (rimRx - 1), topY + rimRy + 4);
      ctx.quadraticCurveTo(
        cx + dir * (rimRx + 6.5),
        topY + h * 0.34,
        cx + dir * (botRx + 5.5),
        topY + h * 0.56
      );
      ctx.stroke();

      ctx.strokeStyle = mixHex(shades.baseHex, '#D99B52', 0.35);
      ctx.lineWidth = 1.7;
      ctx.stroke();
    }

    // 3. 上宽下窄梯形圆底木桶主体
    const bodyGrad = ctx.createLinearGradient(cx - rimRx, topY, cx + rimRx, topY);
    bodyGrad.addColorStop(0, staveLight);
    bodyGrad.addColorStop(0.28, staveMid);
    bodyGrad.addColorStop(0.72, staveMid);
    bodyGrad.addColorStop(1, staveDark);

    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.05;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - rimRx + 1.5, topY + rimRy + 2);
    ctx.lineTo(cx - botRx, botCy);
    ctx.ellipse(cx, botCy, botRx, botRy, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rimRx - 1.5, topY + rimRy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 4. 竖向木桶板缝手绘细墨线（沿圆锥透视向桶底收束）
    const staveFracs = [-0.58, -0.28, 0.04, 0.34, 0.64];
    ctx.save();
    ctx.strokeStyle = 'rgba(62, 35, 17, 0.44)';
    ctx.lineWidth = 1.15;
    for (const f of staveFracs) {
      const xTop = cx + f * (rimRx - 2);
      const xBot = cx + f * (botRx - 1);
      const curveDip = Math.sqrt(Math.max(0, 1 - f * f)) * botRy * 0.92;
      ctx.beginPath();
      ctx.moveTo(xTop, topY + rimRy + hoopH * 0.65);
      ctx.lineTo(xBot, botCy + curveDip);
      ctx.stroke();
    }
    ctx.restore();

    // 5. 桶口外翻厚箍圈侧面（Upper Barrel Rim Band）
    const bandTopY = topY + rimRy * 0.35;
    const bandBotY = bandTopY + hoopH;
    const bandGrad = ctx.createLinearGradient(cx - rimRx, bandTopY, cx + rimRx, bandTopY);
    bandGrad.addColorStop(0, mixHex(shades.highlightHex, '#FFF5E0', 0.25));
    bandGrad.addColorStop(0.5, shades.baseHex);
    bandGrad.addColorStop(1, staveDark);

    ctx.fillStyle = bandGrad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.95;
    ctx.beginPath();
    ctx.moveTo(cx - rimRx - 1, bandTopY);
    ctx.lineTo(cx - rimRx + 0.6, bandBotY);
    ctx.ellipse(cx, bandBotY, rimRx - 0.6, rimRy * 0.92, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rimRx + 1, bandTopY);
    ctx.ellipse(cx, bandTopY, rimRx + 1, rimRy, 0, 0, Math.PI, false);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 6. 桶口俯视椭圆外唇 + 深棕内腔暗部
    const mouthCy = bandTopY;
    ctx.fillStyle = mixHex(shades.highlightHex, '#FFFDF8', 0.32);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.95;
    ctx.beginPath();
    ctx.ellipse(cx, mouthCy, rimRx + 1, rimRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const innerRx = rimRx - 4.2;
    const innerRy = Math.max(3.6, rimRy - 2.4);
    const cavityGrad = ctx.createLinearGradient(cx, mouthCy - innerRy, cx, mouthCy + innerRy);
    cavityGrad.addColorStop(0, mixHex(staveDark, '#3B2212', 0.58));
    cavityGrad.addColorStop(1, mixHex(staveMid, '#6E4427', 0.38));
    ctx.fillStyle = cavityGrad;
    ctx.strokeStyle = 'rgba(62, 35, 17, 0.70)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(cx, mouthCy + 0.4, innerRx, innerRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 7. 桶内动态颗粒沙堆（pct === 0 时真实空桶无假沙；pct > 0 时堆起圆锥水粉沙尖！）
    if (pct > 0) {
      const ratio = Math.min(1, pct / 100);
      const mRx = innerRx * Math.min(0.98, 0.42 + ratio * 0.56);
      const mRy = innerRy * 0.88;
      const baseMoundY = mouthCy + innerRy * (0.45 - 0.32 * ratio);
      const peakH = 2.5 + ratio * (h * 0.165);

      ctx.save();
      // 裁剪下半椭圆不越出桶口前唇，上半锥尖自由高出桶沿！
      ctx.beginPath();
      ctx.moveTo(cx - innerRx - 2, mouthCy - peakH - 8);
      ctx.lineTo(cx + innerRx + 2, mouthCy - peakH - 8);
      ctx.lineTo(cx + innerRx + 2, mouthCy);
      ctx.ellipse(cx, mouthCy + 0.4, innerRx, innerRy, 0, 0, Math.PI, false);
      ctx.closePath();
      ctx.clip();

      const mGrad = ctx.createLinearGradient(cx, baseMoundY - peakH, cx, baseMoundY + mRy);
      mGrad.addColorStop(0, shades.highlightHex);
      mGrad.addColorStop(0.55, shades.baseHex);
      mGrad.addColorStop(1, shades.shadowHex);

      ctx.fillStyle = mGrad;
      ctx.strokeStyle = shades.outlineHex;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(cx - mRx, baseMoundY + 1.5);
      ctx.quadraticCurveTo(cx - mRx * 0.38, baseMoundY - peakH * 0.88, cx, baseMoundY - peakH);
      ctx.quadraticCurveTo(cx + mRx * 0.38, baseMoundY - peakH * 0.88, cx + mRx, baseMoundY + 1.5);
      ctx.ellipse(cx, baseMoundY + 1.5, mRx, mRy, 0, 0, Math.PI, false);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 沙堆颗粒点缀
      for (let gIdx = 0; gIdx < 7; gIdx++) {
        const gxOff = ((gIdx - 3) * 0.24 + Math.sin(gIdx * 2.3) * 0.06) * mRx;
        const gyOff = -peakH * (0.18 + ((gIdx * 31) % 5) * 0.13);
        ctx.fillStyle = gIdx % 3 === 0 ? '#FFFDF5' : shades.pebbleDarkHex;
        ctx.beginPath();
        ctx.arc(cx + gxOff, baseMoundY + gyOff, gIdx % 3 === 0 ? 1.05 : 0.95, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 复描前侧桶口细唇线，令沙堆真实“坐”在桶腔之内
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.65;
      ctx.beginPath();
      ctx.ellipse(cx, mouthCy, rimRx + 1, rimRy, 0, 0.08 * Math.PI, 0.92 * Math.PI, false);
      ctx.stroke();
    }

    // 8. 桶身正面贴合弧形梯形百分比铭牌（1:1 严格还原 gameplay_ref.jpg 粉桶正面「75%」贴签！）
    if (isActive || pct > 0) {
      const labelW = isActive ? w * 0.56 : w * 0.46;
      const labelBotW = labelW * 0.88;
      const labelH = isActive ? Math.max(19, h * 0.28) : 16;
      const labelCy = topY + h * 0.63;
      const lyTop = labelCy - labelH * 0.5;
      const lyBot = labelCy + labelH * 0.5;
      const curveSag = 2.4;

      const badgeFill = mixHex(shades.highlightHex, shades.baseHex, 0.48);
      ctx.fillStyle = badgeFill;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.65;
      ctx.beginPath();
      ctx.moveTo(cx - labelW * 0.5, lyTop);
      ctx.quadraticCurveTo(cx, lyTop + curveSag, cx + labelW * 0.5, lyTop);
      ctx.lineTo(cx + labelBotW * 0.5, lyBot);
      ctx.quadraticCurveTo(cx, lyBot + curveSag, cx - labelBotW * 0.5, lyBot);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 贴签内侧细高光边
      ctx.strokeStyle = 'rgba(255, 253, 246, 0.55)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(cx - labelW * 0.5 + 2, lyTop + 2);
      ctx.quadraticCurveTo(cx, lyTop + curveSag + 2, cx + labelW * 0.5 - 2, lyTop + 2);
      ctx.stroke();

      drawInkText(ctx, `${pct}%`, cx, labelCy + curveSag * 0.45 + 0.5, tokens, {
        font: `800 ${isActive ? 13 : 10.5}px ${tokens.typography.numeralFontFamily}`,
        color: '#2E180A',
        embossColor: 'rgba(255, 253, 246, 0.65)',
      });
    }

    ctx.restore();
  }

  /**
   * 绘制从玻璃沙箱底部 V 形漏斗口垂直倾泻至激活木桶心的绘本颗粒流沙柱
   */
  private renderPouringSandStream(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    engine: SandEngine,
    sandRenderer: SandRenderer,
    endX: number,
    endY: number,
    timeSec: number,
    rainbowDrain: boolean
  ): void {
    const cid = engine.pourStreamColor;
    if (!cid) return;

    const ch = layout.chamberRect;
    const shakeY = engine.screenShakeMs > 0 ? Math.sin(engine.frame * 1.8) * 3 : 0;
    const spoutX = ch.x + ch.w * (74.5 / 150);
    const spoutY = ch.y + shakeY + ch.h * (163.8 / 165);
    const spoutHalfW = 5.1 * (ch.w / 150);

    const fade = Math.min(1, engine.pourStreamMs / 75);
    const widthScale = 0.78 + 0.22 * fade;
    const dy = Math.max(14, endY - spoutY);
    const c1x = spoutX;
    const c1y = spoutY + dy * 0.52;
    const c2x = endX;
    const c2y = spoutY + dy * 0.46;

    const shades = sandRenderer.getSandShades(cid);

    ctx.save();
    ctx.globalAlpha = Math.min(0.98, 0.42 + 0.58 * fade);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const steps = 16;
    const leftPts: [number, number][] = [];
    const rightPts: [number, number][] = [];
    const centerPts: [number, number][] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      const px =
        u * u * u * spoutX +
        3 * u * u * t * c1x +
        3 * u * t * t * c2x +
        t * t * t * endX;
      const py =
        u * u * u * (spoutY - 1.5) +
        3 * u * u * t * c1y +
        3 * u * t * t * c2y +
        t * t * t * endY;
      const tx =
        3 * u * u * (c1x - spoutX) +
        6 * u * t * (c2x - c1x) +
        3 * t * t * (endX - c2x);
      const ty =
        3 * u * u * (c1y - (spoutY - 1.5)) +
        6 * u * t * (c2y - c1y) +
        3 * t * t * (endY - c2y);
      const tLen = Math.hypot(tx, ty) || 1;
      const nx = -ty / tLen;
      const ny = tx / tLen;

      const funnelTaper = Math.pow(1 - t, 2.1) * Math.max(2, spoutHalfW - 3.4);
      const flare = Math.pow(t, 2.8) * 1.8;
      const halfW = (3.4 + funnelTaper + flare) * widthScale;

      centerPts.push([px, py]);
      leftPts.push([px - nx * halfW, py - ny * halfW]);
      rightPts.push([px + nx * halfW, py + ny * halfW]);
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
      const sGrad = ctx.createLinearGradient(spoutX - 7, spoutY, endX + 7, endY);
      sGrad.addColorStop(0, shades.baseHex);
      sGrad.addColorStop(0.5, shades.highlightHex);
      sGrad.addColorStop(1, shades.baseHex);
      ctx.fillStyle = sGrad;
    }
    ctx.fill();

    ctx.strokeStyle = shades.outlineHex;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(leftPts[0][0], leftPts[0][1]);
    for (let s = 1; s <= steps; s++) ctx.lineTo(leftPts[s][0], leftPts[s][1]);
    ctx.moveTo(rightPts[0][0], rightPts[0][1]);
    for (let s = 1; s <= steps; s++) ctx.lineTo(rightPts[s][0], rightPts[s][1]);
    ctx.stroke();

    ctx.strokeStyle = shades.highlightHex;
    ctx.lineWidth = 2.0 * widthScale;
    ctx.beginPath();
    ctx.moveTo(centerPts[1][0], centerPts[1][1]);
    for (let s = 2; s < steps; s++) ctx.lineTo(centerPts[s][0], centerPts[s][1]);
    ctx.stroke();

    // 沿流沙柱重力加速坠落的细腻砂砾点（二次参数化：出口处密集缓慢 → 落桶前稀疏高速，呈现真实自由落体）
    const flow = Math.min(1, engine.lastFlowParticles / 26);
    const grainCount = 12 + Math.round(flow * 8);
    for (let k = 0; k < grainCount; k++) {
      const tLin = ((k / grainCount) + timeSec * (2.4 + flow * 1.2)) % 1;
      const t = tLin * tLin * 0.72 + tLin * 0.28;
      const u = 1 - t;
      const lateral = Math.sin(k * 2.7 + timeSec * 10) * (0.8 + 1.4 * t) * widthScale;
      const px =
        u * u * u * spoutX +
        3 * u * u * t * c1x +
        3 * u * t * t * c2x +
        t * t * t * endX +
        lateral;
      const py =
        u * u * u * (spoutY - 2) +
        3 * u * u * t * c1y +
        3 * u * t * t * c2y +
        t * t * t * endY;
      ctx.fillStyle = k % 3 === 0 ? shades.highlightHex : shades.pebbleDarkHex;
      const r = k % 4 === 0 ? 1.2 : 0.9;
      // 高速段沿运动方向拉长成短促的动态模糊残影
      const stretch = 1 + t * t * 2.2;
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * stretch, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 落桶口冲击飞溅：抛物线溅起的沙粒 + 扩散涟漪（强度随实时出沙量变化）
    const splashN = 4 + Math.round(flow * 5);
    for (let k = 0; k < splashN; k++) {
      const ph = ((k / splashN) + timeSec * 2.1 + k * 0.137) % 1;
      const side = k % 2 === 0 ? -1 : 1;
      const reach = (5 + (k % 3) * 3.2) * (0.6 + 0.4 * fade) * (0.7 + 0.5 * flow);
      const hop = (4.5 + (k % 4) * 1.6) * (0.65 + 0.55 * flow);
      const sxp = endX + side * reach * ph;
      const syp = endY - Math.sin(ph * Math.PI) * hop;
      ctx.globalAlpha = Math.min(0.95, (1 - ph) * (0.55 + 0.4 * fade));
      ctx.fillStyle = k % 3 === 0 ? shades.highlightHex : shades.baseHex;
      ctx.beginPath();
      ctx.arc(sxp, syp, k % 3 === 0 ? 1.15 : 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
    const ripplePh = (timeSec * 2.6) % 1;
    ctx.globalAlpha = (1 - ripplePh) * 0.42 * fade;
    ctx.strokeStyle = shades.outlineHex;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(endX, endY + 0.5, 3.5 + ripplePh * (7 + flow * 5), 1.2 + ripplePh * 2.2, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 1:1 复刻 gameplay_ref.jpg 底部四枚圆角双层嵌芯木框道具卡：
   * 奶油羊皮纸卡面 + 手绘木雕图标 + 浓棕压印文字 + 右上角压边圆形木币角标
   */
  private renderPropBar(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    engine: SandEngine,
    rewardMgr: RewardManager,
    clogActive: boolean,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    const pulsePhase = timeSec * 5.8;
    const canUndo = engine.snapshots.canUndo() && !engine.won;
    const vacLeft = Math.max(0, 3 - engine.vacuumUsedCount);
    const canVacuum = engine.canUseVacuum();
    const slotActive = engine.bucketSys.maxActiveSlots >= 2;
    const canExtraSlot = engine.bucketSys.canEnableExtraSlot() && !engine.won;
    const freeQuota = rewardMgr.getFreeRemaining();

    const specs: {
      label: string;
      glyph: 'undo' | 'vacuum' | 'extra_slot' | 'restart';
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
        label: '吸尘器',
        glyph: 'vacuum',
        disabled: !canVacuum,
        pulse: clogActive && canVacuum,
        medallion: String(vacLeft),
        medallionVariant: vacLeft === 0 ? 'muted' : clogActive && canVacuum ? 'amber' : 'wood',
        subHint: freeQuota === 0 && vacLeft > 0 ? '分享' : undefined,
      },
      {
        label: slotActive ? '双槽中' : '加开槽',
        glyph: 'extra_slot',
        disabled: !canExtraSlot && !slotActive,
        pulse: clogActive && canExtraSlot,
        medallion: slotActive ? '✓' : '1',
        medallionVariant: slotActive ? 'sage' : canExtraSlot ? 'wood' : 'muted',
        subHint: !slotActive && freeQuota === 0 && canExtraSlot ? '分享' : undefined,
      },
      {
        label: '重玩',
        glyph: 'restart',
        disabled: false,
        pulse: false,
        medallion: '免',
        medallionVariant: 'wood',
      },
    ];

    specs.forEach((sp, idx) => {
      const btnRect = layout.propButtons[idx];
      const isPressed = this.pressedBtnIdx === idx;
      const inner = drawRecessedTileCard(ctx, btnRect, tokens, {
        variant: idx === 2 && slotActive ? 'mint' : sp.pulse ? 'amber' : 'parchment',
        radius: 14,
        rimWidth: 4.0,
        pressed: isPressed,
        disabled: sp.disabled,
        pulse: sp.pulse,
        pulsePhase,
        medallionText: sp.medallion,
        medallionVariant: sp.medallionVariant,
        medallionRadius: 10.6,
      });

      ctx.save();
      if (sp.disabled) {
        ctx.globalAlpha = 0.62;
      }

      const iconSize = Math.min(31, inner.h * 0.56);
      const iconCy = inner.y + inner.h * 0.39;
      drawHandDrawnGlyph(ctx, sp.glyph, inner.x + inner.w * 0.5, iconCy, iconSize, tokens);

      drawInkText(
        ctx,
        sp.label,
        inner.x + inner.w * 0.5,
        inner.y + inner.h - 10,
        tokens,
        {
          font: `800 12px ${tokens.typography.fontFamily}`,
          color: '#3A1F0E',
          maxWidth: inner.w - 6,
        }
      );

      // 当每日 3 次免费额度用完后，在左上角轻柔标示「享」微签，保持诚实透明且不遮挡主图标
      if (sp.subHint) {
        drawStatusPill(ctx, btnRect.x + 16, btnRect.y + 8, sp.subHint, tokens, {
          bgHex: '#E0F2FE',
          borderHex: '#0284C7',
          textColor: '#075985',
          fontSize: 8.5,
          padX: 7,
          height: 14,
        });
      }
      ctx.restore();
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
    drawInkText(ctx, '确定要重新开始挑战吗？', panel.x + pw * 0.5, panel.y + 88, tokens, {
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
