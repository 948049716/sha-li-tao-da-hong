import type { SpriteProvider } from '../engine/SandRenderer';
import { roundRectPath } from '../platform/CanvasPolyfill';
import type { FigurineItem } from '../types/figurine';
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

// ============================================================================
// 1. 全局统一排版与墨迹字体系统（Typography & Letterpress Ink System）
//    - 浅色羊皮纸底面：浓棕手绘墨迹 + 1px 暖白压印高光（对齐 gameplay_ref.jpg 清晰纸本印刷感）
//    - 深木/漆木牌匾面：暖象牙描金字 + 浓棕轮廓 + 纵向微立体投影（对齐 cover.jpg 牌匾层次）
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
  ctx.save();
  ctx.font = opts.font || `700 13px ${tokens.typography.fontFamily}`;
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = opts.baseline || 'middle';
  const emboss = opts.embossColor ?? 'rgba(255, 253, 246, 0.88)';
  if (emboss) {
    ctx.fillStyle = emboss;
    if (opts.maxWidth) ctx.fillText(text, x, y + 1, opts.maxWidth);
    else ctx.fillText(text, x, y + 1);
  }
  ctx.fillStyle = opts.color || '#3E2311';
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
  ctx.save();
  ctx.font = opts.font || `800 15px ${tokens.typography.fontFamily}`;
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const sw = opts.strokeWidth ?? 2.4;
  const stroke = opts.stroke || '#3A1F0E';
  const shadow = opts.shadowColor ?? 'rgba(30, 13, 4, 0.48)';

  if (shadow && sw > 0) {
    ctx.fillStyle = shadow;
    if (opts.maxWidth) ctx.fillText(text, x, y + 1.8, opts.maxWidth);
    else ctx.fillText(text, x, y + 1.8);
  }
  if (sw > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sw * 2;
    if (opts.maxWidth) ctx.strokeText(text, x, y, opts.maxWidth);
    else ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = opts.fill || '#FFF9EE';
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
  lineWidth = 2.5,
  align: CanvasTextAlign = 'center',
  maxWidth?: number
): void {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  if (lineWidth > 0) {
    ctx.fillStyle = 'rgba(28, 12, 4, 0.36)';
    if (maxWidth) ctx.fillText(text, x, y + 1.5, maxWidth);
    else ctx.fillText(text, x, y + 1.5);

    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth * 2;
    if (maxWidth) ctx.strokeText(text, x, y, maxWidth);
    else ctx.strokeText(text, x, y);
  } else if (stroke === '#FFFFFF' || stroke === '#FFFDF7' || stroke === '#FFF8EC') {
    ctx.fillStyle = 'rgba(255, 253, 246, 0.86)';
    if (maxWidth) ctx.fillText(text, x, y + 1, maxWidth);
    else ctx.fillText(text, x, y + 1);
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
  const w = Math.max(h + 8, Math.ceil(tw + (opts.padX ?? 12)));
  const r: Rect = { x: cx - w * 0.5, y: cy - h * 0.5, w, h };

  ctx.fillStyle = opts.bgHex || '#F6E7CA';
  ctx.strokeStyle = opts.borderHex || 'rgba(92, 54, 24, 0.55)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, h * 0.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = opts.textColor || '#4A2B13';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 0.5);
  ctx.restore();
  return r;
}

// ============================================================================
// 2. 九宫格与经典木胶囊底层辅助
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
      ctx.drawImage(
        img,
        sx[col],
        sy[row],
        swArr[col],
        shArr[row],
        dx[col],
        dy[row],
        dwArr[col],
        dhArr[row]
      );
    }
  }
}

// ============================================================================
// 3. 可复用卡片体系（Reusable Storybook Card & Plaque Architecture）
//    核心复刻 gameplay_ref.jpg 的两大标志性母题：
//      A. drawDoubleRimPlaque  —— 双圈木镶边羊皮纸匾额 / 圆章按钮（如「第8关」牌匾与顶栏圆钮）
//      B. drawRecessedTileCard —— 外层温润立体木框 + 内嵌奶油羊皮纸凹槽卡 + 右上圆形木币角标（如底栏 4 道具卡）
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
    frameTop: string;
    frameMid: string;
    frameLip: string;
    groove: string;
  }
> = {
  parchment: {
    faceTop: '#FFFBF0',
    faceBot: '#EFE0C2',
    frameTop: '#DDA86A',
    frameMid: '#A86B35',
    frameLip: '#6E3F19',
    groove: 'rgba(104, 58, 22, 0.22)',
  },
  amber: {
    faceTop: '#FFF9DE',
    faceBot: '#F8DF99',
    frameTop: '#F0BC68',
    frameMid: '#C27C2C',
    frameLip: '#7D4712',
    groove: 'rgba(146, 82, 16, 0.24)',
  },
  mint: {
    faceTop: '#F3FCF5',
    faceBot: '#D8EFE0',
    frameTop: '#D9A76C',
    frameMid: '#9E6633',
    frameLip: '#673C18',
    groove: 'rgba(64, 108, 74, 0.20)',
  },
  sky: {
    faceTop: '#F2FAFE',
    faceBot: '#DAEBF7',
    frameTop: '#D9A76C',
    frameMid: '#9E6633',
    frameLip: '#673C18',
    groove: 'rgba(56, 98, 128, 0.20)',
  },
  rose: {
    faceTop: '#FFF5F3',
    faceBot: '#F7DCD6',
    frameTop: '#DFA26A',
    frameMid: '#AA5E39',
    frameLip: '#6E341B',
    groove: 'rgba(138, 58, 44, 0.20)',
  },
  lavender: {
    faceTop: '#FAF5FD',
    faceBot: '#EBDDF5',
    frameTop: '#D8A26E',
    frameMid: '#9D6142',
    frameLip: '#663822',
    groove: 'rgba(108, 68, 124, 0.20)',
  },
  locked: {
    faceTop: '#EAE3D6',
    faceBot: '#D7CCBA',
    frameTop: '#B9A38A',
    frameMid: '#8C7660',
    frameLip: '#5B4B3B',
    groove: 'rgba(72, 58, 44, 0.22)',
  },
  walnut: {
    faceTop: '#6A4224',
    faceBot: '#4E2E17',
    frameTop: '#B97E45',
    frameMid: '#7D4B22',
    frameLip: '#3E210C',
    groove: 'rgba(20, 9, 2, 0.42)',
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
 * 1:1 复刻 gameplay_ref.jpg 顶栏「第 8 关」木镶边羊皮纸匾额与双圈圆钮
 */
export function drawDoubleRimPlaque(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  _tokens: UiTokensFile,
  opts: DoubleRimPlaqueOptions = {}
): Rect {
  const pal = VARIANT_PALETTES[opts.variant || 'parchment'];
  const rad = opts.radius ?? Math.min(r.w, r.h) * 0.5;
  const rim = opts.rimThickness ?? Math.max(3.2, Math.min(5.2, Math.min(r.w, r.h) * 0.12));
  const dy = opts.pressed ? 1.8 : 0;
  const ink = '#3E2311';

  ctx.save();
  // 1. 柔和暖投影与底部立体木唇边
  if (opts.shadow !== false && !opts.pressed) {
    ctx.fillStyle = 'rgba(32, 15, 4, 0.28)';
    ctx.beginPath();
    roundRectPath(ctx, r.x + 0.5, r.y + 3.5, r.w - 1, r.h, rad);
    ctx.fill();
  }

  ctx.fillStyle = pal.frameLip;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y + 2.2, r.w, r.h, rad);
  ctx.fill();

  // 2. 外圈温润木框
  const woodGrad = ctx.createLinearGradient(r.x, r.y + dy, r.x, r.y + r.h + dy);
  woodGrad.addColorStop(0, pal.frameTop);
  woodGrad.addColorStop(0.55, pal.frameMid);
  woodGrad.addColorStop(1, pal.frameLip);

  ctx.fillStyle = woodGrad;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y + dy, r.w, r.h, rad);
  ctx.fill();
  ctx.stroke();

  // 外木圈顶部细受光弧
  ctx.strokeStyle = 'rgba(255, 240, 208, 0.48)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  roundRectPath(ctx, r.x + 1.8, r.y + dy + 1.4, Math.max(2, r.w - 3.6), Math.max(2, r.h - 3.4), Math.max(2, rad - 1.5));
  ctx.stroke();

  // 3. 内圈奶油羊皮纸芯面
  const innerRect: Rect = {
    x: r.x + rim,
    y: r.y + dy + rim * 0.92,
    w: Math.max(4, r.w - rim * 2),
    h: Math.max(4, r.h - rim * 1.9),
  };
  const innerRad = Math.max(3, rad - rim * 0.92);
  const faceGrad = ctx.createLinearGradient(innerRect.x, innerRect.y, innerRect.x, innerRect.y + innerRect.h);
  faceGrad.addColorStop(0, pal.faceTop);
  faceGrad.addColorStop(1, pal.faceBot);

  ctx.fillStyle = faceGrad;
  ctx.strokeStyle = '#5A3418';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  roundRectPath(ctx, innerRect.x, innerRect.y, innerRect.w, innerRect.h, innerRad);
  ctx.fill();
  ctx.stroke();

  // 内芯上沿微凹暗线与下沿亮边
  ctx.strokeStyle = pal.groove;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  roundRectPath(
    ctx,
    innerRect.x + 1.4,
    innerRect.y + 1.2,
    Math.max(2, innerRect.w - 2.8),
    Math.max(2, innerRect.h - 2.4),
    Math.max(2, innerRad - 1.2)
  );
  ctx.stroke();

  ctx.restore();
  return innerRect;
}

