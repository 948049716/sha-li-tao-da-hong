import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { LevelManager } from '../systems/LevelManager';
import type { SaveManager } from '../systems/SaveManager';
import type { Rect, UiTokensFile } from '../types/ui';
import type { SplashScreen } from './SplashScreen';
import {
  drawCoralCloseButton,
  drawDoubleRimPlaque,
  drawHandDrawnGlyph,
  drawInkText,
  drawParchmentModalFrame,
  drawStatusPill,
  drawStorybookNumber,
  drawWoodButton,
  drawWoodToggleCard,
  hitRect,
  roundRectPath,
} from './UIHelpers';

export type DrawerAction =
  | { type: 'CLOSE' }
  | { type: 'OPEN_GUIDE' }
  | { type: 'TOGGLE_SOUND' }
  | { type: 'TOGGLE_VIBRATE' }
  | { type: 'SYNC_CLOUD' }
  | { type: 'SELECT_LEVEL'; levelId: number }
  | { type: 'LOCKED_LEVEL_TOAST'; needLevel: number };

/**
 * 1:1 严格还原《选关与设置抽屉.webp》设计稿（全中文版）：
 * - 顶栏：左侧两枚圆木钮（音效 / 震动）+ 居中手写微倾「01 — 20」+ 右侧两枚圆钮（图鉴 / 云同步）
 * - 中部：4×5 选关方格（通关木框格带秒数与右下绿勾 ✓、当前发光金框格、未解锁灰褐凹陷石板格、10/20 关顶戴皇冠）
 * - 底部：左「8+ 适龄」「隐私指引」胶囊 + 右带双嫩叶的「07/20」羊皮纸进度章
 */
export class LevelDrawer {
  public isOpen = false;
  public showCadpa = false;
  public showPrivacy = false;

  private closeBtnRect: Rect = { x: 0, y: 0, w: 36, h: 36 };
  private soundBtnRect: Rect = { x: 0, y: 0, w: 40, h: 40 };
  private vibrateBtnRect: Rect = { x: 0, y: 0, w: 40, h: 40 };
  private guideBtnRect: Rect = { x: 0, y: 0, w: 40, h: 40 };
  private syncBtnRect: Rect = { x: 0, y: 0, w: 40, h: 40 };
  private levelCellRects: { levelId: number; rect: Rect; unlocked: boolean }[] = [];
  private cadpaLinkRect: Rect = { x: 0, y: 0, w: 84, h: 24 };
  private privacyLinkRect: Rect = { x: 0, y: 0, w: 88, h: 24 };
  private subPopupCloseRect: Rect = { x: 0, y: 0, w: 124, h: 40 };
  private panelRect: Rect = { x: 0, y: 0, w: 352, h: 560 };

