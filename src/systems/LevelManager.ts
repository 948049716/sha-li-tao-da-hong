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
        return '⚙️ 活门规则：黄铜虚线活门可反复点击【推入关 / 拉出开】';
      case 3:
        return '⚙️ 双栓规则：麻绳滑轮相连的两块木板会同步触发';
      case 4:
        return '🧊 脆冰规则：须高空直砸【裸露硬底】才碎，落在沙上缓冲不碎';
      case 5:
        return '🔒 锁门规则：装满同色桶瞬间，对应颜色锁会自动弹开';
      case 6:
        return '❄️ 寒冰规则：摔不碎！须引流沙从冰面滑过冲刷才能融化';
      case 8:
        return '🌀 魔环规则：指定流沙穿过圆环会永久染成环色';
      default:
        return null;
    }
  }
}
