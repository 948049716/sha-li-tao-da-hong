import uiTokensJson from '../data/ui_tokens.json';
import { GH, GW } from './engine/SandGrid';
import { ParticleSystem } from './engine/ParticleSystem';
import { SandEngine } from './engine/SandEngine';
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
import { GachaSystem } from './systems/GachaSystem';
import { GameStateMachine, type GameSceneState } from './systems/GameStateMachine';
import { LevelManager } from './systems/LevelManager';
import { RewardManager } from './systems/RewardManager';
import { SaveManager } from './systems/SaveManager';
import type { UiTokensFile } from './types/ui';
import { AppraisalModal } from './ui/AppraisalModal';
import { FtueOverlay } from './ui/FtueOverlay';
import { GalleryModal } from './ui/GalleryModal';
import { GameHUD } from './ui/GameHUD';
import { GuideModal } from './ui/GuideModal';
import { HomeScreen } from './ui/HomeScreen';
import { LevelDrawer } from './ui/LevelDrawer';
import { SplashScreen } from './ui/SplashScreen';
import { ToastOverlay } from './ui/ToastOverlay';
import { formatNetWorth, hitRect } from './ui/UIHelpers';

const tokens = uiTokensJson as unknown as UiTokensFile;

class ShaLiTaoDaHongApp {
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
  public readonly gacha = new GachaSystem();
  public readonly fsm = new GameStateMachine();

  public readonly particles = new ParticleSystem();
  public readonly engine: SandEngine;
  public readonly sandRenderer: SandRenderer;

  public readonly splash = new SplashScreen();
  public readonly home = new HomeScreen();
  public readonly guide = new GuideModal();
  public readonly hud = new GameHUD();
  public readonly ftue = new FtueOverlay();
  public readonly drawer = new LevelDrawer();
  public readonly appraisal: AppraisalModal;
  public readonly gallery: GalleryModal;
  public readonly toast = new ToastOverlay();

  private rafId = 0;
  private lastTs = 0;
  private accumMs = 0;
  private elapsedSec = 0;
  private pointerDownPos: { x: number; y: number; id: number } | null = null;
  private winSettleDelayMs = -1;
  private galleryReturnState: GameSceneState = 'HOME';

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
    this.sandRenderer = new SandRenderer(tokens, () => this.platform.createOffscreenCanvas());

    this.appraisal = new AppraisalModal(this.audio, this.haptic, this.particles, tokens);
    this.gallery = new GalleryModal(this.audio, this.haptic, this.particles, tokens);

