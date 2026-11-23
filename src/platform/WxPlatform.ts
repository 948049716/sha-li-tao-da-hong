import type { Rect } from '../types/ui';
import type { WxGlobal, WxTouch, WxTouchEvent, WxUserInfoButton } from '../types/wx';
import { wrapCanvasWithPolyfill } from './CanvasPolyfill';
import type {
  IPlatformBridge,
  PointerInputHandlers,
  SharePayload,
  ViewportMetrics,
} from './PlatformBridge';

/**
 * 微信小游戏真实运行环境适配实现（基础库 >= 2.30.0，兼容 iOS / Android 真机触摸与 2D Context）
 */
export class WxPlatform implements IPlatformBridge {
  public readonly isWeChat = true;
  private wxObj: WxGlobal;
  private userBtn: WxUserInfoButton | null = null;
  private pendingShareResolve: ((ok: boolean) => void) | null = null;

  constructor(wxObj: WxGlobal) {
    this.wxObj = wxObj;
    this.wxObj.onShareAppMessage?.(() => ({
      title: '星夜下的治愈流沙瓶！一抽一装，超解压的彩沙入瓶解谜',
      imageUrl: 'assets/ui/bg/ui_bg_splash.png',
    }));
  }

  public getViewportMetrics(): ViewportMetrics {
    const win =
      this.wxObj.getWindowInfo?.() ||
      this.wxObj.getSystemInfoSync?.() || {
        screenWidth: 390,
        screenHeight: 844,
        windowWidth: 390,
        windowHeight: 844,
        pixelRatio: 2,
        statusBarHeight: 44,
      };
    const w = win.windowWidth || win.screenWidth || 390;
    const h = win.windowHeight || win.screenHeight || 844;
    const menu = this.wxObj.getMenuButtonBoundingClientRect?.() || {
      left: w - 97,
      top: (win.statusBarHeight || 20) + 6,
      right: w - 10,
      bottom: (win.statusBarHeight || 20) + 38,
      width: 87,
      height: 32,
    };
    const safeBottom = win.safeArea
      ? Math.max(0, (win.screenHeight || h) - win.safeArea.bottom)
      : 0;

    return {
      width: w,
      height: h,
      dpr: Math.min(win.pixelRatio || 2, 3),
      statusBarHeight: win.statusBarHeight || 20,
      safeBottom,
      menuButtonRect: {
        x: menu.left,
        y: menu.top,
        w: menu.width,
        h: menu.height,
      },
    };
  }

  public createOffscreenCanvas(): HTMLCanvasElement {
    if (this.wxObj.createCanvas) {
      return wrapCanvasWithPolyfill(this.wxObj.createCanvas());
    }
    return wrapCanvasWithPolyfill(document.createElement('canvas'));
  }

  public createImage(): HTMLImageElement {
    if (this.wxObj.createImage) {
      return this.wxObj.createImage();
    }
    return new Image();
  }

  public createAudioContext(): AudioContext | null {
    try {
      return this.wxObj.createWebAudioContext ? this.wxObj.createWebAudioContext() : null;
    } catch {
      return null;
    }
  }

  public getStorage(key: string): string | null {
    try {
      const val = this.wxObj.getStorageSync?.(key);
      return typeof val === 'string' && val.length > 0 ? val : null;
    } catch {
      return null;
    }
  }

  public setStorage(key: string, value: string): void {
    try {
      this.wxObj.setStorageSync?.(key, value);
    } catch {
      // ignore storage failure
    }
  }

  public vibrateShort(type: 'light' | 'medium' | 'heavy'): void {
    try {
      this.wxObj.vibrateShort?.({ type });
    } catch {
      // 低版本兼容降级
    }
  }

  public shareAppMessage(payload: SharePayload): Promise<boolean> {
    return new Promise(resolve => {
      try {
        this.pendingShareResolve = resolve;
        this.wxObj.shareAppMessage?.(payload);
        // 若部分机型未触发 onShow，兜底 1.2s 结算
        setTimeout(() => {
          if (this.pendingShareResolve === resolve) {
            this.pendingShareResolve = null;
            resolve(true);
          }
        }, 1200);
      } catch {
        this.pendingShareResolve = null;
        resolve(true);
      }
    });
  }