  public handleTap(px: number, py: number): DrawerAction | null {
    if (!this.isOpen) return null;

    if (this.showCadpa || this.showPrivacy) {
      if (hitRect(px, py, this.subPopupCloseRect)) {
        this.showCadpa = false;
        this.showPrivacy = false;
      }
      return null;
    }

    if (hitRect(px, py, this.closeBtnRect) || !hitRect(px, py, this.panelRect)) {
      this.isOpen = false;
      return { type: 'CLOSE' };
    }

    const hitWithLabel = (r: Rect) =>
      hitRect(px, py, { x: r.x - 4, y: r.y - 2, w: r.w + 8, h: r.h + 18 });

    if (hitWithLabel(this.guideBtnRect)) return { type: 'OPEN_GUIDE' };
    if (hitWithLabel(this.soundBtnRect)) return { type: 'TOGGLE_SOUND' };
    if (hitWithLabel(this.vibrateBtnRect)) return { type: 'TOGGLE_VIBRATE' };
    if (hitWithLabel(this.syncBtnRect)) return { type: 'SYNC_CLOUD' };

    if (hitRect(px, py, this.cadpaLinkRect)) {
      this.showCadpa = true;
      return null;
    }
    if (hitRect(px, py, this.privacyLinkRect)) {
      this.showPrivacy = true;
      return null;
    }

    for (const cell of this.levelCellRects) {
      if (hitRect(px, py, cell.rect)) {
        if (!cell.unlocked) {
          return { type: 'LOCKED_LEVEL_TOAST', needLevel: cell.levelId - 1 };
        }
        this.isOpen = false;
        return { type: 'SELECT_LEVEL', levelId: cell.levelId };
      }
    }
    return null;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    levelMgr: LevelManager,
    saveMgr: SaveManager,
    assets: AssetLoader,
    splash: SplashScreen,
    tokens: UiTokensFile,
    timeSec: number
  ): void {
    if (!this.isOpen) return;
    const W = layout.screenW;
    const H = layout.screenH;

    const minTop = layout.menuRect.y + layout.menuRect.h + 14;
    const pw = Math.min(352, W - 26);
    const ph = Math.min(568, H - minTop - 16);
    this.panelRect = {
      x: Math.round((W - pw) * 0.5),
      y: Math.max(minTop, Math.round((H - ph) * 0.5 + 4)),
      w: pw,
      h: ph,
    };
    const p = this.panelRect;
    const compact = ph < 510;

    drawParchmentModalFrame(ctx, W, H, p, '', tokens, assets, 'ui_bg_level_drawer', {
      hideTitleRibbon: true,
    });

    this.closeBtnRect = { x: p.x + p.w - 26, y: p.y - 12, w: 36, h: 36 };
    drawCoralCloseButton(ctx, this.closeBtnRect, tokens);

    // 1. 顶部四圆钮 + 居中手写「01 — 20」（严格还原设计图布局，全中文标签）
    const padX = 22;
    const innerW = p.w - padX * 2;
    const rowY = p.y + (compact ? 18 : 22);
    const btnSz = compact ? 36 : 40;
    const btnGap = 9;

    this.soundBtnRect = { x: p.x + padX, y: rowY, w: btnSz, h: btnSz };
    this.vibrateBtnRect = { x: this.soundBtnRect.x + btnSz + btnGap, y: rowY, w: btnSz, h: btnSz };
    this.syncBtnRect = { x: p.x + p.w - padX - btnSz, y: rowY, w: btnSz, h: btnSz };
    this.guideBtnRect = { x: this.syncBtnRect.x - btnGap - btnSz, y: rowY, w: btnSz, h: btnSz };

    drawWoodToggleCard(
      ctx,
      this.soundBtnRect,
      '音效',
      saveMgr.data.settings.soundOn,
      'sound_on',
      'sound_off',
      tokens
    );
    drawWoodToggleCard(
      ctx,
      this.vibrateBtnRect,
      '震动',
      saveMgr.data.settings.vibrateOn,
      'vibrate_on',
      'vibrate_off',
      tokens
    );

    // 居中微倾手写「01 — 20」
    drawStorybookNumber(ctx, '01—20', p.x + p.w * 0.5, rowY + btnSz * 0.52, compact ? 22 : 25, tokens, {
      slant: -0.09,
    });

    // 右二：图鉴圆木钮
    drawDoubleRimPlaque(ctx, this.guideBtnRect, tokens, {
      variant: 'walnut',
      radius: btnSz * 0.5,
    });
    drawHandDrawnGlyph(
      ctx,
      'question',
      this.guideBtnRect.x + btnSz * 0.5,
      this.guideBtnRect.y + btnSz * 0.5,
      16,
      tokens
    );
    drawInkText(ctx, '图鉴', this.guideBtnRect.x + btnSz * 0.5, rowY + btnSz + 12, tokens, {
      font: `600 11px ${tokens.typography.fontFamily}`,
      color: '#3B2416',
    });

    // 右一：天蓝云同步圆钮
    drawDoubleRimPlaque(ctx, this.syncBtnRect, tokens, {
      variant: 'sky',
      radius: btnSz * 0.5,
    });
    drawHandDrawnGlyph(
      ctx,
      'cloud',
      this.syncBtnRect.x + btnSz * 0.5,
      this.syncBtnRect.y + btnSz * 0.5,
      17,
      tokens
    );
    drawInkText(ctx, '云同步', this.syncBtnRect.x + btnSz * 0.5, rowY + btnSz + 12, tokens, {
      font: `600 11px ${tokens.typography.fontFamily}`,
      color: '#3B2416',
    });

    // 2. 4×5 选关木框/金框/凹石方格矩阵
    const maxCleared = saveMgr.data.maxClearedLevel;
    const gridTop = rowY + btnSz + (compact ? 22 : 28);
    const footReserve = 50;
    const gridH = p.y + p.h - footReserve - gridTop;
    const cols = 4;
    const rows = 5;
    const gapX = 10;
    const gapY = compact ? 9 : 11;
    const cellW = Math.floor((innerW - gapX * (cols - 1)) / cols);
    const cellH = Math.min(72, Math.floor((gridH - gapY * (rows - 1)) / rows));

    this.levelCellRects = [];

    levelMgr.levels.forEach((lvl, idx) => {
      const col = idx % cols;
      const row = (idx / cols) | 0;
      const cx = p.x + padX + col * (cellW + gapX);
      const cy = gridTop + row * (cellH + gapY);
      const r: Rect = { x: cx, y: cy, w: cellW, h: cellH };

      const isCleared = lvl.levelId <= maxCleared;
      const unlocked = lvl.levelId <= maxCleared + 1;
      const isCurrent = lvl.levelId === saveMgr.data.currentLevel;

      this.levelCellRects.push({ levelId: lvl.levelId, rect: r, unlocked });

      const ordStr = String(lvl.levelId).padStart(2, '0');
      this.drawLevelCell(
        ctx,
        r,
        ordStr,
        {
          unlocked,
          isCleared,
          isCurrent,
          isBoss: lvl.type === 'boss',
          bestSec: saveMgr.data.bestTimeSecMap[lvl.levelId],
          pulsePhase: timeSec * 4.5,
        },
        tokens
      );
    });

    // 3. 底部合规双胶囊（左侧紧邻并排）与右侧带双嫩叶的进度胶囊（1:1 对齐设计图）
    const footY = p.y + p.h - 27;
    this.cadpaLinkRect = drawStatusPill(ctx, p.x + 56, footY, '8+ 适龄', tokens, {
      bgHex: '#DCEFD6',
      borderHex: '#4E6B48',
      textColor: '#253D22',
      fontSize: 11,
      padX: 12,
      height: 22,
    });
    this.privacyLinkRect = drawStatusPill(
      ctx,
      this.cadpaLinkRect.x + this.cadpaLinkRect.w + 38,
      footY,
      '隐私指引',
      tokens,
      {
        bgHex: '#E5DCF5',
        borderHex: '#5B4E76',
        textColor: '#2E2542',
        fontSize: 11,
        padX: 12,
        height: 22,
      }
    );

    const progStr = `${String(maxCleared).padStart(2, '0')}/${levelMgr.totalLevels}`;
    const progPill = drawStatusPill(ctx, p.x + p.w - 56, footY, progStr, tokens, {
      bgHex: '#F7EBD2',
      borderHex: '#6E5236',
      textColor: '#2E1B10',
      fontSize: 12,
      padX: 16,
      height: 22,
    });

    // 进度胶囊右上角双嫩叶装饰
    ctx.save();
    ctx.translate(progPill.x + progPill.w - 3, progPill.y + 1);
    ctx.fillStyle = '#8CD17D';
    ctx.strokeStyle = '#3B2416';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.ellipse(2, -4.5, 5.6, 2.7, -0.68, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(7.0, -1.2, 4.8, 2.2, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (this.showCadpa) {
      this.subPopupCloseRect = splash.renderCadpaPopup(ctx, W, H, assets, tokens);
    } else if (this.showPrivacy) {
      const pw2 = Math.min(320, W - 28);
      const ph2 = 212;
      const pop: Rect = { x: (W - pw2) * 0.5, y: (H - ph2) * 0.5, w: pw2, h: ph2 };
      drawParchmentModalFrame(ctx, W, H, pop, '隐私保护指引', tokens, assets);
      const lines = [
        '• 关卡进度与最佳纪录安全保存于本地与云端。',
        '• 本作为纯益智解谜小游戏，不索取敏感个人信息。',
        '• 不收集位置、通讯录、相机等任何无关权限。',
      ];
      lines.forEach((ln, i) => {
        drawInkText(ctx, ln, pop.x + 22, pop.y + 58 + i * 26, tokens, {
          font: `600 12px ${tokens.typography.fontFamily}`,
          color: '#3B2416',
          align: 'left',
          maxWidth: pw2 - 44,
        });
      });
      this.subPopupCloseRect = { x: pop.x + (pw2 - 120) * 0.5, y: pop.y + ph2 - 52, w: 120, h: 38 };
      drawWoodButton(ctx, this.subPopupCloseRect, '好的', tokens, assets, {
        fillHex: '#1F7A44',
        fontSize: 13.5,
      });
    }
  }

  private drawLevelCell(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    ordStr: string,
    state: {
      unlocked: boolean;
      isCleared: boolean;
      isCurrent: boolean;
      isBoss: boolean;
      bestSec?: number;
      pulsePhase: number;
    },
    tokens: UiTokensFile
  ): void {
    const midX = r.x + r.w * 0.5;
    const rad = 11;
    const inset = 4.5;

    ctx.save();

    if (state.isCurrent && state.unlocked) {
      // 发光金框当前关卡格（1:1 还原设计图中发光的 08 格）
      const glowAlpha = 0.36 + 0.14 * Math.sin(state.pulsePhase);
      ctx.fillStyle = `rgba(245, 184, 65, ${glowAlpha})`;
      ctx.beginPath();
      roundRectPath(ctx, r.x - 4, r.y - 3, r.w + 8, r.h + 7, rad + 3);
      ctx.fill();

      const frameGrad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      frameGrad.addColorStop(0, '#FFE79E');
      frameGrad.addColorStop(1, '#E8AD45');
      ctx.fillStyle = frameGrad;
      ctx.strokeStyle = '#6E4614';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, rad);
      ctx.fill();
      ctx.stroke();

      const inGrad = ctx.createRadialGradient(midX, r.y + r.h * 0.5, 4, midX, r.y + r.h * 0.5, r.w * 0.65);
      inGrad.addColorStop(0, '#FFFDF2');
      inGrad.addColorStop(1, '#FCE7B2');
      ctx.fillStyle = inGrad;
      ctx.strokeStyle = '#9E6E24';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      roundRectPath(ctx, r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2, rad - 3);
      ctx.fill();
      ctx.stroke();

      // 左上角深棕小圆点
      ctx.fillStyle = '#4B2E16';
      ctx.beginPath();
      ctx.arc(r.x + inset + 6, r.y + inset + 6, 2.4, 0, Math.PI * 2);
      ctx.fill();

      drawStorybookNumber(ctx, ordStr, midX, r.y + r.h * 0.53, r.h < 60 ? 22 : 25, tokens);
    } else if (!state.unlocked) {
      // 未解锁灰褐凹陷石板格
      ctx.fillStyle = 'rgba(40, 32, 22, 0.14)';
      ctx.beginPath();
      roundRectPath(ctx, r.x, r.y + 2, r.w, r.h, rad);
      ctx.fill();

      ctx.fillStyle = '#BEB4A4';
      ctx.strokeStyle = '#7E7364';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, rad);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#CBC2B2';
      ctx.strokeStyle = 'rgba(110, 100, 86, 0.45)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      roundRectPath(ctx, r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2, rad - 3);
      ctx.fill();
      ctx.stroke();

      drawStorybookNumber(ctx, ordStr, midX, r.y + r.h * 0.48, r.h < 60 ? 20 : 23, tokens, {
        color: '#7A7062',
        embossColor: 'rgba(255,255,255,0.3)',
      });
      drawHandDrawnGlyph(ctx, 'lock', r.x + r.w - 12, r.y + r.h - 12, 13.5, tokens);
    } else {
      // 已通关或可挑战浅橡木画框格（带底部秒数与右下绿勾 ✓）
      ctx.fillStyle = 'rgba(34, 20, 10, 0.20)';
      ctx.beginPath();
      roundRectPath(ctx, r.x, r.y + 2.5, r.w, r.h, rad);
      ctx.fill();

      const wGrad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      wGrad.addColorStop(0, '#DFBA8B');
      wGrad.addColorStop(1, '#BA8B56');
      ctx.fillStyle = wGrad;
      ctx.strokeStyle = '#3B2416';
      ctx.lineWidth = 1.65;
      ctx.beginPath();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, rad);
      ctx.fill();
      ctx.stroke();

      const cGrad = ctx.createLinearGradient(0, r.y + inset, 0, r.y + r.h - inset);
      cGrad.addColorStop(0, '#FBF3E0');
      cGrad.addColorStop(1, '#EFE0C0');
      ctx.fillStyle = cGrad;
      ctx.strokeStyle = '#6E4B2A';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      roundRectPath(ctx, r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2, rad - 3);
      ctx.fill();
      ctx.stroke();

      drawStorybookNumber(
        ctx,
        ordStr,
        midX,
        state.bestSec ? r.y + r.h * 0.42 : r.y + r.h * 0.52,
        r.h < 60 ? 20 : 23,
        tokens
      );

      if (state.bestSec) {
        drawInkText(ctx, `${Math.round(state.bestSec)}s`, midX - 2, r.y + r.h * 0.75, tokens, {
          font: `700 11px ${tokens.typography.numeralFontFamily}`,
          color: '#3B2416',
        });
      }

      if (state.isCleared) {
        drawHandDrawnGlyph(ctx, 'check', r.x + r.w - 10, r.y + r.h - 10, 15, tokens);
      }
    }

    // Boss 关（10、20）顶部正中戴金色小皇冠
    if (state.isBoss) {
      drawHandDrawnGlyph(ctx, 'crown', midX, r.y - 1.5, 21, tokens);
    }

    ctx.restore();
  }
}