    this.engine = new SandEngine({
      onBoardPull: () => {
        this.audio.playEvent('BOARD_PULL');
        this.haptic.triggerForEvent('BOARD_PULL');
      },
      onBoardLockedTap: bd => {
        this.audio.playEvent('BOARD_TAP_LOCKED');
        this.haptic.triggerForEvent('BOARD_TAP_LOCKED');
        this.toast.show('🔒 装满对应颜色的接沙桶，锁门就会自动弹开！');
        void bd;
      },
      onLockAutoBreak: bd => {
        this.audio.playEvent('LOCK_AUTO_BREAK');
        this.haptic.triggerForEvent('LOCK_AUTO_BREAK');
        const ch = this.layout.chamberRect;
        const cx = ch.x + ((bd.x0 + bd.x1) * 0.5) * (ch.w / GW);
        const cy = ch.y + ((bd.y0 + bd.y1) * 0.5) * (ch.h / GH);
        this.particles.spawnStarBurst(cx, cy, '#FBBF24', 6);
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
      onBucketStepFill: step => {
        this.audio.playPentatonicStep(step);
      },
      onBucketFull: (_bIdx, color, sweptCells) => {
        this.audio.playEvent('BUCKET_FULL_SWAP');
        this.haptic.triggerForEvent('BUCKET_FULL_SWAP');
        const mouth = this.hud.getActiveBucketMouthPos(
          this.layout,
          0,
          this.engine.bucketSys.maxActiveSlots >= 2
        );
        const hex = this.sandRenderer.getSandColorHex(color, tokens);
        this.particles.spawnStarBurst(mouth.x, mouth.y, hex, 7);

        // 清尾散沙化作彩色飞线汇入桶口
        const ch = this.layout.chamberRect;
        const rainbow = this.saveMgr.data.equippedSuctionFxId === 'fx_rainbow_drain';
        sweptCells.slice(0, 12).forEach(sc => {
          const sx = ch.x + (sc.cellIdx % GW) * (ch.w / GW);
          const sy = ch.y + ((sc.cellIdx / GW) | 0) * (ch.h / GH);
          this.particles.spawnSuctionStream(sx, sy, mouth.x, mouth.y, hex, rainbow, this.engine.frame);
        });
      },
      onDrainParticle: (_gx, _gy, slotIdx, color, isGold) => {
        const ch = this.layout.chamberRect;
        const sx = ch.x + ch.w * 0.5;
        const sy = ch.y + ch.h * (163 / GH);
        const mouth = this.hud.getActiveBucketMouthPos(
          this.layout,
          slotIdx,
          this.engine.bucketSys.maxActiveSlots >= 2
        );
        const rainbow = this.saveMgr.data.equippedSuctionFxId === 'fx_rainbow_drain';
        const hex = this.sandRenderer.getSandColorHex(color, tokens);
        this.particles.spawnSuctionStream(sx, sy, mouth.x, mouth.y, hex, rainbow, this.engine.frame);
        if (isGold || rainbow) {
          this.audio.playGoldShimmer();
        }
      },
      onCapsulePocket: () => {
        this.audio.playEvent('CAPSULE_INTO_BAG');
        this.haptic.triggerForEvent('CAPSULE_INTO_BAG');
        this.hud.triggerLootBagBounce();
      },
      onClogWarningChange: active => {
        if (active) {
          this.audio.playEvent('CLOG_WARNING_SHOW');
          this.haptic.triggerForEvent('CLOG_WARNING_SHOW');
        }
      },
      onWin: () => {
        // 留 420ms 让最后飞入战利品袋的盲盒完成抛物线入袋，但立即预落盘结果防强退刷盒（AC-13）
        this.settleCurrentLevelImmediately();
        this.winSettleDelayMs = 420;
      },
    });

    this.hud.displayedNetWorth = this.saveMgr.data.totalNetWorth;
    this.resizeViewport();
    this.bindInputEvents();
    this.bindLifecycle();
  }

  public async boot(): Promise<void> {
    this.startLoop();
    void this.auth.silentLoginAndSync();

    await this.assets.preloadCoreAssets(ratio => {
      this.splash.progress = ratio;
    });

    this.enterLevel(this.saveMgr.data.currentLevel, false);
    this.fsm.transitionTo('HOME');

    // 进入主菜单后后台静默预加载 30 款公仔与次级背景分包
    void this.assets.preloadSubpackageAssets();
    // 并行静默加载 subpackages/audio 星夜工坊 BGM（解锁音频后自动淡入）
    void this.audio.preloadBgm();
  }

  public enterLevel(levelId: number, switchToPlaying = true): void {
    const lvl = this.levelMgr.getLevel(levelId);
    this.saveMgr.data.currentLevel = lvl.levelId;
    this.saveMgr.saveNow(false);

    const resolvedCaps = this.gacha.resolveLevelCapsules(lvl, this.saveMgr.data.maxClearedLevel);
    this.particles.clear();
    this.engine.loadLevel(lvl, this.levelMgr.vessels, resolvedCaps);
    this.hud.setMechanicBanner(this.levelMgr.getMechanicBannerForLevel(lvl.levelId));
    this.hud.showRestartConfirm = false;
    this.winSettleDelayMs = -1;
    if (switchToPlaying) {
      this.drawer.isOpen = false;
      this.guide.isOpen = false;
      this.fsm.transitionTo('PLAYING');
    }
  }

