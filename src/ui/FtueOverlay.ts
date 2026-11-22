import { GH, GW } from '../engine/SandGrid';
import type { SandEngine } from '../engine/SandEngine';
import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { SaveManager } from '../systems/SaveManager';
import type { Rect, UiTokensFile } from '../types/ui';
import { drawDoubleRimPlaque, drawInkText, drawRibbonBanner, roundRectPath } from './UIHelpers';

export function computeCandidateColRect(
  layout: ComputedLayout,
  colIdx: number,
  numCols: number
): Rect {
  const area = layout.candidateAreaRect;
  const gap = 7;
  const colW = Math.floor((area.w - gap * (numCols - 1)) / numCols);
  return {
    x: area.x + colIdx * (colW + gap),
    y: area.y + 3,
    w: colW,
    h: area.h - 5,
  };
}

export interface SpotlightGuideStep {
  id: string;
  targetRect: Rect;
  secondaryRect?: Rect;
  title: string;
  desc: string;
}

/**
 * 双轨新手与新道具/新机关聚光灯手势引导系统（FtueOverlay）：
 * 1. 第 1 关：零弹窗四步手势直觉引导（选蓝瓶 -> 选黄瓶 -> 抽浅枫木拨片 -> 选粉瓶）
 * 2. 第 2~11 关：每次解锁新道具（撤回/+瓶位/磁吸/洗牌）或首次出现新机关时，弹出极简聚光灯镂空手势提示（轻点任意处即刻收起并持久化记录）
 */
export class FtueOverlay {
  private activeSpotlights: SpotlightGuideStep[] = [];

  public get hasActiveSpotlight(): boolean {
    return this.activeSpotlights.length > 0;
  }

  public clearSpotlights(): void {
    this.activeSpotlights = [];
  }

