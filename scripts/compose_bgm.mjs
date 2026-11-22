#!/usr/bin/env node
/**
 * 《沙里淘大红》星夜木屋工坊治愈主背景乐 `bgm_workshop_starry` —— 离线确定性作曲 / 合成 / 母带脚本
 *
 * 严格对齐《UI_UX交互与视听资产规范》§4.3 音频制作总基调与 data/audio_haptics.json：
 *   - 风格：日系绘本星夜木屋摇篮夜曲，F 大调，BPM 76，3/4 拍，20 小节（A 8 + B 8 + 尾声 4）≈ 47.37s
 *   - 配器（零采样、全部物理/加法合成，无版权风险）：
 *       · 指弹原声木吉他 —— Karplus-Strong 拨弦物理模型 + 拨弦位置梳状滤波 + 木箱共鸣 EQ
 *       · 复古八音盒     —— 梳齿非谐泛音 + 双齿微失谐拍频 + 金属“叮”瞬态（主旋律）
 *       · 柔和管弦 Pad   —— B 段起进入，1.1kHz 低通，只铺底不抢戏
 *       · 竖琴琶音过门   —— A→B、B→尾声两处段落提示
 *       · 木屋混响       —— Freeverb，环形两遍处理，尾音跨首尾无缝
 *   - 混音：主动在 2~3.5kHz 挖空 -7dB，为流沙白噪音 synth_sand_asmr（1.8~3.6kHz 带通）让位
 *   - 循环：所有声部 / 滤波 / 混响均按环形缓冲写入，首尾零采样无缝循环（loopSamples 精确到样本）
 *   - 严禁电子街机激光音、警报蜂鸣与金属重工业噪音
 *
 * 用法：
 *   node scripts/compose_bgm.mjs                 # 生成 assets/audio/bgm_workshop_starry.mp3
 *   node scripts/compose_bgm.mjs --wav out.wav   # 额外导出 16-bit WAV 母带（调试试听）
 * 依赖：ffmpeg（libmp3lame）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audio_haptics.json'), 'utf8'));
const bgmCfg = audioCfg.audioAssets.find(a => a.audioId === 'bgm_workshop_starry');
if (!bgmCfg || !bgmCfg.music) throw new Error('data/audio_haptics.json 缺失 bgm_workshop_starry.music 配置');

const { bpm: BPM, bars: BARS, sampleRate: SR, loopSamples: N } = bgmCfg.music;
const BEATS_PER_BAR = 3;
const BEAT = 60 / BPM;
const BAR = BEAT * BEATS_PER_BAR;
const EXPECTED_N = Math.round(BAR * BARS * SR);
if (EXPECTED_N !== N) {
  throw new Error(`loopSamples 不一致：json=${N}，按 BPM/小节计算=${EXPECTED_N}`);
}

const args = process.argv.slice(2);
const wavArgIdx = args.indexOf('--wav');
const WAV_OUT = wavArgIdx >= 0 ? path.resolve(args[wavArgIdx + 1]) : null;
const MP3_OUT = path.join(ROOT, bgmCfg.source || 'assets/audio/bgm_workshop_starry.mp3');

// ───────────────────────────── 工具函数 ─────────────────────────────

/** 确定性随机数（同一脚本每次输出完全一致的母带） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5a4d4f52);
const jitterSec = ms => ((rand() * 2 - 1) * ms) / 1000;

const NOTE_IDX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midiOf(name) {
  const m = /^([A-G])(b|#)?(\d)$/.exec(name);
  if (!m) throw new Error(`非法音名 ${name}`);
  const acc = m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0;
  return (Number(m[3]) + 1) * 12 + NOTE_IDX[m[1]] + acc;
}
const hz = name => 440 * Math.pow(2, (midiOf(name) - 69) / 12);

const newBus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });

/** 等功率声像 */
function panGains(pan) {
  const a = ((pan + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** 环形写入：超出循环末尾的尾音自动绕回开头，实现首尾无缝 */
function mixInto(bus, startSec, mono, gain, pan, send = null, sendAmt = 0) {
  const [gl, gr] = panGains(pan);
  let idx = Math.round(startSec * SR) % N;
  if (idx < 0) idx += N;
  for (let i = 0; i < mono.length; i++) {
    const v = mono[i] * gain;
    bus.L[idx] += v * gl;
    bus.R[idx] += v * gr;
    if (send) {
      send.L[idx] += v * gl * sendAmt;
      send.R[idx] += v * gr * sendAmt;
    }
    idx++;
    if (idx >= N) idx = 0;
  }
}

/** RBJ Audio EQ Cookbook 双二阶滤波器系数 */
function biquad(type, f0, Q = 0.7071, gainDb = 0) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / SR;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
      break;
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s);
      b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s;
      a1 = 2 * ((A - 1) - (A + 1) * cw);
      a2 = (A + 1) - (A - 1) * cw - s;
      break;
    }
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + s);
      b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s;
      a1 = -2 * ((A - 1) + (A + 1) * cw);
      a2 = (A + 1) + (A - 1) * cw - s;
      break;
    }
    default:
      throw new Error(`未知滤波器 ${type}`);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** 环形滤波：先空跑一圈建立稳态，第二圈写出，保证循环接缝处滤波器状态连续 */
