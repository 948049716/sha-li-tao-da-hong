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
  settings: {
    soundOn: boolean;
    vibrateOn: boolean;
  };
}
