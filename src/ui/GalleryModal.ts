import type { ParticleSystem } from '../engine/ParticleSystem';
import type { AssetLoader } from '../platform/AssetLoader';
import type { AudioManager } from '../platform/AudioManager';
import type { HapticManager } from '../platform/HapticManager';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { AuthService } from '../systems/AuthService';
import type { CraftOutcome, GachaSystem } from '../systems/GachaSystem';
import type { SaveManager } from '../systems/SaveManager';
import type { FigurineItem } from '../types/figurine';
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

export type GalleryAction =
  | { type: 'BACK_TO_GAME' }
  | { type: 'SHARE_FIGURINE'; fig: FigurineItem }
  | { type: 'TOAST'; msg: string };

/**
 * 大红藏馆与双档碎片合成界面（含微信头像按需授权、双套系切换、15/15 大奖激活穿戴、3×5 惯性滚动图鉴、公仔详情卡、概率公示表与合成慢转揭晓）
 * 严格遵循 PRD §5 & §6.2 界面五
 */
export class GalleryModal {
  public activeSeriesIdx = 0;
  public scrollY = 0;
  public selectedFigurine: FigurineItem | null = null;
  public showProbPopup = false;
  public showHighPoolFullPrompt = false;

  // 合成慢转揭晓动画状态
  private activeCraftReveal: CraftOutcome | null = null;
  private craftScanSec = 0;
  private craftScanTargetSec = 1.0;
  private craftRevealed = false;

  private isDraggingScroll = false;
  private dragStartY = 0;
  private scrollStartY = 0;

  private backBtnRect: Rect = { x: 12, y: 14, w: 94, h: 32 };
  private authTagRect: Rect = { x: 0, y: 0, w: 92, h: 24 };
  private tabRects: [Rect, Rect] = [
    { x: 0, y: 0, w: 170, h: 36 },
    { x: 0, y: 0, w: 170, h: 36 },
  ];
  private seriesRewardBtnRect: Rect = { x: 0, y: 0, w: 86, h: 30 };
  private viewportRect: Rect = { x: 12, y: 210, w: 366, h: 420 };
  private maxScrollY = 0;
  private cardHitList: { fig: FigurineItem; rect: Rect; owned: boolean }[] = [];

  private probBtnRect: Rect = { x: 0, y: 0, w: 58, h: 24 };
  private craft5BtnRect: Rect = { x: 0, y: 0, w: 112, h: 48 };
  private craft25BtnRect: Rect = { x: 0, y: 0, w: 126, h: 48 };

  private popupCloseRect: Rect = { x: 0, y: 0, w: 120, h: 40 };
  private detailShareRect: Rect | null = null;
  private highPromptUse5Rect: Rect = { x: 0, y: 0, w: 132, h: 40 };
  private highPromptForce25Rect: Rect = { x: 0, y: 0, w: 132, h: 40 };

  private audio: AudioManager;
  private haptic: HapticManager;
  private particles: ParticleSystem;
  private tokens: UiTokensFile;

  constructor(
    audio: AudioManager,
    haptic: HapticManager,
    particles: ParticleSystem,
    tokens: UiTokensFile
  ) {
    this.audio = audio;
    this.haptic = haptic;
    this.particles = particles;
    this.tokens = tokens;
  }

  public onEnter(layout: ComputedLayout, auth: AuthService, onAuthUpdated: () => void): void {
    this.scrollY = 0;
    this.selectedFigurine = null;
    this.showProbPopup = false;
    this.showHighPoolFullPrompt = false;
    this.activeCraftReveal = null;
    this.updateAuthButtonMount(layout, auth, onAuthUpdated);
  }

  public onExit(auth: AuthService): void {
    this.audio.stopHeartbeat();
    auth.unmountAuthButton();
  }

  public updateAuthButtonMount(
    layout: ComputedLayout,
    auth: AuthService,
    onAuthUpdated: () => void
  ): void {
    const bannerY = layout.topHudY + layout.topHudH + 8;
    this.authTagRect = {
      x: 12 + 64,
      y: bannerY + 40,
      w: 96,
      h: 24,
    };
    if (!auth.profile.isAuthorized) {
      auth.mountAuthButtonInGallery(this.authTagRect, onAuthUpdated);
    } else {
      auth.unmountAuthButton();
    }
  }

  public onPointerDown(px: number, py: number): void {
    if (
      !this.selectedFigurine &&
      !this.showProbPopup &&
      !this.showHighPoolFullPrompt &&
      !this.activeCraftReveal &&
      hitRect(px, py, this.viewportRect)
    ) {
      this.isDraggingScroll = true;
      this.dragStartY = py;
      this.scrollStartY = this.scrollY;
    }
  }