function filterCircular(buf, c) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const x = buf[i];
      const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      if (pass === 1) buf[i] = y;
    }
  }
}
function filterBus(bus, ...coeffs) {
  for (const c of coeffs) {
    filterCircular(bus.L, c);
    filterCircular(bus.R, c);
  }
}

function busRms(bus) {
  let s = 0;
  for (let i = 0; i < N; i++) s += bus.L[i] * bus.L[i] + bus.R[i] * bus.R[i];
  return Math.sqrt(s / (2 * N));
}
function busPeak(bus) {
  let p = 0;
  for (let i = 0; i < N; i++) p = Math.max(p, Math.abs(bus.L[i]), Math.abs(bus.R[i]));
  return p;
}
function scaleBus(bus, k) {
  for (let i = 0; i < N; i++) { bus.L[i] *= k; bus.R[i] *= k; }
}

// ───────────────────────────── 乐器合成 ─────────────────────────────

/**
 * 指弹木吉他 / 竖琴：Karplus-Strong 拨弦（分数延迟精确调音 + 频率相关 T60 + 拨弦位置梳状滤波）
 */
function ksPluck(freq, durSec, { vel = 0.7, bright = 0.4, t60 = 3, pickPos = 0.18, releaseSec = 0.18 } = {}) {
  const len = Math.max(16, Math.ceil(durSec * SR));
  const out = new Float32Array(len);
  const period = SR / freq;
  const D = period - 0.5; // 两点平均环路滤波器引入 0.5 样本群延迟
  const P = Math.max(2, Math.round(period));

  // 激励：一阶低通噪声脉冲（bright 越低越像尼龙弦指肚拨奏）
  const exc = new Float32Array(P);
  const a = 0.08 + 0.85 * bright;
  let lp = 0;
  for (let i = 0; i < P; i++) {
    lp += a * ((rand() * 2 - 1) - lp);
    exc[i] = lp;
  }
  // 拨弦位置梳状滤波（靠近琴桥 → 泛音更丰富）
  const pp = Math.max(1, Math.round(P * pickPos));
  const shaped = new Float32Array(P);
  let mean = 0;
  for (let i = 0; i < P; i++) {
    shaped[i] = exc[i] - 0.92 * (i >= pp ? exc[i - pp] : 0);
    mean += shaped[i];
  }
  mean /= P;
  let peak = 1e-9;
  for (let i = 0; i < P; i++) {
    shaped[i] -= mean;
    peak = Math.max(peak, Math.abs(shaped[i]));
  }
  for (let i = 0; i < P; i++) shaped[i] = (shaped[i] / peak) * vel;

  const g = Math.pow(10, -3 / (t60 * freq));
  for (let n = 0; n < len; n++) {
    let fb = 0;
    const pos = n - D;
    if (pos >= 1) {
      const i0 = Math.floor(pos);
      const f = pos - i0;
      const yD = out[i0] * (1 - f) + out[Math.min(i0 + 1, n - 1)] * f;
      const yD1 = out[i0 - 1] * (1 - f) + out[i0] * f;
      fb = g * 0.5 * (yD + yD1);
    }
    out[n] = (n < P ? shaped[n] : 0) + fb;
  }
  // 指肚止弦：末尾平滑阻尼
  const rel = Math.min(len, Math.round(releaseSec * SR));
  for (let i = 0; i < rel; i++) {
    const k = i / rel;
    out[len - rel + i] *= 0.5 + 0.5 * Math.cos(Math.PI * k);
  }
  return out;
}

