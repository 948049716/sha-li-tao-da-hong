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
  vec3 p3 = fract(vec3(
    seedByte * 0.1731 + subSlot.x * 0.3183 + 0.13,
    seedByte * 0.2917 + subSlot.y * 0.4157 + 0.27,
    (seedByte + subSlot.x * 3.0 + subSlot.y * 7.0) * 0.2179 + 0.41
  ));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
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
  vec4 f0 = texture2D(u_fieldTex, fUv);
  vec2 cCenter = floor(gPos);
  vec2 cUv = (cCenter + 0.5) * INV_TEX;
  vec4 c11 = texture2D(u_cellTex, cUv);

  // 空腔快速早退：仅需 2 次纹理采样即可剔除全部空气背景像素，省去其余 9 次采样与 Voronoi 运算
  if (f0.b < 0.025 && c11.r < 0.002) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float o = 0.72 * INV_TEX;
  vec4 f1 = texture2D(u_fieldTex, fUv + vec2(-o, -o));
  vec4 f2 = texture2D(u_fieldTex, fUv + vec2( o, -o));
  vec4 f3 = texture2D(u_fieldTex, fUv + vec2(-o,  o));
  vec4 f4 = texture2D(u_fieldTex, fUv + vec2( o,  o));

  float sdf = f0.b * 0.32 + (f1.b + f2.b + f3.b + f4.b) * 0.17;
  if (sdf < 0.04 && c11.r < 0.002) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float airDepth = f0.r * 0.36 + (f1.r + f2.r + f3.r + f4.r) * 0.16;
  float aoVal = f0.g * 0.36 + (f1.g + f2.g + f3.g + f4.g) * 0.16;
  float flowSpd = f0.a * 0.44 + (f1.a + f2.a + f3.a + f4.a) * 0.14;

  // 象限自适应采样（仅读取十字 4 邻 + 当前所在象限对角 1 邻，共 6 次 cellTex 采样替代原 9 次）
  vec2 mPos = gPos * 2.0;
  vec2 mBase = floor(mPos);
  vec2 mFrac = mPos - mBase;
  float qx = mFrac.x < 0.5 ? -1.0 : 1.0;
  float qy = mFrac.y < 0.5 ? -1.0 : 1.0;

  vec4 c10 = texture2D(u_cellTex, cUv + vec2( 0.0,     -INV_TEX));
  vec4 c12 = texture2D(u_cellTex, cUv + vec2( 0.0,      INV_TEX));
  vec4 c01 = texture2D(u_cellTex, cUv + vec2(-INV_TEX,  0.0));
  vec4 c21 = texture2D(u_cellTex, cUv + vec2( INV_TEX,  0.0));
  vec4 cQuad = texture2D(u_cellTex, cUv + vec2(qx * INV_TEX, qy * INV_TEX));

  vec4 cQx = qx < 0.0 ? c01 : c21;
  vec4 cQy = qy < 0.0 ? c10 : c12;

  // 第一层：偏向象限 2x2 石英砂粒 Voronoi（4 次无三角迭代替代原 9 次 atan+sin 循环，算力开销降低 75%）
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 bestVec = vec2(0.0);
  float bestTrait = 0.5;
  float bestHueJit = 0.5;
  float bestGrainMat = 0.0;
  float yScale = mix(1.0, 0.60, flowSpd);

  for (int k = 0; k < 4; k++) {
    vec2 mOff = k == 0
      ? vec2(0.0, 0.0)
      : (k == 1 ? vec2(qx, 0.0) : (k == 2 ? vec2(0.0, qy) : vec2(qx, qy)));
    vec2 m = mBase + mOff;
    vec2 pCell = floor(m * 0.5);
    vec2 pOff = pCell - cCenter;
    bool diffX = abs(pOff.x) > 0.5;
    bool diffY = abs(pOff.y) > 0.5;
    vec4 cd = diffX ? (diffY ? cQuad : cQx) : (diffY ? cQy : c11);

    vec2 subSlot = m - pCell * 2.0;
    vec3 rnd = hashGrain(floor(cd.g * 255.0 + 0.5), subSlot);
    vec2 center = m + 0.5 + (rnd.xy - 0.5) * 0.76;
    vec2 dv = mPos - center;
    dv.y *= yScale;
    // 无 atan/sin 八边形石英微晶棱面范数
    vec2 ad = abs(dv);
    float oct = max(ad.x, ad.y) * 0.16 + (ad.x + ad.y) * 0.08;
    float dist = length(dv) * 0.84 + oct * (0.82 + 0.36 * rnd.z);
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

  // 第二层：无三角函数干爽矿砂微噪
  vec2 microCell = floor(bestVec * 3.2 + bestTrait * 17.0);
  vec2 mp = fract(microCell * vec2(0.1673, 0.2931) + bestHueJit * 0.37);
  mp += dot(mp, mp.yx + 19.19);
  float dryGrit = fract((mp.x + mp.y) * mp.x) - 0.5;

  // 平滑多色地层权重
  vec2 fLocal = fract(gPos) - 0.5;
  float wx0 = clamp(0.5 - fLocal.x, 0.0, 1.0);
  float wx2 = clamp(0.5 + fLocal.x, 0.0, 1.0);
  wx0 *= wx0;
  wx2 *= wx2;
  float wx1 = 1.12 - 0.55 * fLocal.x * fLocal.x;

  float wy0 = clamp(0.5 - fLocal.y, 0.0, 1.0);
  float wy2 = clamp(0.5 + fLocal.y, 0.0, 1.0);
  wy0 *= wy0;
  wy2 *= wy2;
  float wy1 = 1.12 - 0.55 * fLocal.y * fLocal.y;

  float w1 = 0.0, w2 = 0.0, w3 = 0.0, w4 = 0.0, w5 = 0.0, wIce = 0.0;
  accumColorWeight(floor(c10.r * 255.0 + 0.5), wx1 * wy0, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c01.r * 255.0 + 0.5), wx0 * wy1, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c11.r * 255.0 + 0.5), wx1 * wy1, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c21.r * 255.0 + 0.5), wx2 * wy1, w1, w2, w3, w4, w5, wIce);
  accumColorWeight(floor(c12.r * 255.0 + 0.5), wx1 * wy2, w1, w2, w3, w4, w5, wIce);
  float wQuad = (qx < 0.0 ? wx0 : wx2) * (qy < 0.0 ? wy0 : wy2);
  accumColorWeight(floor(cQuad.r * 255.0 + 0.5), wQuad, w1, w2, w3, w4, w5, wIce);

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

  float openSurface = clamp(1.0 - airDepth * 4.5, 0.0, 1.0);
  float pourWave = sin(gPos.x * 0.21 + gPos.y * 0.08) * 0.022 * openSurface;
  float grainEdge = (0.49 - d1) * 0.17 * openSurface;
  float effSdf = sdf + pourWave + grainEdge;

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

  float dAirDx = (f2.r + f4.r) - (f1.r + f3.r);
  float dAirDy = (f3.r + f4.r) - (f1.r + f2.r);
  float dSdfDx = (f1.b + f3.b) - (f2.b + f4.b);
  float dSdfDy = (f1.b + f2.b) - (f3.b + f4.b);

  vec2 slope2D = vec2(
    -dAirDx * 2.10 + dSdfDx * 0.90 * openSurface,
    -dAirDy * 1.80 + dSdfDy * 1.00 * openSurface
  );
  vec3 duneN = normalize(vec3(slope2D, 0.56));
  float ndl = dot(duneN, vec3(-0.484, -0.746, 0.457));

  float sunSlope = smoothstep(-0.12, 0.76, ndl);
  float shadeSlope = smoothstep(0.25, -0.56, ndl);

  float wavePhase =
    gPos.y * 0.145 +
    gPos.x * 0.038 +
    sin(gPos.x * 0.075 + float(cid) * 1.7) * 1.75 +
    (bestTrait - 0.5) * 0.55;
  float sandBand = sin(wavePhase) * 0.62;

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

  float crestT = clamp(1.0 - airDepth * 3.8, 0.0, 1.0);
  float crestBand = crestT * crestT * crestT * clamp(-duneN.y * 0.7 + 0.42, 0.0, 1.0) * (1.0 - aoVal * 0.65);
  col = mix(col, hiCol, crestBand * 0.46);
  float rimSpark = smoothstep(0.57, 0.48, effSdf) * openSurface * clamp(-duneN.y + 0.32, 0.0, 1.0);
  col = mix(col, mix(hiCol, vec3(1.0, 0.985, 0.94), 0.36), rimSpark * 0.44);

  if (secondW > 0.02) {
    float seam = clamp(1.0 - (bestW - secondW) / max(0.08, totalW * 0.36), 0.0, 1.0);
    col = mix(col, shCol, seam * 0.20);
  }

  float grainAmp = mix(0.24, 0.34, clamp(openSurface * 0.65 + flowSpd * 0.85, 0.0, 1.0));
  if (cid == 5) grainAmp *= 1.24;

  vec2 gNorm2D = bestVec / max(0.20, d1 + 0.15);
  float grainLit = clamp(dot(gNorm2D, vec2(0.60, 0.80)) * 0.5 + 0.5, 0.0, 1.0);
  float borderGap = 1.0 - smoothstep(0.0, 0.17, d2 - d1);

  vec3 grainHi = mix(hiCol, vec3(1.0, 0.988, 0.945), cid == 5 ? 0.42 : 0.20);
  vec3 grainDark = mix(shCol, baseCol, 0.18);

  if (bestTrait < 0.30) {
    float wDark = (0.30 - bestTrait) * 3.333;
    col = mix(col, grainDark, wDark * grainAmp * (0.65 + 0.35 * (1.0 - grainLit)));
  } else if (bestTrait > 0.66) {
    float wBright = (bestTrait - 0.66) * 2.941;
    col = mix(col, grainHi, wBright * grainAmp * (0.50 + 0.50 * grainLit));
  }

  col = mix(col, grainHi, clamp(grainLit - 0.50, 0.0, 0.5) * grainAmp * 0.68 * smoothstep(0.52, 0.10, d1));
  col = mix(col, grainDark, borderGap * grainAmp * 0.52);
  col += dryGrit * (0.045 + 0.025 * openSurface);

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
const SEED_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let h = (i * 197 + 89) & 0xff;
  h = ((h ^ (h >> 4)) * 163) & 0xff;
  SEED_LUT[i] = h ^ (h >> 5);
}

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

  /** 静止帧 2D 快照画布：使 WebGL 可开启 preserveDrawingBuffer:false（解放移动端 TBDR GPU），静止帧走纯 2D 极速贴图 */
  private readonly settledCanvas: HTMLCanvasElement | null;
  private readonly settledCtx: CanvasRenderingContext2D | null;
  private settledValid = false;

  private readonly visColor = new Uint8Array(TOTAL_CELLS);
  private readonly visSeed = new Uint8Array(TOTAL_CELLS);
  private readonly rawSolid = new Uint8Array(TOTAL_CELLS);
  private readonly realSandMask = new Uint8Array(TOTAL_CELLS);
  private readonly airRaw = new Uint16Array(TOTAL_CELLS);
  private readonly airTmp = new Uint16Array(TOTAL_CELLS);
  private readonly aoRaw = new Uint16Array(TOTAL_CELLS);
  private readonly aoTmp = new Uint16Array(TOTAL_CELLS);
  private readonly solidRaw = new Uint16Array(TOTAL_CELLS);
  private readonly solidTmp = new Uint16Array(TOTAL_CELLS);
  private readonly fieldUpload = new Uint8Array(GW * GH * 4);
  private readonly cellUpload = new Uint8Array(GW * GH * 4);
  private funnelScroll = 0;
  private hasGoldSand = false;
  private uploadedOnce = false;
  private lastLoadGen = -1;

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    posBuf: WebGLBuffer,
    fieldTex: WebGLTexture,
    cellTex: WebGLTexture,
    settledCanvas: HTMLCanvasElement | null,
    settledCtx: CanvasRenderingContext2D | null,
    tokens: UiTokensFile
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.posBuf = posBuf;
    this.fieldTex = fieldTex;
    this.cellTex = cellTex;
    this.settledCanvas = settledCanvas;
    this.settledCtx = settledCtx;
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
      let settledCanvas: HTMLCanvasElement | null = null;
      let settledCtx: CanvasRenderingContext2D | null = null;
      try {
        const sc = createCanvasFn();
        sc.width = GW * 2;
        sc.height = GH * 2;
        const sctx = sc.getContext('2d');
        if (sctx) {
          settledCanvas = sc;
          settledCtx = sctx;
        }
      } catch {
        settledCanvas = null;
        settledCtx = null;
      }

      const canvas = createCanvasFn();
      canvas.width = GW * 2;
      canvas.height = GH * 2;
      const attrs: WebGLContextAttributes = {
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: settledCtx === null,
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

      return new SandWebGLRenderer(
        canvas,
        gl,
        program,
        posBuf,
        fieldTex,
        cellTex,
        settledCanvas,
        settledCtx,
        tokens
      );
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

  /**
   * 纯整数定点数光影场构建 + 脏行区间局部更新（零闭包分配、零 Float32 转换）
   * 返回实际需要上传纹理的起始行与结束行 [upY0, upY1]
   */
  private buildUploadBuffers(
    engine: SandEngine,
    dirtyY0: number,
    dirtyY1: number,
    forceFull: boolean
  ): [number, number] {
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

    const bottomAnimating = engine.lastFlowParticles > 0 || engine.pourStreamMs > 0;
    const effY0 = forceFull ? 0 : Math.min(dirtyY0, bottomAnimating ? GH - 6 : dirtyY0);
    const effY1 = forceFull ? GH - 1 : Math.max(dirtyY1, bottomAnimating ? GH - 2 : dirtyY1);
    if (!forceFull && effY1 < effY0) {
      return [0, -1];
    }

    const fullBand = forceFull || (effY0 <= 24 && effY1 >= GH - 24);
    const bandY0 = fullBand ? 1 : Math.max(5, effY0 - 22);
    const bandY1 = fullBand ? GH - 2 : Math.min(GH - 2, effY1 + 22);
    const clearStart = fullBand ? 0 : Math.max(0, (bandY0 - 2) * GW);
    const clearEnd = fullBand ? TOTAL_CELLS : Math.min(TOTAL_CELLS, (bandY1 + 3) * GW);

    vc.fill(0, clearStart, clearEnd);
    vs.fill(0, clearStart, clearEnd);
    rs.fill(0, clearStart, clearEnd);
    rsm.fill(0, clearStart, clearEnd);

    let goldFound = false;
    for (let i = clearStart; i < clearEnd; i++) {
      const v = g[i];
      if (v >= 1 && v <= 5) {
        vc[i] = v;
        vs[i] = SEED_LUT[sh[i]];
        rs[i] = 255;
        rsm[i] = 1;
        if (v === GOLD_SAND) goldFound = true;
      } else if (v >= FROZEN_BASE) {
        const ic = engine.ice[v - FROZEN_BASE];
        vc[i] = 10 + (ic ? ic.color : 3);
        vs[i] = SEED_LUT[sh[i]];
        rs[i] = 255;
        rsm[i] = 1;
      }
    }
    if (fullBand) {
      this.hasGoldSand = goldFound;
    } else if (goldFound) {
      this.hasGoldSand = true;
    }

    // 1. 密实下落柱内部 1~3 格微空隙弥合
    const gapY0 = Math.max(7, bandY0);
    const gapY1 = Math.min(GH - 3, bandY1);
    for (let y = gapY0; y <= gapY1; y++) {
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
        vs[i] = SEED_LUT[sh[src]];
        rsm[i] = 1;
      }
    }

    // 2. 仅向紧贴真实沙粒的 1 格墙体/木板外扩
    for (let y = bandY0; y <= bandY1; y++) {
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

    // 2b. 底部漏斗斜坡段墙体再向下补齐 1 格
    if (bandY1 >= 139) {
      const slopeStart = Math.min(GH - 2, bandY1);
      const slopeEnd = Math.max(139, bandY0);
      for (let y = slopeStart; y >= slopeEnd; y--) {
        const row = y * GW;
        for (let x = 1; x < GW - 1; x++) {
          const i = row + x;
          if (g[i] !== WALL || vc[i] !== 0 || g[i - GW] !== WALL || vc[i - GW] === 0) continue;
          vc[i] = vc[i - GW];
          vs[i] = vs[i - GW];
        }
      }
    }

    // 3. 底部梳齿滤网底缘贴合
    if (bottomAnimating) {
      this.funnelScroll = (this.funnelScroll + 0.7 + Math.min(50, engine.lastFlowParticles) * 0.05) % 1700;
    }
    if (bandY1 >= GH - 3) {
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
    }

    // 4. 定点整数二维倒角距离场（2D Integer Chamfer Distance Transform）
    for (let i = clearStart; i < clearEnd; i++) {
      solR[i] = vc[i] >= 1 ? 255 : 0;
      airR[i] = 255;
      aoR[i] = 255;
    }

    const dtY0 = Math.max(6, bandY0);
    const dtY1 = Math.min(GH - 2, bandY1);
    for (let y = dtY0; y <= dtY1; y++) {
      const row = y * GW;
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x;
        const v = g[i];
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
        if (v === WALL || (v >= BOARD_BASE && v < FROZEN_BASE)) {
          aoR[i] = 0;
        }
      }
    }

    // 正向扫描（整数权重：顶光 6、侧光 8、斜角 10）
    for (let y = dtY0; y <= dtY1; y++) {
      const row = y * GW;
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x;
        if (rsm[i] === 1) {
          let d = airR[i];
          const dUp = airR[i - GW] + 6;
          const dLf = airR[i - 1] + 8;
          const dUL = airR[i - GW - 1] + 10;
          const dUR = airR[i - GW + 1] + 10;
          if (dUp < d) d = dUp;
          if (dLf < d) d = dLf;
          if (dUL < d) d = dUL;
          if (dUR < d) d = dUR;
          airR[i] = d;
        }
        let a = aoR[i];
        const aUp = aoR[i - GW] + 28;
        const aLf = aoR[i - 1] + 56;
        if (aUp < a) a = aUp;
        if (aLf < a) a = aLf;
        aoR[i] = a;
      }
    }

    // 反向扫描 + AO 强度内联映射（省去独立全图循环）
    for (let y = dtY1; y >= dtY0; y--) {
      const row = y * GW;
      for (let x = GW - 2; x >= 1; x--) {
        const i = row + x;
        if (rsm[i] === 1) {
          let d = airR[i];
          const dRt = airR[i + 1] + 8;
          const dDn = airR[i + GW] + 11;
          const dDL = airR[i + GW - 1] + 12;
          const dDR = airR[i + GW + 1] + 12;
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

    const smY0 = Math.max(5, bandY0);
    const smY1 = Math.min(GH - 2, bandY1);
    for (let i = smY0 * GW; i < (smY1 + 1) * GW; i++) {
      if (rsm[i] === 1) {
        const v = 155 - ((aoR[i] * 159) >> 8);
        aoR[i] = v > 0 ? v : 0;
      } else {
        aoR[i] = 0;
      }
    }

    // 5. 零闭包横向平滑（定点整数移位近似 /9 与 /4）
    for (let y = smY0; y <= smY1; y++) {
      const row = y * GW;
      for (let x = 2; x < GW - 2; x++) {
        const i = row + x;
        const cAir = rsm[i] === 1 ? airR[i] : 0;

        const jL2 = i - 2;
        const aL2 = rsm[jL2] === 1 ? airR[jL2] : g[jL2] === EMPTY && inter[jL2] ? 0 : cAir;
        const jL1 = i - 1;
        const aL1 = rsm[jL1] === 1 ? airR[jL1] : g[jL1] === EMPTY && inter[jL1] ? 0 : cAir;
        const jR1 = i + 1;
        const aR1 = rsm[jR1] === 1 ? airR[jR1] : g[jR1] === EMPTY && inter[jR1] ? 0 : cAir;
        const jR2 = i + 2;
        const aR2 = rsm[jR2] === 1 ? airR[jR2] : g[jR2] === EMPTY && inter[jR2] ? 0 : cAir;

        airT[i] = ((aL2 + (aL1 << 1) + cAir * 3 + (aR1 << 1) + aR2) * 29 + 128) >> 8;

        const cAo = aoR[i];
        const aoL = rsm[jL1] === 1 ? aoR[jL1] : cAo;
        const aoR1 = rsm[jR1] === 1 ? aoR[jR1] : cAo;
        aoT[i] = (aoL + (cAo << 1) + aoR1) >> 2;
        solT[i] = (solR[jL1] + (solR[i] << 1) + solR[jR1]) >> 2;
      }
      airT[row + 1] = rsm[row + 1] ? airR[row + 1] : 0;
      airT[row + GW - 2] = rsm[row + GW - 2] ? airR[row + GW - 2] : 0;
      aoT[row + 1] = aoR[row + 1];
      aoT[row + GW - 2] = aoR[row + GW - 2];
      solT[row + 1] = solR[row + 1];
      solT[row + GW - 2] = solR[row + GW - 2];
    }

    // 贴墙 1 格扩充区的 airT / aoT 对齐相邻真实沙格
    for (let y = smY0; y <= smY1; y++) {
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

    const upY0 = fullBand || bandY0 <= 6 ? 0 : bandY0 + 2;
    const upY1 = fullBand || bandY1 >= GH - 3 ? GH - 1 : bandY1 - 2;
    const fBuf = this.fieldUpload;
    const cBuf = this.cellUpload;

    for (let y = upY0; y <= upY1; y++) {
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

        const smAir = (upA + (cA << 1) + dnA) >> 2;
        const smAo = (upAo + (cAo << 1) + dnAo) >> 2;
        const smSol = ((solT[rUp + x] + solT[i] * 3 + solT[rDn + x]) * 51 + 128) >> 8;
        const vRaw = vel[i];
        const spd = vRaw > 0 ? (vRaw * 3 > 255 ? 255 : vRaw * 3) : 0;

        fBuf[o] = smAir;
        fBuf[o + 1] = smAo;
        fBuf[o + 2] = smSol;
        fBuf[o + 3] = spd;

        cBuf[o] = mat;
        cBuf[o + 1] = vs[i];
        cBuf[o + 2] = rs[i];
        cBuf[o + 3] = 255;
      }
    }

    return [upY0, upY1];
  }

  /**
   * 渲染流沙并返回供主 2D 画布贴图的最佳画布源：
   * - 运动帧：仅上传脏行子带并直接返回刚渲染完的 WebGL 画布（单次贴图）
   * - 静止帧：首次静止时快照至轻量 2D 缓存画布，后续帧 0 WebGL 开销、纯 2D-to-2D 极速贴图
   */
  public renderToSource(
    engine: SandEngine,
    targetW: number,
    targetH: number,
    fieldsDirty: boolean,
    dirtyY0 = 0,
    dirtyY1 = GH - 1
  ): HTMLCanvasElement {
    const gl = this.gl;
    // 物理网格仅 150x165，限制离屏分辨率上限为 540x600（约 3.6px/格），片元负载较 1024x1152 降低 72% 且清晰度无损
    const w = Math.max(GW * 2, Math.min(540, Math.round(targetW)));
    const h = Math.max(GH * 2, Math.min(600, Math.round(targetH)));
    let resized = false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      if (this.settledCanvas) {
        this.settledCanvas.width = w;
        this.settledCanvas.height = h;
      }
      this.settledValid = false;
      resized = true;
    }

    const levelChanged = engine.loadGeneration !== this.lastLoadGen;
    if (levelChanged) {
      this.lastLoadGen = engine.loadGeneration;
      this.settledValid = false;
    }

    // 含金沙关卡在静止态节流至每 8 帧（约 7.5Hz）微闪更新，其余静止帧直接走 2D 快照零开销复用
    const goldTick = this.hasGoldSand && (engine.frame & 7) === 0;
    const needDraw = fieldsDirty || resized || levelChanged || !this.uploadedOnce || goldTick;

    if (!needDraw) {
      if (this.settledCtx && this.settledCanvas) {
        if (!this.settledValid) {
          this.drawFullscreenQuad(w, h, engine.frame);
          this.settledCtx.clearRect(0, 0, w, h);
          this.settledCtx.drawImage(this.canvas, 0, 0, w, h);
          this.settledValid = true;
        }
        return this.settledCanvas;
      }
      return this.canvas;
    }

    if (fieldsDirty || levelChanged || !this.uploadedOnce) {
      const forceFull = !this.uploadedOnce || levelChanged || resized;
      const [upY0, upY1] = this.buildUploadBuffers(engine, dirtyY0, dirtyY1, forceFull);
      this.uploadedOnce = true;

      if (upY1 >= upY0) {
        const upH = upY1 - upY0 + 1;
        const byteStart = upY0 * GW * 4;
        const byteEnd = (upY1 + 1) * GW * 4;
        const fSub =
          upY0 === 0 && upY1 === GH - 1
            ? this.fieldUpload
            : this.fieldUpload.subarray(byteStart, byteEnd);
        const cSub =
          upY0 === 0 && upY1 === GH - 1
            ? this.cellUpload
            : this.cellUpload.subarray(byteStart, byteEnd);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, upY0, GW, upH, gl.RGBA, gl.UNSIGNED_BYTE, fSub);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, upY0, GW, upH, gl.RGBA, gl.UNSIGNED_BYTE, cSub);
      }
      this.settledValid = false;
    }

    this.drawFullscreenQuad(w, h, engine.frame);

    // 若本帧仅为静止态金沙低频微闪，顺带刷新 2D 快照供接下来 7 帧直接复用
    if (!fieldsDirty && this.settledCtx && this.settledCanvas) {
      this.settledCtx.clearRect(0, 0, w, h);
      this.settledCtx.drawImage(this.canvas, 0, 0, w, h);
      this.settledValid = true;
      return this.settledCanvas;
    }

    return this.canvas;
  }

  public renderToCanvas(
    engine: SandEngine,
    targetW: number,
    targetH: number,
    fieldsDirty: boolean
  ): void {
    this.renderToSource(engine, targetW, targetH, fieldsDirty, 0, GH - 1);
  }

  private drawFullscreenQuad(w: number, h: number, frame: number): void {
    const gl = this.gl;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    if (this.uPxPerCell) gl.uniform1f(this.uPxPerCell, w / GW);
    if (this.uTime) gl.uniform1f(this.uTime, frame * 0.01667);

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
