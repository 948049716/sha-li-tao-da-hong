import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { Rect, UiTokensFile } from '../types/ui';
import {
  drawCoverImage,
  drawInkText,
  drawParchmentModalFrame,
  drawRibbonBanner,
  drawStorybookNumber,
  drawWoodButton,
  hitRect,
  roundRectPath,
} from './UIHelpers';

/**
 * 1:1 严格还原《启动加载页.webp》设计稿：
 * - 星夜玻璃花房工坊背景 + 中央悬浮粉丝带软木塞许愿瓶与星光微粒
 * - 顶部立体双描边木牌标题《星夜流沙瓶》+ 微拱羊皮纸飘带「流沙入瓶 · 静谧解谜」
 * - 底部左右双卷轴羊皮纸加载框（「正在加载中...」+ 百分比 + 粉黄薄荷绿渐变星芒进度条）
 * - 左下角绿底白框「8+ 适龄」徽章（纯中文界面）
 */
export class SplashScreen {
  public progress = 0;
  public showCadpaModal = false;
  private cadpaBadgeRect: Rect = { x: 12, y: 0, w: 42, h: 52 };
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

    // 1. 全屏星夜玻璃花房与悬浮许愿瓶背景
    const bg = assets.get('ui_bg_splash');
    if (bg) {
      drawCoverImage(ctx, bg, W, H);
    } else {
      ctx.fillStyle = tokens.theme.starryNightBg;
      ctx.fillRect(0, 0, W, H);
    }

