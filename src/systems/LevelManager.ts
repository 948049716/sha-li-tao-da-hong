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
      case 4:
        return '💡 新增斜坡导流板：流沙会顺着斜板滑向指定方向哦';
      case 11:
        return '🧊 冰冻沙砖：先排空下方沙子腾出高度，再抽板让冰砖坠地摔碎！';
      case 16:
        return '🔒 颜色锁门：装满对应颜色的接沙桶，锁门就会自动弹开！';
      case 19:
        return '🌀 染色魔环：流沙穿过圆环会自动变成圆环的颜色！';
      default:
        return null;
    }
  }
}
