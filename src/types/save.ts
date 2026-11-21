export interface UserProfile {
  openid: string;
  nickName: string;
  avatarUrl: string;
  isAuthorized: boolean;
}

export interface PlayerSaveData {
  schemaVersion: 1;
  updatedAt: number;
  currentLevel: number;
  maxClearedLevel: number;
  replayedClearCount: number;
  totalNetWorth: number;
  ownedMap: Record<string, number>;
  shards: number;
  pityGoldCount: number;
  pityRedCount: number;
  ftueFirstBoxOpened: boolean;
  unlockedSkins: string[];
  equippedSkinId: string | null;
  unlockedSuctionFx: string[];
  equippedSuctionFxId: string | null;
  dailyFreeRewardDate: string;
  dailyFreeRewardUsed: number;
  settings: {
    soundOn: boolean;
    vibrateOn: boolean;
  };
}
