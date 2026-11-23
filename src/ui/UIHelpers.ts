import type { SpriteProvider } from '../engine/SandRenderer';
import { roundRectPath } from '../platform/CanvasPolyfill';
import type { Rect, UiTokensFile } from '../types/ui';

export { roundRectPath };

export function hitRect(px: number, py: number, r: Rect | null | undefined): boolean {
  if (!r) return false;
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// ============================================================================
// 1. 手绘绘本字体与微倾数字排版（StarryStorybook · 霞鹜文楷手账笔触）
// ============================================================================

export interface InkTextOptions {
  font?: string;
  color?: string;
  embossColor?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  maxWidth?: number;
  slant?: number; // 负值（如 -0.10）呈现设计图同款手写微倾感
  boldStrokeWidth?: number;
}

export function drawInkText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tokens: UiTokensFile,
  opts: InkTextOptions = {}
): void {
  if (!text) return;
  ctx.save();
  ctx.translate(x, y);
  if (opts.slant) {
    ctx.transform(1, 0, opts.slant, 1, 0, 0);
  }
  ctx.font = opts.font || `600 13px ${tokens.typography.fontFamily}`;
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = opts.baseline || 'middle';
  ctx.lineJoin = 'round';

  const emboss = opts.embossColor ?? 'rgba(255, 252, 244, 0.72)';
  if (emboss) {
    ctx.fillStyle = emboss;
    if (opts.maxWidth) ctx.fillText(text, 0, 0.9, opts.maxWidth);
    else ctx.fillText(text, 0, 0.9);
  }

  const col = opts.color || '#2F1D12';
  if (opts.boldStrokeWidth && opts.boldStrokeWidth > 0) {
    ctx.strokeStyle = col;
    ctx.lineWidth = opts.boldStrokeWidth;
    if (opts.maxWidth) ctx.strokeText(text, 0, 0, opts.maxWidth);
    else ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = col;
  if (opts.maxWidth) ctx.fillText(text, 0, 0, opts.maxWidth);
  else ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * 专门还原设计图中的手写微倾关卡序号与战绩数字（如 08、01 — 20、24.5s、▶ 09）
 */
export function drawStorybookNumber(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  sizePx: number,
  tokens: UiTokensFile,
  opts: {
    color?: string;
    slant?: number;
    boldStroke?: number;
    embossColor?: string;
    align?: CanvasTextAlign;
  } = {}
): void {
  drawInkText(ctx, text, x, y, tokens, {
    font: `700 ${sizePx}px ${tokens.typography.numeralFontFamily}`,
    color: opts.color ?? '#2E1B10',
    slant: opts.slant ?? -0.09,
    boldStrokeWidth: opts.boldStroke ?? Math.max(0.35, sizePx * 0.022),
    embossColor: opts.embossColor ?? 'rgba(255, 252, 244, 0.65)',
    align: opts.align ?? 'center',
  });
}

export interface PlaqueTextOptions {
  font?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  align?: CanvasTextAlign;
  maxWidth?: number;
  slant?: number;
}

export function drawPlaqueText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tokens: UiTokensFile,
  opts: PlaqueTextOptions = {}
): void {
  if (!text) return;
  ctx.save();
  ctx.translate(x, y);
  if (opts.slant) {
    ctx.transform(1, 0, opts.slant, 1, 0, 0);
  }
  ctx.font = opts.font || `700 15px ${tokens.typography.fontFamily}`;
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const sw = opts.strokeWidth ?? 1.6;
  const stroke = opts.stroke || '#3B2416';
  const shadow = opts.shadowColor ?? 'rgba(22, 14, 8, 0.25)';

  if (shadow && sw > 0) {
    ctx.fillStyle = shadow;
    if (opts.maxWidth) ctx.fillText(text, 0, 1.3, opts.maxWidth);
    else ctx.fillText(text, 0, 1.3);
  }
  if (sw > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sw * 1.6;
    if (opts.maxWidth) ctx.strokeText(text, 0, 0, opts.maxWidth);
    else ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = opts.fill || '#FFFDF8';
  if (opts.maxWidth) ctx.fillText(text, 0, 0, opts.maxWidth);
  else ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  stroke: string,
  lineWidth = 1.8,
  align: CanvasTextAlign = 'center',
  maxWidth?: number
): void {
  if (!text) return;
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  if (lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth * 1.6;
    if (maxWidth) ctx.strokeText(text, x, y, maxWidth);
    else ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  if (maxWidth) ctx.fillText(text, x, y, maxWidth);
  else ctx.fillText(text, x, y);
  ctx.restore();
}

export interface StatusPillOptions {
  bgHex?: string;
  borderHex?: string;
  textColor?: string;
  fontSize?: number;
  padX?: number;
  height?: number;
  glowColor?: string;
}

export function drawStatusPill(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
  tokens: UiTokensFile,
  opts: StatusPillOptions = {}
): Rect {
  const fSize = opts.fontSize || 11;
  const font = `700 ${fSize}px ${tokens.typography.fontFamily}`;
  ctx.save();
  ctx.font = font;
  const tw = ctx.measureText(text).width;
  const h = opts.height || Math.round(fSize + 10);
  const w = Math.max(h + 8, Math.ceil(tw + (opts.padX ?? 16)));
  const r: Rect = { x: cx - w * 0.5, y: cy - h * 0.5, w, h };

  if (opts.glowColor) {
    ctx.fillStyle = opts.glowColor;
    ctx.beginPath();
    roundRectPath(ctx, r.x - 3, r.y - 2, r.w + 6, r.h + 5, (h + 5) * 0.5);
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(42, 26, 14, 0.14)';
    ctx.beginPath();
    roundRectPath(ctx, r.x, r.y + 1.8, r.w, r.h, h * 0.5);
    ctx.fill();
  }

  ctx.fillStyle = opts.bgHex || '#F7EEDB';
  ctx.strokeStyle = opts.borderHex || '#5C3D28';
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, h * 0.5);
  ctx.fill();
  ctx.stroke();

  drawInkText(ctx, text, cx, cy + 0.5, tokens, {
    font,
    color: opts.textColor || '#332015',
    boldStrokeWidth: 0.25,
  });
  ctx.restore();
  return r;
}

export function drawNineSlice(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  r: Rect,
  sl: number,
  sr: number,
  st: number,
  sb: number
): void {
  const anyImg = img as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const sw = anyImg.naturalWidth || anyImg.width || 0;
  const sh = anyImg.naturalHeight || anyImg.height || 0;
  if (sw <= 0 || sh <= 0 || r.w <= 0 || r.h <= 0) return;

  const dl = Math.min(sl, Math.floor(r.w * 0.42));
  const dr = Math.min(sr, Math.floor(r.w * 0.42));
  const dt = Math.min(st, Math.floor(r.h * 0.44));
  const db = Math.min(sb, Math.floor(r.h * 0.44));

  const scw = Math.max(1, sw - sl - sr);
  const sch = Math.max(1, sh - st - sb);
  const dcw = Math.max(0, r.w - dl - dr);
  const dch = Math.max(0, r.h - dt - db);

  const sx = [0, sl, sw - sr];
  const sy = [0, st, sh - sb];
  const swArr = [sl, scw, sr];
  const shArr = [st, sch, sb];

  const dx = [r.x, r.x + dl, r.x + dl + dcw];
  const dy = [r.y, r.y + dt, r.y + dt + dch];
  const dwArr = [dl, dcw, dr];
  const dhArr = [dt, dch, db];

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (dwArr[col] <= 0 || dhArr[row] <= 0 || swArr[col] <= 0 || shArr[row] <= 0) continue;
      ctx.drawImage(img, sx[col], sy[row], swArr[col], shArr[row], dx[col], dy[row], dwArr[col], dhArr[row]);
    }
  }
}

