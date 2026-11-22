import type { Rect } from '../types/ui';
import { wrapCanvasWithPolyfill } from './CanvasPolyfill';
import type {
  IPlatformBridge,
  PointerInputHandlers,
  SharePayload,
  ViewportMetrics,
} from './PlatformBridge';

/**
 * 浏览器本地开发/预览适配实现（模拟竖屏手机视口、右上角微信胶囊安全区与分享回调）
 */
export class WebMockPlatform implements IPlatformBridge {
  public readonly isWeChat = false;
  private canvas: HTMLCanvasElement;
  private userInfoCleanup: (() => void) | null = null;
  private userInfoHotRect: Rect | null = null;
  private userInfoCallback: ((p: { nickName: string; avatarUrl: string }) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const handlePointer = (ev: PointerEvent): void => {
      if (!this.userInfoHotRect || !this.userInfoCallback) return;
      const bounds = this.canvas.getBoundingClientRect();
      const lx = ev.clientX - bounds.left;
      const ly = ev.clientY - bounds.top;
      const r = this.userInfoHotRect;
      if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) {
        this.userInfoCallback({
          nickName: '星夜淘金客',
          avatarUrl: '/assets/ui/collection/ui_avatar_default_duck.png',
        });
      }
    };
    this.canvas.addEventListener('pointerup', handlePointer);
    this.userInfoCleanup = () => this.canvas.removeEventListener('pointerup', handlePointer);
  }

  public getViewportMetrics(): ViewportMetrics {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    let width = winW;
    let height = winH;

    // 桌面宽屏下自动模拟标准手机竖屏比例（如 390x844），移动端全屏贴合
    if (winW >= 520) {
      height = Math.min(860, Math.max(640, winH - 28));
      width = Math.round(height * (390 / 844));
      if (width > winW - 24) {
        width = winW - 24;
        height = Math.round(width * (844 / 390));
      }
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const statusBarHeight = 14;
    const menuW = 87;
    const menuH = 32;
    const menuLeft = width - menuW - 10;
    const menuTop = statusBarHeight + 6;

    // 同步定位 HTML 模拟胶囊浮层
    const mockEl = document.getElementById('wx-capsule-mock');
    if (mockEl) {
      const shellW = window.innerWidth;
      const shellH = window.innerHeight;
      const offsetX = (shellW - width) * 0.5;
      const offsetY = (shellH - height) * 0.5;
      mockEl.style.left = `${offsetX + menuLeft}px`;
      mockEl.style.top = `${offsetY + menuTop}px`;
      mockEl.style.width = `${menuW}px`;
      mockEl.style.height = `${menuH}px`;
    }

    return {
      width,
      height,
      dpr,
      statusBarHeight,
      safeBottom: height > 760 ? 16 : 8,
      menuButtonRect: {
        x: menuLeft,
        y: menuTop,
        w: menuW,
        h: menuH,
      },
    };
  }

  public createOffscreenCanvas(): HTMLCanvasElement {
    return wrapCanvasWithPolyfill(document.createElement('canvas'));
  }

  public createImage(): HTMLImageElement {
    return new Image();
  }

  public createAudioContext(): AudioContext | null {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }

  public getStorage(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  public setStorage(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore quota errors
    }
  }

  public vibrateShort(type: 'light' | 'medium' | 'heavy'): void {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      const ms = type === 'heavy' ? 35 : type === 'medium' ? 20 : 10;
      try {
        navigator.vibrate(ms);
      } catch {
        // ignore
      }
    }
  }

  public async shareAppMessage(payload: SharePayload): Promise<boolean> {
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(`【沙里淘大红】${payload.title}`);
      } catch {
        // ignore clipboard permission in headless
      }
    }
    await new Promise(r => setTimeout(r, 240));
    return true;
  }

  public async showRewardedVideoAd(_adUnitId: string): Promise<boolean> {
    await new Promise(r => setTimeout(r, 350));
    return true;
  }

  public async loadSubpackage(_name: string): Promise<boolean> {
    return true;
  }

  public async readBinaryFile(relPath: string): Promise<ArrayBuffer | null> {
    if (typeof fetch !== 'function') return null;
    try {
      const res = await fetch(relPath.startsWith('/') ? relPath : `/${relPath}`);
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  }

  public mountUserInfoButton(
    rect: Rect,
    onAuthorized: (profile: { nickName: string; avatarUrl: string }) => void
  ): void {
    this.userInfoHotRect = rect;
    this.userInfoCallback = onAuthorized;
  }

  public destroyUserInfoButton(): void {
    this.userInfoHotRect = null;
    this.userInfoCallback = null;
    if (!this.userInfoCleanup) return;
  }

  public bindInput(handlers: PointerInputHandlers): void {
    const toLocal = (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    if (typeof window !== 'undefined' && 'PointerEvent' in window) {
      this.canvas.addEventListener('pointerdown', ev => {
        const pt = toLocal(ev.clientX, ev.clientY);
        handlers.onDown(pt.x, pt.y, ev.pointerId);
      });
      this.canvas.addEventListener('pointermove', ev => {
        const pt = toLocal(ev.clientX, ev.clientY);
        handlers.onMove(pt.x, pt.y, ev.pointerId);
      });
      this.canvas.addEventListener('pointerup', ev => {
        const pt = toLocal(ev.clientX, ev.clientY);
        handlers.onUp(pt.x, pt.y, ev.pointerId);
      });
      this.canvas.addEventListener('pointercancel', ev => {
        handlers.onCancel(ev.pointerId);
      });
    } else {
      this.canvas.addEventListener(
        'touchstart',
        ev => {
          ev.preventDefault();
          const t = ev.changedTouches[0];
          if (!t) return;
          const pt = toLocal(t.clientX, t.clientY);
          handlers.onDown(pt.x, pt.y, t.identifier);
        },
        { passive: false }
      );
      this.canvas.addEventListener(
        'touchmove',
        ev => {
          ev.preventDefault();
          for (let i = 0; i < ev.changedTouches.length; i++) {
            const t = ev.changedTouches[i];
            const pt = toLocal(t.clientX, t.clientY);
            handlers.onMove(pt.x, pt.y, t.identifier);
          }
        },
        { passive: false }
      );
      this.canvas.addEventListener('touchend', ev => {
        for (let i = 0; i < ev.changedTouches.length; i++) {
          const t = ev.changedTouches[i];
          const pt = toLocal(t.clientX, t.clientY);
          handlers.onUp(pt.x, pt.y, t.identifier);
        }
      });
      this.canvas.addEventListener('touchcancel', ev => {
        for (let i = 0; i < ev.changedTouches.length; i++) {
          handlers.onCancel(ev.changedTouches[i].identifier);
        }
      });
    }

    this.canvas.addEventListener(
      'wheel',
      ev => {
        if (handlers.onWheel) {
          ev.preventDefault();
          handlers.onWheel(ev.deltaY);
        }
      },
      { passive: false }
    );
  }

  public onLifecycle(handlers: {
    onShow?: () => void;
    onHide?: () => void;
    onResize?: () => void;
  }): void {
    window.addEventListener('resize', () => handlers.onResize?.());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) handlers.onHide?.();
      else handlers.onShow?.();
    });
  }
}
