import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { Rect, UiTokensFile } from '../types/ui';
import {
  drawHandDrawnGlyph,
  drawParchmentModalFrame,
  drawStatusPill,
  drawStorybookNumber,
  drawWatercolorStatCard,
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
 * 1:1 严格还原《通关结算弹窗.webp》设计稿：
 * - 星夜工坊背景 + 飘落暖金发光纸屑与星芒
 * - 双层浅橡木框象牙白结算面板
 * - 顶部大号微倾手写「✦ 08 ✦」+ 暖金发光胶囊「3 连胜 · 新纪录」
 * - 三张手绘水彩晕染竖卡（暖杏橙秒表 / 晴空蓝脚印 / 薄荷绿皇冠）
 * - 底部左方形实木按钮「↻」+ 右宽幅森林绿按钮「▶ 09」
 */
export class VictoryModal {
  public summary: VictorySummary | null = null;
  private openElapsedMs = 0;

  private nextBtnRect: Rect = { x: 0, y: 0, w: 186, h: 50 };
  private replayBtnRect: Rect = { x: 0, y: 0, w: 54, h: 50 };

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
    const popScale = Math.min(1, 0.90 + 0.10 * Math.min(1, this.openElapsedMs / 180));

    const pw = Math.min(298, W - 56);
    const ph = 374;
    const p: Rect = {
      x: Math.round((W - pw) * 0.5),
      y: Math.round((H - ph) * 0.5),
      w: pw,
      h: ph,
    };

    ctx.save();
    ctx.translate(W * 0.5, H * 0.5);
    ctx.scale(popScale, popScale);
    ctx.translate(-W * 0.5, -H * 0.5);

    drawParchmentModalFrame(ctx, W, H, p, '', tokens, assets, 'ui_bg_level_drawer', {
      hideTitleRibbon: true,
    });

    // 背景金色发光飘落亮片
    this.renderFloatingGoldFlakes(ctx, W, H, p, timeSec);

    // 1. 顶部大号微倾序号「✦ 08 ✦」与周边闪烁小星点
    const ord = String(s.levelId).padStart(2, '0');
    const titleY = p.y + 58;
    drawStorybookNumber(ctx, ord, p.x + pw * 0.5, titleY, 54, tokens, {
      color: '#2B190E',
      slant: -0.10,
      boldStroke: 1.2,
    });

    drawHandDrawnGlyph(ctx, 'sparkle', p.x + pw * 0.5 - 50, titleY - 1, 15, tokens);
    drawHandDrawnGlyph(ctx, 'sparkle', p.x + pw * 0.5 + 50, titleY - 1, 15, tokens);

    // 点缀空心小金星
    ctx.save();
    ctx.strokeStyle = '#9E7840';
    ctx.lineWidth = 1.15;
    for (const [ox, oy, sr] of [
      [-72, 9, 6.2],
      [-64, -16, 3.8],
      [72, -14, 6.8],
      [67, 11, 3.8],
    ]) {
      const sx = p.x + pw * 0.5 + ox;
      const sy = titleY + oy;
      ctx.beginPath();
      ctx.moveTo(sx, sy - sr);
      ctx.quadraticCurveTo(sx, sy, sx + sr, sy);
      ctx.quadraticCurveTo(sx, sy, sx, sy + sr);
      ctx.quadraticCurveTo(sx, sy, sx - sr, sy);
      ctx.quadraticCurveTo(sx, sy, sx, sy - sr);
      ctx.stroke();
    }
    ctx.restore();

    // 2. 暖金发光连胜胶囊
    const streakText = s.isNewBest
      ? `${s.winStreak} 连胜 · 新纪录`
      : `${s.winStreak} 连胜 · 通关成功`;
    drawStatusPill(ctx, p.x + pw * 0.5, p.y + 112, streakText, tokens, {
      bgHex: '#F7CE86',
      borderHex: '#9C6B28',
      textColor: '#2B190E',
      fontSize: 13.5,
      padX: 24,
      height: 29,
      glowColor: 'rgba(246, 188, 84, 0.46)',
    });

    // 3. 三张竖向手绘水彩晕染战绩卡（秒表 / 脚印 / 皇冠）
    const padX = 22;
    const gap = 11;
    const cardW = Math.floor((pw - padX * 2 - gap * 2) / 3);
    const cardY = p.y + 150;
    const cardH = 114;

    const stats: {
      glyph: 'clock' | 'steps' | 'crown';
      value: string;
      tone: 'amber' | 'sky' | 'mint';
    }[] = [
      { glyph: 'clock', value: `${s.clearTimeSec.toFixed(1)}s`, tone: 'amber' },
      { glyph: 'steps', value: `${s.movesCount}`, tone: 'sky' },
      {
        glyph: 'crown',
        value: `${String(s.maxClearedLevel).padStart(2, '0')}/${s.totalLevels}`,
        tone: 'mint',
      },
    ];

    stats.forEach((st, idx) => {
      const r: Rect = { x: p.x + padX + idx * (cardW + gap), y: cardY, w: cardW, h: cardH };
      drawWatercolorStatCard(ctx, r, st.tone);
      drawHandDrawnGlyph(ctx, st.glyph, r.x + r.w * 0.5, r.y + 42, 31, tokens);
      drawStorybookNumber(
        ctx,
        st.value,
        r.x + r.w * 0.5,
        r.y + 88,
        st.value.length >= 5 ? 18 : 21.5,
        tokens,
        {
          slant: -0.07,
          embossColor: 'rgba(255,255,255,0.45)',
        }
      );
    });

    // 4. 底部左方形实木重玩钮「↻」+ 右宽幅森林绿主按钮「▶ 09」
    const btnY = p.y + ph - 78;
    const btnH = 54;
    const replayW = 60;
    this.replayBtnRect = { x: p.x + padX, y: btnY, w: replayW, h: btnH };
    this.nextBtnRect = {
      x: this.replayBtnRect.x + replayW + 12,
      y: btnY,
      w: pw - padX * 2 - replayW - 12,
      h: btnH,
    };

    drawWoodButton(ctx, this.replayBtnRect, '', tokens, assets, {
      glyph: 'restart',
      iconSize: 24,
      radius: 11,
    });

    const isChapterFinish = s.levelId >= s.totalLevels;
    const nextOrd = String(isChapterFinish ? 1 : s.levelId + 1).padStart(2, '0');
    drawWoodButton(ctx, this.nextBtnRect, nextOrd, tokens, assets, {
      fillHex: '#1F7A44',
      glyph: 'play',
      iconSize: 17,
      fontSize: 27,
      radius: 11,
      slantLabel: true,
      pulse: true,
      pulsePhase: timeSec * 5.2,
    });

    ctx.restore();
  }

  private renderFloatingGoldFlakes(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    panel: Rect,
    timeSec: number
  ): void {
    ctx.save();
    const count = 18;
    for (let i = 0; i < count; i++) {
      const fx = ((i * 73 + 19) % 92 + 4) / 100;
      const fy = (((i * 41 + timeSec * 14) % 94) + 3) / 100;
      const px = W * fx;
      const py = H * fy;
      if (
        px > panel.x - 4 &&
        px < panel.x + panel.w + 4 &&
        py > panel.y - 4 &&
        py < panel.y + panel.h + 4
      ) {
        continue;
      }
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(timeSec * 1.4 + i);
      const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
      glow.addColorStop(0, 'rgba(255, 226, 138, 0.55)');
      glow.addColorStop(1, 'rgba(255, 210, 96, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = i % 2 === 0 ? '#FFE8A3' : '#F8CA64';
      ctx.globalAlpha = 0.88;
      ctx.fillRect(-5.2, -2.8, 10.4, 5.6);
      ctx.restore();
    }
    ctx.restore();
  }
}