const guitarT60 = f => Math.max(1.4, Math.min(4.5, 3.4 * Math.pow(110 / f, 0.35)));

/**
 * 复古八音盒：梳齿基频 + 双齿微失谐拍频 + 快速衰减的高次非谐泛音（金属“叮”只在起音 60ms 内闪现，避开流沙频段常驻）
 */
function musicBoxNote(freq, vel) {
  const t60 = Math.max(1.1, Math.min(3.0, 2.1 * Math.pow(700 / freq, 0.6)));
  const durSec = t60 * 1.05;
  const len = Math.ceil(durSec * SR);
  const out = new Float32Array(len);
  const partials = [
    { r: 1.0, a: 1.0, t: t60 },
    { r: 1.0021, a: 0.32, t: t60 * 0.92 }, // 相邻梳齿微失谐 → 八音盒特有的温柔颤音
    { r: 2.0, a: 0.13, t: t60 * 0.32 },
    { r: 3.0, a: 0.035, t: t60 * 0.18 },
    { r: 5.404, a: 0.06, t: 0.07 }, // 梳齿金属瞬态
  ];
  const attack = Math.round(0.0015 * SR);
  for (const p of partials) {
    const f = freq * p.r;
    if (f > SR * 0.45) continue;
    const w = (2 * Math.PI * f) / SR;
    const k = Math.log(1000) / (p.t * SR);
    const ph = rand() * Math.PI * 2;
    const n = Math.min(len, Math.ceil(p.t * 1.1 * SR));
    for (let i = 0; i < n; i++) {
      out[i] += p.a * Math.exp(-k * i) * Math.sin(ph + w * i);
    }
  }
  for (let i = 0; i < len; i++) {
    const env = i < attack ? i / attack : 1;
    const tail = i > len - 2000 ? (len - i) / 2000 : 1;
    out[i] *= vel * env * tail;
  }
  return out;
}

/**
 * 柔和管弦 Pad：每个和弦音 3 支微失谐加法锯齿（谐波截止 1.6kHz）+ 慢起音慢释放 + 迟到颤音
 */
function padVoice(freq, holdSec, detuneCents, vel) {
  const attackSec = 0.9;
  const releaseSec = 1.3;
  const len = Math.ceil((holdSec + releaseSec) * SR);
  const out = new Float32Array(len);
  const f0 = freq * Math.pow(2, detuneCents / 1200);
  const maxK = Math.max(1, Math.floor(1600 / f0));
  const phases = Array.from({ length: maxK }, () => rand() * Math.PI * 2);
  const amps = Array.from({ length: maxK }, (_, k) => 1 / Math.pow(k + 1, 1.25));
  const holdN = holdSec * SR;
  const atkN = attackSec * SR;
  const relK = Math.log(1000) / (releaseSec * SR);
  let basePhase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const vib = 1 + 0.0016 * Math.min(1, t / 1.2) * Math.sin(2 * Math.PI * 4.6 * t);
    basePhase += (2 * Math.PI * f0 * vib) / SR;
    let s = 0;
    for (let k = 0; k < maxK; k++) s += amps[k] * Math.sin(phases[k] + (k + 1) * basePhase);
    let env;
    if (i < atkN) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / atkN);
    else if (i < holdN) env = 1;
    else env = Math.exp(-relK * (i - holdN));
    out[i] = s * env * vel;
  }
  return out;
}

