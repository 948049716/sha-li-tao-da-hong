import type { AssetLoader } from '../platform/AssetLoader';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { LevelManager } from '../systems/LevelManager';
import type { SaveManager } from '../systems/SaveManager';
import type { Rect, UiTokensFile } from '../types/ui';
import type { SplashScreen } from './SplashScreen';
import {
  drawOutlinedText,
  drawParchmentModalFrame,
  drawWoodButton,
  drawWoodCapsule,
  hitRect,
} from './UIHelpers';

export type DrawerAction =
  | { type: 'CLOSE' }
  | { type: 'TOGGLE_SOUND' }
  | { type: 'TOGGLE_VIBRATE' }
  | { type: 'SYNC_CLOUD' }
  | { type: 'SELECT_LEVEL'; levelId: number }
  | { type: 'LOCKED_LEVEL_TOAST'; needLevel: number };

/**
 * 设置与第 1~20 关选关抽屉（含音效/震动开关、云端同步、4×5 选关矩阵、8+ 适龄与隐私指引弹窗）
 */
export class LevelDrawer {
  public isOpen = false;
  public showCadpa = false;
  public showPrivacy = false;
  public pendingSwitchLevelId: number | null = null;

  private closeBtnRect: Rect = { x: 0, y: 0, w: 72, h: 32 };
  private soundBtnRect: Rect = { x: 0, y: 0, w: 108, h: 38 };
  private vibrateBtnRect: Rect = { x: 0, y: 0, w: 108, h: 38 };
  private syncBtnRect: Rect = { x: 0, y: 0, w: 86, h: 38 };
  private levelCellRects: { levelId: number; rect: Rect; unlocked: boolean }[] = [];
  private cadpaLinkRect: Rect = { x: 0, y: 0, w: 96, h: 26 };
  private privacyLinkRect: Rect = { x: 0, y: 0, w: 104, h: 26 };
  private subPopupCloseRect: Rect = { x: 0, y: 0, w: 120, h: 38 };
  private confirmCancelRect: Rect = { x: 0, y: 0, w: 120, h: 38 };
  private confirmSwitchRect: Rect = { x: 0, y: 0, w: 120, h: 38 };
  private panelRect: Rect = { x: 0, y: 0, w: 350, h: 580 };

