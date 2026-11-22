import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { Rect, UiTokensFile } from '../types/ui';
import {
  drawOutlinedText,
  drawParchmentModalFrame,
  drawWoodButton,
  drawWoodCapsule,
  hitRect,
} from './UIHelpers';

export type GuideTab = 'MECHANICS' | 'BLINDBOX';

/**
 * 机关图鉴与盲盒概率百科弹窗（主菜单与局内选关页均可随时唤起）
 */
export class GuideModal {
  public isOpen = false;
  public activeTab: GuideTab = 'MECHANICS';

  private panelRect: Rect = { x: 0, y: 0, w: 356, h: 610 };
  private closeBtnRect: Rect = { x: 0, y: 0, w: 58, h: 28 };
  private tabMechRect: Rect = { x: 0, y: 0, w: 152, h: 36 };
  private tabBoxRect: Rect = { x: 0, y: 0, w: 152, h: 36 };

  public handleTap(px: number, py: number): 'CLOSED' | 'CONSUMED' | null {
    if (!this.isOpen) return null;

    if (!hitRect(px, py, this.panelRect) || hitRect(px, py, this.closeBtnRect)) {
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

    const minTop = layout.menuRect.y + layout.menuRect.h + 8;
    const pw = Math.min(364, W - 18);
    const ph = Math.min(628, H - minTop - 14);
    this.panelRect = { x: (W - pw) * 0.5, y: Math.max(minTop, (H - ph) * 0.5 + 10), w: pw, h: ph };
    const p = this.panelRect;

    drawParchmentModalFrame(ctx, W, H, p, '📖 玩法与机关图鉴', tokens, assets, 'ui_bg_level_drawer');

    this.closeBtnRect = { x: p.x + p.w - 66, y: p.y + 10, w: 54, h: 28 };
    drawWoodButton(ctx, this.closeBtnRect, '关闭✕', tokens, assets, {
      fontSize: 11,
      fillHex: '#9A6228',
    });

    // 顶部双 Tab 切换栏
    const tabY = p.y + 44;
    const tabW = Math.floor((p.w - 36) * 0.5);
    this.tabMechRect = { x: p.x + 14, y: tabY, w: tabW, h: 36 };
    this.tabBoxRect = { x: p.x + 22 + tabW, y: tabY, w: tabW, h: 36 };

    drawWoodButton(ctx, this.tabMechRect, '🧊 核心机关法则', tokens, assets, {
      fontSize: 12,
      fillHex: this.activeTab === 'MECHANICS' ? '#D97706' : '#C89F72',
    });
    drawWoodButton(ctx, this.tabBoxRect, '🎁 盲盒与保底概率', tokens, assets, {
      fontSize: 12,
      fillHex: this.activeTab === 'BLINDBOX' ? '#D97706' : '#C89F72',
    });

    const contentTop = tabY + 46;
    const contentH = p.h - 102;

    if (this.activeTab === 'MECHANICS') {
      this.renderMechanicsTab(ctx, p.x + 14, contentTop, p.w - 28, contentH, assets, tokens);
    } else {
      this.renderBlindboxTab(ctx, p.x + 14, contentTop, p.w - 28, contentH, assets, tokens);
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
    const items = [
      {
        iconId: 'ui_ice_block',
        badge: '🧊',
        title: '高空脆冰（软沙缓冲铁律）',
        desc1: '须腾空下方制造 ≥52 格净空直砸裸硬底才碎！',
        desc2: '下方哪怕垫有 1 粒流沙或冰砖也绝不摔碎，盲抽必卡死。',
        tint: '#E0F2FE',
      },
      {
        iconId: 'ui_ice_block',
        badge: '❄️',
        title: '万年寒冰（流沙冲刷消融）',
        desc1: '深蓝晶框，免疫一切坠落伤害（掉落直接堵死漏斗）！',
        desc2: '唯有引导其他流沙沿其表面持续滑过冲刷满进度才化沙。',
        tint: '#DBEAFE',
      },
      {
        iconId: 'ui_board_push_gate',
        badge: '🚧',
        title: '反复推拉活门闸',
        desc1: '虚线导槽可不限次数点击【推入关闸 / 拉开泄洪】。',
        desc2: '注意分辨有效截流闸与干扰视线的诱饵空闸！',
        tint: '#FEF3C7',
      },
      {
        iconId: 'ui_linked_gear',
        badge: '⚙️',
        title: '绳轮联动双栓',
        desc1: '由麻绳滑轮互连，抽动任意一块会同步抽开伙伴板。',
        desc2: '开栓前常需先闭合另一侧活门截住陪跑异色沙！',
        tint: '#FFEDD5',
      },
      {
        iconId: 'ui_lock_badge',
        badge: '🔒',
        title: '颜色锁 & 🌀 魔法染色环',
        desc1: '颜色锁无法手抽，对应颜色首桶装满瞬间自动崩开；',
        desc2: '流沙穿过染色环会永久改色，拆掉导流桥即可保住原色。',
        tint: '#F3E8FF',
      },
    ];

    const gap = 7;
    const cardH = Math.min(96, Math.floor((h - gap * (items.length - 1)) / items.length));

    items.forEach((it, idx) => {
      const cy = y + idx * (cardH + gap);
      const r: Rect = { x, y: cy, w, h: cardH };
      drawWoodCapsule(ctx, r, tokens, it.tint, tokens.theme.woodDark, 12);

      const icon = assets.get(it.iconId);
      const iconBoxX = r.x + 8;
      const iconBoxY = r.y + (r.h - 40) * 0.5;
      drawWoodCapsule(ctx, { x: iconBoxX, y: iconBoxY, w: 40, h: 40 }, tokens, '#FFF8EC', '#9A6228', 9);
      if (icon) {
        ctx.drawImage(icon, iconBoxX + 4, iconBoxY + 4, 32, 32);
      } else {
        drawOutlinedText(ctx, it.badge, iconBoxX + 20, iconBoxY + 20, `700 18px ${tokens.typography.fontFamily}`, '#5A3A22', '#FFFFFF', 0);
      }

      const tx = r.x + 56;
      drawOutlinedText(
        ctx,
        `${it.badge} ${it.title}`,
        tx,
        r.y + 18,
        `700 12.5px ${tokens.typography.fontFamily}`,
        tokens.theme.inkOutline,
        '#FFFFFF',
        0,
        'left'
      );
      ctx.save();
      ctx.font = `600 10.5px ${tokens.typography.fontFamily}`;
      ctx.fillStyle = tokens.theme.inkSecondary;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.desc1, tx, r.y + cardH * 0.54);
      ctx.fillText(it.desc2, tx, r.y + cardH * 0.8);
      ctx.restore();
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
    const boxes = [
      { id: 'box_white', name: '素白常规盒', rates: '白35% 绿30% 蓝20% 紫10% 金4% 红1%', bg: '#FAF6F0' },
      { id: 'box_purple', name: '炫紫进阶盒', rates: '绿20% 蓝35% 紫28% 金13% 大红4%', bg: '#FAF5FF' },
      { id: 'box_gold', name: '流光黄金盒', rates: '蓝10% 紫35% 金40% 绝世大红15%', bg: '#FFFBEB' },
      { id: 'box_red', name: '至尊大红箱', rates: '传说金45% · 绝世大红高达 55%！', bg: '#FEF2F2' },
      { id: 'box_ice', name: '极寒冰封盒 / 双黄盒', rates: '冰系藏品 2 倍 UP · 双黄盒一次爆双卡！', bg: '#F0F9FF' },
    ];

    const pityH = 82;
    const listH = h - pityH - 8;
    const gap = 6;
    const rowH = Math.min(72, Math.floor((listH - gap * (boxes.length - 1)) / boxes.length));

    boxes.forEach((b, idx) => {
      const ry = y + idx * (rowH + gap);
      const r: Rect = { x, y: ry, w, h: rowH };
      drawWoodCapsule(ctx, r, tokens, b.bg, tokens.theme.woodDark, 10);

      const img = assets.get(b.id);
      if (img) {
        ctx.drawImage(img, r.x + 8, r.y + (r.h - 38) * 0.5, 38, 38);
      }
      drawOutlinedText(
        ctx,
        b.name,
        r.x + 54,
        r.y + rowH * 0.34,
        `700 12px ${tokens.typography.fontFamily}`,
        tokens.theme.inkOutline,
        '#FFFFFF',
        0,
        'left'
      );
      drawOutlinedText(
        ctx,
        b.rates,
        r.x + 54,
        r.y + rowH * 0.72,
        `600 10.5px ${tokens.typography.fontFamily}`,
        tokens.theme.inkSecondary,
        '#FFFFFF',
        0,
        'left'
      );
    });

    // 底部双暗保底与碎片合成规则卡
    const pCard: Rect = { x, y: y + h - pityH, w, h: pityH };
    drawWoodCapsule(ctx, pCard, tokens, '#FEF3C7', '#B45309', 12);
    drawOutlinedText(
      ctx,
      '✨ 良心双保底与碎片合成机制',
      pCard.x + 12,
      pCard.y + 18,
      `700 12px ${tokens.typography.fontFamily}`,
      '#92400E',
      '#FFFFFF',
      0,
      'left'
    );
    ctx.save();
    ctx.font = `600 10.5px ${tokens.typography.fontFamily}`;
    ctx.fillStyle = tokens.theme.inkOutline;
    ctx.textAlign = 'left';
    ctx.fillText('• 连续 15 抽未出金，下一抽必出【金】或【大红】！', pCard.x + 12, pCard.y + 41);
    ctx.fillText('• 连续 40 抽未出红，开启紫/金/红箱必爆【绝世大红】！', pCard.x + 12, pCard.y + 58);
    ctx.fillText('• 重复公仔累加总身价并转碎片：5 碎片必出新 / 25 碎片必出紫金红！', pCard.x + 12, pCard.y + 74);
    ctx.restore();
  }
}
