import type { IPlatformBridge } from '../platform/PlatformBridge';
import type { IRemoteSyncAdapter } from '../platform/sync/IRemoteSyncAdapter';
import type { PlayerSaveData } from '../types/save';
import type { RankBadgeDef, UiTokensFile } from '../types/ui';

const SAVE_STORAGE_KEY = 'slt_player_save_v1';

export function getTodayDateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function createDefaultSaveData(): PlayerSaveData {
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    currentLevel: 1,
    maxClearedLevel: 0,
    replayedClearCount: 0,
    totalNetWorth: 0,
    ownedMap: {},
    shards: 0,
    pityGoldCount: 0,
    pityRedCount: 0,
    ftueFirstBoxOpened: false,
    unlockedSkins: [],
    equippedSkinId: null,
    unlockedSuctionFx: [],
    equippedSuctionFxId: null,
    dailyFreeRewardDate: getTodayDateString(),
    dailyFreeRewardUsed: 0,
    settings: {
      soundOn: true,
      vibrateOn: true,
    },
  };
}

/**
 * 确定性保高合并（Offline-First 防掉档，对齐《技术选型与架构设计文档》§3.5）
 */
export function mergeSaveData(local: PlayerSaveData, cloud: PlayerSaveData): PlayerSaveData {
  const newer = (cloud.updatedAt || 0) > (local.updatedAt || 0) ? cloud : local;
  const mergedOwned: Record<string, number> = { ...local.ownedMap };
  for (const [figId, cnt] of Object.entries(cloud.ownedMap || {})) {
    mergedOwned[figId] = Math.max(mergedOwned[figId] || 0, cnt || 0);
  }
  const skinSet = new Set([...(local.unlockedSkins || []), ...(cloud.unlockedSkins || [])]);
  const fxSet = new Set([...(local.unlockedSuctionFx || []), ...(cloud.unlockedSuctionFx || [])]);

  return {
    schemaVersion: 1,
    updatedAt: Math.max(local.updatedAt || 0, cloud.updatedAt || 0, Date.now()),
    currentLevel: Math.max(local.currentLevel || 1, cloud.currentLevel || 1),
    maxClearedLevel: Math.max(local.maxClearedLevel || 0, cloud.maxClearedLevel || 0),
    replayedClearCount: Math.max(local.replayedClearCount || 0, cloud.replayedClearCount || 0),
    totalNetWorth: Math.max(local.totalNetWorth || 0, cloud.totalNetWorth || 0),
    ownedMap: mergedOwned,
    shards: newer.shards ?? local.shards,
    pityGoldCount: newer.pityGoldCount ?? local.pityGoldCount,
    pityRedCount: newer.pityRedCount ?? local.pityRedCount,
    ftueFirstBoxOpened: Boolean(local.ftueFirstBoxOpened || cloud.ftueFirstBoxOpened),
    unlockedSkins: [...skinSet],
    equippedSkinId: newer.equippedSkinId ?? local.equippedSkinId,
    unlockedSuctionFx: [...fxSet],
    equippedSuctionFxId: newer.equippedSuctionFxId ?? local.equippedSuctionFxId,
    dailyFreeRewardDate: newer.dailyFreeRewardDate || getTodayDateString(),
    dailyFreeRewardUsed: newer.dailyFreeRewardUsed ?? 0,
    settings: { ...newer.settings },
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
        ownedMap: { ...(parsed.ownedMap || {}) },
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

  /**
   * 本地毫秒级同步落盘（防强退刷盒），并按 5s 节流异步推送云端
   */
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

  public getOwnedUniqueCount(): number {
    return Object.values(this.data.ownedMap).filter(v => v > 0).length;
  }

  public getRankBadge(tokens: UiTokensFile): RankBadgeDef {
    let best = tokens.rankBadges[0];
    for (const rb of tokens.rankBadges) {
      if (this.data.totalNetWorth >= rb.minNetWorth) {
        best = rb;
      }
    }
    return best;
  }
}