  public handleTap(
    px: number,
    py: number,
    hasActiveProgressWithLoot: boolean
  ): DrawerAction | null {
    if (!this.isOpen) return null;

    if (this.showCadpa || this.showPrivacy) {
      if (hitRect(px, py, this.subPopupCloseRect)) {
        this.showCadpa = false;
        this.showPrivacy = false;
      }
      return null;
    }

    if (this.pendingSwitchLevelId !== null) {
      if (hitRect(px, py, this.confirmCancelRect)) {
        this.pendingSwitchLevelId = null;
        return null;
      }
      if (hitRect(px, py, this.confirmSwitchRect)) {
        const target = this.pendingSwitchLevelId;
        this.pendingSwitchLevelId = null;
        this.isOpen = false;
        return { type: 'SELECT_LEVEL', levelId: target };
      }
      return null;
    }

    if (!hitRect(px, py, this.panelRect) || hitRect(px, py, this.closeBtnRect)) {
      this.isOpen = false;
      return { type: 'CLOSE' };
    }
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
        if (hasActiveProgressWithLoot) {
          this.pendingSwitchLevelId = cell.levelId;
          return null;
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

    const pw = Math.min(362, W - 20);
    const ph = Math.min(610, H - 72);
    this.panelRect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5 + 8, w: pw, h: ph };
    const p = this.panelRect;

    drawParchmentModalFrame(ctx, W, H, p, '⚙️ 设置与选关地图', tokens, assets, 'ui_bg_level_drawer');

    this.closeBtnRect = { x: p.x + p.w - 66, y: p.y + 10, w: 54, h: 28 };
    drawWoodButton(ctx, this.closeBtnRect, '关闭✕', tokens, assets, {
      fontSize: 11,
      fillHex: '#9A6228',
    });

    // 1. 顶部音效 / 震动 / 云同步行
    const rowY = p.y + 46;
    const soundOn = saveMgr.data.settings.soundOn;
    const vibOn = saveMgr.data.settings.vibrateOn;

    this.soundBtnRect = { x: p.x + 14, y: rowY, w: 108, h: 38 };
    this.vibrateBtnRect = { x: p.x + 128, y: rowY, w: 104, h: 38 };
    this.syncBtnRect = { x: p.x + 238, y: rowY, w: p.w - 252, h: 38 };

    drawWoodButton(ctx, this.soundBtnRect, soundOn ? '音效: 开' : '音效: 关', tokens, assets, {
      icon: assets.get('ui_icon_sound_horn'),
      iconSize: 20,
      fontSize: 11.5,
      fillHex: soundOn ? '#15803D' : '#9CA3AF',
    });
    drawWoodButton(ctx, this.vibrateBtnRect, vibOn ? '📳震动:开' : '📴震动:关', tokens, assets, {
      fontSize: 11.5,
      fillHex: vibOn ? '#15803D' : '#9CA3AF',
    });
    const syncLabel =
      saveMgr.lastCloudSyncStatus === 'syncing'
        ? '同步中..'
        : saveMgr.lastCloudSyncStatus === 'synced'
          ? '☁️已同步'
          : '☁️云同步';
    drawWoodButton(ctx, this.syncBtnRect, syncLabel, tokens, assets, {
      fontSize: 11,
      fillHex: '#0284C7',
    });

    // 复刷规则透明说明条
    drawOutlinedText(
      ctx,
      '首通掉落高阶/大红盒 · 已通关复刷免体力淘常规/炫紫盒',
      p.x + p.w * 0.5,
      rowY + 52,
      `600 10.5px ${tokens.typography.fontFamily}`,
      tokens.theme.inkSecondary,
      '#FFFFFF',
      0
    );

    // 2. 中部 4 列 × 5 行选关矩阵
    const gridTop = rowY + 66;
    const gridH = p.h - 166;
    const cols = 4;
    const rows = 5;
    const gapX = 8;
    const gapY = 8;
    const cellW = Math.floor((p.w - 28 - gapX * (cols - 1)) / cols);
    const cellH = Math.min(74, Math.floor((gridH - gapY * (rows - 1)) / rows));

    this.levelCellRects = [];
    const maxCleared = saveMgr.data.maxClearedLevel;

    levelMgr.levels.forEach((lvl, idx) => {
      const col = idx % cols;
      const row = (idx / cols) | 0;
      const cx = p.x + 14 + col * (cellW + gapX);
      const cy = gridTop + row * (cellH + gapY);
      const r: Rect = { x: cx, y: cy, w: cellW, h: cellH };

      const isCleared = lvl.levelId <= maxCleared;
      const isFrontier = lvl.levelId === maxCleared + 1;
      const unlocked = lvl.levelId <= maxCleared + 1;
      const isCurrent = lvl.levelId === saveMgr.data.currentLevel;

      this.levelCellRects.push({ levelId: lvl.levelId, rect: r, unlocked });

      const bgHex = !unlocked
        ? '#E5E0D8'
        : isFrontier || isCurrent
          ? '#FEF3C7'
          : '#FFF8EC';
      const lipHex = !unlocked ? '#9CA3AF' : isFrontier ? '#D97706' : tokens.theme.woodDark;

      ctx.save();
      if (!unlocked) ctx.globalAlpha = 0.62;
      drawWoodCapsule(ctx, r, tokens, bgHex, lipHex, 10);

      if (isFrontier) {
        ctx.strokeStyle = tokens.theme.amberGlow;
        ctx.lineWidth = 2.4;
        ctx.globalAlpha = 0.6 + 0.35 * Math.sin(timeSec * 5);
        ctx.beginPath();
        ctx.roundRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3, 11);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const tagIcon =
        lvl.type === 'boss' ? '👑' : lvl.type === 'bonus' ? '🎁' : '';
      drawOutlinedText(
        ctx,
        `${String(lvl.levelId).padStart(2, '0')}${tagIcon}`,
        r.x + r.w * 0.5,
        r.y + 18,
        `800 14px ${tokens.typography.numeralFontFamily}`,
        unlocked ? tokens.theme.inkOutline : '#6B7280',
        '#FFFFFF',
        0
      );

      drawOutlinedText(
        ctx,
        unlocked ? lvl.title.slice(0, 5) : '🔒未解锁',
        r.x + r.w * 0.5,
        r.y + cellH * 0.56,
        `600 10px ${tokens.typography.fontFamily}`,
        tokens.theme.inkSecondary,
        '#FFFFFF',
        0
      );

      if (isCleared) {
        drawOutlinedText(
          ctx,
          '✓已清罐',
          r.x + r.w * 0.5,
          r.y + cellH - 11,
          `700 9.5px ${tokens.typography.fontFamily}`,
          tokens.theme.successText,
          '#FFFFFF',
          0
        );
      } else if (isFrontier) {
        drawOutlinedText(
          ctx,
          '挑战中',
          r.x + r.w * 0.5,
          r.y + cellH - 11,
          `700 9.5px ${tokens.typography.fontFamily}`,
          '#D97706',
          '#FFFFFF',
          0
        );
      }
      ctx.restore();
    });

    // 3. 底部合规入口：8+ 适龄提示 · 隐私保护指引 · 版本号
    const footY = p.y + p.h - 26;
    this.cadpaLinkRect = { x: p.x + 18, y: footY - 12, w: 88, h: 24 };
    this.privacyLinkRect = { x: p.x + 114, y: footY - 12, w: 96, h: 24 };

    drawOutlinedText(ctx, '[8+ 适龄提示]', p.x + 62, footY, `600 11px ${tokens.typography.fontFamily}`, '#15803D', '#FFFFFF', 0);
    drawOutlinedText(ctx, '[隐私保护指引]', p.x + 162, footY, `600 11px ${tokens.typography.fontFamily}`, '#0284C7', '#FFFFFF', 0);
    drawOutlinedText(ctx, 'v1.0.0', p.x + p.w - 34, footY, `600 11px ${tokens.typography.numeralFontFamily}`, tokens.theme.mutedText, '#FFFFFF', 0);

    if (this.showCadpa) {
      this.subPopupCloseRect = splash.renderCadpaPopup(ctx, W, H, assets, tokens);
    } else if (this.showPrivacy) {
      const pw2 = Math.min(316, W - 32);
      const ph2 = 216;
      const pop: Rect = { x: (W - pw2) * 0.5, y: (H - ph2) * 0.5, w: pw2, h: ph2 };
      drawParchmentModalFrame(ctx, W, H, pop, '隐私保护指引', tokens, assets);
      const lines = [
        '• 游戏进度默认安全存储于本地设备与微信云端。',
        '• 仅在您于藏馆主动点击「同步微信头像」时，',
        '  才会申请展示您的头像与昵称，拒绝不影响游玩。',
        '• 本游戏不收集通讯录、位置等任何无关敏感权限。',
      ];
      ctx.save();
      ctx.font = `600 12px ${tokens.typography.fontFamily}`;
      ctx.fillStyle = tokens.theme.inkOutline;
      ctx.textAlign = 'left';
      lines.forEach((ln, i) => ctx.fillText(ln, pop.x + 18, pop.y + 52 + i * 24));
      ctx.restore();
      this.subPopupCloseRect = { x: pop.x + (pw2 - 120) * 0.5, y: pop.y + ph2 - 50, w: 120, h: 38 };
      drawWoodButton(ctx, this.subPopupCloseRect, '我知道了', tokens, assets, { fillHex: '#10B981' });
    } else if (this.pendingSwitchLevelId !== null) {
      const pw2 = Math.min(316, W - 32);
      const ph2 = 186;
      const pop: Rect = { x: (W - pw2) * 0.5, y: (H - ph2) * 0.5, w: pw2, h: ph2 };
      drawParchmentModalFrame(ctx, W, H, pop, '切换关卡确认', tokens, assets);
      drawOutlinedText(ctx, '当前关卡战利品袋中已有暂存盲盒，', pop.x + pw2 * 0.5, pop.y + 62, `600 12.5px ${tokens.typography.fontFamily}`, tokens.theme.inkOutline, '#FFFFFF', 0);
      drawOutlinedText(ctx, '直接切换将放弃本局暂存盲盒，确定切换？', pop.x + pw2 * 0.5, pop.y + 86, `600 12.5px ${tokens.typography.fontFamily}`, tokens.theme.inkOutline, '#FFFFFF', 0);
      this.confirmCancelRect = { x: pop.x + 20, y: pop.y + ph2 - 52, w: 120, h: 38 };
      this.confirmSwitchRect = { x: pop.x + pw2 - 140, y: pop.y + ph2 - 52, w: 120, h: 38 };
      drawWoodButton(ctx, this.confirmCancelRect, '留在本关', tokens, assets, { fillHex: '#10B981' });
      drawWoodButton(ctx, this.confirmSwitchRect, '确定切换', tokens, assets, { fillHex: '#D97706' });
    }
  }
}