export interface CornerMedallionOptions {
  variant?: 'wood' | 'amber' | 'crimson' | 'sage' | 'muted';
  fontSize?: number;
}

/**
 * 1:1 复刻 gameplay_ref.jpg 道具卡右上角压边圆形木币角标（如 (+1) (2) (1) (3)）
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
  const ink = '#3E2311';
  const kind = opts.variant || 'wood';
  let topCol = '#F2CA90';
  let botCol = '#C88D4C';
  let textCol = '#3B200E';
  let embossCol = 'rgba(255, 248, 228, 0.72)';

  if (kind === 'amber') {
    topCol = '#FFE58F';
    botCol = '#DDA028';
  } else if (kind === 'crimson') {
    topCol = '#E46444';
    botCol = '#AC321A';
    textCol = '#FFF9EE';
    embossCol = '';
  } else if (kind === 'sage') {
    topCol = '#84B878';
    botCol = '#4F8247';
    textCol = '#FFF9EE';
    embossCol = '';
  } else if (kind === 'muted') {
    topCol = '#D5C9B8';
    botCol = '#A99A86';
    textCol = '#5E5042';
  }

  ctx.save();
  // 投影
  ctx.fillStyle = 'rgba(34, 16, 4, 0.28)';
  ctx.beginPath();
  ctx.arc(cx + 0.5, cy + 2, radius + 0.4, 0, Math.PI * 2);
  ctx.fill();

  // 圆章主体
  const g = ctx.createLinearGradient(cx, cy - radius, cx, cy + radius);
  g.addColorStop(0, topCol);
  g.addColorStop(1, botCol);
  ctx.fillStyle = g;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 内圈高光细环
  ctx.strokeStyle = 'rgba(255, 248, 228, 0.45)';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, radius - 2.1), -Math.PI * 0.85, Math.PI * 0.15);
  ctx.stroke();

  const fSize = opts.fontSize || (text.length >= 3 ? Math.max(8.5, radius * 0.74) : Math.max(10, radius * 0.98));
  const isNum = /^[+×xX0-9/]+$/.test(text);
  const font = `800 ${fSize}px ${isNum ? tokens.typography.numeralFontFamily : tokens.typography.fontFamily}`;

  if (textCol === '#FFF9EE') {
    drawPlaqueText(ctx, text, cx, cy + 0.5, tokens, {
      font,
      fill: '#FFF9EE',
      stroke: ink,
      strokeWidth: 1.5,
    });
  } else {
    drawInkText(ctx, text, cx, cy + 0.5, tokens, {
      font,
      color: textCol,
      embossColor: embossCol,
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
 * 1:1 复刻 gameplay_ref.jpg 底部圆角双层嵌芯木框羊皮纸卡（全界面通用卡片组件！）
 * 返回内部羊皮纸芯面区域 innerRect，供调用方自由排布图标、标题、副文案或进度条。
 */
