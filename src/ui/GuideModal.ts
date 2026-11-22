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

export type GuideTab = 'MECHANICS' | 'BLINDBOX';

/**
 * 绘本风机关图鉴与盲盒概率百科弹窗（GuideModal）
 * 复用统一双层嵌芯木框羊皮纸卡 + 凹槽图标座 + 浓棕压印排版
 */
export class GuideModal {
  public isOpen = false;
  public activeTab: GuideTab = 'MECHANICS';

  private panelRect: Rect = { x: 0, y: 0, w: 356, h: 610 };
  private closeBtnRect: Rect = { x: 0, y: 0, w: 34, h: 34 };
  private tabMechRect: Rect = { x: 0, y: 0, w: 152, h: 36 };
  private tabBoxRect: Rect = { x: 0, y: 0, w: 152, h: 36 };

  public handleTap(px: number, py: number): 'CLOSED' | 'CONSUMED' | null {
    if (!this.isOpen) return null;

    if (hitRect(px, py, this.closeBtnRect) || !hitRect(px, py, this.panelRect)) {
      this.isOpen = false;
      return 'CLOSED';
    }
    if (hitRect(px, py, this.tabMechRect)) {
      this.activeTab = 'MECHANICS';
      return 'CONSUMED';
    }
    if (hitRect(px, py, this.tabBoxRect)) {
      this.activeTab = 'BLINDBOX';
      return 'CONSUMED';
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
    const pw = Math.min(366, W - 18);
    const ph = Math.min(628, H - minTop - 12);
    this.panelRect = { x: (W - pw) * 0.5, y: Math.max(minTop, (H - ph) * 0.5 + 8), w: pw, h: ph };
    const p = this.panelRect;

    drawParchmentModalFrame(ctx, W, H, p, '玩法与机关图鉴', tokens, assets, 'ui_bg_level_drawer');

    // 右上角双圈关闭圆章
    this.closeBtnRect = { x: p.x + p.w - 46, y: p.y - 15, w: 34, h: 34 };
    drawDoubleRimPlaque(ctx, this.closeBtnRect, tokens, {
      variant: 'rose',
      rimThickness: 3.4,
      radius: 17,
    });
    drawHandDrawnGlyph(ctx, 'close', this.closeBtnRect.x + 17, this.closeBtnRect.y + 17, 14, tokens);

    // 顶部双圈分段木镶羊皮纸切换签
    const tabY = p.y + 28;
    const tabW = Math.floor((p.w - 40) * 0.5);
    this.tabMechRect = { x: p.x + 16, y: tabY, w: tabW, h: 36 };
    this.tabBoxRect = { x: p.x + 24 + tabW, y: tabY, w: tabW, h: 36 };

    const tabs: { rect: Rect; key: GuideTab; label: string; spriteId: string }[] = [
      { rect: this.tabMechRect, key: 'MECHANICS', label: '核心机关法则', spriteId: 'ui_ice_block' },
      { rect: this.tabBoxRect, key: 'BLINDBOX', label: '盲盒保底概率', spriteId: 'box_red' },
    ];

    for (const t of tabs) {
      const active = this.activeTab === t.key;
      const inner = drawDoubleRimPlaque(ctx, t.rect, tokens, {
        variant: active ? 'amber' : 'parchment',
        rimThickness: active ? 3.8 : 3.0,
        radius: 18,
      });
      if (t.key === 'MECHANICS') {
        this.drawCrystalIceIcon(ctx, inner.x + 18, t.rect.y + t.rect.h * 0.5, 18, false);
      } else {
        const ic = assets.get(t.spriteId);
        if (ic) {
          ctx.drawImage(ic, inner.x + 8, t.rect.y + (t.rect.h - 20) * 0.5, 20, 20);
        }
      }
      drawInkText(ctx, t.label, inner.x + inner.w * 0.5 + 9, t.rect.y + t.rect.h * 0.5 + 0.5, tokens, {
        font: `${active ? '800' : '700'} 12px ${tokens.typography.fontFamily}`,
        color: active ? '#4A240B' : '#6E4C30',
        maxWidth: inner.w - 28,
      });
    }

    const contentTop = tabY + 45;
    const contentH = p.h - 102;

    if (this.activeTab === 'MECHANICS') {
      this.renderMechanicsTab(ctx, p.x + 18, contentTop, p.w - 36, contentH, assets, tokens);
    } else {
      this.renderBlindboxTab(ctx, p.x + 18, contentTop, p.w - 36, contentH, assets, tokens);
    }
  }

  private renderMechanicsTab(
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
      glyph?: 'extra_slot' | 'lock';
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
        tag: '双核排桶',
        title: '宽底滤网与小卡槽排桶',
        desc1: '点选列首木桶入 4+1 小卡槽，仅吸滤网底层同色流沙！',
        desc2: '善借空槽暂存前排桶挖出后排，切勿抢抽上栓活埋滤网。',
        variant: 'amber',
      },
      {
        iconId: 'ui_ice_block',
        tag: '特殊候选',
        title: '问号盲桶 & 冰封木桶',
        desc1: '后排 ？ 盲桶递进至第 1 排瞬间将自动翻牌显露真色；',
        desc2: '冰封木桶每当任意 1 只木桶满桶清走，同步震裂 1 层冰！',
        variant: 'sky',
      },
      {
        iconId: 'ui_ice_block',
        tag: '高差破冰',
        title: '高空脆冰（软沙缓冲铁律）',
        desc1: '须腾空下方制造 ≥44 格净空直砸裸硬滤网才会摔碎！',
        desc2: '下方垫有 1 粒软沙也会缓冲不碎，盲抽必堵死沙路。',
        variant: 'sky',
      },
      {
        iconId: 'ui_linked_gear',
        tag: '机关连锁',
        title: '颜色锁 & 绳轮联动双栓',
        desc1: '颜色锁无法手抽，对应颜色木桶 100% 装满瞬间自动崩开；',
        desc2: '麻绳滑轮互连的两块联动木栓，抽动任一块将同步拉开。',
        variant: 'parchment',
      },
      {
        iconId: 'ui_lock_badge',
        tintHex: '#F3C852',
        tag: '改色狂热',
        title: '魔法染色环 & 黄金狂热沙',
        desc1: '流沙穿过染色环永久改色，适时抽断导流斜桥可保原色；',
        desc2: '黄金狂热沙闪烁星芒，无专属金桶时可注入任意在槽桶！',
        variant: 'rose',
      },
    ];

