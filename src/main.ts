import uiTokensJson from '../data/ui_tokens.json';
import { GH, GW } from './engine/SandGrid';
import { ParticleSystem } from './engine/ParticleSystem';
import { SandEngine, type BoardRuntime } from './engine/SandEngine';
import { SandRenderer } from './engine/SandRenderer';
import { AssetLoader } from './platform/AssetLoader';
import { AudioManager } from './platform/AudioManager';
import { ensureRoundRect, wrapCanvasWithPolyfill } from './platform/CanvasPolyfill';
import { HapticManager } from './platform/HapticManager';
import { LayoutManager, type ComputedLayout } from './platform/LayoutManager';
import type { IPlatformBridge } from './platform/PlatformBridge';
import { WebMockPlatform } from './platform/WebMockPlatform';
import { WxPlatform } from './platform/WxPlatform';
import { WxCloudSyncAdapter } from './platform/sync/WxCloudSyncAdapter';
import { AuthService } from './systems/AuthService';
import { GameStateMachine } from './systems/GameStateMachine';
import { LevelManager } from './systems/LevelManager';
import { RewardManager } from './systems/RewardManager';
import { SaveManager } from './systems/SaveManager';
import type { SandColorId } from './types/level';
import type { UiTokensFile } from './types/ui';
import { FtueOverlay } from './ui/FtueOverlay';
import { GameHUD } from './ui/GameHUD';
import { GuideModal } from './ui/GuideModal';
import { LevelDrawer } from './ui/LevelDrawer';
import { SplashScreen } from './ui/SplashScreen';
import { ToastOverlay } from './ui/ToastOverlay';
import { VictoryModal } from './ui/VictoryModal';
import { hitRect } from './ui/UIHelpers';

const tokens = uiTokensJson as unknown as UiTokensFile;

class PureSandPuzzleApp {
  public readonly canvas: HTMLCanvasElement;
  public readonly ctx: CanvasRenderingContext2D;
  public readonly platform: IPlatformBridge;
  public readonly layoutMgr = new LayoutManager();
  public layout!: ComputedLayout;

  public readonly audio: AudioManager;
  public readonly haptic: HapticManager;
  public readonly assets: AssetLoader;
  public readonly saveMgr: SaveManager;
  public readonly auth: AuthService;
  public readonly rewardMgr: RewardManager;
  public readonly levelMgr = new LevelManager();
  public readonly fsm = new GameStateMachine();

  public readonly particles = new ParticleSystem();
  public readonly engine: SandEngine;
  public readonly sandRenderer: SandRenderer;

  public readonly splash = new SplashScreen();
  public readonly guide = new GuideModal();
  public readonly hud: GameHUD;
  public readonly ftue = new FtueOverlay();
  public readonly drawer = new LevelDrawer();
  public readonly victory = new VictoryModal();
  public readonly toast = new ToastOverlay();

  private rafId = 0;
  private lastTs = 0;
  private accumMs = 0;
  private emaDt = 16.67;
  private elapsedSec = 0;
  private levelElapsedSec = 0;
  private pointerDownPos: { x: number; y: number; id: number } | null = null;
  private winSettleDelayMs = -1;

