import { GH, GW } from '../engine/SandGrid';
import type { SandEngine } from '../engine/SandEngine';
import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { UiTokensFile } from '../types/ui';
import { drawOutlinedText, drawWoodCapsule } from './UIHelpers';

/**
 * 第 1 关五步零弹窗强手势引导 & 第 2 关顶栏入库提示气泡（严格对齐 PRD §6.2 界面三）
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

  /**
   * 第 1 关首步防误点保护：未通关第 1 关时，第 1 步仅允许点击下层蓝沙木板 b_bottom
   */
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
    // 第 2 关开头顶栏身价胶囊引导小气泡
    if (this.level2TipTimerMs > 0 && engine.level.levelId === 2) {
      const alpha = Math.min(1, this.level2TipTimerMs / 400);
      ctx.save();
      ctx.globalAlpha = alpha;
      const pill = layout.netWorthPill;
      const bw = Math.min(276, layout.screenW - 24);
      const bx = Math.max(12, Math.min(layout.screenW - bw - 12, pill.x - 16));
      const by = pill.y + pill.h + 8;
      drawWoodCapsule(ctx, { x: bx, y: by, w: bw, h: 32 }, tokens, '#FFF8EC', tokens.theme.woodDark, 10);
      drawOutlinedText(
        ctx,
        '✨ 新公仔已入库！点上方身价可逛大红藏馆',
        bx + bw * 0.5,
        by + 16,
        `700 12px ${tokens.typography.fontFamily}`,
        tokens.theme.inkOutline,
        '#FFFFFF',
        0
      );
      ctx.restore();
    }

    if (engine.level.levelId !== 1 || maxClearedLevel > 0 || engine.won) return;

    const bBottom = engine.boards.find(b => b.id === 'b_bottom');
    const bTop = engine.boards.find(b => b.id === 'b_top');
    const targetBoard = bBottom && !bBottom.removed ? bBottom : bTop && !bTop.removed ? bTop : null;
    if (!targetBoard) return;

    const isStep1 = targetBoard.id === 'b_bottom';
    // Step 2 等待蓝桶装满切换粉桶后再提示抽上板
    if (!isStep1 && engine.bucketSys.active[0]?.color !== 1) return;

    const ch = layout.chamberRect;
    const sx = ch.w / GW;
    const sy = ch.h / GH;
    const tx = ch.x + ((targetBoard.x0 + targetBoard.x1) * 0.5 + 18) * sx;
    const ty = ch.y + ((targetBoard.y0 + targetBoard.y1) * 0.5) * sy;

    const pulse = Math.sin(timeSec * 6.5);

    ctx.save();
    // 高亮目标木板外框与底部当前激活桶
    const bx0 = ch.x + targetBoard.x0 * sx;
    const bx1 = ch.x + targetBoard.x1 * sx;
    ctx.strokeStyle = tokens.theme.amberGlow;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(bx0 - 4, ty - 11, bx1 - bx0 + 8, 22, 8);
    ctx.stroke();

    // 绘制小手图标上下轻点动效
    const handImg = assets.get('ui_ftue_hand');
    const handY = ty + 6 + pulse * 5;
    if (handImg) {
      ctx.drawImage(handImg, tx - 22, handY, 44, 44);
    } else {
      drawOutlinedText(ctx, '👆', tx, handY + 18, '28px sans-serif', '#FFF8EC', tokens.theme.inkOutline, 2);
    }

    // 暖羊皮纸提示条
    const tipText = isStep1
      ? '看底部需要蓝沙 👉 点击抽走这块木板！'
      : '太棒了！抽开上层木板，把发光紫盲盒挖出来！';
    const tipW = Math.min(312, layout.screenW - 28);
    const tipX = (layout.screenW - tipW) * 0.5;
    const tipY = Math.max(ch.y + 8, ty - 48);

    drawWoodCapsule(ctx, { x: tipX, y: tipY, w: tipW, h: 32 }, tokens, '#FFF8EC', tokens.theme.woodDark, 12);
    drawOutlinedText(
      ctx,
      tipText,
      tipX + tipW * 0.5,
      tipY + 16,
      `700 12.5px ${tokens.typography.fontFamily}`,
      tokens.theme.inkOutline,
      '#FFFFFF',
      0
    );
    ctx.restore();
  }
}
