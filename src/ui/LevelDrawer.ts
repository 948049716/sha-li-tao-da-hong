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
 * 极简工坊设置与第 1~20 关章节选关面板（LevelDrawer）
 */
export class LevelDrawer {
  public isOpen = false;
  public showCadpa = false;
  public showPrivacy = false;

  private closeBtnRect: Rect = { x: 0, y: 0, w: 34, h: 34 };
  private soundBtnRect: Rect = { x: 0, y: 0, w: 150, h: 38 };
  private vibrateBtnRect: Rect = { x: 0, y: 0, w: 150, h: 38 };
  private guideBtnRect: Rect = { x: 0, y: 0, w: 150, h: 32 };
  private syncBtnRect: Rect = { x: 0, y: 0, w: 150, h: 32 };
  private levelCellRects: { levelId: number; rect: Rect; unlocked: boolean }[] = [];
  private cadpaLinkRect: Rect = { x: 0, y: 0, w: 92, h: 24 };
  private privacyLinkRect: Rect = { x: 0, y: 0, w: 100, h: 24 };
  private subPopupCloseRect: Rect = { x: 0, y: 0, w: 124, h: 40 };
  private panelRect: Rect = { x: 0, y: 0, w: 356, h: 568 };

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
    const pw = Math.min(366, W - 18);
    const ph = Math.min(568, H - minTop - 12);
    this.panelRect = { x: (W - pw) * 0.5, y: Math.max(minTop, (H - ph) * 0.5 + 8), w: pw, h: ph };
    const p = this.panelRect;
    const compact = ph < 530;

    drawParchmentModalFrame(ctx, W, H, p, '选关与设置', tokens, assets, 'ui_bg_level_drawer');

    // 右上角关闭圆章
    this.closeBtnRect = { x: p.x + p.w - 46, y: p.y - 15, w: 34, h: 34 };
    drawDoubleRimPlaque(ctx, this.closeBtnRect, tokens, {
      variant: 'rose',
      rimThickness: 3.4,
      radius: 17,
    });
    drawHandDrawnGlyph(ctx, 'close', this.closeBtnRect.x + 17, this.closeBtnRect.y + 17, 14, tokens);

    // 1. 音效 / 震动开关 + 玩法说明 / 云端存档
    const padX = 16;
    const innerW = p.w - padX * 2;
    const colGap = 8;
    const halfW = Math.floor((innerW - colGap) * 0.5);

    const toggleY = p.y + (compact ? 26 : 30);
    const toggleH = compact ? 36 : 40;
    this.soundBtnRect = { x: p.x + padX, y: toggleY, w: halfW, h: toggleH };
    this.vibrateBtnRect = { x: p.x + padX + halfW + colGap, y: toggleY, w: halfW, h: toggleH };

    drawWoodToggleCard(
      ctx,
      this.soundBtnRect,
      '音乐音效',
      saveMgr.data.settings.soundOn,
      'sound_on',
      'sound_off',
      tokens
    );
    drawWoodToggleCard(
      ctx,
      this.vibrateBtnRect,
      '触感震动',
      saveMgr.data.settings.vibrateOn,
      'vibrate_on',
      'vibrate_off',
      tokens
    );

    const subRowY = toggleY + toggleH + 7;
    const subRowH = compact ? 30 : 32;
    this.guideBtnRect = { x: p.x + padX, y: subRowY, w: halfW, h: subRowH };
    this.syncBtnRect = { x: p.x + padX + halfW + colGap, y: subRowY, w: halfW, h: subRowH };

