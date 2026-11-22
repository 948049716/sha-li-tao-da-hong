import { GH, GW } from '../engine/SandGrid';
import type { SandEngine } from '../engine/SandEngine';
import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { Rect, UiTokensFile } from '../types/ui';
import {
  drawDoubleRimPlaque,
  drawInkText,
  drawRibbonBanner,
  roundRectPath,
} from './UIHelpers';

export function computeCandidateColRect(
  layout: ComputedLayout,
  colIdx: number,
  numCols: number
): Rect {
  const area = layout.candidateAreaRect;
  const gap = 8;
  const colW = Math.floor((area.w - gap * (numCols - 1)) / numCols);
  return {
    x: area.x + colIdx * (colW + gap),
    y: area.y + 4,
    w: colW,
    h: area.h - 6,
  };
}

/**
 * 第 1 关零弹窗四步双核手势引导（选蓝桶 -> 选黄桶 -> 抽木栓 -> 选粉桶） & 第 2 关顶栏入库提示气泡
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

    const cols = engine.bucketSys.columns;
    const numCols = engine.bucketSys.numCols;
    const bTop = engine.boards.find(b => b.id === 'b_top');
    const pulse = Math.sin(timeSec * 6.5);
    const handImg = assets.get('ui_ftue_hand');

    // Step 1, 2, 4：引导点选底部候选列前排彩桶送入小卡槽
    let targetCol = -1;
    let colTip = '';
    if ((cols[0]?.length || 0) > 0) {
      targetCol = 0;
      colTip = '点选前排蓝桶 ▸ 送入小卡槽吸空左底沙';
    } else if ((cols[1]?.length || 0) > 0) {
      targetCol = 1;
      colTip = '再点黄桶 ▸ 吸空右侧滤网底沙';
    } else if ((!bTop || bTop.removed) && (cols[2]?.length || 0) > 0) {
      targetCol = 2;
      colTip = '点选粉桶 ▸ 吸尽最后粉沙过关！';
    }

    if (targetCol >= 0) {
      const colRect = computeCandidateColRect(layout, targetCol, numCols);
      const slotRect = layout.activeSlotRects[Math.min(3, engine.bucketSys.occupiedSlotCount)];
      ctx.save();
      ctx.strokeStyle = tokens.theme.amberGlow;
      ctx.lineWidth = 3;
      ctx.beginPath();
      roundRectPath(ctx, colRect.x - 2, colRect.y - 2, colRect.w + 4, Math.min(62, colRect.h), 12);
      ctx.stroke();

      // 同步轻柔圈亮即将落入的上方小卡槽
      if (slotRect) {
        ctx.save();
        ctx.strokeStyle = '#FBBF24';
        ctx.globalAlpha = 0.55 + 0.3 * pulse;
        ctx.lineWidth = 2.2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        roundRectPath(ctx, slotRect.x - 2, slotRect.y - 2, slotRect.w + 4, slotRect.h + 4, 10);
        ctx.stroke();
        ctx.restore();
      }

      if (handImg) {
        const hx = colRect.x + colRect.w * 0.5 - 18;
        const hy = colRect.y + 26 + pulse * 4;
        ctx.drawImage(handImg, hx, hy, 42, 42);
      }

      const tipW = Math.min(296, layout.screenW - 36);
      const tipY = layout.chamberRect.y + layout.chamberRect.h - 38;
      drawRibbonBanner(ctx, layout.screenW * 0.5, tipY, tipW, 30, colTip, tokens, 11.5);
      ctx.restore();
      return;
    }

    // Step 3：底沙清空后，引导抽开上层木栓放出粉沙与炫紫盲盒
    if (bTop && !bTop.removed) {
      const ch = layout.chamberRect;
      const sx = ch.w / GW;
      const sy = ch.h / GH;
      const tx = ch.x + ((bTop.x0 + bTop.x1) * 0.5 + 18) * sx;
      const ty = ch.y + ((bTop.y0 + bTop.y1) * 0.5) * sy;

      ctx.save();
      const bx0 = ch.x + bTop.x0 * sx;
      const bx1 = ch.x + bTop.x1 * sx;
      ctx.strokeStyle = tokens.theme.amberGlow;
      ctx.lineWidth = 3;
      ctx.beginPath();
      roundRectPath(ctx, bx0 - 4, ty - 11, bx1 - bx0 + 8, 22, 8);
      ctx.stroke();

      if (handImg) {
        ctx.drawImage(handImg, tx - 22, ty + 6 + pulse * 5, 44, 44);
      }

      const tipW = Math.min(300, layout.screenW - 36);
      const tipY = Math.max(ch.y + 22, ty - 34);
      drawRibbonBanner(
        ctx,
        layout.screenW * 0.5,
        tipY,
        tipW,
        30,
        '底沙清空啦 ▸ 抽开木栓放出粉沙与炫紫盒',
        tokens,
        11.5
      );
      ctx.restore();
    }
  }
}
