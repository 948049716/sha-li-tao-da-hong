import type { Rect } from '../types/ui';
import type { WxGlobal, WxUserInfoButton } from '../types/wx';
import type { IPlatformBridge, SharePayload, ViewportMetrics } from './PlatformBridge';

/**
 * 微信小游戏真实运行环境适配实现（基础库 >= 2.30.0）
 */
export class WxPlatform implements IPlatformBridge {
  public readonly isWeChat = true;
  private wxObj: WxGlobal;
  private userBtn: WxUserInfoButton | null = null;
  private pendingShareResolve: ((ok: boolean) => void) | null = null;

  constructor(wxObj: WxGlobal) {
    this.wxObj = wxObj;
    this.wxObj.onShareAppMessage?.(() => ({
      title: '超解压流沙挖盲盒！看看你能淘出几件千万级大红？',
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
    const menu = this.wxObj.getMenuButtonBoundingClientRect?.() || {
      left: win.windowWidth - 97,
      top: (win.statusBarHeight || 20) + 6,
      right: win.windowWidth - 10,
      bottom: (win.statusBarHeight || 20) + 38,
      width: 87,
      height: 32,
    };
    const safeBottom = win.safeArea
      ? Math.max(0, win.screenHeight - win.safeArea.bottom)
      : 0;

    return {
      width: win.windowWidth || win.screenWidth,
      height: win.windowHeight || win.screenHeight,
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
      return this.wxObj.createCanvas();
    }
    return document.createElement('canvas');
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
