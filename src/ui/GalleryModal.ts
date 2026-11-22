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
  drawCollectibleCard,
  drawCoverImage,
  drawDoubleRimPlaque,
  drawInkText,
  drawParchmentModalFrame,
  drawRecessedTileCard,
  drawStatusPill,
  drawWoodButton,
  formatNetWorth,
  hitRect,
  roundRectPath,
} from './UIHelpers';

export type GalleryAction =
  | { type: 'BACK_TO_GAME' }
  | { type: 'SHARE_FIGURINE'; fig: FigurineItem }
  | { type: 'TOAST'; msg: string };

/**
 * 大红藏馆与双档碎片合成界面（GalleryModal）
 * 全量复用统一藏品卡 drawCollectibleCard、双层嵌芯羊皮纸卡与双圈木镶边牌匾
 */
export class GalleryModal {
  public activeSeriesIdx = 0;
  public scrollY = 0;
  public selectedFigurine: FigurineItem | null = null;
  public showProbPopup = false;
  public showHighPoolFullPrompt = false;

  private activeCraftReveal: CraftOutcome | null = null;
  private craftScanSec = 0;
  private craftScanTargetSec = 1.0;
  private craftRevealed = false;

  private isDraggingScroll = false;
  private dragStartY = 0;
  private scrollStartY = 0;

  private backBtnRect: Rect = { x: 12, y: 14, w: 78, h: 32 };
  private authTagRect: Rect = { x: 0, y: 0, w: 96, h: 24 };
  private tabRects: [Rect, Rect] = [
    { x: 0, y: 0, w: 170, h: 36 },
    { x: 0, y: 0, w: 170, h: 36 },
  ];
  private seriesRewardBtnRect: Rect = { x: 0, y: 0, w: 86, h: 30 };
  private viewportRect: Rect = { x: 12, y: 210, w: 366, h: 420 };
  private maxScrollY = 0;
  private cardHitList: { fig: FigurineItem; rect: Rect; owned: boolean }[] = [];

  private probBtnRect: Rect = { x: 0, y: 0, w: 68, h: 22 };
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

