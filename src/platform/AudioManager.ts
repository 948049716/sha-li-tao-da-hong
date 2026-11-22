import audioHapticsData from '../../data/audio_haptics.json';
import type { IPlatformBridge } from './PlatformBridge';

/**
 * WebAudio 实时合成 ASMR + 23 项事件音效混合调度器
 * 对齐 data/audio_haptics.json 参数（零音频包体阻塞，支持切前后台静音与开箱 Ducking）
 */
export class AudioManager {
  private platform: IPlatformBridge;
  private ctx: AudioContext | null = null;
  private sfxMaster: GainNode | null = null;
  private sandNoiseGain: GainNode | null = null;
  private sandFilter: BiquadFilterNode | null = null;
  private noiseStarted = false;
  private enabled = true;
  private cooldownMap = new Map<string, number>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private readonly pentatonicHz = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
  private readonly goldShimmerHz = [1318.51, 1567.98, 1975.53, 2637.02];

  constructor(platform: IPlatformBridge) {
    this.platform = platform;
  }

  public setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.stopHeartbeat();
      if (this.sandNoiseGain && this.ctx) {
        this.sandNoiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
      }
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public unlockAndResume(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      this.ctx = this.platform.createAudioContext();
      if (this.ctx) {
        this.sfxMaster = this.ctx.createGain();
        this.sfxMaster.gain.value = audioHapticsData.mixer.masterSfxGain;
        this.sfxMaster.connect(this.ctx.destination);
        this.initSandNoiseGraph();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public suspend(): void {
    this.stopHeartbeat();
    if (this.sandNoiseGain && this.ctx) {
      this.sandNoiseGain.gain.value = 0;
    }
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  private initSandNoiseGraph(): void {
    if (!this.ctx || !this.sfxMaster || this.noiseStarted) return;
    try {
      const sampleRate = this.ctx.sampleRate;
      const length = sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2000;
      filter.Q.value = 1.8;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxMaster);
      src.start();

      this.sandFilter = filter;
      this.sandNoiseGain = gain;
      this.noiseStarted = true;
    } catch {
      // Headless browser without audio device fallback
    }
  }

  /**
   * 每帧根据流沙活跃度平滑调制带通白噪音 ASMR（0 KB 包体）
   */
  public updateSandFlow(flowParticles: number): void {
    if (!this.ctx || !this.sandNoiseGain || !this.sandFilter) return;
    const now = this.ctx.currentTime;
    if (!this.enabled || flowParticles <= 0) {
      this.sandNoiseGain.gain.setTargetAtTime(0, now, 0.06);
      return;
    }
    const ratio = Math.min(1, flowParticles / 35);
    const freq = 1800 + ratio * 1800;
    const targetGain = ratio * 0.24;
    this.sandFilter.frequency.setTargetAtTime(freq, now, 0.06);
    this.sandNoiseGain.gain.setTargetAtTime(targetGain, now, 0.06);
  }

  private canTrigger(key: string, cooldownMs: number): boolean {
    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const prev = this.cooldownMap.get(key) || 0;
    if (now - prev < cooldownMs) return false;
    this.cooldownMap.set(key, now);
    return true;
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    durationSec: number,
    type: OscillatorType = 'triangle',
    peakGain = 0.2,
    delaySec = 0
  ): void {
    if (!this.enabled) return;
    this.unlockAndResume();
    if (!this.ctx || !this.sfxMaster) return;

    try {
      const t0 = this.ctx.currentTime + delaySec;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, t0);
      if (freqEnd !== freqStart) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t0 + durationSec);
      }
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(peakGain, t0 + Math.min(0.015, durationSec * 0.25));
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + durationSec);

