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
  mountUserInfoButton(
    rect: Rect,
    onAuthorized: (profile: { nickName: string; avatarUrl: string }) => void
  ): void;
  destroyUserInfoButton(): void;
  onLifecycle(handlers: {
    onShow?: () => void;
    onHide?: () => void;
    onResize?: () => void;
  }): void;
}
