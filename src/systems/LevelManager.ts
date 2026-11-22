import chapter01Json from '../../data/levels/chapter_01.json';
import vesselsJson from '../../data/vessels.json';
import type { ChapterFile, LevelConfig, VesselCatalog } from '../types/level';

/**
 * 关卡加载、新机关非阻塞微提示文案与关卡列表管理
 */
export class LevelManager {
  public readonly chapter: ChapterFile = chapter01Json as unknown as ChapterFile;
  public readonly vessels: VesselCatalog = vesselsJson as unknown as VesselCatalog;
  public readonly levels: LevelConfig[];

  constructor() {
    this.levels = this.chapter.levels;
  }

  public get totalLevels(): number {
    return this.levels.length;
  }

  public getLevel(levelId: number): LevelConfig {
    const clamped = Math.max(1, Math.min(this.levels.length, levelId));
    return this.levels.find(l => l.levelId === clamped) || this.levels[0];
  }

  /**
   * PRD §6.2 界面三：新机关首次登场顶部非阻塞横幅（4 秒自动淡出）
   */
  public getMechanicBannerForLevel(levelId: number): string | null {
    switch (levelId) {
      case 2:
        return '💡 侧仓借道：目标沙被挡在上方？先借斜坡把拦路沙导入侧仓暂存！';
      case 3:
        return '🚧 推入式闸门：点击虚线导槽【先推入关门】拦截异色沙，稍后再拉开！';
      case 4:
        return '⚙️ 联动双栓：带绳索齿轮的两块木板会同时抽动，注意提前设防！';
      case 5:
        return '🔒 颜色锁门：装满对应颜色的接沙桶，同色锁门就会自动弹开！';
      case 6:
        return '🧊 冰冻沙砖：先排空障碍腾出落差，再抽板让冰砖坠落摔碎！';
      case 8:
        return '🌀 选路染色魔环：盘面没有绿沙？引导粉沙穿过魔环染成绿色！';
      default:
        return null;
    }
  }
}