  constructor() {
    const wxGlobal =
      typeof wx !== 'undefined' && typeof wx?.createCanvas === 'function' ? wx : undefined;

    if (wxGlobal) {
      const injected = (globalThis as unknown as { __WX_MAIN_CANVAS__?: HTMLCanvasElement })
        .__WX_MAIN_CANVAS__;
      this.canvas = wrapCanvasWithPolyfill(injected || wxGlobal.createCanvas!());
      this.platform = new WxPlatform(wxGlobal);
    } else {
      const domCanvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
      this.canvas = wrapCanvasWithPolyfill(domCanvas || document.createElement('canvas'));
      this.platform = new WebMockPlatform(this.canvas);
    }

    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D 上下文初始化失败');
    ensureRoundRect(context);
    this.ctx = context;

    const remoteSync = new WxCloudSyncAdapter();
    this.saveMgr = new SaveManager(this.platform, remoteSync);
    this.auth = new AuthService(this.platform, remoteSync, this.saveMgr);
    this.rewardMgr = new RewardManager(this.platform, this.saveMgr);

    this.audio = new AudioManager(this.platform);
    this.haptic = new HapticManager(this.platform);
    this.audio.setEnabled(this.saveMgr.data.settings.soundOn);
    this.haptic.setEnabled(this.saveMgr.data.settings.vibrateOn);
    this.fsm.onChange((_prev, next) => this.audio.setBgmScene(next));

    this.assets = new AssetLoader(this.platform);
    const makeOffscreen = () => this.platform.createOffscreenCanvas();
    this.sandRenderer = new SandRenderer(tokens, makeOffscreen);
    this.hud = new GameHUD(makeOffscreen);

    this.engine = new SandEngine({
      onBoardPull: bd => {
        this.audio.playEvent('BOARD_PULL');
        this.haptic.triggerForEvent('BOARD_PULL');
        this.spawnBoardDebris(bd);
      },
      onBoardLockedTap: () => {
        this.audio.playEvent('BOARD_TAP_LOCKED');
        this.haptic.triggerForEvent('BOARD_TAP_LOCKED');
        this.toast.show('✦ 装满同色玻璃瓶后，颜色锁会自动解开');
      },
      onLockAutoBreak: bd => {
        this.audio.playEvent('LOCK_AUTO_BREAK');
        this.haptic.triggerForEvent('LOCK_AUTO_BREAK');
        const ch = this.layout.chamberRect;
        const cx = ch.x + ((bd.x0 + bd.x1) * 0.5) * (ch.w / GW);
        const cy = ch.y + ((bd.y0 + bd.y1) * 0.5) * (ch.h / GH);
        this.particles.spawnStarBurst(cx, cy, '#FCE181', 6);
        this.spawnBoardDebris(bd);
      },
      onDyePass: (gx, gy, toColor) => {
        this.audio.playEvent('DYE_RING_PASS');
        const ch = this.layout.chamberRect;
        const px = ch.x + gx * (ch.w / GW);
        const py = ch.y + gy * (ch.h / GH);
        this.particles.spawnStarBurst(px, py, this.sandRenderer.getSandColorHex(toColor, tokens), 3);
      },
      onIceShatter: (gx, gy) => {
        this.audio.playEvent('ICE_BLOCK_SHATTER');
        this.haptic.triggerForEvent('ICE_BLOCK_SHATTER');
        const ch = this.layout.chamberRect;
        this.particles.spawnIceShatter(ch.x + gx * (ch.w / GW), ch.y + gy * (ch.h / GH));
      },
      onBucketDispatch: (bIdx, colIdx, slotIdx, color) => {
        this.hud.notifyColumnDispatched(bIdx, colIdx, slotIdx, color, this.layout, this.engine);
        this.audio.playEvent('BUCKET_DISPATCH');
        this.haptic.triggerForEvent('BUCKET_DISPATCH');
        const mouth = this.hud.getActiveBucketMouthPos(this.layout, slotIdx);
        const hex = this.sandRenderer.getSandColorHex(color, tokens);
        this.particles.spawnStarBurst(mouth.x, mouth.y + 8, hex, 4);
      },
      onBucketBlockedTap: (colIdx) => {
        this.audio.playEvent('BUCKET_TAP_BLOCKED');
        this.haptic.triggerForEvent('BUCKET_TAP_BLOCKED');
        const topBk = this.engine.bucketSys.columns[colIdx]?.[0];
        if (topBk) {
          this.hud.triggerBlockedBottle(topBk.idx);
        }
      },
      onMysteryReveal: (_bIdx, colIdx) => {
        this.hud.markFlipStartedUnrevealed(colIdx);
        this.audio.playEvent('BUCKET_MYSTERY_REVEAL');
      },
      onBucketIceCrack: thawed => {
        if (thawed.length > 0) {
          this.audio.playEvent('BUCKET_ICE_CRACK');
          this.haptic.triggerForEvent('BUCKET_ICE_CRACK');
        }
      },
      onBucketStepFill: step => {
        this.audio.playPentatonicStep(step);
      },
      onBucketFull: (bIdx, color, sweptCells) => {
        this.audio.playEvent('BUCKET_FULL_SWAP');
        this.haptic.triggerForEvent('BUCKET_FULL_SWAP');
        const bk = this.engine.bucketSys.buckets[bIdx];
        const slotIdx = Math.max(0, bk?.slotIdx ?? 0);
        const mouth = this.hud.getActiveBucketMouthPos(this.layout, slotIdx);
        const hex = this.sandRenderer.getSandColorHex(color, tokens);
        this.particles.spawnStarBurst(mouth.x, mouth.y, hex, 7);

        const ch = this.layout.chamberRect;
        sweptCells.slice(0, 12).forEach(sc => {
          const sx = ch.x + (sc.cellIdx % GW) * (ch.w / GW);
          const sy = ch.y + ((sc.cellIdx / GW) | 0) * (ch.h / GH);
          this.particles.spawnSuctionStream(sx, sy, mouth.x, mouth.y, hex, false, this.engine.frame);
        });
      },
      onDrainParticle: (gx, gy, slotIdx, color, isGold) => {
        const ch = this.layout.chamberRect;
        const sx = ch.x + gx * (ch.w / GW);
        const sy = ch.y + Math.min(163, gy) * (ch.h / GH);
        const mouth = this.hud.getActiveBucketMouthPos(this.layout, slotIdx);
        const hex = this.sandRenderer.getSandColorHex(color, tokens);
        this.particles.spawnSuctionStream(sx, sy, mouth.x, mouth.y, hex, false, this.engine.frame);
        if (isGold) {
          this.audio.playGoldShimmer();
        }
      },
      onClogWarningChange: active => {
        if (active) {
          this.audio.playEvent('CLOG_WARNING_SHOW');
          this.haptic.triggerForEvent('CLOG_WARNING_SHOW');
        }
      },
      onDeadlockChange: active => {
        if (active) {
          this.audio.playEvent('CLOG_WARNING_SHOW');
          this.haptic.triggerForEvent('CLOG_WARNING_SHOW');
        }
      },
      onWin: () => {
        this.settleCurrentLevelImmediately();
        this.winSettleDelayMs = 340;
      },
    });

    this.resizeViewport();
    this.bindInputEvents();
    this.bindLifecycle();
  }

