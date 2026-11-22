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
        return '🪣 排桶诀窍：借小卡槽暂存前排桶挖出后排，切勿抢放上沙活埋滤网！';
      case 3:
        return '🔗 双栓规则：麻绳滑轮相连的两块木栓会同步拉开';
      case 4:
        return '🧊 脆冰规则：须清空下方软沙垫，高空直砸硬滤网才会摔碎！';
      case 5:
        return '🔒 颜色锁规则：装满同色木桶瞬间，对应颜色锁自动崩开';
      case 7:
        return '❓ 问号盲桶：排走前排木桶瞬间，后排盲桶将自动翻牌显露真色！';
      case 8:
        return '🌀 染色环与斜桥：彩沙穿环永久改色，抽断斜木桥即可保住原色';
      case 11:
        return '❄️ 冰封木桶：每装满清走任意 1 只木桶，候选冰桶同步震裂 1 层寒冰！';
      default:
        return null;
    }
  }
}