// ───────────────────────────── 乐谱 ─────────────────────────────
// 20 小节：A 段（1–8 吉他 + 八音盒）→ B 段（9–16 管弦铺底进入）→ 尾声（17–20 小调 iv 怀旧色彩回到主和弦）
const CHORDS = [
  /* 1  */ { name: 'F',      bass: 'F2',  arp: ['C4', 'F4', 'A4'] },
  /* 2  */ { name: 'C/E',    bass: 'E2',  arp: ['G3', 'C4', 'E4'] },
  /* 3  */ { name: 'Dm7',    bass: 'D3',  arp: ['A3', 'C4', 'F4'] },
  /* 4  */ { name: 'Bbmaj7', bass: 'Bb2', arp: ['D4', 'F4', 'A4'] },
  /* 5  */ { name: 'F/A',    bass: 'A2',  arp: ['C4', 'F4', 'A4'] },
  /* 6  */ { name: 'Gm7',    bass: 'G2',  arp: ['Bb3', 'D4', 'F4'] },
  /* 7  */ { name: 'C7sus4', bass: 'C3',  arp: ['Bb3', 'C4', 'F4'] },
  /* 8  */ { name: 'C7',     bass: 'C3',  arp: ['Bb3', 'E4', 'G4'] },
  /* 9  */ { name: 'Bbmaj7', bass: 'Bb2', arp: ['D4', 'F4', 'A4'] },
  /* 10 */ { name: 'C',      bass: 'C3',  arp: ['G3', 'C4', 'E4'] },
  /* 11 */ { name: 'Am7',    bass: 'A2',  arp: ['G3', 'C4', 'E4'] },
  /* 12 */ { name: 'Dm7',    bass: 'D3',  arp: ['A3', 'C4', 'F4'] },
  /* 13 */ { name: 'Gm7',    bass: 'G2',  arp: ['Bb3', 'D4', 'F4'] },
  /* 14 */ { name: 'C',      bass: 'C3',  arp: ['G3', 'C4', 'E4'] },
  /* 15 */ { name: 'Fmaj7',  bass: 'F2',  arp: ['A3', 'C4', 'E4'] },
  /* 16 */ { name: 'F7',     bass: 'F2',  arp: ['A3', 'C4', 'Eb4'] },
  /* 17 */ { name: 'Bbmaj7', bass: 'Bb2', arp: ['D4', 'F4', 'A4'] },
  /* 18 */ { name: 'Bbm6',   bass: 'Bb2', arp: ['Db4', 'F4', 'G4'] },
  /* 19 */ { name: 'F/C',    bass: 'C3',  arp: ['A3', 'C4', 'F4'] },
  /* 20 */ { name: 'C7',     bass: 'C3',  arp: ['Bb3', 'E4', 'G4'] },
];

// 八音盒主旋律：[音名, 小节内起拍(拍), 力度系数]
const MELODY = [
  /* 1  */ [['F5', 0], ['A5', 1], ['C6', 2]],
  /* 2  */ [['G5', 0], ['E5', 2]],
  /* 3  */ [['F5', 0], ['E5', 1.5, 0.8], ['D5', 2]],
  /* 4  */ [['A5', 0]],
  /* 5  */ [['C6', 0], ['A5', 1], ['F5', 2]],
  /* 6  */ [['Bb5', 0], ['A5', 1.5, 0.8], ['G5', 2]],
  /* 7  */ [['F5', 0], ['G5', 1], ['Bb5', 2]],
  /* 8  */ [['G5', 0], ['E5', 2]],
  /* 9  */ [['F5', 0], ['D6', 1], ['C6', 2]],
  /* 10 */ [['C6', 0], ['Bb5', 1.5, 0.8], ['G5', 2]],
  /* 11 */ [['C6', 0], ['A5', 1], ['E5', 2]],
  /* 12 */ [['F5', 0], ['A5', 2]],
  /* 13 */ [['G5', 0], ['Bb5', 1], ['D6', 2]],
  /* 14 */ [['C6', 0], ['E5', 2]],
  /* 15 */ [['A5', 0], ['G5', 1.5, 0.8], ['F5', 2]],
  /* 16 */ [['A5', 0], ['C6', 1], ['Eb6', 2]],
  /* 17 */ [['D6', 0], ['C6', 2]],
  /* 18 */ [['Db6', 0], ['Bb5', 2]],
  /* 19 */ [['A5', 0], ['F5', 2]],
  /* 20 */ [['G5', 0], ['Bb5', 1], ['E5', 2, 0.85]],
];

