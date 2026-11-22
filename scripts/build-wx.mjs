#!/usr/bin/env node
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'dist-wx');
const PROMPTS_PATH = path.join(ROOT, 'data/art/prompts.json');

function dirSizeBytes(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const p = path.join(dirPath, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(p);
    else total += fs.statSync(p).size;
  }
  return total;
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('[build:wx] 正在使用 Vite 打包微信小游戏单入口 IIFE 逻辑层...');
  await build({
    configFile: false,
    publicDir: false,
    build: {
      target: 'es2018',
      outDir: path.join(OUT_DIR, '_tmp_bundle'),
      emptyOutDir: true,
      lib: {
        entry: path.join(ROOT, 'src/main.ts'),
        name: 'ShaLiTaoDaHong',
        formats: ['iife'],
        fileName: () => 'bundle.js',
      },
      minify: true,
    },
  });

  const bundlePath = path.join(OUT_DIR, '_tmp_bundle', 'bundle.js');
  const bundleCode = fs.readFileSync(bundlePath, 'utf8');
  fs.rmSync(path.join(OUT_DIR, '_tmp_bundle'), { recursive: true, force: true });

  // 微信小游戏入口 game.js（注入 iOS/Android 真机 performance 垫片、Canvas 2D roundRect 垫片与主屏 Canvas）
  const wxBootstrap = [
    '// 《沙里淘大红》纯粹流沙抽栓版 微信小游戏启动入口 (自动生成)',
    '(function() {',
    '  var g = typeof globalThis !== "undefined" ? globalThis : (typeof GameGlobal !== "undefined" ? GameGlobal : window);',
    '  if (typeof g.performance === "undefined" || typeof g.performance.now !== "function") {',
    '    var wxPerf = typeof wx !== "undefined" && typeof wx.getPerformance === "function" ? wx.getPerformance() : null;',
    '    g.performance = { now: function() { return wxPerf && typeof wxPerf.now === "function" ? wxPerf.now() : Date.now(); } };',
    '  }',
    '  function rrPolyfill(x, y, w, h, radii) {',
    '    if (w < 0) { x += w; w = -w; }',
    '    if (h < 0) { y += h; h = -h; }',
    '    var r = typeof radii === "number" ? radii : (Array.isArray(radii) && radii.length ? Number(radii[0]) || 0 : 0);',
    '    var c = Math.max(0, Math.min(r, w * 0.5, h * 0.5));',
    '    if (c <= 0.01 || w <= 0 || h <= 0) { this.rect(x, y, w, h); return; }',
    '    this.moveTo(x + c, y);',
    '    this.arcTo(x + w, y, x + w, y + h, c);',
    '    this.arcTo(x + w, y + h, x, y + h, c);',
    '    this.arcTo(x, y + h, x, y, c);',
    '    this.arcTo(x, y, x + w, y, c);',
    '    this.closePath();',
    '  }',
    '  if (typeof wx !== "undefined" && typeof wx.createCanvas === "function") {',
    '    var mainCanvas = wx.createCanvas();',
    '    var mainCtx = mainCanvas.getContext("2d");',
    '    if (mainCtx && typeof mainCtx.roundRect !== "function") {',
    '      try { var p = Object.getPrototypeOf(mainCtx); if (p) p.roundRect = rrPolyfill; } catch (e) {}',
    '      try { mainCtx.roundRect = rrPolyfill; } catch (e) {}',
    '    }',
    '    g.__WX_MAIN_CANVAS__ = mainCanvas;',
    '  }',
    '})();',
    bundleCode,
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'game.js'), wxBootstrap, 'utf8');

  // 全部 30 张核心美术资产直接打包进主包（极简轻量化，无需任何美术分包）
  const prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
  let mainArtBytes = 0;

  for (const asset of prompts.assets) {
    const srcFile = path.join(ROOT, asset.output);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`[build:wx] 缺失压缩后美术资产: ${asset.output}`);
    }
    const stat = fs.statSync(srcFile);
    const dstFile = path.join(OUT_DIR, asset.output);
    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
    fs.copyFileSync(srcFile, dstFile);
    mainArtBytes += stat.size;
  }

  // 按 data/audio_haptics.json 路由音频文件（BGM → subpackages/audio/ 分包；其余由 WebAudio 实时合成）
  const audioCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audio_haptics.json'), 'utf8'));
  let mainAudioBytes = 0;
  let subAudioBytes = 0;
  for (const au of audioCfg.audioAssets) {
    const srcRel = au.source || au.output;
    const srcFile = path.join(ROOT, srcRel);
    if (!fs.existsSync(srcFile)) continue;
    const size = fs.statSync(srcFile).size;
    if (size / 1024 > au.maxSizeKB) {
      throw new Error(`[build:wx] ❌ 音频 ${au.audioId} ${(size / 1024).toFixed(1)} KB 超出预算 ${au.maxSizeKB} KB`);
    }
    const dstFile = path.join(OUT_DIR, au.output);
    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
    fs.copyFileSync(srcFile, dstFile);
    if (au.package === 'subpackage_audio') subAudioBytes += size;
    else mainAudioBytes += size;
  }
  const hasAudioSub = subAudioBytes > 0;
  if (hasAudioSub) {
    fs.writeFileSync(
      path.join(OUT_DIR, 'subpackages/audio/game.js'),
      '// subpackage: audio (bgm)\n',
      'utf8'
    );
  }

  // 生成微信小游戏配置 game.json 与 project.config.json
  const gameJson = {
    deviceOrientation: 'portrait',
    showStatusBar: false,
    networkTimeout: {
      request: 10000,
      downloadFile: 15000,
    },
    ...(hasAudioSub
      ? {
          subpackages: [{ name: 'audio', root: 'subpackages/audio/' }],
        }
      : {}),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'game.json'), JSON.stringify(gameJson, null, 2) + '\n', 'utf8');

  const projectConfig = {
    description: '《沙里淘大红》纯粹流沙抽栓版 微信小游戏工程配置',
    packOptions: { ignore: [] },
    setting: {
      urlCheck: true,
      es6: false,
      enhance: false,
      minified: true,
    },
    compileType: 'game',
    libVersion: '2.30.4',
    appid: process.env.WX_APPID || 'wxb470b8f2dafc4cfd',
    projectname: 'sha-li-tao-da-hong',
    cloudfunctionRoot: '../cloudfunctions/',
    condition: {},
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'project.config.json'),
    JSON.stringify(projectConfig, null, 2) + '\n',
    'utf8'
  );

  const audioSubBytes = dirSizeBytes(path.join(OUT_DIR, 'subpackages/audio'));
  const subBytes = dirSizeBytes(path.join(OUT_DIR, 'subpackages'));
  const totalBytes = dirSizeBytes(OUT_DIR);
  const mainBytes = totalBytes - subBytes;

  const mainMB = mainBytes / (1024 * 1024);
  const audioSubKB = audioSubBytes / 1024;
  const audioSubBudgetKB = audioCfg.budgets.subpackageAudioMaxKB;

  console.log(
    `[build:wx] ✅ 构建完成 -> dist-wx/\n` +
      `  • 主包总大小: ${(mainBytes / 1024).toFixed(1)} KB (${mainMB.toFixed(2)} MB <= 1.80 MB 上限, 其中 ${prompts.assets.length} 张核心美术 ${(mainArtBytes / 1024).toFixed(1)} KB, 音频 ${(mainAudioBytes / 1024).toFixed(1)} KB)\n` +
      `  • audio 分包: ${audioSubKB.toFixed(1)} KB (<= ${audioSubBudgetKB} KB 预算, 其中音频 ${(subAudioBytes / 1024).toFixed(1)} KB)`
  );

  if (mainMB > 1.8) {
    throw new Error(`[build:wx] ❌ 主包体积 ${mainMB.toFixed(2)} MB 超过 1.80 MB 红线！`);
  }
  if (audioSubKB > audioSubBudgetKB) {
    throw new Error(`[build:wx] ❌ audio 分包 ${audioSubKB.toFixed(1)} KB 超过 ${audioSubBudgetKB} KB 预算！`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