  public showRewardedVideoAd(adUnitId: string): Promise<boolean> {
    return new Promise(resolve => {
      if (!this.wxObj.createRewardedVideoAd || !adUnitId) {
        resolve(false);
        return;
      }
      try {
        const ad = this.wxObj.createRewardedVideoAd({ adUnitId });
        const handleClose = (res?: { isEnded?: boolean }): void => {
          ad.offClose(handleClose);
          resolve(Boolean(res?.isEnded));
        };
        ad.onClose(handleClose);
        ad.onError(() => {
          ad.offClose(handleClose);
          resolve(false);
        });
        ad.show().catch(() => {
          ad.load()
            .then(() => ad.show())
            .catch(() => {
              ad.offClose(handleClose);
              resolve(false);
            });
        });
      } catch {
        resolve(false);
      }
    });
  }

  public loadSubpackage(name: string): Promise<boolean> {
    return new Promise(resolve => {
      if (!this.wxObj.loadSubpackage) {
        resolve(true);
        return;
      }
      this.wxObj.loadSubpackage({
        name,
        success: () => resolve(true),
        fail: () => resolve(false),
      });
    });
  }

  public readBinaryFile(relPath: string): Promise<ArrayBuffer | null> {
    return new Promise(resolve => {
      try {
        const fsm = this.wxObj.getFileSystemManager?.();
        if (!fsm) {
          resolve(null);
          return;
        }
        fsm.readFile({
          filePath: relPath,
          success: res => resolve(res.data instanceof ArrayBuffer ? res.data : null),
          fail: () => resolve(null),
        });
      } catch {
        resolve(null);
      }
    });
  }

  public mountUserInfoButton(
    rect: Rect,
    onAuthorized: (profile: { nickName: string; avatarUrl: string }) => void
  ): void {
    this.destroyUserInfoButton();
    if (!this.wxObj.createUserInfoButton) return;
    try {
      const btn = this.wxObj.createUserInfoButton({
        type: 'text',
        text: '',
        style: {
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          backgroundColor: '#00000000',
          borderColor: '#00000000',
          borderWidth: 0,
        },
      });
      btn.onTap(res => {
        if (res?.userInfo?.nickName) {
          onAuthorized({
            nickName: res.userInfo.nickName,
            avatarUrl: res.userInfo.avatarUrl || '',
          });
          this.destroyUserInfoButton();
        }
      });
      this.userBtn = btn;
    } catch {
      // ignore unsupported base lib
    }
  }

  public destroyUserInfoButton(): void {
    if (this.userBtn) {
      try {
        this.userBtn.destroy();
      } catch {
        // ignore
      }
      this.userBtn = null;
    }
  }

  private extractTouch(t: WxTouch | undefined): { x: number; y: number; id: number } | null {
    if (!t) return null;
    const x = t.clientX ?? t.pageX ?? t.x;
    const y = t.clientY ?? t.pageY ?? t.y;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    return { x, y, id: t.identifier ?? 0 };
  }

  public bindInput(handlers: PointerInputHandlers): void {
    this.wxObj.onTouchStart?.((ev: WxTouchEvent) => {
      const pt = this.extractTouch(ev?.changedTouches?.[0] || ev?.touches?.[0]);
      if (pt) handlers.onDown(pt.x, pt.y, pt.id);
    });
    this.wxObj.onTouchMove?.((ev: WxTouchEvent) => {
      const list = ev?.changedTouches?.length ? ev.changedTouches : ev?.touches || [];
      for (const item of list) {
        const pt = this.extractTouch(item);
        if (pt) handlers.onMove(pt.x, pt.y, pt.id);
      }
    });
    this.wxObj.onTouchEnd?.((ev: WxTouchEvent) => {
      const list = ev?.changedTouches?.length ? ev.changedTouches : ev?.touches || [];
      for (const item of list) {
        const pt = this.extractTouch(item);
        if (pt) handlers.onUp(pt.x, pt.y, pt.id);
      }
    });
    this.wxObj.onTouchCancel?.((ev: WxTouchEvent) => {
      const list = ev?.changedTouches?.length ? ev.changedTouches : ev?.touches || [];
      if (list.length === 0) {
        handlers.onCancel(0);
        return;
      }
      for (const item of list) {
        handlers.onCancel(item.identifier ?? 0);
      }
    });
  }

  public onLifecycle(handlers: {
    onShow?: () => void;
    onHide?: () => void;
    onResize?: () => void;
  }): void {
    this.wxObj.onShow?.(() => {
      if (this.pendingShareResolve) {
        const fn = this.pendingShareResolve;
        this.pendingShareResolve = null;
        fn(true);
      }
      handlers.onShow?.();
    });
    this.wxObj.onHide?.(() => handlers.onHide?.());
    this.wxObj.onWindowResize?.(() => handlers.onResize?.());
  }
}