    if (this.selectedFigurine) {
      if (this.detailShareRect && hitRect(px, py, this.detailShareRect)) {
        return { type: 'SHARE_FIGURINE', fig: this.selectedFigurine };
      }
      if (hitRect(px, py, this.popupCloseRect) || !hitRect(px, py, { x: 20, y: 120, w: layout.screenW - 40, h: layout.screenH - 240 })) {
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

    if (hitRect(px, py, this.backBtnRect)) {
      return { type: 'BACK_TO_GAME' };
    }

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

    if (hitRect(px, py, this.probBtnRect)) {
      this.showProbPopup = true;
      this.audio.playEvent('UI_BUTTON_TAP');
      return null;
    }

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
      ctx.fillStyle = 'rgba(26, 16, 8, 0.30)';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = this.tokens.theme.starryNightBg;
      ctx.fillRect(0, 0, W, H);
    }

    // 顶部双圈返回按钮 + 居中木镶羊皮纸标题匾（严格避让微信右上角胶囊）
    this.backBtnRect = { x: 12, y: layout.topHudY, w: 76, h: layout.topHudH };
    drawDoubleRimPlaque(ctx, this.backBtnRect, this.tokens, {
      variant: 'parchment',
      rimThickness: 3.4,
      radius: layout.topHudH * 0.5,
    });
    drawInkText(ctx, '◂ 返回', this.backBtnRect.x + 38, layout.topHudY + layout.topHudH * 0.5 + 0.5, this.tokens, {
      font: `800 12.5px ${this.tokens.typography.fontFamily}`,
      color: '#3E2311',
    });

    const titlePlaque: Rect = { x: (W - 148) * 0.5, y: layout.topHudY, w: 148, h: layout.topHudH };
    drawDoubleRimPlaque(ctx, titlePlaque, this.tokens, {
      variant: 'amber',
      rimThickness: 3.6,
      radius: layout.topHudH * 0.5,
    });
    drawInkText(ctx, '✦ 大红藏馆 ✦', W * 0.5, layout.topHudY + layout.topHudH * 0.5 + 0.5, this.tokens, {
      font: `800 14.5px ${this.tokens.typography.fontFamily}`,
      color: '#4A240B',
    });

    // 1. 馆主身份与总身价嵌芯羊皮纸名片卡
    const bannerY = layout.topHudY + layout.topHudH + 8;
    const banner: Rect = { x: 12, y: bannerY, w: W - 24, h: 72 };
    const bInner = drawRecessedTileCard(ctx, banner, this.tokens, {
      variant: 'parchment',
      radius: 14,
      rimWidth: 3.8,
    });

    const avatarWell: Rect = { x: bInner.x + 6, y: bInner.y + (bInner.h - 48) * 0.5, w: 48, h: 48 };
    drawDoubleRimPlaque(ctx, avatarWell, this.tokens, {
      variant: 'amber',
      rimThickness: 2.5,
      radius: 12,
      shadow: false,
    });
    const avatarImg = assets.get('ui_avatar_default_duck');
    if (avatarImg) {
      ctx.drawImage(avatarImg, avatarWell.x + 4, avatarWell.y + 4, 40, 40);
    }

    drawInkText(ctx, auth.profile.nickName, banner.x + 68, banner.y + 24, this.tokens, {
      font: `800 13px ${this.tokens.typography.fontFamily}`,
      color: '#3E2311',
      align: 'left',
      maxWidth: 118,
    });

    const rank = saveMgr.getRankBadge(this.tokens);
    if (!auth.profile.isAuthorized) {
      this.authTagRect = { x: banner.x + 64, y: banner.y + 40, w: 96, h: 24 };
      drawDoubleRimPlaque(ctx, this.authTagRect, this.tokens, {
        variant: 'amber',
        rimThickness: 2.2,
        radius: 12,
        shadow: false,
      });
      drawInkText(ctx, '同步微信头像 ›', this.authTagRect.x + 48, this.authTagRect.y + 12.5, this.tokens, {
        font: `700 9.5px ${this.tokens.typography.fontFamily}`,
        color: '#6E320C',
      });
    } else {
      drawStatusPill(ctx, banner.x + 114, banner.y + 50, `Lv.${rank.level} ${rank.title}`, this.tokens, {
        bgHex: '#FEF3C7',
        borderHex: '#B45309',
        textColor: '#78350F',
        fontSize: 9.5,
      });
    }

    const ownedTotal = saveMgr.getOwnedUniqueCount();
    drawInkText(
      ctx,
      `总身价 ${formatNetWorth(saveMgr.data.totalNetWorth)}`,
      bInner.x + bInner.w - 8,
      banner.y + 25,
      this.tokens,
      {
        font: `800 15.5px ${this.tokens.typography.numeralFontFamily}`,
        color: '#9A3412',
        align: 'right',
      }
    );
    drawInkText(
      ctx,
      `${rank.title} · 已集 ${ownedTotal}/30`,
      bInner.x + bInner.w - 8,
      banner.y + 49,
      this.tokens,
      {
        font: `600 10.5px ${this.tokens.typography.fontFamily}`,
        color: '#6E4A2A',
        align: 'right',
      }
    );

    // 2. 双套系切换签 + 15/15 大奖收集条
    const seriesList = gacha.getSeriesList();
    const tabY = banner.y + banner.h + 7;
    const tabW = Math.floor((W - 32) * 0.5);
    this.tabRects = [
      { x: 12, y: tabY, w: tabW, h: 34 },
      { x: 20 + tabW, y: tabY, w: tabW, h: 34 },
    ];

    seriesList.forEach((s, idx) => {
      const st = gacha.checkSeriesCompletion(s, saveMgr.data);
      const active = this.activeSeriesIdx === idx;
      const shortTitle = idx === 0 ? `◆ 打工萌宠 (${st.ownedCount}/15)` : `◆ 暴富食堂 (${st.ownedCount}/15)`;
      const tInner = drawDoubleRimPlaque(ctx, this.tabRects[idx], this.tokens, {
        variant: active ? 'amber' : 'parchment',
        rimThickness: active ? 3.5 : 2.8,
        radius: 17,
      });
      drawInkText(
        ctx,
        shortTitle,
        tInner.x + tInner.w * 0.5,
        this.tabRects[idx].y + 17.5,
        this.tokens,
        {
          font: `${active ? '800' : '700'} 11.5px ${this.tokens.typography.fontFamily}`,
          color: active ? '#4A240B' : '#6E4C30',
          maxWidth: tInner.w - 10,
        }
      );
      if (st.isComplete && !st.isClaimed) {
        drawStatusPill(ctx, this.tabRects[idx].x + tabW - 18, tabY + 2, '大奖', this.tokens, {
          bgHex: '#FEE2E2',
          borderHex: '#B91C1C',
          textColor: '#991B1B',
          fontSize: 8.5,
          height: 14,
          padX: 7,
        });
      }
    });

    const curSeries = seriesList[this.activeSeriesIdx];
    const curSeriesStatus = gacha.checkSeriesCompletion(curSeries, saveMgr.data);
    const rewardBar: Rect = { x: 12, y: tabY + 39, w: W - 24, h: 42 };
    const rInner = drawRecessedTileCard(ctx, rewardBar, this.tokens, {
      variant: curSeriesStatus.isComplete ? 'amber' : 'parchment',
      radius: 12,
      rimWidth: 3.0,
    });

    const rIconId =
      curSeries.unlockReward.type === 'sand_skin' ? 'ui_reward_skin_galaxy' : 'ui_reward_fx_rainbow';
    const rIcon = assets.get(rIconId);
    if (rIcon) {
      ctx.drawImage(rIcon, rInner.x + 5, rewardBar.y + 6, 30, 30);
    }
    drawInkText(
      ctx,
      `15/15 满集限定：${curSeries.unlockReward.name}`,
      rInner.x + 40,
      rewardBar.y + 21.5,
      this.tokens,
      {
        font: `700 11.5px ${this.tokens.typography.fontFamily}`,
        color: '#3E2311',
        align: 'left',
        maxWidth: rInner.w - 130,
      }
    );

    this.seriesRewardBtnRect = { x: rewardBar.x + rewardBar.w - 86, y: rewardBar.y + 6, w: 78, h: 30 };
    const rBtnLabel = !curSeriesStatus.isComplete
      ? `${curSeriesStatus.ownedCount}/15`
      : !curSeriesStatus.isClaimed
        ? '立即激活'
        : curSeriesStatus.isEquipped
          ? '穿戴中 ✓'
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

    // 3. 中部 3×5 可滚动公仔图鉴网格（复用 drawCollectibleCard）
    const craftBarH = 78 + (H > 760 ? 12 : 4);
    const vpTop = rewardBar.y + rewardBar.h + 7;
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
        drawCollectibleCard(ctx, rect, fig, this.tokens, assets, {
          owned,
          count,
          showCountBadge: true,
        });
      }
    });
    ctx.restore();

    // 4. 底部吸底【淘金碎片合成台】嵌芯木框卡
    const barY = H - craftBarH;
    const barRect: Rect = { x: 10, y: barY, w: W - 20, h: craftBarH - 6 };
    const cInner = drawRecessedTileCard(ctx, barRect, this.tokens, {
      variant: 'parchment',
      radius: 15,
      rimWidth: 3.8,
    });

    const shardImg = assets.get('ui_shard_icon');
    if (shardImg) {
      ctx.drawImage(shardImg, cInner.x + 6, barRect.y + 10, 24, 24);
    }
    drawInkText(ctx, `×${saveMgr.data.shards}`, cInner.x + 34, barRect.y + 22, this.tokens, {
      font: `800 15.5px ${this.tokens.typography.numeralFontFamily}`,
      color: '#9A3412',
      align: 'left',
    });

    this.probBtnRect = drawStatusPill(ctx, cInner.x + 42, barRect.y + 49, 'ⓘ 概率公示', this.tokens, {
      bgHex: '#F3E5CA',
      borderHex: '#8C5423',
      textColor: '#4A2B13',
      fontSize: 9.5,
      padX: 10,
      height: 19,
    });

    const fullAll = ownedTotal >= 30;
    const fullHigh = gacha.isHighTierPoolFull(saveMgr.data);

    const btnW25 = Math.min(130, Math.floor((barRect.w - 106) * 0.53));
    const btnW5 = Math.min(116, barRect.w - 106 - btnW25);
    this.craft5BtnRect = {
      x: barRect.x + barRect.w - btnW5 - btnW25 - 14,
      y: barRect.y + (barRect.h - 48) * 0.5,
      w: btnW5,
      h: 48,
    };
    this.craft25BtnRect = {
      x: barRect.x + barRect.w - btnW25 - 8,
      y: barRect.y + (barRect.h - 48) * 0.5,
      w: btnW25,
      h: 48,
    };

    drawWoodButton(ctx, this.craft5BtnRect, fullAll ? '5 身价冲刺' : '5 普通合成', this.tokens, assets, {
      fontSize: 11.5,
      icon: shardImg,
      iconSize: 19,
      subLabel: fullAll ? '全池冲身价' : '100%出未有',
      fillHex: '#0284C7',
      disabled: saveMgr.data.shards < 5,
    });

    drawWoodButton(ctx, this.craft25BtnRect, fullHigh ? '25 高阶冲刺' : '25 紫金红', this.tokens, assets, {
      fontSize: 11.5,
      icon: shardImg,
      iconSize: 19,
      subLabel: fullHigh ? '紫金红冲身价' : '必出未有高阶',
      fillHex: '#DC2626',
      disabled: saveMgr.data.shards < 25,
      pulse: saveMgr.data.shards >= 25 && !fullHigh,
      pulsePhase: timeSec * 5.6,
    });

    // 5. 二级弹窗渲染
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

  private renderFigurineDetailModal(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    fig: FigurineItem,
    count: number,
    assets: AssetLoader
  ): void {
    const pw = Math.min(336, W - 26);
    const ph = 428;
    const p: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };
    const rarTok = this.tokens.rarityTokens[fig.rarity];

    drawParchmentModalFrame(ctx, W, H, p, `${rarTok.label} · ${fig.name}`, this.tokens, assets);

    const cardRect: Rect = { x: p.x + (pw - 160) * 0.5, y: p.y + 32, w: 160, h: 206 };
    drawCollectibleCard(ctx, cardRect, fig, this.tokens, assets, {
      owned: true,
      count,
      showCountBadge: true,
    });

    drawInkText(
      ctx,
      `单件估值：${fig.valuation.toLocaleString()}   ·   累计馆藏：×${count}`,
      p.x + pw * 0.5,
      p.y + 258,
      this.tokens,
      {
        font: `800 12px ${this.tokens.typography.numeralFontFamily}`,
        color: '#9A3412',
      }
    );

    const qBox: Rect = { x: p.x + 18, y: p.y + 278, w: pw - 36, h: 62 };
    const qInner = drawRecessedTileCard(ctx, qBox, this.tokens, {
      variant: 'amber',
      radius: 11,
      rimWidth: 3.0,
    });
    const qText = fig.quote;
    const mid = Math.ceil(qText.length / 2);
    drawInkText(ctx, qText.slice(0, mid), p.x + pw * 0.5, qInner.y + qInner.h * 0.34, this.tokens, {
      font: `600 11.5px ${this.tokens.typography.fontFamily}`,
      color: '#3E2311',
      maxWidth: qInner.w - 12,
    });
    drawInkText(ctx, qText.slice(mid), p.x + pw * 0.5, qInner.y + qInner.h * 0.72, this.tokens, {
      font: `600 11.5px ${this.tokens.typography.fontFamily}`,
      color: '#3E2311',
      maxWidth: qInner.w - 12,
    });

    const canShare = fig.rarity === 'GOLD' || fig.rarity === 'RED';
    if (canShare) {
      this.detailShareRect = { x: p.x + 22, y: p.y + ph - 58, w: 142, h: 42 };
      this.popupCloseRect = { x: p.x + pw - 142, y: p.y + ph - 58, w: 120, h: 42 };
      drawWoodButton(ctx, this.detailShareRect, '✦ 晒出欧气', this.tokens, assets, {
        fillHex: '#DC2626',
        fontSize: 13.5,
      });
      drawWoodButton(ctx, this.popupCloseRect, '关闭', this.tokens, assets, { fontSize: 13.5 });
    } else {
      this.detailShareRect = null;
      this.popupCloseRect = { x: p.x + (pw - 136) * 0.5, y: p.y + ph - 58, w: 136, h: 42 };
      drawWoodButton(ctx, this.popupCloseRect, '关闭', this.tokens, assets, { fontSize: 13.5 });
    }
  }

  private renderProbPopup(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    assets: AssetLoader
  ): void {
    const pw = Math.min(346, W - 22);
    const ph = 428;
    const p: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };
    drawParchmentModalFrame(ctx, W, H, p, '盲盒与合成概率公示', this.tokens, assets);

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
    lines.forEach((ln, idx) => {
      if (!ln) return;
      const isHead = ln.startsWith('【');
      drawInkText(ctx, ln, p.x + 18, p.y + 42 + idx * 23, this.tokens, {
        font: `${isHead ? '800' : '600'} 11px ${this.tokens.typography.fontFamily}`,
        color: isHead ? '#7C2D12' : '#3E2311',
        align: 'left',
        maxWidth: pw - 36,
      });
    });

    this.popupCloseRect = { x: p.x + (pw - 134) * 0.5, y: p.y + ph - 54, w: 134, h: 40 };
    drawWoodButton(ctx, this.popupCloseRect, '我知道了', this.tokens, assets, {
      fillHex: '#15803D',
      fontSize: 13.5,
    });
  }

  private renderHighPoolPrompt(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    assets: AssetLoader
  ): void {
    const pw = Math.min(334, W - 26);
    const ph = 220;
    const p: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };
    drawParchmentModalFrame(ctx, W, H, p, '高阶藏品已 12/12 集齐', this.tokens, assets);

    drawInkText(ctx, '紫 / 金 / 大红 12 款已全部点亮！', p.x + pw * 0.5, p.y + 58, this.tokens, {
      font: `800 13px ${this.tokens.typography.fontFamily}`,
      color: '#9A3412',
    });
    drawInkText(ctx, '推荐改用【5 碎片】100% 补齐剩余图鉴，', p.x + pw * 0.5, p.y + 84, this.tokens, {
      font: `600 12px ${this.tokens.typography.fontFamily}`,
      color: '#3E2311',
    });
    drawInkText(ctx, '或继续 25 碎片冲刺身价（不二次返碎片）。', p.x + pw * 0.5, p.y + 108, this.tokens, {
      font: `600 11.5px ${this.tokens.typography.fontFamily}`,
      color: '#6E4A2A',
    });

    this.highPromptUse5Rect = { x: p.x + 18, y: p.y + ph - 56, w: 138, h: 40 };
    this.highPromptForce25Rect = { x: p.x + pw - 156, y: p.y + ph - 56, w: 138, h: 40 };
    drawWoodButton(ctx, this.highPromptUse5Rect, '改用5碎片合成', this.tokens, assets, {
      fillHex: '#0284C7',
      fontSize: 12,
    });
    drawWoodButton(ctx, this.highPromptForce25Rect, '继续冲刺身价', this.tokens, assets, {
      fillHex: '#D97706',
      fontSize: 12,
    });
  }

  private renderCraftRevealModal(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    out: CraftOutcome,
    assets: AssetLoader
  ): void {
    const pw = Math.min(320, W - 30);
    const ph = 382;
    const p: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };
    drawParchmentModalFrame(
      ctx,
      W,
      H,
      p,
      this.craftRevealed ? '✦ 碎片合成出货 ✦' : '正在凝结淘金碎片...',
      this.tokens,
      assets
    );

    const cardRect: Rect = { x: p.x + (pw - 160) * 0.5, y: p.y + 40, w: 160, h: 208 };
    if (!this.craftRevealed) {
      drawRecessedTileCard(ctx, cardRect, this.tokens, {
        variant: 'amber',
        radius: 13,
        rimWidth: 3.6,
      });
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
      drawInkText(ctx, '轻触画面可立即揭晓', cx, p.y + ph - 42, this.tokens, {
        font: `700 12px ${this.tokens.typography.fontFamily}`,
        color: '#6E4A2A',
      });
    } else {
      drawCollectibleCard(ctx, cardRect, out.figurine, this.tokens, assets, {
        owned: true,
        isNewUnlock: out.isNewUnlock,
      });
      drawInkText(
        ctx,
        `身价暴涨  +${out.valuationAdded.toLocaleString()}`,
        p.x + pw * 0.5,
        cardRect.y + cardRect.h + 24,
        this.tokens,
        {
          font: `800 14.5px ${this.tokens.typography.numeralFontFamily}`,
          color: '#9A3412',
        }
      );
      this.popupCloseRect = { x: p.x + (pw - 142) * 0.5, y: p.y + ph - 54, w: 142, h: 42 };
      drawWoodButton(ctx, this.popupCloseRect, '收入藏馆 ✓', this.tokens, assets, {
        fillHex: '#15803D',
        fontSize: 13.5,
      });
    }
  }
}
