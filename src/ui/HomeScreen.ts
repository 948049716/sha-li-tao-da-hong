import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { GachaSystem } from '../systems/GachaSystem';
import type { LevelManager } from '../systems/LevelManager';
import type { SaveManager } from '../systems/SaveManager';
import type { Rect, UiTokensFile } from '../types/ui';
import type { SplashScreen } from './SplashScreen';
import {
  drawCoverImage,
  drawOutlinedText,
  drawWoodButton,
  drawWoodCapsule,
  formatNetWorth,
  hitRect,
} from './UIHelpers';

export type HomeAction =
  | { type: 'START_GAME' }
  | { type: 'OPEN_LEVEL_SELECT' }
  | { type: 'OPEN_GALLERY' }
  | { type: 'OPEN_GUIDE' }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'SHARE_FRIEND' };

/**
 * 星夜淘沙工坊 · 主菜单大厅（HOME 场景）
 * 严格避让微信右上角「更多游戏 + 胶囊按钮」安全区，汇聚开玩、选关、大红藏馆、玩法图鉴、设置与分享六大核心功能
 */
export class HomeScreen {
  public showCadpaModal = false;

  private worthPillRect: Rect = { x: 0, y: 0, w: 180, h: 34 };
  private shardPillRect: Rect = { x: 0, y: 0, w: 110, h: 34 };
  private startBtnRect: Rect = { x: 0, y: 0, w: 300, h: 58 };
  private levelBtnRect: Rect = { x: 0, y: 0, w: 150, h: 56 };
  private galleryBtnRect: Rect = { x: 0, y: 0, w: 150, h: 56 };
  private guideBtnRect: Rect = { x: 0, y: 0, w: 150, h: 56 };
  private settingsBtnRect: Rect = { x: 0, y: 0, w: 150, h: 56 };
  private shareBtnRect: Rect = { x: 0, y: 0, w: 196, h: 36 };
  private cadpaBadgeRect: Rect = { x: 16, y: 0, w: 36, h: 42 };
  private cadpaCloseRect: Rect = { x: 0, y: 0, w: 124, h: 38 };

