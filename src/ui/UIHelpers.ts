import type { SpriteProvider } from '../engine/SandRenderer';
import { roundRectPath } from '../platform/CanvasPolyfill';
import type { Rect, UiTokensFile } from '../types/ui';

export { roundRectPath };

export function hitRect(px: number, py: number, r: Rect | null | undefined): boolean {
  if (!r) return false;
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// ============================================================================
// 1. 日系治愈极简排版系统（Minimalist Healing Typography）
// ============================================================================

export interface InkTextOptions {
  font?: string;
  color?: string;
  embossColor?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  maxWidth?: number;
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
  ctx.font = opts.font || `600 13px ${tokens.typography.fontFamily}`;
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = opts.baseline || 'middle';
  const emboss = opts.embossColor ?? 'rgba(255, 255, 255, 0.78)';
  if (emboss) {
    ctx.fillStyle = emboss;
    if (opts.maxWidth) ctx.fillText(text, x, y + 0.8, opts.maxWidth);
    else ctx.fillText(text, x, y + 0.8);
  }
  ctx.fillStyle = opts.color || '#4B403B';
  if (opts.maxWidth) ctx.fillText(text, x, y, opts.maxWidth);
  else ctx.fillText(text, x, y);
  ctx.restore();
}

export interface PlaqueTextOptions {
  font?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  align?: CanvasTextAlign;
  maxWidth?: number;
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
  ctx.font = opts.font || `700 15px ${tokens.typography.fontFamily}`;
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const sw = opts.strokeWidth ?? 1.6;
  const stroke = opts.stroke || 'rgba(66, 56, 52, 0.72)';
  const shadow = opts.shadowColor ?? 'rgba(30, 26, 44, 0.22)';

  if (shadow && sw > 0) {
    ctx.fillStyle = shadow;
    if (opts.maxWidth) ctx.fillText(text, x, y + 1.2, opts.maxWidth);
    else ctx.fillText(text, x, y + 1.2);
  }
  if (sw > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sw * 1.6;
    if (opts.maxWidth) ctx.strokeText(text, x, y, opts.maxWidth);
    else ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = opts.fill || '#FFFDFB';
  if (opts.maxWidth) ctx.fillText(text, x, y, opts.maxWidth);
  else ctx.fillText(text, x, y);
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
}

export function drawStatusPill(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
  tokens: UiTokensFile,
  opts: StatusPillOptions = {}
): Rect {
  const fSize = opts.fontSize || 10;
  const font = `700 ${fSize}px ${tokens.typography.fontFamily}`;
  ctx.save();
  ctx.font = font;
  const tw = ctx.measureText(text).width;
  const h = opts.height || Math.round(fSize + 8);
  const w = Math.max(h + 6, Math.ceil(tw + (opts.padX ?? 12)));
  const r: Rect = { x: cx - w * 0.5, y: cy - h * 0.5, w, h };

  ctx.fillStyle = opts.bgHex || 'rgba(255, 253, 249, 0.92)';
  ctx.strokeStyle = opts.borderHex || 'rgba(104, 92, 84, 0.36)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, h * 0.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = opts.textColor || '#4B403B';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 0.5);
  ctx.restore();
  return r;
}

// ============================================================================
// 2. 九宫格底层辅助
// ============================================================================

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
// 3. 日系治愈极简磨砂奶油卡片与胶囊组件（静谧星夜轻绘风，彻底告别厚重复古木匾）
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
    innerGlow: string;
  }
> = {
  parchment: {
    faceTop: 'rgba(255, 254, 251, 0.94)',
    faceBot: 'rgba(247, 243, 235, 0.92)',
    border: '#7A6B63',
    lip: 'rgba(122, 107, 99, 0.22)',
    innerGlow: 'rgba(255, 255, 255, 0.92)',
  },
  amber: {
    faceTop: '#FFFDF4',
    faceBot: '#FBF0CF',
    border: '#A6854B',
    lip: 'rgba(166, 133, 75, 0.24)',
    innerGlow: 'rgba(255, 255, 255, 0.92)',
  },
  mint: {
    faceTop: '#F7FCF8',
    faceBot: '#E1F3E6',
    border: '#5E8D6D',
    lip: 'rgba(94, 141, 109, 0.22)',
    innerGlow: 'rgba(255, 255, 255, 0.92)',
  },
  sky: {
    faceTop: '#F5FAFE',
    faceBot: '#E1EFF9',
    border: '#5D87A6',
    lip: 'rgba(93, 135, 166, 0.22)',
    innerGlow: 'rgba(255, 255, 255, 0.92)',
  },
  rose: {
    faceTop: '#FFF8F9',
    faceBot: '#FAE4E7',
    border: '#A86E76',
    lip: 'rgba(168, 110, 118, 0.22)',
    innerGlow: 'rgba(255, 255, 255, 0.92)',
  },
  lavender: {
    faceTop: '#FAF8FE',
    faceBot: '#ECE5F8',
    border: '#7B6D9A',
    lip: 'rgba(123, 109, 154, 0.22)',
    innerGlow: 'rgba(255, 255, 255, 0.92)',
  },
  locked: {
    faceTop: 'rgba(244, 242, 238, 0.88)',
    faceBot: 'rgba(230, 226, 220, 0.88)',
    border: '#9C948B',
    lip: 'rgba(120, 112, 104, 0.16)',
    innerGlow: 'rgba(255, 255, 255, 0.65)',
  },
  walnut: {
    faceTop: 'rgba(46, 51, 74, 0.90)',
    faceBot: 'rgba(34, 38, 58, 0.92)',
    border: 'rgba(255, 250, 240, 0.42)',
    lip: 'rgba(16, 18, 30, 0.28)',
    innerGlow: 'rgba(255, 255, 255, 0.18)',
  },
};

export interface DoubleRimPlaqueOptions {
  variant?: StorybookTileVariant;
  rimThickness?: number;
  radius?: number;
  pressed?: boolean;
  shadow?: boolean;
}

/**
 * 日系治愈磨砂奶油胶囊 / 圆形图标钮
 */
export function drawDoubleRimPlaque(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  _tokens: UiTokensFile,
  opts: DoubleRimPlaqueOptions = {}
): Rect {
  const pal = VARIANT_PALETTES[opts.variant || 'parchment'];
  const rad = opts.radius ?? Math.min(r.w, r.h) * 0.5;
  const inset = Math.min(3, opts.rimThickness ?? 2.4);
  const dy = opts.pressed ? 1.5 : 0;

  ctx.save();
  if (opts.shadow !== false && !opts.pressed) {
    ctx.fillStyle = 'rgba(32, 28, 48, 0.12)';
    ctx.beginPath();
    roundRectPath(ctx, r.x, r.y + 2.6, r.w, r.h, rad);
    ctx.fill();
  }

  ctx.fillStyle = pal.lip;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y + 1.5, r.w, r.h, rad);
  ctx.fill();

  const faceGrad = ctx.createLinearGradient(r.x, r.y + dy, r.x, r.y + r.h + dy);
  faceGrad.addColorStop(0, pal.faceTop);
  faceGrad.addColorStop(1, pal.faceBot);

  ctx.fillStyle = faceGrad;
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.45;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y + dy, r.w, r.h, rad);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = pal.innerGlow;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  roundRectPath(
    ctx,
    r.x + 1.4,
    r.y + dy + 1.4,
    Math.max(2, r.w - 2.8),
    Math.max(2, r.h - 2.8),
    Math.max(2, rad - 1.4)
  );
  ctx.stroke();

  ctx.restore();
  return {
    x: r.x + inset,
    y: r.y + dy + inset,
    w: Math.max(4, r.w - inset * 2),
    h: Math.max(4, r.h - inset * 2),
  };
}