// 竖琴过门：A→B（第 8 小节 C7 琶音）、B→尾声（第 16 小节 F7 琶音）
const HARP_GLISS = [
  { bar: 8, beat: 2.25, notes: ['C4', 'E4', 'G4', 'Bb4', 'C5', 'E5', 'G5'], vel: 0.55 },
  { bar: 16, beat: 2.2, notes: ['F4', 'A4', 'C5', 'Eb5', 'F5', 'A5', 'C6'], vel: 0.7 },
];

const barStart = b => b * BAR; // b 从 0 开始
const sectionOf = b => (b < 8 ? 'A' : b < 16 ? 'B' : 'C');

// ───────────────────────────── 渲染 ─────────────────────────────

console.log(`[compose:bgm] F 大调 ${BPM} BPM 3/4 · ${BARS} 小节 · ${(N / SR).toFixed(3)}s · ${N} samples @ ${SR}Hz`);

const gtr = newBus();
const box = newBus();
const pad = newBus();
const harp = newBus();
const send = newBus();

// 1) 指弹木吉他：6 个八分音符分解型 [低音, 5, 8, 10, 8, 5]，B 段第一拍加“捏弦”
for (let b = 0; b < BARS; b++) {
  const ch = CHORDS[b];
  const sec = sectionOf(b);
  const t0 = barStart(b);
  const barEnd = t0 + BAR;
  const secGain = sec === 'A' ? 0.92 : sec === 'B' ? 1.0 : 0.95;
  const order = [null, 0, 1, 2, 1, 0];
  for (let e = 0; e < 6; e++) {
    const isDown = e === 0;
    const tNote = t0 + e * (BEAT / 2) + (isDown && b === 0 ? 0 : jitterSec(7));
    const ringTo = barEnd + (isDown ? 0.32 : 0.2);
    const accent = e === 0 ? 1 : e === 2 || e === 4 ? 0.78 : 0.66;
    if (isDown) {
      const f = hz(ch.bass);
      const s = ksPluck(f, ringTo - tNote, { vel: 0.95 * secGain, bright: 0.22, t60: guitarT60(f), pickPos: 0.22, releaseSec: 0.28 });
      mixInto(gtr, tNote, s, 1, -0.18, send, 0.22);
      if (sec === 'B' || sec === 'C') {
        const f2 = hz(ch.arp[2]);
        const s2 = ksPluck(f2, ringTo - tNote, { vel: 0.5 * secGain, bright: 0.38, t60: guitarT60(f2), pickPos: 0.16 });
        mixInto(gtr, tNote + 0.012, s2, 1, -0.3, send, 0.25);
      }
    } else {
      const name = ch.arp[order[e]];
      const f = hz(name);
      const vel = accent * (0.62 + rand() * 0.08) * secGain;
      const s = ksPluck(f, ringTo - tNote, { vel, bright: 0.34 + rand() * 0.06, t60: guitarT60(f), pickPos: 0.15 + rand() * 0.05 });
      mixInto(gtr, tNote, s, 1, -0.32 + order[e] * 0.08, send, 0.25);
    }
  }
}

// 2) 八音盒主旋律（B 段强拍叠加低八度轻声复奏，营造摇篮曲温暖厚度）
for (let b = 0; b < BARS; b++) {
  const sec = sectionOf(b);
  for (const [name, beat, velMul = 1] of MELODY[b]) {
    const t = barStart(b) + beat * BEAT + (b === 0 && beat === 0 ? 0 : jitterSec(6));
    const vel = (beat === 0 ? 0.95 : 0.82) * velMul * (0.94 + rand() * 0.08);
    mixInto(box, t, musicBoxNote(hz(name), vel), 1, 0.24, send, 0.42);
    if (sec === 'B' && beat === 0) {
      const lowMidi = midiOf(name) - 12;
      const fLow = 440 * Math.pow(2, (lowMidi - 69) / 12);
      mixInto(box, t + 0.004, musicBoxNote(fLow, vel * 0.32), 1, 0.08, send, 0.4);
    }
  }
}