// ============================================================================
// 2. 绘本木艺与水彩卡片组件（严格对齐 5 张 UI 设计稿）
// ============================================================================

export type StorybookTileVariant =
  | 'parchment'
  | 'amber'
  | 'mint'
  | 'sky'
  | 'rose'
  | 'lavender'
  | 'locked'
  | 'walnut';

const VARIANT_PALETTES: Record<
  StorybookTileVariant,
  {
    faceTop: string;
    faceBot: string;
    border: string;
    lip: string;
  }
> = {
  parchment: {
    faceTop: '#FAF3E4',
    faceBot: '#EDE0C7',
    border: '#3B2416',
    lip: '#A98963',
  },
  amber: {
    faceTop: '#FDE8BA',
    faceBot: '#F5CD84',
    border: '#3B2416',
    lip: '#B8843E',
  },
  mint: {
    faceTop: '#DCF3E4',
    faceBot: '#BCE4CB',
    border: '#3B2416',
    lip: '#77A88A',
  },
  sky: {
    faceTop: '#D9EEFC',
    faceBot: '#B4D8F2',
    border: '#3B2416',
    lip: '#729EC0',
  },
  rose: {
    faceTop: '#F4ACA5',
    faceBot: '#DF857D',
    border: '#4A2622',
    lip: '#A3544E',
  },
  lavender: {
    faceTop: '#EAE2F8',
    faceBot: '#D4C7EC',
    border: '#463858',
    lip: '#9483B2',
  },
  locked: {
    faceTop: '#CEC5B6',
    faceBot: '#BDB3A3',
    border: '#7C7062',
    lip: '#968B7B',
  },
  walnut: {
    faceTop: '#E5BE8E',
    faceBot: '#C89862',
    border: '#3B2416',
    lip: '#8A5B30',
  },
};

export interface DoubleRimPlaqueOptions {
  variant?: StorybookTileVariant;
  radius?: number;
  pressed?: boolean;
  disabled?: boolean;
}

