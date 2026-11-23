#!/usr/bin/env node
/**
 * 《星夜流沙瓶》星夜玻璃工坊日系治愈主背景乐 `bgm_workshop_starry` —— 离线确定性作曲 / 合成 / 母带脚本
 *
 * 严格对齐《UI_UX交互与视听资产规范》与 data/audio_haptics.json（v2.0 静谧星夜轻绘极简版）：
 *   - 风格：日系暖愈夜曲（G 大调 maj9 / Lydian 清澈温暖色彩，温柔明朗、不沉闷不忧郁），BPM 75，4/4 舒缓呼吸律动，16 小节（A 8 + B 8 = 51.200s）
 *   - 配器（纯物理/加法合成，零外部采样，零版权风险）：
 *       · 日系柔毡钢琴（Felt Piano） —— 羊毛毡槌柔化起音 + 钢琴微展宽泛音列 + 双弦微失谐共鸣 + 木质音板温暖包络
 *       · 清透钢片琴（Celesta）       —— 晶莹钟铃基频 + 温暖共鸣腔泛音（主旋律）
 *       · 暖木马林巴（Warm Marimba）  —— B 段轻盈弱拍点缀，增添治愈呼吸感
 *       · 柔雾弦乐/电钢铺底（Warm Pad）—— B 段柔和托底，1.15kHz 低通温暖包裹
 *       · 玻璃微风铃（Glass Chime）    —— 乐句呼吸处轻拂 G 大调五声玻璃泛音，呼应局内丝带玻璃瓶质感
 *   - 混音：主动在 2.0~3.6kHz 柔和挖空 -7dB，为流沙白噪音 synth_sand_asmr 让出清透空间
 *   - 循环：所有声部 / 滤波 / 混响均按环形缓冲写入，首尾零采样无缝循环（loopSamples = 2257920）
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
const BEATS_PER_BAR = 4;
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

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x20261122);
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

function panGains(pan) {
  const a = ((pan + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

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

// ───────────────────────────── 日系治愈配器合成 ─────────────────────────────

/**
 * 1. 日系柔毡钢琴（Felt Piano）：
 *    模拟贴有薄羊毛毡的立式木钢琴——温暖厚实的中低频基音、轻微钢琴弦劲度展宽（Inharmonicity B）、
 *    双弦微失谐（Unison detune）带来的自然歌唱感，以及柔和无毛刺的软槌触键。
 */
function feltPianoNote(freq, holdSec, vel = 0.75) {
  const t60 = Math.max(1.8, Math.min(5.2, 3.8 * Math.pow(196 / freq, 0.38)));
  const relSec = 0.36;
  const durSec = Math.min(t60 * 0.95, holdSec + relSec);
  const len = Math.max(64, Math.ceil(durSec * SR));
  const out = new Float32Array(len);

  // 钢琴弦劲度系数：高音略微展宽泛音，塑造真实立式琴质感
  const B = 0.00018 * Math.pow(freq / 261.63, 0.65);
  const partials = [
    { k: 1, amp: 1.0, decayMul: 1.0, detuneCents: 0 },
    { k: 1, amp: freq > 150 ? 0.48 : 0.0, decayMul: 0.95, detuneCents: 1.45 }, // 同音双弦柔和歌唱拍频
    { k: 2, amp: 0.42 * (0.65 + 0.35 * vel), decayMul: 0.74, detuneCents: -0.6 },
    { k: 3, amp: 0.16 * vel, decayMul: 0.52, detuneCents: 0.5 },
    { k: 4, amp: 0.065 * vel, decayMul: 0.36, detuneCents: 0 },
    { k: 5, amp: 0.024 * vel, decayMul: 0.24, detuneCents: 0 },
  ];

  for (const p of partials) {
    if (p.amp <= 0.001) continue;
    const stretch = Math.sqrt(1 + B * p.k * p.k);
    const det = Math.pow(2, p.detuneCents / 1200);
    const f = freq * p.k * stretch * det;
    if (f > 4200 || f > SR * 0.42) continue;
    const w = (2 * Math.PI * f) / SR;
    const decayRate = Math.log(1000) / (t60 * p.decayMul * SR);
    const ph = rand() * Math.PI * 2;
    const maxI = Math.min(len, Math.ceil(t60 * p.decayMul * 1.05 * SR));
    for (let i = 0; i < maxI; i++) {
      out[i] += p.amp * Math.exp(-decayRate * i) * Math.sin(ph + w * i);
    }
  }

  // 羊毛毡软槌轻触瞬态（低频柔和绒感，绝无尖锐咔哒）
  const thumpLen = Math.min(len, Math.round(0.022 * SR));
  let lp = 0;
  for (let i = 0; i < thumpLen; i++) {
    const env = Math.sin((Math.PI * i) / thumpLen);
    lp += 0.075 * ((rand() * 2 - 1) - lp);
    out[i] += lp * env * 0.14 * vel;
  }

  const atk = Math.round(0.0065 * SR);
  const relStart = Math.max(atk + 1, Math.round(holdSec * SR));
  for (let i = 0; i < len; i++) {
    let env = 1;
    if (i < atk) {
      env = 0.5 - 0.5 * Math.cos((Math.PI * i) / atk);
    } else if (i > relStart) {
      const k = Math.min(1, (i - relStart) / Math.max(1, len - relStart));
      env = 0.5 + 0.5 * Math.cos(Math.PI * k);
    }
    out[i] *= vel * env * 0.62;
  }
  return out;
}