  /**
   * 进入关卡时按当前关卡检测尚未展示过的新机关与新道具聚光灯指引
   */
  public syncLevelSpotlights(
    engine: SandEngine,
    layout: ComputedLayout,
    saveMgr: SaveManager
  ): void {
    this.activeSpotlights = [];
    const lvlId = engine.level.levelId;
    if (lvlId <= 1) return;

    const ch = layout.chamberRect;
    const sy = ch.h / GH;
    const queue: SpotlightGuideStep[] = [];

    const pushIfUnseen = (step: SpotlightGuideStep) => {
      if (!saveMgr.hasSeenGuide(step.id)) {
        queue.push(step);
      }
    };

    if (lvlId === 2) {
      pushIfUnseen({
        id: 'mech_l2_slot_parking',
        targetRect: {
          x: layout.slotRowRect.x + 8,
          y: layout.slotRowRect.y - 2,
          w: layout.slotRowRect.w - 16,
          h: layout.slotRowRect.h + layout.candidateAreaRect.h * 0.45,
        },
        title: '空位暂存 · 巧取后排',
        desc: '上方空位可暂存前排玻璃瓶，先露出后排同色瓶清空底沙',
      });
      pushIfUnseen({
        id: 'prop_l2_undo_slot',
        targetRect: layout.propButtons[0],
        secondaryRect: layout.propButtons[2],
        title: '新道具解锁：撤回 & +加瓶位',
        desc: '左钮可回退上一步操作；第 3 钮可临时开启第 5 个接沙瓶位',
      });
    } else if (lvlId === 3) {
      const linkBd = engine.boards.find(b => Boolean(b.linkedTo));
      if (linkBd) {
        const by = ch.y + ((linkBd.y0 + linkBd.y1) * 0.5) * sy;
        pushIfUnseen({
          id: 'mech_l3_linked',
          targetRect: { x: ch.x + 12, y: by - 18, w: ch.w - 24, h: 36 },
          title: '新机关：丝线联动拨片',
          desc: '香槟丝线相连的两枚拨片，轻抽任意一枚将同步拉开',
        });
      }
      pushIfUnseen({
        id: 'prop_l3_magnet',
        targetRect: layout.propButtons[1],
        title: '新道具解锁：隔空磁吸',
        desc: '卡位受阻时点按磁铁，可直接从沙盘吸满 1 只在槽玻璃瓶腾位',
      });
    } else if (lvlId === 4) {
      const iceZ = engine.level.sandZones.find(z => z.frozen);
      const iy = iceZ && iceZ.y0 !== undefined ? ch.y + iceZ.y0 * sy - 6 : ch.y + 18;
      pushIfUnseen({
        id: 'mech_l4_brittle_ice',
        targetRect: { x: ch.x + 16, y: iy, w: ch.w * 0.48, h: 56 },
        title: '新机关：高空脆冰',
        desc: '须先排空下方软沙垫，让冰砖高空直落硬滤网才会震碎化沙',
      });
      pushIfUnseen({
        id: 'prop_l4_shuffle',
        targetRect: layout.propButtons[3],
        title: '新道具解锁：候选洗牌',
        desc: '点按双流线洗牌钮，可重新排列下方玻璃瓶的前后顺序',
      });
    } else if (lvlId === 5) {
      const lockBd = engine.boards.find(b => Boolean(b.lockColor));
      const ly = lockBd ? ch.y + lockBd.y0 * sy - 18 : ch.y + ch.h * 0.4;
      pushIfUnseen({
        id: 'mech_l5_lock_gold',
        targetRect: { x: ch.x + 24, y: ly, w: ch.w - 48, h: 38 },
        title: '新机关：颜色锁 & 星耀金沙',
        desc: '装满同色玻璃瓶即自动解开颜色锁；星耀金沙可注入任意瓶',
      });
    } else if (lvlId === 7) {
      const c0 = computeCandidateColRect(layout, 0, engine.bucketSys.numCols);
      pushIfUnseen({
        id: 'mech_l7_mystery',
        targetRect: { x: c0.x - 2, y: c0.y + 18, w: layout.candidateAreaRect.w * 0.52, h: c0.h - 18 },
        title: '新元素：雾面问号玻璃瓶',
        desc: '取走前排玻璃瓶后，后排「?」雾面瓶会自动翻面显露丝带色',
      });
    } else if (lvlId === 8) {
      const slantBd = engine.boards.find(b => b.kind === 'slant');
      const sy0 = slantBd ? ch.y + Math.min(slantBd.y0, slantBd.y1) * sy - 8 : ch.y + ch.h * 0.4;
      pushIfUnseen({
        id: 'mech_l8_dye_slant',
        targetRect: { x: ch.x + 18, y: sy0, w: ch.w - 32, h: 92 },
        title: '新机关：染色环 & 可抽斜拨片',
        desc: '彩沙穿环永久改色；带圆环的浅枫木斜拨片可随时抽走断流',
      });
    } else if (lvlId === 11) {
      pushIfUnseen({
        id: 'mech_l11_iced_bottle',
        targetRect: {
          x: layout.candidateAreaRect.x,
          y: layout.candidateAreaRect.y + 16,
          w: layout.candidateAreaRect.w,
          h: layout.candidateAreaRect.h - 16,
        },
        title: '新元素：冰晶玻璃瓶',
        desc: '每当任意 1 只玻璃瓶装满离场，所有冰晶瓶同步震裂 1 层寒冰',
      });
    }

    this.activeSpotlights = queue;
  }

  /**
   * 拦截聚光灯引导点击：轻点任意处即关闭当前引导步并持久化已读标记
   */
  public handleSpotlightTap(saveMgr: SaveManager): boolean {
    if (this.activeSpotlights.length === 0) return false;
    const cur = this.activeSpotlights.shift();
    if (cur) {
      saveMgr.markGuideSeen(cur.id);
    }
    return true;
  }

  public isColumnAllowedInFtue(
    engine: SandEngine,
    maxClearedLevel: number,
    colIdx: number
  ): boolean {
    if (engine.level.levelId !== 1 || maxClearedLevel > 0) return true;
    const cols = engine.bucketSys.columns;
    if ((cols[0]?.length || 0) > 0) return colIdx === 0;
    if ((cols[1]?.length || 0) > 0) return colIdx === 1;
    const bTop = engine.boards.find(b => b.id === 'b_top');
    if (bTop && !bTop.removed) return false;
    return colIdx === 2;
  }

