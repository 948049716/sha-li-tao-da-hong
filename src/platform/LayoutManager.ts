import { GH, GW } from '../engine/SandGrid';
import type { Rect } from '../types/ui';
import type { ViewportMetrics } from './PlatformBridge';

export interface ComputedLayout {
  screenW: number;
  screenH: number;
  dpr: number;
  menuRect: Rect;
  topHudY: number;
  topHudH: number;
  topHudMaxRight: number;
  homePill: Rect;
  settingsPill: Rect;
  netWorthPill: Rect;
  lootBagPill: Rect;
  chamberRect: Rect;
  bucketRowRect: Rect;
  propRowRect: Rect;
  propButtons: [Rect, Rect, Rect, Rect]; // 撤回 / 清堵 / 加槽 / 重玩
}

/**
 * 竖屏安全区栅格与微信右上角官方胶囊 + 「更多游戏」胶囊双安全避让几何计算器
 */
export class LayoutManager {
  public compute(metrics: ViewportMetrics): ComputedLayout {
    const W = metrics.width;
    const H = metrics.height;
    const menu = metrics.menuButtonRect;

    // 矮屏紧凑自适应标记
    const shortScreen = H / W < 1.85;

    // iOS 微信真机在右上角胶囊左侧还会额外渲染官方「更多游戏」胶囊（共占宽约 196px）
    // 将顶栏统一置于 menu.y + menu.h + 6 下方，在所有机型上 100% 避开微信顶部双胶囊！
    const topHudY = menu.y + menu.h + 6;
    const topHudH = shortScreen ? 30 : Math.max(32, menu.h);
    const topHudMaxRight = W - 10;

    const homeW = 54;
    const lootW = 58;
    const lootX = Math.max(210, topHudMaxRight - lootW);
    const availMidW = Math.max(140, lootX - (10 + homeW + 5) - 5);
    const setW = Math.min(100, Math.floor(availMidW * 0.46));
    const netW = Math.min(144, availMidW - setW - 5);

    const homePill: Rect = { x: 10, y: topHudY, w: homeW, h: topHudH };
    const settingsPill: Rect = { x: homePill.x + homeW + 5, y: topHudY, w: setW, h: topHudH };
    const netWorthPill: Rect = { x: settingsPill.x + setW + 5, y: topHudY, w: netW, h: topHudH };
    const lootBagPill: Rect = { x: lootX, y: topHudY, w: lootW, h: topHudH };

    // 底部双行操作区高度
    const bucketRowH = shortScreen ? 80 : 90;
    const propRowH = shortScreen ? 66 : 74;
    const bottomTotalH = bucketRowH + propRowH + metrics.safeBottom + 6;
    const bottomBarTop = H - bottomTotalH;

    // 中部玻璃沙盘主视口（目标横向 90%~94%，保持 150:165 宽高比不拉伸）
    const chamberTopBound = topHudY + topHudH + 6;
    const chamberAvailH = Math.max(250, bottomBarTop - chamberTopBound - 6);
    let sandW = Math.min(W * 0.92, chamberAvailH * (GW / GH));
    if (sandW < W * 0.72) {
      sandW = Math.min(W * 0.92, chamberAvailH * 0.98 * (GW / GH));
    }
    const sandH = sandW * (GH / GW);
    const chamberX = Math.round((W - sandW) * 0.5);
    const chamberY = Math.round(chamberTopBound + (chamberAvailH - sandH) * 0.5);

    const chamberRect: Rect = {
      x: chamberX,
      y: chamberY,
      w: Math.round(sandW),
      h: Math.round(sandH),
    };

    const bucketRowRect: Rect = {
      x: 12,
      y: bottomBarTop,
      w: W - 24,
      h: bucketRowH,
    };

    const propRowRect: Rect = {
      x: 12,
      y: bottomBarTop + bucketRowH + 2,
      w: W - 24,
      h: propRowH,
    };

    const gap = 8;
    const btnW = Math.floor((propRowRect.w - gap * 3) / 4);
    const btnH = Math.min(58, propRowRect.h - 8);
    const btnY = propRowRect.y + Math.floor((propRowRect.h - btnH) * 0.5);

    const propButtons: [Rect, Rect, Rect, Rect] = [
      { x: propRowRect.x, y: btnY, w: btnW, h: btnH },
      { x: propRowRect.x + (btnW + gap), y: btnY, w: btnW, h: btnH },
      { x: propRowRect.x + (btnW + gap) * 2, y: btnY, w: btnW, h: btnH },
      { x: propRowRect.x + (btnW + gap) * 3, y: btnY, w: btnW, h: btnH },
    ];

    return {
      screenW: W,
      screenH: H,
      dpr: metrics.dpr,
      menuRect: menu,
      topHudY,
      topHudH,
      topHudMaxRight,
      homePill,
      settingsPill,
      netWorthPill,
      lootBagPill,
      chamberRect,
      bucketRowRect,
      propRowRect,
      propButtons,
    };
  }
}