export interface CornerMedallionOptions {
  variant?: 'wood' | 'amber' | 'crimson' | 'sage' | 'muted';
  fontSize?: number;
}

/**
 * 道具右上角极简糖果小圆章角标（数量徽标）
 */
export function drawCornerMedallionBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  text: string,
  tokens: UiTokensFile,
  opts: CornerMedallionOptions = {}
): void {
  const kind = opts.variant || 'wood';
  let topCol = '#FFFDF8';
  let botCol = '#F3EAD9';
  let borderCol = '#7A6B63';
  let textCol = '#4B403B';

  if (kind === 'amber') {
    topCol = '#FFF5CC';
    botCol = '#F9DC82';
    borderCol = '#9E7B34';
    textCol = '#5C4214';
  } else if (kind === 'crimson') {
    topCol = '#F9A8AE';
    botCol = '#E47882';
    borderCol = '#8C444B';
    textCol = '#FFFDFB';
  } else if (kind === 'sage') {
    topCol = '#A6DFB8';
    botCol = '#72BE8B';
    borderCol = '#437755';
    textCol = '#FFFDFB';
  } else if (kind === 'muted') {
    topCol = '#EDEBE6';
    botCol = '#DAD6CE';
    borderCol = '#9E978E';
    textCol = '#7D766E';
  }

  ctx.save();
  ctx.fillStyle = 'rgba(32, 28, 48, 0.14)';
  ctx.beginPath();
  ctx.arc(cx, cy + 1.4, radius + 0.3, 0, Math.PI * 2);
  ctx.fill();

  const g = ctx.createLinearGradient(cx, cy - radius, cx, cy + radius);
  g.addColorStop(0, topCol);
  g.addColorStop(1, botCol);
  ctx.fillStyle = g;
  ctx.strokeStyle = borderCol;
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const fSize = opts.fontSize || (text.length >= 3 ? Math.max(8, radius * 0.72) : Math.max(9.5, radius * 0.94));
  const isNum = /^[+×xX0-9/]+$/.test(text);
  const font = `700 ${fSize}px ${isNum ? tokens.typography.numeralFontFamily : tokens.typography.fontFamily}`;

  if (textCol === '#FFFDFB') {
    drawPlaqueText(ctx, text, cx, cy + 0.5, tokens, {
      font,
      fill: '#FFFDFB',
      stroke: borderCol,
      strokeWidth: 1.1,
      shadowColor: '',
    });
  } else {
    drawInkText(ctx, text, cx, cy + 0.5, tokens, {
      font,
      color: textCol,
      embossColor: 'rgba(255,255,255,0.7)',
    });
  }
  ctx.restore();
}

