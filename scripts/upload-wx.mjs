#!/usr/bin/env node
import ci from 'miniprogram-ci';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_WX = path.join(ROOT, 'dist-wx');
const PKG_PATH = path.join(ROOT, 'package.json');

function resolvePrivateKeyPath() {
  const keyPathEnv = process.env.WX_PRIVATE_KEY_PATH;
  if (keyPathEnv) {
    const absPath = path.resolve(ROOT, keyPathEnv);
    if (!fs.existsSync(absPath)) {
      throw new Error(`[upload:wx] 找不到私钥文件: ${absPath}`);
    }
    return { keyPath: absPath, isTemp: false };
  }

  const keyContent = process.env.WX_PRIVATE_KEY;
  if (keyContent && keyContent.trim().length > 0) {
    const tmpFile = path.join(os.tmpdir(), `wx-private-${Date.now()}.key`);
    fs.writeFileSync(tmpFile, keyContent.trim() + '\n', { mode: 0o600 });
    return { keyPath: tmpFile, isTemp: true };
  }

  const appid = process.env.WX_APPID || 'wxb470b8f2dafc4cfd';
  const defaultLocalKey = path.join(ROOT, `private.${appid}.key`);
  if (fs.existsSync(defaultLocalKey)) {
    return { keyPath: defaultLocalKey, isTemp: false };
  }

  throw new Error(
    '[upload:wx] 未提供微信代码上传私钥！请设置环境变量 WX_PRIVATE_KEY 或 WX_PRIVATE_KEY_PATH。'
  );
}

async function main() {
  if (!fs.existsSync(DIST_WX) || !fs.existsSync(path.join(DIST_WX, 'game.json'))) {
    throw new Error('[upload:wx] dist-wx/ 不存在或未完整构建，请先运行 npm run build:wx');
  }

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const appid = process.env.WX_APPID || 'wxb470b8f2dafc4cfd';
  const version =
    process.env.WX_VERSION ||
    (process.env.GITHUB_RUN_NUMBER ? `${pkg.version}.${process.env.GITHUB_RUN_NUMBER}` : pkg.version);
  const sha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : 'local';
  const desc = process.env.WX_DESC || `CI 自动构建上传 (${sha})`;
  const robot = Number(process.env.WX_ROBOT || 1);

  const { keyPath, isTemp } = resolvePrivateKeyPath();

  try {
    console.log(`[upload:wx] 开始上传微信小游戏: appid=${appid}, version=${version}, robot=${robot}`);
    const project = new ci.Project({
      appid,
      type: 'miniGame',
      projectPath: DIST_WX,
      privateKeyPath: keyPath,
      ignores: ['node_modules/**/*'],
    });

    const uploadResult = await ci.upload({
      project,
      version,
      desc,
      setting: {
        es6: true,
        es7: true,
        minify: false,
        autoPrefixWXSS: false,
      },
      robot,
      onProgressUpdate: info => {
        if (typeof info === 'string') console.log(`[upload:wx] ${info}`);
        else if (info && info.message) console.log(`[upload:wx] ${info.message}`);
      },
    });

    console.log('[upload:wx] ✅ 上传成功:', JSON.stringify(uploadResult));
  } finally {
    if (isTemp && fs.existsSync(keyPath)) {
      fs.rmSync(keyPath, { force: true });
    }
  }
}

main().catch(err => {
  console.error('[upload:wx] ❌ 上传失败:', err);
  process.exit(1);
});
