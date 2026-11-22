import type { IPlatformBridge } from '../platform/PlatformBridge';
import type { SaveManager } from './SaveManager';

export type RewardScene = 'EXTRA_SLOT' | 'VACUUM' | 'UNDO' | 'SHUFFLE' | 'REROLL_BOX' | 'BONUS_BOX';
export type RewardMode = 'COLD_START_FREE_SHARE' | 'WX_REWARD_AD';

const SHARE_TITLES = [
  '救命！这罐流沙快溢出来了，帮我抽块板！',
  '差一点就挖到底层金盲盒了，快来帮把手！',
  '超解压流沙挖盲盒！看看你能淘出几件千万级大红？',
];

/**
 * 纯 IAA 统一激励发放器（v1.0 冷启动每日 3 次免费秒领 + 无限分享，一键平滑切换流量主激励视频）
 * 严格遵循 PRD §2.5
 */
export class RewardManager {
  public static readonly DAILY_FREE_LIMIT = 3;
  private platform: IPlatformBridge;
  private saveMgr: SaveManager;
  private mode: RewardMode = 'COLD_START_FREE_SHARE';
  private adUnitId = '';
  private busy = false;

  constructor(platform: IPlatformBridge, saveMgr: SaveManager) {
    this.platform = platform;
    this.saveMgr = saveMgr;
  }

  public setMode(mode: RewardMode, adUnitId = ''): void {
    this.mode = mode;
    this.adUnitId = adUnitId;
  }

  public getFreeRemaining(): number {
    this.saveMgr.refreshDailyQuotaIfNeeded();
    return Math.max(0, RewardManager.DAILY_FREE_LIMIT - this.saveMgr.data.dailyFreeRewardUsed);
  }

  public getBadgeSpec(exhaustedForLevel = false): { text: string; bgHex: string } {
    if (exhaustedForLevel) {
      return { text: '已满', bgHex: '#9CA3AF' };
    }
    const rem = this.getFreeRemaining();
    if (rem > 0) {
      return { text: `免费${rem}/${RewardManager.DAILY_FREE_LIMIT}`, bgHex: '#10B981' };
    }
    if (this.mode === 'WX_REWARD_AD') {
      return { text: '🎬视频', bgHex: '#D97706' };
    }
    return { text: '分享领', bgHex: '#0284C7' };
  }

  public async requestReward(scene: RewardScene): Promise<{ granted: boolean; via: 'free' | 'share' | 'ad' | 'busy' }> {
    if (this.busy) return { granted: false, via: 'busy' };
    this.busy = true;
    try {
      const rem = this.getFreeRemaining();
      if (rem > 0) {
        this.saveMgr.data.dailyFreeRewardUsed++;
        this.saveMgr.saveNow(true);
        return { granted: true, via: 'free' };
      }

      if (this.mode === 'WX_REWARD_AD' && this.adUnitId) {
        const adOk = await this.platform.showRewardedVideoAd(this.adUnitId);
        if (adOk) return { granted: true, via: 'ad' };
        // 无广告填充时优雅降级为分享解锁，绝不卡死玩家
      }

      const title = SHARE_TITLES[Math.floor(Math.random() * SHARE_TITLES.length)];
      const shared = await this.platform.shareAppMessage({
        title,
        imageUrl: 'assets/ui/bg/ui_bg_splash.png',
        query: `scene=${scene}`,
      });
      return { granted: shared, via: 'share' };
    } finally {
      this.busy = false;
    }
  }
}