export interface RecessedTileOptions {
  variant?: StorybookTileVariant;
  radius?: number;
  rimWidth?: number;
  pressed?: boolean;
  disabled?: boolean;
  pulse?: boolean;
  pulsePhase?: number;
  medallionText?: string;
  medallionVariant?: CornerMedallionOptions['variant'];
  medallionRadius?: number;
}

/**
 * 日系治愈磨砂奶油圆角卡片（用于底栏纯图标钮、选关矩阵格、战绩卡）
 */
export function drawRecessedTileCard(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile,
  opts: RecessedTileOptions = {}
): Rect {
  const pal = VARIANT_PALETTES[opts.variant || 'parchment'];
  const rad = opts.radius ?? 15;
  const pad = Math.min(3.5, opts.rimWidth ?? 3.0);

  ctx.save();
  if (opts.disabled) {
    ctx.globalAlpha = 0.56;
  }

  let dy = 0;
  let scale = 1;
  if (!opts.disabled && opts.pressed) {
    dy = 1.8;
    scale = 0.96;
  } else if (!opts.disabled && opts.pulse) {
    const p = Math.sin(opts.pulsePhase || 0);
    scale = 1 + 0.024 * p;
    ctx.save();
    ctx.strokeStyle = '#F6CE6C';
    ctx.globalAlpha = 0.5 + 0.3 * p;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    roundRectPath(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, rad + 2);
    ctx.stroke();
    ctx.restore();
  }

  const cx = r.x + r.w * 0.5;
  const cy = r.y + r.h * 0.5;
  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  const lr: Rect = { x: -r.w * 0.5, y: -r.h * 0.5, w: r.w, h: r.h };

  if (!opts.pressed) {
    ctx.fillStyle = 'rgba(32, 28, 48, 0.12)';
    ctx.beginPath();
    roundRectPath(ctx, lr.x + 0.5, lr.y + 3.0, lr.w - 1, lr.h, rad);
    ctx.fill();
  }

  ctx.fillStyle = pal.lip;
  ctx.beginPath();
  roundRectPath(ctx, lr.x, lr.y + (opts.pressed ? 0.8 : 2.0), lr.w, lr.h, rad);
  ctx.fill();

  const faceGrad = ctx.createLinearGradient(0, lr.y, 0, lr.y + lr.h);
  faceGrad.addColorStop(0, pal.faceTop);
  faceGrad.addColorStop(1, pal.faceBot);

  ctx.fillStyle = faceGrad;
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.45;
  ctx.beginPath();
  roundRectPath(ctx, lr.x, lr.y, lr.w, lr.h, rad);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = pal.innerGlow;
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  roundRectPath(
    ctx,
    lr.x + 1.5,
    lr.y + 1.5,
    Math.max(4, lr.w - 3.0),
    Math.max(4, lr.h - 3.0),
    Math.max(3, rad - 1.5)
  );
  ctx.stroke();

  if (opts.medallionText !== undefined && opts.medallionText !== '') {
    const mr = opts.medallionRadius ?? 9.8;
    drawCornerMedallionBadge(
      ctx,
      lr.x + lr.w - mr * 0.45,
      lr.y + mr * 0.45,
      mr,
      opts.medallionText,
      tokens,
      { variant: opts.medallionVariant || 'wood' }
    );
  }

  ctx.restore();

  return {
    x: r.x + pad,
    y: r.y + dy + pad,
    w: Math.max(8, r.w - pad * 2),
    h: Math.max(8, r.h - pad * 2),
  };
}

