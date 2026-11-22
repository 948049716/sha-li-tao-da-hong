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
 * 日系治愈极简启动加载页与 CADPA 8+ 适龄合规弹窗
 */
export class SplashScreen {
  public progress = 0;
  public showCadpaModal = false;
  private cadpaBadgeRect: Rect = { x: 16, y: 0, w: 36, h: 44 };
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
      const grad = ctx.createLinearGradient(0, H * 0.74, 0, H);
      grad.addColorStop(0, 'rgba(24, 27, 44, 0)');
      grad.addColorStop(1, 'rgba(24, 27, 44, 0.36)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.74, W, H * 0.26);
    } else {
      ctx.fillStyle = tokens.theme.starryNightBg;
      ctx.fillRect(0, 0, W, H);
    }

    const logo = assets.get('ui_logo_title');
    const bob = Math.sin(timeSec * ((Math.PI * 2) / 2.6)) * 2.5;
    const topY = Math.max(54, H * 0.11);
    let ribbonY = topY + 86;

    if (logo && logo.width > 0) {
      const lw = Math.min(280, W * 0.76);
      const lh = lw * (logo.height / logo.width);
      ctx.drawImage(logo, (W - lw) * 0.5, topY + bob, lw, lh);
      ribbonY = topY + lh + 14;
    } else {
      drawPlaqueText(ctx, '沙里淘大红', W * 0.5, topY + 34 + bob, tokens, {
        font: `700 32px ${tokens.typography.fontFamily}`,
        strokeWidth: 2.0,
      });
    }

    drawRibbonBanner(ctx, W * 0.5, ribbonY, Math.min(220, W * 0.60), 28, '流沙入瓶 · 静谧解谜', tokens, 12);

    const cardW = Math.min(248, W - 96);
    const cardX = (W - cardW) * 0.5 + 14;
    const barY = H - 54;
    const barH = 16;

    drawDoubleRimPlaque(ctx, { x: cardX, y: barY, w: cardW, h: barH }, tokens, {
      variant: 'parchment',
      radius: 8,
    });

    const pct = Math.max(0.06, Math.min(1, this.progress));
    const fillW = Math.max(10, (cardW - 6) * pct);
    const sGrad = ctx.createLinearGradient(cardX + 3, 0, cardX + 3 + fillW, 0);
    sGrad.addColorStop(0, '#F5B0B6');
    sGrad.addColorStop(0.5, '#F7DF8E');
    sGrad.addColorStop(1, '#8CC8A4');
    ctx.save();
    ctx.fillStyle = sGrad;
    ctx.beginPath();
    roundRectPath(ctx, cardX + 3, barY + 3, fillW, barH - 6, 5);
    ctx.fill();
    ctx.restore();

    drawPlaqueText(
      ctx,
      `${Math.round(pct * 100)}%`,
      cardX + cardW * 0.5,
      barY - 12,
      tokens,
      {
        font: `700 11.5px ${tokens.typography.numeralFontFamily}`,
        fill: '#FFFDFB',
        strokeWidth: 1.5,
      }
    );

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
      ctx.fillStyle = '#75B88C';
      ctx.strokeStyle = '#4B403B';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 8);
      ctx.fill();
      ctx.stroke();
    }
    drawPlaqueText(ctx, '8+', r.x + r.w * 0.5, r.y + r.h * 0.54, tokens, {
      font: `700 13px ${tokens.typography.numeralFontFamily}`,
      fill: '#FFFFFF',
      strokeWidth: 1.6,
    });
  }

  public renderCadpaPopup(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): Rect {
    const pw = Math.min(320, W - 28);
    const ph = 228;
    const panel: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };
    drawParchmentModalFrame(ctx, W, H, panel, '适龄提示 (8+)', tokens, assets);

    const lines = [
      '1. 本作是一款日系治愈流沙装瓶益智解谜小游戏，',
      '   适用于年满 8 周岁及以上的用户。',
      '2. 建议未成年人在家长监护下合理安排游戏时间。',
      '3. 纯粹休闲解谜体验，不含现金充值付费。',
    ];
    lines.forEach((ln, idx) => {
      drawInkText(ctx, ln, panel.x + 22, panel.y + 52 + idx * 24, tokens, {
        font: `600 12px ${tokens.typography.fontFamily}`,
        color: '#4B403B',
        align: 'left',
        maxWidth: pw - 44,
      });
    });

    this.cadpaCloseRect = {
      x: panel.x + (panel.w - 120) * 0.5,
      y: panel.y + panel.h - 52,
      w: 120,
      h: 38,
    };
    drawWoodButton(ctx, this.cadpaCloseRect, '好的', tokens, assets, {
      fillHex: '#15803D',
      fontSize: 13,
    });
    return this.cadpaCloseRect;
  }
}
