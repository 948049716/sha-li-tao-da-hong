import type { SpriteProvider } from '../engine/SandRenderer';
import { roundRectPath } from '../platform/CanvasPolyfill';
import type { Rect, UiTokensFile } from '../types/ui';

export { roundRectPath };

export function hitRect(px: number, py: number, r: Rect | null | undefined): boolean {
  if (!r) return false;
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function formatNetWorth(val: number): string {
  if (val >= 100000000) {
    return `${(val / 100000000).toFixed(2)}亿`;
  }
  if (val >= 10000) {
    const wan = val / 10000;
    return wan >= 100 ? `${Math.round(wan).toLocaleString()}万` : `${wan.toFixed(1).replace(/\.0$/, '')}万`;
  }
  return Math.round(val).toLocaleString();
}

export function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fillHex: string,
  strokeHex = '#5A3A22',
  strokeWidth = 2.5,
  align: CanvasTextAlign = 'center',
  baseline: CanvasTextBaseline = 'middle'
): void {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = 'round';
  if (strokeWidth > 0) {
    ctx.strokeStyle = strokeHex;
    ctx.lineWidth = strokeWidth;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fillHex;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function drawWoodCapsule(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile,
  bgHex = tokens.theme.woodPrimary,
  lipHex = tokens.theme.woodDark,
  radius = 12
): void {
  ctx.save();
  // 底部实心深木厚度边
  ctx.fillStyle = lipHex;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y + 2.5, r.w, r.h, radius);
  ctx.fill();

  // 主体胶囊面
  ctx.fillStyle = bgHex;
  ctx.strokeStyle = tokens.theme.inkOutline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.fill();
  ctx.stroke();

  // 上沿暖高光细线
  ctx.strokeStyle = tokens.theme.woodHighlight;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(r.x + radius, r.y + 2.2);
  ctx.lineTo(r.x + r.w - radius, r.y + 2.2);
  ctx.stroke();
  ctx.restore();
}

export interface WoodButtonOptions {
  pressed?: boolean;
  disabled?: boolean;
  pulse?: boolean;
  pulsePhase?: number;
  fillHex?: string;
  textColor?: string;
  fontSize?: number;
  icon?: CanvasImageSource | null;
  iconSize?: number;
  badgeText?: string;
  badgeBgHex?: string;
  subLabel?: string;
}

export function drawWoodButton(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  tokens: UiTokensFile,
  sprites: SpriteProvider,
  opts: WoodButtonOptions = {}
): void {
  ctx.save();
  const cx = r.x + r.w * 0.5;
  const cy = r.y + r.h * 0.5;

  let scale = 1;
  let dy = 0;
  if (opts.disabled) {
    ctx.globalAlpha = tokens.motion.disabledAlpha;
  } else if (opts.pressed) {
    scale = tokens.motion.buttonPressScale;
    dy = 2;
  } else if (opts.pulse) {
    const p = Math.sin(opts.pulsePhase || 0);
    scale = 1 + 0.035 * p;
    ctx.save();
    ctx.strokeStyle = tokens.theme.amberGlow;
    ctx.globalAlpha = 0.55 + 0.35 * p;
    ctx.lineWidth = 3;
    ctx.beginPath();
    roundRectPath(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 14);
    ctx.stroke();
    ctx.restore();
  }

  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  const localRect: Rect = { x: -r.w * 0.5, y: -r.h * 0.5, w: r.w, h: r.h };

  const woodTex = !opts.fillHex ? sprites.get('ui_btn_wood') : null;
  if (woodTex && r.w >= 96 && r.h <= 64) {
    ctx.drawImage(woodTex, localRect.x - 2, localRect.y - 2, localRect.w + 4, localRect.h + 4);
  } else {
    drawWoodCapsule(
      ctx,
      localRect,
      tokens,
      opts.fillHex || tokens.theme.woodPrimary,
      tokens.theme.woodDark,
      12
    );
  }

  const fSize = opts.fontSize || 13;
  const font = `700 ${fSize}px ${tokens.typography.fontFamily}`;
  const textCol = opts.textColor || '#FFF8EC';

  if (opts.icon && opts.subLabel === undefined && r.h >= 50 && r.w <= 96) {
    // 上图标 + 下文字（局内底部 4 道具栏样式）
    const isz = opts.iconSize || 28;
    ctx.drawImage(opts.icon, -isz * 0.5, localRect.y + 5, isz, isz);
    drawOutlinedText(ctx, label, 0, localRect.y + localRect.h - 11, `700 11px ${tokens.typography.fontFamily}`, textCol, tokens.theme.inkOutline, 2);
  } else if (opts.icon) {
    const isz = opts.iconSize || 22;
    ctx.drawImage(opts.icon, localRect.x + 10, -isz * 0.5, isz, isz);
    drawOutlinedText(ctx, label, isz * 0.42, 0, font, textCol, tokens.theme.inkOutline, 2.4);
  } else if (opts.subLabel) {
    drawOutlinedText(ctx, label, 0, -7, font, textCol, tokens.theme.inkOutline, 2.4);
    drawOutlinedText(
      ctx,
      opts.subLabel,
      0,
      10,
      `600 10px ${tokens.typography.fontFamily}`,
      '#FFF8EC',
      tokens.theme.inkOutline,
      1.8
    );
  } else {
    drawOutlinedText(ctx, label, 0, 0, font, textCol, tokens.theme.inkOutline, 2.4);
  }

  // 右上角激励微角标（免费 X/3 / 分享领 / 已满）
  if (opts.badgeText) {
    const bw = Math.max(40, opts.badgeText.length * 8 + 8);
    const bh = 16;
    const bx = localRect.x + localRect.w - bw + 4;
    const by = localRect.y - 5;
    ctx.fillStyle = opts.badgeBgHex || '#10B981';
    ctx.strokeStyle = tokens.theme.inkOutline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundRectPath(ctx, bx, by, bw, bh, 8);
    ctx.fill();
    ctx.stroke();
    drawOutlinedText(
      ctx,
      opts.badgeText,
      bx + bw * 0.5,
      by + bh * 0.5 + 0.5,
      `700 9.5px ${tokens.typography.fontFamily}`,
      '#FFFFFF',
      tokens.theme.inkOutline,
      1.4
    );
  }

  ctx.restore();
}

export function drawParchmentModalFrame(
  ctx: CanvasRenderingContext2D,
  screenW: number,
  screenH: number,
  panelRect: Rect,
  title: string,
  tokens: UiTokensFile,
  sprites: SpriteProvider,
  bgSpriteId?: string
): void {
  ctx.save();
  ctx.fillStyle = tokens.theme.modalBackdrop;
  ctx.fillRect(0, 0, screenW, screenH);

  // 羊皮纸主底板 + 深木厚度框
  ctx.fillStyle = tokens.theme.woodDark;
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x, panelRect.y + 5, panelRect.w, panelRect.h, 20);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x, panelRect.y, panelRect.w, panelRect.h, 20);
  ctx.clip();

  ctx.fillStyle = tokens.theme.parchmentBg;
  ctx.fillRect(panelRect.x, panelRect.y, panelRect.w, panelRect.h);

  const bgImg = bgSpriteId ? sprites.get(bgSpriteId) : null;
  if (bgImg) {
    ctx.globalAlpha = 0.24;
    ctx.drawImage(bgImg, panelRect.x, panelRect.y, panelRect.w, panelRect.h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  ctx.strokeStyle = tokens.theme.woodPrimary;
  ctx.lineWidth = 6;
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x + 2, panelRect.y + 2, panelRect.w - 4, panelRect.h - 4, 18);
  ctx.stroke();

  ctx.strokeStyle = tokens.theme.inkOutline;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x, panelRect.y, panelRect.w, panelRect.h, 20);
  ctx.stroke();

  // 顶部蜂蜜木标题横牌
  const plaqueW = Math.min(panelRect.w - 44, Math.max(188, title.length * 20 + 36));
  const plaqueRect: Rect = {
    x: panelRect.x + (panelRect.w - plaqueW) * 0.5,
    y: panelRect.y - 16,
    w: plaqueW,
    h: 38,
  };
  drawWoodCapsule(ctx, plaqueRect, tokens, tokens.theme.woodPrimary, tokens.theme.woodDark, 14);
  drawOutlinedText(
    ctx,
    title,
    plaqueRect.x + plaqueRect.w * 0.5,
    plaqueRect.y + plaqueRect.h * 0.5,
    `700 18px ${tokens.typography.fontFamily}`,
    '#FFF8EC',
    tokens.theme.inkOutline,
    2.8
  );

  ctx.restore();
}

export function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number
): void {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) * 0.5, (h - dh) * 0.5, dw, dh);
}
