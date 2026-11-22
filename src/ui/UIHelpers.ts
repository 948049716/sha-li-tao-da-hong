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
  fill: string,
  stroke: string,
  lineWidth = 2.5,
  align: CanvasTextAlign = 'center'
): void {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  if (lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth * 2;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * 九宫格无损缩放绘制手绘木牌与羊皮纸画框（保护四角黄铜包边与手绘墨线不拉伸变形）
 */
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
      if ( dwArr[col] <= 0 || dhArr[row] <= 0 || swArr[col] <= 0 || shArr[row] <= 0 ) continue;
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

/**
 * 将原本的高饱和现代纯色映射为绘本木屋工坊柔和木染釉色（保留底下天然木纹与黄铜包角）
 */
function mapFillToStorybookGlaze(fillHex?: string): { glaze: string | null; fallbackBg: string; fallbackLip: string } {
  if (!fillHex) {
    return { glaze: null, fallbackBg: '#D99B52', fallbackLip: '#8C5423' };
  }
  const up = fillHex.toUpperCase();
  // 朱红漆木（主行动按钮 / 大红合成）：对齐封面“大红”与朱红宝箱暖红调
  if (up === '#EA580C' || up === '#DC2626' || up === '#EF4444' || up === '#B91C1C') {
    return { glaze: 'rgba(196, 62, 34, 0.46)', fallbackBg: '#C85232', fallbackLip: '#7C2D12' };
  }
  // 浆果胡桃木（藏馆 / 碎片入口）：温润暖棕红，告别荧光紫
  if (up === '#7E22CE' || up === '#4C1D95' || up === '#A855F7') {
    return { glaze: 'rgba(128, 56, 76, 0.36)', fallbackBg: '#9D5C63', fallbackLip: '#5C3038' };
  }
  // 星夜靛木（图鉴 / 普通合成）：对齐封面夜空窗深靛蓝水彩
  if (up === '#0284C7' || up === '#38BDF8') {
    return { glaze: 'rgba(52, 88, 128, 0.36)', fallbackBg: '#5B7E9E', fallbackLip: '#334B63' };
  }
  // 橄榄森木（分享 / 开关开启态）：柔和鼠尾草暖绿，告别刺眼纯绿
  if (up === '#15803D' || up === '#10B981') {
    return { glaze: 'rgba(72, 118, 68, 0.36)', fallbackBg: '#6B9662', fallbackLip: '#3E5C38' };
  }
  // 旧浮木（未选中 Tab / 禁用态）
  if (up === '#9CA3AF' || up === '#C89F72' || up === '#6B7280') {
    return { glaze: 'rgba(92, 72, 56, 0.28)', fallbackBg: '#B89674', fallbackLip: '#6E5239' };
  }
  // 深焦糖胡桃木（次级按钮）
  if (up === '#9A6228' || up === '#3B2514') {
    return { glaze: 'rgba(88, 48, 20, 0.28)', fallbackBg: '#A66B35', fallbackLip: '#5C3718' };
  }
  // 琥珀蜜蜡木（默认高亮）
  return { glaze: 'rgba(217, 130, 24, 0.16)', fallbackBg: '#D99B52', fallbackLip: '#8C5423' };
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
  // 自动柔化遗留深黑/冷紫色顶栏胶囊为绘本焦糖深木色
  const safeBg =
    upBg === '#4C1D95' ? '#6D4339' : upBg === '#3B2514' ? '#5C3A21' : bgHex;
  const safeLip =
    lipHex.toUpperCase() === '#2E1065' ? '#3E221B' : lipHex;

  ctx.save();
  // 底部实心深木厚度边
  ctx.fillStyle = safeLip;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y + 2.5, r.w, r.h, radius);
  ctx.fill();

  // 主体手绘木/羊皮纸面
  ctx.fillStyle = safeBg;
  ctx.strokeStyle = tokens.theme.inkOutline;
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.fill();
  ctx.stroke();

  // 内圈手绘虚实高光衬线（还原绘本水彩纸留白感）
  const isLightParchment =
    safeBg.startsWith('rgba(255') ||
    upBg === '#FFF8EC' ||
    upBg === '#FDF1DC' ||
    upBg === '#FEF3C7' ||
    upBg === '#E5E0D8';
  ctx.strokeStyle = isLightParchment ? 'rgba(180, 130, 82, 0.35)' : 'rgba(255, 243, 214, 0.38)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  roundRectPath(ctx, r.x + 2.5, r.y + 2.2, Math.max(2, r.w - 5), Math.max(2, r.h - 4.8), Math.max(4, radius - 2.5));
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
  const tailW = Math.min(20, height * 0.62);
  const ink = tokens.theme.inkOutline;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 左右两侧下沉燕尾折角（深一阶暖麦色阴影）
  for (const dir of [-1, 1]) {
    ctx.fillStyle = '#DFBA84';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dir * (hw - 8), -hh + 5);
    ctx.lineTo(dir * (hw + tailW), -hh + 5);
    ctx.lineTo(dir * (hw + tailW - 7), 4);
    ctx.lineTo(dir * (hw + tailW), hh + 5);
    ctx.lineTo(dir * (hw - 12), hh + 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 丝带内折暗三角
    ctx.fillStyle = '#9E6836';
    ctx.beginPath();
    ctx.moveTo(dir * hw, hh);
    ctx.lineTo(dir * (hw - 10), hh + 5);
    ctx.lineTo(dir * (hw - 10), hh - 1);
    ctx.closePath();
    ctx.fill();
  }

  // 中央微拱奶油羊皮纸主横幅
  const arch = 3.5;
  ctx.fillStyle = '#FFF5DE';
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

  // 上下暖棕细内线（如封面丝带双线描边）
  ctx.strokeStyle = 'rgba(166, 108, 56, 0.48)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-hw + 6, -hh + arch + 3);
  ctx.quadraticCurveTo(0, -hh - arch + 3, hw - 6, -hh + arch + 3);
  ctx.moveTo(-hw + 6, hh + arch * 0.6 - 3);
  ctx.quadraticCurveTo(0, hh - arch * 0.8 - 3, hw - 6, hh + arch * 0.6 - 3);
  ctx.stroke();

  drawOutlinedText(
    ctx,
    text,
    0,
    0.5,
    `700 ${fontSize}px ${tokens.typography.fontFamily}`,
    ink,
    '#FFFDF7',
    1.2
  );

  ctx.restore();
}

/**
 * 绘制九宫格蜂蜜木框 + 羊皮纸内芯卡片（用于主菜单展台与内嵌信息板）
 */
export function drawStorybookCardFrame(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  tokens: UiTokensFile,
  sprites: SpriteProvider
): void {
  const panelTex = sprites.get('ui_panel_parchment');
  if (panelTex && r.w >= 120 && r.h >= 100) {
    ctx.save();
    // 底部木框微投影
    ctx.fillStyle = 'rgba(62, 34, 14, 0.28)';
    ctx.beginPath();
    roundRectPath(ctx, r.x + 2, r.y + 4, r.w - 4, r.h, 14);
    ctx.fill();
    drawNineSlice(ctx, panelTex, r, 46, 46, 46, 46);
    ctx.restore();
  } else {
    drawWoodCapsule(ctx, r, tokens, tokens.theme.parchmentBg, tokens.theme.woodDark, 16);
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
    scale = 1 + 0.03 * p;
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

  if (woodTex && r.w >= 64 && r.h >= 26) {
    // 1. 九宫格绘制手绘蜂蜜木牌与四角黄铜包边（永不变形）
    drawNineSlice(
      ctx,
      woodTex,
      { x: localRect.x - 1, y: localRect.y - 1, w: localRect.w + 2, h: localRect.h + 2 },
      34,
      34,
      26,
      28
    );
    // 2. 水彩木釉轻叠（区分主按钮朱红漆木 / 次按钮胡桃木，同时完整保留底下木纹肌理！）
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
    drawWoodCapsule(ctx, localRect, tokens, styleMap.fallbackBg, styleMap.fallbackLip, 11);
  }

  const fSize = opts.fontSize || 13;
  const font = `700 ${fSize}px ${tokens.typography.fontFamily}`;
  const textCol = opts.textColor || '#FFF9EE';

  if (opts.icon && opts.subLabel === undefined && r.h >= 50 && r.w <= 96) {
    // 上图标 + 下文字（局内底部 4 道具栏样式）
    const isz = opts.iconSize || 28;
    ctx.drawImage(opts.icon, -isz * 0.5, localRect.y + 5, isz, isz);
    drawOutlinedText(
      ctx,
      label,
      0,
      localRect.y + localRect.h - 11,
      `700 11px ${tokens.typography.fontFamily}`,
      textCol,
      tokens.theme.inkOutline,
      2.1
    );
  } else if (opts.icon && opts.subLabel) {
    // 左手绘图标 + 右双行主副标题（主菜单大厅功能卡专用绘本排版）
    const isz = opts.iconSize || 30;
    const iconX = localRect.x + 12;
    ctx.drawImage(opts.icon, iconX, -isz * 0.5, isz, isz);
    const textCenterX = (iconX + isz + localRect.x + localRect.w - 8) * 0.5;
    drawOutlinedText(ctx, label, textCenterX, -7, font, textCol, tokens.theme.inkOutline, 2.3);
    drawOutlinedText(
      ctx,
      opts.subLabel,
      textCenterX,
      10,
      `600 10px ${tokens.typography.fontFamily}`,
      '#FFF3D6',
      tokens.theme.inkOutline,
      1.7
    );
  } else if (opts.icon) {
    const isz = opts.iconSize || 20;
    const iconX = localRect.x + 9;
    ctx.drawImage(opts.icon, iconX, -isz * 0.5, isz, isz);
    const textCenterX = (iconX + isz + localRect.x + localRect.w - 6) * 0.5;
    drawOutlinedText(ctx, label, textCenterX, 0.5, font, textCol, tokens.theme.inkOutline, 2.2);
  } else if (opts.subLabel) {
    drawOutlinedText(ctx, label, 0, -7, font, textCol, tokens.theme.inkOutline, 2.4);
    drawOutlinedText(
      ctx,
      opts.subLabel,
      0,
      10,
      `600 10.5px ${tokens.typography.fontFamily}`,
      '#FFF3D6',
      tokens.theme.inkOutline,
      1.8
    );
  } else {
    drawOutlinedText(ctx, label, 0, 0.5, font, textCol, tokens.theme.inkOutline, 2.3);
  }

  // 右上角绘本木签微角标（暖绿/朱红水彩底，无荧光刺眼色）
  if (opts.badgeText) {
    const bw = Math.max(40, opts.badgeText.length * 8 + 8);
    const bh = 16;
    const bx = localRect.x + localRect.w - bw + 3;
    const by = localRect.y - 5;
    const rawBadge = (opts.badgeBgHex || '#558B4E').toUpperCase();
    const softBadge =
      rawBadge === '#10B981' ? '#528A4E' : rawBadge === '#EF4444' ? '#C43E22' : opts.badgeBgHex || '#528A4E';
    ctx.fillStyle = softBadge;
    ctx.strokeStyle = tokens.theme.inkOutline;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    roundRectPath(ctx, bx, by, bw, bh, 7);
    ctx.fill();
    ctx.stroke();
    drawOutlinedText(
      ctx,
      opts.badgeText,
      bx + bw * 0.5,
      by + bh * 0.5 + 0.5,
      `700 9.5px ${tokens.typography.fontFamily}`,
      '#FFFDF7',
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

  // 底部暖木投影
  ctx.fillStyle = 'rgba(42, 22, 9, 0.42)';
  ctx.beginPath();
  roundRectPath(ctx, panelRect.x + 2, panelRect.y + 6, panelRect.w - 4, panelRect.h, 16);
  ctx.fill();

  const panelTex = sprites.get('ui_panel_parchment');
  if (panelTex) {
    // 1. 先在画框内衬叠淡雅背景暗纹（可选）
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, panelRect.x + 14, panelRect.y + 14, panelRect.w - 28, panelRect.h - 28, 8);
    ctx.clip();
    ctx.fillStyle = tokens.theme.parchmentBg;
    ctx.fillRect(panelRect.x, panelRect.y, panelRect.w, panelRect.h);
    const bgImg = bgSpriteId ? sprites.get(bgSpriteId) : null;
    if (bgImg) {
      ctx.globalAlpha = 0.14;
      ctx.drawImage(bgImg, panelRect.x, panelRect.y, panelRect.w, panelRect.h);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // 2. 叠绘九宫格蜂蜜木框 + 黄铜包角 + 羊皮纸边（边缘自然融合）
    drawNineSlice(ctx, panelTex, panelRect, 48, 48, 48, 48);
  } else {
    drawWoodCapsule(ctx, panelRect, tokens, tokens.theme.parchmentBg, tokens.theme.woodDark, 18);
  }

  // 3. 顶部九宫格手绘木匾标题牌 + 燕尾装饰
  const plaqueW = Math.min(panelRect.w - 40, Math.max(196, title.length * 19 + 44));
  const plaqueRect: Rect = {
    x: panelRect.x + (panelRect.w - plaqueW) * 0.5,
    y: panelRect.y - 17,
    w: plaqueW,
    h: 40,
  };
  const woodBtn = sprites.get('ui_btn_wood');
  if (woodBtn) {
    drawNineSlice(ctx, woodBtn, plaqueRect, 34, 34, 20, 20);
  } else {
    drawWoodCapsule(ctx, plaqueRect, tokens, tokens.theme.woodPrimary, tokens.theme.woodDark, 14);
  }
  drawOutlinedText(
    ctx,
    title,
    plaqueRect.x + plaqueRect.w * 0.5,
    plaqueRect.y + plaqueRect.h * 0.5,
    `800 17px ${tokens.typography.fontFamily}`,
    '#FFF9EE',
    tokens.theme.inkOutline,
    2.6
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
