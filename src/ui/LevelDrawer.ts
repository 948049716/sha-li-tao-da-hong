import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { LevelManager } from '../systems/LevelManager';
import type { SaveManager } from '../systems/SaveManager';
import type { Rect, UiTokensFile } from '../types/ui';
import type { SplashScreen } from './SplashScreen';
import {
  drawDoubleRimPlaque,
  drawHandDrawnGlyph,
  drawInkText,
  drawParchmentModalFrame,
  drawRecessedTileCard,
  drawStatusPill,
  drawWoodButton,
  drawWoodToggleCard,
  hitRect,
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
 * 日系治愈极简选关与设置面板（LevelDrawer）：
 * - 图标优先顶栏（音效拨杆 / 触感拨杆 / ? 玩法圆钮 / 云同步圆钮）
 * - 4×5 纯序号选关矩阵（仅保留 01~20 序号与最佳秒数，零关卡名）
 */
export class LevelDrawer {
  public isOpen = false;
  public showCadpa = false;
  public showPrivacy = false;

  private closeBtnRect: Rect = { x: 0, y: 0, w: 34, h: 34 };
  private soundBtnRect: Rect = { x: 0, y: 0, w: 96, h: 38 };
  private vibrateBtnRect: Rect = { x: 0, y: 0, w: 96, h: 38 };
  private guideBtnRect: Rect = { x: 0, y: 0, w: 38, h: 38 };
  private syncBtnRect: Rect = { x: 0, y: 0, w: 38, h: 38 };
  private levelCellRects: { levelId: number; rect: Rect; unlocked: boolean }[] = [];
  private cadpaLinkRect: Rect = { x: 0, y: 0, w: 92, h: 24 };
  private privacyLinkRect: Rect = { x: 0, y: 0, w: 100, h: 24 };
  private subPopupCloseRect: Rect = { x: 0, y: 0, w: 124, h: 40 };
  private panelRect: Rect = { x: 0, y: 0, w: 356, h: 540 };

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

    if (hitRect(px, py, this.guideBtnRect)) return { type: 'OPEN_GUIDE' };
    if (hitRect(px, py, this.soundBtnRect)) return { type: 'TOGGLE_SOUND' };
    if (hitRect(px, py, this.vibrateBtnRect)) return { type: 'TOGGLE_VIBRATE' };
    if (hitRect(px, py, this.syncBtnRect)) return { type: 'SYNC_CLOUD' };

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
    const pw = Math.min(362, W - 20);
    const ph = Math.min(542, H - minTop - 14);
    this.panelRect = { x: (W - pw) * 0.5, y: Math.max(minTop, (H - ph) * 0.5 + 6), w: pw, h: ph };
    const p = this.panelRect;
    const compact = ph < 500;

    drawParchmentModalFrame(ctx, W, H, p, '01 — 20', tokens, assets, 'ui_bg_level_drawer');

    // 右上角极简关闭圆钮
    this.closeBtnRect = { x: p.x + p.w - 44, y: p.y - 15, w: 32, h: 32 };
    drawDoubleRimPlaque(ctx, this.closeBtnRect, tokens, {
      variant: 'rose',
      radius: 16,
    });
    drawHandDrawnGlyph(ctx, 'close', this.closeBtnRect.x + 16, this.closeBtnRect.y + 16, 13, tokens);

    // 1. 单排纯图标控制条（音效拨杆 | 触感拨杆 | ? 指南圆钮 | ☁ 云同步圆钮）
    const padX = 18;
    const innerW = p.w - padX * 2;
    const rowY = p.y + (compact ? 26 : 30);
    const rowH = 38;
    const gap = 8;
    const circleW = 38;
    const toggleW = Math.floor((innerW - circleW * 2 - gap * 3) * 0.5);

    this.soundBtnRect = { x: p.x + padX, y: rowY, w: toggleW, h: rowH };
    this.vibrateBtnRect = { x: this.soundBtnRect.x + toggleW + gap, y: rowY, w: toggleW, h: rowH };
    this.guideBtnRect = { x: this.vibrateBtnRect.x + toggleW + gap, y: rowY, w: circleW, h: rowH };
    this.syncBtnRect = { x: this.guideBtnRect.x + circleW + gap, y: rowY, w: circleW, h: rowH };

    drawWoodToggleCard(
      ctx,
      this.soundBtnRect,
      '',
      saveMgr.data.settings.soundOn,
      'sound_on',
      'sound_off',
      tokens
    );
    drawWoodToggleCard(
      ctx,
      this.vibrateBtnRect,
      '',
      saveMgr.data.settings.vibrateOn,
      'vibrate_on',
      'vibrate_off',
      tokens
    );

    drawDoubleRimPlaque(ctx, this.guideBtnRect, tokens, {
      variant: 'sky',
      radius: 19,
    });
    drawHandDrawnGlyph(
      ctx,
      'question',
      this.guideBtnRect.x + circleW * 0.5,
      this.guideBtnRect.y + rowH * 0.5,
      18,
      tokens
    );

    const synced = saveMgr.lastCloudSyncStatus === 'synced';
    drawDoubleRimPlaque(ctx, this.syncBtnRect, tokens, {
      variant: synced ? 'mint' : 'parchment',
      radius: 19,
    });
    drawHandDrawnGlyph(
      ctx,
      'cloud',
      this.syncBtnRect.x + circleW * 0.5,
      this.syncBtnRect.y + rowH * 0.5,
      18,
      tokens
    );

    // 2. 4×5 纯序号章节矩阵（仅序号 01~20，零关卡文字名）
    const maxCleared = saveMgr.data.maxClearedLevel;
    const gridTop = rowY + rowH + (compact ? 12 : 16);
    const footReserve = 46;
    const gridH = p.y + p.h - footReserve - gridTop;
    const cols = 4;
    const rows = 5;
    const gapX = 8;
    const gapY = compact ? 7 : 8;
    const cellW = Math.floor((innerW - gapX * (cols - 1)) / cols);
    const cellH = Math.min(68, Math.floor((gridH - gapY * (rows - 1)) / rows));

    this.levelCellRects = [];

    levelMgr.levels.forEach((lvl, idx) => {
      const col = idx % cols;
      const row = (idx / cols) | 0;
      const cx = p.x + padX + col * (cellW + gapX);
      const cy = gridTop + row * (cellH + gapY);
      const r: Rect = { x: cx, y: cy, w: cellW, h: cellH };

      const isCleared = lvl.levelId <= maxCleared;
      const isFrontier = lvl.levelId === maxCleared + 1;
      const unlocked = lvl.levelId <= maxCleared + 1;
      const isCurrent = lvl.levelId === saveMgr.data.currentLevel;

      this.levelCellRects.push({ levelId: lvl.levelId, rect: r, unlocked });

      const variant = !unlocked
        ? 'locked'
        : isCurrent || isFrontier
          ? 'amber'
          : isCleared
            ? 'mint'
            : 'parchment';

      const inner = drawRecessedTileCard(ctx, r, tokens, {
        variant,
        radius: 14,
        pulse: isFrontier,
        pulsePhase: timeSec * 4.8,
      });

      const midX = inner.x + inner.w * 0.5;
      const ordStr = String(lvl.levelId).padStart(2, '0');

      if (!unlocked) {
        drawInkText(ctx, ordStr, midX, inner.y + inner.h * 0.34, tokens, {
          font: `700 14px ${tokens.typography.numeralFontFamily}`,
          color: '#9A9288',
        });
        drawHandDrawnGlyph(ctx, 'lock', midX, inner.y + inner.h * 0.70, 15, tokens);
        return;
      }

      if (lvl.type === 'boss') {
        drawHandDrawnGlyph(ctx, 'crown', inner.x + 10, inner.y + 10, 12, tokens);
      } else if (lvl.type === 'bonus') {
        drawHandDrawnGlyph(ctx, 'sparkle', inner.x + 10, inner.y + 10, 11, tokens);
      }
      if (isCleared) {
        drawHandDrawnGlyph(ctx, 'check', inner.x + inner.w - 10, inner.y + 10, 12, tokens);
      }

      drawInkText(ctx, ordStr, midX, inner.y + inner.h * 0.44, tokens, {
        font: `700 ${cellH < 56 ? 17 : 19}px ${tokens.typography.numeralFontFamily}`,
        color: '#4B403B',
      });

      const bestSec = saveMgr.data.bestTimeSecMap[lvl.levelId];
      const subStr = bestSec ? `${bestSec.toFixed(0)}s` : isCurrent ? '●' : '▸';
      drawInkText(ctx, subStr, midX, inner.y + inner.h * 0.78, tokens, {
        font: `600 9.5px ${tokens.typography.numeralFontFamily}`,
        color: isCleared ? '#4E7D5E' : '#967438',
      });
    });

    // 3. 底部合规与进度状态胶囊
    const footY = p.y + p.h - 26;
    this.cadpaLinkRect = drawStatusPill(ctx, p.x + 58, footY, '8+ 适龄', tokens, {
      bgHex: '#EFF9F1',
      borderHex: '#6BA67E',
      textColor: '#3B6E4C',
      fontSize: 9.5,
      padX: 10,
      height: 18,
    });
    this.privacyLinkRect = drawStatusPill(ctx, p.x + 138, footY, '隐私指引', tokens, {
      bgHex: '#EFF6FC',
      borderHex: '#6E9EC0',
      textColor: '#3A6382',
      fontSize: 9.5,
      padX: 10,
      height: 18,
    });
    drawInkText(ctx, `${maxCleared}/${levelMgr.totalLevels}`, p.x + p.w - 24, footY, tokens, {
      font: `700 11px ${tokens.typography.numeralFontFamily}`,
      color: '#7A6B63',
      align: 'right',
    });

    if (this.showCadpa) {
      this.subPopupCloseRect = splash.renderCadpaPopup(ctx, W, H, assets, tokens);
    } else if (this.showPrivacy) {
      const pw2 = Math.min(320, W - 28);
      const ph2 = 204;
      const pop: Rect = { x: (W - pw2) * 0.5, y: (H - ph2) * 0.5, w: pw2, h: ph2 };
      drawParchmentModalFrame(ctx, W, H, pop, '隐私保护指引', tokens, assets);
      const lines = [
        '• 关卡进度与最佳纪录安全保存于本地与云端。',
        '• 本作为纯益智解谜小游戏，不索取敏感个人信息。',
        '• 不收集位置、通讯录、相机等任何无关权限。',
      ];
      lines.forEach((ln, i) => {
        drawInkText(ctx, ln, pop.x + 20, pop.y + 54 + i * 25, tokens, {
          font: `600 11.5px ${tokens.typography.fontFamily}`,
          color: '#4B403B',
          align: 'left',
          maxWidth: pw2 - 40,
        });
      });
      this.subPopupCloseRect = { x: pop.x + (pw2 - 120) * 0.5, y: pop.y + ph2 - 50, w: 120, h: 38 };
      drawWoodButton(ctx, this.subPopupCloseRect, '好的', tokens, assets, {
        fillHex: '#15803D',
        fontSize: 13,
      });
    }
  }
}