  public async boot(): Promise<void> {
    this.startLoop();
    void this.auth.silentLoginAndSync();

    const [, loadedFont] = await Promise.all([
      this.assets.preloadCoreAssets(ratio => {
        this.splash.progress = ratio;
      }),
      this.platform.loadCustomFont
        ? this.platform.loadCustomFont('assets/fonts/ui_storybook.ttf', 'StarryStorybook')
        : Promise.resolve(null),
    ]);

    if (loadedFont && !tokens.typography.fontFamily.includes(loadedFont)) {
      tokens.typography.fontFamily = `"${loadedFont}", ${tokens.typography.fontFamily}`;
      tokens.typography.numeralFontFamily = `"${loadedFont}", ${tokens.typography.numeralFontFamily}`;
    }

    this.enterLevel(this.saveMgr.data.currentLevel, true);
    void this.audio.preloadBgm();
  }

  public enterLevel(levelId: number, switchToPlaying = true): void {
    const lvl = this.levelMgr.getLevel(levelId);
    this.saveMgr.data.currentLevel = lvl.levelId;
    this.saveMgr.saveNow(false);

    this.victory.close();
    this.particles.clear();
    this.engine.loadLevel(lvl, this.levelMgr.vessels);
    this.hud.resetForLevel(this.layout, this.engine);
    this.hud.setMechanicBanner(null);
    this.hud.showRestartConfirm = false;
    this.ftue.syncLevelSpotlights(this.engine, this.layout, this.saveMgr);
    this.levelElapsedSec = 0;
    this.winSettleDelayMs = -1;
    if (switchToPlaying) {
      this.drawer.isOpen = false;
      this.guide.isOpen = false;
      this.fsm.transitionTo('PLAYING');
    }
  }

