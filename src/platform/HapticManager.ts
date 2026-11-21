import audioHapticsData from '../../data/audio_haptics.json';
import type { IPlatformBridge } from './PlatformBridge';

type HapticStep = { delayMs: number; type: 'light' | 'medium' | 'heavy' };

/**
 * 微信三级触觉震动反馈封装（严格对齐 data/audio_haptics.json）
 */
export class HapticManager {
  private platform: IPlatformBridge;
  private enabled = true;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private patterns: Record<string, HapticStep[]>;
  private eventMap = new Map<string, string>();

  constructor(platform: IPlatformBridge) {
    this.platform = platform;
    this.patterns = audioHapticsData.hapticPatterns as Record<string, HapticStep[]>;
    for (const b of audioHapticsData.eventBindings) {
      this.eventMap.set(b.event, b.haptic);
    }
  }

  public setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.cancelAll();
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public cancelAll(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  public triggerPattern(patternName: string): void {
    if (!this.enabled) return;
    const steps = this.patterns[patternName];
    if (!steps || steps.length === 0) return;

    for (const step of steps) {
      if (step.delayMs <= 0) {
        this.platform.vibrateShort(step.type);
      } else {
        const timer = setTimeout(() => {
          if (this.enabled) this.platform.vibrateShort(step.type);
        }, step.delayMs);
        this.timers.push(timer);
      }
    }
  }

  public triggerForEvent(eventName: string): void {
    const pattern = this.eventMap.get(eventName);
    if (pattern) {
      this.triggerPattern(pattern);
    }
  }
}
