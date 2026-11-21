import type { IPlatformBridge } from '../platform/PlatformBridge';
import type { IRemoteSyncAdapter } from '../platform/sync/IRemoteSyncAdapter';
import type { Rect } from '../types/ui';
import type { UserProfile } from '../types/save';
import type { SaveManager } from './SaveManager';

const PROFILE_STORAGE_KEY = 'slt_user_profile_v1';

/**
 * 微信静默登录 + 藏馆按需 UserInfoButton 授权生命周期服务
 * 合规红线：首屏零授权弹窗直进第 1 关；退出藏馆立即销毁透明按钮防点击穿透
 */
export class AuthService {
  public profile: UserProfile;
  private platform: IPlatformBridge;
  private remote: IRemoteSyncAdapter;
  private saveMgr: SaveManager;

  constructor(platform: IPlatformBridge, remote: IRemoteSyncAdapter, saveMgr: SaveManager) {
    this.platform = platform;
    this.remote = remote;
    this.saveMgr = saveMgr;
    this.profile = this.loadLocalProfile();
  }

  private loadLocalProfile(): UserProfile {
    const raw = this.platform.getStorage(PROFILE_STORAGE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as UserProfile;
      } catch {
        // fallback below
      }
    }
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    const init: UserProfile = {
      openid: `local_${suffix}`,
      nickName: `摸金新人_${suffix}`,
      avatarUrl: '',
      isAuthorized: false,
    };
    this.platform.setStorage(PROFILE_STORAGE_KEY, JSON.stringify(init));
    return init;
  }

  private persistProfile(): void {
    this.platform.setStorage(PROFILE_STORAGE_KEY, JSON.stringify(this.profile));
  }

  public async silentLoginAndSync(): Promise<void> {
    const res = await this.remote.login();
    if (!res) return;
    if (res.openid) {
      this.profile.openid = res.openid;
    }
    if (res.profile?.isAuthorized && res.profile.nickName) {
      this.profile.nickName = res.profile.nickName;
      this.profile.avatarUrl = res.profile.avatarUrl || '';
      this.profile.isAuthorized = true;
    }
    this.persistProfile();
    if (res.cloudSave) {
      this.saveMgr.mergeFromCloud(res.cloudSave);
    }
  }

  public mountAuthButtonInGallery(rect: Rect, onUpdated: () => void): void {
    if (this.profile.isAuthorized) {
      this.platform.destroyUserInfoButton();
      return;
    }
    this.platform.mountUserInfoButton(rect, info => {
      this.profile.nickName = info.nickName;
      this.profile.avatarUrl = info.avatarUrl;
      this.profile.isAuthorized = true;
      this.persistProfile();
      void this.remote.updateProfile(info);
      onUpdated();
    });
  }

  public unmountAuthButton(): void {
    this.platform.destroyUserInfoButton();
  }
}
