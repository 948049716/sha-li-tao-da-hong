import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { Rect, UiTokensFile } from '../types/ui';
import {
  drawCoralCloseButton,
  drawInkText,
  drawParchmentModalFrame,
  hitRect,
  roundRectPath,
} from './UIHelpers';

export type GuideTapResult = 'CLOSED' | 'CONSUMED' | { type: 'CARD_TIP'; tip: string };

/**
 * 1:1 严格还原《玩法与机关图鉴弹窗.webp》设计稿：
 * - 浅橡木画框 + 右下微卷折角象牙羊皮纸内衬 + 顶部微拱羊皮纸飘带标题 + 珊瑚粉关闭圆钮
 * - 5 张极简纯净圆角白底插画卡（左侧手绘水彩机关插画 + 右侧大号手账体标题）
 * - 点击任意图鉴卡片轻弹一句话规则说明
 */
export class GuideModal {
  public isOpen = false;

  private panelRect: Rect = { x: 0, y: 0, w: 344, h: 560 };
  private closeBtnRect: Rect = { x: 0, y: 0, w: 36, h: 36 };
  private cardRects: { rect: Rect; tip: string }[] = [];

  public handleTap(px: number, py: number): GuideTapResult | null {
    if (!this.isOpen) return null;

    if (hitRect(px, py, this.closeBtnRect) || !hitRect(px, py, this.panelRect)) {
      this.isOpen = false;
      return 'CLOSED';
    }

    for (const c of this.cardRects) {
      if (hitRect(px, py, c.rect)) {
        return { type: 'CARD_TIP', tip: c.tip };
      }
    }
    return 'CONSUMED';
  }

  public render(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    if (!this.isOpen) return;
    const W = layout.screenW;
    const H = layout.screenH;

    const minTop = layout.menuRect.y + layout.menuRect.h + 18;
    const pw = Math.min(324, W - 46);
    const ph = Math.min(568, H - minTop - 18);
    this.panelRect = {
      x: Math.round((W - pw) * 0.5),
      y: Math.max(minTop, Math.round((H - ph) * 0.5 + 8)),
      w: pw,
      h: ph,
    };
    const p = this.panelRect;

    drawParchmentModalFrame(ctx, W, H, p, '玩法与机关图鉴', tokens, assets, 'ui_bg_level_drawer', {
      curledCorner: true,
    });

    this.closeBtnRect = { x: p.x + p.w - 26, y: p.y - 12, w: 36, h: 36 };
    drawCoralCloseButton(ctx, this.closeBtnRect, tokens);

    const contentTop = p.y + 46;
    const contentH = p.h - 68;
    this.renderMechanicsCards(ctx, p.x + 20, contentTop, p.w - 40, contentH, assets, tokens);
  }

  private renderMechanicsCards(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    const items: {
      spriteId: string;
      lines: string[];
      tip: string;
    }[] = [
      {
        spriteId: 'ui_bucket_full_fx',
        lines: ['丝带玻璃瓶', '· 滤网接沙'],
        tip: '✦ 点选木槽最前排丝带瓶入座，自动吸取滤网同色底沙',
      },
      {
        spriteId: 'ui_ice_shatter_fx',
        lines: ['雾面问号瓶', '& 冰晶瓶'],
        tip: '✦ 后排 ? 瓶推进至前排自动揭晓；每装满 1 瓶震裂 1 层寒冰',
      },
      {
        spriteId: 'ui_jam_warning',
        lines: ['高空脆冰'],
        tip: '✦ 须先排空下方软沙留出净空，直落硬滤网才会碎裂化沙',
      },
      {
        spriteId: 'ui_lock_break_fx',
        lines: ['颜色锁 &', '联动拨片'],
        tip: '✦ 同色瓶装满瞬间自动开锁；相连木杆抽任一根同步拉开',
      },
      {
        spriteId: 'ui_gold_sand_pile',
        lines: ['染色环 &', '星耀金沙'],
        tip: '✦ 流沙穿环永久改色；星耀金沙可通配注入任意在槽玻璃瓶',
      },
    ];

    const gap = 10;
    const cardH = Math.floor((h - gap * (items.length - 1)) / items.length);
    this.cardRects = [];

    items.forEach((it, idx) => {
      const cy = y + idx * (cardH + gap);
      const r: Rect = { x, y: cy, w, h: cardH };
      this.cardRects.push({ rect: r, tip: it.tip });

      ctx.save();
      // 柔和底影
      ctx.fillStyle = 'rgba(42, 26, 14, 0.13)';
      ctx.beginPath();
      roundRectPath(ctx, r.x + 1, r.y + 3, r.w - 2, r.h, 13);
      ctx.fill();

      // 纯净象牙白圆角卡片底面
      ctx.fillStyle = '#FFFDF8';
      ctx.strokeStyle = '#3B2416';
      ctx.lineWidth = 1.55;
      ctx.beginPath();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 13);
      ctx.fill();
      ctx.stroke();

      // 左侧手绘水彩插画
      const img = assets.get(it.spriteId);
      const iconBoxSz = Math.min(cardH - 4, 92);
      const ix = r.x + 8 + (98 - iconBoxSz) * 0.5;
      const iy = r.y + (r.h - iconBoxSz) * 0.5;
      if (img && img.width > 0) {
        ctx.drawImage(img, ix, iy, iconBoxSz, iconBoxSz);
      }

      // 右侧大号手账体标题
      const textCx = r.x + 110 + (r.w - 118) * 0.5;
      const fontSize = cardH < 76 ? 18.5 : 20.5;
      if (it.lines.length === 1) {
        drawInkText(ctx, it.lines[0], textCx, r.y + r.h * 0.5 + 1, tokens, {
          font: `700 ${fontSize + 1}px ${tokens.typography.fontFamily}`,
          color: '#2B1B10',
          boldStrokeWidth: 0.4,
          maxWidth: r.w - 120,
        });
      } else {
        const lineGap = fontSize * 1.25;
        drawInkText(ctx, it.lines[0], textCx, r.y + r.h * 0.5 - lineGap * 0.48, tokens, {
          font: `700 ${fontSize}px ${tokens.typography.fontFamily}`,
          color: '#2B1B10',
          boldStrokeWidth: 0.4,
          maxWidth: r.w - 120,
        });
        drawInkText(ctx, it.lines[1], textCx, r.y + r.h * 0.5 + lineGap * 0.52, tokens, {
          font: `700 ${fontSize}px ${tokens.typography.fontFamily}`,
          color: '#2B1B10',
          boldStrokeWidth: 0.4,
          maxWidth: r.w - 120,
        });
      }

      ctx.restore();
    });
  }
}