      osc.connect(gain);
      gain.connect(this.sfxMaster);
      osc.start(t0);
      osc.stop(t0 + durationSec + 0.02);
    } catch {
      // ignore audio scheduling issues
    }
  }

  public playPentatonicStep(stepIdx: number): void {
    if (!this.canTrigger('pentatonic', 60)) return;
    const hz = this.pentatonicHz[Math.max(0, Math.min(this.pentatonicHz.length - 1, stepIdx))];
    this.playTone(hz, hz * 1.01, 0.11, 'triangle', 0.18);
  }

  public playGoldShimmer(): void {
    if (!this.canTrigger('gold_shimmer', 70)) return;
    const hz = this.goldShimmerHz[Math.floor(Math.random() * this.goldShimmerHz.length)];
    this.playTone(hz, hz * 1.02, 0.095, 'sine', 0.13);
  }

  public startHeartbeat(isRed: boolean): void {
    this.stopHeartbeat();
    if (!this.enabled) return;
    let beat = 0;
    const intervalMs = isRed ? 390 : 460;
    const triggerBeat = (): void => {
      beat++;
      const boost = 1 + beat * 0.08;
      this.playTone(95 * boost, 52, 0.14, 'sine', 0.28, 0);
      this.playTone(118 * boost, 62, 0.12, 'sine', 0.22, 0.13);
    };
    triggerBeat();
    this.heartbeatTimer = setInterval(triggerBeat, intervalMs);
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public playEvent(eventName: string): void {
    if (!this.enabled) return;
    switch (eventName) {
      case 'UI_BUTTON_TAP':
        if (this.canTrigger(eventName, 40)) this.playTone(460, 290, 0.06, 'triangle', 0.16);
        break;
      case 'BOARD_PULL':
        if (this.canTrigger(eventName, 50)) {
          this.playTone(320, 680, 0.12, 'triangle', 0.22);
          this.playTone(760, 980, 0.07, 'sine', 0.1, 0.04);
        }
        break;
      case 'BOARD_TAP_LOCKED':
        if (this.canTrigger(eventName, 180)) {
          this.playTone(190, 145, 0.08, 'square', 0.12);
          this.playTone(170, 130, 0.09, 'square', 0.1, 0.09);
        }
        break;
      case 'LOCK_AUTO_BREAK':
      case 'PROP_EXTRA_SLOT':
        if (this.canTrigger(eventName, 100)) {
          this.playTone(587.33, 880, 0.14, 'triangle', 0.22);
          this.playTone(1174.66, 1567.98, 0.2, 'sine', 0.16, 0.08);
        }
        break;
      case 'DYE_RING_PASS':
        if (this.canTrigger(eventName, 150)) {
          this.playTone(680, 1020, 0.1, 'sine', 0.11);
        }
        break;
      case 'ICE_BLOCK_SHATTER':
        if (this.canTrigger(eventName, 120)) {
          this.playTone(1240, 420, 0.16, 'sawtooth', 0.14);
          this.playTone(1760, 880, 0.14, 'triangle', 0.15, 0.04);
        }
        break;
      case 'BUCKET_FULL_SWAP':
        if (this.canTrigger(eventName, 80)) {
          this.playTone(523.25, 659.25, 0.12, 'triangle', 0.22, 0);
          this.playTone(659.25, 783.99, 0.14, 'triangle', 0.22, 0.07);
          this.playTone(1046.5, 1046.5, 0.22, 'sine', 0.2, 0.14);
        }
        break;
      case 'CAPSULE_INTO_BAG':
        if (this.canTrigger(eventName, 80)) {
          this.playTone(440, 987.77, 0.22, 'sine', 0.18);
        }
        break;
      case 'CLOG_WARNING_SHOW':
        if (this.canTrigger(eventName, 2000)) {
          this.playTone(392, 392, 0.14, 'triangle', 0.18, 0);
          this.playTone(329.63, 329.63, 0.2, 'triangle', 0.18, 0.15);
        }
        break;
      case 'PROP_VACUUM_CLEAN':
        if (this.canTrigger(eventName, 300)) {
          this.playTone(240, 760, 0.36, 'sine', 0.2);
          this.playTone(880, 1174, 0.12, 'triangle', 0.18, 0.34);
        }
        break;
      case 'PROP_UNDO_SNAPSHOT':
        if (this.canTrigger(eventName, 200)) {
          this.playTone(880, 392, 0.26, 'triangle', 0.18);
        }
        break;
      case 'BOX_DOUBLE_SPLIT':
        this.playTone(523.25, 783.99, 0.12, 'triangle', 0.2, 0);
        this.playTone(659.25, 1046.5, 0.16, 'triangle', 0.22, 0.12);
        break;
      case 'REVEAL_WHITE_GREEN':
        this.playTone(523.25, 659.25, 0.18, 'triangle', 0.18);
        break;
      case 'REVEAL_BLUE':
        this.playTone(587.33, 880, 0.24, 'triangle', 0.2);
        break;
      case 'REVEAL_PURPLE':
        [523.25, 659.25, 783.99, 1046.5].forEach((hz, k) =>
          this.playTone(hz, hz, 0.24, 'sine', 0.18, k * 0.06)
        );
        break;
      case 'REVEAL_GOLD':
        [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((hz, k) =>
          this.playTone(hz, hz * 1.01, 0.38, 'triangle', 0.22, k * 0.07)
        );
        break;
      case 'REVEAL_RED_JACKPOT':
        this.playTone(130.81, 65.41, 0.45, 'sawtooth', 0.24, 0);
        [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98].forEach((hz, k) =>
          this.playTone(hz, hz, 0.55, 'triangle', 0.24, 0.1 + k * 0.07)
        );
        break;
      default:
        break;
    }
  }
}
