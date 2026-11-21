import type { PlayerSaveData, UserProfile } from '../../types/save';

export interface RemoteLoginResponse {
  openid: string;
  profile?: Partial<UserProfile>;
  cloudSave?: PlayerSaveData | null;
}

export interface IRemoteSyncAdapter {
  login(): Promise<RemoteLoginResponse | null>;
  syncSave(save: PlayerSaveData): Promise<boolean>;
  updateProfile(profile: Pick<UserProfile, 'nickName' | 'avatarUrl'>): Promise<boolean>;
}