/**
 * 2. 清透钢片琴（Celesta）：
 *    圆润纯净的钟琴音色，带有木质共鸣箱的温暖底色与柔和余韵，担任治愈主旋律。
 */
function celestaNote(freq, vel = 0.85) {
  const t60 = Math.max(1.3, Math.min(2.9, 2.25 * Math.pow(659 / freq, 0.45)));
  const len = Math.ceil(t60 * 1.05 * SR);
  const out = new Float32Array(len);
  const partials = [
    { r: 1.0, a: 1.0, t: t60 },
    { r: 1.0014, a: 0.28, t: t60 * 0.92 },
    { r: 2.0, a: 0.22, t: t60 * 0.44 },
    { r: 3.0, a: 0.045, t: t60 * 0.22 },
    { r: 4.72, a: 0.042, t: 0.085 }, // 软木槌轻敲金属片瞬态
  ];
  const atk = Math.round(0.004 * SR);
  for (const p of partials) {
    const f = freq * p.r;
    if (f > 6200 || f > SR * 0.45) continue;
    const w = (2 * Math.PI * f) / SR;
    const k = Math.log(1000) / (p.t * SR);
    const ph = rand() * Math.PI * 2;
    const n = Math.min(len, Math.ceil(p.t * 1.08 * SR));
    for (let i = 0; i < n; i++) {
      out[i] += p.a * Math.exp(-k * i) * Math.sin(ph + w * i);
    }
  }
  for (let i = 0; i < len; i++) {
    const env = i < atk ? 0.5 - 0.5 * Math.cos((Math.PI * i) / atk) : 1;
    const tail = i > len - 2200 ? (len - i) / 2200 : 1;
    out[i] *= vel * env * tail;
  }
  return out;
}

/**
 * 3. 暖木马林巴（Rosewood Marimba）：
 *    基频与第 4 谐波（两八度）构成的温润木琴，在 B 段弱拍轻巧呼应主旋律。
 */
function marimbaNote(freq, vel = 0.65) {
  const t60 = 0.78;
  const len = Math.ceil(0.88 * SR);
  const out = new Float32Array(len);
  const partials = [
    { r: 1.0, a: 1.0, t: t60 },
    { r: 3.98, a: 0.26, t: 0.16 },
    { r: 9.2, a: 0.03, t: 0.035 },
  ];
  const atk = Math.round(0.0035 * SR);
  for (const p of partials) {
    const f = freq * p.r;
    if (f > 4600) continue;
    const w = (2 * Math.PI * f) / SR;
    const k = Math.log(1000) / (p.t * SR);
    const ph = rand() * Math.PI * 2;
    for (let i = 0; i < len; i++) {
      out[i] += p.a * Math.exp(-k * i) * Math.sin(ph + w * i);
    }
  }
  for (let i = 0; i < len; i++) {
    const env = i < atk ? i / atk : 1;
    const tail = i > len - 1200 ? (len - i) / 1200 : 1;
    out[i] *= vel * env * tail;
  }
  return out;
}

/**
 * 4. 玻璃微风铃（Glass Wind Chime）：
 *    清透纯净的正弦双泛音，如同晚风拂过窗边许愿玻璃瓶的细微叮铃。
 */
