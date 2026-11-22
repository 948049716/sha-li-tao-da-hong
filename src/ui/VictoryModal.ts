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
  totalLevels: number;
  clearTimeSec: number;
  movesCount: number;
  winStreak: number;
  maxClearedLevel: number;
  isNewBest: boolean;
}

/**
 * 日系治愈极简通关结算卡（VictoryModal）：
 * 仅展示纯序号（01~20）、三枚图形战绩卡与极简图标主副按钮（▶ 下一关 / ↻ 重玩）
 */
export class VictoryModal {
  public summary: VictorySummary | null = null;
  private openElapsedMs = 0;

  private nextBtnRect: Rect = { x: 0, y: 0, w: 196, h: 46 };
  private replayBtnRect: Rect = { x: 0, y: 0, w: 46, h: 46 };

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
    const popScale = Math.min(1, 0.88 + 0.12 * Math.min(1, this.openElapsedMs / 180));

    const pw = Math.min(324, W - 32);
    const ph = 278;
    const p: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5, w: pw, h: ph };

    ctx.save();
    ctx.translate(W * 0.5, H * 0.5);
    ctx.scale(popScale, popScale);
    ctx.translate(-W * 0.5, -H * 0.5);

    const ord = String(s.levelId).padStart(2, '0');
    drawParchmentModalFrame(
      ctx,
      W,
      H,
      p,
      `✦ ${ord} ✦`,
      tokens,
      assets,
      'ui_bg_level_drawer'
    );

    const streakText = s.isNewBest
      ? `✦ ${s.winStreak} 连胜 · 新纪录`
      : `✦ ${s.winStreak} 连胜 · ${s.maxClearedLevel}/${s.totalLevels}`;
    drawStatusPill(ctx, p.x + pw * 0.5, p.y + 46, streakText, tokens, {
      bgHex: s.isNewBest ? '#FFF8DD' : '#EFF9F1',
      borderHex: s.isNewBest ? '#B89240' : '#6BA67E',
      textColor: s.isNewBest ? '#7A5A1A' : '#3B6E4C',
      fontSize: 10.5,
      padX: 16,
      height: 22,
    });

    // 三枚极简图形战绩卡（秒表 / 步数 / 进度）
    const padX = 20;
    const gap = 8;
    const cardW = Math.floor((pw - padX * 2 - gap * 2) / 3);
    const cardY = p.y + 76;
    const cardH = 88;

    const stats = [
      { glyph: 'clock' as const, value: `${s.clearTimeSec.toFixed(1)}s`, variant: 'amber' as const },
      { glyph: 'steps' as const, value: `${s.movesCount}`, variant: 'sky' as const },
      { glyph: 'crown' as const, value: `${s.maxClearedLevel}/${s.totalLevels}`, variant: 'mint' as const },
    ];

    stats.forEach((st, idx) => {
      const r: Rect = { x: p.x + padX + idx * (cardW + gap), y: cardY, w: cardW, h: cardH };
      const inner = drawRecessedTileCard(ctx, r, tokens, {
        variant: st.variant,
        radius: 14,
      });
      drawHandDrawnGlyph(ctx, st.glyph, inner.x + inner.w * 0.5, inner.y + 24, 21, tokens);
      drawInkText(ctx, st.value, inner.x + inner.w * 0.5, inner.y + 60, tokens, {
        font: `700 15.5px ${tokens.typography.numeralFontFamily}`,
        color: '#4B403B',
      });
    });

    // 底部极简纯图标双按钮：左侧 ↻ 重玩圆钮 + 右侧呼吸 ▶ 下一关主按钮
    const btnY = p.y + ph - 68;
    const btnH = 46;
    this.replayBtnRect = { x: p.x + padX, y: btnY, w: 48, h: btnH };
    this.nextBtnRect = {
      x: this.replayBtnRect.x + 58,
      y: btnY,
      w: pw - padX * 2 - 58,
      h: btnH,
    };

    drawWoodButton(ctx, this.replayBtnRect, '', tokens, assets, {
      glyph: 'restart',
      iconSize: 21,
    });

    const isChapterFinish = s.levelId >= s.totalLevels;
    const nextOrd = String(isChapterFinish ? 1 : s.levelId + 1).padStart(2, '0');
    drawWoodButton(ctx, this.nextBtnRect, nextOrd, tokens, assets, {
      fillHex: '#15803D',
      glyph: 'play',
      iconSize: 18,
      fontSize: 16,
      pulse: true,
      pulsePhase: timeSec * 5.2,
    });

    ctx.restore();
  }
}