// 3) 管弦 Pad：B 段与尾声铺底（每小节和弦交叉淡入淡出，尾声释放自然绕回第 1 小节）
for (let b = 8; b < BARS; b++) {
  const ch = CHORDS[b];
  const tones = [ch.arp[0], ch.arp[1], ch.arp[2]];
  const hold = BAR + 0.15;
  const vel = b >= 16 ? 0.85 : 1;
  for (const name of tones) {
    const f = hz(name);
    mixInto(pad, barStart(b), padVoice(f, hold, -7, vel), 1, -0.55, send, 0.5);
    mixInto(pad, barStart(b), padVoice(f, hold, +6, vel), 1, 0.55, send, 0.5);
    mixInto(pad, barStart(b), padVoice(f / 2, hold, 0, vel * 0.45), 1, 0, send, 0.4);
  }
}

// 4) 竖琴琶音过门
for (const g of HARP_GLISS) {
  g.notes.forEach((name, k) => {
    const f = hz(name);
    const t = barStart(g.bar - 1) + g.beat * BEAT + k * 0.058;
    const s = ksPluck(f, 2.2, { vel: g.vel * (0.8 + 0.25 * (k / g.notes.length)), bright: 0.62, t60: 1.9, pickPos: 0.5, releaseSec: 0.4 });
    mixInto(harp, t, s, 1, -0.45 + (0.9 * k) / (g.notes.length - 1), send, 0.55);
  });
}

// ───────────────────────────── 分轨音色 & 电平 ─────────────────────────────

// 木吉他：木箱共鸣 + 尼龙弦温暖上限
filterBus(gtr,
  biquad('highpass', 60, 0.7071),
  biquad('peaking', 190, 1.1, 2.5),
  biquad('lowpass', 3600, 0.7071));
// 八音盒：去除低频浑浊，略收高频刺耳
filterBus(box, biquad('highpass', 280, 0.7071), biquad('highshelf', 6500, 0.7071, -3));
// 管弦 Pad：严格低通，只做底色
filterBus(pad, biquad('lowpass', 1100, 0.7071), biquad('highpass', 110, 0.7071));
filterBus(harp, biquad('highpass', 180, 0.7071), biquad('lowpass', 5200, 0.7071));

// 以吉他 RMS 为基准的声部配比（八音盒为主奏，Pad 退居幕后）
const gtrRms = busRms(gtr);
const LEVELS = { box: 0.78, pad: 0.3 };
scaleBus(box, (gtrRms * LEVELS.box) / busRms(box));
scaleBus(pad, (gtrRms * LEVELS.pad) / busRms(pad));
scaleBus(harp, (busPeak(gtr) * 0.42) / busPeak(harp));

// ───────────────────────────── 木屋混响（Freeverb） ─────────────────────────────

function freeverbCircular(sendBus, { room = 0.84, damp = 0.32, spread = 23 } = {}) {
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const feedback = 0.28 * room + 0.7;
  const mkChan = off => ({
    combs: combT.map(t => ({ buf: new Float32Array(t + off), idx: 0, store: 0 })),
    aps: apT.map(t => ({ buf: new Float32Array(t + off), idx: 0 })),
  });
  const chans = [mkChan(0), mkChan(spread)];
  const out = newBus();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const input = (sendBus.L[i] + sendBus.R[i]) * 0.015;
      for (let c = 0; c < 2; c++) {
        const ch = chans[c];
        let acc = 0;
        for (const cb of ch.combs) {
          const y = cb.buf[cb.idx];
          cb.store = y * (1 - damp) + cb.store * damp;
          cb.buf[cb.idx] = input + cb.store * feedback;
          if (++cb.idx >= cb.buf.length) cb.idx = 0;
          acc += y;
        }
        for (const ap of ch.aps) {
          const bo = ap.buf[ap.idx];
          const y = -acc + bo;
          ap.buf[ap.idx] = acc + bo * 0.5;
          if (++ap.idx >= ap.buf.length) ap.idx = 0;
          acc = y;
        }
        if (pass === 1) (c === 0 ? out.L : out.R)[i] = acc;
      }
    }
  }
  return out;
}