  /**
   * 通关瞬间预计算所有盲盒结果并同步落盘（PRD §7.2 防 SL 强退刷大红铁律）
   */
  private settleCurrentLevelImmediately(): void {
    const lvlId = this.engine.level.levelId;
    const wasFirstClear = lvlId > this.saveMgr.data.maxClearedLevel;

    if (wasFirstClear) {
      this.saveMgr.data.maxClearedLevel = lvlId;
    } else if (this.saveMgr.data.maxClearedLevel >= this.levelMgr.totalLevels) {
      this.saveMgr.data.replayedClearCount++;
    }

    if (lvlId < this.levelMgr.totalLevels) {
      this.saveMgr.data.currentLevel = Math.max(this.saveMgr.data.currentLevel, lvlId + 1);
    }

    const outcomes = this.gacha.settleLootBag(this.engine.lootBag, lvlId, this.saveMgr.data);
    const airdropBoxId = this.gacha.rollAirdropBoxIfEligible(
      lvlId,
      wasFirstClear,
      this.saveMgr.data.replayedClearCount
    );

    this.saveMgr.saveNow(true);
    this.appraisal.open(lvlId, outcomes, airdropBoxId);
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

        if (this.fsm.state === 'PLAYING' && !this.drawer.isOpen && !this.guide.isOpen) {
          this.layout.propButtons.forEach((r, idx) => {
            if (hitRect(x, y, r)) this.hud.pressedBtnIdx = idx;
          });
        } else if (this.fsm.state === 'GALLERY') {
          this.gallery.onPointerDown(x, y);
        }
      },
      onMove: (x, y, id) => {
        if (!this.pointerDownPos || this.pointerDownPos.id !== id) return;
        if (this.fsm.state === 'GALLERY') {
          this.gallery.onPointerMove(y);
        }
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
        this.gallery.onPointerUp();

        // 手指滑动 > 20px 视为取消点击，防擦屏误抽板（PRD §6.2）
        if (dist > tokens.viewport.pointerCancelMovePx) return;
        this.handleTap(x, y);
      },
      onCancel: id => {
        if (!this.pointerDownPos || this.pointerDownPos.id !== id) {
          this.pointerDownPos = null;
        } else {
          this.pointerDownPos = null;
        }
        this.hud.pressedBtnIdx = null;
        this.gallery.onPointerUp();
      },
      onWheel: deltaY => {
        if (this.fsm.state === 'GALLERY') {
          this.gallery.onWheel(deltaY);
        }
      },
    });
  }

  private hasCraftableRedDot(): boolean {
    return this.saveMgr.data.shards >= 5 && this.saveMgr.getOwnedUniqueCount() < 30;
  }

  private openGalleryFrom(fromState: GameSceneState): void {
    this.galleryReturnState = fromState;
    this.gallery.onEnter(this.layout, this.auth, () => {});
    this.fsm.transitionTo('GALLERY');
  }

  private handleTap(px: number, py: number): void {
    const state = this.fsm.state;

    // 1. 玩法与机关图鉴弹窗最高优先拦截
    if (this.guide.isOpen) {
      const gAct = this.guide.handleTap(px, py);
      if (gAct) {
        this.audio.playEvent('UI_BUTTON_TAP');
      }
      return;
    }

    // 2. 设置与选关抽屉拦截（HOME 与 PLAYING 均可打开）
    if (this.drawer.isOpen && (state === 'HOME' || state === 'PLAYING')) {
      const hasProgressAndLoot =
        state === 'PLAYING' &&
        this.engine.boardsPulledCount > 0 &&
        this.engine.lootBag.length > 0;
      const dAct = this.drawer.handleTap(px, py, hasProgressAndLoot);
      if (!dAct) return;
      this.audio.playEvent('UI_BUTTON_TAP');

      if (dAct.type === 'GO_HOME') {
        this.fsm.transitionTo('HOME');
      } else if (dAct.type === 'OPEN_GUIDE') {
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
          this.toast.show(ok ? '☁️ 云端存档同步完成' : '本地存档已安全保存');
        });
      } else if (dAct.type === 'SELECT_LEVEL') {
        this.enterLevel(dAct.levelId, true);
      } else if (dAct.type === 'LOCKED_LEVEL_TOAST') {
        this.toast.show(`请先通关第 ${dAct.needLevel} 关解锁哦~`);
      }
      return;
    }

    if (state === 'SPLASH') {
      this.splash.handleTap(px, py);
      return;
    }

    // 3. 主菜单大厅交互
    if (state === 'HOME') {
      const hAct = this.home.handleTap(px, py);
      if (!hAct) return;
      this.audio.playEvent('UI_BUTTON_TAP');
      if (hAct === 'CONSUMED') return;

      switch (hAct.type) {
        case 'START_GAME':
          this.enterLevel(this.saveMgr.data.currentLevel, true);
          break;
        case 'OPEN_LEVEL_SELECT':
        case 'OPEN_SETTINGS':
          this.drawer.isOpen = true;
          break;
        case 'OPEN_GALLERY':
          this.openGalleryFrom('HOME');
          break;
        case 'OPEN_GUIDE':
          this.guide.activeTab = 'MECHANICS';
          this.guide.isOpen = true;
          break;
        case 'SHARE_FRIEND':
          void this.platform.shareAppMessage({
            title: `超解压烧脑流沙挖盲盒！我的藏馆总身价已达 ${formatNetWorth(this.saveMgr.data.totalNetWorth)}，快来淘绝世大红！`,
          });
          this.toast.show('🎁 已唤起微信好友分享！');
          break;
      }
      return;
    }

    if (state === 'GALLERY') {
      const act = this.gallery.handleTap(px, py, this.layout, this.gacha, this.saveMgr);
      if (!act) return;
      if (act.type === 'BACK_TO_GAME') {
        this.audio.playEvent('UI_BUTTON_TAP');
        this.gallery.onExit(this.auth);
        this.fsm.transitionTo(this.galleryReturnState);
      } else if (act.type === 'SHARE_FIGURINE') {
        void this.platform.shareAppMessage({
          title: `🔥卧槽沙里淘出大红！价值 ${formatNetWorth(act.fig.valuation)}【${act.fig.name}】入库，你敢来鉴定吗？`,
        });
        this.toast.show('已唤起好友欧气晒单！');
      } else if (act.type === 'TOAST') {
        this.toast.show(act.msg);
      }
      return;
    }

    if (state === 'APPRAISAL') {
      const act = this.appraisal.handleTap(px, py, this.layout.screenW, this.layout.screenH);
      if (!act) return;
      this.audio.playEvent('UI_BUTTON_TAP');

      if (act.type === 'NEXT_LEVEL') {
        const wasLvl1 = this.appraisal.levelId === 1;
        const nextId =
          this.appraisal.levelId >= this.levelMgr.totalLevels ? 1 : this.appraisal.levelId + 1;
        this.enterLevel(nextId, true);
        if (wasLvl1 && nextId === 2) {
          this.ftue.triggerLevel2Tip();
        }
      } else if (act.type === 'OPEN_GALLERY') {
        this.openGalleryFrom('PLAYING');
      } else if (act.type === 'REROLL_SLOT') {
        void this.rewardMgr.requestReward('REROLL_BOX').then(res => {
          if (!res.granted) return;
          const oldOut = this.appraisal.outcomes[act.slotIndex];
          if (!oldOut) return;
          const upgraded = this.gacha.rerollUpgradeOutcome(oldOut, this.saveMgr.data);
          this.saveMgr.saveNow(true);
          this.appraisal.replaceOutcomeAfterReroll(act.slotIndex, upgraded);
          this.toast.show('✨ 重抽成功！品质保底提升！');
        });
      } else if (act.type === 'UNLOCK_AIRDROP') {
        void this.rewardMgr.requestReward('BONUS_BOX').then(res => {
          if (!res.granted || !this.appraisal.airdropBoxId) return;
          const boxCfg = this.gacha.boxMap.get(this.appraisal.airdropBoxId)!;
          const out = this.gacha.rollSingleDraw(
            this.appraisal.outcomes.length,
            boxCfg.boxId,
            boxCfg.dropWeights,
            false,
            this.appraisal.levelId,
            this.saveMgr.data
          );
          this.saveMgr.saveNow(true);
          this.appraisal.appendAirdropOutcome(out);
        });
      } else if (act.type === 'SHARE_RED_JACKPOT') {
        void this.platform.shareAppMessage({
          title: `🔥卧槽沙里淘出大红！价值 ${formatNetWorth(act.valuation)}【${act.figName}】入库，你敢来鉴定吗？`,
        });
        this.toast.show('已生成炫耀晒单卡片！');
      }
      return;
    }

    if (state !== 'PLAYING') return;

    // 局内 HUD 按钮点击
    const hudAct = this.hud.handleTap(px, py, this.layout, this.engine);
    if (hudAct === 'CONSUMED') {
      this.audio.playEvent('UI_BUTTON_TAP');
      return;
    }
    if (hudAct) {
      this.audio.playEvent('UI_BUTTON_TAP');
      switch (hudAct) {
        case 'GO_HOME':
          this.audio.updateSandFlow(0);
          this.fsm.transitionTo('HOME');
          break;
        case 'OPEN_DRAWER':
          this.drawer.isOpen = true;
          break;
        case 'OPEN_GALLERY':
          this.openGalleryFrom('PLAYING');
          break;
        case 'TAP_LOOT_BAG':
          this.toast.show('🎒 清完本关全部流沙即可开启鉴定台拆盲盒！');
          break;
        case 'PROP_UNDO':
          if (!this.engine.snapshots.canUndo() || this.engine.won) {
            this.toast.show('当前没有可撤回的抽板步骤');
          } else {
            void this.rewardMgr.requestReward('UNDO').then(res => {
              if (!res.granted) return;
              if (this.engine.undo()) {
                this.audio.playEvent('PROP_UNDO_SNAPSHOT');
                this.haptic.triggerForEvent('PROP_UNDO_SNAPSHOT');
                this.toast.show('↩️ 已撤回上一步');
              }
            });
          }
          break;
        case 'PROP_VACUUM':
          if (!this.engine.canUseVacuum()) {
            this.toast.show(
              this.engine.vacuumUsedCount >= 3
                ? '本关清堵次数已用完 (3/3)'
                : '当前漏斗口畅通，无需清堵哦~'
            );
          } else {
            void this.rewardMgr.requestReward('VACUUM').then(res => {
              if (!res.granted) return;
              const sucked = this.engine.useVacuum();
              if (sucked > 0) {
                this.audio.playEvent('PROP_VACUUM_CLEAN');
                this.haptic.triggerForEvent('PROP_VACUUM_CLEAN');
                this.toast.show(`🌪️ 已清堵吸入 ${sucked} 粒沙并自动预充对应桶！`);
              }
            });
          }
          break;
        case 'PROP_EXTRA_SLOT':
          if (!this.engine.bucketSys.canEnableExtraSlot()) {
            this.toast.show(
              this.engine.bucketSys.maxActiveSlots >= 2 ? '第 2 接沙槽已开启中' : '剩余彩桶不足 2 只'
            );
          } else {
            void this.rewardMgr.requestReward('EXTRA_SLOT').then(res => {
              if (!res.granted) return;
              if (this.engine.bucketSys.enableExtraSlot()) {
                this.audio.playEvent('PROP_EXTRA_SLOT');
                this.haptic.triggerForEvent('PROP_EXTRA_SLOT');
                this.toast.show('➕ 已开启双槽并发接沙！');
              }
            });
          }
          break;
        case 'PROP_RESTART_CONFIRMED':
          this.enterLevel(this.engine.level.levelId, true);
          this.toast.show('🔄 沙盘已重置');
          break;
      }
      return;
    }

    // 局内主沙盘点击抽木板（横向外扩 36px 覆盖玻璃箱外壁外侧的雕花木拉手）
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
          this.toast.show('👆 请先点击下方高亮的蓝沙木板哦！');
          return;
        }
        this.engine.pullBoard(board.id, false);
      }
    }
  }

  private startLoop(): void {
    const sched =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: FrameRequestCallback) => setTimeout(() => fn(Date.now()), 16) as unknown as number;

    const tick = (ts: number): void => {
      this.rafId = sched(tick);
      if (!this.lastTs) this.lastTs = ts;
      const rawDt = Math.min(50, Math.max(0, ts - this.lastTs));
      this.lastTs = ts;

      if (this.fsm.state === 'PAUSED') return;

      this.elapsedSec += rawDt / 1000;
      this.particles.reportFrameTime(rawDt);
      this.toast.update(rawDt);
      this.ftue.update(rawDt);
      this.hud.update(rawDt, this.saveMgr.data.totalNetWorth);
      this.particles.update(rawDt / 1000);

      if (this.fsm.state === 'PLAYING') {
        this.engine.updateVisualTimers(rawDt);
        if (!this.drawer.isOpen && !this.guide.isOpen) {
          this.accumMs += rawDt;
          const stepMs = 1000 / 60;
          let steps = 0;
          while (this.accumMs >= stepMs && steps < 3) {
            this.engine.step(ts);
            this.accumMs -= stepMs;
            steps++;
          }
          this.audio.updateSandFlow(this.engine.won ? 0 : this.engine.lastFlowParticles);

          if (this.winSettleDelayMs >= 0) {
            this.winSettleDelayMs -= rawDt;
            if (this.winSettleDelayMs <= 0) {
              this.winSettleDelayMs = -1;
              this.audio.updateSandFlow(0);
              this.fsm.transitionTo('APPRAISAL');
            }
          }
        } else {
          this.audio.updateSandFlow(0);
        }
      } else {
        this.audio.updateSandFlow(0);
        if (this.fsm.state === 'APPRAISAL') {
          this.appraisal.update(rawDt, this.layout.screenW, this.layout.screenH);
        } else if (this.fsm.state === 'GALLERY') {
          this.gallery.update(rawDt, this.layout.screenW, this.layout.screenH);
        }
      }

      this.renderFrame();
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
      } else if (state === 'HOME') {
        this.home.render(
          ctx,
          this.layout,
          this.levelMgr,
          this.gacha,
          this.saveMgr,
          this.assets,
          this.splash,
          this.hasCraftableRedDot(),
          tokens,
          this.elapsedSec
        );
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
      } else if (state === 'GALLERY') {
        this.gallery.render(
          ctx,
          this.layout,
          this.gacha,
          this.saveMgr,
          this.auth,
          this.assets,
          this.elapsedSec
        );
        this.particles.render(ctx);
      } else {
        // PLAYING 或 APPRAISAL（鉴定台叠加在局内背景之上）
        this.hud.renderBackground(ctx, this.layout, this.assets, tokens);
        const bagCenter = {
          x: this.layout.lootBagPill.x + this.layout.lootBagPill.w * 0.5,
          y: this.layout.lootBagPill.y + this.layout.lootBagPill.h * 0.5,
        };
        this.sandRenderer.render(
          ctx,
          this.engine,
          this.layout.chamberRect,
          bagCenter,
          this.assets,
          tokens,
          this.gacha.boxMap,
          this.saveMgr.data.equippedSkinId === 'skin_galaxy_glitter'
        );
        this.hud.renderForeground(
          ctx,
          this.layout,
          this.engine,
          this.sandRenderer,
          this.assets,
          this.saveMgr,
          this.rewardMgr,
          this.hasCraftableRedDot(),
          tokens,
          this.elapsedSec
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

        if (state === 'APPRAISAL') {
          this.appraisal.render(
            ctx,
            this.layout,
            this.assets,
            this.rewardMgr,
            this.hasCraftableRedDot(),
            this.elapsedSec
          );
          this.particles.render(ctx);
        }
      }

      this.toast.render(ctx, this.layout.screenW, this.layout.screenH, tokens);
    } catch (err) {
      console.error('[ShaLiTaoDaHong renderFrame error]', err);
    } finally {
      ctx.restore();
    }
  }
}

const app = new ShaLiTaoDaHongApp();
(globalThis as unknown as { __SLT_APP__?: ShaLiTaoDaHongApp }).__SLT_APP__ = app;
void app.boot();
