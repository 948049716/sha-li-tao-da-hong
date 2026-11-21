import type { PlayerSaveData, UserProfile } from '../../types/save';
import type { IRemoteSyncAdapter, RemoteLoginResponse } from './IRemoteSyncAdapter';

/**
 * 微信云开发（CloudBase）存档同步适配器 + 浏览器离线无感降级
 */
export class WxCloudSyncAdapter implements IRemoteSyncAdapter {
  private cloudReady = false;

  constructor(envId?: string) {
    const wxGlobal = typeof wx !== 'undefined' ? wx : undefined;
    if (wxGlobal?.cloud) {
      try {
        wxGlobal.cloud.init({
          env: envId || undefined,
          traceUser: true,
        });
        this.cloudReady = true;
      } catch {
        this.cloudReady = false;
      }
    }
  }

  public async login(): Promise<RemoteLoginResponse | null> {
    const wxGlobal = typeof wx !== 'undefined' ? wx : undefined;
    if (!this.cloudReady || !wxGlobal?.cloud) {
      return null;
    }
    try {
      const res = await wxGlobal.cloud.callFunction({ name: 'login' });
      return (res?.result as RemoteLoginResponse) || null;
    } catch {
      return null;
    }
  }

  public async syncSave(save: PlayerSaveData): Promise<boolean> {
    const wxGlobal = typeof wx !== 'undefined' ? wx : undefined;
    if (!this.cloudReady || !wxGlobal?.cloud) {
      return false;
    }
    try {
      await wxGlobal.cloud.callFunction({
        name: 'syncSave',
        data: { save },
      });
      return true;
    } catch {
      return false;
    }
  }

  public async updateProfile(
    profile: Pick<UserProfile, 'nickName' | 'avatarUrl'>
  ): Promise<boolean> {
    const wxGlobal = typeof wx !== 'undefined' ? wx : undefined;
    if (!this.cloudReady || !wxGlobal?.cloud) {
      return false;
    }
    try {
      await wxGlobal.cloud.callFunction({
        name: 'updateProfile',
        data: profile,
      });
      return true;
    } catch {
      return false;
    }
  }
}
