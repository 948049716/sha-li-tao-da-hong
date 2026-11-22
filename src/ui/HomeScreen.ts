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
  drawRibbonBanner,
  drawStorybookCardFrame,
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
 * 1:1 严格还原封面 cover.jpg 画风：星夜木窗工坊 + 横排拱形木匾「沙里淘大红」+ 燕尾羊皮纸丝带「抽板流沙·淘出大红」+ 九宫格木框与黄铜包角按钮
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
    if (
      hitRect(px, py, this.galleryBtnRect) ||
      hitRect(px, py, this.worthPillRect) ||
      hitRect(px, py, this.shardPillRect)
    ) {
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

    // 1. 封面同款星夜木窗淘沙工坊插画背景 + 暖琥珀柔晕衬底
    const bg = assets.get('ui_bg_gameplay') || assets.get('ui_bg_splash');
    if (bg) {
      drawCoverImage(ctx, bg, W, H);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(22, 16, 12, 0.14)');
      grad.addColorStop(0.5, 'rgba(255, 245, 224, 0.05)');
      grad.addColorStop(1, 'rgba(38, 22, 10, 0.38)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = tokens.theme.starryNightBg;
      ctx.fillRect(0, 0, W, H);
    }

    // 2. 顶部手绘木签身价栏与淘金碎片栏（置于微信顶部双胶囊下方安全行）
    const safeTop = layout.menuRect.y + layout.menuRect.h + 8;
    const worthW = Math.min(226, Math.floor((W - 32) * 0.64));
    const shardW = W - 32 - worthW - 8;
    this.worthPillRect = { x: 16, y: safeTop, w: worthW, h: 34 };
    this.shardPillRect = { x: 16 + worthW + 8, y: safeTop, w: shardW, h: 34 };

    const rank = saveMgr.getRankBadge(tokens);
    drawWoodCapsule(ctx, this.worthPillRect, tokens, '#6B4223', '#432712', 15);
    const coinImg = assets.get('ui_networth_coin');
    if (coinImg) {
      ctx.drawImage(coinImg, this.worthPillRect.x + 8, this.worthPillRect.y + 5, 23, 23);
    }
    drawOutlinedText(
      ctx,
      `${rank.title} · ${formatNetWorth(saveMgr.data.totalNetWorth)}`,
      this.worthPillRect.x + 36,
      this.worthPillRect.y + 17,
      `700 11.5px ${tokens.typography.fontFamily}`,
      '#FFE89E',
      tokens.theme.inkOutline,
      2,
      'left'
    );

    drawWoodCapsule(ctx, this.shardPillRect, tokens, '#7B4A3A', '#4A281E', 15);
    const shardImg = assets.get('ui_shard_icon');
    if (shardImg) {
      ctx.drawImage(shardImg, this.shardPillRect.x + 8, this.shardPillRect.y + 6, 21, 21);
    }
    drawOutlinedText(
      ctx,
      `碎片 ×${saveMgr.data.shards}`,
      this.shardPillRect.x + this.shardPillRect.w * 0.5 + (shardImg ? 9 : 0),
      this.shardPillRect.y + 17,
      `700 11.5px ${tokens.typography.fontFamily}`,
      '#FFF5E0',
      tokens.theme.inkOutline,
      2
    );

    // 3. 自底向上计算无重叠绘本栅格锚点
    const curLvl = levelMgr.getLevel(saveMgr.data.currentLevel);
    const ownedCount = saveMgr.getOwnedUniqueCount();
    const goldLeft = Math.max(1, 16 - saveMgr.data.pityGoldCount);
    const redLeft = Math.max(1, 41 - saveMgr.data.pityRedCount);

    const footerTop = H - (compact ? 44 : 52);
    const gridBtnH = compact ? 50 : 56;
    const gridGap = 10;
    const mainBtnH = compact ? 52 : 60;
    const cardH = compact ? 142 : 168;

    const gridRow2Y = footerTop - gridBtnH - (compact ? 6 : 10);
    const gridRow1Y = gridRow2Y - gridBtnH - gridGap;
    const startBtnY = gridRow1Y - mainBtnH - (compact ? 10 : 14);
    const cardY = startBtnY - cardH - (compact ? 10 : 14);

    // 4. 封面同款横排拱形木匾「沙里淘大红」+ 燕尾羊皮纸卷轴飘带「抽板流沙 · 淘出大红」
    const pillBottom = safeTop + 34;
    const ribbonH = compact ? 26 : 30;
    const ribbonCy = cardY - (compact ? 22 : 28);
    const heroTop = pillBottom + (compact ? 6 : 12);
    const heroAvailH = Math.max(64, ribbonCy - ribbonH * 0.5 - 8 - heroTop);

    const logo = assets.get('ui_logo_title');
    const bob = Math.sin(timeSec * 2.2) * 2.5;

    if (logo && logo.width > 0 && logo.height > 0) {
      const maxLogoW = Math.min(352, W * 0.90);
      const fitScale = Math.min(maxLogoW / logo.width, heroAvailH / logo.height);
      const lw = logo.width * fitScale;
      const lh = logo.height * fitScale;
      const ly = heroTop + (heroAvailH - lh) * 0.54;
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

    drawRibbonBanner(
      ctx,
      W * 0.5,
      ribbonCy,
      Math.min(242, W * 0.64),
      ribbonH,
      '抽板流沙 · 淘出大红',
      tokens,
      compact ? 12 : 13
    );

    // 5. 中部九宫格蜂蜜木框 + 羊皮纸「镇馆进度展台」卡片（内缩避开木框边条）
    const cardRect: Rect = { x: 16, y: cardY, w: W - 32, h: cardH };
    drawStorybookCardFrame(ctx, cardRect, tokens, assets);

    const padX = 22;
    const padY = 20;
    const stageRect: Rect = {
      x: cardRect.x + padX,
      y: cardRect.y + padY,
      w: compact ? 86 : 98,
      h: cardRect.h - padY * 2,
    };
    drawWoodCapsule(ctx, stageRect, tokens, '#233154', '#5A3A22', 11);

    let topOwnedFig = null;
    for (const f of gacha.allFigurines) {
      if ((saveMgr.data.ownedMap[f.id] || 0) > 0) {
        if (!topOwnedFig || f.valuation > topOwnedFig.valuation) {
          topOwnedFig = f;
        }
      }
    }

    const stageCx = stageRect.x + stageRect.w * 0.5;
    const stageCy = stageRect.y + stageRect.h * 0.43;
    const glowR = Math.min(stageRect.w, stageRect.h) * 0.38;
    ctx.save();
    ctx.fillStyle =
      topOwnedFig?.rarity === 'RED' ? 'rgba(220, 68, 48, 0.36)' : 'rgba(245, 185, 66, 0.30)';
    ctx.beginPath();
    ctx.arc(stageCx, stageCy, glowR * (0.92 + 0.08 * Math.sin(timeSec * 3.8)), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const heroSprite = topOwnedFig ? assets.get(topOwnedFig.id) : assets.get('box_red');
    const subLeftBox = assets.get('box_purple');
    const subRightBox = assets.get('box_gold');
    if (!topOwnedFig && subLeftBox && subRightBox) {
      ctx.drawImage(subLeftBox, stageCx - 37, stageCy - 6, 26, 26);
      ctx.drawImage(subRightBox, stageCx + 11, stageCy - 6, 26, 26);
    }
    if (heroSprite) {
      const sz = topOwnedFig ? Math.min(stageRect.w - 14, stageRect.h - 28) : 46;
      ctx.drawImage(heroSprite, stageCx - sz * 0.5, stageCy - sz * 0.52 + bob * 0.5, sz, sz);
    }
    drawOutlinedText(
      ctx,
      topOwnedFig ? topOwnedFig.name.slice(0, 6) : '至尊大红箱',
      stageCx,
      stageRect.y + stageRect.h - 11,
      `700 10px ${tokens.typography.fontFamily}`,
      '#FFE89E',
      '#1E294B',
      1.8
    );

    // 右侧绘本墨线进度栏（严格排布在羊皮纸净空区内）
    const infoX = stageRect.x + stageRect.w + 10;
    drawOutlinedText(
      ctx,
      `◆ 第 ${curLvl.levelId} 关「${curLvl.title}」`,
      infoX,
      cardRect.y + (compact ? 34 : 42),
      `800 12.5px ${tokens.typography.fontFamily}`,
      tokens.theme.inkOutline,
      '#FFFDF7',
      1,
      'left'
    );

    const rows: { iconId: string; text: string }[] = [
      { iconId: 'ui_loot_bag', text: `章节进度：已通 ${saveMgr.data.maxClearedLevel}/${levelMgr.totalLevels} 关` },
      { iconId: 'ui_badge_collector', text: `大红藏馆：已集 ${ownedCount}/30 款` },
      { iconId: 'ui_magnifier', text: `欧气保底：${goldLeft}抽必金·${redLeft}抽红` },
    ];
    const rowGap = compact ? 22 : 26;
    rows.forEach((row, idx) => {
      const ry = cardRect.y + (compact ? 60 : 72) + idx * rowGap;
      const ic = assets.get(row.iconId);
      if (ic) {
        ctx.drawImage(ic, infoX, ry - 8, 16, 16);
      }
      ctx.save();
      ctx.font = `600 11px ${tokens.typography.fontFamily}`;
      ctx.fillStyle = tokens.theme.inkSecondary;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.text, infoX + (ic ? 20 : 4), ry + 0.5);
      ctx.restore();
    });

    // 6. 核心主按钮：朱红描金漆木牌「▸ 开始淘沙 · 第 X 关」
    this.startBtnRect = { x: 22, y: startBtnY, w: W - 44, h: mainBtnH };
    drawWoodButton(
      ctx,
      this.startBtnRect,
      `▸ 开始淘沙 · 第 ${curLvl.levelId} 关`,
      tokens,
      assets,
      {
        fillHex: '#EA580C',
        fontSize: 17,
        pulse: true,
        pulsePhase: timeSec * 4.2,
        subLabel: `「${curLvl.title}」 · 免体力畅玩`,
      }
    );

    // 7. 2×2 四大绘本木牌入口（挂载真实手绘图标，彻底去除系统 Emoji）
    const halfW = Math.floor((W - 32 - gridGap) * 0.5);
    this.levelBtnRect = { x: 16, y: gridRow1Y, w: halfW, h: gridBtnH };
    this.galleryBtnRect = { x: 16 + halfW + gridGap, y: gridRow1Y, w: halfW, h: gridBtnH };
    this.guideBtnRect = { x: 16, y: gridRow2Y, w: halfW, h: gridBtnH };
    this.settingsBtnRect = { x: 16 + halfW + gridGap, y: gridRow2Y, w: halfW, h: gridBtnH };

    drawWoodButton(ctx, this.levelBtnRect, '章节选关', tokens, assets, {
      fontSize: 14,
      icon: assets.get('ui_loot_bag'),
      iconSize: 28,
      subLabel: `首章 ${saveMgr.data.maxClearedLevel}/${levelMgr.totalLevels} 关`,
    });

    drawWoodButton(ctx, this.galleryBtnRect, '大红藏馆', tokens, assets, {
      fontSize: 14,
      fillHex: '#7E22CE',
      icon: assets.get('box_red'),
      iconSize: 30,
      subLabel: `已集 ${ownedCount}/30 · 合成`,
      badgeText: hasCraftableRedDot ? '可合成' : undefined,
      badgeBgHex: '#EF4444',
    });

    drawWoodButton(ctx, this.guideBtnRect, '玩法图鉴', tokens, assets, {
      fontSize: 14,
      fillHex: '#0284C7',
      icon: assets.get('ui_magnifier'),
      iconSize: 29,
      subLabel: '双冰 · 活门 · 概率',
    });

    drawWoodButton(ctx, this.settingsBtnRect, '工坊设置', tokens, assets, {
      fontSize: 14,
      fillHex: '#9A6228',
      icon: assets.get('ui_icon_settings_gear'),
      iconSize: 27,
      subLabel: '音效 · 震动 · 云端',
    });

    // 8. 底部适龄木盾与好友欧气分享木签
    this.cadpaBadgeRect = { x: 16, y: H - 48, w: 34, h: 40 };
    splash.renderCadpaBadge(ctx, this.cadpaBadgeRect, assets, tokens);

    this.shareBtnRect = { x: (W - 212) * 0.5 + 12, y: H - 44, w: 212, h: 32 };
    drawWoodButton(ctx, this.shareBtnRect, '✦ 分享好友 · 晒出大红欧气', tokens, assets, {
      fontSize: 11.5,
      fillHex: '#15803D',
    });

    if (this.showCadpaModal) {
      this.cadpaCloseRect = splash.renderCadpaPopup(ctx, W, H, assets, tokens);
    }
  }
}