  public handleTap(px: number, py: number): HomeAction | 'CONSUMED' | null {
    if (this.showCadpaModal) {
      if (hitRect(px, py, this.cadpaCloseRect)) {
        this.showCadpaModal = false;
      }
      return 'CONSUMED';
    }

    if (hitRect(px, py, this.cadpaBadgeRect)) {
      this.showCadpaModal = true;
      return 'CONSUMED';
    }

    if (hitRect(px, py, this.startBtnRect)) return { type: 'START_GAME' };
    if (hitRect(px, py, this.levelBtnRect)) return { type: 'OPEN_LEVEL_SELECT' };
    if (hitRect(px, py, this.galleryBtnRect) || hitRect(px, py, this.worthPillRect) || hitRect(px, py, this.shardPillRect)) {
      return { type: 'OPEN_GALLERY' };
    }
    if (hitRect(px, py, this.guideBtnRect)) return { type: 'OPEN_GUIDE' };
    if (hitRect(px, py, this.settingsBtnRect)) return { type: 'OPEN_SETTINGS' };
    if (hitRect(px, py, this.shareBtnRect)) return { type: 'SHARE_FRIEND' };

    return null;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    levelMgr: LevelManager,
    gacha: GachaSystem,
    saveMgr: SaveManager,
    assets: AssetLoader,
    splash: SplashScreen,
    hasCraftableRedDot: boolean,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    const W = layout.screenW;
    const H = layout.screenH;
    const compact = H < 740;

    // 1. 全屏星夜木屋工坊背景 + 暖暗渐变衬底
    const bg = assets.get('ui_bg_splash');
    if (bg) {
      drawCoverImage(ctx, bg, W, H);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(15, 23, 42, 0.28)');
      grad.addColorStop(0.45, 'rgba(22, 16, 12, 0.16)');
      grad.addColorStop(1, 'rgba(22, 16, 12, 0.62)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = tokens.theme.starryNightBg;
      ctx.fillRect(0, 0, W, H);
    }

    // 2. 顶部玩家头衔身价栏（严格置于微信胶囊行下方，100% 避让「更多游戏」与官方胶囊）
    const safeTop = layout.menuRect.y + layout.menuRect.h + 8;
    const worthW = Math.min(226, Math.floor((W - 32) * 0.64));
    const shardW = W - 32 - worthW - 8;
    this.worthPillRect = { x: 16, y: safeTop, w: worthW, h: 34 };
    this.shardPillRect = { x: 16 + worthW + 8, y: safeTop, w: shardW, h: 34 };

    const rank = saveMgr.getRankBadge(tokens);
    drawWoodCapsule(ctx, this.worthPillRect, tokens, '#3B2514', '#1F1209', 16);
    const coinImg = assets.get('ui_networth_coin');
    if (coinImg) {
      ctx.drawImage(coinImg, this.worthPillRect.x + 8, this.worthPillRect.y + 6, 22, 22);
    }
    drawOutlinedText(
      ctx,
      `${rank.title} · ${formatNetWorth(saveMgr.data.totalNetWorth)}`,
      this.worthPillRect.x + 35,
      this.worthPillRect.y + 17,
      `700 11.5px ${tokens.typography.fontFamily}`,
      '#FDE047',
      '#1F1209',
      2,
      'left'
    );

    drawWoodCapsule(ctx, this.shardPillRect, tokens, '#4C1D95', '#2E1065', 16);
    const shardImg = assets.get('ui_shard_icon');
    if (shardImg) {
      ctx.drawImage(shardImg, this.shardPillRect.x + 8, this.shardPillRect.y + 7, 20, 20);
    }
    drawOutlinedText(
      ctx,
      `碎片 ×${saveMgr.data.shards}`,
      this.shardPillRect.x + this.shardPillRect.w * 0.5 + (shardImg ? 8 : 0),
      this.shardPillRect.y + 17,
      `700 11.5px ${tokens.typography.fontFamily}`,
      '#F3E8FF',
      '#1F1209',
      2
    );

    // 3. 自底向上计算无重叠栅格锚点（兼容 667px 紧凑屏 ~ 932px 超长屏）
    const curLvl = levelMgr.getLevel(saveMgr.data.currentLevel);
    const ownedCount = saveMgr.getOwnedUniqueCount();
    const goldLeft = Math.max(1, 16 - saveMgr.data.pityGoldCount);
    const redLeft = Math.max(1, 41 - saveMgr.data.pityRedCount);

    const footerTop = H - (compact ? 44 : 52);
    const gridBtnH = compact ? 48 : 54;
    const gridGap = 10;
    const mainBtnH = compact ? 50 : 58;
    const cardH = compact ? 136 : 162;

    const gridRow2Y = footerTop - gridBtnH - (compact ? 6 : 10);
    const gridRow1Y = gridRow2Y - gridBtnH - gridGap;
    const startBtnY = gridRow1Y - mainBtnH - (compact ? 10 : 14);
    const cardY = startBtnY - cardH - (compact ? 10 : 14);

    // 4. 品牌主标题 Logo 等比缩放居中于顶部胶囊栏与中部展台之间
    const pillBottom = safeTop + 34;
    const subtitleY = cardY - (compact ? 12 : 16);
    const heroTop = pillBottom + 6;
    const heroAvailH = Math.max(56, subtitleY - 14 - heroTop);
    const logo = assets.get('ui_logo_title');
    const bob = Math.sin(timeSec * 2.4) * 3;

    if (logo && logo.width > 0 && logo.height > 0) {
      const maxLogoW = W * 0.72;
      const fitScale = Math.min(maxLogoW / logo.width, heroAvailH / logo.height);
      const lw = logo.width * fitScale;
      const lh = logo.height * fitScale;
      const ly = heroTop + (heroAvailH - lh) * 0.5;
      ctx.drawImage(logo, (W - lw) * 0.5, ly + bob, lw, lh);
    } else {
      drawOutlinedText(
        ctx,
        '沙里淘大红',
        W * 0.5,
        heroTop + heroAvailH * 0.5 + bob,
        `800 34px ${tokens.typography.fontFamily}`,
        '#FFF8EC',
        tokens.theme.inkOutline,
        4
      );
    }

    drawOutlinedText(
      ctx,
      '✨ 烧脑抽栓导流沙 · 开箱慢转鉴大红 ✨',
      W * 0.5,
      subtitleY,
      `700 12px ${tokens.typography.fontFamily}`,
      '#FEF3C7',
      '#3B2514',
      2.4
    );

    // 5. 中部「工坊镇馆进度展台」羊皮纸木框卡片
    const cardW = W - 32;
    const cardRect: Rect = { x: 16, y: cardY, w: cardW, h: cardH };
    drawWoodCapsule(ctx, cardRect, tokens, 'rgba(255, 248, 236, 0.94)', tokens.theme.woodDark, 18);

    // 左侧展示三宝盒 / 已解锁最高价值镇馆大红公仔
    const stageRect: Rect = {
      x: cardRect.x + 12,
      y: cardRect.y + 12,
      w: compact ? 98 : 114,
      h: cardRect.h - 24,
    };
    drawWoodCapsule(ctx, stageRect, tokens, '#1E294B', '#5A3A22', 14);

    // 查找玩家已拥有的最高估值公仔
    let topOwnedFig = null;
    for (const f of gacha.allFigurines) {
      if ((saveMgr.data.ownedMap[f.id] || 0) > 0) {
        if (!topOwnedFig || f.valuation > topOwnedFig.valuation) {
          topOwnedFig = f;
        }
      }
    }

    const stageCx = stageRect.x + stageRect.w * 0.5;
    const stageCy = stageRect.y + stageRect.h * 0.45;
    const glowR = Math.min(stageRect.w, stageRect.h) * 0.38;
    ctx.save();
    ctx.fillStyle = topOwnedFig?.rarity === 'RED' ? 'rgba(239, 68, 68, 0.38)' : 'rgba(251, 191, 36, 0.32)';
    ctx.beginPath();
    ctx.arc(stageCx, stageCy, glowR * (0.92 + 0.08 * Math.sin(timeSec * 4)), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const heroSprite = topOwnedFig ? assets.get(topOwnedFig.id) : assets.get('box_red');
    const subLeftBox = assets.get('box_purple');
    const subRightBox = assets.get('box_gold');
    if (!topOwnedFig && subLeftBox && subRightBox) {
      ctx.drawImage(subLeftBox, stageCx - 42, stageCy - 8, 32, 32);
      ctx.drawImage(subRightBox, stageCx + 10, stageCy - 8, 32, 32);
    }
    if (heroSprite) {
      const sz = topOwnedFig ? Math.min(stageRect.w - 16, stageRect.h - 32) : 52;
      ctx.drawImage(heroSprite, stageCx - sz * 0.5, stageCy - sz * 0.52 + bob * 0.5, sz, sz);
    }
    drawOutlinedText(
      ctx,
      topOwnedFig ? topOwnedFig.name.slice(0, 6) : '至尊大红箱',
      stageCx,
      stageRect.y + stageRect.h - 13,
      `700 10.5px ${tokens.typography.fontFamily}`,
      '#FDE047',
      '#1E294B',
      2
    );

    // 右侧工坊进度摘要
    const infoX = stageRect.x + stageRect.w + 12;
    drawOutlinedText(
      ctx,
      `📍 第 ${curLvl.levelId} 关「${curLvl.title}」`,
      infoX,
      cardRect.y + (compact ? 26 : 32),
      `700 13px ${tokens.typography.fontFamily}`,
      tokens.theme.inkOutline,
      '#FFFFFF',
      0,
      'left'
    );

    const statRows = [
      `🏆 章节进度：已通 ${saveMgr.data.maxClearedLevel} / ${levelMgr.totalLevels} 关`,
      `🏛️ 大红图鉴：已集 ${ownedCount} / 30 款`,
      `🔥 欧气保底：${goldLeft}抽必金 · ${redLeft}抽必红`,
    ];
    ctx.save();
    ctx.font = `600 11.5px ${tokens.typography.fontFamily}`;
    ctx.fillStyle = tokens.theme.inkSecondary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const rowGap = compact ? 24 : 29;
    statRows.forEach((txt, i) => {
      ctx.fillText(txt, infoX, cardRect.y + (compact ? 54 : 64) + i * rowGap);
    });
    ctx.restore();

    // 6. 核心主按钮：「开始淘沙 · 第 X 关」
    this.startBtnRect = { x: 24, y: startBtnY, w: W - 48, h: mainBtnH };
    drawWoodButton(
      ctx,
      this.startBtnRect,
      `▶ 开始淘沙 · 第 ${curLvl.levelId} 关`,
      tokens,
      assets,
      {
        fillHex: '#EA580C',
        fontSize: 17,
        pulse: true,
        pulsePhase: timeSec * 4.5,
        subLabel: `「${curLvl.title}」 · 免体力畅玩`,
      }
    );

    // 6. 2×2 四大功能页面入口矩阵（章节选关 / 大红藏馆 / 玩法图鉴 / 工坊设置）
    const halfW = Math.floor((W - 32 - gridGap) * 0.5);
    this.levelBtnRect = { x: 16, y: gridRow1Y, w: halfW, h: gridBtnH };
    this.galleryBtnRect = { x: 16 + halfW + gridGap, y: gridRow1Y, w: halfW, h: gridBtnH };
    this.guideBtnRect = { x: 16, y: gridRow2Y, w: halfW, h: gridBtnH };
    this.settingsBtnRect = { x: 16 + halfW + gridGap, y: gridRow2Y, w: halfW, h: gridBtnH };

    drawWoodButton(ctx, this.levelBtnRect, '🗺️ 章节选关', tokens, assets, {
      fontSize: 14,
      fillHex: '#D97706',
      subLabel: `首章 ${saveMgr.data.maxClearedLevel}/${levelMgr.totalLevels} 关`,
    });

    drawWoodButton(ctx, this.galleryBtnRect, '🏛️ 大红藏馆', tokens, assets, {
      fontSize: 14,
      fillHex: '#7E22CE',
      subLabel: `已集 ${ownedCount}/30 · 碎片合成`,
      badgeText: hasCraftableRedDot ? '可合成!' : undefined,
      badgeBgHex: '#EF4444',
    });

    drawWoodButton(ctx, this.guideBtnRect, '📖 玩法图鉴', tokens, assets, {
      fontSize: 14,
      fillHex: '#0284C7',
      subLabel: '双冰 · 活门 · 概率表',
    });

    drawWoodButton(ctx, this.settingsBtnRect, '⚙️ 工坊设置', tokens, assets, {
      fontSize: 14,
      fillHex: '#9A6228',
      subLabel: '音效 · 震动 · 云存档',
    });

    // 7. 底部适龄徽章与好友欧气分享栏
    this.cadpaBadgeRect = { x: 16, y: H - 48, w: 34, h: 40 };
    splash.renderCadpaBadge(ctx, this.cadpaBadgeRect, assets, tokens);

    this.shareBtnRect = { x: (W - 208) * 0.5 + 12, y: H - 44, w: 208, h: 32 };
    drawWoodButton(ctx, this.shareBtnRect, '🎁 分享好友 · 炫耀身价欧气', tokens, assets, {
      fontSize: 11.5,
      fillHex: '#15803D',
    });

    if (this.showCadpaModal) {
      this.cadpaCloseRect = splash.renderCadpaPopup(ctx, W, H, assets, tokens);
    }
  }
}
