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
  /** 顶栏三枚组件：左侧羊皮纸序号胶囊 [⊞ 08] | 右侧两枚圆木牌 [?] [↻] */
  settingsPill: Rect;
  guidePill: Rect;
  restartPill: Rect;
  chamberRect: Rect;
  /** 实木工作台区域（含上层 4+1 圆盘底座接沙位 + 下层 4 条深木凹槽候选瓶区） */
  bucketRowRect: Rect;
  /** 工作台第 1 层：4+1 圆形底座接沙瓶位 */
  slotRowRect: Rect;
  activeSlotRects: [Rect, Rect, Rect, Rect, Rect];
  /** 工作台第 2 层：3~4 条纵深木凹槽候选软木塞玻璃瓶区（近景下端为列首） */
  candidateAreaRect: Rect;
  /** 桌沿下方深棕暗影道具栏区域 */
  propRowRect: Rect;
  propButtons: [Rect, Rect, Rect, Rect]; // 4 枚暖奶油手绘圆角方卡：撤回 / 磁吸 / +瓶位 / 洗牌
}

/**
 * 严格对齐《星夜流沙瓶》UI 设计图（docs/assets/gameplay_ref.jpg）的竖屏五段式几何计算器：
 * 1. 顶栏置于微信右上角官方胶囊正下方 5px，保持左 [⊞ 08] 与右 [?][↻] 左右贴边对称构图
 * 2. 玻璃沙箱下方预留 16~32px 星夜流光净空，让发光 S 曲线流沙粒子束自然飘入敞口玻璃瓶
 * 3. 温暖实木工作台承载 4+1 圆形杯托与 4 条近大远小木凹槽候选瓶列
 * 4. 桌下深棕底栏居中排布 4 枚暖奶油圆角方卡道具钮
 */
export class LayoutManager {
  public compute(metrics: ViewportMetrics): ComputedLayout {
    const W = metrics.width;
    const H = metrics.height;
    const menu = metrics.menuButtonRect;

    const shortScreen = H / W < 1.85;

    const topHudY = menu.y + menu.h + 5;
    const topHudH = shortScreen ? 36 : 40;
    const padX = 12;
    const topHudMaxRight = W - padX;

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
    const settingsW = Math.min(96, Math.max(82, guidePill.x - gapTop - padX));
    const settingsPill: Rect = {
      x: padX,
      y: topHudY,
      w: settingsW,
      h: topHudH,
    };

    const slotRowH = shortScreen ? 60 : 72;
    const candidateAreaH = shortScreen ? 124 : 172;
    const bucketRowH = slotRowH + candidateAreaH;
    const propRowH = shortScreen ? 54 : 66;
    const bottomTotalH = bucketRowH + propRowH + metrics.safeBottom + 4;
    const bottomBarTop = H - bottomTotalH;

    // 预留沙箱底口至敞口玻璃瓶星夜流沙 S 曲线光带净空
    const streamAirGap = shortScreen ? 20 : 38;
    const chamberTopBound = topHudY + topHudH + 6;
    const chamberAvailH = Math.max(198, bottomBarTop - streamAirGap - chamberTopBound);

    let sandW = Math.min(W * 0.86, chamberAvailH * (GW / GH));
    if (sandW < W * 0.72) {
      sandW = Math.min(W * 0.86, (bottomBarTop - 15 - chamberTopBound) * (GW / GH));
    }
    const sandH = Math.min(bottomBarTop - 14 - chamberTopBound, sandW * (GH / GW));
    sandW = sandH * (GW / GH);

    const chamberX = Math.round((W - sandW) * 0.5);
    const chamberY = chamberTopBound;

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
    const slotW = Math.min(68, Math.floor((slotRowRect.w - slotGap * 4) / 5));
    const slotH = slotRowH - 2;
    const totalSlotsW = slotW * 5 + slotGap * 4;
    const slotsStartX = Math.round((W - totalSlotsW) * 0.5);
    const slotY = slotRowRect.y + 1;
    const activeSlotRects: [Rect, Rect, Rect, Rect, Rect] = [
      { x: slotsStartX, y: slotY, w: slotW, h: slotH },
      { x: slotsStartX + (slotW + slotGap), y: slotY, w: slotW, h: slotH },
      { x: slotsStartX + (slotW + slotGap) * 2, y: slotY, w: slotW, h: slotH },
      { x: slotsStartX + (slotW + slotGap) * 3, y: slotY, w: slotW, h: slotH },
      { x: slotsStartX + (slotW + slotGap) * 4, y: slotY, w: slotW, h: slotH },
    ];

    // 去除木凹槽后开放式宽幅桌面候选瓶区，单瓶更宽大易点且上下零重叠
    const candidateAreaRect: Rect = {
      x: 14,
      y: bottomBarTop + slotRowH,
      w: W - 28,
      h: candidateAreaH,
    };

    const propRowY = bottomBarTop + bucketRowH;
    const propRowRect: Rect = {
      x: 0,
      y: propRowY,
      w: W,
      h: propRowH + metrics.safeBottom + 4,
    };

    // 居中排布 4 枚日系和纸圆角方卡道具钮
    const btnGap = 13;
    const btnH = propRowH - 13;
    const btnW = Math.min(btnH + 2, Math.floor((W - 68 - btnGap * 3) / 4));
    const totalBtnsW = btnW * 4 + btnGap * 3;
    const btnStartX = Math.round((W - totalBtnsW) * 0.5);
    const btnY = propRowY + 7;
    const propButtons: [Rect, Rect, Rect, Rect] = [
      { x: btnStartX, y: btnY, w: btnW, h: btnH },
      { x: btnStartX + (btnW + btnGap), y: btnY, w: btnW, h: btnH },
      { x: btnStartX + (btnW + btnGap) * 2, y: btnY, w: btnW, h: btnH },
      { x: btnStartX + (btnW + btnGap) * 3, y: btnY, w: btnW, h: btnH },
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
