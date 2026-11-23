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
    faceTop: '#F8F2E4',
    faceBot: '#EDE1CA',
    border: '#382417',
    lip: '#CBB89A',
  },
  amber: {
    faceTop: '#FCEAC4',
    faceBot: '#F4D396',
    border: '#382417',
    lip: '#C89B58',
  },
  mint: {
    faceTop: '#DFF3E6',
    faceBot: '#C2E5CF',
    border: '#382417',
    lip: '#88B49A',
  },
  sky: {
    faceTop: '#DCEFFC',
    faceBot: '#BBDDF4',
    border: '#382417',
    lip: '#83ACC8',
  },
  rose: {
    faceTop: '#F3ADA7',
    faceBot: '#E28E88',
    border: '#4A2824',
    lip: '#B86A64',
  },
  lavender: {
    faceTop: '#ECE5F8',
    faceBot: '#D7CBEB',
    border: '#463858',
    lip: '#9E8EB8',
  },
  locked: {
    faceTop: '#D4CCC0',
    faceBot: '#C4BBB0',
    border: '#786D60',
    lip: '#A3998B',
  },
  walnut: {
    faceTop: '#EEDBC0',
    faceBot: '#DEC4A0',
    border: '#382417',
    lip: '#BA9972',
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
  const dy = opts.pressed ? 1.2 : 0;

  ctx.save();
  if (opts.disabled) ctx.globalAlpha = 0.55;

  // 日系手绘水彩纸牌/浅木牌：轻柔薄边投影，去除厚重复古双白框斜切边
  if (!opts.pressed) {
    ctx.fillStyle = 'rgba(18, 12, 8, 0.18)';
    ctx.beginPath();
    roundRectPath(ctx, r.x + 0.4, r.y + 2.6, r.w - 0.8, r.h, rad);
    ctx.fill();

    ctx.fillStyle = pal.lip;
    ctx.beginPath();
    roundRectPath(ctx, r.x, r.y + 1.6, r.w, r.h, rad);
    ctx.fill();
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = 1.35;
    ctx.stroke();
  }

  const grad = ctx.createLinearGradient(r.x, r.y + dy, r.x, r.y + r.h + dy);
  grad.addColorStop(0, pal.faceTop);
  grad.addColorStop(1, pal.faceBot);
  ctx.fillStyle = grad;
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.45;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y + dy, r.w, r.h, rad);
  ctx.fill();
  ctx.stroke();

  if (opts.variant === 'walnut') {
    // 浅桦木圆钮自然手绘细铅笔木纹
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, r.x + 1, r.y + dy + 1, Math.max(2, r.w - 2), Math.max(2, r.h - 2), Math.max(2, rad - 1));
    ctx.clip();
    ctx.strokeStyle = 'rgba(112, 76, 44, 0.16)';
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(r.x + 5, r.y + dy + r.h * 0.32);
    ctx.quadraticCurveTo(r.x + r.w * 0.5, r.y + dy + r.h * 0.26, r.x + r.w - 5, r.y + dy + r.h * 0.35);
    ctx.moveTo(r.x + 4, r.y + dy + r.h * 0.72);
    ctx.quadraticCurveTo(r.x + r.w * 0.5, r.y + dy + r.h * 0.78, r.x + r.w - 4, r.y + dy + r.h * 0.69);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/**
 * 绘制日系樱桃粉手绘关闭圆钮（1:1 还原《选关》与《图鉴》右上角 X 按钮）
 */