  public onPointerMove(py: number): void {
    if (!this.isDraggingScroll) return;
    const dy = this.dragStartY - py;
    this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollStartY + dy));
  }

  public onPointerUp(): void {
    this.isDraggingScroll = false;
  }

  public onWheel(deltaY: number): void {
    if (this.selectedFigurine || this.showProbPopup || this.activeCraftReveal) return;
    this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY + deltaY * 0.6));
  }

  public update(dtMs: number, screenW: number, screenH: number): void {
    if (!this.activeCraftReveal || this.craftRevealed) return;
    this.craftScanSec += dtMs / 1000;
    if (this.craftScanSec >= this.craftScanTargetSec) {
      this.finishCraftReveal(screenW, screenH);
    }
  }

  private startCraftReveal(outcome: CraftOutcome): void {
    this.activeCraftReveal = outcome;
    this.craftScanSec = 0;
    this.craftRevealed = false;
    this.craftScanTargetSec = Math.max(0.55, this.tokens.rarityTokens[outcome.rarity].scanDurationSec);
    if (outcome.rarity === 'GOLD' || outcome.rarity === 'RED') {
      this.audio.startHeartbeat(outcome.rarity === 'RED');
      this.haptic.triggerForEvent('APPRAISAL_SCAN_HIGH');
    }
  }

  private finishCraftReveal(screenW: number, screenH: number): void {
    if (!this.activeCraftReveal || this.craftRevealed) return;
    this.craftRevealed = true;
    this.audio.stopHeartbeat();
    const r = this.activeCraftReveal.rarity;
    if (r === 'RED') {
      this.audio.playEvent('REVEAL_RED_JACKPOT');
      this.haptic.triggerForEvent('REVEAL_RED_JACKPOT');
      this.particles.spawnRedJackpotConfetti(screenW, screenH);
    } else if (r === 'GOLD') {
      this.audio.playEvent('REVEAL_GOLD');
      this.haptic.triggerForEvent('REVEAL_GOLD');
    } else if (r === 'PURPLE') {
      this.audio.playEvent('REVEAL_PURPLE');
      this.haptic.triggerForEvent('REVEAL_PURPLE');
    } else if (r === 'BLUE') {
      this.audio.playEvent('REVEAL_BLUE');
      this.haptic.triggerForEvent('REVEAL_BLUE');
    } else {
      this.audio.playEvent('REVEAL_WHITE_GREEN');
    }
    this.particles.spawnStarBurst(
      screenW * 0.5,
      screenH * 0.45,
      this.tokens.rarityTokens[r].primary,
      10
    );
  }

  public handleTap(
    px: number,
    py: number,
    layout: ComputedLayout,
    gacha: GachaSystem,
    saveMgr: SaveManager
  ): GalleryAction | null {
    // 1. 合成揭晓浮层优先
    if (this.activeCraftReveal) {
      if (!this.craftRevealed) {
        this.finishCraftReveal(layout.screenW, layout.screenH);
        return null;
      }
      if (hitRect(px, py, this.popupCloseRect)) {
        this.activeCraftReveal = null;
      }
      return null;
    }

    // 2. 高阶满池友好提醒框
    if (this.showHighPoolFullPrompt) {
      if (hitRect(px, py, this.highPromptUse5Rect)) {
        this.showHighPoolFullPrompt = false;
        const out = gacha.craftNormal5(saveMgr.data);
        if (out) {
          saveMgr.saveNow(true);
          this.startCraftReveal(out);
        }
        return null;
      }
      if (hitRect(px, py, this.highPromptForce25Rect)) {
        this.showHighPoolFullPrompt = false;
        const out = gacha.craftPremium25(saveMgr.data);
        if (out) {
          saveMgr.saveNow(true);
          this.startCraftReveal(out);
        }
        return null;
      }
      this.showHighPoolFullPrompt = false;
      return null;
    }

    // 3. 公仔详情弹窗或概率公示弹窗
    if (this.selectedFigurine) {
      if (this.detailShareRect && hitRect(px, py, this.detailShareRect)) {
        return { type: 'SHARE_FIGURINE', fig: this.selectedFigurine };
      }
      if (hitRect(px, py, this.popupCloseRect)) {
        this.selectedFigurine = null;
      }
      return null;
    }

    if (this.showProbPopup) {
      if (hitRect(px, py, this.popupCloseRect)) {
        this.showProbPopup = false;
      }
      return null;
    }

    // 4. 返回局内
    if (hitRect(px, py, this.backBtnRect)) {
      return { type: 'BACK_TO_GAME' };
    }

    // 5. 套系 Tab 切换
    if (hitRect(px, py, this.tabRects[0])) {
      this.activeSeriesIdx = 0;
      this.scrollY = 0;
      this.audio.playEvent('UI_BUTTON_TAP');
      return null;
    }
    if (hitRect(px, py, this.tabRects[1])) {
      this.activeSeriesIdx = 1;
      this.scrollY = 0;
      this.audio.playEvent('UI_BUTTON_TAP');
      return null;
    }

    // 6. 套系 15/15 奖励激活与穿戴开关（PRD §5.3 / AC-12）
    if (hitRect(px, py, this.seriesRewardBtnRect)) {
      const series = gacha.getSeriesList()[this.activeSeriesIdx];
      const st = gacha.checkSeriesCompletion(series, saveMgr.data);
      if (!st.isComplete) {
        return {
          type: 'TOAST',
          msg: `集齐本套系 15 款即可免费解锁【${series.unlockReward.name}】(${st.ownedCount}/15)`,
        };
      }
      const rid = series.unlockReward.id;
      const isSkin = series.unlockReward.type === 'sand_skin';
      if (isSkin) {
        if (!saveMgr.data.unlockedSkins.includes(rid)) {
          saveMgr.data.unlockedSkins.push(rid);
          saveMgr.data.equippedSkinId = rid;
        } else {
          saveMgr.data.equippedSkinId = saveMgr.data.equippedSkinId === rid ? null : rid;
        }
      } else {
        if (!saveMgr.data.unlockedSuctionFx.includes(rid)) {
          saveMgr.data.unlockedSuctionFx.push(rid);
          saveMgr.data.equippedSuctionFxId = rid;
        } else {
          saveMgr.data.equippedSuctionFxId = saveMgr.data.equippedSuctionFxId === rid ? null : rid;
        }
      }
      saveMgr.saveNow(true);
      this.audio.playEvent('REVEAL_GOLD');
      return {
        type: 'TOAST',
        msg: st.isEquipped ? `已恢复默认外观` : `✨ 已穿戴【${series.unlockReward.name}】！`,
      };
    }

    // 7. 概率公示按钮
    if (hitRect(px, py, this.probBtnRect)) {
      this.showProbPopup = true;
      this.audio.playEvent('UI_BUTTON_TAP');
      return null;
    }

    // 8. 5 碎片普通合成按钮
    if (hitRect(px, py, this.craft5BtnRect)) {
      if (saveMgr.data.shards < 5) {
        return {
          type: 'TOAST',
          msg: `淘金碎片不足（当前 ${saveMgr.data.shards}/5 枚），开出重复公仔自动得碎片！`,
        };
      }
      const out = gacha.craftNormal5(saveMgr.data);
      if (out) {
        saveMgr.saveNow(true);
        this.startCraftReveal(out);
      }
      return null;
    }

    // 9. 25 碎片高阶定向合成按钮
    if (hitRect(px, py, this.craft25BtnRect)) {
      if (saveMgr.data.shards < 25) {
        return {
          type: 'TOAST',
          msg: `淘金碎片不足（当前 ${saveMgr.data.shards}/25 枚），满 25 枚必出紫/金/大红！`,
        };
      }
      const totalOwned = saveMgr.getOwnedUniqueCount();
      if (gacha.isHighTierPoolFull(saveMgr.data) && totalOwned < 30) {
        this.showHighPoolFullPrompt = true;
        return null;
      }
      const out = gacha.craftPremium25(saveMgr.data);
      if (out) {
        saveMgr.saveNow(true);
        this.startCraftReveal(out);
      }
      return null;
    }

    // 10. 点击图鉴卡片
    if (hitRect(px, py, this.viewportRect)) {
      for (const hit of this.cardHitList) {
        if (hitRect(px, py, hit.rect)) {
          if (!hit.owned) {
            return {
              type: 'TOAST',
              msg: '未解锁藏品：过关拆盲盒或下方碎片合成即可点亮！',
            };
          }
          this.selectedFigurine = hit.fig;
          this.audio.playEvent('UI_BUTTON_TAP');
          return null;
        }
      }
    }

    return null;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    gacha: GachaSystem,
    saveMgr: SaveManager,
    auth: AuthService,
    assets: AssetLoader,
    timeSec: number
  ): void {
    const W = layout.screenW;
    const H = layout.screenH;

    const bg = assets.get('ui_bg_collection');
    if (bg) {
      drawCoverImage(ctx, bg, W, H);
      ctx.fillStyle = 'rgba(28, 18, 10, 0.28)';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = this.tokens.theme.starryNightBg;
      ctx.fillRect(0, 0, W, H);
    }

    // 顶部返回按钮（置于微信双胶囊下方安全行）
    this.backBtnRect = { x: 12, y: layout.topHudY, w: 86, h: layout.topHudH };
    drawWoodButton(ctx, this.backBtnRect, '← 返回', this.tokens, assets, {
      fontSize: 12.5,
    });
    drawOutlinedText(
      ctx,
      '🏛️ 大红藏馆',
      W * 0.5,
      layout.topHudY + layout.topHudH * 0.5,
      `800 18px ${this.tokens.typography.fontFamily}`,
      '#FFF8EC',
      this.tokens.theme.inkOutline,
      3
    );

    // 1. 个人信息与总身价羊皮纸横幅
    const bannerY = layout.topHudY + layout.topHudH + 8;
    const banner: Rect = { x: 12, y: bannerY, w: W - 24, h: 72 };
    drawWoodCapsule(ctx, banner, this.tokens, '#FFF8EC', this.tokens.theme.woodDark, 14);

    const avatarImg = assets.get('ui_avatar_default_duck');
    if (avatarImg) {
      ctx.drawImage(avatarImg, banner.x + 10, banner.y + 12, 48, 48);
    }

    drawOutlinedText(
      ctx,
      auth.profile.nickName,
      banner.x + 66,
      banner.y + 24,
      `700 13px ${this.tokens.typography.fontFamily}`,
      this.tokens.theme.inkOutline,
      '#FFFFFF',
      0,
      'left'
    );

    const rank = saveMgr.getRankBadge(this.tokens);
    if (!auth.profile.isAuthorized) {
      this.authTagRect = { x: banner.x + 64, y: banner.y + 40, w: 96, h: 24 };
      drawWoodCapsule(ctx, this.authTagRect, this.tokens, '#FDE68A', '#B45309', 8);
      drawOutlinedText(
        ctx,
        '同步微信头像 ›',
        this.authTagRect.x + 48,
        this.authTagRect.y + 12,
        `700 10px ${this.tokens.typography.fontFamily}`,
        '#78350F',
        '#FFFFFF',
        0
      );
    } else {
      drawOutlinedText(
        ctx,
        `Lv.${rank.level} ${rank.title}`,
        banner.x + 66,
        banner.y + 50,
        `700 11.5px ${this.tokens.typography.fontFamily}`,
        '#B45309',
        '#FFFFFF',
        0,
        'left'
      );
    }

    const ownedTotal = saveMgr.getOwnedUniqueCount();
    drawOutlinedText(
      ctx,
      `总身价 ${formatNetWorth(saveMgr.data.totalNetWorth)}`,
      banner.x + banner.w - 12,
      banner.y + 25,
      `800 16px ${this.tokens.typography.numeralFontFamily}`,
      '#D97706',
      '#FFF8EC',
      2,
      'right'
    );
    drawOutlinedText(
      ctx,
      `Lv.${rank.level} ${rank.title} · 收集 ${ownedTotal}/30`,
      banner.x + banner.w - 12,
      banner.y + 50,
      `600 11px ${this.tokens.typography.fontFamily}`,
      this.tokens.theme.inkSecondary,
      '#FFFFFF',
      0,
      'right'
    );

    // 2. 双套系切换 Tab + 15/15 集齐大奖状态条
    const seriesList = gacha.getSeriesList();
    const tabY = banner.y + banner.h + 8;
    const tabW = Math.floor((W - 32) * 0.5);
    this.tabRects = [
      { x: 12, y: tabY, w: tabW, h: 34 },
      { x: 20 + tabW, y: tabY, w: tabW, h: 34 },
    ];

    seriesList.forEach((s, idx) => {
      const st = gacha.checkSeriesCompletion(s, saveMgr.data);
      const active = this.activeSeriesIdx === idx;
      const shortTitle = idx === 0 ? `🐾打工萌宠(${st.ownedCount}/15)` : `🍜暴富食堂(${st.ownedCount}/15)`;
      drawWoodButton(ctx, this.tabRects[idx], shortTitle, this.tokens, assets, {
        fontSize: 12,
        fillHex: active ? '#D97706' : '#7C5335',
        badgeText: st.isComplete && !st.isClaimed ? '大奖!' : undefined,
        badgeBgHex: '#EF4444',
      });
    });

    const curSeries = seriesList[this.activeSeriesIdx];
    const curSeriesStatus = gacha.checkSeriesCompletion(curSeries, saveMgr.data);
    const rewardBar: Rect = { x: 12, y: tabY + 40, w: W - 24, h: 42 };
    drawWoodCapsule(ctx, rewardBar, this.tokens, '#FDF1DC', this.tokens.theme.woodDark, 11);

    const rIconId =
      curSeries.unlockReward.type === 'sand_skin' ? 'ui_reward_skin_galaxy' : 'ui_reward_fx_rainbow';
    const rIcon = assets.get(rIconId);
    if (rIcon) {
      ctx.drawImage(rIcon, rewardBar.x + 8, rewardBar.y + 5, 32, 32);
    }
    drawOutlinedText(
      ctx,
      `15/15大奖：${curSeries.unlockReward.name}`,
      rewardBar.x + 46,
      rewardBar.y + 21,
      `700 12px ${this.tokens.typography.fontFamily}`,
      this.tokens.theme.inkOutline,
      '#FFFFFF',
      0,
      'left'
    );

    this.seriesRewardBtnRect = { x: rewardBar.x + rewardBar.w - 86, y: rewardBar.y + 6, w: 78, h: 30 };
    const rBtnLabel = !curSeriesStatus.isComplete
      ? `${curSeriesStatus.ownedCount}/15`
      : !curSeriesStatus.isClaimed
        ? '🎁激活'
        : curSeriesStatus.isEquipped
          ? '穿戴中✓'
          : '点击穿戴';
    drawWoodButton(ctx, this.seriesRewardBtnRect, rBtnLabel, this.tokens, assets, {
      fontSize: 11,
      fillHex: !curSeriesStatus.isComplete
        ? '#9CA3AF'
        : curSeriesStatus.isEquipped
          ? '#15803D'
          : '#D97706',
      pulse: curSeriesStatus.isComplete && !curSeriesStatus.isClaimed,
      pulsePhase: timeSec * 5.8,
    });

    // 3. 中部 3 列 × 5 行可滚动公仔图鉴网格
    const craftBarH = 78 + (H > 760 ? 12 : 4);
    const vpTop = rewardBar.y + rewardBar.h + 8;
    const vpH = Math.max(200, H - craftBarH - vpTop - 6);
    this.viewportRect = { x: 12, y: vpTop, w: W - 24, h: vpH };

    const cols = 3;
    const gapX = 9;
    const gapY = 10;
    const cardW = Math.floor((this.viewportRect.w - gapX * 2) / cols);
    const cardH = Math.round(cardW * 1.32);
    const totalRows = Math.ceil(curSeries.items.length / cols);
    const contentH = totalRows * (cardH + gapY) + 8;
    this.maxScrollY = Math.max(0, contentH - vpH);
    this.scrollY = Math.min(this.scrollY, this.maxScrollY);

    this.cardHitList = [];
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, this.viewportRect.x, this.viewportRect.y, this.viewportRect.w, this.viewportRect.h, 12);
    ctx.clip();

    curSeries.items.forEach((fig, idx) => {
      const col = idx % cols;
      const row = (idx / cols) | 0;
      const cx = this.viewportRect.x + col * (cardW + gapX);
      const cy = this.viewportRect.y + 4 + row * (cardH + gapY) - this.scrollY;
      const rect: Rect = { x: cx, y: cy, w: cardW, h: cardH };
      const count = saveMgr.data.ownedMap[fig.id] || 0;
      const owned = count > 0;

      if (cy + cardH >= this.viewportRect.y - 10 && cy <= this.viewportRect.y + vpH + 10) {
        this.cardHitList.push({ fig, rect, owned });
        this.renderGalleryFigurineCard(ctx, rect, fig, count, assets);
      }
    });
    ctx.restore();

    // 4. 底部吸底【淘金碎片合成台】
    const barY = H - craftBarH;
    const barRect: Rect = { x: 8, y: barY, w: W - 16, h: craftBarH - 6 };
    drawWoodCapsule(ctx, barRect, this.tokens, '#FFF8EC', this.tokens.theme.woodDark, 16);

    const shardImg = assets.get('ui_shard_icon');
    if (shardImg) {
      ctx.drawImage(shardImg, barRect.x + 10, barRect.y + 10, 26, 26);
    }
    drawOutlinedText(
      ctx,
      `×${saveMgr.data.shards}`,
      barRect.x + 40,
      barRect.y + 23,
      `800 16px ${this.tokens.typography.numeralFontFamily}`,
      '#B45309',
      '#FFFFFF',
      0,
      'left'
    );

    this.probBtnRect = { x: barRect.x + 12, y: barRect.y + 40, w: 68, h: 24 };
    drawWoodCapsule(ctx, this.probBtnRect, this.tokens, '#E5E0D8', '#7C5335', 8);
    drawOutlinedText(
      ctx,
      'ⓘ概率公示',
      this.probBtnRect.x + 34,
      this.probBtnRect.y + 12,
      `700 10px ${this.tokens.typography.fontFamily}`,
      this.tokens.theme.inkOutline,
      '#FFFFFF',
      0
    );

    const fullAll = ownedTotal >= 30;
    const fullHigh = gacha.isHighTierPoolFull(saveMgr.data);

    const btnW25 = Math.min(130, Math.floor((barRect.w - 104) * 0.53));
    const btnW5 = Math.min(116, barRect.w - 104 - btnW25);
    this.craft5BtnRect = {
      x: barRect.x + barRect.w - btnW5 - btnW25 - 14,
      y: barRect.y + 11,
      w: btnW5,
      h: 50,
    };
    this.craft25BtnRect = {
      x: barRect.x + barRect.w - btnW25 - 8,
      y: barRect.y + 11,
      w: btnW25,
      h: 50,
    };

    drawWoodButton(ctx, this.craft5BtnRect, fullAll ? '🧩5 身价冲刺' : '🧩5 普通合成', this.tokens, assets, {
      fontSize: 12,
      subLabel: fullAll ? '全池冲身价' : '100%出未解锁',
      fillHex: '#0284C7',
      disabled: saveMgr.data.shards < 5,
    });

    drawWoodButton(ctx, this.craft25BtnRect, fullHigh ? '🧩25 高阶冲刺' : '🧩25 紫金红', this.tokens, assets, {
      fontSize: 12,
      subLabel: fullHigh ? '紫金红冲身价' : '必出未有紫金红',
      fillHex: '#DC2626',
      disabled: saveMgr.data.shards < 25,
      pulse: saveMgr.data.shards >= 25 && !fullHigh,
      pulsePhase: timeSec * 5.6,
    });

    // 5. 二级弹窗渲染（详情卡 / 概率公示 / 12满池提醒 / 合成慢转揭晓）
    if (this.selectedFigurine) {
      this.renderFigurineDetailModal(
        ctx,
        W,
        H,
        this.selectedFigurine,
        saveMgr.data.ownedMap[this.selectedFigurine.id] || 1,
        assets
      );
    } else if (this.showProbPopup) {
      this.renderProbPopup(ctx, W, H, assets);
    } else if (this.showHighPoolFullPrompt) {
      this.renderHighPoolPrompt(ctx, W, H, assets);
    } else if (this.activeCraftReveal) {
      this.renderCraftRevealModal(ctx, W, H, this.activeCraftReveal, assets);
    }
  }

  private renderGalleryFigurineCard(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    fig: FigurineItem,
    count: number,
    assets: AssetLoader
  ): void {
    const rarTok = this.tokens.rarityTokens[fig.rarity];
    const owned = count > 0;

    ctx.save();
    if (!owned) {
      ctx.fillStyle = '#1E294B';
      ctx.strokeStyle = rarTok.border;
      ctx.lineWidth = 2;
      ctx.beginPath();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 11);
      ctx.fill();
      ctx.stroke();

      const sil = assets.getSilhouette(fig.id, '#0F172A');
      const sz = Math.min(r.w * 0.68, r.h * 0.54);
      if (sil) {
        ctx.globalAlpha = 0.75;
        ctx.drawImage(sil, r.x + (r.w - sz) * 0.5, r.y + r.h * 0.14, sz, sz);
        ctx.globalAlpha = 1;
      }
      drawOutlinedText(
        ctx,
        `${rarTok.label} · ???`,
        r.x + r.w * 0.5,
        r.y + r.h - 18,
        `700 10.5px ${this.tokens.typography.fontFamily}`,
        rarTok.primary,
        '#0F172A',
        2
      );
      ctx.restore();
      return;
    }

    ctx.fillStyle = rarTok.cardBg;
    ctx.strokeStyle = rarTok.border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 11);
    ctx.fill();
    ctx.stroke();

    const frameImg = assets.get(`ui_card_frame_${fig.rarity.toLowerCase()}`);
    if (frameImg) {
      ctx.drawImage(frameImg, r.x, r.y, r.w, r.h);
    }

    const figImg = assets.get(fig.id);
    const sz = Math.min(r.w * 0.72, r.h * 0.56);
    if (figImg) {
      ctx.drawImage(figImg, r.x + (r.w - sz) * 0.5, r.y + r.h * 0.11, sz, sz);
    }

    drawOutlinedText(
      ctx,
      fig.name,
      r.x + r.w * 0.5,
      r.y + r.h - 26,
      `700 10.5px ${this.tokens.typography.fontFamily}`,
      '#FFF8EC',
      this.tokens.theme.inkOutline,
      2.2
    );
    drawOutlinedText(
      ctx,
      formatNetWorth(fig.valuation),
      r.x + r.w * 0.5,
      r.y + r.h - 11,
      `700 10px ${this.tokens.typography.numeralFontFamily}`,
      rarTok.border,
      '#FFF8EC',
      1.8
    );

    // 右上角持有件数
    ctx.fillStyle = 'rgba(90, 58, 34, 0.85)';
    ctx.beginPath();
    roundRectPath(ctx, r.x + r.w - 30, r.y + 4, 26, 16, 6);
    ctx.fill();
    drawOutlinedText(
      ctx,
      `×${count}`,
      r.x + r.w - 17,
      r.y + 12,
      `700 9.5px ${this.tokens.typography.numeralFontFamily}`,
      '#FFF8EC',
      '#000',
      0
    );
    ctx.restore();
  }

  private renderFigurineDetailModal(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    fig: FigurineItem,
    count: number,
    assets: AssetLoader
  ): void {
    const pw = Math.min(332, W - 28);
    const ph = 420;
    const p: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };
    const rarTok = this.tokens.rarityTokens[fig.rarity];

    drawParchmentModalFrame(ctx, W, H, p, `${rarTok.label} · ${fig.name}`, this.tokens, assets);

    const cardRect: Rect = { x: p.x + (pw - 160) * 0.5, y: p.y + 34, w: 160, h: 204 };
    this.renderGalleryFigurineCard(ctx, cardRect, fig, count, assets);

    drawOutlinedText(
      ctx,
      `单件估值：${fig.valuation.toLocaleString()}   |   累计持有：×${count}`,
      p.x + pw * 0.5,
      p.y + 258,
      `700 12.5px ${this.tokens.typography.numeralFontFamily}`,
      '#B45309',
      '#FFFFFF',
      0
    );

    // 鉴宝台词卷轴
    const qBox: Rect = { x: p.x + 16, y: p.y + 278, w: pw - 32, h: 58 };
    drawWoodCapsule(ctx, qBox, this.tokens, '#FDF1DC', this.tokens.theme.woodDark, 10);
    const qText = fig.quote;
    const mid = Math.ceil(qText.length / 2);
    drawOutlinedText(ctx, qText.slice(0, mid), p.x + pw * 0.5, qBox.y + 19, `600 11.5px ${this.tokens.typography.fontFamily}`, this.tokens.theme.inkOutline, '#FFF', 0);
    drawOutlinedText(ctx, qText.slice(mid), p.x + pw * 0.5, qBox.y + 39, `600 11.5px ${this.tokens.typography.fontFamily}`, this.tokens.theme.inkOutline, '#FFF', 0);

    const canShare = fig.rarity === 'GOLD' || fig.rarity === 'RED';
    if (canShare) {
      this.detailShareRect = { x: p.x + 22, y: p.y + ph - 58, w: 142, h: 42 };
      this.popupCloseRect = { x: p.x + pw - 142, y: p.y + ph - 58, w: 120, h: 42 };
      drawWoodButton(ctx, this.detailShareRect, '📤 晒欧气', this.tokens, assets, {
        fillHex: '#DC2626',
      });
      drawWoodButton(ctx, this.popupCloseRect, '关闭', this.tokens, assets);
    } else {
      this.detailShareRect = null;
      this.popupCloseRect = { x: p.x + (pw - 136) * 0.5, y: p.y + ph - 58, w: 136, h: 42 };
      drawWoodButton(ctx, this.popupCloseRect, '关闭', this.tokens, assets);
    }
  }

  private renderProbPopup(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    assets: AssetLoader
  ): void {
    const pw = Math.min(344, W - 24);
    const ph = 420;
    const p: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };
    drawParchmentModalFrame(ctx, W, H, p, '📊 盲盒与合成概率公示', this.tokens, assets);

    const lines = [
      '【六种盲盒品质概率】',
      '• 素白盒：白35% 绿30% 蓝20% 紫10% 金4% 红1%',
      '• 炫紫盒：绿20% 蓝35% 紫28% 金13% 大红4%',
      '• 流光金盒：蓝10% 紫35% 金40% 大红15%',
      '• 至尊大红箱：传说金45% · 绝世大红55%',
      '• 极寒冰封盒：绿10% 蓝30% 紫40% 金14% 红6%(冰系×2)',
      '• 双黄蛋第2抽：蓝45% 紫35% 金15% 大红5%',
      '',
      '【双重保底与碎片合成】',
      '• 暗保底：连抽15盒必出金+；连抽40盒高阶必爆大红',
      '• 未解锁权重 ×1.5；满图鉴冲刺盒不二次返还碎片',
      '• 5碎片合成：白35/绿28/蓝20/紫10/金5/红2(未有池)',
      '• 25碎片合成：紫60% / 金30% / 大红10%(未有池)',
    ];
    ctx.save();
    ctx.font = `600 11px ${this.tokens.typography.fontFamily}`;
    ctx.fillStyle = this.tokens.theme.inkOutline;
    ctx.textAlign = 'left';
    lines.forEach((ln, idx) => {
      ctx.fillText(ln, p.x + 16, p.y + 42 + idx * 23);
    });
    ctx.restore();

    this.popupCloseRect = { x: p.x + (pw - 132) * 0.5, y: p.y + ph - 52, w: 132, h: 40 };
    drawWoodButton(ctx, this.popupCloseRect, '我知道了', this.tokens, assets, {
      fillHex: '#15803D',
    });
  }

  private renderHighPoolPrompt(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    assets: AssetLoader
  ): void {
    const pw = Math.min(332, W - 28);
    const ph = 216;
    const p: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };
    drawParchmentModalFrame(ctx, W, H, p, '✨ 高阶藏品已 12/12 集齐', this.tokens, assets);

    drawOutlinedText(ctx, '紫/金/大红 12 款已全部点亮！', p.x + pw * 0.5, p.y + 58, `700 13px ${this.tokens.typography.fontFamily}`, '#B45309', '#FFF', 0);
    drawOutlinedText(ctx, '推荐用【5碎片】100%补齐剩余图鉴，', p.x + pw * 0.5, p.y + 84, `600 12px ${this.tokens.typography.fontFamily}`, this.tokens.theme.inkOutline, '#FFF', 0);
    drawOutlinedText(ctx, '或继续25碎片冲刺身价（不返还碎片）。', p.x + pw * 0.5, p.y + 106, `600 12px ${this.tokens.typography.fontFamily}`, this.tokens.theme.inkSecondary, '#FFF', 0);

    this.highPromptUse5Rect = { x: p.x + 18, y: p.y + ph - 56, w: 138, h: 40 };
    this.highPromptForce25Rect = { x: p.x + pw - 156, y: p.y + ph - 56, w: 138, h: 40 };
    drawWoodButton(ctx, this.highPromptUse5Rect, '改用5碎片合成', this.tokens, assets, { fillHex: '#0284C7', fontSize: 12 });
    drawWoodButton(ctx, this.highPromptForce25Rect, '继续冲刺身价', this.tokens, assets, { fillHex: '#D97706', fontSize: 12 });
  }

  private renderCraftRevealModal(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    out: CraftOutcome,
    assets: AssetLoader
  ): void {
    const pw = Math.min(316, W - 32);
    const ph = 376;
    const p: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };
    drawParchmentModalFrame(
      ctx,
      W,
      H,
      p,
      this.craftRevealed ? '🎉 碎片合成出货！' : '🔍 正在凝结淘金碎片...',
      this.tokens,
      assets
    );

    const cardRect: Rect = { x: p.x + (pw - 160) * 0.5, y: p.y + 44, w: 160, h: 208 };
    if (!this.craftRevealed) {
      drawWoodCapsule(ctx, cardRect, this.tokens, '#FDF1DC', this.tokens.theme.woodDark, 12);
      const cx = cardRect.x + 80;
      const cy = cardRect.y + 104;
      const shardImg = assets.get('ui_shard_icon');
      if (shardImg) {
        ctx.drawImage(shardImg, cx - 32, cy - 32, 64, 64);
      }
      const theta = (this.craftScanSec / Math.max(0.2, this.craftScanTargetSec)) * Math.PI * 2.4;
      const magImg = assets.get('ui_magnifier');
      if (magImg) {
        ctx.drawImage(magImg, cx + Math.cos(theta) * 22 - 30, cy + Math.sin(theta) * 22 - 30, 64, 64);
      }
      drawOutlinedText(ctx, '点击可立即翻开', cx, p.y + ph - 42, `600 12px ${this.tokens.typography.fontFamily}`, this.tokens.theme.inkSecondary, '#FFF', 0);
    } else {
      this.renderGalleryFigurineCard(ctx, cardRect, out.figurine, 1, assets);
      drawOutlinedText(
        ctx,
        `身价暴涨 +${out.valuationAdded.toLocaleString()}`,
        p.x + pw * 0.5,
        cardRect.y + cardRect.h + 24,
        `800 15px ${this.tokens.typography.numeralFontFamily}`,
        '#D97706',
        '#FFF8EC',
        2
      );
      this.popupCloseRect = { x: p.x + (pw - 140) * 0.5, y: p.y + ph - 54, w: 140, h: 42 };
      drawWoodButton(ctx, this.popupCloseRect, '收入藏馆 ✓', this.tokens, assets, {
        fillHex: '#15803D',
      });
    }
  }
}