export function drawDoubleRimPlaque(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  _tokens: UiTokensFile,
  opts: DoubleRimPlaqueOptions = {}
): void {
  const pal = VARIANT_PALETTES[opts.variant || 'parchment'];
  const rad = opts.radius ?? Math.min(r.h * 0.5, 16);
  const dy = opts.pressed ? 1.5 : 0;

  ctx.save();
  if (opts.disabled) ctx.globalAlpha = 0.55;

  if (!opts.pressed) {
    ctx.fillStyle = 'rgba(14, 10, 6, 0.26)';
    ctx.beginPath();
    roundRectPath(ctx, r.x, r.y + 3.2, r.w, r.h, rad);
    ctx.fill();

    ctx.fillStyle = pal.lip;
    ctx.beginPath();
    roundRectPath(ctx, r.x, r.y + 2.2, r.w, r.h, rad);
    ctx.fill();
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const grad = ctx.createLinearGradient(r.x, r.y + dy, r.x, r.y + r.h + dy);
  grad.addColorStop(0, pal.faceTop);
  grad.addColorStop(1, pal.faceBot);
  ctx.fillStyle = grad;
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.65;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y + dy, r.w, r.h, rad);
  ctx.fill();
  ctx.stroke();

  // 顶部温润手绘亮边
  ctx.strokeStyle = 'rgba(255, 253, 246, 0.72)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  roundRectPath(ctx, r.x + 1.8, r.y + dy + 1.6, Math.max(2, r.w - 3.6), Math.max(2, r.h - 3.6), Math.max(2, rad - 1.6));
  ctx.stroke();

  if (opts.variant === 'walnut') {
    ctx.strokeStyle = 'rgba(92, 54, 24, 0.20)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(r.x + r.w * 0.5, r.y + dy + r.h * 0.52, Math.max(4, r.w * 0.34), 0.25, Math.PI - 0.25);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * 绘制珊瑚粉圆木关闭按钮（1:1 还原《选关》与《图鉴》右上角 X 按钮）
 */
export function drawCoralCloseButton(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile
): void {
  drawDoubleRimPlaque(ctx, r, tokens, { variant: 'rose', radius: r.w * 0.5 });
  ctx.save();
  ctx.translate(r.x + r.w * 0.5, r.y + r.h * 0.5);
  ctx.strokeStyle = '#6E2F2A';
  ctx.lineWidth = 3.0;
  ctx.lineCap = 'round';
  const d = r.w * 0.21;
  ctx.beginPath();
  ctx.moveTo(-d, -d);
  ctx.lineTo(d, d);
  ctx.moveTo(d, -d);
  ctx.lineTo(-d, d);
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制《通关结算弹窗》中的手绘水彩晕染竖卡（带自然水彩深浅笔触与细钢笔黑边）
 */
export function drawWatercolorStatCard(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tone: 'amber' | 'sky' | 'mint'
): void {
  const cfg =
    tone === 'amber'
      ? { base: '#F8D49A', washA: '#F1BA6D', washB: '#FCE6BF', border: '#2A1A10' }
      : tone === 'sky'
        ? { base: '#BBD9F5', washA: '#9CC5EC', washB: '#D9ECFB', border: '#2A1A10' }
        : { base: '#BFE6CF', washA: '#9DD4B4', washB: '#DCF3E5', border: '#2A1A10' };

  ctx.save();
  ctx.fillStyle = 'rgba(34, 22, 12, 0.14)';
  ctx.beginPath();
  roundRectPath(ctx, r.x + 1, r.y + 3, r.w, r.h, 11);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 11);
  ctx.clip();

  ctx.fillStyle = cfg.base;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // 水彩晕染团块模拟真实纸上水彩笔触
  const g1 = ctx.createRadialGradient(
    r.x + r.w * 0.30,
    r.y + r.h * 0.28,
    4,
    r.x + r.w * 0.32,
    r.y + r.h * 0.32,
    r.w * 0.72
  );
  g1.addColorStop(0, cfg.washB);
  g1.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  const g2 = ctx.createRadialGradient(
    r.x + r.w * 0.74,
    r.y + r.h * 0.78,
    4,
    r.x + r.w * 0.70,
    r.y + r.h * 0.74,
    r.w * 0.80
  );
  g2.addColorStop(0, cfg.washA);
  g2.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // 纸张边缘水彩积水暗边
  ctx.strokeStyle = cfg.washA;
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  roundRectPath(ctx, r.x + 1.8, r.y + 1.8, r.w - 3.6, r.h - 3.6, 9.5);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = cfg.border;
  ctx.lineWidth = 1.55;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 11);
  ctx.stroke();
  ctx.restore();
}

export interface CornerMedallionOptions {
  variant?: 'wood' | 'amber' | 'sage' | 'muted';
  radius?: number;
}

export function drawCornerMedallionBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
  tokens: UiTokensFile,
  opts: CornerMedallionOptions = {}
): void {
  const sz = (opts.radius || 9.5) * 1.85;
  const muted = opts.variant === 'muted';
  ctx.save();
  ctx.fillStyle = 'rgba(20, 12, 6, 0.22)';
  ctx.beginPath();
  roundRectPath(ctx, cx - sz * 0.5, cy - sz * 0.5 + 1.5, sz, sz, 4.5);
  ctx.fill();

  ctx.fillStyle = muted ? '#D8CFC0' : opts.variant === 'sage' ? '#CBEBD6' : '#FAF1DE';
  ctx.strokeStyle = '#3B2416';
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  roundRectPath(ctx, cx - sz * 0.5, cy - sz * 0.5, sz, sz, 4.5);
  ctx.fill();
  ctx.stroke();

  drawInkText(ctx, text, cx, cy + 0.5, tokens, {
    font: `700 10px ${tokens.typography.numeralFontFamily}`,
    color: muted ? '#7D7164' : '#3B2416',
    boldStrokeWidth: 0.25,
    embossColor: '',
  });
  ctx.restore();
}

export interface RecessedTileOptions {
  variant?: StorybookTileVariant;
  radius?: number;
  pressed?: boolean;
  disabled?: boolean;
  pulse?: boolean;
  pulsePhase?: number;
  medallionText?: string;
  medallionVariant?: 'wood' | 'amber' | 'sage' | 'muted';
  medallionRadius?: number;
}

export function drawRecessedTileCard(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile,
  opts: RecessedTileOptions = {}
): Rect {
  const variant = opts.variant || 'parchment';
  const rad = opts.radius ?? 13;
  ctx.save();

  let dy = 0;
  let scale = 1;
  if (opts.pressed && !opts.disabled) {
    dy = 2.0;
    scale = 0.95;
  } else if (opts.pulse) {
    scale = 1 + 0.025 * Math.sin(opts.pulsePhase || 0);
  }

  const cx = r.x + r.w * 0.5;
  const cy = r.y + r.h * 0.5;
  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  // 底部立体饼干木厚边（还原《局内主界面》底部奶油方卡立体感）
  if (!opts.pressed) {
    ctx.fillStyle = 'rgba(12, 8, 4, 0.30)';
    ctx.beginPath();
    roundRectPath(ctx, r.x + 0.5, r.y + 4.2, r.w - 1, r.h, rad);
    ctx.fill();

    ctx.fillStyle = variant === 'locked' ? '#958B7B' : '#B79A73';
    ctx.strokeStyle = variant === 'locked' ? '#72685A' : '#3B2416';
    ctx.lineWidth = 1.55;
    ctx.beginPath();
    roundRectPath(ctx, r.x, r.y + 2.8, r.w, r.h, rad);
    ctx.fill();
    ctx.stroke();
  }

  const pal = VARIANT_PALETTES[variant];
  const grad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
  grad.addColorStop(0, opts.disabled && variant !== 'locked' ? '#EDE5D5' : pal.faceTop);
  grad.addColorStop(1, opts.disabled && variant !== 'locked' ? '#DFD4C0' : pal.faceBot);
  ctx.fillStyle = grad;
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.65;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, rad);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 254, 248, 0.72)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  roundRectPath(ctx, r.x + 1.8, r.y + 1.6, r.w - 3.6, r.h - 3.6, Math.max(3, rad - 1.6));
  ctx.stroke();

  if (opts.medallionText) {
    drawCornerMedallionBadge(
      ctx,
      r.x + r.w - 4,
      r.y + 4,
      opts.medallionText,
      tokens,
      {
        variant: opts.medallionVariant || 'wood',
        radius: opts.medallionRadius || 8.8,
      }
    );
  }

  ctx.restore();
  return { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 };
}

