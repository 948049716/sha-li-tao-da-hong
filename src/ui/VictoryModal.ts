import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { Rect, UiTokensFile } from '../types/ui';
import {
  drawHandDrawnGlyph,
  drawInkText,
  drawParchmentModalFrame,
  drawRecessedTileCard,
  drawStatusPill,
  drawWoodButton,
  hitRect,
} from './UIHelpers';

export type VictoryAction = { type: 'NEXT_LEVEL' } | { type: 'REPLAY_LEVEL' };

export interface VictorySummary {
  levelId: number;
  levelTitle: string;
  totalLevels: number;
  clearTimeSec: number;
  movesCount: number;
  winStreak: number;
  maxClearedLevel: number;
  isNewBest: boolean;
}

/**
 * 极简清爽通关结算卡（VictoryModal）：
 * 去除所有复杂开箱抽卡干扰，专注展示清罐用时、操作步数、连胜记录与一键进入下一关
 */
export class VictoryModal {
  public summary: VictorySummary | null = null;
  private openElapsedMs = 0;

  private nextBtnRect: Rect = { x: 0, y: 0, w: 220, h: 46 };
  private replayBtnRect: Rect = { x: 0, y: 0, w: 120, h: 40 };

  public open(summary: VictorySummary): void {
    this.summary = summary;
    this.openElapsedMs = 0;
  }

  public update(dtMs: number): void {
    if (!this.summary) return;
    this.openElapsedMs += dtMs;
  }

  public handleTap(px: number, py: number): VictoryAction | null {
    if (!this.summary || this.openElapsedMs < 180) return null;
    if (hitRect(px, py, this.nextBtnRect)) {
      return { type: 'NEXT_LEVEL' };
    }
    if (hitRect(px, py, this.replayBtnRect)) {
      return { type: 'REPLAY_LEVEL' };
    }
    return null;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    assets: AssetLoader,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    const s = this.summary;
    if (!s) return;

    const W = layout.screenW;
    const H = layout.screenH;
    const popScale = Math.min(1, 0.86 + 0.14 * Math.min(1, this.openElapsedMs / 180));

    const pw = Math.min(336, W - 28);
    const ph = 326;
    const p: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };

    ctx.save();
    ctx.translate(W * 0.5, H * 0.5);
    ctx.scale(popScale, popScale);
    ctx.translate(-W * 0.5, -H * 0.5);

    const isChapterFinish = s.levelId >= s.totalLevels;
    drawParchmentModalFrame(
      ctx,
      W,
      H,
      p,
      isChapterFinish ? '第一章完美通关！' : `第 ${s.levelId} 关 · 清罐通关！`,
      tokens,
      assets,
      'ui_bg_level_drawer'
    );

    // 关卡名与连胜徽标
    drawInkText(ctx, `「${s.levelTitle}」全部彩沙已归桶`, p.x + pw * 0.5, p.y + 44, tokens, {
      font: `800 14px ${tokens.typography.fontFamily}`,
      color: '#3E2311',
    });

    const streakText = s.isNewBest
      ? `连胜 ${s.winStreak} 关 · 刷新最快纪录！`
      : `连胜 ${s.winStreak} 关 · 进度 ${s.maxClearedLevel}/${s.totalLevels}`;
    drawStatusPill(ctx, p.x + pw * 0.5, p.y + 72, streakText, tokens, {
      bgHex: s.isNewBest ? '#FEF3C7' : '#EAF7EC',
      borderHex: s.isNewBest ? '#B45309' : '#3F7D45',
      textColor: s.isNewBest ? '#92400E' : '#235328',
      fontSize: 10.5,
      padX: 14,
      height: 22,
    });

    // 三项清爽战绩卡片（用时 / 操作步数 / 章节进度）
    const padX = 18;
    const gap = 8;
    const cardW = Math.floor((pw - padX * 2 - gap * 2) / 3);
    const cardY = p.y + 98;
    const cardH = 82;

    const stats = [
      { label: '通关用时', value: `${s.clearTimeSec.toFixed(1)}s`, variant: 'amber' as const },
      { label: '操作步数', value: `${s.movesCount} 步`, variant: 'sky' as const },
      { label: '章节进度', value: `${s.maxClearedLevel}/${s.totalLevels}`, variant: 'mint' as const },
    ];

    stats.forEach((st, idx) => {
      const r: Rect = { x: p.x + padX + idx * (cardW + gap), y: cardY, w: cardW, h: cardH };
      const inner = drawRecessedTileCard(ctx, r, tokens, {
        variant: st.variant,
        radius: 12,
        rimWidth: 3.0,
      });
      drawHandDrawnGlyph(
        ctx,
        idx === 0 ? 'sparkle' : idx === 1 ? 'check' : 'crown',
        inner.x + inner.w * 0.5,
        inner.y + 15,
        15,
        tokens
      );
      drawInkText(ctx, st.value, inner.x + inner.w * 0.5, inner.y + 42, tokens, {
        font: `800 15px ${tokens.typography.numeralFontFamily}`,
        color: '#3E2311',
      });
      drawInkText(ctx, st.label, inner.x + inner.w * 0.5, inner.y + inner.h - 11, tokens, {
        font: `700 10px ${tokens.typography.fontFamily}`,
        color: '#6E4728',
      });
    });

    // 主按钮：下一关（呼吸微动）
    const pulse = 1 + Math.sin(timeSec * 5.2) * 0.025;
    const nextW = pw - 44;
    this.nextBtnRect = { x: p.x + 22, y: p.y + ph - 114, w: nextW, h: 48 };
    ctx.save();
    ctx.translate(
      this.nextBtnRect.x + this.nextBtnRect.w * 0.5,
      this.nextBtnRect.y + this.nextBtnRect.h * 0.5
    );
    ctx.scale(pulse, pulse);
    ctx.translate(
      -(this.nextBtnRect.x + this.nextBtnRect.w * 0.5),
      -(this.nextBtnRect.y + this.nextBtnRect.h * 0.5)
    );
    drawWoodButton(
      ctx,
      this.nextBtnRect,
      isChapterFinish ? '回到第 1 关再战 ▶' : `挑战第 ${s.levelId + 1} 关 ▶`,
      tokens,
      assets,
      {
        fillHex: '#15803D',
        fontSize: 15,
      }
    );
    ctx.restore();

    // 副按钮：重玩本关刷更快纪录
    const replayW = Math.min(180, pw - 96);
    this.replayBtnRect = { x: p.x + (pw - replayW) * 0.5, y: p.y + ph - 54, w: replayW, h: 38 };
    drawWoodButton(ctx, this.replayBtnRect, '再玩一次本关', tokens, assets, {
      fillHex: '#D97706',
      fontSize: 12.5,
    });

    ctx.restore();
  }
}