  private settleCurrentLevelImmediately(): void {
    const lvl = this.engine.level;
    const clearTimeSec = Math.max(0.5, Number.isFinite(this.levelElapsedSec) ? this.levelElapsedSec : 1);
    const { isNewBest } = this.saveMgr.recordLevelClear(lvl.levelId, clearTimeSec);

    if (lvl.levelId < this.levelMgr.totalLevels) {
      this.saveMgr.data.currentLevel = Math.max(this.saveMgr.data.currentLevel, lvl.levelId + 1);
    }
    this.saveMgr.saveNow(true);
    this.ftue.clearSpotlights();

    this.victory.open({
      levelId: lvl.levelId,
      totalLevels: this.levelMgr.totalLevels,
      clearTimeSec,
      movesCount: this.engine.boardsPulledCount + this.engine.bucketsDispatchedCount,
      winStreak: this.saveMgr.data.winStreak,
      maxClearedLevel: this.saveMgr.data.maxClearedLevel,
      isNewBest,
    });
  }

  private resizeViewport(): void {
    const metrics = this.platform.getViewportMetrics();
    this.layout = this.layoutMgr.compute(metrics);
    this.canvas.width = Math.round(metrics.width * metrics.dpr);
    this.canvas.height = Math.round(metrics.height * metrics.dpr);
    ensureRoundRect(this.ctx);
    if (!this.platform.isWeChat && this.canvas.style) {
      this.canvas.style.width = `${metrics.width}px`;
      this.canvas.style.height = `${metrics.height}px`;
    }
    if (this.engine?.level && this.ftue.hasActiveSpotlight) {
      this.ftue.syncLevelSpotlights(this.engine, this.layout, this.saveMgr);
    }
  }

  private bindLifecycle(): void {
    this.platform.onLifecycle({
      onResize: () => this.resizeViewport(),
      onHide: () => {
        this.audio.suspend();
        this.saveMgr.saveNow(true);
        this.fsm.pauseFromBackground();
      },
      onShow: () => {
        this.lastTs = 0;
        this.audio.unlockAndResume();
        this.fsm.resumeToForeground();
      },
    });
  }

  private bindInputEvents(): void {
    this.platform.bindInput({
      onDown: (x, y, id) => {
        if (this.pointerDownPos && this.pointerDownPos.id !== id) return;
        this.audio.unlockAndResume();
        this.pointerDownPos = { x, y, id };

        if (
          this.fsm.state === 'PLAYING' &&
          !this.drawer.isOpen &&
          !this.guide.isOpen &&
          !this.ftue.hasActiveSpotlight
        ) {
          this.layout.propButtons.forEach((r, idx) => {
            if (hitRect(x, y, r)) this.hud.pressedBtnIdx = idx;
          });
        }
      },
      onMove: (x, y, id) => {
        if (!this.pointerDownPos || this.pointerDownPos.id !== id) return;
        if (
          Math.hypot(x - this.pointerDownPos.x, y - this.pointerDownPos.y) >
          tokens.viewport.pointerCancelMovePx
        ) {
          this.hud.pressedBtnIdx = null;
        }
      },
      onUp: (x, y, id) => {
        if (!this.pointerDownPos || this.pointerDownPos.id !== id) return;
        const dist = Math.hypot(x - this.pointerDownPos.x, y - this.pointerDownPos.y);
        this.pointerDownPos = null;
        this.hud.pressedBtnIdx = null;

        if (dist > tokens.viewport.pointerCancelMovePx) return;
        this.handleTap(x, y);
      },
      onCancel: () => {
        this.pointerDownPos = null;
        this.hud.pressedBtnIdx = null;
      },
      onWheel: () => {},
    });
  }