    const gap = 6;
    const cardH = Math.min(92, Math.floor((h - gap * (items.length - 1)) / items.length));

    items.forEach((it, idx) => {
      const cy = y + idx * (cardH + gap);
      const inner = drawRecessedTileCard(ctx, { x, y: cy, w, h: cardH }, tokens, {
        variant: it.variant,
        radius: 12,
        rimWidth: 3.4,
      });

      const wellSz = Math.min(44, inner.h - 10);
      const wellRect: Rect = {
        x: inner.x + 6,
        y: inner.y + (inner.h - wellSz) * 0.5,
        w: wellSz,
        h: wellSz,
      };
      drawDoubleRimPlaque(ctx, wellRect, tokens, {
        variant: 'parchment',
        rimThickness: 2.5,
        radius: 10,
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
        this.drawCrystalIceIcon(
          ctx,
          wellRect.x + wellSz * 0.5,
          wellRect.y + wellSz * 0.5,
          wellSz - 12,
          idx === 1
        );
      } else {
        const img = it.tintHex
          ? assets.getTinted(it.iconId, it.tintHex) || assets.get(it.iconId)
          : assets.get(it.iconId);
        if (img) {
          ctx.drawImage(img, wellRect.x + 5, wellRect.y + 5, wellSz - 10, wellSz - 10);
        }
      }

      const tx = wellRect.x + wellSz + 8;
      const textMaxW = inner.x + inner.w - tx - 6;

      drawInkText(ctx, it.title, tx, inner.y + inner.h * 0.25, tokens, {
        font: `800 12px ${tokens.typography.fontFamily}`,
        color: '#3A1F0E',
        align: 'left',
        maxWidth: textMaxW - 44,
      });

      drawStatusPill(ctx, inner.x + inner.w - 26, inner.y + inner.h * 0.24, it.tag, tokens, {
        bgHex: '#FFF8EC',
        borderHex: '#9C6230',
        textColor: '#6E3F19',
        fontSize: 8.5,
        padX: 7,
        height: 15,
      });

      drawInkText(ctx, it.desc1, tx, inner.y + inner.h * 0.55, tokens, {
        font: `600 10.5px ${tokens.typography.fontFamily}`,
        color: '#5C3A1E',
        align: 'left',
        maxWidth: textMaxW,
      });
      drawInkText(ctx, it.desc2, tx, inner.y + inner.h * 0.80, tokens, {
        font: `600 10.5px ${tokens.typography.fontFamily}`,
        color: '#6E4A2A',
        align: 'left',
        maxWidth: textMaxW,
      });
    });
  }

