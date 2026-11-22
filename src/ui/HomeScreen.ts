import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { GachaSystem } from '../systems/GachaSystem';
import type { LevelManager } from '../systems/LevelManager';
import type { SaveManager } from '../systems/SaveManager';
import type { Rect, UiTokensFile } from '../types/ui';
import type { SplashScreen } from './SplashScreen';
import {
  drawCoverImage,
  drawDoubleRimPlaque,
  drawHandDrawnGlyph,
  drawInkText,
  drawRibbonBanner,
  drawRecessedTileCard,
  drawWoodButton,
  formatNetWorth,
  hitRect,
  roundRectPath,
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
 * 严格对齐封面参考图 docs/assets/cover.jpg 构图与神韵：
 * 1. 顶部星夜拱窗悬挂「沙里淘大红」木匾 + 燕尾羊皮纸丝带「抽板流沙 · 淘出大红」
 * 2. 中景完整展现透亮彩虹流沙玻璃大罐、安全帽柴犬、珍珠奶茶企鹅与红金小祥龙
 * 3. 前景黄金视觉焦点：复刻封面手绘黄铜木柄放大镜聚光盘，实时旋转暖金光芒鉴定「至尊大红箱 / 镇馆藏品」
 * 4. 底部木地板舞台：朱红描金主行动牌匾 + 复用局内同系双层嵌芯木框羊皮纸四宫导航卡
 */
export class HomeScreen {
  public showCadpaModal = false;

  private worthPillRect: Rect = { x: 0, y: 0, w: 180, h: 32 };
  private shardPillRect: Rect = { x: 0, y: 0, w: 110, h: 32 };
  private magnifierHitRect: Rect = { x: 0, y: 0, w: 116, h: 116 };
  private startBtnRect: Rect = { x: 0, y: 0, w: 300, h: 58 };
  private levelBtnRect: Rect = { x: 0, y: 0, w: 82, h: 66 };
  private galleryBtnRect: Rect = { x: 0, y: 0, w: 82, h: 66 };
  private guideBtnRect: Rect = { x: 0, y: 0, w: 82, h: 66 };
  private settingsBtnRect: Rect = { x: 0, y: 0, w: 82, h: 66 };
  private shareBtnRect: Rect = { x: 0, y: 0, w: 220, h: 32 };
  private cadpaBadgeRect: Rect = { x: 14, y: 0, w: 34, h: 40 };
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
      hitRect(px, py, this.magnifierHitRect) ||
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
    const compact = H < 730;

    // ========================================================================
    // 1. 封面同款星夜彩虹沙罐 + 萌宠工坊主视觉底图 + 动态萤火微光
    // ========================================================================
    const bg = assets.get('ui_bg_splash') || assets.get('ui_bg_gameplay');
    if (bg) {
      drawCoverImage(ctx, bg, W, H);
      // 仅在顶部状态区与底部木地板按钮区叠一层极轻柔的暖琥珀渐变，中景彩虹沙罐 100% 通透无遮挡！
      const vignette = ctx.createLinearGradient(0, 0, 0, H);
      vignette.addColorStop(0, 'rgba(18, 12, 8, 0.22)');
      vignette.addColorStop(0.24, 'rgba(18, 12, 8, 0)');
      vignette.addColorStop(0.70, 'rgba(34, 18, 8, 0)');
      vignette.addColorStop(1, 'rgba(38, 20, 8, 0.42)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = tokens.theme.starryNightBg;
      ctx.fillRect(0, 0, W, H);
    }

    this.renderWorkshopFireflies(ctx, W, H, timeSec);

    // ========================================================================
    // 2. 顶部双圈木镶边身价牌匾与淘金碎片牌匾（避让微信右上角胶囊安全区）
    // ========================================================================
    const safeTop = layout.menuRect.y + layout.menuRect.h + 6;
    const pillH = compact ? 30 : 32;
    const worthW = Math.min(220, Math.floor((W - 28) * 0.62));
    const shardW = W - 28 - worthW - 6;
    this.worthPillRect = { x: 14, y: safeTop, w: worthW, h: pillH };
    this.shardPillRect = { x: 14 + worthW + 6, y: safeTop, w: shardW, h: pillH };

    const rank = saveMgr.getRankBadge(tokens);
    const wInner = drawDoubleRimPlaque(ctx, this.worthPillRect, tokens, {
      variant: 'amber',
      rimThickness: 3.2,
      radius: pillH * 0.5,
    });
    const coinImg = assets.get('ui_networth_coin');
    if (coinImg) {
      ctx.drawImage(coinImg, wInner.x + 4, this.worthPillRect.y + (pillH - 20) * 0.5, 20, 20);
    }
    drawInkText(
      ctx,
      `${rank.title} · ${formatNetWorth(saveMgr.data.totalNetWorth)}`,
      wInner.x + (coinImg ? 27 : 8),
      this.worthPillRect.y + pillH * 0.5 + 0.5,
      tokens,
      {
        font: `800 11.5px ${tokens.typography.fontFamily}`,
        color: '#4A260C',
        align: 'left',
        maxWidth: wInner.w - (coinImg ? 32 : 12),
      }
    );

    const sInner = drawDoubleRimPlaque(ctx, this.shardPillRect, tokens, {
      variant: 'parchment',
      rimThickness: 3.2,
      radius: pillH * 0.5,
    });
    const shardImg = assets.get('ui_shard_icon');
    if (shardImg) {
      ctx.drawImage(shardImg, sInner.x + 5, this.shardPillRect.y + (pillH - 19) * 0.5, 19, 19);
    }
    drawInkText(
      ctx,
      `碎片 ×${saveMgr.data.shards}`,
      sInner.x + sInner.w * 0.5 + (shardImg ? 8 : 0),
      this.shardPillRect.y + pillH * 0.5 + 0.5,
      tokens,
      {
        font: `800 11px ${tokens.typography.fontFamily}`,
        color: '#4A260C',
        maxWidth: sInner.w - (shardImg ? 26 : 8),
      }
    );
    if (hasCraftableRedDot) {
      ctx.save();
      ctx.fillStyle = '#DC2626';
      ctx.strokeStyle = '#FFF9EE';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.shardPillRect.x + this.shardPillRect.w - 4, this.shardPillRect.y + 4, 4.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // ========================================================================
    // 3. 顶部星夜木窗区：品牌大木匾「沙里淘大红」+ 封面燕尾卷轴「抽板流沙 · 淘出大红」
    // ========================================================================
    const logoTop = safeTop + pillH + (compact ? 4 : 8);
    const maxLogoH = compact ? 68 : 84;
    const maxLogoW = Math.min(324, W * 0.84);
    const logo = assets.get('ui_logo_title');
    const bob = Math.sin(timeSec * 2.3) * 2.2;

    let ribbonCy = logoTop + maxLogoH + 14;
    if (logo && logo.width > 0 && logo.height > 0) {
      const fitScale = Math.min(maxLogoW / logo.width, maxLogoH / logo.height);
      const lw = logo.width * fitScale;
      const lh = logo.height * fitScale;
      const lx = (W - lw) * 0.5;
      const ly = logoTop;
      ctx.drawImage(logo, lx, ly + bob, lw, lh);
      ribbonCy = ly + lh + (compact ? 11 : 14);

      // 标题两侧闪烁四角金星（对齐 cover.jpg 标题星芒）
      const starPulse = 0.78 + 0.22 * Math.sin(timeSec * 4.2);
      drawHandDrawnGlyph(ctx, 'sparkle', lx + 6, ly + 8 + bob, 15 * starPulse, tokens);
      drawHandDrawnGlyph(ctx, 'sparkle', lx + lw - 4, ly + lh * 0.65 + bob, 14 * starPulse, tokens);
    } else {
      drawInkText(ctx, '沙里淘大红', W * 0.5, logoTop + 34 + bob, tokens, {
        font: `800 32px ${tokens.typography.fontFamily}`,
        color: '#FFF8EC',
      });
    }

    drawRibbonBanner(
      ctx,
      W * 0.5,
      ribbonCy,
      Math.min(238, W * 0.62),
      compact ? 25 : 28,
      '抽板流沙 · 淘出大红',
      tokens,
      compact ? 11.5 : 12.5
    );

    // ========================================================================
    // 4. 自底向上计算底部木地板操作舞台（绝不遮挡中部彩虹沙罐与柴犬/企鹅/小龙！）
    // ========================================================================
    const curLvl = levelMgr.getLevel(saveMgr.data.currentLevel);
    const ownedCount = saveMgr.getOwnedUniqueCount();
    const goldLeft = Math.max(1, 16 - saveMgr.data.pityGoldCount);

    const safeBot = Math.max(8, H - (layout.propRowRect.y + layout.propRowRect.h));
    const footerH = 34;
    const footerY = H - safeBot - footerH;

    const dockH = compact ? 62 : 68;
    const dockGap = 8;
    const dockY = footerY - dockH - (compact ? 6 : 9);

    const mainBtnH = compact ? 52 : 58;
    const startBtnY = dockY - mainBtnH - (compact ? 8 : 11);

    // ========================================================================
    // 5. 复刻封面 cover.jpg 前景灵魂焦点：复古黄铜木柄放大镜聚光鉴宝盘！
    //    恰好落在柴犬（左）与企鹅（右）之间的开阔木地板中央！
    // ========================================================================
    let topOwnedFig = null;
    for (const f of gacha.allFigurines) {
      if ((saveMgr.data.ownedMap[f.id] || 0) > 0) {
        if (!topOwnedFig || f.valuation > topOwnedFig.valuation) {
          topOwnedFig = f;
        }
      }
    }

    const lensR = compact ? 42 : 49;
    const lensCx = W * 0.465;
    const lensCy = Math.min(startBtnY - lensR - (compact ? 10 : 16), H * 0.635);
    this.magnifierHitRect = {
      x: lensCx - lensR - 8,
      y: lensCy - lensR - 8,
      w: (lensR + 8) * 2,
      h: (lensR + 8) * 2,
    };

    this.renderCoverMagnifierSpotlight(
      ctx,
      lensCx,
      lensCy,
      lensR,
      topOwnedFig ? topOwnedFig.id : 'box_red',
      topOwnedFig ? topOwnedFig.name : '至尊大红箱',
      `${goldLeft}抽必金`,
      assets,
      tokens,
      timeSec
    );

    // ========================================================================
    // 6. 主行动牌匾：朱红描金漆木「▸ 开始淘沙 · 第 X 关」
    // ========================================================================
    this.startBtnRect = { x: 18, y: startBtnY, w: W - 36, h: mainBtnH };
    drawWoodButton(
      ctx,
      this.startBtnRect,
      `▸ 开始淘沙 · 第 ${curLvl.levelId} 关`,
      tokens,
      assets,
      {
        fillHex: '#EA580C',
        fontSize: compact ? 16 : 17.5,
        pulse: true,
        pulsePhase: timeSec * 4.2,
        subLabel: `「${curLvl.title}」 · 已通 ${saveMgr.data.maxClearedLevel}/${levelMgr.totalLevels} 关 · 免体力`,
      }
    );

    // ========================================================================
    // 7. 复用局内同款双层嵌芯木框羊皮纸卡：四列精品功能入口（章节 / 藏馆 / 图鉴 / 设置）
    // ========================================================================
    const dockCardW = Math.floor((W - 28 - dockGap * 3) / 4);
    this.levelBtnRect = { x: 14, y: dockY, w: dockCardW, h: dockH };
    this.galleryBtnRect = { x: 14 + (dockCardW + dockGap), y: dockY, w: dockCardW, h: dockH };
    this.guideBtnRect = { x: 14 + (dockCardW + dockGap) * 2, y: dockY, w: dockCardW, h: dockH };
    this.settingsBtnRect = { x: 14 + (dockCardW + dockGap) * 3, y: dockY, w: dockCardW, h: dockH };

    const dockItems: {
      rect: Rect;
      label: string;
      spriteId?: string;
      glyph?: 'book' | 'gear';
      variant: 'parchment' | 'rose' | 'sky';
      medallion?: string;
      medallionVariant?: 'wood' | 'crimson' | 'amber';
      pulse?: boolean;
    }[] = [
      {
        rect: this.levelBtnRect,
        label: '章节选关',
        spriteId: 'ui_loot_bag',
        variant: 'parchment',
        medallion: `${saveMgr.data.maxClearedLevel}/${levelMgr.totalLevels}`,
        medallionVariant: 'wood',
      },
      {
        rect: this.galleryBtnRect,
        label: '大红藏馆',
        spriteId: 'box_red',
        variant: hasCraftableRedDot ? 'rose' : 'parchment',
        medallion: hasCraftableRedDot ? '可合' : `${ownedCount}/30`,
        medallionVariant: hasCraftableRedDot ? 'crimson' : 'amber',
        pulse: hasCraftableRedDot,
      },
      {
        rect: this.guideBtnRect,
        label: '玩法图鉴',
        glyph: 'book',
        variant: 'sky',
      },
      {
        rect: this.settingsBtnRect,
        label: '工坊设置',
        glyph: 'gear',
        variant: 'parchment',
      },
    ];

    for (const item of dockItems) {
      const inner = drawRecessedTileCard(ctx, item.rect, tokens, {
        variant: item.variant,
        radius: 14,
        rimWidth: 3.8,
        pulse: item.pulse,
        pulsePhase: timeSec * 5.2,
        medallionText: item.medallion,
        medallionVariant: item.medallionVariant,
        medallionRadius: 10.5,
      });

      const iconCy = inner.y + inner.h * 0.39;
      if (item.spriteId) {
        const sp = assets.get(item.spriteId);
        if (sp) {
          const sz = Math.min(31, inner.h * 0.56);
          ctx.drawImage(sp, inner.x + (inner.w - sz) * 0.5, iconCy - sz * 0.5, sz, sz);
        }
      } else if (item.glyph) {
        drawHandDrawnGlyph(
          ctx,
          item.glyph,
          inner.x + inner.w * 0.5,
          iconCy,
          Math.min(28, inner.h * 0.52),
          tokens
        );
      }

      drawInkText(ctx, item.label, inner.x + inner.w * 0.5, inner.y + inner.h - 10, tokens, {
        font: `800 11.5px ${tokens.typography.fontFamily}`,
        color: '#3A1F0E',
        maxWidth: inner.w - 6,
      });
    }

    // ========================================================================
    // 8. 底部 8+ 适龄徽盾 & 欧气分享双圈羊皮纸木签
    // ========================================================================
    this.cadpaBadgeRect = { x: 14, y: footerY - 3, w: 32, h: 38 };
    splash.renderCadpaBadge(ctx, this.cadpaBadgeRect, assets, tokens);

    const shareW = Math.min(236, W - 72);
    this.shareBtnRect = { x: (W - shareW) * 0.5 + 14, y: footerY + 2, w: shareW, h: 30 };
    drawDoubleRimPlaque(ctx, this.shareBtnRect, tokens, {
      variant: 'mint',
      rimThickness: 3.0,
      radius: 15,
    });
    drawInkText(
      ctx,
      '✦ 分享好友 · 晒出大红欧气 ✦',
      this.shareBtnRect.x + this.shareBtnRect.w * 0.5,
      this.shareBtnRect.y + 15.5,
      tokens,
      {
        font: `800 11px ${tokens.typography.fontFamily}`,
        color: '#234E26',
        maxWidth: shareW - 18,
      }
    );

    if (this.showCadpaModal) {
      this.cadpaCloseRect = splash.renderCadpaPopup(ctx, W, H, assets, tokens);
    }
  }

  /**
   * 1:1 复刻封面 cover.jpg 下方中央的复古黄铜木柄放大镜聚光鉴宝圆盘（含旋转放射金芒 + 弧底铭文 + 车削胡桃木手柄）
   */
  private renderCoverMagnifierSpotlight(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    spriteId: string,
    titleText: string,
    pityTag: string,
    assets: AssetLoader,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    const ink = '#3E2311';
    ctx.save();

    // 0. 地面暖金光晕投影
    const floorGlow = ctx.createRadialGradient(cx, cy + r * 0.65, 4, cx, cy + r * 0.65, r * 1.35);
    floorGlow.addColorStop(0, 'rgba(255, 196, 72, 0.36)');
    floorGlow.addColorStop(1, 'rgba(255, 196, 72, 0)');
    ctx.fillStyle = floorGlow;
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.4, r * 1.35, 0, Math.PI * 2);
    ctx.fill();

    // 1. 右下斜伸的车削胡桃木手柄与黄铜箍头（对齐 cover.jpg 放大镜约 65° 斜向木柄）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(1.12);
    const handleStart = r + 3;
    const handleLen = r * 0.78;

    // 手柄投影
    ctx.fillStyle = 'rgba(28, 13, 4, 0.34)';
    ctx.beginPath();
    roundRectPath(ctx, handleStart, -5.5, handleLen + 2, 14, 5);
    ctx.fill();

    // 黄铜连接颈箍
    ctx.fillStyle = '#E5B454';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    roundRectPath(ctx, r - 2, -6.2, 9, 12.4, 3);
    ctx.fill();
    ctx.stroke();

    // 车削胡桃木长柄
    const hGrad = ctx.createLinearGradient(0, -8, 0, 8);
    hGrad.addColorStop(0, '#D49553');
    hGrad.addColorStop(0.45, '#9E612B');
    hGrad.addColorStop(1, '#643814');
    ctx.fillStyle = hGrad;
    ctx.beginPath();
    ctx.moveTo(handleStart + 4, -5.8);
    ctx.lineTo(handleStart + handleLen, -8.0);
    ctx.quadraticCurveTo(handleStart + handleLen + 5, 0, handleStart + handleLen, 8.0);
    ctx.lineTo(handleStart + 4, 5.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 2. 镜片内部：朱红琥珀渐变光场 + 缓慢旋转的 12 道暖金放射光芒 + 镇馆大红宝盒
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 5, 0, Math.PI * 2);
    ctx.clip();

    const lensBg = ctx.createRadialGradient(cx, cy - 4, 4, cx, cy, r);
    lensBg.addColorStop(0, '#FFFDF0');
    lensBg.addColorStop(0.48, '#FFE19C');
    lensBg.addColorStop(0.82, '#F59E6C');
    lensBg.addColorStop(1, '#E06D53');
    ctx.fillStyle = lensBg;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    // 12 道绘本手绘暖白放射光束
    ctx.save();
    ctx.translate(cx, cy - 3);
    ctx.rotate(timeSec * 0.35);
    ctx.fillStyle = 'rgba(255, 252, 235, 0.38)';
    const rays = 12;
    for (let i = 0; i < rays; i++) {
      const a0 = (i * Math.PI * 2) / rays;
      const a1 = a0 + Math.PI / rays * 0.48;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r * 1.15, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 中央浮动「至尊大红箱 / 镇馆大红公仔」
    const heroImg = assets.get(spriteId) || assets.get('box_red');
    const floatY = Math.sin(timeSec * 3.2) * 2.2;
    if (heroImg) {
      const sz = r * 1.24;
      ctx.drawImage(heroImg, cx - sz * 0.5, cy - sz * 0.52 + floatY, sz, sz);
    }

    // 镜面左上弯月形玻璃反光弧
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 10, -Math.PI * 0.82, -Math.PI * 0.46);
    ctx.stroke();
    ctx.restore();

    // 3. 双层复古黄铜 + 胡桃木外镜圈（严丝合缝包裹镜片）
    ctx.strokeStyle = ink;
    ctx.lineWidth = 7.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2.2, 0, Math.PI * 2);
    ctx.stroke();

    const rimGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    rimGrad.addColorStop(0, '#F5CF86');
    rimGrad.addColorStop(0.5, '#C68840');
    rimGrad.addColorStop(1, '#7D481B');
    ctx.strokeStyle = rimGrad;
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2.2, 0, Math.PI * 2);
    ctx.stroke();

    // 镜圈下沿居中双圈羊皮纸鉴宝铭牌（不裁切长公仔名，复刻 cover.jpg「◇ 至尊大红箱 ◇」）
    const plateW = Math.max(88, Math.round(r * 1.88));
    const plateH = 19;
    const plateY = cy + r * 0.66;
    drawDoubleRimPlaque(ctx, { x: cx - plateW * 0.5, y: plateY, w: plateW, h: plateH }, tokens, {
      variant: 'parchment',
      rimThickness: 2.3,
      radius: 9.5,
    });
    drawInkText(ctx, `◇ ${titleText} ◇`, cx, plateY + plateH * 0.5 + 0.5, tokens, {
      font: `800 10px ${tokens.typography.fontFamily}`,
      color: '#4A2410',
      maxWidth: plateW - 12,
    });

    // 镜圈右上角微缩保底欧气签
    const tagW = 54;
    const tagH = 16;
    const tx = cx + r * 0.45;
    const ty = cy - r * 0.92;
    drawDoubleRimPlaque(ctx, { x: tx - tagW * 0.5, y: ty, w: tagW, h: tagH }, tokens, {
      variant: 'amber',
      rimThickness: 2,
      radius: 8,
    });
    drawInkText(ctx, pityTag, tx, ty + tagH * 0.5 + 0.5, tokens, {
      font: `800 8.5px ${tokens.typography.fontFamily}`,
      color: '#5C2D0C',
    });

    ctx.restore();
  }

  private renderWorkshopFireflies(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    timeSec: number
  ): void {
    ctx.save();
    for (let i = 0; i < 9; i++) {
      const baseX = ((i * 97 + 43) % 88 + 6) / 100 * W;
      const baseY = ((i * 61 + 19) % 58 + 10) / 100 * H;
      const dx = Math.sin(timeSec * 1.1 + i * 1.7) * 7;
      const dy = Math.cos(timeSec * 0.9 + i * 2.3) * 5;
      const alpha = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(timeSec * 2.8 + i * 1.9));
      const rad = i % 3 === 0 ? 2.2 : 1.5;

      ctx.fillStyle = `rgba(255, 240, 178, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(baseX + dx, baseY + dy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