    const gInner = drawDoubleRimPlaque(ctx, this.guideBtnRect, tokens, {
      variant: 'sky',
      rimThickness: 3,
      radius: subRowH * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'book', gInner.x + 14, this.guideBtnRect.y + subRowH * 0.5, 16, tokens);
    drawInkText(
      ctx,
      '机关玩法说明 ›',
      gInner.x + gInner.w * 0.5 + 7,
      this.guideBtnRect.y + subRowH * 0.5 + 0.5,
      tokens,
      {
        font: `700 11px ${tokens.typography.fontFamily}`,
        color: '#1E4668',
        maxWidth: gInner.w - 26,
      }
    );

    const syncStatus = saveMgr.lastCloudSyncStatus;
    const syncText =
      syncStatus === 'syncing'
        ? '正在云端同步...'
        : syncStatus === 'synced'
          ? '✓ 云端存档已同步'
          : '备份至云端存档';
    const sInner = drawDoubleRimPlaque(ctx, this.syncBtnRect, tokens, {
      variant: syncStatus === 'synced' ? 'mint' : 'parchment',
      rimThickness: 3,
      radius: subRowH * 0.5,
    });
    drawHandDrawnGlyph(ctx, 'cloud', sInner.x + 14, this.syncBtnRect.y + subRowH * 0.5, 17, tokens);
    drawInkText(
      ctx,
      syncText,
      sInner.x + sInner.w * 0.5 + 7,
      this.syncBtnRect.y + subRowH * 0.5 + 0.5,
      tokens,
      {
        font: `700 11px ${tokens.typography.fontFamily}`,
        color: syncStatus === 'synced' ? '#235328' : '#4A2B13',
        maxWidth: sInner.w - 26,
      }
    );

    // 2. 4×5 章节选关矩阵
    const maxCleared = saveMgr.data.maxClearedLevel;
    const secHeaderY = subRowY + subRowH + (compact ? 13 : 16);

    ctx.save();
    ctx.strokeStyle = 'rgba(138, 88, 44, 0.32)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(p.x + 18, secHeaderY);
    ctx.lineTo(p.x + p.w - 18, secHeaderY);
    ctx.stroke();
    ctx.restore();

    drawStatusPill(
      ctx,
      p.x + p.w * 0.5,
      secHeaderY,
      `第一章 · 流沙排桶 (${maxCleared}/${levelMgr.totalLevels} 关 · 无限免费畅玩)`,
      tokens,
      {
        bgHex: '#FDF0D5',
        borderHex: '#9C6230',
        textColor: '#4A2B13',
        fontSize: 10,
        padX: 14,
        height: 18,
      }
    );

    const gridTop = secHeaderY + (compact ? 13 : 15);
    const footReserve = 46;
    const gridH = p.y + p.h - footReserve - gridTop;
    const cols = 4;
    const rows = 5;
    const gapX = 7;
    const gapY = compact ? 6 : 7;
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
        : isFrontier || isCurrent
          ? 'amber'
          : 'parchment';

      const inner = drawRecessedTileCard(ctx, r, tokens, {
        variant,
        radius: 11,
        rimWidth: 3.0,
        pulse: isFrontier,
        pulsePhase: timeSec * 4.8,
      });

      const midX = inner.x + inner.w * 0.5;

      if (lvl.type === 'boss') {
        drawHandDrawnGlyph(ctx, 'crown', inner.x + 10, inner.y + 9, 13, tokens);
      } else if (lvl.type === 'bonus') {
        drawHandDrawnGlyph(ctx, 'sparkle', inner.x + 10, inner.y + 9, 12, tokens);
      }
      if (isCleared) {
        drawHandDrawnGlyph(ctx, 'check', inner.x + inner.w - 9, inner.y + 9, 13, tokens);
      } else if (isFrontier) {
        drawHandDrawnGlyph(ctx, 'sparkle', inner.x + inner.w - 9, inner.y + 9, 12, tokens);
      }

      if (!unlocked) {
        drawInkText(
          ctx,
          String(lvl.levelId).padStart(2, '0'),
          midX,
          inner.y + inner.h * 0.28,
          tokens,
          {
            font: `800 13px ${tokens.typography.numeralFontFamily}`,
            color: '#786B5D',
            embossColor: 'rgba(255,255,255,0.45)',
          }
        );
        drawHandDrawnGlyph(ctx, 'lock', midX, inner.y + inner.h * 0.68, 16, tokens);
        return;
      }

      drawInkText(
        ctx,
        String(lvl.levelId).padStart(2, '0'),
        midX,
        inner.y + Math.max(10, inner.h * 0.24),
        tokens,
        {
          font: `800 ${cellH < 56 ? 13 : 14.5}px ${tokens.typography.numeralFontFamily}`,
          color: isFrontier ? '#7C2D12' : '#3E2311',
        }
      );

      drawInkText(
        ctx,
        lvl.title.slice(0, 4),
        midX,
        inner.y + inner.h * 0.55,
        tokens,
        {
          font: `700 ${cellH < 56 ? 9.5 : 10.5}px ${tokens.typography.fontFamily}`,
          color: '#5C3A1E',
          maxWidth: inner.w - 6,
        }
      );

      const bestSec = saveMgr.data.bestTimeSecMap[lvl.levelId];
      const statusLabel = isFrontier
        ? '▸ 挑战中'
        : isCurrent
          ? '● 当前关'
          : bestSec
            ? `${bestSec.toFixed(0)}s`
            : '已通关';
      drawInkText(
        ctx,
        statusLabel,
        midX,
        inner.y + inner.h - (cellH < 56 ? 7 : 8.5),
        tokens,
        {
          font: `800 8.5px ${tokens.typography.fontFamily}`,
          color: isFrontier ? '#B45309' : isCurrent ? '#92400E' : '#2F6F3E',
        }
      );
    });

    // 3. 底部合规与版本信息栏
    const footY = p.y + p.h - 29;
    this.cadpaLinkRect = drawStatusPill(ctx, p.x + 68, footY, '8+ 适龄提示', tokens, {
      bgHex: '#EAF7EC',
      borderHex: '#4E8647',
      textColor: '#235328',
      fontSize: 9.5,
      padX: 10,
      height: 18,
    });
    this.privacyLinkRect = drawStatusPill(ctx, p.x + 166, footY, '隐私保护指引', tokens, {
      bgHex: '#EBF5FC',
      borderHex: '#3B76A0',
      textColor: '#1E4668',
      fontSize: 9.5,
      padX: 10,
      height: 18,
    });
    drawInkText(ctx, 'v2.0.0', p.x + p.w - 28, footY, tokens, {
      font: `700 10px ${tokens.typography.numeralFontFamily}`,
      color: '#7A5B3E',
      align: 'right',
    });

    if (this.showCadpa) {
      this.subPopupCloseRect = splash.renderCadpaPopup(ctx, W, H, assets, tokens);
    } else if (this.showPrivacy) {
      const pw2 = Math.min(324, W - 28);
      const ph2 = 212;
      const pop: Rect = { x: (W - pw2) * 0.5, y: (H - ph2) * 0.5, w: pw2, h: ph2 };
      drawParchmentModalFrame(ctx, W, H, pop, '隐私保护指引', tokens, assets);
      const lines = [
        '• 您的关卡进度与最佳用时默认安全保存于本地与云端。',
        '• 本游戏为纯益智解谜小游戏，不索取任何敏感个人信息。',
        '• 不收集通讯录、位置、相机等任何无关设备权限。',
      ];
      lines.forEach((ln, i) => {
        drawInkText(ctx, ln, pop.x + 20, pop.y + 56 + i * 26, tokens, {
          font: `600 12px ${tokens.typography.fontFamily}`,
          color: '#3E2311',
          align: 'left',
          maxWidth: pw2 - 40,
        });
      });
      this.subPopupCloseRect = { x: pop.x + (pw2 - 126) * 0.5, y: pop.y + ph2 - 52, w: 126, h: 40 };
      drawWoodButton(ctx, this.subPopupCloseRect, '我知道了', tokens, assets, {
        fillHex: '#15803D',
        fontSize: 13.5,
      });
    }
  }
}