export function drawCoralCloseButton(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile
): void {
  drawDoubleRimPlaque(ctx, r, tokens, { variant: 'rose', radius: r.w * 0.5 });
  ctx.save();
  ctx.translate(r.x + r.w * 0.5, r.y + r.h * 0.5);
  ctx.strokeStyle = '#733732';
  ctx.lineWidth = 2.7;
  ctx.lineCap = 'round';
  const d = r.w * 0.2;
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
  ctx.fillStyle = 'rgba(34, 22, 12, 0.12)';
  ctx.beginPath();
  roundRectPath(ctx, r.x + 1, r.y + 2.5, r.w, r.h, 11);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 11);
  ctx.clip();

  ctx.fillStyle = cfg.base;
  ctx.fillRect(r.x, r.y, r.w, r.h);

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

  ctx.strokeStyle = cfg.washA;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  roundRectPath(ctx, r.x + 1.8, r.y + 1.8, r.w - 3.6, r.h - 3.6, 9.5);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = cfg.border;
  ctx.lineWidth = 1.45;
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
  const sz = (opts.radius || 8.8) * 1.82;
  const muted = opts.variant === 'muted';
  ctx.save();
  ctx.fillStyle = 'rgba(24, 15, 8, 0.14)';
  ctx.beginPath();
  roundRectPath(ctx, cx - sz * 0.5, cy - sz * 0.5 + 1.1, sz, sz, 4.2);
  ctx.fill();

  ctx.fillStyle = muted ? '#DFD8CA' : opts.variant === 'sage' ? '#D6EFE0' : '#FAF3E4';
  ctx.strokeStyle = '#382417';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  roundRectPath(ctx, cx - sz * 0.5, cy - sz * 0.5, sz, sz, 4.2);
  ctx.fill();
  ctx.stroke();

  drawInkText(ctx, text, cx, cy + 0.4, tokens, {
    font: `700 9.5px ${tokens.typography.numeralFontFamily}`,
    color: muted ? '#7E7265' : '#382417',
    boldStrokeWidth: 0.2,
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
    dy = 1.5;
    scale = 0.96;
  } else if (opts.pulse) {
    scale = 1 + 0.022 * Math.sin(opts.pulsePhase || 0);
  }

  const cx = r.x + r.w * 0.5;
  const cy = r.y + r.h * 0.5;
  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  // 日系和纸圆角道具方卡（温润轻薄纸边，去除厚重复古深棕底座与白内框）
  if (!opts.pressed) {
    ctx.fillStyle = 'rgba(14, 9, 5, 0.20)';
    ctx.beginPath();
    roundRectPath(ctx, r.x + 0.5, r.y + 3.0, r.w - 1, r.h, rad);
    ctx.fill();

    ctx.fillStyle = variant === 'locked' ? '#9E9486' : '#C9B698';
    ctx.strokeStyle = variant === 'locked' ? '#746A5C' : '#382417';
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    roundRectPath(ctx, r.x, r.y + 1.8, r.w, r.h, rad);
    ctx.fill();
    ctx.stroke();
  }

  const pal = VARIANT_PALETTES[variant];
  const grad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
  grad.addColorStop(0, opts.disabled && variant !== 'locked' ? '#EFE8DA' : pal.faceTop);
  grad.addColorStop(1, opts.disabled && variant !== 'locked' ? '#E2D8C5' : pal.faceBot);
  ctx.fillStyle = grad;
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.45;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, rad);
  ctx.fill();
  ctx.stroke();

  if (opts.medallionText) {
    drawCornerMedallionBadge(
      ctx,
      r.x + r.w - 3.5,
      r.y + 3.5,
      opts.medallionText,
      tokens,
      {
        variant: opts.medallionVariant || 'wood',
        radius: opts.medallionRadius || 8.4,
      }
    );
  }

  ctx.restore();
  return { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 };
}

