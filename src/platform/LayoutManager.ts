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
  /** 极简顶栏三枚组件：纯序号选关胶囊 | ? 玩法圆钮 | ↻ 重玩圆钮 */
  settingsPill: Rect;
  guidePill: Rect;
  restartPill: Rect;
  chamberRect: Rect;
  /** 包含上层磨砂瓶托行 + 下层多排纵深丝带玻璃瓶区的完整托盘区域 */
  bucketRowRect: Rect;
  /** 托盘第 1 层：4+1 磨砂玻璃接沙瓶位 */
  slotRowRect: Rect;
  activeSlotRects: [Rect, Rect, Rect, Rect, Rect];
  /** 托盘第 2 层：3~4 列多排纵深候选丝带玻璃瓶区 */
  candidateAreaRect: Rect;
  propRowRect: Rect;
  propButtons: [Rect, Rect, Rect, Rect]; // 纯图标按钮：撤回 / 磁吸满瓶 / +瓶位 / 洗牌
}

/**
 * 竖屏高屏占比栅格与微信右上角官方胶囊双安全避让几何计算器（日系治愈极简玻璃瓶版）：
 * - 顶栏：左侧紧凑序号胶囊「01」 + 右侧两枚无文字纯图标圆钮「?」「↻」
 * - 中央：高屏占比（~93.5% 屏宽）圆角通透玻璃沙箱 + 磨砂玻璃内隔条
 * - 底部双层磨砂玻璃托盘：上层 4+1 玻璃瓶位 + 下层可同屏纵览 4 排深度的候选丝带玻璃瓶列
 * - 底栏：4 枚纯图形图标柔雾圆角按钮（无底部文字，最大化让渡空间给沙箱与玻璃瓶）
 */
export class LayoutManager {
  public compute(metrics: ViewportMetrics): ComputedLayout {
    const W = metrics.width;
    const H = metrics.height;
    const menu = metrics.menuButtonRect;

    const shortScreen = H / W < 1.85;

    // 置于微信右上角双胶囊下方 5px，100% 避让所有 iOS/Android 机型系统胶囊
    const topHudY = menu.y + menu.h + 5;
    const topHudH = shortScreen ? 32 : 34;
    const padX = 12;
    const topHudMaxRight = W - padX;

    // 极简顶栏：左侧紧凑纯序号胶囊 + 右侧两枚纯图标正圆钮 [?] [↻]
    const gapTop = 8;
    const circleBtnSz = topHudH;
    const restartPill: Rect = {
      x: topHudMaxRight - circleBtnSz,
      y: topHudY,
      w: circleBtnSz,
      h: topHudH,
    };
    const guidePill: Rect = {
      x: restartPill.x - gapTop - circleBtnSz,
      y: topHudY,
      w: circleBtnSz,
      h: topHudH,
    };
    const settingsW = Math.min(92, Math.max(76, guidePill.x - gapTop - padX));
    const settingsPill: Rect = {
      x: padX,
      y: topHudY,
      w: settingsW,
      h: topHudH,
    };

    // 底部双层磨砂玻璃排瓶托盘 + 纯图标道具栏（去除文字后更紧凑，显著提升沙箱与瓶列屏占比）
    const slotRowH = shortScreen ? 52 : 58;
    const candidateAreaH = shortScreen ? 108 : 132;
    const bucketRowH = slotRowH + candidateAreaH;
    const propRowH = shortScreen ? 52 : 58;
    const bottomTotalH = bucketRowH + propRowH + metrics.safeBottom + 4;
    const bottomBarTop = H - bottomTotalH;

    // 中央高屏占比圆角厚壁玻璃沙箱（横向扩展至 ~93.5% 屏宽）
    const chamberTopBound = topHudY + topHudH + 4;
    const chamberAvailH = Math.max(220, bottomBarTop - chamberTopBound - 3);
    let sandW = Math.min(W * 0.935, chamberAvailH * (GW / GH));
    if (sandW < W * 0.75) {
      sandW = Math.min(W * 0.935, chamberAvailH * 0.995 * (GW / GH));
    }
    const sandH = Math.min(chamberAvailH, sandW * (GH / GW));
    sandW = sandH * (GW / GH);

    const chamberX = Math.round((W - sandW) * 0.5);
    const desiredGapAboveSlots = shortScreen ? 2 : 5;
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

    const slotGap = 7;
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
      x: 14,
      y: bottomBarTop + bucketRowH,
      w: W - 28,
      h: propRowH,
    };

    const gap = 12;
    const btnW = Math.min(76, Math.floor((propRowRect.w - gap * 3) / 4));
    const btnH = Math.min(48, propRowRect.h - 6);
    const totalPropW = btnW * 4 + gap * 3;
    const propStartX = Math.round((W - totalPropW) * 0.5);
    const btnY = propRowRect.y + Math.floor((propRowRect.h - btnH) * 0.5);

    const propButtons: [Rect, Rect, Rect, Rect] = [
      { x: propStartX, y: btnY, w: btnW, h: btnH },
      { x: propStartX + (btnW + gap), y: btnY, w: btnW, h: btnH },
      { x: propStartX + (btnW + gap) * 2, y: btnY, w: btnW, h: btnH },
      { x: propStartX + (btnW + gap) * 3, y: btnY, w: btnW, h: btnH },
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