function glassChimeNote(freq, vel = 0.35) {
  const t60 = 1.65;
  const len = Math.ceil(1.75 * SR);
  const out = new Float32Array(len);
  const w1 = (2 * Math.PI * freq) / SR;
  const w2 = (2 * Math.PI * freq * 2.756) / SR;
  const k1 = Math.log(1000) / (t60 * SR);
  const k2 = Math.log(1000) / (0.28 * SR);
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const atk = Math.round(0.0025 * SR);
  for (let i = 0; i < len; i++) {
    const env = i < atk ? i / atk : 1;
    const tail = i > len - 1800 ? (len - i) / 1800 : 1;
    const s = Math.exp(-k1 * i) * Math.sin(p1 + w1 * i) + 0.14 * Math.exp(-k2 * i) * Math.sin(p2 + w2 * i);
    out[i] = s * vel * env * tail;
  }
  return out;
}

/**
 * 5. 柔雾暖调铺底 Pad：柔和正弦+奇偶泛音慢呼吸引擎
 */
function healingPadVoice(freq, holdSec, detuneCents, vel) {
  const attackSec = 0.95;
  const releaseSec = 1.4;
  const len = Math.ceil((holdSec + releaseSec) * SR);
  const out = new Float32Array(len);
  const f0 = freq * Math.pow(2, detuneCents / 1200);
  const maxK = Math.max(1, Math.min(5, Math.floor(1350 / f0)));
  const phases = Array.from({ length: maxK }, () => rand() * Math.PI * 2);
  const amps = Array.from({ length: maxK }, (_, k) => 1 / Math.pow(k + 1, 1.55));
  const holdN = holdSec * SR;
  const atkN = attackSec * SR;
  const relK = Math.log(1000) / (releaseSec * SR);
  let basePhase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const vib = 1 + 0.0014 * Math.min(1, t / 1.4) * Math.sin(2 * Math.PI * 4.2 * t);
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

// ───────────────────────────── 日系治愈 G 大调 16 小节乐谱 ─────────────────────────────
// A 段（1–8 小节：静谧星窗，柔毡钢琴 + 钢片琴对话）
// B 段（9–16 小节：暖光绽放，IVmaj9 经典日系上扬 + 马林巴与柔雾 Pad 托底，第 14 小节 Cm6 温柔怀旧色彩回落主调）
const CHORDS = [
  /* 1  Gmaj9  */ { bass: 'G2',  voicing: ['D3', 'A3', 'B3', 'F#4'] },
  /* 2  D/F#   */ { bass: 'F#2', voicing: ['D3', 'A3', 'D4', 'F#4'] },
  /* 3  Em9    */ { bass: 'E2',  voicing: ['B2', 'G3', 'B3', 'F#4'] },
  /* 4  Bm7    */ { bass: 'B2',  voicing: ['F#3', 'A3', 'D4', 'F#4'] },
  /* 5  Cmaj9  */ { bass: 'C2',  voicing: ['G2', 'E3', 'B3', 'D4'] },
  /* 6  G/B    */ { bass: 'B2',  voicing: ['D3', 'G3', 'B3', 'D4'] },
  /* 7  Am9    */ { bass: 'A2',  voicing: ['E3', 'G3', 'B3', 'C4'] },
  /* 8  D13sus */ { bass: 'D2',  voicing: ['A2', 'G3', 'B3', 'E4'] },

  /* 9  Cmaj9  */ { bass: 'C2',  voicing: ['G2', 'E3', 'B3', 'D4'] },
  /* 10 D9/C   */ { bass: 'C3',  voicing: ['F#3', 'A3', 'D4', 'E4'] },
  /* 11 Bm7    */ { bass: 'B2',  voicing: ['F#3', 'A3', 'D4', 'F#4'] },
  /* 12 Em9    */ { bass: 'E2',  voicing: ['B2', 'G3', 'B3', 'F#4'] },
  /* 13 Am9    */ { bass: 'A2',  voicing: ['E3', 'G3', 'C4', 'E4'] },
  /* 14 Cm6    */ { bass: 'C3',  voicing: ['Eb3', 'G3', 'A3', 'D4'] },
  /* 15 Gmaj9/D*/ { bass: 'D2',  voicing: ['A2', 'F#3', 'B3', 'D4'] },
  /* 16 D9sus4 */ { bass: 'D2',  voicing: ['A2', 'G3', 'C4', 'F#4'] },
];

// 钢片琴主旋律：[音名, 起拍(0..3.5), 力度系数]
const MELODY = [
  /* 1  */ [['B5', 0, 0.92], ['D6', 1.0, 0.84], ['A5', 2.0, 0.88], ['G5', 3.5, 0.74]],
  /* 2  */ [['F#5', 0, 0.88], ['A5', 1.5, 0.78], ['D5', 2.5, 0.80]],
  /* 3  */ [['G5', 0, 0.90], ['B5', 1.0, 0.84], ['F#5', 2.0, 0.86], ['E5', 3.5, 0.74]],
  /* 4  */ [['D5', 0, 0.88], ['F#5', 2.0, 0.80], ['A5', 3.0, 0.78]],
  /* 5  */ [['E5', 0, 0.92], ['G5', 1.0, 0.85], ['B5', 2.0, 0.90], ['D6', 3.0, 0.84]],
  /* 6  */ [['B5', 0, 0.90], ['G5', 1.5, 0.80], ['D5', 2.5, 0.82]],
  /* 7  */ [['E5', 0, 0.88], ['G5', 1.0, 0.82], ['B5', 2.0, 0.88], ['A5', 3.5, 0.76]],
  /* 8  */ [['A5', 0, 0.88], ['G5', 1.5, 0.78], ['F#5', 2.5, 0.82]],

  /* 9  */ [['E6', 0, 0.96], ['D6', 1.0, 0.86], ['B5', 2.0, 0.90], ['G5', 3.5, 0.78]],
  /* 10 */ [['A5', 0, 0.92], ['B5', 1.5, 0.82], ['D6', 2.5, 0.90]],
  /* 11 */ [['F#6', 0, 0.94], ['D6', 1.0, 0.86], ['B5', 2.0, 0.88], ['A5', 3.5, 0.76]],
  /* 12 */ [['B5', 0, 0.90], ['G5', 1.5, 0.82], ['E5', 2.5, 0.80]],
  /* 13 */ [['C6', 0, 0.92], ['B5', 1.0, 0.85], ['A5', 2.0, 0.88], ['G5', 3.0, 0.82]],
  /* 14 */ [['A5', 0, 0.92], ['G5', 1.5, 0.82], ['Eb5', 2.5, 0.84], ['D5', 3.5, 0.76]],
  /* 15 */ [['B5', 0, 0.92], ['A5', 1.5, 0.82], ['G5', 2.5, 0.86]],
  /* 16 */ [['A5', 0, 0.86], ['D6', 1.5, 0.82], ['F#5', 2.75, 0.78]],
];

// B 段暖木马林巴轻柔弱拍回声
const MARIMBA_ECHO = [
  { bar: 9,  notes: [['G4', 1.5], ['B4', 2.5], ['D5', 3.0]] },
  { bar: 10, notes: [['F#4', 1.0], ['A4', 2.0], ['E5', 3.5]] },
  { bar: 11, notes: [['A4', 1.5], ['D5', 2.5], ['F#5', 3.0]] },
  { bar: 12, notes: [['G4', 1.0], ['B4', 2.0], ['D5', 3.5]] },
  { bar: 13, notes: [['E4', 1.5], ['G4', 2.5], ['C5', 3.5]] },
  { bar: 15, notes: [['F#4', 1.0], ['B4', 2.0], ['D5', 3.25]] },
];

// 乐句呼吸处的玻璃微风铃（第 4、8、12、16 小节尾拍）
const WIND_CHIMES = [
  { bar: 4,  beat: 3.1, notes: ['D6', 'F#6', 'A6', 'D7'], vel: 0.34 },
  { bar: 8,  beat: 3.1, notes: ['E6', 'G6', 'A6', 'D7'],  vel: 0.38 },
  { bar: 12, beat: 3.1, notes: ['E6', 'G6', 'B6', 'E7'],  vel: 0.36 },
  { bar: 16, beat: 3.15, notes: ['D6', 'G6', 'A6', 'B6', 'D7'], vel: 0.40 },
];

const barStart = b => b * BAR;
const isSecB = b => b >= 8;

// ───────────────────────────── 渲染总线 ─────────────────────────────

console.log(`[compose:bgm] 日系治愈 G 大调 ${BPM} BPM 4/4 · ${BARS} 小节 · ${(N / SR).toFixed(3)}s · ${N} samples @ ${SR}Hz`);

const piano = newBus();
const celesta = newBus();
const marimba = newBus();
const pad = newBus();
const chime = newBus();
const send = newBus();

// 1) 柔毡钢琴伴奏：舒缓八分音符呼吸分解型 [Bass, v0, v1, v2, v3, v1, v2, v0]
const PIANO_PATTERN = ['bass', 0, 1, 2, 3, 1, 2, 0];
for (let b = 0; b < BARS; b++) {
  const ch = CHORDS[b];
  const t0 = barStart(b);
  const barEnd = t0 + BAR;
  const secGain = isSecB(b) ? 1.0 : 0.92;

  for (let step = 0; step < 8; step++) {
    const pat = PIANO_PATTERN[step];
    const tNote = t0 + step * (BEAT * 0.5) + (b === 0 && step === 0 ? 0 : jitterSec(8));
    if (pat === 'bass') {
      const fBass = hz(ch.bass);
      const sBass = feltPianoNote(fBass, barEnd - tNote + 0.15, 0.84 * secGain);
      mixInto(piano, tNote, sBass, 1, -0.22, send, 0.24);
      // B 段首拍左手叠加柔和十度/五度温暖音色
      if (isSecB(b)) {
        const fWarm = hz(ch.voicing[0]);
        const sWarm = feltPianoNote(fWarm, BEAT * 2.2, 0.52 * secGain);
        mixInto(piano, tNote + 0.014, sWarm, 1, -0.08, send, 0.26);
      }
    } else {
      const name = ch.voicing[pat];
      const f = hz(name);
      const beatAccent = step === 4 ? 0.78 : step % 2 === 0 ? 0.70 : 0.60;
      const vel = beatAccent * (0.88 + rand() * 0.1) * secGain;
      const hold = Math.max(BEAT * 0.85, barEnd - tNote);
      const pan = -0.16 + pat * 0.11;
      const s = feltPianoNote(f, hold, vel);
      mixInto(piano, tNote, s, 1, pan, send, 0.28);
    }
  }
}

// 2) 钢片琴主旋律（B 段强拍叠加柔毡钢琴高音轻触同度共鸣，让旋律既清透又温暖亲切）
for (let b = 0; b < BARS; b++) {
  for (const [name, beat, velMul = 1] of MELODY[b]) {
    const t = barStart(b) + beat * BEAT + (b === 0 && beat === 0 ? 0 : jitterSec(6));
    const f = hz(name);
    const vel = velMul * (0.92 + rand() * 0.08);
    mixInto(celesta, t, celestaNote(f, vel), 1, 0.18, send, 0.42);
    if (isSecB(b) && (beat === 0 || beat === 2)) {
      const sDouble = feltPianoNote(f / 2, BEAT * 1.6, vel * 0.44);
      mixInto(piano, t + 0.008, sDouble, 1, 0.06, send, 0.34);
    }
  }
}

// 3) B 段暖木马林巴轻巧对位点缀
for (const mBar of MARIMBA_ECHO) {
  const t0 = barStart(mBar.bar - 1);
  for (const [name, beat] of mBar.notes) {
    const t = t0 + beat * BEAT + jitterSec(5);
    mixInto(marimba, t, marimbaNote(hz(name), 0.58 + rand() * 0.08), 1, -0.28, send, 0.36);
  }
}

// 4) B 段柔雾暖调铺底 Pad
for (let b = 8; b < BARS; b++) {
  const ch = CHORDS[b];
  const tones = [ch.voicing[0], ch.voicing[1], ch.voicing[2]];
  const hold = BAR + 0.18;
  const vel = b >= 14 ? 0.84 : 0.96;
  for (const name of tones) {
    const f = hz(name);
    mixInto(pad, barStart(b), healingPadVoice(f, hold, -6, vel), 1, -0.5, send, 0.48);
    mixInto(pad, barStart(b), healingPadVoice(f, hold, +6, vel), 1, 0.5, send, 0.48);
  }
}

// 5) 玻璃微风铃过门
for (const wc of WIND_CHIMES) {
  wc.notes.forEach((name, k) => {
    const t = barStart(wc.bar - 1) + wc.beat * BEAT + k * 0.085 + jitterSec(4);
    const pan = -0.35 + (0.7 * k) / Math.max(1, wc.notes.length - 1);
    mixInto(chime, t, glassChimeNote(hz(name), wc.vel * (0.85 + 0.15 * (k / wc.notes.length))), 1, pan, send, 0.62);
  });
}

// ───────────────────────────── 分轨音色塑形 & 平衡 ─────────────────────────────

// 柔毡钢琴：温暖木音板共鸣 + 羊毛毡柔和上限
filterBus(piano,
  biquad('highpass', 52, 0.7071),
  biquad('peaking', 220, 1.0, 2.2),
  biquad('lowpass', 3100, 0.7071));

// 钢片琴：清透圆润，柔化极高频
filterBus(celesta,
  biquad('highpass', 310, 0.7071),
  biquad('highshelf', 5800, 0.7071, -3.5));

// 马林巴：温润中频木质感
filterBus(marimba,
  biquad('highpass', 180, 0.7071),
  biquad('lowpass', 3400, 0.7071));

// 柔雾 Pad：只做深层温暖呼吸包裹
filterBus(pad,
  biquad('highpass', 110, 0.7071),
  biquad('lowpass', 1120, 0.7071));

// 玻璃风铃：轻盈星尘空气感
filterBus(chime,
  biquad('highpass', 900, 0.7071),
  biquad('highshelf', 7200, 0.7071, -2.5));

const pianoRms = busRms(piano);
scaleBus(celesta, (pianoRms * 0.74) / Math.max(1e-9, busRms(celesta)));
scaleBus(marimba, (pianoRms * 0.24) / Math.max(1e-9, busRms(marimba)));
scaleBus(pad, (pianoRms * 0.32) / Math.max(1e-9, busRms(pad)));
scaleBus(chime, (busPeak(piano) * 0.28) / Math.max(1e-9, busPeak(chime)));

// ───────────────────────────── 星夜玻璃工坊环形混响（Freeverb） ─────────────────────────────

function freeverbCircular(sendBus, { room = 0.86, damp = 0.36, spread = 23 } = {}) {
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

send.L.fill(0);
send.R.fill(0);
for (const [bus, amt] of [
  [piano, 0.28],
  [celesta, 0.46],
  [marimba, 0.34],
  [pad, 0.52],
  [chime, 0.62],
]) {
  for (let i = 0; i < N; i++) {
    send.L[i] += bus.L[i] * amt;
    send.R[i] += bus.R[i] * amt;
  }
}
console.log('[compose:bgm] 渲染星夜工坊治愈空间混响（环形两遍无缝）...');
const rev = freeverbCircular(send);
filterBus(rev, biquad('highpass', 210, 0.7071), biquad('lowpass', 4800, 0.7071));
scaleBus(rev, (pianoRms * 0.56) / Math.max(1e-9, busRms(rev)));

// ───────────────────────────── 母带处理 ─────────────────────────────

const master = newBus();
for (const bus of [piano, celesta, marimba, pad, chime, rev]) {
  for (let i = 0; i < N; i++) {
    master.L[i] += bus.L[i];
    master.R[i] += bus.R[i];
  }
}
filterBus(master,
  biquad('highpass', 38, 0.7071),
  biquad('lowshelf', 175, 0.7071, 1.4),
  // 为流沙白噪音 synth_sand_asmr（1.8~3.6kHz）主动让出清透空间
  biquad('peaking', 2700, 0.75, -7),
  biquad('highshelf', 7800, 0.7071, -2));

let pk = busPeak(master);
const preGain = 0.9 / pk;
const knee = 0.72;
const soft = x => {
  const a = Math.abs(x);
  if (a <= knee) return x;
  return Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
};
for (let i = 0; i < N; i++) {
  master.L[i] = soft(master.L[i] * preGain * 1.22);
  master.R[i] = soft(master.R[i] * preGain * 1.22);
}
pk = busPeak(master);
scaleBus(master, Math.pow(10, -1.5 / 20) / pk);

const finalRms = busRms(master);
const seamJump = Math.max(Math.abs(master.L[N - 1] - master.L[0]), Math.abs(master.R[N - 1] - master.R[0]));
console.log(`[compose:bgm] 母带 RMS ${(20 * Math.log10(finalRms)).toFixed(1)} dBFS · 峰值 -1.5 dBFS · 循环接缝跳变 ${seamJump.toExponential(2)}`);

// ───────────────────────────── 导出 MP3 ─────────────────────────────

function writeWav16(file, bus) {
  const data = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
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
