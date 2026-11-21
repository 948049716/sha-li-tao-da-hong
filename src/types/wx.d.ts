/**
 * 微信小游戏全局 wx API 最小强类型声明（基础库 >= 2.30.0）
 * 注意：仅在 src/platform/WxPlatform.ts 与 WxCloudSyncAdapter.ts 中使用，src/engine 严禁引用。
 */
export interface WxWindowInfo {
  screenWidth: number;
  screenHeight: number;
  windowWidth: number;
  windowHeight: number;
  pixelRatio: number;
  statusBarHeight: number;
  safeArea?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
}

export interface WxMenuButtonRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface WxUserInfoButton {
  onTap(cb: (res: { userInfo?: { nickName: string; avatarUrl: string }; errMsg?: string }) => void): void;
  destroy(): void;
  show(): void;
  hide(): void;
}

export interface WxRewardedVideoAd {
  load(): Promise<void>;
  show(): Promise<void>;
  onClose(cb: (res?: { isEnded?: boolean }) => void): void;
  offClose(cb: (res?: { isEnded?: boolean }) => void): void;
  onError(cb: (err: unknown) => void): void;
}

export interface WxGlobal {
  getWindowInfo?: () => WxWindowInfo;
  getSystemInfoSync?: () => WxWindowInfo;
  getMenuButtonBoundingClientRect?: () => WxMenuButtonRect;
  onWindowResize?: (cb: () => void) => void;
  onShow?: (cb: () => void) => void;
  onHide?: (cb: () => void) => void;
  createCanvas?: () => HTMLCanvasElement;
  createImage?: () => HTMLImageElement;
  createWebAudioContext?: () => AudioContext;
  getStorageSync?: (key: string) => string | undefined;
  setStorageSync?: (key: string, data: string) => void;
  vibrateShort?: (opts?: { type?: 'light' | 'medium' | 'heavy' }) => void;
  shareAppMessage?: (opts: { title: string; imageUrl?: string; query?: string }) => void;
  onShareAppMessage?: (cb: () => { title: string; imageUrl?: string }) => void;
  loadSubpackage?: (opts: {
    name: string;
    success?: () => void;
    fail?: (err: unknown) => void;
  }) => void;
  createUserInfoButton?: (opts: {
    type: 'text' | 'image';
    text?: string;
    style: {
      left: number;
      top: number;
      width: number;
      height: number;
      backgroundColor?: string;
      borderColor?: string;
      borderWidth?: number;
      borderRadius?: number;
      color?: string;
      fontSize?: number;
      lineHeight?: number;
    };
  }) => WxUserInfoButton;
  createRewardedVideoAd?: (opts: { adUnitId: string }) => WxRewardedVideoAd;
  cloud?: {
    init: (opts?: { env?: string; traceUser?: boolean }) => void;
    callFunction: (opts: {
      name: string;
      data?: Record<string, unknown>;
    }) => Promise<{ result?: unknown }>;
  };
}

declare global {
  const wx: WxGlobal | undefined;
  interface Window {
    wx?: WxGlobal;
  }
}
