import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { Rect, UiTokensFile } from '../types/ui';
import {
  drawCoverImage,
  drawDoubleRimPlaque,
  drawInkText,
  drawParchmentModalFrame,
  drawPlaqueText,
  drawRibbonBanner,
  drawWoodButton,
  hitRect,
  roundRectPath,
} from './UIHelpers';

/**
 * 启动加载页与 CADPA 8+ 适龄合规弹窗（与封面 cover.jpg 星夜彩虹沙罐主视觉一脉相承）
 */
export class SplashScreen {
  public progress = 0;
  public showCadpaModal = false;
  private cadpaBadgeRect: Rect = { x: 16, y: 0, w: 38, h: 46 };
  private cadpaCloseRect: Rect = { x: 0, y: 0, w: 124, h: 40 };

  public handleTap(px: number, py: number): boolean {
    if (this.showCadpaModal) {
      if (hitRect(px, py, this.cadpaCloseRect)) {
        this.showCadpaModal = false;
      }
      return true;
    }
    if (hitRect(px, py, this.cadpaBadgeRect)) {
      this.showCadpaModal = true;
      return true;
    }
    return false;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    assets: AssetLoader,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    const W = layout.screenW;
    const H = layout.screenH;

    const bg = assets.get('ui_bg_splash');
    if (bg) {
      drawCoverImage(ctx, bg, W, H);
      const grad = ctx.createLinearGradient(0, H * 0.72, 0, H);
      grad.addColorStop(0, 'rgba(30, 16, 6, 0)');
      grad.addColorStop(1, 'rgba(30, 16, 6, 0.48)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.72, W, H * 0.28);
    } else {
      ctx.fillStyle = tokens.theme.starryNightBg;
      ctx.fillRect(0, 0, W, H);
    }

    // 品牌木匾 Logo 与燕尾丝带置于星夜拱窗区
    const logo = assets.get('ui_logo_title');
    const bob = Math.sin(timeSec * ((Math.PI * 2) / 2.4)) * 3;
    const topY = Math.max(54, H * 0.11);
    let ribbonY = topY + 86;

    if (logo && logo.width > 0) {
      const lw = Math.min(286, W * 0.78);
      const lh = lw * (logo.height / logo.width);
      ctx.drawImage(logo, (W - lw) * 0.5, topY + bob, lw, lh);
      ribbonY = topY + lh + 14;
    } else {
      drawPlaqueText(ctx, '沙里淘大红', W * 0.5, topY + 34 + bob, tokens, {
        font: `800 34px ${tokens.typography.fontFamily}`,
        strokeWidth: 3.2,
      });
    }

    drawRibbonBanner(ctx, W * 0.5, ribbonY, Math.min(232, W * 0.62), 28, '抽板流沙 · 淘出大红', tokens, 12);

    // 底部双圈木镶玻璃流沙进度槽
    const cardW = Math.min(256, W - 96);
    const cardX = (W - cardW) * 0.5 + 14;
    const barY = H - 56;
    const barH = 18;

    drawDoubleRimPlaque(ctx, { x: cardX, y: barY, w: cardW, h: barH }, tokens, {
      variant: 'parchment',
      rimThickness: 3,
      radius: 9,
    });

    const pct = Math.max(0.06, Math.min(1, this.progress));
    const fillW = Math.max(10, (cardW - 8) * pct);
    const sGrad = ctx.createLinearGradient(cardX + 4, 0, cardX + 4 + fillW, 0);
    sGrad.addColorStop(0, '#F59E0B');
    sGrad.addColorStop(0.5, '#FDE047');
    sGrad.addColorStop(1, '#EA580C');
    ctx.save();
    ctx.fillStyle = sGrad;
    ctx.beginPath();
    roundRectPath(ctx, cardX + 4, barY + 3.5, fillW, barH - 7, 5.5);
    ctx.fill();
    ctx.restore();

    drawPlaqueText(
      ctx,
      `正在点亮星夜淘沙工坊... ${Math.round(pct * 100)}%`,
      cardX + cardW * 0.5,
      barY - 13,
      tokens,
      {
        font: `700 11.5px ${tokens.typography.fontFamily}`,
        fill: '#FFF8EC',
        strokeWidth: 2.0,
      }
    );

    // 左下角 CADPA 8+ 适龄提示徽牌
    this.cadpaBadgeRect = { x: 16, y: H - 68, w: 36, h: 44 };
    this.renderCadpaBadge(ctx, this.cadpaBadgeRect, assets, tokens);

    if (this.showCadpaModal) {
      this.renderCadpaPopup(ctx, W, H, assets, tokens);
    }
  }

  public renderCadpaBadge(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    const frame = assets.get('ui_badge_cadpa_frame');
    if (frame) {
      ctx.drawImage(frame, r.x, r.y, r.w, r.h);
    } else {
      ctx.fillStyle = '#4E8647';
      ctx.strokeStyle = '#3E2311';
      ctx.lineWidth = 2;
      ctx.beginPath();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 8);
      ctx.fill();
      ctx.stroke();
    }
    drawPlaqueText(ctx, '8+', r.x + r.w * 0.5, r.y + r.h * 0.54, tokens, {
      font: `800 13.5px ${tokens.typography.numeralFontFamily}`,
      fill: '#FFFFFF',
      strokeWidth: 2.0,
    });
  }

  public renderCadpaPopup(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): Rect {
    const pw = Math.min(324, W - 28);
    const ph = 236;
    const panel: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };
    drawParchmentModalFrame(ctx, W, H, panel, '适龄提示 (8+)', tokens, assets);

    const lines = [
      '1. 本游戏是一款治愈系流沙益智解谜小游戏，',
      '   适用于年满 8 周岁及以上的用户。',
      '2. 建议未成年人在家长监护下合理安排时间。',
      '3. 游戏为纯休闲收集玩法，不含现金充值付费。',
    ];
    lines.forEach((ln, idx) => {
      drawInkText(ctx, ln, panel.x + 22, panel.y + 54 + idx * 25, tokens, {
        font: `600 12.5px ${tokens.typography.fontFamily}`,
        color: '#3E2311',
        align: 'left',
        maxWidth: pw - 44,
      });
    });

    this.cadpaCloseRect = {
      x: panel.x + (panel.w - 128) * 0.5,
      y: panel.y + panel.h - 54,
      w: 128,
      h: 40,
    };
    drawWoodButton(ctx, this.cadpaCloseRect, '我知道了', tokens, assets, {
      fillHex: '#15803D',
      fontSize: 13.5,
    });
    return this.cadpaCloseRect;
  }
}
