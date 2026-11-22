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
  propButtons: [Rect, Rect, Rect, Rect]; // 撤回 / 吸尘器 / 加开槽 / 重玩
}

/**
 * 竖屏安全区栅格与微信右上角官方胶囊 + 「更多游戏」胶囊双安全避让几何计算器
 * 对齐 gameplay_ref.jpg 局内黄金比例：顶栏双圈木镶边牌匾 + 中央大视野玻璃沙箱 + 木工台中央接沙桶队列 + 底栏四枚嵌芯道具卡
 */
export class LayoutManager {
  public compute(metrics: ViewportMetrics): ComputedLayout {
    const W = metrics.width;
    const H = metrics.height;
    const menu = metrics.menuButtonRect;

    const shortScreen = H / W < 1.85;

    // 置于微信右上角双胶囊下方 6px，100% 避让所有 iOS/Android 机型系统胶囊
    const topHudY = menu.y + menu.h + 6;
    const topHudH = shortScreen ? 32 : Math.max(34, menu.h + 2);
    const topHudMaxRight = W - 10;

    // 顶栏四枚木镶边组件：左圆章主页钮 | 关卡设置匾额 | 身价藏馆匾额 | 右战利品兜
    const homeW = topHudH + 4;
    const lootW = 62;
    const lootX = Math.max(212, topHudMaxRight - lootW);
    const gapTop = 6;
    const availMidW = Math.max(144, lootX - (10 + homeW + gapTop) - gapTop);
    const setW = Math.min(108, Math.floor(availMidW * 0.46));
    const netW = Math.min(148, availMidW - setW - gapTop);

    const homePill: Rect = { x: 10, y: topHudY, w: homeW, h: topHudH };
    const settingsPill: Rect = { x: homePill.x + homeW + gapTop, y: topHudY, w: setW, h: topHudH };
    const netWorthPill: Rect = { x: settingsPill.x + setW + gapTop, y: topHudY, w: netW, h: topHudH };
    const lootBagPill: Rect = { x: lootX, y: topHudY, w: lootW, h: topHudH };

    // 底部木工接沙台面行 + 四枚圆角方木道具卡行
    const bucketRowH = shortScreen ? 82 : 92;
    const propRowH = shortScreen ? 68 : 78;
    const bottomTotalH = bucketRowH + propRowH + metrics.safeBottom + 4;
    const bottomBarTop = H - bottomTotalH;

    // 中央厚壁玻璃沙盘主视口（略向下亲和贴近接沙木桶口，使 V 形漏斗流沙柱垂直顺畅倾泻入中央桶）
    const chamberTopBound = topHudY + topHudH + 6;
    const chamberAvailH = Math.max(240, bottomBarTop - chamberTopBound - 2);
    let sandW = Math.min(W * 0.86, chamberAvailH * (GW / GH));
    if (sandW < W * 0.70) {
      sandW = Math.min(W * 0.87, chamberAvailH * 0.99 * (GW / GH));
    }
    const sandH = Math.min(chamberAvailH, sandW * (GH / GW));
    sandW = sandH * (GW / GH);

    const chamberX = Math.round((W - sandW) * 0.5);
    const desiredGapAboveBucketRow = shortScreen ? 10 : 22;
    const chamberY = Math.max(
      chamberTopBound,
      Math.min(bottomBarTop - Math.round(sandH), bottomBarTop - Math.round(sandH) - desiredGapAboveBucketRow)
    );

    const chamberRect: Rect = {
      x: chamberX,
      y: chamberY,
      w: Math.round(sandW),
      h: Math.round(sandH),
    };

    const bucketRowRect: Rect = {
      x: 0,
      y: bottomBarTop,
      w: W,
      h: bucketRowH,
    };

    const propRowRect: Rect = {
      x: 10,
      y: bottomBarTop + bucketRowH,
      w: W - 20,
      h: propRowH,
    };

    const gap = 8;
    const btnW = Math.floor((propRowRect.w - gap * 3) / 4);
    const btnH = Math.min(64, propRowRect.h - 6);
    const btnY = propRowRect.y + Math.floor((propRowRect.h - btnH) * 0.5) + 1;

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
