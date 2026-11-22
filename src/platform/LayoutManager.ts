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
  /** 极简顶栏三枚组件：关卡选单与设置 | 玩法说明 | 免费重玩 */
  settingsPill: Rect;
  guidePill: Rect;
  restartPill: Rect;
  chamberRect: Rect;
  /** 包含上层小卡槽行 + 下层纵深候选桶列区的完整木工操作台区域 */
  bucketRowRect: Rect;
  /** 木工台第 1 层：4+1 临时接沙小卡槽区 */
  slotRowRect: Rect;
  activeSlotRects: [Rect, Rect, Rect, Rect, Rect];
  /** 木工台第 2 层：3~4 列前后排候选彩桶区 */
  candidateAreaRect: Rect;
  propRowRect: Rect;
  propButtons: [Rect, Rect, Rect, Rect]; // 撤回 / 磁吸满桶 / 加第5槽 / 候选洗牌
}

/**
 * 竖屏安全区栅格与微信右上角官方胶囊双安全避让几何计算器（极简纯粹双核解谜版）：
 * - 顶栏仅 3 枚清爽木牌：第 X 关（选关与设置） | 玩法说明 | 免费重玩
 * - 中央：宽底黄铜滤网厚壁玻璃沙箱（零盲盒杂物，视觉高度聚焦）
 * - 木工台双层区：上层 4+1 小卡槽 + 下层 3~4 列前后排候选木桶列
 * - 底栏：撤回 / 磁吸满桶 / 加第5槽 / 候选洗牌 四枚嵌芯木框道具卡
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
    const padX = 12;
    const topHudMaxRight = W - padX;

    // 极简顶栏 3 钮：左侧宽牌【⚙️ 第 X 关 · 标题 ▾】 + 右侧双钮【📖 玩法】【🔄 重玩】
    const gapTop = 8;
    const restartW = 72;
    const guideW = 72;
    const restartPill: Rect = {
      x: topHudMaxRight - restartW,
      y: topHudY,
      w: restartW,
      h: topHudH,
    };
    const guidePill: Rect = {
      x: restartPill.x - gapTop - guideW,
      y: topHudY,
      w: guideW,
      h: topHudH,
    };
    const settingsW = Math.max(120, guidePill.x - gapTop - padX);
    const settingsPill: Rect = {
      x: padX,
      y: topHudY,
      w: settingsW,
      h: topHudH,
    };

    // 底部双层木工排桶台面（4+1 小卡槽行 + 3~4 列纵深候选桶区） + 四枚道具卡行
    const slotRowH = shortScreen ? 54 : 62;
    const candidateAreaH = shortScreen ? 104 : 122;
    const bucketRowH = slotRowH + candidateAreaH;
    const propRowH = shortScreen ? 62 : 72;
    const bottomTotalH = bucketRowH + propRowH + metrics.safeBottom + 4;
    const bottomBarTop = H - bottomTotalH;

    // 中央厚壁宽底滤网玻璃沙盘主视口
    const chamberTopBound = topHudY + topHudH + 6;
    const chamberAvailH = Math.max(220, bottomBarTop - chamberTopBound - 4);
    let sandW = Math.min(W * 0.88, chamberAvailH * (GW / GH));
    if (sandW < W * 0.72) {
      sandW = Math.min(W * 0.88, chamberAvailH * 0.99 * (GW / GH));
    }
    const sandH = Math.min(chamberAvailH, sandW * (GH / GW));
    sandW = sandH * (GW / GH);

    const chamberX = Math.round((W - sandW) * 0.5);
    const desiredGapAboveSlots = shortScreen ? 4 : 8;
    const chamberY = Math.max(
      chamberTopBound,
      Math.min(bottomBarTop - Math.round(sandH), bottomBarTop - Math.round(sandH) - desiredGapAboveSlots)
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

    const slotRowRect: Rect = {
      x: 10,
      y: bottomBarTop,
      w: W - 20,
      h: slotRowH,
    };

    const slotGap = 6;
    const slotW = Math.min(64, Math.floor((slotRowRect.w - slotGap * 4) / 5));
    const slotH = slotRowH - 6;
    const totalSlotsW = slotW * 5 + slotGap * 4;
    const slotsStartX = Math.round((W - totalSlotsW) * 0.5);
    const slotY = slotRowRect.y + 3;
    const activeSlotRects: [Rect, Rect, Rect, Rect, Rect] = [
      { x: slotsStartX, y: slotY, w: slotW, h: slotH },
      { x: slotsStartX + (slotW + slotGap), y: slotY, w: slotW, h: slotH },
      { x: slotsStartX + (slotW + slotGap) * 2, y: slotY, w: slotW, h: slotH },
      { x: slotsStartX + (slotW + slotGap) * 3, y: slotY, w: slotW, h: slotH },
      { x: slotsStartX + (slotW + slotGap) * 4, y: slotY, w: slotW, h: slotH },
    ];

    const candidateAreaRect: Rect = {
      x: 10,
      y: bottomBarTop + slotRowH,
      w: W - 20,
      h: candidateAreaH,
    };

    const propRowRect: Rect = {
      x: 10,
      y: bottomBarTop + bucketRowH,
      w: W - 20,
      h: propRowH,
    };

    const gap = 8;
    const btnW = Math.floor((propRowRect.w - gap * 3) / 4);
    const btnH = Math.min(62, propRowRect.h - 6);
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
      settingsPill,
      guidePill,
      restartPill,
      chamberRect,
      bucketRowRect,
      slotRowRect,
      activeSlotRects,
      candidateAreaRect,
      propRowRect,
      propButtons,
    };
  }
}