  private handleTap(px: number, py: number): void {
    const state = this.fsm.state;

    // 1. 玩法与机关图鉴弹窗优先拦截
    if (this.guide.isOpen) {
      const gAct = this.guide.handleTap(px, py);
      if (gAct) {
        this.audio.playEvent('UI_BUTTON_TAP');
        if (typeof gAct === 'object' && gAct.type === 'CARD_TIP') {
          this.toast.show(gAct.tip);
        }
      }
      return;
    }

    // 2. 选关与设置面板拦截
    if (this.drawer.isOpen && state === 'PLAYING') {
      const dAct = this.drawer.handleTap(px, py);
      if (!dAct) return;
      this.audio.playEvent('UI_BUTTON_TAP');

      if (dAct.type === 'OPEN_GUIDE') {
        this.guide.isOpen = true;
      } else if (dAct.type === 'TOGGLE_SOUND') {
        const next = !this.saveMgr.data.settings.soundOn;
        this.saveMgr.data.settings.soundOn = next;
        this.audio.setEnabled(next);
        this.saveMgr.saveNow(false);
      } else if (dAct.type === 'TOGGLE_VIBRATE') {
        const next = !this.saveMgr.data.settings.vibrateOn;
        this.saveMgr.data.settings.vibrateOn = next;
        this.haptic.setEnabled(next);
        this.saveMgr.saveNow(false);
      } else if (dAct.type === 'SYNC_CLOUD') {
        void this.saveMgr.flushCloudSync().then(ok => {
          this.toast.show(ok ? '✦ 云端存档同步完成' : '✦ 本地存档已安全保存');
        });
      } else if (dAct.type === 'SELECT_LEVEL') {
        this.enterLevel(dAct.levelId, true);
      } else if (dAct.type === 'LOCKED_LEVEL_TOAST') {
        const ord = this.levelMgr.formatOrdinal(dAct.needLevel);
        this.toast.show(`✦ 通关 ${ord} 后解锁`);
      }
      return;
    }

    if (state === 'SPLASH') {
      this.splash.handleTap(px, py);
      return;
    }

    // 3. 通关结算卡交互
    if (state === 'VICTORY') {
      const act = this.victory.handleTap(px, py, this.layout);
      if (!act) return;
      this.audio.playEvent('UI_BUTTON_TAP');
      const curId = this.victory.summary?.levelId ?? this.engine.level.levelId;
      if (act.type === 'NEXT_LEVEL') {
        const nextId = curId >= this.levelMgr.totalLevels ? 1 : curId + 1;
        this.enterLevel(nextId, true);
      } else if (act.type === 'REPLAY_LEVEL') {
        this.enterLevel(curId, true);
      }
      return;
    }

    if (state !== 'PLAYING') return;

    // 4. 新道具/新机关聚光灯手势引导优先拦截（轻点即收起）
    if (this.ftue.handleSpotlightTap(this.saveMgr)) {
      this.audio.playEvent('UI_BUTTON_TAP');
      return;
    }

    // 5. 局内 HUD 交互
    const hudAct = this.hud.handleTap(
      px,
      py,
      this.layout,
      this.engine,
      this.saveMgr.data.maxClearedLevel
    );
    if (hudAct === 'CONSUMED') {
      this.audio.playEvent('UI_BUTTON_TAP');
      return;
    }
    if (hudAct) {
      if (hudAct.type === 'BOTTLE_UNAVAILABLE') {
        this.audio.playEvent('BUCKET_TAP_BLOCKED');
        this.haptic.triggerForEvent('BUCKET_TAP_BLOCKED');
        return;
      }
      if (hudAct.type === 'DISPATCH_COL') {
        if (!this.ftue.isColumnAllowedInFtue(this.engine, this.saveMgr.data.maxClearedLevel, hudAct.colIdx)) {
          this.hud.triggerBlockedBottle(hudAct.bucketIdx);
          this.audio.playEvent('BUCKET_TAP_BLOCKED');
          this.haptic.triggerForEvent('BUCKET_TAP_BLOCKED');
          return;
        }
        this.engine.dispatchBucket(hudAct.colIdx);
        return;
      }

      this.audio.playEvent('UI_BUTTON_TAP');
      switch (hudAct.type) {
        case 'OPEN_DRAWER':
          this.drawer.isOpen = true;
          break;
        case 'OPEN_GUIDE':
          this.guide.isOpen = true;
          break;
        case 'PROP_LOCKED':
          this.toast.show(`✦ 第 ${this.levelMgr.formatOrdinal(hudAct.unlockLevel)} 关解锁该道具`);
          break;
        case 'PROP_UNDO':
          if (!this.engine.snapshots.canUndo() || this.engine.won) {
            this.toast.show('✦ 当前没有可撤回的步骤');
          } else {
            void this.rewardMgr.requestReward('UNDO').then(res => {
              if (!res.granted) return;
              if (this.engine.undo()) {
                this.audio.playEvent('PROP_UNDO_SNAPSHOT');
                this.haptic.triggerForEvent('PROP_UNDO_SNAPSHOT');
                this.toast.show('✦ 已撤回上一步');
              }
            });
          }
          break;
        case 'PROP_VACUUM':
          if (!this.engine.canUseMagnet()) {
            this.toast.show(
              this.engine.vacuumUsedCount >= 3
                ? '✦ 本关磁吸次数已用完 (3/3)'
                : '✦ 请先将至少 1 只玻璃瓶送入接沙台'
            );
          } else {
            void this.rewardMgr.requestReward('VACUUM').then(res => {
              if (!res.granted) return;
              const sucked = this.engine.useMagnetFill();
              if (sucked > 0) {
                this.audio.playEvent('PROP_VACUUM_CLEAN');
                this.haptic.triggerForEvent('PROP_VACUUM_CLEAN');
                this.toast.show(`✦ 已磁吸 ${sucked} 粒同色沙装满 1 瓶`);
              }
            });
          }
          break;
        case 'PROP_EXTRA_SLOT':
          if (!this.engine.bucketSys.canEnableExtraSlot()) {
            this.toast.show(
              this.engine.bucketSys.maxActiveSlots >= 5 ? '✦ 第 5 玻璃瓶位已开启' : '✦ 当前剩余瓶数无需加位'
            );
          } else {
            void this.rewardMgr.requestReward('EXTRA_SLOT').then(res => {
              if (!res.granted) return;
              if (this.engine.bucketSys.enableExtraSlot()) {
                this.engine.bucketSys.clogFrames = 0;
                this.engine.bucketSys.hardDeadlockActive = false;
                this.engine.bucketSys.clogWarningActive = false;
                this.audio.playEvent('PROP_EXTRA_SLOT');
                this.haptic.triggerForEvent('PROP_EXTRA_SLOT');
                this.toast.show('✦ 已开启第 5 临时玻璃瓶位');
              }
            });
          }
          break;
        case 'PROP_SHUFFLE':
          if (!this.engine.canUseShuffle()) {
            this.toast.show(
              this.engine.shuffleUsedCount >= 3
                ? '✦ 本关洗牌次数已用完 (3/3)'
                : '✦ 候选玻璃瓶不足 2 只，无需洗牌'
            );
          } else {
            void this.rewardMgr.requestReward('SHUFFLE').then(res => {
              if (!res.granted) return;
              if (this.engine.useShuffleColumns()) {
                this.audio.playEvent('PROP_SHUFFLE');
                this.haptic.triggerForEvent('PROP_SHUFFLE');
                this.toast.show('✦ 候选玻璃瓶已重新洗牌');
              }
            });
          }
          break;
        case 'PROP_RESTART_CONFIRMED':
          this.saveMgr.data.winStreak = 0;
          this.enterLevel(this.engine.level.levelId, true);
          this.toast.show('✦ 本关已重新开始');
          break;
      }
      return;
    }

    // 6. 局内主沙盘点击抽拨片
    const ch = this.layout.chamberRect;
    const expandedChamber = {
      x: ch.x - 36,
      y: ch.y - 6,
      w: ch.w + 72,
      h: ch.h + 14,
    };
    if (hitRect(px, py, expandedChamber) && !this.engine.won) {
      const gx = ((px - ch.x) / ch.w) * GW;
      const gy = ((py - ch.y) / ch.h) * GH;
      const hitPadGrid = tokens.viewport.boardHitPaddingPx / Math.max(1.5, ch.w / GW);
      const board = this.engine.hitTestBoard(gx, gy, hitPadGrid);
      if (board) {
        if (!this.ftue.isBoardAllowedInFtue(this.engine, this.saveMgr.data.maxClearedLevel, board.id)) {
          this.toast.show('✦ 请先点选下方玻璃瓶吸空底沙');
          return;
        }
        this.engine.pullBoard(board.id, false);
      }
    }
  }

