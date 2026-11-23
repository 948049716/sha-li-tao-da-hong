import type { Rect } from '../types/ui';

export interface ViewportMetrics {
  width: number;
  height: number;
  dpr: number;
  statusBarHeight: number;
  safeBottom: number;
  menuButtonRect: Rect; // 右上角微信官方胶囊矩形（逻辑像素）
}

export interface SharePayload {
  title: string;
  imageUrl?: string;
  query?: string;
}

export interface PointerInputHandlers {
  onDown: (x: number, y: number, id: number) => void;
  onMove: (x: number, y: number, id: number) => void;
  onUp: (x: number, y: number, id: number) => void;
  onCancel: (id: number) => void;
  onWheel?: (deltaY: number) => void;
}

export interface IPlatformBridge {
  readonly isWeChat: boolean;
  getViewportMetrics(): ViewportMetrics;
  createOffscreenCanvas(): HTMLCanvasElement;
  createImage(): HTMLImageElement;
  createAudioContext(): AudioContext | null;
  getStorage(key: string): string | null;
  setStorage(key: string, value: string): void;
  vibrateShort(type: 'light' | 'medium' | 'heavy'): void;
  shareAppMessage(payload: SharePayload): Promise<boolean>;
  showRewardedVideoAd(adUnitId: string): Promise<boolean>;
  loadSubpackage(name: string): Promise<boolean>;
  /** 加载打包内置手绘字体（Web FontFace / 微信 wx.loadFont），返回注册成功的字体族名 */
  loadCustomFont?(relPath: string, desiredFamily: string): Promise<string | null>;
  /** 读取代码包 / 分包内二进制资源（如 BGM mp3），失败返回 null */
  readBinaryFile(relPath: string): Promise<ArrayBuffer | null>;
  mountUserInfoButton(
    rect: Rect,
    onAuthorized: (profile: { nickName: string; avatarUrl: string }) => void
  ): void;
  destroyUserInfoButton(): void;
  bindInput(handlers: PointerInputHandlers): void;
  onLifecycle(handlers: {
    onShow?: () => void;
    onHide?: () => void;
    onResize?: () => void;
  }): void;
}