export function drawRecessedTileCard(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile,
  opts: RecessedTileOptions = {}
): Rect {
  const pal = VARIANT_PALETTES[opts.variant || 'parchment'];
  const rad = opts.radius ?? 14;
  const rim = opts.rimWidth ?? Math.max(3.8, Math.min(5.2, Math.min(r.w, r.h) * 0.085));
  const ink = '#3E2311';

  ctx.save();
  if (opts.disabled) {
    ctx.globalAlpha = 0.58;
  }

  let dy = 0;
  let scale = 1;
  if (!opts.disabled && opts.pressed) {
    dy = 2.2;
    scale = 0.96;
  } else if (!opts.disabled && opts.pulse) {
    const p = Math.sin(opts.pulsePhase || 0);
    scale = 1 + 0.025 * p;
    ctx.save();
    ctx.strokeStyle = '#FBBF24';
    ctx.globalAlpha = 0.52 + 0.32 * p;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    roundRectPath(ctx, r.x - 2.5, r.y - 2.5, r.w + 5, r.h + 5, rad + 2.5);
    ctx.stroke();
    ctx.restore();
  }

  const cx = r.x + r.w * 0.5;
  const cy = r.y + r.h * 0.5;
  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  const lr: Rect = { x: -r.w * 0.5, y: -r.h * 0.5, w: r.w, h: r.h };

  // 1. 底部台面投影 + 实木厚底唇边
  if (!opts.pressed) {
    ctx.fillStyle = 'rgba(26, 12, 3, 0.30)';
    ctx.beginPath();
    roundRectPath(ctx, lr.x + 1, lr.y + 4.2, lr.w - 2, lr.h, rad);
    ctx.fill();
  }

  ctx.fillStyle = pal.frameLip;
  ctx.beginPath();
  roundRectPath(ctx, lr.x, lr.y + (opts.pressed ? 1.2 : 3.0), lr.w, lr.h, rad);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.9;
  ctx.stroke();

  // 2. 外圈圆角蜂蜜胡桃木框
  const frameGrad = ctx.createLinearGradient(0, lr.y, 0, lr.y + lr.h);
  frameGrad.addColorStop(0, pal.frameTop);
  frameGrad.addColorStop(0.55, pal.frameMid);
  frameGrad.addColorStop(1, pal.frameLip);

  ctx.fillStyle = frameGrad;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.15;
  ctx.beginPath();
  roundRectPath(ctx, lr.x, lr.y, lr.w, lr.h, rad);
  ctx.fill();
  ctx.stroke();

  // 木框上沿柔和高光棱
  ctx.strokeStyle = 'rgba(255, 244, 218, 0.45)';
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  roundRectPath(ctx, lr.x + 1.8, lr.y + 1.5, Math.max(4, lr.w - 3.6), Math.max(4, lr.h - 4), Math.max(3, rad - 1.5));
  ctx.stroke();

  // 3. 内嵌奶油水彩羊皮纸芯面
  const innerLocal: Rect = {
    x: lr.x + rim,
    y: lr.y + rim * 0.92,
    w: Math.max(8, lr.w - rim * 2),
    h: Math.max(8, lr.h - rim * 1.95),
  };
  const innerRad = Math.max(4, rad - rim * 0.82);

  const faceGrad = ctx.createLinearGradient(0, innerLocal.y, 0, innerLocal.y + innerLocal.h);
  faceGrad.addColorStop(0, pal.faceTop);
  faceGrad.addColorStop(1, pal.faceBot);

  ctx.fillStyle = faceGrad;
  ctx.strokeStyle = '#5C3518';
  ctx.lineWidth = 1.55;
  ctx.beginPath();
  roundRectPath(ctx, innerLocal.x, innerLocal.y, innerLocal.w, innerLocal.h, innerRad);
  ctx.fill();
  ctx.stroke();

  // 凹槽顶部内阴影细边 + 底部纸边受光
  ctx.strokeStyle = pal.groove;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(innerLocal.x + innerRad, innerLocal.y + 1.3);
  ctx.lineTo(innerLocal.x + innerLocal.w - innerRad, innerLocal.y + 1.3);
  ctx.stroke();

  // 4. 右上角圆形压边木币角标（可选）
  if (opts.medallionText !== undefined && opts.medallionText !== '') {
    const mr = opts.medallionRadius ?? 10.8;
    drawCornerMedallionBadge(
      ctx,
      lr.x + lr.w - mr * 0.42,
      lr.y + mr * 0.42,
      mr,
      opts.medallionText,
      tokens,
      { variant: opts.medallionVariant || 'wood' }
    );
  }

  ctx.restore();

  return {
    x: r.x + rim,
    y: r.y + dy + rim * 0.92,
    w: Math.max(8, r.w - rim * 2),
    h: Math.max(8, r.h - rim * 1.95),
  };
}

// ============================================================================
// 4. 手绘矢量墨线水彩图标库（零系统 Emoji 污染，Retina 级无限清晰度）
// ============================================================================