  public isBoardAllowedInFtue(
    engine: SandEngine,
    maxClearedLevel: number,
    boardId: string
  ): boolean {
    if (engine.level.levelId !== 1 || maxClearedLevel > 0) return true;
    const cols = engine.bucketSys.columns;
    if ((cols[0]?.length || 0) > 0 || (cols[1]?.length || 0) > 0) {
      return false;
    }
    return boardId === 'b_top';
  }

  public render(
    ctx: CanvasRenderingContext2D,
    engine: SandEngine,
    maxClearedLevel: number,
    layout: ComputedLayout,
    assets: AssetLoader,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    if (engine.won) return;

    // 优先渲染第 2~11 关的新道具/新机关聚光灯手势引导
    if (this.activeSpotlights.length > 0) {
      this.renderSpotlightStep(ctx, this.activeSpotlights[0], layout, assets, tokens, timeSec);
      return;
    }

    if (engine.level.levelId !== 1 || maxClearedLevel > 0) return;

    const cols = engine.bucketSys.columns;
    const numCols = engine.bucketSys.numCols;
    const bTop = engine.boards.find(b => b.id === 'b_top');
    const pulse = Math.sin(timeSec * 6.0);
    const handImg = assets.get('ui_ftue_hand');

    let targetCol = -1;
    let colTip = '';
    if ((cols[0]?.length || 0) > 0) {
      targetCol = 0;
      colTip = '轻点蓝丝带玻璃瓶 ▸ 吸空左侧底沙';
    } else if ((cols[1]?.length || 0) > 0) {
      targetCol = 1;
      colTip = '再点黄丝带玻璃瓶 ▸ 吸空右侧底沙';
    } else if ((!bTop || bTop.removed) && (cols[2]?.length || 0) > 0) {
      targetCol = 2;
      colTip = '点选粉丝带玻璃瓶 ▸ 收集最后粉沙';
    }

    if (targetCol >= 0) {
      const colRect = computeCandidateColRect(layout, targetCol, numCols);
      const slotRect = layout.activeSlotRects[Math.min(3, engine.bucketSys.occupiedSlotCount)];
      ctx.save();
      ctx.strokeStyle = '#F6CE6C';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      roundRectPath(ctx, colRect.x - 2, colRect.y - 2, colRect.w + 4, Math.min(58, colRect.h), 14);
      ctx.stroke();

      if (slotRect) {
        ctx.save();
        ctx.strokeStyle = '#F6CE6C';
        ctx.globalAlpha = 0.52 + 0.28 * pulse;
        ctx.lineWidth = 2.0;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        roundRectPath(ctx, slotRect.x - 2, slotRect.y - 2, slotRect.w + 4, slotRect.h + 4, 13);
        ctx.stroke();
        ctx.restore();
      }

      this.drawPointerHand(
        ctx,
        handImg,
        colRect.x + colRect.w * 0.5,
        colRect.y + 28 + pulse * 4
      );

      const tipW = Math.min(276, layout.screenW - 40);
      const tipY = layout.chamberRect.y + layout.chamberRect.h - 36;
      drawRibbonBanner(ctx, layout.screenW * 0.5, tipY, tipW, 28, colTip, tokens, 11.5);
      ctx.restore();
      return;
    }

    if (bTop && !bTop.removed) {
      const ch = layout.chamberRect;
      const sx = ch.w / GW;
      const sy = ch.h / GH;
      const tx = ch.x + ((bTop.x0 + bTop.x1) * 0.5 + 18) * sx;
      const ty = ch.y + ((bTop.y0 + bTop.y1) * 0.5) * sy;

      ctx.save();
      const bx0 = ch.x + bTop.x0 * sx;
      const bx1 = ch.x + bTop.x1 * sx;
      ctx.strokeStyle = '#F6CE6C';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      roundRectPath(ctx, bx0 - 4, ty - 10, bx1 - bx0 + 8, 20, 9);
      ctx.stroke();

      this.drawPointerHand(ctx, handImg, tx, ty + 8 + pulse * 5);

      const tipW = Math.min(268, layout.screenW - 40);
      const tipY = Math.max(ch.y + 22, ty - 32);
      drawRibbonBanner(
        ctx,
        layout.screenW * 0.5,
        tipY,
        tipW,
        28,
        '底沙已清 ▸ 轻抽浅枫木拨片落下粉沙',
        tokens,
        11.5
      );
      ctx.restore();
    }
  }