  private renderBlindboxTab(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    assets: AssetLoader,
    tokens: UiTokensFile
  ): void {
    const boxes: {
      id: string;
      name: string;
      highlight: string;
      rate: string;
      variant: StorybookTileVariant;
    }[] = [
      {
        id: 'box_white',
        name: '素白常规盒',
        highlight: '基础常驻',
        rate: '白35% · 绿30% · 蓝20% · 紫10% · 金4% · 大红1%',
        variant: 'parchment',
      },
      {
        id: 'box_purple',
        name: '炫紫进阶盒',
        highlight: '紫金高爆',
        rate: '绿20% · 蓝35% · 紫28% · 金13% · 绝世大红4%',
        variant: 'lavender',
      },
      {
        id: 'box_gold',
        name: '流光黄金盒',
        highlight: '15%出大红',
        rate: '蓝10% · 紫35% · 传说金40% · 绝世大红15%',
        variant: 'amber',
      },
      {
        id: 'box_red',
        name: '至尊大红箱',
        highlight: '55%出大红',
        rate: '传说金 45%  ·  绝世大红高达 55%！',
        variant: 'rose',
      },
      {
        id: 'box_ice',
        name: '极寒冰封盒 / 双黄盒',
        highlight: '定向UP/双抽',
        rate: '冰系藏品 2 倍概率 UP · 双黄盒一次连爆双卡！',
        variant: 'sky',
      },
    ];

    const pityReserve = 96;
    const gap = 6;
    const rowH = Math.min(68, Math.floor((h - pityReserve - gap * boxes.length) / boxes.length));

    boxes.forEach((b, idx) => {
      const ry = y + idx * (rowH + gap);
      const inner = drawRecessedTileCard(ctx, { x, y: ry, w, h: rowH }, tokens, {
        variant: b.variant,
        radius: 12,
        rimWidth: 3.2,
      });

      const img = assets.get(b.id);
      const bSz = Math.min(42, inner.h - 6);
      if (img) {
        ctx.drawImage(img, inner.x + 6, inner.y + (inner.h - bSz) * 0.5, bSz, bSz);
      }

      const tx = inner.x + bSz + 12;
      const textMaxW = inner.x + inner.w - tx - 6;

      drawInkText(ctx, b.name, tx, inner.y + inner.h * 0.32, tokens, {
        font: `800 12.5px ${tokens.typography.fontFamily}`,
        color: '#3A1F0E',
        align: 'left',
      });

      drawStatusPill(ctx, inner.x + inner.w - 34, inner.y + inner.h * 0.31, b.highlight, tokens, {
        bgHex: b.variant === 'rose' ? '#FEE2E2' : '#FFF8EC',
        borderHex: b.variant === 'rose' ? '#B91C1C' : '#9C6230',
        textColor: b.variant === 'rose' ? '#991B1B' : '#5C3518',
        fontSize: 8.5,
        padX: 8,
        height: 15,
      });

      drawInkText(ctx, b.rate, tx, inner.y + inner.h * 0.72, tokens, {
        font: `600 10.5px ${tokens.typography.fontFamily}`,
        color: '#5C3A1E',
        align: 'left',
        maxWidth: textMaxW,
      });
    });

    const tipY = y + boxes.length * (rowH + gap) + 2;
    const tipH = Math.max(82, h - (tipY - y));
    const tipInner = drawRecessedTileCard(ctx, { x, y: tipY, w, h: tipH }, tokens, {
      variant: 'amber',
      radius: 13,
      rimWidth: 3.5,
    });

    drawHandDrawnGlyph(ctx, 'sparkle', tipInner.x + 12, tipInner.y + 13, 13, tokens);
    drawInkText(ctx, '良心双保底与淘金碎片合成铁律', tipInner.x + 23, tipInner.y + 13, tokens, {
      font: `800 11.5px ${tokens.typography.fontFamily}`,
      color: '#7C2D12',
      align: 'left',
    });

    const rules = [
      '• 连续 15 抽未出金，第 16 抽必出【传说金】或【绝世大红】！',
      '• 连续 40 抽未出红，开启紫/金/红箱必爆【绝世大红】！',
      '• 重复公仔增身价并化碎片：5 碎片必出新 / 25 碎片必出紫金红！',
    ];
    rules.forEach((rl, i) => {
      drawInkText(
        ctx,
        rl,
        tipInner.x + 8,
        tipInner.y + 33 + i * Math.max(16, (tipInner.h - 38) / 3),
        tokens,
        {
          font: `600 10px ${tokens.typography.fontFamily}`,
          color: '#3E2311',
          align: 'left',
          maxWidth: tipInner.w - 14,
        }
      );
    });
  }

  private drawCrystalIceIcon(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    isPermafrost: boolean
  ): void {
    const w = size;
    const h = size * 0.78;
    const x = cx - w * 0.5;
    const y = cy - h * 0.5;
    ctx.save();
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    if (isPermafrost) {
      g.addColorStop(0, '#BCE6FF');
      g.addColorStop(0.5, '#5CA8E0');
      g.addColorStop(1, '#2B6CA8');
    } else {
      g.addColorStop(0, '#E8F8FF');
      g.addColorStop(0.55, '#9BD7F5');
      g.addColorStop(1, '#68B4E0');
    }
    ctx.fillStyle = g;
    ctx.strokeStyle = isPermafrost ? '#1D4B7A' : '#3E2311';
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, 4.5);
    ctx.fill();
    ctx.stroke();

    // 斜向冰晶切面反光条
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.22, y + h * 0.74);
    ctx.lineTo(x + w * 0.52, y + h * 0.24);
    ctx.moveTo(x + w * 0.56, y + h * 0.76);
    ctx.lineTo(x + w * 0.78, y + h * 0.36);
    ctx.stroke();
    ctx.restore();
  }
}
