export interface UserProfile {
  openid: string;
  nickName: string;
  avatarUrl: string;
  isAuthorized: boolean;
}

export interface PlayerSaveData {
  schemaVersion: 2;
  updatedAt: number;
  currentLevel: number;
  maxClearedLevel: number;
  totalClears: number;
  winStreak: number;
  bestTimeSecMap: Record<number, number>;
  dailyFreeRewardDate: string;
  dailyFreeRewardUsed: number;
  /** 已完成展示的新道具 / 新机关聚光手势指引 key 集合 */
  seenGuides: string[];
  settings: {
    soundOn: boolean;
    vibrateOn: boolean;
  };
}
