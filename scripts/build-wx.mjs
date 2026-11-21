#!/usr/bin/env node
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'dist-wx');
const PROMPTS_PATH = path.join(ROOT, 'data/art/prompts.json');

const SUBPACKAGE_FIGURINE_BG_IDS = new Set([
  'ui_bg_appraisal',
  'ui_bg_collection',
  'ui_bg_level_drawer',
  'ui_bg_share_poster',
]);

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
      target: 'es2020',
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

  // 微信小游戏入口 game.js（自动创建主屏 Canvas 注入 globalThis.__WX_MAIN_CANVAS__）
  const wxBootstrap = [
    '// 《沙里淘大红》微信小游戏启动入口 (自动生成)',
    'if (typeof wx !== "undefined" && typeof wx.createCanvas === "function") {',
    '  globalThis.__WX_MAIN_CANVAS__ = wx.createCanvas();',
    '}',
    bundleCode,
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'game.js'), wxBootstrap, 'utf8');

  // 按《美术素材压缩与分包规范》路由主包与 subpackages/figurines 分包资产
  const prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
  let mainArtBytes = 0;
  let subArtBytes = 0;

  for (const asset of prompts.assets) {
    const srcFile = path.join(ROOT, asset.output);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`[build:wx] 缺失压缩后美术资产: ${asset.output}`);
    }
    const stat = fs.statSync(srcFile);
    const isSub = asset.category === 'figurine' || SUBPACKAGE_FIGURINE_BG_IDS.has(asset.assetId);
    const relTarget = isSub
      ? asset.output.replace(/^assets\//, 'subpackages/figurines/')
      : asset.output;
    const dstFile = path.join(OUT_DIR, relTarget);
    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
    fs.copyFileSync(srcFile, dstFile);

    if (isSub) subArtBytes += stat.size;
    else mainArtBytes += stat.size;
  }

  // 生成分包入口占位 game.js（微信分包规范要求每个分包 root 含 game.js）
  const figSubDir = path.join(OUT_DIR, 'subpackages/figurines');
  fs.mkdirSync(figSubDir, { recursive: true });
  fs.writeFileSync(
    path.join(figSubDir, 'game.js'),
    '// subpackage: figurines & secondary backgrounds\n',
    'utf8'
  );

  // 生成微信小游戏配置 game.json 与 project.config.json
  const gameJson = {
    deviceOrientation: 'portrait',
    showStatusBar: false,
    networkTimeout: {
      request: 10000,
      downloadFile: 15000,
    },
    subpackages: [
      {
        name: 'figurines',
        root: 'subpackages/figurines/',
      },
    ],
  };
  fs.writeFileSync(path.join(OUT_DIR, 'game.json'), JSON.stringify(gameJson, null, 2) + '\n', 'utf8');

  const projectConfig = {
    description: '《沙里淘大红》微信小游戏工程配置',
    packOptions: { ignore: [] },
    setting: {
      urlCheck: true,
      es6: false,
      enhance: false,
      minified: true,
    },
    compileType: 'game',
    libVersion: '2.30.4',
    appid: 'touristappid',
    projectname: 'sha-li-tao-da-hong',
    cloudfunctionRoot: '../cloudfunctions/',
    condition: {},
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'project.config.json'),
    JSON.stringify(projectConfig, null, 2) + '\n',
    'utf8'
  );

  const subBytes = dirSizeBytes(path.join(OUT_DIR, 'subpackages'));
  const totalBytes = dirSizeBytes(OUT_DIR);
  const mainBytes = totalBytes - subBytes;

  const mainMB = mainBytes / (1024 * 1024);
  const subMB = subBytes / (1024 * 1024);

  console.log(
    `[build:wx] ✅ 构建完成 -> dist-wx/\n` +
      `  • 主包总大小: ${(mainBytes / 1024).toFixed(1)} KB (${mainMB.toFixed(2)} MB <= 1.80 MB 上限, 其中美术 ${(mainArtBytes / 1024).toFixed(1)} KB)\n` +
      `  • figurines 分包: ${(subBytes / 1024).toFixed(1)} KB (${subMB.toFixed(2)} MB <= 4.00 MB 上限, 其中美术 ${(subArtBytes / 1024).toFixed(1)} KB)`
  );

  if (mainMB > 1.8) {
    throw new Error(`[build:wx] ❌ 主包体积 ${mainMB.toFixed(2)} MB 超过 1.80 MB 红线！`);
  }
  if (subMB > 4.0) {
    throw new Error(`[build:wx] ❌ 分包体积 ${subMB.toFixed(2)} MB 超过 4.00 MB 红线！`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
