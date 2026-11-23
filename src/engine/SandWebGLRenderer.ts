import type { SandPaletteEntry, UiTokensFile } from '../types/ui';
import {
  BOARD_BASE,
  EMPTY,
  FROZEN_BASE,
  GH,
  GOLD_SAND,
  GW,
  TOTAL_CELLS,
  WALL,
  isSand,
} from './SandGrid';
import type { SandEngine } from './SandEngine';

const TEX_SIZE = 256;

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

uniform sampler2D u_fieldTex;
uniform sampler2D u_cellTex;
uniform vec2 u_gridSize;
uniform float u_pxPerCell;
uniform float u_time;

uniform vec3 u_base1; uniform vec3 u_hi1; uniform vec3 u_sh1;
uniform vec3 u_base2; uniform vec3 u_hi2; uniform vec3 u_sh2;
uniform vec3 u_base3; uniform vec3 u_hi3; uniform vec3 u_sh3;
uniform vec3 u_base4; uniform vec3 u_hi4; uniform vec3 u_sh4;
uniform vec3 u_base5; uniform vec3 u_hi5; uniform vec3 u_sh5;

const float INV_TEX = 1.0 / 256.0;

void getSandPalette(int cid, out vec3 baseC, out vec3 hiC, out vec3 shC) {
  if (cid == 1) { baseC = u_base1; hiC = u_hi1; shC = u_sh1; }
  else if (cid == 2) { baseC = u_base2; hiC = u_hi2; shC = u_sh2; }
  else if (cid == 3) { baseC = u_base3; hiC = u_hi3; shC = u_sh3; }
  else if (cid == 4) { baseC = u_base4; hiC = u_hi4; shC = u_sh4; }
  else { baseC = u_base5; hiC = u_hi5; shC = u_sh5; }
}

vec3 hashGrain(float seedByte, vec2 subSlot) {
  float k = seedByte * 19.0 + subSlot.x * 67.0 + subSlot.y * 137.0 + 23.0;
  float h1 = fract(sin(k * 12.9898) * 43758.5453);
  float h2 = fract(sin((k + 41.0) * 78.233) * 24634.6345);
  float h3 = fract(sin((k + 97.0) * 39.346) * 19532.1731);
  return vec3(h1, h2, h3);
}

vec4 pickCell3x3(
  vec2 off,
  vec4 c00, vec4 c10, vec4 c20,
  vec4 c01, vec4 c11, vec4 c21,
  vec4 c02, vec4 c12, vec4 c22
) {
  if (off.y < -0.5) {
    if (off.x < -0.5) return c00;
    if (off.x > 0.5) return c20;
    return c10;
  }
  if (off.y > 0.5) {
    if (off.x < -0.5) return c02;
    if (off.x > 0.5) return c22;
    return c12;
  }
  if (off.x < -0.5) return c01;
  if (off.x > 0.5) return c21;
  return c11;
}

void accumColorWeight(
  float matVal,
  float w,
  inout float w1,
  inout float w2,
  inout float w3,
  inout float w4,
  inout float w5,
  inout float wIce
) {
  if (matVal < 0.5) return;
  float cid = matVal;
  if (matVal >= 10.5) {
    wIce += w;
    cid = matVal - 10.0;
  }
  if (cid < 1.5) w1 += w;
  else if (cid < 2.5) w2 += w;
  else if (cid < 3.5) w3 += w;
  else if (cid < 4.5) w4 += w;
  else w5 += w;
}