// ============================================================================
// 3. 日系手绘钢笔水彩图标库（1:1 严格还原 5 张 UI 设计稿笔触与朝向）
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
  | 'crown_line'
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
  const ink = '#382417';

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kind) {
    case 'grid': {
      // 对齐《局内主界面》左上角 [⊞ 08] 手绘圆角四宫格
      const cells: [number, number][] = [
        [-8.6, -8.6],
        [1.4, -8.6],
        [-8.6, 1.4],
        [1.4, 1.4],
      ];
      ctx.fillStyle = '#4C3525';
      for (const [gx, gy] of cells) {
        ctx.beginPath();
        roundRectPath(ctx, gx, gy, 7.2, 7.2, 1.8);
        ctx.fill();
      }
      break;
    }

    case 'question': {
      ctx.strokeStyle = '#4A3424';
      ctx.lineWidth = 2.75;
      ctx.beginPath();
      ctx.arc(0, -3.5, 4.9, -Math.PI * 0.84, Math.PI * 0.24, false);
      ctx.quadraticCurveTo(3.2, 1.1, 0, 2.7);
      ctx.lineTo(0, 4.3);
      ctx.stroke();

      ctx.fillStyle = '#4A3424';
      ctx.beginPath();
      ctx.arc(0, 8.8, 1.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'play': {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(-5.5, -7.8);
      ctx.lineTo(8.0, 0);
      ctx.lineTo(-5.5, 7.8);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'snowflake': {
      ctx.strokeStyle = '#36729C';
      ctx.lineWidth = 2.0;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(a) * 8.8, -Math.sin(a) * 8.8);
        ctx.lineTo(Math.cos(a) * 8.8, Math.sin(a) * 8.8);
        ctx.stroke();
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(0, 0, 2.0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'clock': {
      // 对齐《通关结算弹窗》第一张橙卡手绘细线秒表
      ctx.strokeStyle = '#1E140D';
      ctx.lineWidth = 1.65;
      ctx.beginPath();
      ctx.arc(0, 1.8, 8.8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -7.0);
      ctx.lineTo(0, -10.2);
      ctx.moveTo(-3.0, -10.2);
      ctx.lineTo(3.0, -10.2);
      ctx.moveTo(6.2, -4.6);
      ctx.lineTo(8.2, -6.6);
      ctx.moveTo(0, 1.8);
      ctx.lineTo(0, -3.5);
      ctx.moveTo(0, 1.8);
      ctx.lineTo(4.0, 1.8);
      ctx.stroke();

      ctx.fillStyle = '#1E140D';
      for (const [tx, ty] of [
        [0, -5.4],
        [0, 8.9],
        [-7.1, 1.8],
        [7.1, 1.8],
      ]) {
        ctx.beginPath();
        ctx.arc(tx, ty, 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'steps': {
      // 对齐《通关结算弹窗》第二张蓝卡手绘水彩双鞋底脚印
      const drawFoot = (fx: number, fy: number, rot: number) => {
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(rot);
        ctx.fillStyle = 'rgba(130, 160, 198, 0.72)';
        ctx.strokeStyle = '#1E140D';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, -3.1, 3.0, 4.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, 4.0, 2.2, 2.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };
      drawFoot(-4.5, -2.0, -0.14);
      drawFoot(4.5, 2.2, 0.14);
      break;
    }

    case 'undo': {
      // 1:1 对齐《局内主界面》第 1 枚道具卡：纤巧圆润可可木色 C 形左回退弯箭头
      ctx.fillStyle = '#7E614D';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.55;
      ctx.beginPath();
      // 左侧箭头尖端与上下翼
      ctx.moveTo(-10.4, -4.6);
      ctx.lineTo(-3.6, -9.5);
      ctx.lineTo(-3.6, -6.2);
      // 外弧绕向右侧再收至左下尾端
      ctx.bezierCurveTo(5.8, -6.4, 10.6, -1.2, 9.6, 5.0);
      ctx.bezierCurveTo(8.8, 9.6, 3.8, 10.8, -1.6, 9.4);
      ctx.quadraticCurveTo(-3.2, 8.9, -2.7, 7.2);
      ctx.quadraticCurveTo(-2.2, 5.8, -0.5, 6.2);
      // 内弧平滑回到箭头颈部下沿
      ctx.bezierCurveTo(3.4, 7.0, 6.2, 5.4, 6.2, 2.0);
      ctx.bezierCurveTo(6.2, -1.4, 2.8, -2.8, -3.6, -2.8);
      ctx.lineTo(-3.6, 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'vacuum':
    case 'magnet': {
      // 1:1 对齐《局内主界面》第 2 枚道具卡：左上开口（-44°）豆沙粉红 + 雾蓝灰磁极 U 形磁铁
      ctx.save();
      ctx.rotate(-Math.PI * 0.245);
      const rOut = 7.8;
      const rIn = 3.5;
      const legTop = -8.2;
      const bendCy = 1.8;

      const magGrad = ctx.createLinearGradient(-rOut, -4, rOut, bendCy + rOut);
      magGrad.addColorStop(0, '#DF8385');
      magGrad.addColorStop(1, '#C56366');
      ctx.fillStyle = magGrad;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.55;

      // U 形磁铁主体
      ctx.beginPath();
      ctx.arc(0, bendCy, rOut, 0, Math.PI, false);
      ctx.lineTo(-rOut, legTop);
      ctx.lineTo(-rIn, legTop);
      ctx.lineTo(-rIn, bendCy);
      ctx.arc(0, bendCy, rIn, Math.PI, 0, true);
      ctx.lineTo(rIn, legTop);
      ctx.lineTo(rOut, legTop);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 两端雾蓝灰磁极帽（带分界细线）
      const capH = 4.2;
      ctx.fillStyle = '#BAC6D2';
      for (const lx of [-rOut, rIn]) {
        ctx.beginPath();
        roundRectPath(ctx, lx, legTop, rOut - rIn, capH, 0.9);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
      break;
    }

    case 'extra_slot': {
      // 1:1 对齐《局内主界面》第 3 枚道具卡：修长鼠尾草青绿带「+」软木塞小药剂瓶
      // 软木塞
      ctx.fillStyle = '#B78556';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      roundRectPath(ctx, -2.7, -11.4, 5.4, 3.8, 1.0);
      ctx.fill();
      ctx.stroke();

      // 瓶口圆领圈
      ctx.fillStyle = '#DCEFE4';
      ctx.beginPath();
      roundRectPath(ctx, -4.0, -8.0, 8.0, 2.5, 1.2);
      ctx.fill();
      ctx.stroke();

      // 修长圆柱药剂瓶身
      const bGrad = ctx.createLinearGradient(-6.2, -5, 6.2, 11.4);
      bGrad.addColorStop(0, '#B5DEC9');
      bGrad.addColorStop(1, '#8EBFA6');
      ctx.fillStyle = bGrad;
      ctx.lineWidth = 1.55;
      ctx.beginPath();
      ctx.moveTo(-3.0, -5.5);
      ctx.quadraticCurveTo(-6.3, -3.2, -6.3, 0.8);
      ctx.lineTo(-6.3, 8.8);
      ctx.quadraticCurveTo(-6.3, 11.4, -3.6, 11.4);
      ctx.lineTo(3.6, 11.4);
      ctx.quadraticCurveTo(6.3, 11.4, 6.3, 8.8);
      ctx.lineTo(6.3, 0.8);
      ctx.quadraticCurveTo(6.3, -3.2, 3.0, -5.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 瓶内左侧细高光丝
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(-4.3, 0.5);
      ctx.lineTo(-4.3, 8.2);
      ctx.stroke();

      // 瓶腹正中央手绘立体「+」号
      ctx.fillStyle = '#6A947E';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-1.1, -0.2);
      ctx.lineTo(1.1, -0.2);
      ctx.lineTo(1.1, 2.2);
      ctx.lineTo(3.5, 2.2);
      ctx.lineTo(3.5, 4.4);
      ctx.lineTo(1.1, 4.4);
      ctx.lineTo(1.1, 6.8);
      ctx.lineTo(-1.1, 6.8);
      ctx.lineTo(-1.1, 4.4);
      ctx.lineTo(-3.5, 4.4);
      ctx.lineTo(-3.5, 2.2);
      ctx.lineTo(-1.1, 2.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'restart': {
      // 对齐《局内主界面》右上角与《结算弹窗》左下角：右侧开口 C 形顺时针圆弧 + 右上顺时针三角箭头
      ctx.strokeStyle = '#4A3424';
      ctx.lineWidth = 2.65;
      ctx.beginPath();
      ctx.arc(0, 0.2, 7.6, Math.PI * 0.24, Math.PI * 1.78, false);
      ctx.stroke();

      ctx.fillStyle = '#4A3424';
      ctx.beginPath();
      ctx.moveTo(8.4, -1.0);
      ctx.lineTo(8.5, -7.2);
      ctx.lineTo(2.8, -4.2);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'shuffle': {
      // 1:1 对齐《局内主界面》第 4 枚道具卡：带立体穿插留白间隙的暖灰棕双交叉 S 曲线箭头
      const drawSingleRibbon = (flipY: 1 | -1) => {
        ctx.save();
        ctx.scale(1, flipY);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 4.3;
        ctx.beginPath();
        ctx.moveTo(-10.2, 5.4);
        ctx.bezierCurveTo(-2.8, 5.4, -2.0, -5.4, 5.8, -5.4);
        ctx.stroke();

        ctx.strokeStyle = '#8F735E';
        ctx.lineWidth = 2.1;
        ctx.stroke();

        ctx.fillStyle = '#8F735E';
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(10.6, -5.4);
        ctx.lineTo(5.2, -9.0);
        ctx.lineTo(5.2, -1.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };

      // 下层箭头（左下 -> 右上）
      drawSingleRibbon(1);
      // 中心交叉处和纸底色断口遮罩，呈现真实上下穿插手绘感
      ctx.fillStyle = '#F2E7D2';
      ctx.beginPath();
      ctx.arc(-1.0, 0, 3.0, 0, Math.PI * 2);
      ctx.fill();
      // 上层箭头（左上 -> 右下）
      drawSingleRibbon(-1);
      break;
    }

    case 'lock': {
      ctx.strokeStyle = '#5D5246';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, -3.6, 4.5, Math.PI, 0, false);
      ctx.stroke();

      ctx.fillStyle = '#7D7062';
      ctx.strokeStyle = '#4A3F35';
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      roundRectPath(ctx, -6.2, -3.0, 12.4, 10.2, 2.4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#EDE5D8';
      ctx.beginPath();
      ctx.arc(0, 1.8, 1.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'crown_line': {
      // 对齐《通关结算弹窗》第三张薄荷绿水彩卡的极简钢笔细线空心小皇冠
      ctx.strokeStyle = '#1E140D';
      ctx.lineWidth = 1.55;
      ctx.beginPath();
      ctx.moveTo(-7.6, 5.4);
      ctx.lineTo(-9.4, -3.2);
      ctx.lineTo(-3.8, 1.2);
      ctx.lineTo(0, -6.2);
      ctx.lineTo(3.8, 1.2);
      ctx.lineTo(9.4, -3.2);
      ctx.lineTo(7.6, 5.4);
      ctx.closePath();
      ctx.stroke();

      // 皇冠底座双横线
      ctx.beginPath();
      ctx.moveTo(-7.2, 3.1);
      ctx.lineTo(7.2, 3.1);
      ctx.stroke();

      // 三颗空心小圆珠
      ctx.fillStyle = '#DCF3E5';
      for (const [bx, by] of [
        [-9.7, -4.5],
        [0, -7.6],
        [9.7, -4.5],
      ]) {
        ctx.beginPath();
        ctx.arc(bx, by, 1.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }

    case 'crown': {
      // 对齐《选关抽屉》10 / 20 Boss 关顶部的暖金手绘小皇冠
      const cg = ctx.createLinearGradient(0, -8, 0, 7);
      cg.addColorStop(0, '#FFE8A3');
      cg.addColorStop(1, '#EBB958');
      ctx.fillStyle = cg;
      ctx.strokeStyle = '#2B1B10';
      ctx.lineWidth = 1.55;
      ctx.beginPath();
      ctx.moveTo(-8.2, 5.8);
      ctx.lineTo(-9.8, -3.5);
      ctx.lineTo(-3.8, 1.0);
      ctx.lineTo(0, -6.5);
      ctx.lineTo(3.8, 1.0);
      ctx.lineTo(9.8, -3.5);
      ctx.lineTo(8.2, 5.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      for (const [bx, by] of [
        [-10.0, -4.8],
        [0, -8.0],
        [10.0, -4.8],
      ]) {
        ctx.beginPath();
        ctx.arc(bx, by, 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }

    case 'check': {
      ctx.strokeStyle = '#2D6B3F';
      ctx.lineWidth = 3.9;
      ctx.beginPath();
      ctx.moveTo(-5.4, 0.5);
      ctx.lineTo(-1.2, 5.0);
      ctx.lineTo(6.6, -4.6);
      ctx.stroke();

      ctx.strokeStyle = '#86D692';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      break;
    }

    case 'cloud': {
      ctx.fillStyle = '#F6FBFF';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(-4.4, 2.2, 4.5, Math.PI * 0.5, Math.PI * 1.55);
      ctx.arc(1.2, -2.0, 5.5, Math.PI * 1.05, Math.PI * 1.95);
      ctx.arc(6.2, 2.2, 4.1, -Math.PI * 0.4, Math.PI * 0.5);
      ctx.lineTo(-4.4, 6.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#538AB0';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(1.0, 2.2, 2.7, 0.2, Math.PI * 1.5);
      ctx.stroke();
      break;
    }

    case 'sound_on':
    case 'sound_off': {
      ctx.fillStyle = '#CCA06E';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.65;
      ctx.beginPath();
      ctx.moveTo(-8.6, -3.1);
      ctx.lineTo(-3.9, -3.1);
      ctx.lineTo(1.9, -8.0);
      ctx.lineTo(1.9, 8.0);
      ctx.lineTo(-3.9, 3.1);
      ctx.lineTo(-8.6, 3.1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (kind === 'sound_on') {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.arc(3.1, 0, 4.5, -0.7, 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(3.1, 0, 7.6, -0.7, 0.7);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#B84A46';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(4.8, -3.5);
        ctx.lineTo(10.0, 3.5);
        ctx.moveTo(10.0, -3.5);
        ctx.lineTo(4.8, 3.5);
        ctx.stroke();
      }
      break;
    }

    case 'vibrate_on':
    case 'vibrate_off': {
      ctx.fillStyle = '#E8CFAC';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.65;
      ctx.beginPath();
      roundRectPath(ctx, -4.6, -8.0, 9.2, 16.0, 2.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FFF9EE';
      ctx.fillRect(-3.0, -5.4, 6.0, 9.8);
      if (kind === 'vibrate_on') {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.55;
        for (const dir of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(dir * 7.2, -4.8);
          ctx.lineTo(dir * 8.4, -2.4);
          ctx.lineTo(dir * 7.0, 0);
          ctx.lineTo(dir * 8.4, 2.4);
          ctx.lineTo(dir * 7.2, 4.8);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = '#B84A46';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(-7.2, -6.2);
        ctx.lineTo(7.2, 6.2);
        ctx.stroke();
      }
      break;
    }

    case 'sparkle': {
      ctx.fillStyle = '#382417';
      ctx.beginPath();
      ctx.moveTo(0, -9.2);
      ctx.quadraticCurveTo(1.4, -1.4, 9.2, 0);
      ctx.quadraticCurveTo(1.4, 1.4, 0, 9.2);
      ctx.quadraticCurveTo(-1.4, 1.4, -9.2, 0);
      ctx.quadraticCurveTo(-1.4, -1.4, 0, -9.2);
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
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-5.0, -5.0);
      ctx.lineTo(5.0, 5.0);
      ctx.moveTo(5.0, -5.0);
      ctx.lineTo(-5.0, 5.0);
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
    Math.min(21, r.w * 0.53),
    tokens
  );
  if (label) {
    drawInkText(ctx, label, r.x + r.w * 0.5, r.y + r.h + 12, tokens, {
      font: `600 11px ${tokens.typography.fontFamily}`,
      color: '#382417',
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
 * 1:1 还原《启动页》与《图鉴弹窗》顶部的微拱卷边和纸飘带横幅
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
  const arch = 7.0;
  const ink = '#382417';

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const dir of [-1, 1]) {
    ctx.fillStyle = '#E4D0AE';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.45;
    ctx.beginPath();
    ctx.moveTo(dir * (hw - 8), -hh + 8);
    ctx.lineTo(dir * (hw + 25), -hh + 15);
    ctx.lineTo(dir * (hw + 15), 4);
    ctx.lineTo(dir * (hw + 27), hh + 12);
    ctx.lineTo(dir * (hw - 4), hh + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#B8976E';
    ctx.beginPath();
    ctx.moveTo(dir * hw, hh + 2);
    ctx.lineTo(dir * (hw - 9), hh + 8);
    ctx.lineTo(dir * (hw - 7), hh - 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(20, 12, 6, 0.14)';
  ctx.beginPath();
  ctx.moveTo(-hw, -hh + 4.5);
  ctx.quadraticCurveTo(0, -hh - arch + 4.5, hw, -hh + 4.5);
  ctx.lineTo(hw - 3, hh + 4.5);
  ctx.quadraticCurveTo(0, hh - arch + 4.5, -hw + 3, hh + 4.5);
  ctx.closePath();
  ctx.fill();

  const g = ctx.createLinearGradient(0, -hh - arch, 0, hh);
  g.addColorStop(0, '#FDF8EC');
  g.addColorStop(1, '#F1E3C7');
  ctx.fillStyle = g;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.55;
  ctx.beginPath();
  ctx.moveTo(-hw, -hh + 2);
  ctx.quadraticCurveTo(0, -hh - arch, hw, -hh + 2);
  ctx.lineTo(hw - 3, hh + 2);
  ctx.quadraticCurveTo(0, hh - arch + 1, -hw + 3, hh + 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  drawInkText(ctx, text, 0, -2.0, tokens, {
    font: `700 ${fontSize}px ${tokens.typography.fontFamily}`,
    color: '#2B1A0F',
    boldStrokeWidth: 0.35,
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
    dy = 1.5;
  } else if (opts.pulse) {
    scale = 1 + 0.018 * Math.sin(opts.pulsePhase || 0);
  }

  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  const lr: Rect = { x: -r.w * 0.5, y: -r.h * 0.5, w: r.w, h: r.h };

  const hex = (opts.fillHex || '').toUpperCase();
  const isGreen = hex === '#15803D' || hex === '#1F7A44';
  const isOrange = hex === '#C2410C';
  const isBlue = hex === '#0369A1';

  // 日系手绘水彩粉彩与浅桦木按钮配色（去除厚重复古深棕高光反差）
  const topCol = isGreen ? '#257F48' : isOrange ? '#DF8972' : isBlue ? '#78A8CC' : '#EAD5B5';
  const botCol = isGreen ? '#1E6E3D' : isOrange ? '#C96D56' : isBlue ? '#5D8FB5' : '#DBBE96';
  const lipCol = isGreen ? '#154D2B' : isOrange ? '#9B4D3A' : isBlue ? '#426B8A' : '#B49168';
  const borderCol = isGreen ? '#14291B' : '#352216';
  const textCol = opts.textColor || (isGreen || isOrange || isBlue ? '#FFFFFF' : '#352216');

  if (!opts.pressed) {
    ctx.fillStyle = 'rgba(16, 10, 6, 0.18)';
    ctx.beginPath();
    roundRectPath(ctx, lr.x + 0.5, lr.y + 3.2, lr.w - 1, lr.h, rad);
    ctx.fill();

    ctx.fillStyle = lipCol;
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1.45;
    ctx.beginPath();
    roundRectPath(ctx, lr.x, lr.y + 2.2, lr.w, lr.h, rad);
    ctx.fill();
    ctx.stroke();
  }

  const grad = ctx.createLinearGradient(0, lr.y, 0, lr.y + lr.h);
  grad.addColorStop(0, topCol);
  grad.addColorStop(1, botCol);
  ctx.fillStyle = grad;
  ctx.strokeStyle = borderCol;
  ctx.lineWidth = 1.55;
  ctx.beginPath();
  roundRectPath(ctx, lr.x, lr.y, lr.w, lr.h, rad);
  ctx.fill();
  ctx.stroke();

  if (!isGreen && !isOrange && !isBlue) {
    // 浅桦木手绘细铅笔木纹（对齐《通关结算弹窗》左下角重玩木钮）
    ctx.strokeStyle = 'rgba(104, 68, 36, 0.20)';
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(lr.x + 6, lr.y + lr.h * 0.28);
    ctx.quadraticCurveTo(0, lr.y + lr.h * 0.22, lr.x + lr.w - 6, lr.y + lr.h * 0.31);
    ctx.moveTo(lr.x + 5, lr.y + lr.h * 0.76);
    ctx.bezierCurveTo(-lr.w * 0.1, lr.y + lr.h * 0.70, lr.w * 0.12, lr.y + lr.h * 0.83, lr.x + lr.w - 5, lr.y + lr.h * 0.74);
    ctx.stroke();
  }

  const fSize = opts.fontSize || 15;
  const font = `700 ${fSize}px ${tokens.typography.fontFamily}`;
  const isLight = textCol.toUpperCase() === '#FFFFFF' || textCol.toUpperCase() === '#FFFDF8';

  const renderLabel = (tx: number, ty: number, maxW: number) => {
    if (!label) return;
    if (isLight) {
      drawInkText(ctx, label, tx, ty, tokens, {
        font,
        color: textCol,
        embossColor: 'rgba(0, 0, 0, 0.18)',
        slant: opts.slantLabel ? -0.08 : 0,
        boldStrokeWidth: 0.35,
        maxWidth: maxW,
      });
    } else {
      drawInkText(ctx, label, tx, ty, tokens, {
        font,
        color: textCol,
        slant: opts.slantLabel ? -0.08 : 0,
        boldStrokeWidth: 0.3,
        maxWidth: maxW,
      });
    }
  };

  if (opts.glyph && !label) {
    drawHandDrawnGlyph(ctx, opts.glyph, 0, 0, opts.iconSize || Math.min(25, r.h * 0.54), tokens);
  } else if (opts.glyph && label) {
    const isz = opts.iconSize || 18;
    if (opts.glyph === 'play') {
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
 * 1:1 还原《图鉴弹窗》《选关抽屉》《结算弹窗》的日系浅桦木窄画框 + 温暖和纸内衬板
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

  const bgImg = bgSpriteId ? sprites.get(bgSpriteId) : null;
  if (bgImg && drawCoverImage(ctx, bgImg, screenW, screenH)) {
    ctx.fillStyle = 'rgba(10, 15, 26, 0.38)';
    ctx.fillRect(0, 0, screenW, screenH);
  } else {
    ctx.fillStyle = 'rgba(12, 18, 32, 0.60)';
    ctx.fillRect(0, 0, screenW, screenH);
  }

  ctx.fillStyle = 'rgba(8, 6, 4, 0.34)';
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x + 2, panelRect.y + 6, panelRect.w - 4, panelRect.h, 13);
  ctx.fill();

  const woodGrad = ctx.createLinearGradient(panelRect.x, panelRect.y, panelRect.x + panelRect.w, panelRect.y + panelRect.h);
  woodGrad.addColorStop(0, '#E7C89E');
  woodGrad.addColorStop(0.5, '#D7B282');
  woodGrad.addColorStop(1, '#C59B69');
  ctx.fillStyle = woodGrad;
  ctx.strokeStyle = '#382417';
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x, panelRect.y, panelRect.w, panelRect.h, 12);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(96, 58, 26, 0.20)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(panelRect.x + 4, panelRect.y + 18);
  ctx.lineTo(panelRect.x + 4, panelRect.y + panelRect.h - 18);
  ctx.moveTo(panelRect.x + panelRect.w - 4, panelRect.y + 24);
  ctx.lineTo(panelRect.x + panelRect.w - 4, panelRect.y + panelRect.h - 24);
  ctx.stroke();

  const inset = 7.5;
  const ix = panelRect.x + inset;
  const iy = panelRect.y + inset;
  const iw = panelRect.w - inset * 2;
  const ih = panelRect.h - inset * 2;

  const pGrad = ctx.createLinearGradient(0, iy, 0, iy + ih);
  pGrad.addColorStop(0, '#FDF9F0');
  pGrad.addColorStop(1, '#F7EFE0');
  ctx.fillStyle = pGrad;
  ctx.strokeStyle = '#4A3120';
  ctx.lineWidth = 1.35;

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

    ctx.fillStyle = '#EBDDCA';
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
