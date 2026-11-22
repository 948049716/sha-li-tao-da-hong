import { GH, GW } from '../engine/SandGrid';
import type { SandEngine } from '../engine/SandEngine';
import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { UiTokensFile } from '../types/ui';
import {
  drawDoubleRimPlaque,
  drawInkText,
  drawRibbonBanner,
  roundRectPath,
} from './UIHelpers';

/**
 * 第 1 关零弹窗手势引导 & 第 2 关顶栏入库提示气泡（同步高亮中央漏斗接沙桶！）
 */
export class FtueOverlay {
  public level2TipTimerMs = 0;

  public triggerLevel2Tip(): void {
    this.level2TipTimerMs = 2600;
  }

  public update(dtMs: number): void {
    if (this.level2TipTimerMs > 0) {
      this.level2TipTimerMs = Math.max(0, this.level2TipTimerMs - dtMs);
    }
  }

  public isBoardAllowedInFtue(
    engine: SandEngine,
    maxClearedLevel: number,
    boardId: string
  ): boolean {
    if (engine.level.levelId !== 1 || maxClearedLevel > 0) return true;
    const bBottom = engine.boards.find(b => b.id === 'b_bottom');
    if (bBottom && !bBottom.removed) {
      return boardId === 'b_bottom';
    }
    return true;
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
    if (this.level2TipTimerMs > 0 && engine.level.levelId === 2) {
      const alpha = Math.min(1, this.level2TipTimerMs / 400);
      ctx.save();
      ctx.globalAlpha = alpha;
      const pill = layout.netWorthPill;
      const bw = Math.min(284, layout.screenW - 24);
      const bx = Math.max(12, Math.min(layout.screenW - bw - 12, pill.x - 18));
      const by = pill.y + pill.h + 8;
      drawDoubleRimPlaque(ctx, { x: bx, y: by, w: bw, h: 32 }, tokens, {
        variant: 'amber',
        rimThickness: 3,
        radius: 16,
      });
      drawInkText(ctx, '✦ 新公仔已入库！点上方身价牌可逛大红藏馆', bx + bw * 0.5, by + 16.5, tokens, {
        font: `700 11.5px ${tokens.typography.fontFamily}`,
        color: '#4A240B',
        maxWidth: bw - 16,
      });
      ctx.restore();
    }

    if (engine.level.levelId !== 1 || maxClearedLevel > 0 || engine.won) return;

    const bBottom = engine.boards.find(b => b.id === 'b_bottom');
    const bTop = engine.boards.find(b => b.id === 'b_top');
    const targetBoard = bBottom && !bBottom.removed ? bBottom : bTop && !bTop.removed ? bTop : null;
    if (!targetBoard) return;

    const isStep1 = targetBoard.id === 'b_bottom';
    if (!isStep1 && engine.bucketSys.active[0]?.color !== 1) return;

    const ch = layout.chamberRect;
    const sx = ch.w / GW;
    const sy = ch.h / GH;
    const tx = ch.x + ((targetBoard.x0 + targetBoard.x1) * 0.5 + 18) * sx;
    const ty = ch.y + ((targetBoard.y0 + targetBoard.y1) * 0.5) * sy;

    const pulse = Math.sin(timeSec * 6.5);

    ctx.save();
    // 高亮目标木板外框
    const bx0 = ch.x + targetBoard.x0 * sx;
    const bx1 = ch.x + targetBoard.x1 * sx;
    ctx.strokeStyle = tokens.theme.amberGlow;
    ctx.lineWidth = 3;
    ctx.beginPath();
    roundRectPath(ctx, bx0 - 4, ty - 11, bx1 - bx0 + 8, 22, 8);
    ctx.stroke();

    // Step 1 同步轻柔圈亮中央接沙蓝桶，引导玩家一眼理解「看中央桶颜色 -> 抽对应木板」
    if (isStep1) {
      const spoutX = ch.x + ch.w * (74.5 / 150);
      const bucketCy = layout.bucketRowRect.y + layout.bucketRowRect.h * 0.45;
      ctx.save();
      ctx.strokeStyle = '#FBBF24';
      ctx.globalAlpha = 0.55 + 0.3 * pulse;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(spoutX, bucketCy, 44 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const handImg = assets.get('ui_ftue_hand');
    const handY = ty + 6 + pulse * 5;
    if (handImg) {
      ctx.drawImage(handImg, tx - 22, handY, 44, 44);
    }

    const tipText = isStep1
      ? '看中央蓝桶接沙 ▸ 点击抽走这块木栓'
      : '蓝桶满啦 ▸ 抽开上层木栓挖出炫紫盲盒';
    const tipW = Math.min(288, layout.screenW - 52);
    const tipY = Math.max(ch.y + 22, ty - 34);
    drawRibbonBanner(ctx, layout.screenW * 0.5, tipY, tipW, 30, tipText, tokens, 12);
    ctx.restore();
  }
}