// ============================================================================
// 4. 日系治愈轻绘矢量图标库（零系统 Emoji，极简图形语言）
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
  const s = size / 32;
  const ink = '#52453F';

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kind) {
    case 'grid': {
      // 极简四宫格圆角选关图标
      const cells: [number, number, string][] = [
        [-8.5, -8.5, '#F5B0B6'],
        [1.5, -8.5, '#F7D982'],
        [-8.5, 1.5, '#92C7E8'],
        [1.5, 1.5, '#9BD5AE'],
      ];
      for (const [gx, gy, fill] of cells) {
        ctx.fillStyle = fill;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.65;
        ctx.beginPath();
        roundRectPath(ctx, gx, gy, 7.0, 7.0, 2.2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }

    case 'question': {
      // 极简治愈问号图标
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, -3.5, 5.2, -Math.PI * 0.85, Math.PI * 0.22, false);
      ctx.quadraticCurveTo(3.2, 1.2, 0, 2.8);
      ctx.lineTo(0, 4.4);
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(0, 8.8, 1.7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'play': {
      ctx.fillStyle = '#FFFDFB';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-5.5, -7.5);
      ctx.lineTo(7.5, 0);
      ctx.lineTo(-5.5, 7.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'snowflake': {
      ctx.strokeStyle = '#3F7BA6';
      ctx.lineWidth = 2.0;
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
      ctx.fillStyle = '#FFFDF7';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.85;
      ctx.beginPath();
      ctx.arc(0, 0.8, 8.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -8.2);
      ctx.lineTo(0, -10.5);
      ctx.moveTo(-2.5, -10.5);
      ctx.lineTo(2.5, -10.5);
      ctx.moveTo(0, 0.8);
      ctx.lineTo(0, -4.0);
      ctx.moveTo(0, 0.8);
      ctx.lineTo(3.6, 2.6);
      ctx.stroke();
      break;
    }

    case 'steps': {
      ctx.fillStyle = '#A8D4EE';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(-4, 2, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#F7D982';
      ctx.beginPath();
      ctx.arc(4.5, -2.5, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'undo': {
      // 清透海盐蓝圆润回退弯箭头
      const g = ctx.createLinearGradient(0, -10, 0, 10);
      g.addColorStop(0, '#B5DFF6');
      g.addColorStop(1, '#7CB8DE');
      ctx.fillStyle = g;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.85;
      ctx.beginPath();
      ctx.moveTo(-12.0, -1.5);
      ctx.lineTo(-2.6, -9.8);
      ctx.lineTo(-2.6, -4.6);
      ctx.bezierCurveTo(7.2, -5.0, 12.2, 0.4, 11.2, 9.2);
      ctx.bezierCurveTo(8.2, 3.8, 3.6, 1.6, -2.6, 2.0);
      ctx.lineTo(-2.6, 7.0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'vacuum':
    case 'magnet': {
      // 樱花珊瑚粉 U 形治愈吸沙磁铁 + 星粒
      ctx.save();
      ctx.rotate(-0.22);
      const magGrad = ctx.createLinearGradient(-9, -9, 9, 9);
      magGrad.addColorStop(0, '#F7A8B0');
      magGrad.addColorStop(1, '#E27882');
      ctx.fillStyle = magGrad;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.85;
      ctx.beginPath();
      ctx.arc(0, 1.8, 9.4, 0, Math.PI, false);
      ctx.lineTo(-9.4, -7.8);
      ctx.lineTo(-4.2, -7.8);
      ctx.lineTo(-4.2, 1.8);
      ctx.arc(0, 1.8, 4.2, Math.PI, 0, true);
      ctx.lineTo(4.2, -7.8);
      ctx.lineTo(9.4, -7.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFFDF9';
      for (const lx of [-9.4, 4.2]) {
        ctx.beginPath();
        roundRectPath(ctx, lx, -8.2, 5.2, 3.8, 1.2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      const sparks: [number, number, string][] = [
        [-3.8, -11.2, '#F7D97E'],
        [2.4, -12.0, '#F4A6AE'],
        [7.4, -10.2, '#8CC5E6'],
      ];
      for (const [sx, sy, col] of sparks) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'extra_slot': {
      // 圆润透明糖果玻璃瓶 + 樱花粉蝴蝶结丝带 + 薄荷绿「+」角标（彻底告别旧木桶图标！）
      const jarGrad = ctx.createLinearGradient(-8, -6, 8, 10);
      jarGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      jarGrad.addColorStop(0.55, 'rgba(229, 244, 252, 0.82)');
      jarGrad.addColorStop(1, 'rgba(208, 232, 246, 0.88)');

      ctx.fillStyle = jarGrad;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      // 瓶腹圆球
      ctx.beginPath();
      ctx.arc(-1.5, 2.6, 8.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 瓶口翻唇
      ctx.fillStyle = '#FFFDFB';
      ctx.beginPath();
      roundRectPath(ctx, -6.5, -9.2, 10.0, 3.6, 1.8);
      ctx.fill();
      ctx.stroke();

      // 瓶颈樱花粉蝴蝶结丝带
      ctx.fillStyle = '#F39EA7';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(-5.0, -4.8, 3.4, 2.0, -0.25, 0, Math.PI * 2);
      ctx.ellipse(2.0, -4.8, 3.4, 2.0, 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-1.5, -4.8, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 瓶壁高光弧
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(-1.5, 2.6, 5.8, Math.PI * 0.85, Math.PI * 1.32);
      ctx.stroke();

      // 右下若竹绿「+」圆章
      ctx.fillStyle = '#7CC596';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(7.4, 6.2, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(7.4, 3.8);
      ctx.lineTo(7.4, 8.6);
      ctx.moveTo(5.0, 6.2);
      ctx.lineTo(9.8, 6.2);
      ctx.stroke();
      break;
    }

    case 'restart': {
      // 极简日系圆弧刷新图标 ↻
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0.5, 8.2, -Math.PI * 0.72, Math.PI * 0.82, false);
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(6.8, -7.8);
      ctx.lineTo(7.6, -1.6);
      ctx.lineTo(1.5, -3.2);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'shuffle': {
      // 若竹绿 + 暖麦黄双流线交错箭头
      ctx.strokeStyle = '#62A87C';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-10.2, 5.4);
      ctx.bezierCurveTo(-2.4, 5.4, -1.4, -5.4, 7.2, -5.4);
      ctx.stroke();

      ctx.fillStyle = '#62A87C';
      ctx.beginPath();
      ctx.moveTo(11.0, -5.4);
      ctx.lineTo(5.8, -8.8);
      ctx.lineTo(5.8, -2.0);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#E0A84C';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-10.2, -5.4);
      ctx.bezierCurveTo(-2.4, -5.4, -1.4, 5.4, 7.2, 5.4);
      ctx.stroke();

      ctx.fillStyle = '#E0A84C';
      ctx.beginPath();
      ctx.moveTo(11.0, 5.4);
      ctx.lineTo(5.8, 2.0);
      ctx.lineTo(5.8, 8.8);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'home': {
      ctx.fillStyle = '#FFFDF7';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      roundRectPath(ctx, -7.2, -0.8, 14.4, 10.2, 2.2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#EE9FA6';
      ctx.beginPath();
      ctx.moveTo(-10.2, 0.2);
      ctx.lineTo(0, -9.2);
      ctx.lineTo(10.2, 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'gear': {
      ctx.fillStyle = '#F5E6CE';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.75;
      const teeth = 8;
      ctx.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i * Math.PI) / teeth - Math.PI / (teeth * 2);
        const rr = i % 2 === 0 ? 10.4 : 7.8;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFFDFB';
      ctx.beginPath();
      ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'lock': {
      ctx.strokeStyle = '#7E746C';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, -3.4, 4.8, Math.PI, 0, false);
      ctx.stroke();

      ctx.fillStyle = '#EFE9DF';
      ctx.strokeStyle = '#7E746C';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      roundRectPath(ctx, -7.0, -3.0, 14.0, 11.0, 3.2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#7E746C';
      ctx.beginPath();
      ctx.arc(0, 2.2, 1.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'crown': {
      ctx.fillStyle = '#FAD978';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(-8.8, 6.0);
      ctx.lineTo(-9.8, -4.0);
      ctx.lineTo(-3.8, 0.8);
      ctx.lineTo(0, -6.8);
      ctx.lineTo(3.8, 0.8);
      ctx.lineTo(9.8, -4.0);
      ctx.lineTo(8.8, 6.0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'gift': {
      ctx.fillStyle = '#F5A6AE';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      roundRectPath(ctx, -8.0, -2.0, 16, 10.5, 2.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FCE295';
      ctx.fillRect(-1.8, -2.0, 3.6, 10.5);
      ctx.strokeRect(-1.8, -2.0, 3.6, 10.5);
      break;
    }

    case 'check': {
      ctx.fillStyle = '#75BF8E';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, 9.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.3;
      ctx.beginPath();
      ctx.moveTo(-4.0, 0.2);
      ctx.lineTo(-1.0, 3.4);
      ctx.lineTo(4.4, -3.0);
      ctx.stroke();
      break;
    }

    case 'cloud': {
      ctx.fillStyle = '#E1F1FC';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.arc(-4.2, 2, 4.8, Math.PI * 0.5, Math.PI * 1.6);
      ctx.arc(1.4, -2.0, 5.8, Math.PI * 1.05, Math.PI * 1.95);
      ctx.arc(6.4, 2.0, 4.4, -Math.PI * 0.4, Math.PI * 0.5);
      ctx.lineTo(-4.2, 6.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'sound_on':
    case 'sound_off': {
      ctx.fillStyle = '#F7E7CA';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-9.0, -3.2);
      ctx.lineTo(-4.2, -3.2);
      ctx.lineTo(2.2, -8.2);
      ctx.lineTo(2.2, 8.2);
      ctx.lineTo(-4.2, 3.2);
      ctx.lineTo(-9.0, 3.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (kind === 'sound_on') {
        ctx.strokeStyle = '#5BA376';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(3.4, 0, 4.8, -0.72, 0.72);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(3.4, 0, 8.2, -0.72, 0.72);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#D46E76';
        ctx.lineWidth = 2.1;
        ctx.beginPath();
        ctx.moveTo(5.0, -3.5);
        ctx.lineTo(10.5, 3.5);
        ctx.moveTo(10.5, -3.5);
        ctx.lineTo(5.0, 3.5);
        ctx.stroke();
      }
      break;
    }

    case 'vibrate_on':
    case 'vibrate_off': {
      ctx.fillStyle = '#FFFDF9';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      roundRectPath(ctx, -4.8, -8.0, 9.6, 16, 2.6);
      ctx.fill();
      ctx.stroke();
      if (kind === 'vibrate_on') {
        ctx.strokeStyle = '#6BA4C8';
        ctx.lineWidth = 1.9;
        for (const dir of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(0, 0, 8.6, dir > 0 ? -0.55 : Math.PI - 0.55, dir > 0 ? 0.55 : Math.PI + 0.55);
          ctx.stroke();
        }
      }
      break;
    }

    case 'book': {
      ctx.fillStyle = '#DCEEFB';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      roundRectPath(ctx, -8.8, -7.8, 17.6, 15.6, 3.0);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FFFDFB';
      ctx.beginPath();
      roundRectPath(ctx, -5.8, -5.4, 11.8, 10.8, 1.8);
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'sparkle': {
      ctx.fillStyle = '#FCE181';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.55;
      ctx.beginPath();
      ctx.moveTo(0, -9.8);
      ctx.quadraticCurveTo(1.6, -1.6, 9.8, 0);
      ctx.quadraticCurveTo(1.6, 1.6, 0, 9.8);
      ctx.quadraticCurveTo(-1.6, 1.6, -9.8, 0);
      ctx.quadraticCurveTo(-1.6, -1.6, 0, -9.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'close': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.6;
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

// ============================================================================
// 5. 极简设置拨杆组件（图标优先，零多余修饰）
// ============================================================================

export function drawWoodToggleCard(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  isOn: boolean,
  glyphOn: HandDrawnGlyphKind,
  glyphOff: HandDrawnGlyphKind,
  tokens: UiTokensFile
): void {
  const inner = drawRecessedTileCard(ctx, r, tokens, {
    variant: isOn ? 'mint' : 'parchment',
    radius: r.h * 0.46,
    rimWidth: 2.5,
  });

  drawHandDrawnGlyph(
    ctx,
    isOn ? glyphOn : glyphOff,
    inner.x + (label ? 16 : inner.w * 0.34),
    inner.y + inner.h * 0.5,
    20,
    tokens
  );

  if (label) {
    drawInkText(ctx, label, inner.x + 31, inner.y + inner.h * 0.5, tokens, {
      font: `600 11.5px ${tokens.typography.fontFamily}`,
      align: 'left',
      color: '#4B403B',
    });
  }

  const sw = 38;
  const sh = 20;
  const sx = inner.x + inner.w - sw - 6;
  const sy = inner.y + (inner.h - sh) * 0.5;

  ctx.save();
  ctx.fillStyle = isOn ? '#74BE8E' : '#CFCAC2';
  ctx.strokeStyle = '#6A5B53';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  roundRectPath(ctx, sx, sy, sw, sh, sh * 0.5);
  ctx.fill();
  ctx.stroke();

  const knobR = sh * 0.5 - 2.2;
  const knobCx = isOn ? sx + sw - sh * 0.5 : sx + sh * 0.5;
  const knobCy = sy + sh * 0.5;

  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#6A5B53';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(knobCx, knobCy, knobR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ============================================================================
// 6. 日系治愈柔和糖果胶囊按钮、轻绘丝带提示条与磨砂星夜弹窗
// ============================================================================

function mapFillToHealingButtonStyle(fillHex?: string): {
  topGrad: string;
  botGrad: string;
  border: string;
  lip: string;
  textCol: string;
} {
  const up = (fillHex || '').toUpperCase();
  if (up === '#15803D' || up === '#10B981' || up === '#68B888') {
    // 治愈若竹薄荷绿（主行动按钮）
    return {
      topGrad: '#92D6AA',
      botGrad: '#68B886',
      border: '#467C5B',
      lip: 'rgba(70, 124, 91, 0.28)',
      textCol: '#FFFDFB',
    };
  }
  if (up === '#0369A1' || up === '#0284C7' || up === '#38BDF8') {
    // 清透海盐晴空蓝
    return {
      topGrad: '#99CEEE',
      botGrad: '#6CAAD4',
      border: '#447294',
      lip: 'rgba(68, 114, 148, 0.26)',
      textCol: '#FFFDFB',
    };
  }
  if (up === '#C2410C' || up === '#EA580C' || up === '#DC2626') {
    // 柔和樱花珊瑚粉
    return {
      topGrad: '#F6ABB2',
      botGrad: '#E07F89',
      border: '#8E4B53',
      lip: 'rgba(142, 75, 83, 0.26)',
      textCol: '#FFFDFB',
    };
  }
  // 默认暖麦奶油色（次要行动按钮）
  return {
    topGrad: '#FFFDF6',
    botGrad: '#F5E5C2',
    border: '#8B7455',
    lip: 'rgba(139, 116, 85, 0.22)',
    textCol: '#4B403B',
  };
}

export function drawWoodCapsule(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile,
  _bgHex?: string,
  _lipHex?: string,
  radius = 14
): void {
  drawDoubleRimPlaque(ctx, r, tokens, { variant: 'parchment', radius });
}

/**
 * 日系极简蝴蝶结丝带气泡横幅（轻盈磨砂奶油底 + 两侧淡粉小丝带耳）
 */
export function drawRibbonBanner(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  height: number,
  text: string,
  tokens: UiTokensFile,
  fontSize = 12
): void {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const rad = height * 0.5;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 柔和微影
  ctx.fillStyle = 'rgba(30, 26, 48, 0.14)';
  ctx.beginPath();
  roundRectPath(ctx, -hw, -hh + 2.5, width, height, rad);
  ctx.fill();

  // 两侧精致小丝带耳
  for (const dir of [-1, 1]) {
    ctx.fillStyle = '#F5B5BC';
    ctx.strokeStyle = '#7A6B63';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(dir * (hw - 4), -4.5);
    ctx.lineTo(dir * (hw + 9), -7.5);
    ctx.lineTo(dir * (hw + 6), 0);
    ctx.lineTo(dir * (hw + 9), 7.5);
    ctx.lineTo(dir * (hw - 4), 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 磨砂象牙白胶囊主体
  const g = ctx.createLinearGradient(0, -hh, 0, hh);
  g.addColorStop(0, 'rgba(255, 254, 251, 0.96)');
  g.addColorStop(1, 'rgba(247, 242, 233, 0.95)');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#7A6B63';
  ctx.lineWidth = 1.45;
  ctx.beginPath();
  roundRectPath(ctx, -hw, -hh, width, height, rad);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  roundRectPath(ctx, -hw + 1.5, -hh + 1.5, width - 3, height - 3, Math.max(2, rad - 1.5));
  ctx.stroke();

  drawInkText(ctx, text, 0, 0.5, tokens, {
    font: `700 ${fontSize}px ${tokens.typography.fontFamily}`,
    color: '#4B403B',
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
  drawRecessedTileCard(ctx, r, tokens, { variant: 'parchment', radius: 18 });
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
  const rad = Math.min(r.h * 0.5, 16);

  let scale = 1;
  let dy = 0;
  if (opts.disabled) {
    ctx.globalAlpha = tokens.motion.disabledAlpha;
  } else if (opts.pressed) {
    scale = tokens.motion.buttonPressScale;
    dy = 1.8;
  } else if (opts.pulse) {
    const p = Math.sin(opts.pulsePhase || 0);
    scale = 1 + 0.024 * p;
  }

  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  const lr: Rect = { x: -r.w * 0.5, y: -r.h * 0.5, w: r.w, h: r.h };

  const st = mapFillToHealingButtonStyle(opts.fillHex);

  if (!opts.pressed) {
    ctx.fillStyle = 'rgba(30, 26, 48, 0.14)';
    ctx.beginPath();
    roundRectPath(ctx, lr.x + 1, lr.y + 3.0, lr.w - 2, lr.h, rad);
    ctx.fill();
  }

  ctx.fillStyle = st.lip;
  ctx.beginPath();
  roundRectPath(ctx, lr.x, lr.y + 1.8, lr.w, lr.h, rad);
  ctx.fill();

  const grad = ctx.createLinearGradient(0, lr.y, 0, lr.y + lr.h);
  grad.addColorStop(0, st.topGrad);
  grad.addColorStop(1, st.botGrad);
  ctx.fillStyle = grad;
  ctx.strokeStyle = st.border;
  ctx.lineWidth = 1.55;
  ctx.beginPath();
  roundRectPath(ctx, lr.x, lr.y, lr.w, lr.h, rad);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  roundRectPath(ctx, lr.x + 1.6, lr.y + 1.5, Math.max(2, lr.w - 3.2), Math.max(2, lr.h - 3.2), Math.max(2, rad - 1.5));
  ctx.stroke();

  const fSize = opts.fontSize || 13.5;
  const font = `700 ${fSize}px ${tokens.typography.fontFamily}`;
  const textCol = opts.textColor || st.textCol;
  const isLightText = textCol.toUpperCase() === '#FFFDFB' || textCol.toUpperCase() === '#FFFFFF';

  const renderLabel = (tx: number, ty: number, maxW: number) => {
    if (!label) return;
    if (isLightText) {
      drawPlaqueText(ctx, label, tx, ty, tokens, {
        font,
        fill: textCol,
        stroke: st.border,
        strokeWidth: 1.4,
        maxWidth: maxW,
      });
    } else {
      drawInkText(ctx, label, tx, ty, tokens, {
        font,
        color: textCol,
        maxWidth: maxW,
      });
    }
  };

  if (opts.glyph && !label) {
    drawHandDrawnGlyph(ctx, opts.glyph, 0, 0, opts.iconSize || Math.min(24, r.h * 0.56), tokens);
  } else if (opts.glyph && label) {
    const isz = opts.iconSize || 20;
    const gx = lr.x + 18;
    drawHandDrawnGlyph(ctx, opts.glyph, gx, 0, isz, tokens);
    renderLabel((gx + isz * 0.5 + lr.x + lr.w - 8) * 0.5, 0.5, Math.max(32, r.w - isz - 26));
  } else {
    renderLabel(0, 0.5, r.w - 18);
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
  // 静谧星夜微透遮罩
  ctx.fillStyle = 'rgba(24, 27, 44, 0.58)';
  ctx.fillRect(0, 0, screenW, screenH);

  // 柔和漫射底影
  ctx.fillStyle = 'rgba(18, 20, 36, 0.24)';
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x + 1, panelRect.y + 6, panelRect.w - 2, panelRect.h, 22);
  ctx.fill();

  // 磨砂象牙白弹窗底板
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x, panelRect.y, panelRect.w, panelRect.h, 22);
  ctx.clip();

  const pGrad = ctx.createLinearGradient(0, panelRect.y, 0, panelRect.y + panelRect.h);
  pGrad.addColorStop(0, '#FFFDFB');
  pGrad.addColorStop(1, '#F6F1E7');
  ctx.fillStyle = pGrad;
  ctx.fillRect(panelRect.x, panelRect.y, panelRect.w, panelRect.h);

  const bgImg = bgSpriteId ? sprites.get(bgSpriteId) : null;
  if (bgImg) {
    ctx.globalAlpha = 0.08;
    ctx.drawImage(bgImg, panelRect.x, panelRect.y, panelRect.w, panelRect.h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  ctx.strokeStyle = '#7A6B63';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x, panelRect.y, panelRect.w, panelRect.h, 22);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x + 1.8, panelRect.y + 1.8, panelRect.w - 3.6, panelRect.h - 3.6, 20.5);
  ctx.stroke();

  if (title) {
    const plaqueW = Math.min(panelRect.w - 86, Math.max(136, title.length * 16 + 44));
    const plaqueRect: Rect = {
      x: panelRect.x + (panelRect.w - plaqueW) * 0.5,
      y: panelRect.y - 16,
      w: plaqueW,
      h: 34,
    };
    drawDoubleRimPlaque(ctx, plaqueRect, tokens, {
      variant: 'parchment',
      radius: 17,
    });
    drawInkText(ctx, title, plaqueRect.x + plaqueRect.w * 0.5, plaqueRect.y + 17.5, tokens, {
      font: `700 15px ${tokens.typography.fontFamily}`,
      color: '#4B403B',
      maxWidth: plaqueW - 22,
    });
  }

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
