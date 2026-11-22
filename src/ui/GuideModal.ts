import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { Rect, UiTokensFile } from '../types/ui';
import {
  drawDoubleRimPlaque,
  drawHandDrawnGlyph,
  drawInkText,
  drawParchmentModalFrame,
  drawRecessedTileCard,
  drawStatusPill,
  hitRect,
  roundRectPath,
  type StorybookTileVariant,
} from './UIHelpers';

/**
 * 日系治愈极简机关图鉴弹窗（GuideModal）：
 * 同步玻璃瓶丝带、磨砂玻璃隔条与浅枫木拨片视觉语言
 */
export class GuideModal {
  public isOpen = false;

  private panelRect: Rect = { x: 0, y: 0, w: 356, h: 548 };
  private closeBtnRect: Rect = { x: 0, y: 0, w: 32, h: 32 };

  public handleTap(px: number, py: number): 'CLOSED' | 'CONSUMED' | null {
    if (!this.isOpen) return null;

    if (hitRect(px, py, this.closeBtnRect) || !hitRect(px, py, this.panelRect)) {
      this.isOpen = false;
      return 'CLOSED';
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

    const minTop = layout.menuRect.y + layout.menuRect.h + 14;
    const pw = Math.min(362, W - 20);
    const ph = Math.min(556, H - minTop - 14);
    this.panelRect = { x: (W - pw) * 0.5, y: Math.max(minTop, (H - ph) * 0.5 + 6), w: pw, h: ph };
    const p = this.panelRect;

    drawParchmentModalFrame(ctx, W, H, p, '玩法与机关图鉴', tokens, assets, 'ui_bg_level_drawer');

    this.closeBtnRect = { x: p.x + p.w - 44, y: p.y - 15, w: 32, h: 32 };
    drawDoubleRimPlaque(ctx, this.closeBtnRect, tokens, {
      variant: 'rose',
      radius: 16,
    });
    drawHandDrawnGlyph(ctx, 'close', this.closeBtnRect.x + 16, this.closeBtnRect.y + 16, 13, tokens);

    const contentTop = p.y + 28;
    const contentH = p.h - 44;
    this.renderMechanicsList(ctx, p.x + 16, contentTop, p.w - 32, contentH, assets, tokens);
  }

  private renderMechanicsList(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    const items: {
      iconId: string;
      glyph?: 'extra_slot' | 'snowflake';
      tintHex?: string;
      tag: string;
      title: string;
      desc1: string;
      desc2: string;
      variant: StorybookTileVariant;
    }[] = [
      {
        iconId: '',
        glyph: 'extra_slot',
        tag: '核心规则',
        title: '丝带玻璃瓶 · 滤网接沙',
        desc1: '点选列首玻璃瓶送入接沙台，仅收集与瓶颈丝带同色的底沙；',
        desc2: '善借空位暂存前排玻璃瓶露出后排，切勿盲抽拨片活埋滤网。',
        variant: 'amber',
      },
      {
        iconId: '',
        glyph: 'snowflake',
        tag: '特殊瓶体',
        title: '雾面问号瓶 & 冰晶玻璃瓶',
        desc1: '后排「?」雾面瓶递进至最前排瞬间，将自动揭晓丝带颜色；',
        desc2: '每当任意 1 只玻璃瓶装满离场，冰晶瓶同步震裂 1 层寒冰。',
        variant: 'sky',
      },
      {
        iconId: 'ui_ice_block',
        tag: '高差破冰',
        title: '高空脆冰（软沙缓冲定律）',
        desc1: '须先排空下方制造 ≥44 格净空，直落硬滤网才会震碎化沙；',
        desc2: '下方若垫有软沙将缓冲不碎，抢先乱抽拨片会锁死通道。',
        variant: 'sky',
      },
      {
        iconId: 'ui_linked_gear',
        tag: '联动锁扣',
        title: '颜色锁 & 香槟丝线联动拨片',
        desc1: '颜色锁无法手抽，对应颜色玻璃瓶 100% 装满瞬间自动解开；',
        desc2: '丝线相连的两枚浅枫木拨片，轻抽任一枚将同步拉开。',
        variant: 'parchment',
      },
      {
        iconId: 'ui_dye_ring',
        tag: '改色星砂',
        title: '染色环 · 斜拨片 & 星耀金沙',
        desc1: '磨砂玻璃隔条固定不动；带圆环的浅枫木斜拨片可抽走断流；',
        desc2: '流沙穿环永久改色，星耀金沙在无金瓶时可注入任意在槽瓶。',
        variant: 'rose',
      },
    ];

    const gap = 7;
    const cardH = Math.min(94, Math.floor((h - gap * (items.length - 1)) / items.length));

    items.forEach((it, idx) => {
      const cy = y + idx * (cardH + gap);
      const inner = drawRecessedTileCard(ctx, { x, y: cy, w, h: cardH }, tokens, {
        variant: it.variant,
        radius: 14,
      });

      const wellSz = Math.min(42, inner.h - 12);
      const wellRect: Rect = {
        x: inner.x + 6,
        y: inner.y + (inner.h - wellSz) * 0.5,
        w: wellSz,
        h: wellSz,
      };
      drawDoubleRimPlaque(ctx, wellRect, tokens, {
        variant: 'parchment',
        radius: 12,
        shadow: false,
      });
      if (it.glyph) {
        drawHandDrawnGlyph(
          ctx,
          it.glyph,
          wellRect.x + wellSz * 0.5,
          wellRect.y + wellSz * 0.5,
          wellSz - 12,
          tokens
        );
      } else if (it.iconId === 'ui_ice_block') {
        this.drawCrystalIceIcon(ctx, wellRect.x + wellSz * 0.5, wellRect.y + wellSz * 0.5, wellSz - 14);
      } else {
        const img = it.tintHex
          ? assets.getTinted(it.iconId, it.tintHex) || assets.get(it.iconId)
          : assets.get(it.iconId);
        if (img) {
          ctx.drawImage(img, wellRect.x + 6, wellRect.y + 6, wellSz - 12, wellSz - 12);
        }
      }

      const tx = wellRect.x + wellSz + 9;
      const textMaxW = inner.x + inner.w - tx - 6;

      drawInkText(ctx, it.title, tx, inner.y + inner.h * 0.25, tokens, {
        font: `700 12px ${tokens.typography.fontFamily}`,
        color: '#4B403B',
        align: 'left',
        maxWidth: textMaxW - 46,
      });

      drawStatusPill(ctx, inner.x + inner.w - 26, inner.y + inner.h * 0.24, it.tag, tokens, {
        bgHex: 'rgba(255, 255, 255, 0.88)',
        borderHex: 'rgba(122, 107, 99, 0.42)',
        textColor: '#6B5D55',
        fontSize: 8.5,
        padX: 7,
        height: 15,
      });

      drawInkText(ctx, it.desc1, tx, inner.y + inner.h * 0.55, tokens, {
        font: `600 10.5px ${tokens.typography.fontFamily}`,
        color: '#5E514A',
        align: 'left',
        maxWidth: textMaxW,
      });
      drawInkText(ctx, it.desc2, tx, inner.y + inner.h * 0.80, tokens, {
        font: `600 10.5px ${tokens.typography.fontFamily}`,
        color: '#73655D',
        align: 'left',
        maxWidth: textMaxW,
      });
    });
  }

  private drawCrystalIceIcon(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number
  ): void {
    const w = size;
    const h = size * 0.78;
    const x = cx - w * 0.5;
    const y = cy - h * 0.5;
    ctx.save();
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#EAF8FF');
    g.addColorStop(0.55, '#A4DCF8');
    g.addColorStop(1, '#73BBE4');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#4B82AB';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, 5);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.24, y + h * 0.72);
    ctx.lineTo(x + w * 0.52, y + h * 0.26);
    ctx.stroke();
    ctx.restore();
  }
}