    // 中央许愿瓶四周呼吸闪烁小星点
    ctx.save();
    const starSeeds: [number, number, number, number][] = [
      [0.37, 0.49, 4.2, 0.0],
      [0.64, 0.51, 4.8, 1.3],
      [0.42, 0.62, 3.0, 2.4],
      [0.58, 0.45, 3.4, 3.6],
    ];
    for (const [fx, fy, sz, ph] of starSeeds) {
      const a = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(timeSec * 3.4 + ph));
      const sx = W * fx;
      const sy = H * fy;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#FFF6C8';
      ctx.beginPath();
      ctx.moveTo(sx, sy - sz);
      ctx.quadraticCurveTo(sx, sy, sx + sz, sy);
      ctx.quadraticCurveTo(sx, sy, sx, sy + sz);
      ctx.quadraticCurveTo(sx, sy, sx - sz, sy);
      ctx.quadraticCurveTo(sx, sy, sx, sy - sz);
      ctx.fill();
    }
    ctx.restore();

    // 2. 顶部立体木牌大标题《星夜流沙瓶》+ 飘带副标题
    const logo = assets.get('ui_logo_title');
    const bob = Math.sin(timeSec * 2.2) * 2.2;
    const topY = Math.max(78, H * 0.205);
    let ribbonY = topY + 92;

    if (logo && logo.width > 0) {
      const lw = Math.min(326, W * 0.84);
      const lh = lw * (logo.height / logo.width);
      ctx.drawImage(logo, (W - lw) * 0.5, topY + bob, lw, lh);
      ribbonY = topY + lh + 18;
    } else {
      drawInkText(ctx, '星夜流沙瓶', W * 0.5, topY + 42 + bob, tokens, {
        font: `700 36px ${tokens.typography.fontFamily}`,
        color: '#FCE29C',
        boldStrokeWidth: 2.2,
      });
    }

    drawRibbonBanner(
      ctx,
      W * 0.5,
      ribbonY + 2,
      Math.min(256, W * 0.66),
      44,
      '流沙入瓶 · 静谧解谜',
      tokens,
      18.5
    );

    // 3. 底部左右双卷轴羊皮纸加载框（1:1 对齐《启动加载页.webp》）
    const scrollW = Math.min(332, W - 46);
    const scrollH = 76;
    const scrollX = (W - scrollW) * 0.5;
    const scrollY = H - scrollH - Math.max(46, H * 0.075);
    this.drawParchmentScrollProgress(
      ctx,
      scrollX,
      scrollY,
      scrollW,
      scrollH,
      Math.max(0.08, Math.min(1, this.progress)),
      tokens,
      timeSec
    );

    // 4. 左下角 8+ 适龄绿色徽章（纯中文）
    this.cadpaBadgeRect = { x: 10, y: H - 60, w: 40, h: 50 };
    this.renderCadpaBadge(ctx, this.cadpaBadgeRect, assets, tokens);

    if (this.showCadpaModal) {
      this.renderCadpaPopup(ctx, W, H, assets, tokens);
    }
  }

  private drawParchmentScrollProgress(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    pct: number,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    const rollW = 12;
    const ink = '#3B2416';

    ctx.save();
    // 卷轴整体投影
    ctx.fillStyle = 'rgba(12, 8, 4, 0.36)';
    ctx.beginPath();
    roundRectPath(ctx, x - 2, y + 5, w + 4, h, 8);
    ctx.fill();

    // 中部展开羊皮纸面
    const bodyGrad = ctx.createLinearGradient(0, y, 0, y + h);
    bodyGrad.addColorStop(0, '#FDF7E8');
    bodyGrad.addColorStop(0.75, '#F6EAD2');
    bodyGrad.addColorStop(1, '#E8D5B4');
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.65;
    ctx.beginPath();
    roundRectPath(ctx, x + rollW * 0.5, y + 3, w - rollW, h - 6, 4);
    ctx.fill();
    ctx.stroke();

    // 左右两侧立体羊皮纸卷筒
    for (const rx of [x, x + w - rollW]) {
      const rGrad = ctx.createLinearGradient(rx, y, rx + rollW, y);
      rGrad.addColorStop(0, '#DFC69E');
      rGrad.addColorStop(0.45, '#FBF2DE');
      rGrad.addColorStop(1, '#C9AC80');
      ctx.fillStyle = rGrad;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      roundRectPath(ctx, rx, y, rollW, h + 2, rollW * 0.48);
      ctx.fill();
      ctx.stroke();

      // 底部卷纸螺旋小圆口
      ctx.fillStyle = '#B08F63';
      ctx.beginPath();
      ctx.arc(rx + rollW * 0.5, y + h - 3.5, rollW * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 卷轴上半行：居中「正在加载中...」+ 右侧百分比
    const textY = y + 23;
    drawInkText(ctx, '正在加载中...', x + w * 0.5, textY, tokens, {
      font: `700 15px ${tokens.typography.fontFamily}`,
      color: '#2B1B10',
      boldStrokeWidth: 0.25,
    });
    drawStorybookNumber(ctx, `${Math.round(pct * 100)}%`, x + w - rollW - 24, textY, 15.5, tokens, {
      slant: -0.05,
    });

    // 卷轴下半行：圆角进度槽（粉 -> 暖黄 -> 薄荷绿渐变 + 白色四角星芒）
    const barX = x + rollW + 10;
    const barW = w - (rollW + 10) * 2;
    const barY = y + 40;
    const barH = 22;

    ctx.fillStyle = '#E6D4B5';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.65;
    ctx.beginPath();
    roundRectPath(ctx, barX, barY, barW, barH, barH * 0.5);
    ctx.fill();
    ctx.stroke();

    const innerPad = 2.5;
    const fillMaxW = barW - innerPad * 2;
    const fillW = Math.max(barH - innerPad * 2, fillMaxW * pct);
    const sGrad = ctx.createLinearGradient(barX + innerPad, 0, barX + innerPad + fillMaxW, 0);
    sGrad.addColorStop(0, '#F5A5B1');
    sGrad.addColorStop(0.46, '#FCE594');
    sGrad.addColorStop(1, '#9EE0C2');

    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, barX + innerPad, barY + innerPad, fillW, barH - innerPad * 2, (barH - innerPad * 2) * 0.5);
    ctx.clip();
    ctx.fillStyle = sGrad;
    ctx.fillRect(barX + innerPad, barY + innerPad, fillW, barH - innerPad * 2);

    // 顶部柔和白亮高光带
    ctx.fillStyle = 'rgba(255, 255, 255, 0.36)';
    ctx.fillRect(barX + innerPad, barY + innerPad, fillW, (barH - innerPad * 2) * 0.38);

    // 进度条前段闪烁白色四角星
    const spX = barX + innerPad + Math.max(14, fillW - 22);
    const spY = barY + barH * 0.52;
    const spR = 5.2 + 0.8 * Math.sin(timeSec * 5);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(spX, spY - spR);
    ctx.quadraticCurveTo(spX, spY, spX + spR, spY);
    ctx.quadraticCurveTo(spX, spY, spX, spY + spR);
    ctx.quadraticCurveTo(spX, spY, spX - spR, spY);
    ctx.quadraticCurveTo(spX, spY, spX, spY - spR);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  public renderCadpaBadge(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    _assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 14, 22, 0.32)';
    ctx.beginPath();
    roundRectPath(ctx, r.x + 1, r.y + 2, r.w, r.h, 6);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#2B4B2C';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fill();
    ctx.stroke();

    const gGrad = ctx.createLinearGradient(0, r.y + 2, 0, r.y + r.h - 13);
    gGrad.addColorStop(0, '#78C26E');
    gGrad.addColorStop(1, '#58A450');
    ctx.fillStyle = gGrad;
    ctx.beginPath();
    roundRectPath(ctx, r.x + 2.5, r.y + 2.5, r.w - 5, r.h - 15, 4);
    ctx.fill();

    drawInkText(ctx, '8+', r.x + r.w * 0.5, r.y + 17, tokens, {
      font: `700 16px ${tokens.typography.numeralFontFamily}`,
      color: '#FFFFFF',
      embossColor: 'rgba(28, 72, 28, 0.35)',
      boldStrokeWidth: 0.5,
    });
    drawInkText(ctx, '★★★★', r.x + r.w * 0.5, r.y + 30, tokens, {
      font: `700 6.5px ${tokens.typography.fontFamily}`,
      color: '#FFF8D6',
      embossColor: '',
    });
    drawInkText(ctx, '适龄提示', r.x + r.w * 0.5, r.y + r.h - 6.5, tokens, {
      font: `700 7.5px ${tokens.typography.fontFamily}`,
      color: '#2B4B2C',
      embossColor: '',
    });
    ctx.restore();
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
      '1. 本作是一款日系治愈流沙装瓶益智解谜小游戏，',
      '   适用于年满 8 周岁及以上的用户。',
      '2. 建议未成年人在家长监护下合理安排游戏时间。',
      '3. 纯粹休闲解谜体验，不含现金充值付费。',
    ];
    lines.forEach((ln, idx) => {
      drawInkText(ctx, ln, panel.x + 24, panel.y + 56 + idx * 25, tokens, {
        font: `600 12.5px ${tokens.typography.fontFamily}`,
        color: '#3B2416',
        align: 'left',
        maxWidth: pw - 48,
      });
    });

    this.cadpaCloseRect = {
      x: panel.x + (panel.w - 124) * 0.5,
      y: panel.y + panel.h - 56,
      w: 124,
      h: 40,
    };
    drawWoodButton(ctx, this.cadpaCloseRect, '好的', tokens, assets, {
      fillHex: '#1F7A44',
      fontSize: 14,
    });
    return this.cadpaCloseRect;
  }
}
