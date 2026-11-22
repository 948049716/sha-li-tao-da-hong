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
    const slotH = r.h - 12;
    if (!dualMode) {
      const bSize = 56;
      const by = r.y + 6 + (slotH - bSize) * 0.5;
      return { x: r.x + 12 + bSize * 0.5, y: by + bSize * 0.24 };
    }
    const slotW = 98;
    const bSize = 46;
    const sx = r.x + 6 + slotIdx * (slotW + 6);
    const by = r.y + 6 + (slotH - bSize) * 0.5;
    return { x: sx + 6 + bSize * 0.5, y: by + bSize * 0.24 };
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
    // 0. 顶栏胶囊 0：返回主菜单大厅（手绘小木屋尖顶 + “主页”刻字，杜绝系统 3D Emoji）
    const hp = layout.homePill;
    drawWoodCapsule(ctx, hp, tokens, '#A66B35', '#5C3718', 14);
    ctx.save();
    const hx = hp.x + 13;
    const hy = hp.y + hp.h * 0.5;
    ctx.fillStyle = '#FFF5DE';
    ctx.strokeStyle = tokens.theme.inkOutline;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    // 小屋檐三角 + 木屋墙体
    ctx.beginPath();
    ctx.moveTo(hx - 6.5, hy);
    ctx.lineTo(hx, hy - 6);
    ctx.lineTo(hx + 6.5, hy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(hx - 4.2, hy, 8.4, 5.5);
    ctx.strokeRect(hx - 4.2, hy, 8.4, 5.5);
    ctx.restore();
    if (hp.w >= 50) {
      drawOutlinedText(
        ctx,
        '主页',
        hp.x + hp.w * 0.5 + 7,
        hp.y + hp.h * 0.5 + 0.5,
        `700 11.5px ${tokens.typography.fontFamily}`,
        '#FFF8EC',
        tokens.theme.inkOutline,
        2
      );
    }

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

    // 6. 底栏上半行：接沙桶队列区（单槽 / 双槽平滑布局 + 桶口堆尖沙丘 + 漏斗连贯流沙柱）
    const rainbowDrain = saveMgr.data.equippedSuctionFxId === 'fx_rainbow_drain';
    this.renderBucketRow(ctx, layout, engine, sandRenderer, assets, tokens, timeSec, rainbowDrain);

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
    tokens: UiTokensFile,
    timeSec: number,
    rainbowDrain: boolean
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
      const shades = sandRenderer.getSandShades(bk.color);
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

      // 桶口圆锥颗粒沙丘（严格复刻 gameplay_ref.jpg 彩沙落入木桶堆起的颗粒沙尖！）
      if (pct > 0) {
        const mcx = bx + bSize * 0.5;
        const mcy = by + bSize * 0.255;
        const mRx = bSize * 0.30 * Math.min(1, 0.45 + (pct / 100) * 0.55);
        const mRy = bSize * 0.075;
        const peakH = (dual ? 2.2 : 2.8) + (pct / 100) * (dual ? 6.2 : 8.2);

        ctx.save();
        const mGrad = ctx.createLinearGradient(mcx, mcy - peakH, mcx, mcy + mRy);
        mGrad.addColorStop(0, shades.highlightHex);
        mGrad.addColorStop(0.55, shades.baseHex);
        mGrad.addColorStop(1, shades.shadowHex);

        ctx.fillStyle = mGrad;
        ctx.strokeStyle = shades.outlineHex;
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(mcx - mRx, mcy);
        ctx.quadraticCurveTo(mcx - mRx * 0.36, mcy - peakH * 0.9, mcx, mcy - peakH);
        ctx.quadraticCurveTo(mcx + mRx * 0.36, mcy - peakH * 0.9, mcx + mRx, mcy);
        ctx.ellipse(mcx, mcy, mRx, mRy, 0, 0, Math.PI, false);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 沙尖上的细小粗暗砂砾点
        ctx.fillStyle = shades.pebbleDarkHex;
        for (let gIdx = 0; gIdx < 5; gIdx++) {
          const gxOff = ((gIdx - 2) * 0.34 + Math.sin(gIdx * 2.1) * 0.08) * mRx;
          const gyOff = -peakH * (0.22 + ((gIdx * 37) % 5) * 0.11);
          ctx.beginPath();
          ctx.arc(mcx + gxOff, mcy + gyOff, 0.95, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
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

    // 出沙期绘制从玻璃 V 形漏斗嘴直落激活木桶口的连贯手绘流沙柱（复刻 gameplay_ref.jpg 漏斗倾泻感）
    if (engine.pourStreamMs > 0 && engine.pourStreamColor) {
      this.renderPouringSandStream(ctx, layout, engine, sandRenderer, timeSec, rainbowDrain);
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

  /**
   * 绘制从玻璃沙箱底部 V 形漏斗口连贯倾泻至激活木桶口的绘本颗粒流沙柱
   */
  private renderPouringSandStream(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    engine: SandEngine,
    sandRenderer: SandRenderer,
    timeSec: number,
    rainbowDrain: boolean
  ): void {
    const cid = engine.pourStreamColor;
    if (!cid) return;

    const dual = engine.bucketSys.maxActiveSlots >= 2;
    const ch = layout.chamberRect;
    const shakeY = engine.screenShakeMs > 0 ? Math.sin(engine.frame * 1.8) * 3 : 0;
    const spoutX = ch.x + ch.w * (74.5 / 150);
    const spoutY = ch.y + shakeY + ch.h * (163.8 / 165);
    const spoutHalfW = 5.1 * (ch.w / 150);
    const mouth = this.getActiveBucketMouthPos(layout, engine.pourStreamSlot, dual);
    const endX = mouth.x;
    const endY = mouth.y + 1.5;

    const fade = Math.min(1, engine.pourStreamMs / 75);
    const widthScale = 0.76 + 0.24 * fade;
    const dy = Math.max(18, endY - spoutY);
    const c1x = spoutX;
    const c1y = spoutY + dy * 0.54;
    const c2x = endX;
    const c2y = spoutY + dy * 0.44;

    const shades = sandRenderer.getSandShades(cid);

    ctx.save();
    ctx.globalAlpha = Math.min(0.98, 0.4 + 0.6 * fade);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 计算收束沙流左右包络线（精确衔接 V 形玻璃漏斗内径 -> 中段收束 -> 落桶口微展）
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

      const funnelTaper = Math.pow(1 - t, 2.2) * Math.max(2, spoutHalfW - 3.3);
      const flare = Math.pow(t, 3) * 1.4;
      const halfW = (3.3 + funnelTaper + flare) * widthScale;

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
      const sGrad = ctx.createLinearGradient(spoutX - 8, spoutY, endX + 6, endY);
      sGrad.addColorStop(0, shades.baseHex);
      sGrad.addColorStop(0.5, shades.highlightHex);
      sGrad.addColorStop(1, shades.baseHex);
      ctx.fillStyle = sGrad;
    }
    ctx.fill();

    // 柔和外侧彩铅细边（不封顶口，与漏斗咽喉无缝融为一体）
    ctx.strokeStyle = shades.outlineHex;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(leftPts[0][0], leftPts[0][1]);
    for (let s = 1; s <= steps; s++) ctx.lineTo(leftPts[s][0], leftPts[s][1]);
    ctx.moveTo(rightPts[0][0], rightPts[0][1]);
    for (let s = 1; s <= steps; s++) ctx.lineTo(rightPts[s][0], rightPts[s][1]);
    ctx.stroke();

    // 中心受光细丝
    ctx.strokeStyle = shades.highlightHex;
    ctx.lineWidth = 2.0 * widthScale;
    ctx.beginPath();
    ctx.moveTo(centerPts[1][0], centerPts[1][1]);
    for (let s = 2; s < steps; s++) ctx.lineTo(centerPts[s][0], centerPts[s][1]);
    ctx.stroke();

    // 沿流沙柱高速坠落的细腻砂砾点
    for (let k = 0; k < 14; k++) {
      const t = ((k / 14) + timeSec * 4.5) % 1;
      const u = 1 - t;
      const lateral = Math.sin(k * 2.7 + timeSec * 10) * 1.6 * widthScale;
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
      ctx.beginPath();
      ctx.arc(px, py, k % 4 === 0 ? 1.2 : 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
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