  private spawnBoardDebris(bd: BoardRuntime): void {
    const ch = this.layout.chamberRect;
    const sxk = ch.w / GW;
    const syk = ch.h / GH;
    let sandHex: string | undefined;
    const midX = Math.round((bd.x0 + bd.x1) * 0.5);
    const topY = Math.min(bd.y0, bd.y1);
    for (let dy = 3; dy <= 6 && !sandHex; dy++) {
      for (let dx = -6; dx <= 6 && !sandHex; dx += 3) {
        const gx = midX + dx;
        const gy = topY - dy;
        if (gx < 0 || gx >= GW || gy < 0) continue;
        const v = this.engine.grid[gy * GW + gx];
        if (v >= 1 && v <= 5) sandHex = this.sandRenderer.getSandColorHex(v as SandColorId, tokens);
      }
    }
    this.particles.spawnBoardDebris(
      ch.x + bd.x0 * sxk,
      ch.y + bd.y0 * syk,
      ch.x + bd.x1 * sxk,
      ch.y + bd.y1 * syk,
      sandHex
    );
  }

  private consumeSandImpacts(): void {
    const n = this.engine.impactCount;
    if (n <= 0) return;
    const ch = this.layout.chamberRect;
    const sxk = ch.w / GW;
    const syk = ch.h / GH;
    const buf = this.engine.impactBuf;
    const take = Math.min(6, n);
    const stride = n / take;
    for (let k = 0; k < take; k++) {
      const o = Math.floor(k * stride) * 3;
      const cid = buf[o + 2];
      if (cid < 1 || cid > 5) continue;
      this.particles.spawnSandImpact(
        ch.x + (buf[o] + 0.5) * sxk,
        ch.y + (buf[o + 1] + 1) * syk,
        this.sandRenderer.getSandColorHex(cid as SandColorId, tokens),
        Math.min(1.2, 0.6 + n / 24)
      );
    }
    this.engine.impactCount = 0;
  }