export type HandDrawnGlyphKind =
  | 'undo'
  | 'vacuum'
  | 'extra_slot'
  | 'restart'
  | 'home'
  | 'gear'
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
  const ink = '#3E2311';

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const woodFill = (): CanvasGradient => {
    const g = ctx.createLinearGradient(0, -13, 0, 13);
    g.addColorStop(0, '#ECC084');
    g.addColorStop(0.55, '#C48342');
    g.addColorStop(1, '#8A5222');
    return g;
  };

  switch (kind) {
    case 'undo': {
      // 1:1 复刻 gameplay_ref.jpg 左侧「撤回」圆润立体弯木箭头
      ctx.fillStyle = 'rgba(62, 35, 17, 0.16)';
      ctx.beginPath();
      ctx.ellipse(1, 10.5, 10, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = woodFill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(-12.5, -1.5);
      ctx.lineTo(-2.5, -10.5);
      ctx.lineTo(-2.5, -4.8);
      ctx.bezierCurveTo(7.5, -5.2, 13.0, 0.5, 11.8, 9.8);
      ctx.bezierCurveTo(8.8, 4.2, 3.8, 1.8, -2.5, 2.2);
      ctx.lineTo(-2.5, 7.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 245, 222, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-9.2, -1.5);
      ctx.lineTo(-3.6, -6.6);
      ctx.moveTo(-1.2, -3.2);
      ctx.quadraticCurveTo(6.4, -3.0, 9.6, 3.0);
      ctx.stroke();
      break;
    }

    case 'vacuum': {
      // 1:1 复刻 gameplay_ref.jpg 第二个「吸尘器」斜柄手绘木吸嘴 + 吸入彩沙粒
      ctx.fillStyle = 'rgba(62, 35, 17, 0.16)';
      ctx.beginPath();
      ctx.ellipse(-1, 10.8, 11, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.rotate(-0.62);
      // 车削木吸柄
      ctx.fillStyle = woodFill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      roundRectPath(ctx, -3.2, -14.5, 6.4, 13.5, 2.8);
      ctx.fill();
      ctx.stroke();

      // 黄铜连接箍环
      ctx.fillStyle = '#F2C96B';
      ctx.beginPath();
      roundRectPath(ctx, -4.5, -2.8, 9.0, 3.6, 1.6);
      ctx.fill();
      ctx.stroke();

      // 宽扁梯形木吸头底座
      ctx.fillStyle = woodFill();
      ctx.beginPath();
      ctx.moveTo(-6.5, 0.8);
      ctx.lineTo(6.5, 0.8);
      ctx.lineTo(11.2, 7.6);
      ctx.lineTo(-11.2, 7.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 底面进风厚边
      ctx.fillStyle = '#7D471D';
      ctx.beginPath();
      roundRectPath(ctx, -11.6, 6.8, 23.2, 3.4, 1.5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // 吸嘴前方被吸起的微彩砂点
      const dots: [number, number, string][] = [
        [-10.5, 9.2, '#EE9FA0'],
        [-6.2, 11.2, '#7EBBD6'],
        [-12.2, 5.8, '#F1C94E'],
      ];
      for (const [dx, dy, col] of dots) {
        ctx.fillStyle = col;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.arc(dx, dy, 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }

    case 'extra_slot': {
      // 1:1 复刻 gameplay_ref.jpg 第三个「加开槽」手绘竖条木桶 + 暖金加号章
      ctx.fillStyle = 'rgba(62, 35, 17, 0.16)';
      ctx.beginPath();
      ctx.ellipse(-1, 10.8, 9.5, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // 桶身梯形
      const bg = ctx.createLinearGradient(-10, 0, 9, 0);
      bg.addColorStop(0, '#EBC089');
      bg.addColorStop(0.5, '#C58648');
      bg.addColorStop(1, '#8C5324');
      ctx.fillStyle = bg;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(-10.2, -5.2);
      ctx.lineTo(-7.5, 8.8);
      ctx.quadraticCurveTo(-1, 11.2, 5.5, 8.8);
      ctx.lineTo(8.2, -5.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 竖木桶板缝
      ctx.strokeStyle = 'rgba(62, 35, 17, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-4.2, -3.5);
      ctx.lineTo(-3.2, 9.4);
      ctx.moveTo(2.2, -3.5);
      ctx.lineTo(1.4, 9.4);
      ctx.stroke();

      // 桶口椭圆箍圈与深色内腔
      ctx.fillStyle = '#DFAA6E';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.ellipse(-1, -5.6, 9.8, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#563218';
      ctx.beginPath();
      ctx.ellipse(-1, -5.6, 7.2, 2.0, 0, 0, Math.PI * 2);
      ctx.fill();

      // 右下小绿金「+」圆徽
      ctx.fillStyle = '#68A357';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.arc(7.5, 5.6, 5.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#FFFDF7';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(7.5, 3.1);
      ctx.lineTo(7.5, 8.1);
      ctx.moveTo(5.0, 5.6);
      ctx.lineTo(10.0, 5.6);
      ctx.stroke();
      break;
    }

    case 'restart': {
      // 1:1 复刻 gameplay_ref.jpg 第四个双弧循环手绘木箭头
      ctx.strokeStyle = ink;
      ctx.lineWidth = 4.8;
      ctx.beginPath();
      ctx.arc(0, 0, 8.8, -Math.PI * 0.82, -Math.PI * 0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 8.8, Math.PI * 0.18, Math.PI * 0.88);
      ctx.stroke();

      ctx.strokeStyle = '#CE8D48';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 8.8, -Math.PI * 0.82, -Math.PI * 0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 8.8, Math.PI * 0.18, Math.PI * 0.88);
      ctx.stroke();

      // 上下双三角箭头尖
      for (const rot of [0, Math.PI]) {
        ctx.save();
        ctx.rotate(rot);
        ctx.fillStyle = '#DDA059';
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(10.8, -1.2);
        ctx.lineTo(5.0, -2.5);
        ctx.lineTo(8.5, -7.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      break;
    }

    case 'home': {
      // 治愈尖顶小木屋图标
      ctx.fillStyle = '#F7E7C8';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      roundRectPath(ctx, -7.5, -1, 15, 10.5, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#C96A42';
      ctx.beginPath();
      ctx.moveTo(-10.8, 0.2);
      ctx.lineTo(0, -9.8);
      ctx.lineTo(10.8, 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#8C5324';
      ctx.beginPath();
      roundRectPath(ctx, -2.4, 3.2, 4.8, 6.2, 1.5);
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'gear': {
      // 1:1 复刻 gameplay_ref.jpg 右上角手绘木齿轮
      ctx.fillStyle = woodFill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.9;
      const teeth = 8;
      const outerR = 11.2;
      const innerR = 8.2;
      ctx.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i * Math.PI) / teeth - Math.PI / (teeth * 2);
        const rr = i % 2 === 0 ? outerR : innerR;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#F7EBD2';
      ctx.beginPath();
      ctx.arc(0, 0, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'lock': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.arc(0, -3.5, 5.2, Math.PI, 0, false);
      ctx.stroke();
      ctx.strokeStyle = '#D5B88E';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.fillStyle = '#C99B62';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      roundRectPath(ctx, -7.5, -3.2, 15, 11.8, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(0, 2.2, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-0.9, 2.8, 1.8, 3.2);
      break;
    }

    case 'crown': {
      ctx.fillStyle = '#F8C63D';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.moveTo(-9.5, 6.5);
      ctx.lineTo(-10.8, -4.5);
      ctx.lineTo(-4.2, 0.8);
      ctx.lineTo(0, -7.2);
      ctx.lineTo(4.2, 0.8);
      ctx.lineTo(10.8, -4.5);
      ctx.lineTo(9.5, 6.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#E04F35';
      ctx.beginPath();
      ctx.arc(0, 2.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'gift': {
      ctx.fillStyle = '#E25B3E';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      roundRectPath(ctx, -8.5, -2.5, 17, 11, 2.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#F7C948';
      ctx.fillRect(-2, -2.5, 4, 11);
      ctx.strokeRect(-2, -2.5, 4, 11);
      ctx.beginPath();
      ctx.ellipse(-3.5, -5.2, 4, 2.4, -0.35, 0, Math.PI * 2);
      ctx.ellipse(3.5, -5.2, 4, 2.4, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'check': {
      ctx.fillStyle = '#538D4E';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#FFFDF7';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-4.4, 0.2);
      ctx.lineTo(-1.1, 3.8);
      ctx.lineTo(4.8, -3.4);
      ctx.stroke();
      break;
    }

    case 'cloud': {
      ctx.fillStyle = '#DFEFFA';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.arc(-4.5, 2, 5.2, Math.PI * 0.5, Math.PI * 1.6);
      ctx.arc(1.5, -2.2, 6.2, Math.PI * 1.05, Math.PI * 1.95);
      ctx.arc(6.8, 2.2, 4.6, -Math.PI * 0.4, Math.PI * 0.5);
      ctx.lineTo(-4.5, 7.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'sound_on':
    case 'sound_off': {
      ctx.fillStyle = woodFill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.moveTo(-9.5, -3.5);
      ctx.lineTo(-4.5, -3.5);
      ctx.lineTo(2.5, -8.8);
      ctx.lineTo(2.5, 8.8);
      ctx.lineTo(-4.5, 3.5);
      ctx.lineTo(-9.5, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (kind === 'sound_on') {
        ctx.strokeStyle = '#538D4E';
        ctx.lineWidth = 2.1;
        ctx.beginPath();
        ctx.arc(3.5, 0, 5.0, -0.75, 0.75);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(3.5, 0, 8.8, -0.75, 0.75);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#B93829';
        ctx.lineWidth = 2.3;
        ctx.beginPath();
        ctx.moveTo(5.2, -3.8);
        ctx.lineTo(11.2, 3.8);
        ctx.moveTo(11.2, -3.8);
        ctx.lineTo(5.2, 3.8);
        ctx.stroke();
      }
      break;
    }

    case 'vibrate_on':
    case 'vibrate_off': {
      ctx.fillStyle = '#F7EBD2';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      roundRectPath(ctx, -5.2, -8.5, 10.4, 17, 2.6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#C99B62';
      ctx.beginPath();
      ctx.arc(0, 5.4, 1.3, 0, Math.PI * 2);
      ctx.fill();
      if (kind === 'vibrate_on') {
        ctx.strokeStyle = '#C87D28';
        ctx.lineWidth = 2.0;
        for (const dir of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(dir * 8.4, -5.2);
          ctx.lineTo(dir * 10.6, -1.8);
          ctx.lineTo(dir * 8.2, 1.8);
          ctx.lineTo(dir * 10.6, 5.2);
          ctx.stroke();
        }
      }
      break;
    }

    case 'book': {
      ctx.fillStyle = '#E89B4E';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      roundRectPath(ctx, -9.5, -8.5, 19, 17, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FFF9EE';
      ctx.beginPath();
      roundRectPath(ctx, -6.5, -6.2, 13.5, 12.4, 1.8);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#9C6230';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-3.5, -2.2);
      ctx.lineTo(3.8, -2.2);
      ctx.moveTo(-3.5, 1.8);
      ctx.lineTo(2.4, 1.8);
      ctx.stroke();
      break;
    }

    case 'sparkle': {
      ctx.fillStyle = '#FFE47A';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(0, -10.5);
      ctx.quadraticCurveTo(1.8, -1.8, 10.5, 0);
      ctx.quadraticCurveTo(1.8, 1.8, 0, 10.5);
      ctx.quadraticCurveTo(-1.8, 1.8, -10.5, 0);
      ctx.quadraticCurveTo(-1.8, -1.8, 0, -10.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'close': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-5.8, -5.8);
      ctx.lineTo(5.8, 5.8);
      ctx.moveTo(5.8, -5.8);
      ctx.lineTo(-5.8, 5.8);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

// ============================================================================
// 5. 可复用设置拨杆组件 & 统一藏品卡面组件（跨界面一致复用）
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
    radius: 12,
    rimWidth: 3.5,
  });

  drawHandDrawnGlyph(
    ctx,
    isOn ? glyphOn : glyphOff,
    inner.x + 16,
    inner.y + inner.h * 0.5,
    21,
    tokens
  );

  drawInkText(ctx, label, inner.x + 31, inner.y + inner.h * 0.5, tokens, {
    font: `700 12px ${tokens.typography.fontFamily}`,
    align: 'left',
    color: '#3E2311',
  });

  // 右侧滑动拨杆槽
  const sw = 42;
  const sh = 21;
  const sx = inner.x + inner.w - sw - 6;
  const sy = inner.y + (inner.h - sh) * 0.5;
  const ink = '#3E2311';

  ctx.save();
  ctx.fillStyle = isOn ? '#548C4E' : '#B7A795';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  roundRectPath(ctx, sx, sy, sw, sh, sh * 0.5);
  ctx.fill();
  ctx.stroke();

  const knobR = sh * 0.5 - 2.2;
  const knobCx = isOn ? sx + sw - sh * 0.5 : sx + sh * 0.5;
  const knobCy = sy + sh * 0.5;

  ctx.fillStyle = '#FFF9EE';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(knobCx, knobCy, knobR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export interface CollectibleCardOptions {
  owned?: boolean;
  count?: number;
  isNewUnlock?: boolean;
  shardsConverted?: number;
  showCountBadge?: boolean;
}

/**
 * 统一公仔藏品展示卡（在 AppraisalModal 揭晓卡、大红全屏特写卡、GalleryModal 3×5 图鉴与详情卡中 100% 复用！）
 */
export function drawCollectibleCard(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  fig: FigurineItem,
  tokens: UiTokensFile,
  assets: {
    get(id: string): CanvasImageSource | null;
    getSilhouette?(id: string, hex?: string): CanvasImageSource | null;
  },
  opts: CollectibleCardOptions = {}
): void {
  const rarTok = tokens.rarityTokens[fig.rarity];
  const owned = opts.owned !== false;
  const ink = '#3E2311';

  ctx.save();
  // 卡片底影
  ctx.fillStyle = 'rgba(28, 13, 4, 0.24)';
  ctx.beginPath();
  roundRectPath(ctx, r.x + 1, r.y + 3.5, r.w - 2, r.h, 12);
  ctx.fill();

  if (!owned) {
    const nightGrad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    nightGrad.addColorStop(0, '#28365E');
    nightGrad.addColorStop(1, '#17203B');
    ctx.fillStyle = nightGrad;
    ctx.strokeStyle = rarTok.border;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 248, 228, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundRectPath(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 9.5);
    ctx.stroke();

    const sil = assets.getSilhouette ? assets.getSilhouette(fig.id, '#0E1528') : null;
    const sz = Math.min(r.w * 0.66, r.h * 0.52);
    if (sil) {
      ctx.globalAlpha = 0.82;
      ctx.drawImage(sil, r.x + (r.w - sz) * 0.5, r.y + r.h * 0.12, sz, sz);
      ctx.globalAlpha = 1;
    }

    const plateH = Math.max(24, Math.round(r.h * 0.22));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.76)';
    ctx.beginPath();
    roundRectPath(ctx, r.x + 5, r.y + r.h - plateH - 5, r.w - 10, plateH, 7);
    ctx.fill();

    drawPlaqueText(
      ctx,
      `${rarTok.label} · 待发掘`,
      r.x + r.w * 0.5,
      r.y + r.h - plateH * 0.5 - 5,
      tokens,
      {
        font: `700 ${r.w < 105 ? 9.5 : 10.5}px ${tokens.typography.fontFamily}`,
        fill: rarTok.primary === '#9CA3AF' ? '#CBD5E1' : rarTok.primary,
        stroke: '#0B1120',
        strokeWidth: 1.5,
        maxWidth: r.w - 16,
      }
    );
    ctx.restore();
    return;
  }

  // 已拥有/已揭晓品质卡底（统一暖宣纸白内芯与卡框贴图无缝衔接，杜绝方形色差接缝）
  ctx.fillStyle = '#FFFDF8';
  ctx.strokeStyle = rarTok.border;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
  ctx.fill();
  ctx.stroke();

  // 柔和品质背光圆晕
  const figCenterY = r.y + r.h * 0.37;
  const haloR = Math.min(r.w, r.h) * 0.44;
  const halo = ctx.createRadialGradient(
    r.x + r.w * 0.5,
    figCenterY,
    2,
    r.x + r.w * 0.5,
    figCenterY,
    haloR
  );
  halo.addColorStop(0, rarTok.glow);
  halo.addColorStop(1, 'rgba(255, 253, 248, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(r.x + r.w * 0.5, figCenterY, haloR, 0, Math.PI * 2);
  ctx.fill();

  const frameImg = assets.get(`ui_card_frame_${fig.rarity.toLowerCase()}`);
  if (frameImg) {
    ctx.drawImage(frameImg, r.x, r.y, r.w, r.h);
  }

  // 公仔立绘
  const figImg = assets.get(fig.id);
  const figSz = Math.min(r.w * 0.72, r.h * 0.54);
  const fx = r.x + (r.w - figSz) * 0.5;
  const fy = r.y + r.h * 0.09;
  if (figImg) {
    ctx.drawImage(figImg, fx, fy, figSz, figSz);
  } else {
    ctx.fillStyle = rarTok.primary;
    ctx.beginPath();
    ctx.arc(r.x + r.w * 0.5, fy + figSz * 0.5, figSz * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }

  // 底部羊皮纸铭牌（清晰承载公仔名与估值，绝不糊在卡框花纹上）
  const platePad = Math.max(5, Math.round(r.w * 0.055));
  const plateH = Math.max(32, Math.round(r.h * 0.245));
  const plateY = r.y + r.h - plateH - platePad;
  const plateW = r.w - platePad * 2;

  ctx.fillStyle = 'rgba(255, 250, 238, 0.94)';
  ctx.strokeStyle = 'rgba(92, 53, 24, 0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  roundRectPath(ctx, r.x + platePad, plateY, plateW, plateH, 7.5);
  ctx.fill();
  ctx.stroke();

  const nameSize = r.w >= 150 ? 13 : r.w < 105 ? 10 : 11;
  drawInkText(ctx, fig.name, r.x + r.w * 0.5, plateY + plateH * 0.34, tokens, {
    font: `800 ${nameSize}px ${tokens.typography.fontFamily}`,
    color: ink,
    maxWidth: plateW - 8,
  });

  const valStr = formatNetWorth(fig.valuation);
  const valSize = r.w >= 150 ? 12 : 10;
  const coinImg = assets.get('ui_networth_coin');
  const valColor = fig.rarity === 'RED' ? '#B91C1C' : fig.rarity === 'GOLD' ? '#B45309' : '#6B4223';
  if (coinImg && r.w >= 96) {
    ctx.save();
    ctx.font = `800 ${valSize}px ${tokens.typography.numeralFontFamily}`;
    const vw = ctx.measureText(valStr).width;
    const cSz = valSize + 2;
    const startX = r.x + (r.w - (cSz + 3 + vw)) * 0.5;
    ctx.drawImage(coinImg, startX, plateY + plateH * 0.72 - cSz * 0.5, cSz, cSz);
    ctx.restore();
    drawInkText(ctx, valStr, r.x + r.w * 0.5 + (valSize + 2) * 0.5 + 1, plateY + plateH * 0.72, tokens, {
      font: `800 ${valSize}px ${tokens.typography.numeralFontFamily}`,
      color: valColor,
    });
  } else {
    drawInkText(ctx, valStr, r.x + r.w * 0.5, plateY + plateH * 0.72, tokens, {
      font: `800 ${valSize}px ${tokens.typography.numeralFontFamily}`,
      color: valColor,
    });
  }

  // 左上角品质微签
  const rarChipW = Math.max(28, rarTok.label.length * 9.5 + 8);
  ctx.fillStyle = rarTok.badgeBg;
  ctx.strokeStyle = rarTok.border;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  roundRectPath(ctx, r.x + 5, r.y + 5, rarChipW, 15, 5.5);
  ctx.fill();
  ctx.stroke();
  drawInkText(ctx, rarTok.label, r.x + 5 + rarChipW * 0.5, r.y + 12.5, tokens, {
    font: `700 8.5px ${tokens.typography.fontFamily}`,
    color: rarTok.text,
    embossColor: '',
  });

  // 右上角 NEW! 火漆章 / 碎片转化签 / 持有数量签
  if (opts.isNewUnlock) {
    drawCornerMedallionBadge(ctx, r.x + r.w - 6, r.y + 7, 12.5, '新!', tokens, {
      variant: 'crimson',
      fontSize: 9.5,
    });
  } else if (opts.shardsConverted && opts.shardsConverted > 0) {
    const shardImg = assets.get('ui_shard_icon');
    const tw = 44;
    const tx = r.x + r.w - tw - 4;
    const ty = r.y + 4;
    ctx.fillStyle = '#FFF4D4';
    ctx.strokeStyle = '#B45309';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    roundRectPath(ctx, tx, ty, tw, 17, 7);
    ctx.fill();
    ctx.stroke();
    if (shardImg) {
      ctx.drawImage(shardImg, tx + 3, ty + 1.5, 14, 14);
    }
    drawInkText(ctx, `+${opts.shardsConverted}`, tx + tw * 0.63, ty + 9, tokens, {
      font: `800 9.5px ${tokens.typography.numeralFontFamily}`,
      color: '#92400E',
    });
  } else if (opts.showCountBadge && (opts.count || 0) > 0) {
    const cw = 26;
    const cxBadge = r.x + r.w - cw - 5;
    const cyBadge = r.y + 5;
    ctx.fillStyle = 'rgba(74, 43, 19, 0.86)';
    ctx.beginPath();
    roundRectPath(ctx, cxBadge, cyBadge, cw, 15, 6);
    ctx.fill();
    drawPlaqueText(ctx, `×${opts.count}`, cxBadge + cw * 0.5, cyBadge + 7.5, tokens, {
      font: `700 9px ${tokens.typography.numeralFontFamily}`,
      strokeWidth: 0,
      shadowColor: '',
    });
  }

  ctx.restore();
}

// ============================================================================
// 6. 经典木牌胶囊、封面燕尾丝带、九宫格弹窗框与漆木主按钮（全面精修升级）
// ============================================================================

function mapFillToStorybookGlaze(fillHex?: string): {
  glaze: string | null;
  fallbackBg: string;
  fallbackLip: string;
  topGrad: string;
  botGrad: string;
} {
  if (!fillHex) {
    return {
      glaze: null,
      fallbackBg: '#D99B52',
      fallbackLip: '#78451A',
      topGrad: '#E5AE6B',
      botGrad: '#B67537',
    };
  }
  const up = fillHex.toUpperCase();
  // 朱红描金漆木（主行动按钮 / 大红合成）
  if (up === '#EA580C' || up === '#DC2626' || up === '#EF4444' || up === '#B91C1C') {
    return {
      glaze: 'rgba(198, 56, 30, 0.50)',
      fallbackBg: '#C8492B',
      fallbackLip: '#742210',
      topGrad: '#DF6544',
      botGrad: '#AE361C',
    };
  }
  // 浆果胡桃木（藏馆 / 空投）
  if (up === '#7E22CE' || up === '#4C1D95' || up === '#A855F7') {
    return {
      glaze: 'rgba(128, 56, 76, 0.38)',
      fallbackBg: '#9B5862',
      fallbackLip: '#572C34',
      topGrad: '#B36E78',
      botGrad: '#82444E',
    };
  }
  // 星夜靛木（图鉴 / 普通合成）
  if (up === '#0284C7' || up === '#38BDF8') {
    return {
      glaze: 'rgba(48, 86, 126, 0.40)',
      fallbackBg: '#52789A',
      fallbackLip: '#2C445C',
      topGrad: '#6A92B5',
      botGrad: '#406282',
    };
  }
  // 鼠尾草森木（开启 / 下一步 / 分享）
  if (up === '#15803D' || up === '#10B981') {
    return {
      glaze: 'rgba(68, 118, 64, 0.40)',
      fallbackBg: '#5D8F56',
      fallbackLip: '#345530',
      topGrad: '#76AA6E',
      botGrad: '#497743',
    };
  }
  // 旧浮木（未选中 / 置灰）
  if (up === '#9CA3AF' || up === '#C89F72' || up === '#6B7280') {
    return {
      glaze: 'rgba(92, 72, 56, 0.30)',
      fallbackBg: '#B49678',
      fallbackLip: '#6A513A',
      topGrad: '#C6AC90',
      botGrad: '#9B7F63',
    };
  }
  // 焦糖胡桃木（次级按钮）
  if (up === '#9A6228' || up === '#3B2514' || up === '#7C5335') {
    return {
      glaze: 'rgba(88, 48, 20, 0.30)',
      fallbackBg: '#9E6633',
      fallbackLip: '#563316',
      topGrad: '#B67B44',
      botGrad: '#865224',
    };
  }
  return {
    glaze: 'rgba(217, 130, 24, 0.18)',
    fallbackBg: '#D99B52',
    fallbackLip: '#7C471C',
    topGrad: '#E8B268',
    botGrad: '#BD7934',
  };
}

export function drawWoodCapsule(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile,
  bgHex = tokens.theme.woodPrimary,
  lipHex = tokens.theme.woodDark,
  radius = 12
): void {
  const upBg = bgHex.toUpperCase();
  const safeBg = upBg === '#4C1D95' ? '#6D4339' : upBg === '#3B2514' ? '#5C3A21' : bgHex;
  const safeLip = lipHex.toUpperCase() === '#2E1065' ? '#3E221B' : lipHex;

  ctx.save();
  ctx.fillStyle = 'rgba(28, 13, 4, 0.18)';
  ctx.beginPath();
  roundRectPath(ctx, r.x + 0.5, r.y + 3.2, r.w - 1, r.h, radius);
  ctx.fill();

  ctx.fillStyle = safeLip;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y + 2.2, r.w, r.h, radius);
  ctx.fill();

  ctx.fillStyle = safeBg;
  ctx.strokeStyle = tokens.theme.inkOutline;
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.fill();
  ctx.stroke();

  const isLightParchment =
    safeBg.startsWith('rgba(255') ||
    upBg === '#FFF8EC' ||
    upBg === '#FDF1DC' ||
    upBg === '#FEF3C7' ||
    upBg === '#E5E0D8' ||
    upBg === '#FFFDF9';
  ctx.strokeStyle = isLightParchment ? 'rgba(172, 122, 72, 0.34)' : 'rgba(255, 243, 214, 0.38)';
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  roundRectPath(
    ctx,
    r.x + 2.4,
    r.y + 2.0,
    Math.max(2, r.w - 4.8),
    Math.max(2, r.h - 4.4),
    Math.max(3.5, radius - 2.4)
  );
  ctx.stroke();

  ctx.restore();
}

/**
 * 复刻封面 cover.jpg 顶部「抽板流沙 · 淘出大红」手绘燕尾羊皮纸丝带横幅
 */
export function drawRibbonBanner(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  height: number,
  text: string,
  tokens: UiTokensFile,
  fontSize = 12.5
): void {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const tailW = Math.min(22, height * 0.66);
  const ink = '#3E2311';

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 丝带柔和投影
  ctx.fillStyle = 'rgba(24, 12, 4, 0.24)';
  ctx.beginPath();
  roundRectPath(ctx, -hw - tailW * 0.6, -hh + 3, (hw + tailW * 0.6) * 2, height + 3, 8);
  ctx.fill();

  for (const dir of [-1, 1]) {
    const tGrad = ctx.createLinearGradient(0, -hh, 0, hh + 6);
    tGrad.addColorStop(0, '#ECC994');
    tGrad.addColorStop(1, '#CFA063');
    ctx.fillStyle = tGrad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(dir * (hw - 8), -hh + 4.5);
    ctx.lineTo(dir * (hw + tailW), -hh + 5);
    ctx.lineTo(dir * (hw + tailW - 7.5), 3.8);
    ctx.lineTo(dir * (hw + tailW), hh + 5.5);
    ctx.lineTo(dir * (hw - 12), hh + 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#8E5828';
    ctx.beginPath();
    ctx.moveTo(dir * hw, hh);
    ctx.lineTo(dir * (hw - 10), hh + 5);
    ctx.lineTo(dir * (hw - 10), hh - 1);
    ctx.closePath();
    ctx.fill();
  }

  const arch = 3.8;
  const ribGrad = ctx.createLinearGradient(0, -hh - arch, 0, hh + arch);
  ribGrad.addColorStop(0, '#FFFDF5');
  ribGrad.addColorStop(0.55, '#FDF0D2');
  ribGrad.addColorStop(1, '#F3DCAD');
  ctx.fillStyle = ribGrad;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-hw, -hh + arch);
  ctx.quadraticCurveTo(0, -hh - arch, hw, -hh + arch);
  ctx.lineTo(hw, hh + arch * 0.6);
  ctx.quadraticCurveTo(0, hh - arch * 0.8, -hw, hh + arch * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(166, 108, 56, 0.52)';
  ctx.lineWidth = 1.05;
  ctx.beginPath();
  ctx.moveTo(-hw + 6, -hh + arch + 3);
  ctx.quadraticCurveTo(0, -hh - arch + 3, hw - 6, -hh + arch + 3);
  ctx.moveTo(-hw + 6, hh + arch * 0.6 - 3);
  ctx.quadraticCurveTo(0, hh - arch * 0.8 - 3, hw - 6, hh + arch * 0.6 - 3);
  ctx.stroke();

  drawInkText(ctx, text, 0, 0.5, tokens, {
    font: `800 ${fontSize}px ${tokens.typography.fontFamily}`,
    color: '#3E2311',
    maxWidth: width - 20,
  });

  ctx.restore();
}

export function drawStorybookCardFrame(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile,
  sprites: SpriteProvider
): void {
  const panelTex = sprites.get('ui_panel_parchment');
  if (panelTex && r.w >= 120 && r.h >= 100) {
    ctx.save();
    ctx.fillStyle = 'rgba(42, 20, 6, 0.30)';
    ctx.beginPath();
    roundRectPath(ctx, r.x + 2, r.y + 4.5, r.w - 4, r.h, 14);
    ctx.fill();
    drawNineSlice(ctx, panelTex, r, 46, 46, 46, 46);
    ctx.restore();
  } else {
    drawRecessedTileCard(ctx, r, tokens, { variant: 'parchment', radius: 15 });
  }
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
    scale = 1 + 0.028 * p;
    ctx.save();
    ctx.strokeStyle = '#FCD34D';
    ctx.globalAlpha = 0.45 + 0.3 * p;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    roundRectPath(ctx, r.x - 2.5, r.y - 2.5, r.w + 5, r.h + 5, 14);
    ctx.stroke();
    ctx.restore();
  }

  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  const localRect: Rect = { x: -r.w * 0.5, y: -r.h * 0.5, w: r.w, h: r.h };

  const woodTex = sprites.get('ui_btn_wood');
  const styleMap = mapFillToStorybookGlaze(opts.fillHex);

  // 底部暖阴影
  if (!opts.pressed) {
    ctx.fillStyle = 'rgba(28, 12, 3, 0.28)';
    ctx.beginPath();
    roundRectPath(ctx, localRect.x + 2, localRect.y + 4, localRect.w - 4, localRect.h, 12);
    ctx.fill();
  }

  if (woodTex && r.w >= 72 && r.h >= 30) {
    drawNineSlice(
      ctx,
      woodTex,
      { x: localRect.x - 1, y: localRect.y - 1, w: localRect.w + 2, h: localRect.h + 2 },
      34,
      34,
      26,
      28
    );
    if (styleMap.glaze) {
      ctx.save();
      ctx.beginPath();
      roundRectPath(
        ctx,
        localRect.x + 5,
        localRect.y + 4,
        Math.max(4, localRect.w - 10),
        Math.max(4, localRect.h - 9),
        9
      );
      ctx.fillStyle = styleMap.glaze;
      ctx.fill();
      ctx.restore();
    }
  } else {
    const grad = ctx.createLinearGradient(0, localRect.y, 0, localRect.y + localRect.h);
    grad.addColorStop(0, styleMap.topGrad);
    grad.addColorStop(1, styleMap.botGrad);
    ctx.fillStyle = styleMap.fallbackLip;
    ctx.beginPath();
    roundRectPath(ctx, localRect.x, localRect.y + 2.2, localRect.w, localRect.h, 11);
    ctx.fill();
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#3E2311';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    roundRectPath(ctx, localRect.x, localRect.y, localRect.w, localRect.h, 11);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 244, 218, 0.38)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    roundRectPath(ctx, localRect.x + 2.2, localRect.y + 1.8, Math.max(2, localRect.w - 4.4), Math.max(2, localRect.h - 4.4), 8.5);
    ctx.stroke();
  }

  const fSize = opts.fontSize || 13;
  const font = `800 ${fSize}px ${tokens.typography.fontFamily}`;
  const textCol = opts.textColor || '#FFF9EE';

  if (opts.icon && opts.subLabel === undefined && r.h >= 50 && r.w <= 96) {
    const isz = opts.iconSize || 28;
    ctx.drawImage(opts.icon, -isz * 0.5, localRect.y + 5, isz, isz);
    drawPlaqueText(ctx, label, 0, localRect.y + localRect.h - 11, tokens, {
      font: `700 11px ${tokens.typography.fontFamily}`,
      fill: textCol,
      strokeWidth: 2.0,
      maxWidth: r.w - 8,
    });
  } else if (opts.icon && opts.subLabel) {
    const isz = opts.iconSize || 28;
    const iconX = localRect.x + 10;
    ctx.drawImage(opts.icon, iconX, -isz * 0.5, isz, isz);
    const textCenterX = (iconX + isz + localRect.x + localRect.w - 6) * 0.5;
    const availW = Math.max(36, r.w - isz - 20);
    drawPlaqueText(ctx, label, textCenterX, -6.5, tokens, {
      font,
      fill: textCol,
      strokeWidth: 2.1,
      maxWidth: availW,
    });
    drawPlaqueText(ctx, opts.subLabel, textCenterX, 10, tokens, {
      font: `600 10px ${tokens.typography.fontFamily}`,
      fill: '#FFF3D6',
      strokeWidth: 1.6,
      maxWidth: availW,
    });
  } else if (opts.icon) {
    const isz = opts.iconSize || 19;
    const iconX = localRect.x + 9;
    ctx.drawImage(opts.icon, iconX, -isz * 0.5, isz, isz);
    const textCenterX = (iconX + isz + localRect.x + localRect.w - 6) * 0.5;
    drawPlaqueText(ctx, label, textCenterX, 0.5, tokens, {
      font,
      fill: textCol,
      strokeWidth: 2.1,
      maxWidth: Math.max(32, r.w - isz - 16),
    });
  } else if (opts.subLabel) {
    drawPlaqueText(ctx, label, 0, -7, tokens, {
      font,
      fill: textCol,
      strokeWidth: 2.3,
      maxWidth: r.w - 22,
    });
    drawPlaqueText(ctx, opts.subLabel, 0, 10.5, tokens, {
      font: `700 10.5px ${tokens.typography.fontFamily}`,
      fill: '#FFECC4',
      strokeWidth: 1.7,
      maxWidth: r.w - 24,
    });
  } else {
    drawPlaqueText(ctx, label, 0, 0.5, tokens, {
      font,
      fill: textCol,
      strokeWidth: 2.2,
      maxWidth: r.w - 14,
    });
  }

  if (opts.badgeText) {
    const bw = Math.max(38, opts.badgeText.length * 8 + 8);
    const bh = 16;
    const bx = localRect.x + localRect.w - bw + 4;
    const by = localRect.y - 6;
    const rawBadge = (opts.badgeBgHex || '#558B4E').toUpperCase();
    const softBadge =
      rawBadge === '#10B981' ? '#528A4E' : rawBadge === '#EF4444' ? '#C43E22' : opts.badgeBgHex || '#528A4E';
    ctx.fillStyle = softBadge;
    ctx.strokeStyle = '#3E2311';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    roundRectPath(ctx, bx, by, bw, bh, 8);
    ctx.fill();
    ctx.stroke();
    drawPlaqueText(ctx, opts.badgeText, bx + bw * 0.5, by + bh * 0.5 + 0.5, tokens, {
      font: `700 9.5px ${tokens.typography.fontFamily}`,
      fill: '#FFFDF7',
      strokeWidth: 1.3,
      shadowColor: '',
    });
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
  ctx.fillStyle = 'rgba(22, 13, 7, 0.72)';
  ctx.fillRect(0, 0, screenW, screenH);

  // 底部深暖投影
  ctx.fillStyle = 'rgba(26, 12, 4, 0.46)';
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x + 2, panelRect.y + 7, panelRect.w - 4, panelRect.h, 18);
  ctx.fill();

  const panelTex = sprites.get('ui_panel_parchment');
  if (panelTex) {
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, panelRect.x + 14, panelRect.y + 14, panelRect.w - 28, panelRect.h - 28, 10);
    ctx.clip();
    const pGrad = ctx.createLinearGradient(0, panelRect.y, 0, panelRect.y + panelRect.h);
    pGrad.addColorStop(0, '#FFFBF2');
    pGrad.addColorStop(1, '#F5E7CE');
    ctx.fillStyle = pGrad;
    ctx.fillRect(panelRect.x, panelRect.y, panelRect.w, panelRect.h);
    const bgImg = bgSpriteId ? sprites.get(bgSpriteId) : null;
    if (bgImg) {
      ctx.globalAlpha = 0.12;
      ctx.drawImage(bgImg, panelRect.x, panelRect.y, panelRect.w, panelRect.h);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    drawNineSlice(ctx, panelTex, panelRect, 48, 48, 48, 48);
  } else {
    drawRecessedTileCard(ctx, panelRect, tokens, { variant: 'parchment', radius: 18, rimWidth: 6 });
  }

  // 顶部双圈木镶边羊皮纸匾额（对齐 gameplay_ref.jpg「第 8 关」精致木镶边羊皮纸牌匾！）
  const plaqueW = Math.min(panelRect.w - 86, Math.max(182, title.length * 17 + 44));
  const plaqueRect: Rect = {
    x: panelRect.x + (panelRect.w - plaqueW) * 0.5,
    y: panelRect.y - 17,
    w: plaqueW,
    h: 38,
  };
  drawDoubleRimPlaque(ctx, plaqueRect, tokens, {
    variant: 'parchment',
    rimThickness: 4.5,
    radius: 19,
  });
  drawInkText(
    ctx,
    title,
    plaqueRect.x + plaqueRect.w * 0.5,
    plaqueRect.y + plaqueRect.h * 0.5 + 0.5,
    tokens,
    {
      font: `800 16px ${tokens.typography.fontFamily}`,
      color: '#3E2311',
      maxWidth: plaqueW - 22,
    }
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
