import type { UiTokensFile } from '../types/ui';
import { drawOutlinedText, drawWoodCapsule } from './UIHelpers';

export class ToastOverlay {
  private message = '';
  private timerMs = 0;

  public show(msg: string, durationMs = 1700): void {
    this.message = msg;
    this.timerMs = durationMs;
  }

  public update(dtMs: number): void {
    if (this.timerMs > 0) {
      this.timerMs = Math.max(0, this.timerMs - dtMs);
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    screenW: number,
    screenH: number,
    tokens: UiTokensFile
  ): void {
    if (this.timerMs <= 0 || !this.message) return;
    const alpha = Math.min(1, this.timerMs / 250);
    ctx.save();
    ctx.globalAlpha = alpha;
    const tw = Math.min(screenW - 28, Math.max(180, this.message.length * 13 + 28));
    const th = 36;
    const tx = (screenW - tw) * 0.5;
    const ty = screenH * 0.14;
    drawWoodCapsule(ctx, { x: tx, y: ty, w: tw, h: th }, tokens, '#3B2514', '#1F1209', 18);
    drawOutlinedText(
      ctx,
      this.message,
      screenW * 0.5,
      ty + th * 0.5,
      `700 12px ${tokens.typography.fontFamily}`,
      '#FFF8EC',
      '#1F1209',
      2
    );
    ctx.restore();
  }
}