  private lastRenderedRev = -1;

  private startLoop(): void {
    const getClockMs = (): number =>
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    const sched =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: FrameRequestCallback) => setTimeout(() => fn(getClockMs()), 16) as unknown as number;

    const stepMs = 1000 / 60;

    const tick = (_ts?: number): void => {
      this.rafId = sched(tick);
      // 采用亚毫秒单调时钟，根除 Date.now() 1ms 整数取整在 60Hz 下引发的 0步/2步 拍频卡顿
      const now = getClockMs();
      const dt = this.lastTs > 0 ? now - this.lastTs : stepMs;
      this.lastTs = now;
      const rawDt = Number.isFinite(dt) && dt > 0 ? Math.min(50, Math.max(4, dt)) : stepMs;
      this.emaDt = this.emaDt * 0.9 + rawDt * 0.1;

      if (this.fsm.state === 'PAUSED') return;

      this.elapsedSec += rawDt / 1000;
      this.particles.reportFrameTime(rawDt);
      this.toast.update(rawDt);
      this.hud.update(rawDt);
      this.particles.update(rawDt / 1000);

      let skipIntermediateHighHzRender = false;

      if (this.fsm.state === 'PLAYING') {
        this.engine.updateVisualTimers(rawDt);
        const modalBlocking =
          !this.engine.won && (this.drawer.isOpen || this.guide.isOpen || this.ftue.hasActiveSpotlight);
        if (!modalBlocking) {
          if (!this.engine.won) {
            this.levelElapsedSec += rawDt / 1000;
          }

          // 60Hz VSync 锁相环：当帧间隔处于 60Hz 正常微抖区间 [13.8, 19.8]ms 时锁定每帧精确 1 步，彻底消除跳步抖动
          const is60HzLocked =
            rawDt >= 13.8 && rawDt <= 19.8 && this.emaDt >= 14.5 && this.emaDt <= 19.0;
          if (is60HzLocked) {
            this.accumMs = stepMs;
          } else {
            this.accumMs += rawDt;
          }

          // 防死亡螺旋：掉帧 (>26ms) 或低配降级态单帧最多执行 1 步物理，避免慢帧翻倍加重 CPU 负载
          const maxSteps = this.particles.lowPerfMode || rawDt > 26 ? 1 : 2;
          let steps = 0;
          while (this.accumMs >= stepMs && steps < maxSteps) {
            this.engine.step(now);
            this.accumMs -= stepMs;
            steps++;
          }
          if (is60HzLocked) {
            this.accumMs = 0;
          } else if (steps >= maxSteps && this.accumMs > stepMs * 0.5) {
            this.accumMs = stepMs * 0.5;
          }

          this.audio.updateSandFlow(this.engine.won ? 0 : this.engine.lastFlowParticles);
          this.consumeSandImpacts();

          if (
            steps === 0 &&
            rawDt < 11.5 &&
            !this.engine.won &&
            !this.hud.showRestartConfirm &&
            this.engine.visualRevision === this.lastRenderedRev &&
            !this.hud.hasActiveAnimations(this.engine)
          ) {
            skipIntermediateHighHzRender = true;
          }
        } else {
          this.audio.updateSandFlow(0);
        }

        // 过关结算保底状态跃迁：一旦 engine.won 为真，无视任何遮罩阻断，确保 100% 切入 VICTORY 结算界面
        if (this.engine.won) {
          this.drawer.isOpen = false;
          this.guide.isOpen = false;
          this.hud.showRestartConfirm = false;
          if (!this.victory.summary || this.victory.summary.levelId !== this.engine.level.levelId) {
            this.settleCurrentLevelImmediately();
          }
          if (!Number.isFinite(this.winSettleDelayMs) || this.winSettleDelayMs < 0) {
            this.winSettleDelayMs = 0;
          }
          this.winSettleDelayMs -= rawDt;
          if (this.winSettleDelayMs <= 0) {
            this.winSettleDelayMs = -1;
            try {
              this.audio.updateSandFlow(0);
              this.audio.playEvent('LEVEL_VICTORY');
              this.haptic.triggerForEvent('LEVEL_VICTORY');
              this.particles.spawnConfetti(this.layout.screenW * 0.5, this.layout.screenH * 0.36, 36);
            } catch {
              // 确保音效/触觉异常绝不阻断过关状态切换
            }
            this.fsm.transitionTo('VICTORY');
          }
        }
      } else {
        this.audio.updateSandFlow(0);
        if (this.fsm.state === 'VICTORY') {
          this.victory.update(rawDt);
        }
      }

      if (!skipIntermediateHighHzRender) {
        this.lastRenderedRev = this.engine.visualRevision;
        this.renderFrame();
      }
    };
    this.rafId = sched(tick);
    void this.rafId;
  }

  private renderFrame(): void {
    const ctx = this.ctx;
    const dpr = this.layout.dpr;
    ctx.save();
    try {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.layout.screenW, this.layout.screenH);

      const state = this.fsm.state;

      if (state === 'SPLASH') {
        this.splash.render(ctx, this.layout, this.assets, tokens, this.elapsedSec);
      } else {
        this.hud.renderBackground(ctx, this.layout, this.assets, tokens);
        this.sandRenderer.render(
          ctx,
          this.engine,
          this.layout.chamberRect,
          this.assets,
          tokens
        );
        this.hud.renderForeground(
          ctx,
          this.layout,
          this.engine,
          this.sandRenderer,
          this.assets,
          this.rewardMgr,
          tokens,
          this.elapsedSec,
          this.saveMgr.data.maxClearedLevel
        );
        this.particles.render(ctx);

        if (state === 'PLAYING' && !this.drawer.isOpen && !this.guide.isOpen) {
          this.ftue.render(
            ctx,
            this.engine,
            this.saveMgr.data.maxClearedLevel,
            this.layout,
            this.assets,
            tokens,
            this.elapsedSec
          );
        }

        if (state === 'VICTORY') {
          this.victory.render(ctx, this.layout, this.assets, tokens, this.elapsedSec);
          this.particles.render(ctx);
        }

        if (this.drawer.isOpen) {
          this.drawer.render(
            ctx,
            this.layout,
            this.levelMgr,
            this.saveMgr,
            this.assets,
            this.splash,
            tokens,
            this.elapsedSec
          );
        }

        if (this.guide.isOpen) {
          this.guide.render(ctx, this.layout, this.assets, tokens);
        }
      }

      this.toast.render(ctx, this.layout.screenW, this.layout.topHudY + this.layout.topHudH, tokens);
    } finally {
      ctx.restore();
    }
  }
}

const app = new PureSandPuzzleApp();
if (typeof wx === 'undefined') {
  (globalThis as unknown as { __SAND_APP__?: PureSandPuzzleApp }).__SAND_APP__ = app;
}
void app.boot();
