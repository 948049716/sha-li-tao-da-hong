import type { IPlatformBridge } from '../platform/PlatformBridge';
import type { IRemoteSyncAdapter } from '../platform/sync/IRemoteSyncAdapter';
import type { PlayerSaveData } from '../types/save';

const SAVE_STORAGE_KEY = 'slt_player_save_v2';

export function getTodayDateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function createDefaultSaveData(): PlayerSaveData {
  return {
    schemaVersion: 2,
    updatedAt: Date.now(),
    currentLevel: 1,
    maxClearedLevel: 0,
    totalClears: 0,
    winStreak: 0,
    bestTimeSecMap: {},
    dailyFreeRewardDate: getTodayDateString(),
    dailyFreeRewardUsed: 0,
    settings: {
      soundOn: true,
      vibrateOn: true,
    },
  };
}

/**
 * 确定性保高合并（Offline-First 防掉档）
 */
export function mergeSaveData(local: PlayerSaveData, cloud: PlayerSaveData): PlayerSaveData {
  const newer = (cloud.updatedAt || 0) > (local.updatedAt || 0) ? cloud : local;
  const bestTimeSecMap: Record<number, number> = { ...(local.bestTimeSecMap || {}) };
  for (const [lvl, sec] of Object.entries(cloud.bestTimeSecMap || {})) {
    const id = Number(lvl);
    if (!Number.isFinite(id) || typeof sec !== 'number' || sec <= 0) continue;
    const prev = bestTimeSecMap[id];
    bestTimeSecMap[id] = prev && prev > 0 ? Math.min(prev, sec) : sec;
  }

  return {
    schemaVersion: 2,
    updatedAt: Math.max(local.updatedAt || 0, cloud.updatedAt || 0, Date.now()),
    currentLevel: Math.max(local.currentLevel || 1, cloud.currentLevel || 1),
    maxClearedLevel: Math.max(local.maxClearedLevel || 0, cloud.maxClearedLevel || 0),
    totalClears: Math.max(local.totalClears || 0, cloud.totalClears || 0),
    winStreak: newer.winStreak ?? local.winStreak ?? 0,
    bestTimeSecMap,
    dailyFreeRewardDate: newer.dailyFreeRewardDate || getTodayDateString(),
    dailyFreeRewardUsed: newer.dailyFreeRewardUsed ?? 0,
    settings: {
      soundOn: newer.settings?.soundOn ?? true,
      vibrateOn: newer.settings?.vibrateOn ?? true,
    },
  };
}

export class SaveManager {
  public data: PlayerSaveData;
  private platform: IPlatformBridge;
  private remote: IRemoteSyncAdapter;
  private lastRemoteSyncMs = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  public lastCloudSyncStatus: 'local' | 'syncing' | 'synced' = 'local';

  constructor(platform: IPlatformBridge, remote: IRemoteSyncAdapter) {
    this.platform = platform;
    this.remote = remote;
    this.data = this.loadLocal();
    this.refreshDailyQuotaIfNeeded();
  }

  private loadLocal(): PlayerSaveData {
    const raw = this.platform.getStorage(SAVE_STORAGE_KEY);
    if (!raw) return createDefaultSaveData();
    try {
      const parsed = JSON.parse(raw) as Partial<PlayerSaveData>;
      const base = createDefaultSaveData();
      return {
        ...base,
        ...parsed,
        schemaVersion: 2,
        bestTimeSecMap: { ...(parsed.bestTimeSecMap || {}) },
        settings: {
          soundOn: parsed.settings?.soundOn ?? true,
          vibrateOn: parsed.settings?.vibrateOn ?? true,
        },
      };
    } catch {
      return createDefaultSaveData();
    }
  }

  public refreshDailyQuotaIfNeeded(): void {
    const today = getTodayDateString();
    if (this.data.dailyFreeRewardDate !== today) {
      this.data.dailyFreeRewardDate = today;
      this.data.dailyFreeRewardUsed = 0;
      this.saveNow(false);
    }
  }

  public recordLevelClear(levelId: number, clearTimeSec: number): { isNewBest: boolean } {
    const rounded = Math.max(0.1, Math.round(clearTimeSec * 10) / 10);
    if (levelId > this.data.maxClearedLevel) {
      this.data.maxClearedLevel = levelId;
    }
    this.data.totalClears++;
    this.data.winStreak++;
    const prevBest = this.data.bestTimeSecMap[levelId];
    const isNewBest = !prevBest || rounded < prevBest;
    if (isNewBest) {
      this.data.bestTimeSecMap[levelId] = rounded;
    }
    return { isNewBest };
  }

  public saveNow(syncCloud = true): void {
    this.data.updatedAt = Date.now();
    this.platform.setStorage(SAVE_STORAGE_KEY, JSON.stringify(this.data));
    if (syncCloud) {
      this.scheduleCloudSync();
    }
  }

  public mergeFromCloud(cloudSave: PlayerSaveData): void {
    this.data = mergeSaveData(this.data, cloudSave);
    this.saveNow(false);
    this.lastCloudSyncStatus = 'synced';
  }

  private scheduleCloudSync(): void {
    const elapsed = Date.now() - this.lastRemoteSyncMs;
    if (elapsed >= 5000) {
      void this.flushCloudSync();
    } else if (!this.pendingTimer) {
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        void this.flushCloudSync();
      }, 5000 - elapsed);
    }
  }

  public async flushCloudSync(): Promise<boolean> {
    this.lastRemoteSyncMs = Date.now();
    this.lastCloudSyncStatus = 'syncing';
    const ok = await this.remote.syncSave(this.data);
    this.lastCloudSyncStatus = ok ? 'synced' : 'local';
    return ok;
  }

  public resetAllForDebug(): void {
    this.data = createDefaultSaveData();
    this.saveNow(false);
  }
}
