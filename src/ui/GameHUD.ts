import type { SandEngine } from '../engine/SandEngine';
import type { SandRenderer } from '../engine/SandRenderer';
import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { RewardManager } from '../systems/RewardManager';
import type { SaveManager } from '../systems/SaveManager';
import type { Rect, UiTokensFile } from '../types/ui';
import {
  drawCoverImage,
  drawOutlinedText,
  drawParchmentModalFrame,
  drawWoodButton,
  drawWoodCapsule,
  formatNetWorth,
  hitRect,
  roundRectPath,
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

/**
 * 主局内界面（MainHUD）：顶栏四胶囊（主页 / 选关设置 / 大红藏馆 / 战利品兜）+ 接沙桶队列 + 4 道具栏
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

  public setMechanicBanner(text: string | null): void {
    this.mechanicBannerText = text;
    this.mechanicBannerTimerMs = text ? 4200 : 0;
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
    const diff = targetNetWorth - this.displayedNetWorth;
    if (Math.abs(diff) < 2) {
      this.displayedNetWorth = targetNetWorth;
    } else {
      this.displayedNetWorth += diff * Math.min(1, dtMs / 160);
    }
  }

  /**
   * 计算指定激活桶槽位的桶口屏幕坐标（供吸沙贝塞尔飞线精准汇入）
   */
  public getActiveBucketMouthPos(layout: ComputedLayout, slotIdx: number, dualMode: boolean): { x: number; y: number } {
    const r = layout.bucketRowRect;
    if (!dualMode) {
      return { x: r.x + 42, y: r.y + 24 };
    }
    const slotW = 98;
    const sx = r.x + slotIdx * (slotW + 8);
    return { x: sx + 30, y: r.y + 24 };
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
      // PRD §2.3 智能防误触：已用过道具或已有盲盒入兜时弹二次确认，否则 0 延迟秒重开
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
    // 0. 顶栏胶囊 0：返回主菜单大厅
    const hp = layout.homePill;
    drawWoodCapsule(ctx, hp, tokens, '#9A6228', '#5A3A22', 14);
    drawOutlinedText(
      ctx,
      hp.w >= 50 ? '🏠主页' : '🏠',
      hp.x + hp.w * 0.5,
      hp.y + hp.h * 0.5,
      `700 11.5px ${tokens.typography.fontFamily}`,
      '#FFF8EC',
      tokens.theme.inkOutline,
      2
    );

    // 1. 顶栏胶囊 1：设置 & 当前关卡
    const sp = layout.settingsPill;
    drawWoodCapsule(ctx, sp, tokens, tokens.theme.woodPrimary, tokens.theme.woodDark, 15);
    const gearImg = assets.get('ui_icon_settings_gear');
    if (gearImg && sp.w >= 86) {
      ctx.drawImage(gearImg, sp.x + 6, sp.y + (sp.h - 18) * 0.5, 18, 18);
    }
    drawOutlinedText(
      ctx,
      `第${engine.level.levelId}关▾`,
      sp.x + sp.w * 0.5 + (gearImg && sp.w >= 86 ? 7 : 0),
      sp.y + sp.h * 0.5,
      `700 12px ${tokens.typography.fontFamily}`,
      '#FFF8EC',
      tokens.theme.inkOutline,
      2.2
    );

    // 2. 顶栏胶囊 2：身价与大红藏馆入口（带可合成红点）
    const np = layout.netWorthPill;
    drawWoodCapsule(ctx, np, tokens, '#4A3423', '#2A1C12', 15);
    const rank = saveMgr.getRankBadge(tokens);
    const badgeImg =
      rank.level >= 6
        ? assets.get('ui_badge_collector')
        : assets.get('ui_networth_coin') || assets.getTinted('ui_badge_rank_base', rank.tintHex);
    if (badgeImg) {
      ctx.drawImage(badgeImg, np.x + 6, np.y + (np.h - 22) * 0.5, 22, 22);
    }
    drawOutlinedText(
      ctx,
      formatNetWorth(this.displayedNetWorth),
      np.x + np.w * 0.5 + 9,
      np.y + np.h * 0.5,
      `700 13px ${tokens.typography.numeralFontFamily}`,
      '#FDE68A',
      tokens.theme.inkOutline,
      2.2
    );
    if (hasCraftableRedDot) {
      ctx.fillStyle = '#EF4444';
      ctx.strokeStyle = '#FFF8EC';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(np.x + np.w - 4, np.y + 4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 3. 顶栏胶囊 3：本关战利品兜（严格位于微信胶囊左侧安全线内）
    const lp = layout.lootBagPill;
    const bagScale =
      this.lootBagBounceMs > 0
        ? 1 + Math.sin((this.lootBagBounceMs / 280) * Math.PI) * 0.28
        : 1;
    ctx.save();
    ctx.translate(lp.x + lp.w * 0.5, lp.y + lp.h * 0.5);
    ctx.scale(bagScale, bagScale);
    drawWoodCapsule(
      ctx,
      { x: -lp.w * 0.5, y: -lp.h * 0.5, w: lp.w, h: lp.h },
      tokens,
      tokens.theme.woodPrimary,
      tokens.theme.woodDark,
      15
    );
    const bagImg = assets.get('ui_loot_bag');
    if (bagImg) {
      ctx.drawImage(bagImg, -lp.w * 0.5 + 4, -14, 28, 28);
    }
    drawOutlinedText(
      ctx,
      `×${engine.lootBag.length}`,
      11,
      1,
      `700 12.5px ${tokens.typography.numeralFontFamily}`,
      '#FFF8EC',
      tokens.theme.inkOutline,
      2.2
    );
    ctx.restore();

    // 4. 新机关顶部非阻塞微提示横幅
    if (this.mechanicBannerText && this.mechanicBannerTimerMs > 0 && engine.boardsPulledCount === 0) {
      const alpha = Math.min(1, this.mechanicBannerTimerMs / 400);
      ctx.save();
      ctx.globalAlpha = alpha;
      const bw = layout.chamberRect.w;
      const bx = layout.chamberRect.x;
      const by = layout.chamberRect.y + 6;
      drawWoodCapsule(ctx, { x: bx, y: by, w: bw, h: 30 }, tokens, 'rgba(255,248,236,0.94)', tokens.theme.woodDark, 10);
      drawOutlinedText(
        ctx,
        this.mechanicBannerText,
        bx + bw * 0.5,
        by + 15,
        `600 11.5px ${tokens.typography.fontFamily}`,
        tokens.theme.inkOutline,
        '#FFFFFF',
        0
      );
      ctx.restore();
    }

    // 5. 异色堵口柔和预警胶囊条（连续 1.5s 堵口时浮现）
    const clogActive = engine.bucketSys.clogWarningActive;
    if (clogActive && !engine.won) {
      const cw = Math.min(324, layout.chamberRect.w - 12);
      const cx = (layout.screenW - cw) * 0.5;
      const cy = layout.chamberRect.y + layout.chamberRect.h - 40;
      drawWoodCapsule(ctx, { x: cx, y: cy, w: cw, h: 32 }, tokens, '#FEF3C7', '#B45309', 12);
      const warnImg = assets.get('ui_jam_warning');
      if (warnImg) {
        ctx.drawImage(warnImg, cx + 8, cy + 4, 24, 24);
      }
      drawOutlinedText(
        ctx,
        '出沙口被堵啦！可抽其他板、清堵或加槽',
        cx + cw * 0.5 + 10,
        cy + 16,
        `700 11.5px ${tokens.typography.fontFamily}`,
        '#92400E',
        '#FFFFFF',
        0
      );
    }

    // 6. 底栏上半行：接沙桶队列区（单槽 / 双槽平滑布局）
    this.renderBucketRow(ctx, layout, engine, sandRenderer, assets, tokens);

    // 7. 底栏下半行：4 道具操作栏
    const pulsePhase = timeSec * 5.8;
    const canUndo = engine.snapshots.canUndo() && !engine.won;
    const vacExhausted = engine.vacuumUsedCount >= 3;
    const canVacuum = engine.canUseVacuum();
    const slotExhausted = engine.bucketSys.maxActiveSlots >= 2;
    const canExtraSlot = engine.bucketSys.canEnableExtraSlot() && !engine.won;

    const undoBadge = rewardMgr.getBadgeSpec(false);
    const vacBadge = rewardMgr.getBadgeSpec(vacExhausted);
    const slotBadge = rewardMgr.getBadgeSpec(slotExhausted);

    drawWoodButton(ctx, layout.propButtons[0], '撤回', tokens, assets, {
      icon: assets.get('ui_prop_undo'),
      disabled: !canUndo,
      pressed: this.pressedBtnIdx === 0,
      badgeText: undoBadge.text,
      badgeBgHex: undoBadge.bgHex,
    });
    drawWoodButton(ctx, layout.propButtons[1], `清堵(${3 - engine.vacuumUsedCount})`, tokens, assets, {
      icon: assets.get('ui_prop_vacuum'),
      disabled: !canVacuum,
      pressed: this.pressedBtnIdx === 1,
      pulse: clogActive && canVacuum,
      pulsePhase,
      badgeText: vacBadge.text,
      badgeBgHex: vacBadge.bgHex,
    });
    drawWoodButton(ctx, layout.propButtons[2], slotExhausted ? '双槽中' : '加槽', tokens, assets, {
      icon: assets.get('ui_prop_extra_slot'),
      disabled: !canExtraSlot,
      pressed: this.pressedBtnIdx === 2,
      pulse: clogActive && canExtraSlot,
      pulsePhase,
      badgeText: slotBadge.text,
      badgeBgHex: slotBadge.bgHex,
    });
    drawWoodButton(ctx, layout.propButtons[3], '重玩', tokens, assets, {
      icon: assets.get('ui_prop_restart'),
      pressed: this.pressedBtnIdx === 3,
      badgeText: '免体力',
      badgeBgHex: '#7C5335',
    });

    // 8. 重玩防误触轻量二次确认框
    if (this.showRestartConfirm) {
      this.renderRestartConfirmModal(ctx, layout, assets, tokens);
    }
  }

  private renderBucketRow(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    engine: SandEngine,
    sandRenderer: SandRenderer,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    const r = layout.bucketRowRect;
    drawWoodCapsule(ctx, r, tokens, '#FDF1DC', tokens.theme.woodDark, 14);

    const active = engine.bucketSys.active;
    const dual = engine.bucketSys.maxActiveSlots >= 2;
    const slotW = dual ? 98 : 134;
    const slotH = r.h - 12;

    for (let i = 0; i < (dual ? 2 : 1); i++) {
      const sx = r.x + 6 + i * (slotW + 6);
      const sy = r.y + 6;
      const bk = active[i];

      ctx.fillStyle = '#FFF8EC';
      ctx.strokeStyle = tokens.theme.inkSecondary;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      roundRectPath(ctx, sx, sy, slotW, slotH, 10);
      ctx.fill();
      ctx.stroke();

      if (!bk) {
        drawOutlinedText(
          ctx,
          '已清空✓',
          sx + slotW * 0.5,
          sy + slotH * 0.5,
          `700 12px ${tokens.typography.fontFamily}`,
          tokens.theme.successText,
          '#FFFFFF',
          0
        );
        continue;
      }

      const tintHex = sandRenderer.getSandColorHex(bk.color, tokens);
      const bucketImg = assets.getTinted('ui_bucket', tintHex);
      const bSize = dual ? 46 : 56;
      const bx = sx + 6;
      const by = sy + (slotH - bSize) * 0.5;

      // 水位上涨填充条
      const pct = Math.min(100, Math.floor((bk.cur / Math.max(1, bk.max)) * 100));
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = tintHex;
      const fillH = ((slotH - 4) * pct) / 100;
      ctx.beginPath();
      roundRectPath(ctx, sx + 2, sy + slotH - 2 - fillH, slotW - 4, fillH, 8);
      ctx.fill();
      ctx.restore();

      if (bucketImg) {
        ctx.drawImage(bucketImg, bx, by, bSize, bSize);
      } else {
        ctx.fillStyle = tintHex;
        ctx.fillRect(bx + 8, by + 8, bSize - 16, bSize - 16);
      }

      drawOutlinedText(
        ctx,
        `${pct}%`,
        sx + slotW - (dual ? 25 : 36),
        sy + slotH * 0.5,
        `800 ${dual ? 14 : 16}px ${tokens.typography.numeralFontFamily}`,
        '#FFF8EC',
        tokens.theme.inkOutline,
        2.6
      );
    }

    // 右侧预告桶队列（最多展示接下来 3 只）
    const previewStartX = r.x + 12 + (dual ? (slotW + 6) * 2 : slotW + 8);
    const waiting = engine.bucketSys.buckets.slice(engine.bucketSys.queuePtr).filter(b => !b.done);
    const maxPreview = dual ? 2 : 3;

    drawOutlinedText(
      ctx,
      '预告',
      previewStartX + 14,
      r.y + 18,
      `600 10px ${tokens.typography.fontFamily}`,
      tokens.theme.inkSecondary,
      '#FFFFFF',
      0
    );

    waiting.slice(0, maxPreview).forEach((wb, idx) => {
      const px = previewStartX + 4 + idx * 40;
      const py = r.y + 28;
      const tint = sandRenderer.getSandColorHex(wb.color, tokens);
      const bImg = assets.getTinted('ui_bucket', tint);
      ctx.save();
      ctx.globalAlpha = 0.88;
      if (bImg) {
        ctx.drawImage(bImg, px, py, 36, 36);
      } else {
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(px + 18, py + 18, 14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    if (waiting.length > 0) {
      drawOutlinedText(
        ctx,
        `余${waiting.length}桶`,
        r.x + r.w - 28,
        r.y + r.h * 0.5 + 6,
        `700 11px ${tokens.typography.fontFamily}`,
        tokens.theme.inkSecondary,
        '#FFFFFF',
        0
      );
    }
  }

  private renderRestartConfirmModal(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    const pw = Math.min(316, layout.screenW - 32);
    const ph = 186;
    const panel: Rect = {
      x: (layout.screenW - pw) * 0.5,
      y: (layout.screenH - ph) * 0.5,
      w: pw,
      h: ph,
    };
    drawParchmentModalFrame(ctx, layout.screenW, layout.screenH, panel, '确认重玩本关？', tokens, assets);

    drawOutlinedText(
      ctx,
      '重玩将重置本关沙盘进度与暂存盲盒，',
      panel.x + panel.w * 0.5,
      panel.y + 62,
      `600 13px ${tokens.typography.fontFamily}`,
      tokens.theme.inkOutline,
      '#FFFFFF',
      0
    );
    drawOutlinedText(
      ctx,
      '确定要重新开始吗？',
      panel.x + panel.w * 0.5,
      panel.y + 86,
      `600 13px ${tokens.typography.fontFamily}`,
      tokens.theme.inkOutline,
      '#FFFFFF',
      0
    );

    const bw = 122;
    this.confirmCancelRect = { x: panel.x + 22, y: panel.y + ph - 54, w: bw, h: 40 };
    this.confirmOkRect = { x: panel.x + pw - 22 - bw, y: panel.y + ph - 54, w: bw, h: 40 };

    drawWoodButton(ctx, this.confirmCancelRect, '继续挑战', tokens, assets, { fillHex: '#10B981' });
    drawWoodButton(ctx, this.confirmOkRect, '确定重玩', tokens, assets, { fillHex: '#D97706' });
  }
}