// 发送量与各声部最终电平同步缩放（重算发送总线，保证混响比例正确）
send.L.fill(0);
send.R.fill(0);
const SEND_AMT = { gtr: 0.24, box: 0.45, pad: 0.5, harp: 0.55 };
for (const [bus, amt] of [[gtr, SEND_AMT.gtr], [box, SEND_AMT.box], [pad, SEND_AMT.pad], [harp, SEND_AMT.harp]]) {
  for (let i = 0; i < N; i++) {
    send.L[i] += bus.L[i] * amt;
    send.R[i] += bus.R[i] * amt;
  }
}
console.log('[compose:bgm] 渲染木屋混响（环形两遍）...');
const rev = freeverbCircular(send);
filterBus(rev, biquad('highpass', 220, 0.7071), biquad('lowpass', 5000, 0.7071));
scaleBus(rev, (gtrRms * 0.55) / Math.max(1e-9, busRms(rev)));

// ───────────────────────────── 母带 ─────────────────────────────

const master = newBus();
for (const bus of [gtr, box, pad, harp, rev]) {
  for (let i = 0; i < N; i++) {
    master.L[i] += bus.L[i];
    master.R[i] += bus.R[i];
  }
}
filterBus(master,
  biquad('highpass', 38, 0.7071),
  biquad('lowshelf', 160, 0.7071, 1.2),
  // 流沙白噪音频段让位：2.75kHz 中心、覆盖约 1.9~3.8kHz 的 -7dB 宽口挖空
  biquad('peaking', 2750, 0.75, -7),
  biquad('highshelf', 8000, 0.7071, -2));

// 软拐点限幅 → -1.5 dBFS 峰值归一
let pk = busPeak(master);
const preGain = 0.9 / pk;
const knee = 0.72;
const soft = x => {
  const a = Math.abs(x);
  if (a <= knee) return x;
  return Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
};
for (let i = 0; i < N; i++) {
  master.L[i] = soft(master.L[i] * preGain * 1.25);
  master.R[i] = soft(master.R[i] * preGain * 1.25);
}
pk = busPeak(master);
scaleBus(master, Math.pow(10, -1.5 / 20) / pk);

const finalRms = busRms(master);
const seamJump = Math.max(Math.abs(master.L[N - 1] - master.L[0]), Math.abs(master.R[N - 1] - master.R[0]));
console.log(`[compose:bgm] 母带 RMS ${(20 * Math.log10(finalRms)).toFixed(1)} dBFS · 峰值 -1.5 dBFS · 循环接缝跳变 ${seamJump.toExponential(2)}`);

// ───────────────────────────── 导出 ─────────────────────────────

function writeWav16(file, bus) {
  const data = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    // TPDF 抖动
    const d = (rand() - rand()) / 32768;
    const l = Math.max(-1, Math.min(1, bus.L[i] + d));
    const r = Math.max(-1, Math.min(1, bus.R[i] + d));
    data.writeInt16LE(Math.round(l * 32767), i * 4);
    data.writeInt16LE(Math.round(r * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

const tmpWav = WAV_OUT || path.join(os.tmpdir(), `bgm_workshop_starry_${process.pid}.wav`);
writeWav16(tmpWav, master);
fs.mkdirSync(path.dirname(MP3_OUT), { recursive: true });
execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-i', tmpWav,
  '-c:a', 'libmp3lame', '-b:a', `${bgmCfg.kbps}k`, '-ar', String(SR), '-ac', String(bgmCfg.channels),
  '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1',
  MP3_OUT,
]);
if (!WAV_OUT) fs.rmSync(tmpWav, { force: true });

const sizeKB = fs.statSync(MP3_OUT).size / 1024;
console.log(`[compose:bgm] ✅ ${path.relative(ROOT, MP3_OUT)} · ${sizeKB.toFixed(1)} KB（预算 ≤ ${bgmCfg.maxSizeKB} KB）`);
if (sizeKB > bgmCfg.maxSizeKB) {
  console.error(`[compose:bgm] ❌ 超出体积预算 ${bgmCfg.maxSizeKB} KB`);
  process.exit(1);
}
