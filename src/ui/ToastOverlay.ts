import type { UiTokensFile } from '../types/ui';
import { drawDoubleRimPlaque, drawPlaqueText } from './UIHelpers';

export class ToastOverlay {
  private message = '';
  private timerMs = 0;
  private totalMs = 1650;

  public show(msg: string, durationMs = 1650): void {
    this.message = msg;
    this.timerMs = durationMs;
    this.totalMs = Math.max(300, durationMs);
  }

  public update(dtMs: number): void {
    if (this.timerMs > 0) {
      this.timerMs = Math.max(0, this.timerMs - dtMs);
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    screenW: number,
    topAnchorY: number,
    tokens: UiTokensFile
  ): void {
    if (this.timerMs <= 0 || !this.message) return;
    const elapsed = this.totalMs - this.timerMs;
    const enterT = Math.min(1, elapsed / 140);
    const exitAlpha = Math.min(1, this.timerMs / 240);
    const liftY = (1 - enterT) * -6;

    const cleanMsg = this.message
      .replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '✦ ');

    ctx.save();
    ctx.globalAlpha = exitAlpha * enterT;
    const font = `600 13px ${tokens.typography.fontFamily}`;
    ctx.font = font;
    const measuredW = ctx.measureText(cleanMsg).width;
    const tw = Math.min(screenW - 28, Math.max(176, Math.ceil(measuredW + 36)));
    const th = 36;
    const tx = (screenW - tw) * 0.5;
    const ty = topAnchorY + 8 + liftY;

    drawDoubleRimPlaque(ctx, { x: tx, y: ty, w: tw, h: th }, tokens, {
      variant: 'walnut',
      radius: 18,
    });
    drawPlaqueText(ctx, cleanMsg, screenW * 0.5, ty + th * 0.5 + 0.5, tokens, {
      font,
      fill: '#FFF8EA',
      stroke: 'rgba(38, 22, 10, 0.78)',
      strokeWidth: 1.5,
      maxWidth: tw - 22,
    });
    ctx.restore();
  }
}
