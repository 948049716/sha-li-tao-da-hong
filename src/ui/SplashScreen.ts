import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { Rect, UiTokensFile } from '../types/ui';
import { drawCoverImage, drawOutlinedText, drawParchmentModalFrame, drawWoodButton, hitRect, roundRectPath } from './UIHelpers';

/**
 * 启动加载页与 CADPA 8+ 适龄合规弹窗（对齐 UI_UX 规范 §2.2.1）
 */
export class SplashScreen {
  public progress = 0;
  public showCadpaModal = false;
  private cadpaBadgeRect: Rect = { x: 16, y: 0, w: 38, h: 46 };
  private cadpaCloseRect: Rect = { x: 0, y: 0, w: 120, h: 40 };

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
    } else {
      ctx.fillStyle = tokens.theme.starryNightBg;
      ctx.fillRect(0, 0, W, H);
    }

    // 品牌 Logo 轻柔呼吸浮动
    const logo = assets.get('ui_logo_title');
    const bob = Math.sin(timeSec * ((Math.PI * 2) / 2.4)) * 4;
    if (logo && logo.width > 0) {
      const lw = Math.min(260, W * 0.72);
      const lh = lw * (logo.height / logo.width);
      ctx.drawImage(logo, (W - lw) * 0.5, H * 0.16 + bob, lw, lh);
    } else {
      drawOutlinedText(
        ctx,
        '沙里淘大红',
        W * 0.5,
        H * 0.22 + bob,
        `800 34px ${tokens.typography.fontFamily}`,
        '#FFF8EC',
        tokens.theme.inkOutline,
        4
      );
    }

    // 底部流沙进度条
    const barW = 220;
    const barH = 14;
    const barX = (W - barW) * 0.5;
    const barY = H - 64;

    ctx.fillStyle = tokens.theme.woodDark;
    ctx.strokeStyle = tokens.theme.inkOutline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRectPath(ctx, barX, barY, barW, barH, 7);
    ctx.fill();
    ctx.stroke();

    const fillW = Math.max(10, (barW - 4) * Math.min(1, this.progress));
    ctx.fillStyle = '#FFB81C';
    ctx.beginPath();
    roundRectPath(ctx, barX + 2, barY + 2, fillW, barH - 4, 5);
    ctx.fill();

    drawOutlinedText(
      ctx,
      '正在点亮星夜淘沙工坊...',
      W * 0.5,
      barY - 14,
      `600 12px ${tokens.typography.fontFamily}`,
      '#FFF8EC',
      tokens.theme.inkOutline,
      2
    );

    // 左下角 CADPA 8+ 适龄提示徽牌
    this.cadpaBadgeRect = { x: 16, y: H - 68, w: 38, h: 46 };
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
      ctx.fillStyle = '#15803D';
      ctx.strokeStyle = tokens.theme.inkOutline;
      ctx.lineWidth = 2;
      ctx.beginPath();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 8);
      ctx.fill();
      ctx.stroke();
    }
    drawOutlinedText(
      ctx,
      '8+',
      r.x + r.w * 0.5,
      r.y + r.h * 0.54,
      `800 14px ${tokens.typography.numeralFontFamily}`,
      '#FFFFFF',
      tokens.theme.inkOutline,
      2.2
    );
  }

  public renderCadpaPopup(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): Rect {
    const pw = Math.min(316, W - 32);
    const ph = 228;
    const panel: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };
    drawParchmentModalFrame(ctx, W, H, panel, '适龄提示 (8+)', tokens, assets);

    const lines = [
      '1. 本游戏是一款治愈系流沙益智解谜小游戏，',
      '   适用于年满 8 周岁及以上的用户。',
      '2. 建议未成年人在家长监护下合理安排时间。',
      '3. 游戏为纯休闲收集玩法，不含现金充值付费。',
    ];
    ctx.save();
    ctx.font = `600 12.5px ${tokens.typography.fontFamily}`;
    ctx.fillStyle = tokens.theme.inkOutline;
    ctx.textAlign = 'left';
    lines.forEach((ln, idx) => {
      ctx.fillText(ln, panel.x + 20, panel.y + 52 + idx * 24);
    });
    ctx.restore();

    this.cadpaCloseRect = {
      x: panel.x + (panel.w - 124) * 0.5,
      y: panel.y + panel.h - 52,
      w: 124,
      h: 38,
    };
    drawWoodButton(ctx, this.cadpaCloseRect, '我知道了', tokens, assets, {
      fillHex: '#10B981',
    });
    return this.cadpaCloseRect;
  }
}
