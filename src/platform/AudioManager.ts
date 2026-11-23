import audioHapticsData from '../../data/audio_haptics.json';
import type { GameSceneState } from '../systems/GameStateMachine';
import type { IPlatformBridge } from './PlatformBridge';

interface AudioAssetCfg {
  audioId: string;
  output: string;
  source?: string;
  durationSec: number;
  music?: { sampleRate: number; loopSamples: number };
}

const AUDIO_ASSETS = audioHapticsData.audioAssets as unknown as AudioAssetCfg[];
const MIXER = audioHapticsData.mixer;
const BGM_CFG = AUDIO_ASSETS.find(a => a.audioId === 'bgm_workshop_starry');
/** 播放星夜工坊 BGM 的场景（启动闪屏保持安静，切后台由 suspend 统一暂停） */
const BGM_SCENES: ReadonlySet<GameSceneState> = new Set<GameSceneState>([
  'PLAYING',
  'VICTORY',
]);

/**
 * WebAudio 实时合成 ASMR + 23 项事件音效混合调度器 + 星夜工坊 BGM 总线
 * 对齐 data/audio_haptics.json 参数（零音频包体阻塞，支持切前后台静音与开箱 Ducking）
 *
 * BGM 总线：AudioBufferSource(loop) → bgmBusGain（场景 / 开关 / 开箱闪避） → bgmFlowGain（流沙侧链让位） → destination
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
  private unlockRequested = false;

  // ── BGM 总线 ──
  private bgmBusGain: GainNode | null = null;
  private bgmFlowGain: GainNode | null = null;
  private bgmSource: AudioBufferSourceNode | null = null;
  private bgmBuffer: AudioBuffer | null = null;
  private bgmRaw: ArrayBuffer | null = null;
  private bgmLoop = { start: 0, end: 0 };
  private bgmLoadStarted = false;
  private bgmDecoding = false;
  private bgmScene: GameSceneState = 'SPLASH';
  private bgmDucked = false;
  private bgmRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  private bgmStopTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly pentatonicHz = [783.99, 880.0, 987.77, 1174.66, 1318.51, 1567.98];
  private readonly goldShimmerHz = [1567.98, 1760.0, 1975.53, 2349.32];

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
      this.refreshBgm(0.25);
    } else {
      // 构造期调用时尚无用户手势，不提前创建 AudioContext；手势后切回开启则立即恢复 BGM
      if (this.unlockRequested) this.unlockAndResume();
      this.refreshBgm(0.8);
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public unlockAndResume(): void {
    this.unlockRequested = true;
    if (!this.enabled) return;
    if (!this.ctx) {
      this.ctx = this.platform.createAudioContext();
      if (this.ctx) {
        this.sfxMaster = this.ctx.createGain();
        this.sfxMaster.gain.value = MIXER.masterSfxGain;
        this.sfxMaster.connect(this.ctx.destination);
        this.initSandNoiseGraph();
        this.initBgmGraph();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this.decodeBgmIfReady();
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

  // ───────────────────────── 星夜工坊 BGM ─────────────────────────

  private initBgmGraph(): void {
    if (!this.ctx || this.bgmBusGain) return;
    try {
      this.bgmBusGain = this.ctx.createGain();
      this.bgmBusGain.gain.value = 0;
      this.bgmFlowGain = this.ctx.createGain();
      this.bgmFlowGain.gain.value = 1;
      this.bgmBusGain.connect(this.bgmFlowGain);
      this.bgmFlowGain.connect(this.ctx.destination);
    } catch {
      this.bgmBusGain = null;
      this.bgmFlowGain = null;
    }
  }

  /**
   * 后台静默加载 BGM：微信端先拉取 subpackages/audio 分包再读取代码包文件，Web 端直接 fetch /assets/audio。
   * 解码需等待 AudioContext 解锁（首次触摸），解码完成后若当前场景需要音乐则自动淡入。
   */
  public async preloadBgm(): Promise<void> {
    if (this.bgmLoadStarted || !BGM_CFG) return;
    this.bgmLoadStarted = true;
    let relPath: string;
    if (this.platform.isWeChat) {
      const ok = await this.platform.loadSubpackage('audio');
      if (!ok) {
        this.bgmLoadStarted = false;
        return;
      }
      relPath = BGM_CFG.output;
    } else {
      relPath = `/${BGM_CFG.source || BGM_CFG.output}`;
    }
    const raw = await this.platform.readBinaryFile(relPath);
    if (!raw) {
      this.bgmLoadStarted = false;
      return;
    }
    this.bgmRaw = raw;
    // 微信小游戏 WebAudio 无需用户手势即可起播；Web 端需等待首次触摸解锁
    if (this.platform.isWeChat) this.unlockAndResume();
    this.decodeBgmIfReady();
  }

  private decodeBgmIfReady(): void {
    if (!this.ctx || !this.bgmRaw || this.bgmBuffer || this.bgmDecoding) return;
    this.bgmDecoding = true;
    const raw = this.bgmRaw;
    this.bgmRaw = null;
    let settled = false;
    const finish = (buf: AudioBuffer | null): void => {
      if (settled) return;
      settled = true;
      this.bgmDecoding = false;
      if (!buf) return;
      this.bgmBuffer = buf;
      this.bgmLoop = this.computeBgmLoopPoints(buf);
      this.refreshBgm(0);
    };
    try {
      // 兼容回调式（微信 WebAudioContext）与 Promise 式（浏览器）两种 decodeAudioData
      const ret = this.ctx.decodeAudioData(
        raw,
        b => finish(b),
        () => finish(null)
      ) as Promise<AudioBuffer> | undefined;
      if (ret && typeof ret.then === 'function') {
        ret.then(
          b => finish(b),
          () => finish(null)
        );
      }
    } catch {
      finish(null);
    }
  }

  /**
   * 精确样本级循环点：曲目按 loopSamples 环形渲染，首尾零采样衔接。
   * 若解码器未剔除 MP3 编码器前导静音（部分 iOS 内核），自动探测并跳过，避免循环处出现空拍。
   */
  private computeBgmLoopPoints(buf: AudioBuffer): { start: number; end: number } {
    const music = BGM_CFG?.music;
    const loopSec = music ? music.loopSamples / music.sampleRate : buf.duration;
    let lead = 0;
    try {
      const l = buf.getChannelData(0);
      const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
      const scanMax = Math.min(l.length, Math.round(buf.sampleRate * 0.1));
      while (lead < scanMax && Math.abs(l[lead]) < 1e-4 && Math.abs(r[lead]) < 1e-4) lead++;
      if (lead >= scanMax || lead < 32) lead = 0;
    } catch {
      lead = 0;
    }
    const start = lead / buf.sampleRate;
    const end = Math.min(buf.duration, start + loopSec);
    return { start, end };
  }

  private ensureBgmSource(): boolean {
    if (this.bgmSource) return false;
    if (!this.ctx || !this.bgmBuffer || !this.bgmBusGain) return false;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.bgmBuffer;
      src.loop = true;
      src.loopStart = this.bgmLoop.start;
      src.loopEnd = this.bgmLoop.end;
      src.connect(this.bgmBusGain);
      src.start(0, this.bgmLoop.start);
      this.bgmSource = src;
      return true;
    } catch {
      this.bgmSource = null;
      return false;
    }
  }

  private stopBgmSource(): void {
    if (!this.bgmSource) return;
    try {
      this.bgmSource.stop();
      this.bgmSource.disconnect();
    } catch {
      // ignore
    }
    this.bgmSource = null;
  }

  private bgmTargetGain(): number {
    if (!this.enabled || !BGM_SCENES.has(this.bgmScene)) return 0;
    return this.bgmDucked ? MIXER.bgmAppraisalDuckGain : MIXER.bgmDefaultGain;
  }

  private rampParam(param: AudioParam, target: number, fadeSec: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + Math.max(0.01, fadeSec));
    } catch {
      param.value = target;
    }
  }

  /** 按当前开关 / 场景 / 闪避状态平滑推子到目标音量；首次起播使用 bgmFadeInMs 慢淡入 */
  private refreshBgm(fadeSec: number): void {
    if (!this.ctx || !this.bgmBusGain) return;
    const target = this.bgmTargetGain();
    let fade = fadeSec;
    if (target > 0) {
      if (this.bgmStopTimer) {
        clearTimeout(this.bgmStopTimer);
        this.bgmStopTimer = null;
      }
      if (this.ensureBgmSource()) {
        this.bgmBusGain.gain.value = 0;
        fade = Math.max(fade, MIXER.bgmFadeInMs / 1000);
      }
    }
    if (!this.bgmSource) return;
    this.rampParam(this.bgmBusGain.gain, target, fade);
    if (target === 0 && !this.bgmStopTimer) {
      this.bgmStopTimer = setTimeout(() => {
        this.bgmStopTimer = null;
        if (this.bgmTargetGain() === 0) this.stopBgmSource();
      }, fade * 1000 + 80);
    }
  }

  /** 场景切换：闪屏静音，局内与通关结算共用星夜工坊主题 */
  public setBgmScene(scene: GameSceneState): void {
    if (scene === 'PAUSED') return;
    this.bgmScene = scene;
    if (this.bgmDucked) {
      if (this.bgmRestoreTimer) {
        clearTimeout(this.bgmRestoreTimer);
        this.bgmRestoreTimer = null;
      }
      this.bgmDucked = false;
    }
    this.refreshBgm(0.6);
  }

  /** 高光时刻：200ms 内压暗至 0.08，让关键和弦与音效穿透 */
  private duckBgm(): void {
    if (this.bgmRestoreTimer) {
      clearTimeout(this.bgmRestoreTimer);
      this.bgmRestoreTimer = null;
    }
    if (this.bgmDucked) return;
    this.bgmDucked = true;
    this.refreshBgm(MIXER.bgmDuckFadeMs / 1000);
  }

  private scheduleBgmRestore(delayMs: number): void {
    if (!this.bgmDucked) return;
    if (this.bgmRestoreTimer) clearTimeout(this.bgmRestoreTimer);
    this.bgmRestoreTimer = setTimeout(() => {
      this.bgmRestoreTimer = null;
      this.bgmDucked = false;
      this.refreshBgm(MIXER.bgmRestoreFadeMs / 1000);
    }, delayMs);
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
   * 每帧根据流沙活跃度平滑调制带通白噪音 ASMR（0 KB 包体），并对 BGM 做轻量侧链让位
   */
  public updateSandFlow(flowParticles: number): void {
    this.updateBgmSandSidechain(this.enabled ? flowParticles : 0);
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

  private lastBgmFlowTarget = 1;

  /** 大面积塌方 / 吸沙时 BGM 最多让位 bgmSandFlowDuckRatio（默认 30%），沙停后约 1s 内回满 */
  private updateBgmSandSidechain(flowParticles: number): void {
    if (!this.ctx || !this.bgmFlowGain) return;
    const ratio = Math.min(1, Math.max(0, flowParticles) / 35);
    const target = 1 - MIXER.bgmSandFlowDuckRatio * ratio;
    if (target === this.lastBgmFlowTarget) return;
    if (target < 1 && Math.abs(target - this.lastBgmFlowTarget) < 0.02) return;
    this.lastBgmFlowTarget = target;
    try {
      this.bgmFlowGain.gain.setTargetAtTime(target, this.ctx.currentTime, target < 1 ? 0.12 : 0.35);
    } catch {
      this.bgmFlowGain.gain.value = target;
    }
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

  private playGlassClink(baseHz: number, peakGain = 0.16, delaySec = 0): void {
    this.playTone(baseHz, baseHz * 1.005, 0.16, 'sine', peakGain, delaySec);
    this.playTone(baseHz * 2.756, baseHz * 2.74, 0.065, 'sine', peakGain * 0.34, delaySec);
  }

  public playPentatonicStep(stepIdx: number): void {
    if (!this.canTrigger('pentatonic', 60)) return;
    const hz = this.pentatonicHz[Math.max(0, Math.min(this.pentatonicHz.length - 1, stepIdx))];
    this.playTone(hz, hz * 1.006, 0.13, 'sine', 0.16);
    this.playTone(hz * 2, hz * 2.01, 0.07, 'triangle', 0.06);
  }

  public playGoldShimmer(): void {
    if (!this.canTrigger('gold_shimmer', 70)) return;
    const hz = this.goldShimmerHz[Math.floor(Math.random() * this.goldShimmerHz.length)];
    this.playGlassClink(hz, 0.12);
  }

  public startHeartbeat(isRed: boolean): void {
    this.stopHeartbeat();
    this.duckBgm();
    if (!this.enabled) return;
    let beat = 0;
    const intervalMs = isRed ? 390 : 460;
    const triggerBeat = (): void => {
      beat++;
      const boost = 1 + beat * 0.08;
      this.playTone(95 * boost, 52, 0.14, 'sine', 0.24, 0);
      this.playTone(118 * boost, 62, 0.12, 'sine', 0.18, 0.13);
    };
    triggerBeat();
    this.heartbeatTimer = setInterval(triggerBeat, intervalMs);
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.scheduleBgmRestore(150);
  }

  public playEvent(eventName: string): void {
    if (!this.enabled) return;
    switch (eventName) {
      case 'UI_BUTTON_TAP':
        if (this.canTrigger(eventName, 40)) {
          // 温润水滴/暖木琴轻点
          this.playTone(587.33, 783.99, 0.065, 'sine', 0.14);
        }
        break;
      case 'BUCKET_DISPATCH':
        if (this.canTrigger(eventName, 35)) {
          // 玻璃瓶落入磨砂玻璃托盘的清透叮铃声
          this.playTone(523.25, 659.25, 0.08, 'triangle', 0.12);
          this.playGlassClink(1046.5, 0.15, 0.018);
        }
        break;
      case 'BUCKET_TAP_BLOCKED':
        if (this.canTrigger(eventName, 140)) {
          // 柔和磨砂玻璃轻叩两声（取代生硬方波）
          this.playTone(293.66, 246.94, 0.085, 'triangle', 0.13);
          this.playTone(246.94, 207.65, 0.09, 'sine', 0.11, 0.075);
        }
        break;
      case 'BUCKET_MYSTERY_REVEAL':
        if (this.canTrigger(eventName, 70)) {
          // 和纸封套轻柔揭开泛音
          this.playTone(659.25, 987.77, 0.13, 'sine', 0.15);
          this.playGlassClink(1318.51, 0.1, 0.04);
        }
        break;
      case 'BUCKET_ICE_CRACK':
        if (this.canTrigger(eventName, 90)) {
          this.playGlassClink(1567.98, 0.14, 0);
          this.playTone(1174.66, 783.99, 0.11, 'triangle', 0.12, 0.03);
        }
        break;
      case 'PROP_SHUFFLE':
        if (this.canTrigger(eventName, 200)) {
          [587.33, 783.99, 987.77, 1174.66].forEach((hz, k) =>
            this.playGlassClink(hz, 0.13, k * 0.045)
          );
        }
        break;
      case 'BOARD_PULL':
        if (this.canTrigger(eventName, 50)) {
          // 浅枫木细拨片顺滑抽离玻璃槽
          this.playTone(392, 783.99, 0.12, 'triangle', 0.18);
          this.playTone(880, 1174.66, 0.07, 'sine', 0.09, 0.035);
        }
        break;
      case 'BOARD_TAP_LOCKED':
        if (this.canTrigger(eventName, 180)) {
          this.playTone(261.63, 220, 0.08, 'triangle', 0.13);
          this.playTone(220, 196, 0.09, 'sine', 0.11, 0.085);
        }
        break;
      case 'LOCK_AUTO_BREAK':
      case 'PROP_EXTRA_SLOT':
        if (this.canTrigger(eventName, 100)) {
          this.playTone(783.99, 1174.66, 0.14, 'triangle', 0.18);
          this.playGlassClink(1567.98, 0.16, 0.07);
        }
        break;
      case 'DYE_RING_PASS':
        if (this.canTrigger(eventName, 150)) {
          this.playTone(740, 1108.73, 0.1, 'sine', 0.11);
        }
        break;
      case 'ICE_BLOCK_SHATTER':
        if (this.canTrigger(eventName, 120)) {
          this.playGlassClink(1760, 0.16, 0);
          this.playGlassClink(1318.51, 0.14, 0.035);
          this.playTone(987.77, 587.33, 0.16, 'triangle', 0.14, 0.05);
        }
        break;
      case 'BUCKET_FULL_SWAP':
        if (this.canTrigger(eventName, 80)) {
          // 丝带玻璃瓶 100% 满瓶软木塞轻啵 + Gmaj9 风铃上扬琶音
          this.playTone(440, 659.25, 0.07, 'sine', 0.16, 0);
          this.playGlassClink(783.99, 0.16, 0.04);
          this.playGlassClink(987.77, 0.16, 0.09);
          this.playGlassClink(1479.98, 0.15, 0.14);
        }
        break;
      case 'CLOG_WARNING_SHOW':
        if (this.canTrigger(eventName, 2000)) {
          this.playTone(440, 440, 0.15, 'sine', 0.14, 0);
          this.playTone(392, 392, 0.22, 'sine', 0.14, 0.16);
        }
        break;
      case 'PROP_VACUUM_CLEAN':
        if (this.canTrigger(eventName, 300)) {
          this.playTone(329.63, 987.77, 0.34, 'sine', 0.17);
          this.playGlassClink(1174.66, 0.16, 0.32);
        }
        break;
      case 'PROP_UNDO_SNAPSHOT':
        if (this.canTrigger(eventName, 200)) {
          [1174.66, 987.77, 783.99, 587.33].forEach((hz, k) =>
            this.playTone(hz, hz * 0.99, 0.14, 'sine', 0.13, k * 0.045)
          );
        }
        break;
      case 'LEVEL_VICTORY':
        // Gmaj9 日系治愈柔毡与钢片琴上行礼赞和弦
        [587.33, 783.99, 987.77, 1174.66, 1479.98, 1567.98].forEach((hz, k) => {
          this.playTone(hz, hz * 1.004, 0.38, 'sine', 0.18, k * 0.065);
          this.playTone(hz * 2, hz * 2, 0.18, 'triangle', 0.06, k * 0.065);
        });
        break;
      default:
        break;
    }
  }
}