void main() {
  vec2 gPos = v_uv * u_gridSize;
  if (gPos.y < 5.0 || gPos.y > u_gridSize.y - 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 fUv = gPos * INV_TEX;
  float o = 0.72 * INV_TEX;

  vec4 f0 = texture2D(u_fieldTex, fUv);
  vec4 f1 = texture2D(u_fieldTex, fUv + vec2(-o, -o));
  vec4 f2 = texture2D(u_fieldTex, fUv + vec2( o, -o));
  vec4 f3 = texture2D(u_fieldTex, fUv + vec2(-o,  o));
  vec4 f4 = texture2D(u_fieldTex, fUv + vec2( o,  o));

  // CPU 已做 5x3 预平滑，叠加 GPU 5-tap 双线性滤波后等效 7x5 双三次密度场，斜坡 100% 丝滑无阶梯
  float sdf = f0.b * 0.32 + (f1.b + f2.b + f3.b + f4.b) * 0.17;

  vec2 cCenter = floor(gPos);
  vec2 cUv = (cCenter + 0.5) * INV_TEX;
  vec4 c11 = texture2D(u_cellTex, cUv);

  if (sdf < 0.04 && c11.r < 0.002) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // 一次性读取 3x3 邻域材质与随流颗粒种子
  vec4 c00 = texture2D(u_cellTex, cUv + vec2(-INV_TEX, -INV_TEX));
  vec4 c10 = texture2D(u_cellTex, cUv + vec2( 0.0,     -INV_TEX));
  vec4 c20 = texture2D(u_cellTex, cUv + vec2( INV_TEX, -INV_TEX));
  vec4 c01 = texture2D(u_cellTex, cUv + vec2(-INV_TEX,  0.0));
  vec4 c21 = texture2D(u_cellTex, cUv + vec2( INV_TEX,  0.0));
  vec4 c02 = texture2D(u_cellTex, cUv + vec2(-INV_TEX,  INV_TEX));
  vec4 c12 = texture2D(u_cellTex, cUv + vec2( 0.0,      INV_TEX));
  vec4 c22 = texture2D(u_cellTex, cUv + vec2( INV_TEX,  INV_TEX));

  float airDepth = f0.r * 0.36 + (f1.r + f2.r + f3.r + f4.r) * 0.16;
  float aoVal = f0.g * 0.36 + (f1.g + f2.g + f3.g + f4.g) * 0.16;
  float flowSpd = f0.a * 0.44 + (f1.a + f2.a + f3.a + f4.a) * 0.14;

  // 第一层：每格 2x2 主石英砂粒（直径约 2.4~2.8 物理像素，肉眼清晰可辨真实砂糖颗粒感，随物理位移真实滚动）
  vec2 mPos = gPos * 2.0;
  vec2 mBase = floor(mPos);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 bestVec = vec2(0.0);
  float bestTrait = 0.5;
  float bestHueJit = 0.5;
  float bestGrainMat = 0.0;

  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 m = mBase + vec2(float(ox), float(oy));
      vec2 pCell = floor(m * 0.5);
      vec2 pOff = pCell - cCenter;
      vec4 cd = pickCell3x3(pOff, c00, c10, c20, c01, c11, c21, c02, c12, c22);
      vec2 subSlot = m - pCell * 2.0;
      vec3 rnd = hashGrain(floor(cd.g * 255.0 + 0.5), subSlot);
      vec2 center = m + 0.5 + (rnd.xy - 0.5) * 0.78;
      vec2 dv = mPos - center;
      dv.y *= mix(1.0, 0.60, flowSpd);
      // 轻微多边形石英晶面扰动（让砂粒呈自然微棱角石英砂糖而非呆板圆珠）
      float facet = 1.0 + 0.09 * sin(atan(dv.y, dv.x + 0.0001) * 5.0 + rnd.z * 6.283);
      float dist = length(dv) * facet;
      if (dist < d1) {
        d2 = d1;
        d1 = dist;
        bestVec = dv;
        bestTrait = rnd.z;
        bestHueJit = rnd.x;
        bestGrainMat = floor(cd.r * 255.0 + 0.5);
      } else if (dist < d2) {
        d2 = dist;
      }
    }
  }

  // 第二层：附着在每颗砂粒局部坐标上的极细干爽矿砂微噪（随砂粒同步运动，消除塑料光滑感）
  vec2 microCell = floor(bestVec * 3.2 + bestTrait * 17.0);
  float dryGrit = fract(sin(dot(microCell, vec2(127.1, 311.7)) + bestHueJit * 53.0) * 43758.5453) - 0.5;

  // 平滑多色地层权重（消除不同颜色沙层交界处的网格锯齿，并让交界砂粒自然咬合）
  vec2 fLocal = fract(gPos) - 0.5;
  float wx0 = clamp(0.5 - fLocal.x, 0.0, 1.0);
  float wx2 = clamp(0.5 + fLocal.x, 0.0, 1.0);
  wx0 = wx0 * wx0;
  wx2 = wx2 * wx2;
  float wx1 = 1.12 - 0.55 * fLocal.x * fLocal.x;

  float wy0 = clamp(0.5 - fLocal.y, 0.0, 1.0);
  float wy2 = clamp(0.5 + fLocal.y, 0.0, 1.0);
  wy0 = wy0 * wy0;
  wy2 = wy2 * wy2;
  float wy1 = 1.12 - 0.55 * fLocal.y * fLocal.y;

  float w1 = 0.0, w2 = 0.0, w3 = 0.0, w4 = 0.0, w5 = 0.0, wIce = 0.0;
  accumColorWeight(floor(c00.r * 255.0 + 0.5), wx0 * wy0, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c10.r * 255.0 + 0.5), wx1 * wy0, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c20.r * 255.0 + 0.5), wx2 * wy0, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c01.r * 255.0 + 0.5), wx0 * wy1, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c11.r * 255.0 + 0.5), wx1 * wy1, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c21.r * 255.0 + 0.5), wx2 * wy1, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c02.r * 255.0 + 0.5), wx0 * wy2, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c12.r * 255.0 + 0.5), wx1 * wy2, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c22.r * 255.0 + 0.5), wx2 * wy2, w1, w2, w3, w4, w5, wIce);

  float grainBias = 0.22 * smoothstep(0.58, 0.18, d1);
  if (bestGrainMat >= 0.5) {
    float gCid = bestGrainMat >= 10.5 ? bestGrainMat - 10.0 : bestGrainMat;
    if (gCid < 1.5) w1 += grainBias;
    else if (gCid < 2.5) w2 += grainBias;
    else if (gCid < 3.5) w3 += grainBias;
    else if (gCid < 4.5) w4 += grainBias;
    else w5 += grainBias;
  }

  float totalW = w1 + w2 + w3 + w4 + w5;
  if (totalW < 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  int cid = 1;
  float bestW = w1;
  float secondW = 0.0;
  if (w2 > bestW) { secondW = bestW; bestW = w2; cid = 2; } else if (w2 > secondW) { secondW = w2; }
  if (w3 > bestW) { secondW = bestW; bestW = w3; cid = 3; } else if (w3 > secondW) { secondW = w3; }
  if (w4 > bestW) { secondW = bestW; bestW = w4; cid = 4; } else if (w4 > secondW) { secondW = w4; }
  if (w5 > bestW) { secondW = bestW; bestW = w5; cid = 5; } else if (w5 > secondW) { secondW = w5; }

  bool isFrozen = wIce > totalW * 0.45;

  // 露天沙脊轮廓：平滑沙丘曲线 + 自然微起伏 + 顶沿圆润散砂颗粒感
  float openSurface = clamp(1.0 - airDepth * 4.5, 0.0, 1.0);
  float pourWave = sin(gPos.x * 0.21 + sin(gPos.y * 0.09) * 1.4) * 0.022 * openSurface;
  float grainEdge = (0.49 - d1) * 0.17 * openSurface;
  float effSdf = sdf + pourWave + grainEdge;

  // 细流与散落砂滴：在稀疏下落流中渲染颗颗饱满的跳跃细砂粒（还原设计图斜板散砂与穿环砂滴）
  float rawSolid = c11.b;
  if (rawSolid > 0.5 && sdf < 0.52) {
    float dropField = 0.485 + (0.50 - d1) * 0.52;
    effSdf = max(effSdf, dropField);
  }

  float aa = clamp(1.10 / max(2.2, u_pxPerCell), 0.016, 0.058);
  float alpha = smoothstep(0.48 - aa, 0.48 + aa, effSdf);
  if (alpha <= 0.003) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 baseCol, hiCol, shCol;
  getSandPalette(cid, baseCol, hiCol, shCol);

  if (isFrozen) {
    vec3 iceBase = mix(baseCol, vec3(0.83, 0.95, 1.0), 0.62);
    vec3 iceRim = mix(iceBase, vec3(1.0, 1.0, 1.0), 0.56);
    float rim = clamp((0.58 - sdf) * 3.0, 0.0, 1.0) + smoothstep(0.42, 0.12, d1) * 0.16;
    vec3 iceRgb = mix(iceBase, iceRim, clamp(rim, 0.0, 1.0));
    float iceA = alpha * 0.94;
    gl_FragColor = vec4(iceRgb * iceA, iceA);
    return;
  }

  // 2.5D 沙丘法线重建（墙边 airDepth 已做同值钳制，零器壁假竖条，纯正表现露天沙丘坡向明暗）
  float dAirDx = (f2.r + f4.r) - (f1.r + f3.r);
  float dAirDy = (f3.r + f4.r) - (f1.r + f2.r);
  float dSdfDx = (f1.b + f3.b) - (f2.b + f4.b);
  float dSdfDy = (f1.b + f2.b) - (f3.b + f4.b);

  // 仅在露天附近启用 sdf 边缘圆角，柔和结合空气距离梯度，消除折角处八方向折痕
  vec2 slope2D = vec2(
    -dAirDx * 2.10 + dSdfDx * 0.90 * openSurface,
    -dAirDy * 1.80 + dSdfDy * 1.00 * openSurface
  );
  vec3 duneN = normalize(vec3(slope2D, 0.56));
  vec3 lightDir = normalize(vec3(-0.48, -0.74, 0.47));
  float ndl = dot(duneN, lightDir);

  float sunSlope = smoothstep(-0.12, 0.76, ndl);
  float shadeSlope = smoothstep(0.25, -0.56, ndl);

  // 流沙瓶手作水粉沉积沙纹：同一色系内柔和波浪层理，边缘随砂粒自然参差（告别死板单色矩形）
  float wavePhase =
    gPos.y * 0.145 +
    gPos.x * 0.038 +
    sin(gPos.x * 0.075 + float(cid) * 1.7) * 1.75 +
    (bestTrait - 0.5) * 0.55;
  float sandBand = sin(wavePhase) * 0.5 + sin(wavePhase * 2.1 + 1.1) * 0.25;

  vec3 col = baseCol;
  float darkMix = clamp(
    shadeSlope * 0.42 + aoVal * 0.42 + airDepth * 0.16 - sandBand * 0.11,
    0.0,
    0.72
  );
  float lightMix = clamp(
    (sunSlope - 0.30) * 0.58 * (1.0 - aoVal * 0.5) + sandBand * 0.12,
    0.0,
    0.66
  );
  col = mix(col, shCol, darkMix);
  col = mix(col, hiCol, lightMix);

  // 露天沙丘受光脊柔和粉彩亮带
  float crestBand = exp(-airDepth * 7.5) * clamp(-duneN.y * 0.7 + 0.42, 0.0, 1.0) * (1.0 - aoVal * 0.65);
  col = mix(col, hiCol, crestBand * 0.46);
  float rimSpark = smoothstep(0.57, 0.48, effSdf) * openSurface * clamp(-duneN.y + 0.32, 0.0, 1.0);
  col = mix(col, mix(hiCol, vec3(1.0, 0.985, 0.94), 0.36), rimSpark * 0.44);

  // 两色流沙交界处自然接触微暗
  if (secondW > 0.02) {
    float seam = clamp(1.0 - (bestW - secondW) / max(0.08, totalW * 0.36), 0.0, 1.0);
    col = mix(col, shCol, seam * 0.20);
  }

  // ===== 核心：高清真实石英砂糖颗粒质感（1x 正常视距即清晰呈现丰富砂砾层次，干爽不糊不塑料） =====
  float grainAmp = mix(0.24, 0.34, clamp(openSurface * 0.65 + flowSpd * 0.85, 0.0, 1.0));
  if (cid == 5) grainAmp *= 1.24;

  // 单颗砂粒左上受光、右下微暗 + 砂粒间隙（d2 - d1 小处）自然咬合暗缝
  vec2 gNorm2D = bestVec / max(0.20, d1 + 0.15);
  float grainLit = clamp(dot(gNorm2D, vec2(0.60, 0.80)) * 0.5 + 0.5, 0.0, 1.0);
  float borderGap = 1.0 - smoothstep(0.0, 0.17, d2 - d1);

  vec3 grainHi = mix(hiCol, vec3(1.0, 0.988, 0.945), cid == 5 ? 0.42 : 0.20);
  vec3 grainDark = mix(shCol, baseCol, 0.18);

  // 按颗粒自身矿物属性分为暖暗砂砾 / 主色砂 / 清透亮砂三阶，叠加球面受光与干爽矿砂微面
  if (bestTrait < 0.30) {
    float wDark = (0.30 - bestTrait) / 0.30;
    col = mix(col, grainDark, wDark * grainAmp * (0.65 + 0.35 * (1.0 - grainLit)));
  } else if (bestTrait > 0.66) {
    float wBright = (bestTrait - 0.66) / 0.34;
    col = mix(col, grainHi, wBright * grainAmp * (0.50 + 0.50 * grainLit));
  }

  // 每颗砂粒自身的微妙凹凸受光与颗粒缝隙暗影（赋予整片沙堆蓬松透气砂糖质感）
  col = mix(col, grainHi, clamp(grainLit - 0.50, 0.0, 0.5) * grainAmp * 0.68 * smoothstep(0.52, 0.10, d1));
  col = mix(col, grainDark, borderGap * grainAmp * 0.52);
  col += dryGrit * (0.045 + 0.025 * openSurface);

  // 晶莹石英闪砂点（表层受光带、流动沙束与流金沙中点缀温润细闪星砂）
  float sparkThresh = cid == 5 ? 0.82 : mix(0.945, 0.885, clamp(openSurface + flowSpd, 0.0, 1.0));
  float glintMask = step(sparkThresh, bestTrait) * smoothstep(0.32, 0.07, d1);
  if (glintMask > 0.001) {
    float twinkle = cid == 5
      ? 0.58 + 0.42 * sin(u_time * 3.8 + bestTrait * 97.0 + bestHueJit * 31.0)
      : 0.48 + 0.36 * openSurface + 0.24 * flowSpd;
    col = mix(col, vec3(1.0, 0.99, 0.93), glintMask * twinkle * (cid == 5 ? 0.76 : 0.52));
  }

  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

/**
 * 轻量原生 WebGL 1.0（GLSL ES 1.00）高清流沙片元着色渲染器：
 * - 零第三方库，兼容 iOS Ejecta / Android V8 Skia 微信小游戏与现代浏览器
 * - 物理保持 150×168 确定性元胞网格，渲染按屏幕真实 DPR 全分辨率逐像素计算：
 *   1. CPU 5×3 预平滑 + GPU 5-tap 双线性密度场（SDF）彻底消除 30°/45° 斜坡与多色交界锯齿
 *   2. 仅在真实沙体内传播空气深度梯度（器壁法线归零无假边框），呈现自然 2.5D 沙丘受光/背光面与沉积沙纹
 *   3. 每格 2×2 多棱石英砂糖颗粒 + 局部随流微晶噪面，运动时随沙粒真实滚落，静止时 100% 稳定干爽细腻
 */
export class SandWebGLRenderer {
  public readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly posBuf: WebGLBuffer;
  private readonly fieldTex: WebGLTexture;
  private readonly cellTex: WebGLTexture;
  private readonly aPosLoc: number;

  private readonly uGridSize: WebGLUniformLocation | null;
  private readonly uPxPerCell: WebGLUniformLocation | null;
  private readonly uTime: WebGLUniformLocation | null;

  private readonly visColor = new Uint8Array(TOTAL_CELLS);
  private readonly visSeed = new Uint8Array(TOTAL_CELLS);
  private readonly rawSolid = new Uint8Array(TOTAL_CELLS);
  private readonly realSandMask = new Uint8Array(TOTAL_CELLS);
  private readonly airRaw = new Float32Array(TOTAL_CELLS);
  private readonly airTmp = new Float32Array(TOTAL_CELLS);
  private readonly aoRaw = new Float32Array(TOTAL_CELLS);
  private readonly aoTmp = new Float32Array(TOTAL_CELLS);
  private readonly solidRaw = new Float32Array(TOTAL_CELLS);
  private readonly solidTmp = new Float32Array(TOTAL_CELLS);
  private readonly fieldUpload = new Uint8Array(GW * GH * 4);
  private readonly cellUpload = new Uint8Array(GW * GH * 4);
  private funnelScroll = 0;
  private hasGoldSand = false;
  private uploadedOnce = false;

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    posBuf: WebGLBuffer,
    fieldTex: WebGLTexture,
    cellTex: WebGLTexture,
    tokens: UiTokensFile
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.posBuf = posBuf;
    this.fieldTex = fieldTex;
    this.cellTex = cellTex;
    this.aPosLoc = gl.getAttribLocation(program, 'a_pos');
    this.uGridSize = gl.getUniformLocation(program, 'u_gridSize');
    this.uPxPerCell = gl.getUniformLocation(program, 'u_pxPerCell');
    this.uTime = gl.getUniformLocation(program, 'u_time');

    gl.useProgram(program);
    const uField = gl.getUniformLocation(program, 'u_fieldTex');
    const uCell = gl.getUniformLocation(program, 'u_cellTex');
    if (uField) gl.uniform1i(uField, 0);
    if (uCell) gl.uniform1i(uCell, 1);
    if (this.uGridSize) gl.uniform2f(this.uGridSize, GW, GH);

    this.applyPaletteUniforms(tokens);
  }

  public static tryCreate(
    tokens: UiTokensFile,
    createCanvasFn: () => HTMLCanvasElement
  ): SandWebGLRenderer | null {
    try {
      const canvas = createCanvasFn();
      canvas.width = GW * 2;
      canvas.height = GH * 2;
      const attrs: WebGLContextAttributes = {
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        antialias: false,
        depth: false,
        stencil: false,
      };
      const gl =
        (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null) ||
        (canvas.getContext('experimental-webgl', attrs) as WebGLRenderingContext | null);
      if (!gl || typeof gl.createShader !== 'function') return null;

      const vs = SandWebGLRenderer.compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
      const fs = SandWebGLRenderer.compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      if (!vs || !fs) return null;

      const program = gl.createProgram();
      if (!program) return null;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return null;
      }

      const posBuf = gl.createBuffer();
      const fieldTex = gl.createTexture();
      const cellTex = gl.createTexture();
      if (!posBuf || !fieldTex || !cellTex) return null;

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );

      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      const zeroTex = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        TEX_SIZE,
        TEX_SIZE,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        zeroTex
      );

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, cellTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        TEX_SIZE,
        TEX_SIZE,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        zeroTex
      );

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      return new SandWebGLRenderer(canvas, gl, program, posBuf, fieldTex, cellTex, tokens);
    } catch {
      return null;
    }
  }

  private static compileShader(
    gl: WebGLRenderingContext,
    type: number,
    src: string
  ): WebGLShader | null {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  private applyPaletteUniforms(tokens: UiTokensFile): void {
    const gl = this.gl;
    const inkRgb = hexToRgb01(tokens.theme.inkOutline || '#4E2E18');
    for (let cid = 1; cid <= 5; cid++) {
      const entry = tokens.sandPalette[String(cid)] as SandPaletteEntry | undefined;
      const base = hexToRgb01(entry?.baseHex || '#F2648A');
      const hi = hexToRgb01(entry?.highlightHex || '#FFA3BC');
      const sh = lerp3(hexToRgb01(entry?.shadowHex || '#CC3F66'), inkRgb, 0.06);

      const bLoc = gl.getUniformLocation(this.program, `u_base${cid}`);
      const hLoc = gl.getUniformLocation(this.program, `u_hi${cid}`);
      const sLoc = gl.getUniformLocation(this.program, `u_sh${cid}`);
      if (bLoc) gl.uniform3f(bLoc, base[0], base[1], base[2]);
      if (hLoc) gl.uniform3f(hLoc, hi[0], hi[1], hi[2]);
      if (sLoc) gl.uniform3f(sLoc, sh[0], sh[1], sh[2]);
    }
  }

  private hashSeed(rawShade: number): number {
    let h = (rawShade * 197 + 89) & 0xff;
    h = ((h ^ (h >> 4)) * 163) & 0xff;
    return h ^ (h >> 5);
  }

  private buildUploadBuffers(engine: SandEngine): void {
    const g = engine.grid;
    const sh = engine.shade;
    const vel = engine.vel;
    const inter = engine.interior;

    const vc = this.visColor;
    const vs = this.visSeed;
    const rs = this.rawSolid;
    const rsm = this.realSandMask;
    const airR = this.airRaw;
    const airT = this.airTmp;
    const aoR = this.aoRaw;
    const aoT = this.aoTmp;
    const solR = this.solidRaw;
    const solT = this.solidTmp;

    vc.fill(0);
    vs.fill(0);
    rs.fill(0);
    rsm.fill(0);
    let goldFound = false;

    for (let i = 0; i < TOTAL_CELLS; i++) {
      const v = g[i];
      if (isSand(v)) {
        vc[i] = v;
        vs[i] = this.hashSeed(sh[i]);
        rs[i] = 255;
        rsm[i] = 1;
        if (v === GOLD_SAND) goldFound = true;
      } else if (v >= FROZEN_BASE) {
        const ic = engine.ice[v - FROZEN_BASE];
        vc[i] = 10 + (ic ? ic.color : 3);
        vs[i] = this.hashSeed(sh[i]);
        rs[i] = 255;
        rsm[i] = 1;
      }
    }
    this.hasGoldSand = goldFound;

    // 1. 密实下落柱内部 1~3 格微空隙弥合（先于墙体外扩执行）
    for (let y = 7; y < GH - 2; y++) {
      const row = y * GW;
      for (let x = 2; x < GW - 2; x++) {
        const i = row + x;
        if (g[i] !== EMPTY || !inter[i]) continue;
        const up1 = g[i - GW];
        const dn1 = g[i + GW];
        const lf1 = g[i - 1];
        const rt1 = g[i + 1];
        const a1 = isSand(up1);
        const a2 = !a1 && up1 === EMPTY && isSand(g[i - GW * 2]);
        const b1 = isSand(dn1);
        const b2 = !b1 && dn1 === EMPTY && isSand(g[i + GW * 2]);
        const b3 =
          !b1 && !b2 && y + 3 < GH && dn1 === EMPTY && g[i + GW * 2] === EMPTY && isSand(g[i + GW * 3]);
        const vertical = (a1 && (b1 || b2 || b3)) || (a2 && (b1 || b2));
        const narrowShaft = isSand(lf1) && isSand(rt1) && (a1 || b1);
        if (!vertical && !narrowShaft) continue;
        const src = a1 ? i - GW : b1 ? i + GW : isSand(lf1) ? i - 1 : a2 ? i - GW * 2 : i + GW * 2;
        vc[i] = g[src];
        vs[i] = this.hashSeed(sh[src]);
        rsm[i] = 1;
      }
    }

    // 2. 仅向紧贴真实沙粒的 1 格墙体/木板外扩（紧贴玻璃内沿与木板零黑缝，且绝不跨墙渗入空腔）
    for (let y = 1; y < GH - 1; y++) {
      const row = y * GW;
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x;
        const v = g[i];
        if (vc[i] !== 0) continue;
        if (v === WALL || (v >= BOARD_BASE && v < FROZEN_BASE)) {
          let nb = -1;
          if (rsm[i - GW]) nb = i - GW;
          else if (rsm[i + GW]) nb = i + GW;
          else if (rsm[i - 1]) nb = i - 1;
          else if (rsm[i + 1]) nb = i + 1;
          if (nb >= 0) {
            vc[i] = vc[nb];
            vs[i] = vs[nb];
          }
        }
      }
    }
    // 2b. 仅对底部漏斗斜坡段（y >= 139）墙体再向下补齐 1 格，消除斜面台阶微缝而不污染侧壁
    for (let y = GH - 2; y >= 139; y--) {
      const row = y * GW;
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x;
        if (g[i] !== WALL || vc[i] !== 0 || g[i - GW] !== WALL || vc[i - GW] === 0) continue;
        vc[i] = vc[i - GW];
        vs[i] = vs[i - GW];
      }
    }

    // 3. 底部梳齿滤网底缘贴合
    if (engine.lastFlowParticles > 0 || engine.pourStreamMs > 0) {
      this.funnelScroll = (this.funnelScroll + 0.7 + Math.min(50, engine.lastFlowParticles) * 0.05) % 1700;
    }
    const scroll = this.funnelScroll | 0;
    for (let x = 18; x <= 131; x++) {
      const topRef = g[(GH - 3) * GW + x];
      const botRef = g[(GH - 2) * GW + x];
      const refColor = isSand(botRef) ? botRef : isSand(topRef) ? topRef : 0;
      if (refColor >= 1 && refColor <= 5) {
        const idx = (GH - 2) * GW + x;
        if (vc[idx] === 0) {
          vc[idx] = refColor;
          vs[idx] = ((x * 73 + (scroll % 29) * 19) & 0xff) >>> 0;
          rsm[idx] = 1;
        }
      }
    }

    // 4. 二维各向同性倒角距离场（2D Chamfer Distance Transform）计算空气受光深度与接触暗部 AO：
    //    彻底取代单列 1D 竖直扫描，任何斜板/沙漏腰部悬挑下方均自然二维绕射过渡，100% 根除竖向明暗分界条！
    for (let i = 0; i < TOTAL_CELLS; i++) {
      solR[i] = vc[i] >= 1 ? 255 : 0;
      airR[i] = 255;
      aoR[i] = 255;
    }

    for (let y = 6; y < GH - 1; y++) {
      const row = y * GW;
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x;
        const v = g[i];
        // 开阔内腔空气作为受光源（排除仅 1 格宽的孤立微隙）
        if (v === EMPTY && inter[i] && rsm[i] === 0) {
          const openNb =
            (g[i - 1] === EMPTY && rsm[i - 1] === 0 ? 1 : 0) +
            (g[i + 1] === EMPTY && rsm[i + 1] === 0 ? 1 : 0) +
            (g[i - GW] === EMPTY && rsm[i - GW] === 0 ? 1 : 0) +
            (g[i + GW] === EMPTY && rsm[i + GW] === 0 ? 1 : 0);
          if (openNb >= 2) {
            airR[i] = 0;
          }
        }
        // 木板、静态隔墙与容器底壁作为柔和接触环境光遮蔽（AO）源
        if (v === WALL || (v >= BOARD_BASE && v < FROZEN_BASE)) {
          aoR[i] = 0;
        }
      }
    }

    // 正向扫描（自上而下、自左而右）：顶光权重略轻（6.2/格），侧光（8.2/格），形成自然顶受光沙丘体积
    for (let y = 6; y < GH - 1; y++) {
      const row = y * GW;
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x;
        if (rsm[i] === 1) {
          let d = airR[i];
          const dUp = airR[i - GW] + 6.2;
          const dLf = airR[i - 1] + 8.2;
          const dUL = airR[i - GW - 1] + 9.8;
          const dUR = airR[i - GW + 1] + 9.8;
          if (dUp < d) d = dUp;
          if (dLf < d) d = dLf;
          if (dUL < d) d = dUL;
          if (dUR < d) d = dUR;
          airR[i] = d;
        }
        // AO 正向传播（板下传播权重更柔长，侧壁与底面轻柔）
        let a = aoR[i];
        const aUp = aoR[i - GW] + 28;
        const aLf = aoR[i - 1] + 56;
        if (aUp < a) a = aUp;
        if (aLf < a) a = aLf;
        aoR[i] = a;
      }
    }

    // 反向扫描（自下而上、自右而左）
    for (let y = GH - 2; y >= 6; y--) {
      const row = y * GW;
      for (let x = GW - 2; x >= 1; x--) {
        const i = row + x;
        if (rsm[i] === 1) {
          let d = airR[i];
          const dRt = airR[i + 1] + 8.2;
          const dDn = airR[i + GW] + 10.5;
          const dDL = airR[i + GW - 1] + 12.0;
          const dDR = airR[i + GW + 1] + 12.0;
          if (dRt < d) d = dRt;
          if (dDn < d) d = dDn;
          if (dDL < d) d = dDL;
          if (dDR < d) d = dDR;
          airR[i] = d > 255 ? 255 : d;
        }
        let a = aoR[i];
        const aRt = aoR[i + 1] + 56;
        const aDn = aoR[i + GW] + 38;
        if (aRt < a) a = aRt;
        if (aDn < a) a = aDn;
        aoR[i] = a > 255 ? 255 : a;
      }
    }

    // 将 AO 距离反转为柔和遮蔽强度（近板/近底柔和加深，上限 155 绝不发脏发黑）
    for (let i = 0; i < TOTAL_CELLS; i++) {
      aoR[i] = rsm[i] === 1 ? Math.max(0, 155 - aoR[i] * 0.62) : 0;
    }

    // 5. 横向与纵向平滑：airRaw 遇到墙/木板时采用中心沙格值钳制（竖直墙边法线恒为 0，零假边框）
    for (let y = 5; y < GH - 1; y++) {
      const row = y * GW;
      for (let x = 2; x < GW - 2; x++) {
        const i = row + x;
        const cAir = rsm[i] === 1 ? airR[i] : 0;
        const sampleAir = (j: number): number => {
          if (rsm[j] === 1) return airR[j];
          if (g[j] === EMPTY && inter[j]) return 0;
          return cAir;
        };
        const cAo = aoR[i];
        const sampleAo = (j: number): number => (rsm[j] === 1 ? aoR[j] : cAo);
        airT[i] =
          (sampleAir(i - 2) +
            2 * sampleAir(i - 1) +
            3 * cAir +
            2 * sampleAir(i + 1) +
            sampleAir(i + 2)) *
          0.11111111;
        aoT[i] = (sampleAo(i - 1) + 2 * cAo + sampleAo(i + 1)) * 0.25;
        solT[i] = (solR[i - 1] + 2 * solR[i] + solR[i + 1]) * 0.25;
      }
      airT[row + 1] = rsm[row + 1] ? airR[row + 1] : 0;
      airT[row + GW - 2] = rsm[row + GW - 2] ? airR[row + GW - 2] : 0;
      aoT[row + 1] = aoR[row + 1];
      aoT[row + GW - 2] = aoR[row + GW - 2];
      solT[row + 1] = solR[row + 1];
      solT[row + GW - 2] = solR[row + GW - 2];
    }

    // 贴墙 1 格扩充区的 airT / aoT 对齐相邻真实沙格
    for (let y = 5; y < GH - 1; y++) {
      const row = y * GW;
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x;
        if (rsm[i] === 0 && vc[i] >= 1) {
          const nb =
            rsm[i + 1] === 1
              ? i + 1
              : rsm[i - 1] === 1
                ? i - 1
                : rsm[i - GW] === 1
                  ? i - GW
                  : rsm[i + GW] === 1
                    ? i + GW
                    : -1;
          if (nb >= 0) {
            airT[i] = airT[nb];
            aoT[i] = aoT[nb];
          }
        }
      }
    }

    const fBuf = this.fieldUpload;
    const cBuf = this.cellUpload;
    for (let y = 0; y < GH; y++) {
      const row = y * GW;
      const yUp = y > 0 ? y - 1 : 0;
      const yDn = y < GH - 1 ? y + 1 : GH - 1;
      const rUp = yUp * GW;
      const rDn = yDn * GW;
      for (let x = 0; x < GW; x++) {
        const i = row + x;
        const o = i << 2;
        const mat = vc[i];

        const cA = airT[i];
        const upA = mat >= 1 && vc[rUp + x] === 0 && !(g[rUp + x] === EMPTY && inter[rUp + x]) ? cA : airT[rUp + x];
        const dnA = mat >= 1 && vc[rDn + x] === 0 && !(g[rDn + x] === EMPTY && inter[rDn + x]) ? cA : airT[rDn + x];

        const cAo = aoT[i];
        const upAo = vc[rUp + x] >= 1 ? aoT[rUp + x] : cAo;
        const dnAo = vc[rDn + x] >= 1 ? aoT[rDn + x] : cAo;

        const smAir = (upA + 2 * cA + dnA) * 0.25;
        const smAo = (upAo + 2 * cAo + dnAo) * 0.25;
        const smSol = (solT[rUp + x] + 3 * solT[i] + solT[rDn + x]) * 0.20;
        const spd = vel[i] > 0 ? Math.min(255, vel[i] * 3) : 0;

        fBuf[o] = smAir | 0;
        fBuf[o + 1] = smAo | 0;
        fBuf[o + 2] = smSol | 0;
        fBuf[o + 3] = spd;

        cBuf[o] = mat;
        cBuf[o + 1] = vs[i];
        cBuf[o + 2] = rs[i];
        cBuf[o + 3] = 255;
      }
    }
  }

  public renderToCanvas(
    engine: SandEngine,
    targetW: number,
    targetH: number,
    fieldsDirty: boolean
  ): void {
    const gl = this.gl;
    const w = Math.max(GW * 2, Math.min(1024, Math.round(targetW)));
    const h = Math.max(GH * 2, Math.min(1152, Math.round(targetH)));
    let resized = false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      resized = true;
    }

    if (!fieldsDirty && !resized && !this.hasGoldSand && this.uploadedOnce) {
      return;
    }

    if (fieldsDirty || !this.uploadedOnce) {
      this.buildUploadBuffers(engine);
      this.uploadedOnce = true;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        GW,
        GH,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.fieldUpload
      );

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        GW,
        GH,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.cellUpload
      );
    }

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    if (this.uPxPerCell) gl.uniform1f(this.uPxPerCell, w / GW);
    if (this.uTime) gl.uniform1f(this.uTime, engine.frame * 0.01667);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.cellTex);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(this.aPosLoc);
    gl.vertexAttribPointer(this.aPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