  private renderSpotlightStep(
    ctx: CanvasRenderingContext2D,
    step: SpotlightGuideStep,
    layout: ComputedLayout,
    assets: AssetLoader,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    const W = layout.screenW;
    const H = layout.screenH;
    const pulse = Math.sin(timeSec * 5.6);
    const pad = 6;
    const r1: Rect = {
      x: step.targetRect.x - pad,
      y: step.targetRect.y - pad,
      w: step.targetRect.w + pad * 2,
      h: step.targetRect.h + pad * 2,
    };
    const r2 = step.secondaryRect
      ? {
          x: step.secondaryRect.x - pad,
          y: step.secondaryRect.y - pad,
          w: step.secondaryRect.w + pad * 2,
          h: step.secondaryRect.h + pad * 2,
        }
      : null;

    ctx.save();
    // 1. 奇偶环绕半透明星夜柔光遮罩（精准镂空高亮目标）
    ctx.fillStyle = 'rgba(22, 26, 44, 0.52)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    roundRectPath(ctx, r1.x, r1.y, r1.w, r1.h, 16);
    if (r2) {
      roundRectPath(ctx, r2.x, r2.y, r2.w, r2.h, 16);
    }
    ctx.fill('evenodd');

    // 2. 呼吸星芒聚焦框
    for (const box of r2 ? [r1, r2] : [r1]) {
      ctx.strokeStyle = '#FCE295';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      roundRectPath(ctx, box.x - pulse * 1.5, box.y - pulse * 1.5, box.w + pulse * 3, box.h + pulse * 3, 17);
      ctx.stroke();
    }

    // 3. 轻绘手势指引
    const handImg = assets.get('ui_ftue_hand');
    const handX = r1.x + r1.w * 0.5;
    const targetInBottomHalf = r1.y > H * 0.58;
    const handY = targetInBottomHalf ? r1.y - 18 + pulse * 4 : r1.y + r1.h + 10 + pulse * 4;
    this.drawPointerHand(ctx, handImg, handX, handY);

    // 4. 极简磨砂奶油说明卡
    const cardW = Math.min(316, W - 28);
    const cardH = 74;
    const cardX = (W - cardW) * 0.5;
    const cardY = targetInBottomHalf
      ? Math.max(layout.topHudY + 46, r1.y - cardH - 34)
      : Math.min(H - cardH - 28, r1.y + r1.h + 44);

    drawDoubleRimPlaque(ctx, { x: cardX, y: cardY, w: cardW, h: cardH }, tokens, {
      variant: 'parchment',
      radius: 18,
    });

    drawInkText(ctx, `✦ ${step.title}`, cardX + cardW * 0.5, cardY + 21, tokens, {
      font: `700 13px ${tokens.typography.fontFamily}`,
      color: '#4B403B',
      maxWidth: cardW - 24,
    });
    drawInkText(ctx, step.desc, cardX + cardW * 0.5, cardY + 43, tokens, {
      font: `600 11px ${tokens.typography.fontFamily}`,
      color: '#6B5D55',
      maxWidth: cardW - 24,
    });
    drawInkText(ctx, '轻点任意处继续', cardX + cardW * 0.5, cardY + 61, tokens, {
      font: `600 9.5px ${tokens.typography.fontFamily}`,
      color: '#9A8B82',
    });

    ctx.restore();
  }

  private drawPointerHand(
    ctx: CanvasRenderingContext2D,
    handImg: HTMLImageElement | null,
    cx: number,
    cy: number
  ): void {
    if (handImg) {
      ctx.drawImage(handImg, cx - 20, cy - 8, 40, 40);
      return;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#FFFDF9';
    ctx.strokeStyle = '#5A4D46';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 8, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
