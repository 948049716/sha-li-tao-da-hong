import chapter01Json from '../../data/levels/chapter_01.json';
import vesselsJson from '../../data/vessels.json';
import type { ChapterFile, LevelConfig, VesselCatalog } from '../types/level';

/**
 * 关卡加载与纯序号章节列表管理（01~20，无冗余文字标题）
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

  public formatOrdinal(levelId: number): string {
    return String(levelId).padStart(2, '0');
  }
}