// ============================================================================
// 3. 手绘钢笔水彩图标库（1:1 对齐 5 张设计图笔触）
// ============================================================================

export type HandDrawnGlyphKind =
  | 'undo'
  | 'vacuum'
  | 'extra_slot'
  | 'restart'
  | 'home'
  | 'gear'
  | 'grid'
  | 'question'
  | 'play'
  | 'snowflake'
  | 'clock'
  | 'steps'
  | 'lock'
  | 'crown'
  | 'gift'
  | 'check'
  | 'cloud'
  | 'sound_on'
  | 'sound_off'
  | 'vibrate_on'
  | 'vibrate_off'
  | 'book'
  | 'sparkle'
  | 'magnet'
  | 'shuffle'
  | 'close';

export function drawHandDrawnGlyph(
  ctx: CanvasRenderingContext2D,
  kind: HandDrawnGlyphKind,
  cx: number,
  cy: number,
  size: number,
  _tokens: UiTokensFile
): void {
  const s = size / 24;
  const ink = '#3B2416';

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kind) {
    case 'grid': {
      // 对齐《局内主界面》左上角 [⊞ 08] 深棕四宫格圆角方块图标
      const cells: [number, number][] = [
        [-8.8, -8.8],
        [1.4, -8.8],
        [-8.8, 1.4],
        [1.4, 1.4],
      ];
      ctx.fillStyle = '#4B3120';
      for (const [gx, gy] of cells) {
        ctx.beginPath();
        roundRectPath(ctx, gx, gy, 7.4, 7.4, 1.8);
        ctx.fill();
      }
      break;
    }

    case 'question': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3.1;
      ctx.beginPath();
      ctx.arc(0, -3.6, 5.2, -Math.PI * 0.85, Math.PI * 0.24, false);
      ctx.quadraticCurveTo(3.4, 1.2, 0, 2.8);
      ctx.lineTo(0, 4.4);
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(0, 9.0, 2.0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'play': {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(-5.8, -8.0);
      ctx.lineTo(8.2, 0);
      ctx.lineTo(-5.8, 8.0);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'snowflake': {
      ctx.strokeStyle = '#36729C';
      ctx.lineWidth = 2.1;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(a) * 9, -Math.sin(a) * 9);
        ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
        ctx.stroke();
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'clock': {
      // 对齐《通关结算弹窗》第一张橙卡手绘秒表图标
      ctx.strokeStyle = '#1E140D';
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.arc(0, 1.8, 9.2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -7.4);
      ctx.lineTo(0, -10.4);
      ctx.moveTo(-3.2, -10.4);
      ctx.lineTo(3.2, -10.4);
      ctx.moveTo(6.5, -5.0);
      ctx.lineTo(8.6, -7.1);
      // 刻度点与指针
      ctx.moveTo(0, 1.8);
      ctx.lineTo(0, -3.6);
      ctx.moveTo(0, 1.8);
      ctx.lineTo(4.2, 1.8);
      ctx.stroke();

      ctx.fillStyle = '#1E140D';
      for (const [tx, ty] of [
        [0, -5.8],
        [0, 9.2],
        [-7.4, 1.8],
        [7.4, 1.8],
      ]) {
        ctx.beginPath();
        ctx.arc(tx, ty, 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'steps': {
      // 对齐《通关结算弹窗》第二张蓝卡手绘双脚印图标
      const drawFoot = (fx: number, fy: number, rot: number) => {
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(rot);
        ctx.fillStyle = 'rgba(126, 158, 194, 0.65)';
        ctx.strokeStyle = '#1E140D';
        ctx.lineWidth = 1.65;
        // 前脚掌
        ctx.beginPath();
        ctx.ellipse(0, -3.2, 3.1, 4.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // 后脚跟
        ctx.beginPath();
        ctx.ellipse(0, 4.2, 2.3, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };
      drawFoot(-4.4, -2.0, -0.14);
      drawFoot(4.4, 2.4, 0.14);
      break;
    }

    case 'undo': {
      // 对齐《局内主界面》第 1 枚道具卡：温润深木色圆润回退弯箭头
      const g = ctx.createLinearGradient(0, -10, 0, 10);
      g.addColorStop(0, '#9E6B40');
      g.addColorStop(1, '#754925');
      ctx.fillStyle = g;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.85;
      ctx.beginPath();
      ctx.moveTo(-12.2, -2.2);
      ctx.lineTo(-2.8, -10.2);
      ctx.lineTo(-2.8, -5.0);
      ctx.bezierCurveTo(8.0, -5.2, 12.6, 1.2, 9.2, 9.8);
      ctx.bezierCurveTo(6.2, 10.6, 4.4, 9.4, 5.2, 6.8);
      ctx.bezierCurveTo(6.4, 2.8, 3.4, 0.8, -2.8, 1.2);
      ctx.lineTo(-2.8, 6.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'vacuum':
    case 'magnet': {
      // 对齐《局内主界面》第 2 枚道具卡：复古珊瑚红 + 浅钢灰磁极 U 形磁铁
      ctx.save();
      ctx.rotate(0.62);
      const magGrad = ctx.createLinearGradient(-9, -8, 9, 9);
      magGrad.addColorStop(0, '#D66D6D');
      magGrad.addColorStop(1, '#B34D4D');
      ctx.fillStyle = magGrad;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.85;
      ctx.beginPath();
      ctx.arc(0, 2.2, 9.6, 0, Math.PI, false);
      ctx.lineTo(-9.6, -8.2);
      ctx.lineTo(-4.0, -8.2);
      ctx.lineTo(-4.0, 2.2);
      ctx.arc(0, 2.2, 4.0, Math.PI, 0, true);
      ctx.lineTo(4.0, -8.2);
      ctx.lineTo(9.6, -8.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#B8BEC8';
      for (const lx of [-9.6, 4.0]) {
        ctx.beginPath();
        roundRectPath(ctx, lx, -8.4, 5.6, 4.6, 1.0);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
      break;
    }

    case 'extra_slot': {
      // 对齐《局内主界面》第 3 枚道具卡：塞着软木塞的薄荷绿带「+」小药剂玻璃瓶
      // 软木塞
      ctx.fillStyle = '#B88454';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      roundRectPath(ctx, -3.2, -12.6, 6.4, 4.2, 1.2);
      ctx.fill();
      ctx.stroke();

      // 瓶口翻唇
      ctx.fillStyle = '#D9F2E4';
      ctx.beginPath();
      roundRectPath(ctx, -4.6, -8.8, 9.2, 2.8, 1.3);
      ctx.fill();
      ctx.stroke();

      // 药剂瓶身
      const bGrad = ctx.createLinearGradient(-7, -5, 7, 12);
      bGrad.addColorStop(0, '#B2E4CA');
      bGrad.addColorStop(1, '#7FC4A2');
      ctx.fillStyle = bGrad;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-3.4, -6.0);
      ctx.quadraticCurveTo(-7.8, -3.2, -7.8, 1.5);
      ctx.lineTo(-7.8, 9.2);
      ctx.quadraticCurveTo(-7.8, 12.2, -4.4, 12.2);
      ctx.lineTo(4.4, 12.2);
      ctx.quadraticCurveTo(7.8, 12.2, 7.8, 9.2);
      ctx.lineTo(7.8, 1.5);
      ctx.quadraticCurveTo(7.8, -3.2, 3.4, -6.0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 瓶肚正中央十字「+」号
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.3;
      ctx.beginPath();
      ctx.moveTo(0, 0.2);
      ctx.lineTo(0, 6.8);
      ctx.moveTo(-3.3, 3.5);
      ctx.lineTo(3.3, 3.5);
      ctx.stroke();
      break;
    }

    case 'restart': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.9;
      ctx.beginPath();
      ctx.arc(0, 0.5, 8.2, -Math.PI * 0.75, Math.PI * 0.80, false);
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(7.2, -8.2);
      ctx.lineTo(8.0, -1.4);
      ctx.lineTo(1.4, -3.2);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'shuffle': {
      // 对齐《局内主界面》第 4 枚道具卡：温润木棕色交叉双箭头
      const drawCurveArrow = (flipY: 1 | -1) => {
        ctx.save();
        ctx.scale(1, flipY);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 4.6;
        ctx.beginPath();
        ctx.moveTo(-10.5, 6.0);
        ctx.bezierCurveTo(-2.2, 6.0, -1.8, -6.0, 6.8, -6.0);
        ctx.stroke();

        ctx.strokeStyle = '#AC7B4F';
        ctx.lineWidth = 2.4;
        ctx.stroke();

        ctx.fillStyle = '#AC7B4F';
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(11.2, -6.0);
        ctx.lineTo(5.6, -9.8);
        ctx.lineTo(5.6, -2.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };
      drawCurveArrow(1);
      drawCurveArrow(-1);
      break;
    }

    case 'lock': {
      ctx.strokeStyle = '#5D5246';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, -3.6, 4.6, Math.PI, 0, false);
      ctx.stroke();

      ctx.fillStyle = '#7A6D5E';
      ctx.strokeStyle = '#4A3F35';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      roundRectPath(ctx, -6.5, -3.0, 13.0, 10.6, 2.6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#EDE5D8';
      ctx.beginPath();
      ctx.arc(0, 2.0, 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'crown': {
      // 对齐《选关抽屉》Boss关与《结算弹窗》绿卡皇冠
      const cg = ctx.createLinearGradient(0, -8, 0, 7);
      cg.addColorStop(0, '#FFE494');
      cg.addColorStop(1, '#EBB44C');
      ctx.fillStyle = cg;
      ctx.strokeStyle = '#2B1B10';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.moveTo(-8.6, 6.2);
      ctx.lineTo(-10.2, -3.8);
      ctx.lineTo(-4.0, 1.0);
      ctx.lineTo(0, -6.8);
      ctx.lineTo(4.0, 1.0);
      ctx.lineTo(10.2, -3.8);
      ctx.lineTo(8.6, 6.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 皇冠三颗小圆珠
      for (const [bx, by] of [
        [-10.4, -5.2],
        [0, -8.4],
        [10.4, -5.2],
      ]) {
        ctx.beginPath();
        ctx.arc(bx, by, 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }

    case 'check': {
      // 对齐《选关抽屉》右下角清新绿勾 ✓
      ctx.strokeStyle = '#2D6B3F';
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(-5.5, 0.5);
      ctx.lineTo(-1.2, 5.2);
      ctx.lineTo(6.8, -4.8);
      ctx.stroke();

      ctx.strokeStyle = '#7FD18C';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      break;
    }

    case 'cloud': {
      // 对齐《选关抽屉》右上角云同步图标（云朵 + 双向小箭头）
      ctx.fillStyle = '#F5FBFF';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.arc(-4.4, 2.2, 4.6, Math.PI * 0.5, Math.PI * 1.55);
      ctx.arc(1.2, -2.0, 5.6, Math.PI * 1.05, Math.PI * 1.95);
      ctx.arc(6.2, 2.2, 4.2, -Math.PI * 0.4, Math.PI * 0.5);
      ctx.lineTo(-4.4, 6.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#538AB0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(1.0, 2.2, 2.8, 0.2, Math.PI * 1.5);
      ctx.stroke();
      break;
    }

    case 'sound_on':
    case 'sound_off': {
      ctx.fillStyle = '#C99660';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-8.8, -3.2);
      ctx.lineTo(-4.0, -3.2);
      ctx.lineTo(2.0, -8.2);
      ctx.lineTo(2.0, 8.2);
      ctx.lineTo(-4.0, 3.2);
      ctx.lineTo(-8.8, 3.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (kind === 'sound_on') {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.85;
        ctx.beginPath();
        ctx.arc(3.2, 0, 4.6, -0.72, 0.72);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(3.2, 0, 7.8, -0.72, 0.72);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#B84A46';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(4.8, -3.6);
        ctx.lineTo(10.2, 3.6);
        ctx.moveTo(10.2, -3.6);
        ctx.lineTo(4.8, 3.6);
        ctx.stroke();
      }
      break;
    }

    case 'vibrate_on':
    case 'vibrate_off': {
      ctx.fillStyle = '#E8CEAA';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      roundRectPath(ctx, -4.8, -8.2, 9.6, 16.4, 2.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FFF8EB';
      ctx.fillRect(-3.2, -5.6, 6.4, 10.2);
      if (kind === 'vibrate_on') {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.65;
        for (const dir of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(dir * 7.4, -5.0);
          ctx.lineTo(dir * 8.6, -2.5);
          ctx.lineTo(dir * 7.2, 0);
          ctx.lineTo(dir * 8.6, 2.5);
          ctx.lineTo(dir * 7.4, 5.0);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = '#B84A46';
        ctx.lineWidth = 2.1;
        ctx.beginPath();
        ctx.moveTo(-7.5, -6.5);
        ctx.lineTo(7.5, 6.5);
        ctx.stroke();
      }
      break;
    }

    case 'sparkle': {
      ctx.fillStyle = '#3B2416';
      ctx.beginPath();
      ctx.moveTo(0, -9.5);
      ctx.quadraticCurveTo(1.5, -1.5, 9.5, 0);
      ctx.quadraticCurveTo(1.5, 1.5, 0, 9.5);
      ctx.quadraticCurveTo(-1.5, 1.5, -9.5, 0);
      ctx.quadraticCurveTo(-1.5, -1.5, 0, -9.5);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'close':
    case 'home':
    case 'gear':
    case 'gift':
    case 'book': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(-5.2, -5.2);
      ctx.lineTo(5.2, 5.2);
      ctx.moveTo(5.2, -5.2);
      ctx.lineTo(-5.2, 5.2);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

export function drawWoodToggleCard(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  isOn: boolean,
  onGlyph: HandDrawnGlyphKind,
  offGlyph: HandDrawnGlyphKind,
  tokens: UiTokensFile
): void {
  drawDoubleRimPlaque(ctx, r, tokens, {
    variant: isOn ? 'walnut' : 'locked',
    radius: r.w * 0.5,
  });
  drawHandDrawnGlyph(
    ctx,
    isOn ? onGlyph : offGlyph,
    r.x + r.w * 0.5,
    r.y + r.h * 0.5,
    Math.min(22, r.w * 0.54),
    tokens
  );
  if (label) {
    drawInkText(ctx, label, r.x + r.w * 0.5, r.y + r.h + 12, tokens, {
      font: `600 11px ${tokens.typography.fontFamily}`,
      color: '#3B2416',
    });
  }
}

export function drawWoodCapsule(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile,
  radius = r.h * 0.5
): void {
  drawDoubleRimPlaque(ctx, r, tokens, { variant: 'parchment', radius });
}

/**
 * 1:1 还原《启动页》与《图鉴弹窗》顶部的微拱卷边羊皮纸飘带横幅
 */
export function drawRibbonBanner(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  height: number,
  text: string,
  tokens: UiTokensFile,
  fontSize = 16
): void {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const arch = 7.5;
  const ink = '#3B2416';

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 1. 两侧燕尾下折飘带尾翼
  for (const dir of [-1, 1]) {
    ctx.fillStyle = '#DFC9A3';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.55;
    ctx.beginPath();
    ctx.moveTo(dir * (hw - 8), -hh + 8);
    ctx.lineTo(dir * (hw + 26), -hh + 15);
    ctx.lineTo(dir * (hw + 16), 4);
    ctx.lineTo(dir * (hw + 28), hh + 13);
    ctx.lineTo(dir * (hw - 4), hh + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 折回暗面三角
    ctx.fillStyle = '#A8865C';
    ctx.beginPath();
    ctx.moveTo(dir * hw, hh + 2);
    ctx.lineTo(dir * (hw - 10), hh + 9);
    ctx.lineTo(dir * (hw - 8), hh - 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 2. 主飘带微拱羊皮纸面
  ctx.fillStyle = 'rgba(20, 12, 6, 0.18)';
  ctx.beginPath();
  ctx.moveTo(-hw, -hh + 5);
  ctx.quadraticCurveTo(0, -hh - arch + 5, hw, -hh + 5);
  ctx.lineTo(hw - 3, hh + 5);
  ctx.quadraticCurveTo(0, hh - arch + 5, -hw + 3, hh + 5);
  ctx.closePath();
  ctx.fill();

  const g = ctx.createLinearGradient(0, -hh - arch, 0, hh);
  g.addColorStop(0, '#FDF7E9');
  g.addColorStop(1, '#EFE0C2');
  ctx.fillStyle = g;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.65;
  ctx.beginPath();
  ctx.moveTo(-hw, -hh + 2);
  ctx.quadraticCurveTo(0, -hh - arch, hw, -hh + 2);
  ctx.lineTo(hw - 3, hh + 2);
  ctx.quadraticCurveTo(0, hh - arch + 1, -hw + 3, hh + 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  drawInkText(ctx, text, 0, -2.2, tokens, {
    font: `700 ${fontSize}px ${tokens.typography.fontFamily}`,
    color: '#2B1A0F',
    boldStrokeWidth: 0.4,
    maxWidth: width - 22,
  });

  ctx.restore();
}

export function drawStorybookCardFrame(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile,
  _sprites: SpriteProvider
): void {
  drawRecessedTileCard(ctx, r, tokens, { variant: 'parchment', radius: 14 });
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
  glyph?: HandDrawnGlyphKind;
  badgeText?: string;
  badgeBgHex?: string;
  subLabel?: string;
  radius?: number;
  slantLabel?: boolean;
}

export function drawWoodButton(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  tokens: UiTokensFile,
  _sprites: SpriteProvider,
  opts: WoodButtonOptions = {}
): void {
  ctx.save();
  const cx = r.x + r.w * 0.5;
  const cy = r.y + r.h * 0.5;
  const rad = opts.radius ?? Math.min(r.h * 0.5, 11);

  let scale = 1;
  let dy = 0;
  if (opts.disabled) {
    ctx.globalAlpha = tokens.motion.disabledAlpha;
  } else if (opts.pressed) {
    scale = tokens.motion.buttonPressScale;
    dy = 2.0;
  } else if (opts.pulse) {
    scale = 1 + 0.022 * Math.sin(opts.pulsePhase || 0);
  }

  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  const lr: Rect = { x: -r.w * 0.5, y: -r.h * 0.5, w: r.w, h: r.h };

  const hex = (opts.fillHex || '').toUpperCase();
  const isGreen = hex === '#15803D' || hex === '#1F7A44';
  const isOrange = hex === '#C2410C';
  const isBlue = hex === '#0369A1';

  const topCol = isGreen ? '#25854A' : isOrange ? '#D96B38' : isBlue ? '#3B82B6' : '#DFB989';
  const botCol = isGreen ? '#1B6B39' : isOrange ? '#B84E20' : isBlue ? '#286492' : '#C49560';
  const lipCol = isGreen ? '#0F4423' : isOrange ? '#7C3010' : isBlue ? '#183F5E' : '#85582F';
  const borderCol = isGreen ? '#102918' : '#3B2416';
  const textCol = opts.textColor || (isGreen || isOrange || isBlue ? '#FFFFFF' : '#3B2416');

  if (!opts.pressed) {
    ctx.fillStyle = 'rgba(12, 8, 4, 0.28)';
    ctx.beginPath();
    roundRectPath(ctx, lr.x + 1, lr.y + 4.2, lr.w - 2, lr.h, rad);
    ctx.fill();

    ctx.fillStyle = lipCol;
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    roundRectPath(ctx, lr.x, lr.y + 3.2, lr.w, lr.h, rad);
    ctx.fill();
    ctx.stroke();
  }

  const grad = ctx.createLinearGradient(0, lr.y, 0, lr.y + lr.h);
  grad.addColorStop(0, topCol);
  grad.addColorStop(1, botCol);
  ctx.fillStyle = grad;
  ctx.strokeStyle = borderCol;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  roundRectPath(ctx, lr.x, lr.y, lr.w, lr.h, rad);
  ctx.fill();
  ctx.stroke();

  if (!isGreen && !isOrange && !isBlue) {
    // 实木按钮细木纹
    ctx.strokeStyle = 'rgba(92, 54, 24, 0.24)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(lr.x + 6, lr.y + lr.h * 0.72);
    ctx.bezierCurveTo(-lr.w * 0.1, lr.y + lr.h * 0.65, lr.w * 0.12, lr.y + lr.h * 0.8, lr.x + lr.w - 6, lr.y + lr.h * 0.7);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(lr.x + rad, lr.y + 1.8);
  ctx.lineTo(lr.x + lr.w - rad, lr.y + 1.8);
  ctx.stroke();

  const fSize = opts.fontSize || 15;
  const font = `700 ${fSize}px ${tokens.typography.fontFamily}`;
  const isLight = textCol.toUpperCase() === '#FFFFFF' || textCol.toUpperCase() === '#FFFDF8';

  const renderLabel = (tx: number, ty: number, maxW: number) => {
    if (!label) return;
    if (isLight) {
      drawInkText(ctx, label, tx, ty, tokens, {
        font,
        color: textCol,
        embossColor: 'rgba(0, 0, 0, 0.25)',
        slant: opts.slantLabel ? -0.09 : 0,
        boldStrokeWidth: 0.45,
        maxWidth: maxW,
      });
    } else {
      drawInkText(ctx, label, tx, ty, tokens, {
        font,
        color: textCol,
        slant: opts.slantLabel ? -0.09 : 0,
        boldStrokeWidth: 0.35,
        maxWidth: maxW,
      });
    }
  };

  if (opts.glyph && !label) {
    drawHandDrawnGlyph(ctx, opts.glyph, 0, 0, opts.iconSize || Math.min(25, r.h * 0.56), tokens);
  } else if (opts.glyph && label) {
    const isz = opts.iconSize || 18;
    if (opts.glyph === 'play') {
      // 对齐《通关结算弹窗》绿色按钮居中的 ▶ 09 紧凑组合
      ctx.font = font;
      const tw = ctx.measureText(label).width;
      const totalW = isz + 8 + tw;
      const startX = -totalW * 0.5;
      drawHandDrawnGlyph(ctx, 'play', startX + isz * 0.45, 0, isz, tokens);
      renderLabel(startX + isz + 8 + tw * 0.5, 0.5, r.w - 28);
    } else {
      const gx = lr.x + 22;
      drawHandDrawnGlyph(ctx, opts.glyph, gx, 0, isz, tokens);
      renderLabel((gx + isz * 0.5 + lr.x + lr.w - 8) * 0.5, 0.5, Math.max(32, r.w - isz - 30));
    }
  } else {
    renderLabel(0, 0.5, r.w - 18);
  }

  ctx.restore();
}

/**
 * 1:1 还原《图鉴弹窗》《选关抽屉》《结算弹窗》的浅橡木画框 + 象牙羊皮纸内衬板
 */
export function drawParchmentModalFrame(
  ctx: CanvasRenderingContext2D,
  screenW: number,
  screenH: number,
  panelRect: Rect,
  title: string,
  tokens: UiTokensFile,
  sprites: SpriteProvider,
  bgSpriteId?: string,
  opts: { curledCorner?: boolean; hideTitleRibbon?: boolean } = {}
): void {
  ctx.save();

  // 1. 全屏星夜工坊虚化暗化背景（还原弹窗设计稿背后的温馨星夜草药工坊）
  const bgImg = bgSpriteId ? sprites.get(bgSpriteId) : null;
  if (bgImg && drawCoverImage(ctx, bgImg, screenW, screenH)) {
    ctx.fillStyle = 'rgba(10, 15, 26, 0.42)';
    ctx.fillRect(0, 0, screenW, screenH);
  } else {
    ctx.fillStyle = 'rgba(12, 18, 32, 0.64)';
    ctx.fillRect(0, 0, screenW, screenH);
  }

  // 2. 面板漫射深投影
  ctx.fillStyle = 'rgba(8, 6, 4, 0.42)';
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x + 2, panelRect.y + 8, panelRect.w - 4, panelRect.h, 14);
  ctx.fill();

  // 3. 外层浅橡木画框（带手绘木纹与深棕钢笔边）
  const woodGrad = ctx.createLinearGradient(panelRect.x, panelRect.y, panelRect.x + panelRect.w, panelRect.y + panelRect.h);
  woodGrad.addColorStop(0, '#DFB988');
  woodGrad.addColorStop(0.5, '#CCA06B');
  woodGrad.addColorStop(1, '#B88954');
  ctx.fillStyle = woodGrad;
  ctx.strokeStyle = '#3B2416';
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x, panelRect.y, panelRect.w, panelRect.h, 12);
  ctx.fill();
  ctx.stroke();

  // 木框纹理细线
  ctx.strokeStyle = 'rgba(88, 50, 20, 0.24)';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(panelRect.x + 4.5, panelRect.y + 18);
  ctx.lineTo(panelRect.x + 4.5, panelRect.y + panelRect.h - 18);
  ctx.moveTo(panelRect.x + panelRect.w - 4.5, panelRect.y + 24);
  ctx.lineTo(panelRect.x + panelRect.w - 4.5, panelRect.y + panelRect.h - 24);
  ctx.stroke();

  // 4. 内层温暖象牙羊皮纸面（可选右下角微卷折页细节）
  const inset = 9;
  const ix = panelRect.x + inset;
  const iy = panelRect.y + inset;
  const iw = panelRect.w - inset * 2;
  const ih = panelRect.h - inset * 2;

  const pGrad = ctx.createLinearGradient(0, iy, 0, iy + ih);
  pGrad.addColorStop(0, '#FDF9EF');
  pGrad.addColorStop(1, '#F6EEDB');
  ctx.fillStyle = pGrad;
  ctx.strokeStyle = '#4A3120';
  ctx.lineWidth = 1.5;

  if (opts.curledCorner) {
    const curl = 20;
    ctx.beginPath();
    ctx.moveTo(ix + 8, iy);
    ctx.lineTo(ix + iw - 8, iy);
    ctx.quadraticCurveTo(ix + iw, iy, ix + iw, iy + 8);
    ctx.lineTo(ix + iw, iy + ih - curl);
    ctx.quadraticCurveTo(ix + iw - curl * 0.4, iy + ih - curl * 0.2, ix + iw - curl, iy + ih);
    ctx.lineTo(ix + 8, iy + ih);
    ctx.quadraticCurveTo(ix, iy + ih, ix, iy + ih - 8);
    ctx.lineTo(ix, iy + 8);
    ctx.quadraticCurveTo(ix, iy, ix + 8, iy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 卷起的小三角页角
    ctx.fillStyle = '#E8D8BA';
    ctx.beginPath();
    ctx.moveTo(ix + iw, iy + ih - curl);
    ctx.quadraticCurveTo(ix + iw - curl * 0.85, iy + ih - curl * 0.85, ix + iw - curl, iy + ih);
    ctx.quadraticCurveTo(ix + iw - curl * 0.35, iy + ih - curl * 0.3, ix + iw, iy + ih - curl);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    roundRectPath(ctx, ix, iy, iw, ih, 8);
    ctx.fill();
    ctx.stroke();
  }

  // 5. 顶部卷边羊皮纸飘带标题（如《玩法与机关图鉴》）
  if (title && !opts.hideTitleRibbon) {
    const ribW = Math.min(panelRect.w - 64, Math.max(198, title.length * 22 + 52));
    drawRibbonBanner(
      ctx,
      panelRect.x + panelRect.w * 0.5,
      panelRect.y + 4,
      ribW,
      44,
      title,
      tokens,
      20.5
    );
  }

  ctx.restore();
}

export function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  w: number,
  h: number
): boolean {
  const sized = img as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  const iw = sized.width || sized.naturalWidth || 0;
  const ih = sized.height || sized.naturalHeight || 0;
  if (iw <= 0 || ih <= 0) return false;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (w - dw) * 0.5, (h - dh) * 0.5, dw, dh);
  return true;
}
