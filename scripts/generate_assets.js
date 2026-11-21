#!/usr/bin/env node
'use strict';
/**
 * 《沙里淘大红》ComfyUI + Qwen-Image-2.1 批量并发流水线生图 + 自动压缩 + dHash 去重校验脚本
 *
 * 严格遵循：
 *   1. 画风锁定基准图 docs/assets/cover.jpg -> 上传为 style_anchor_cover.jpg
 *   2. 唯一提示词数据源 data/art/prompts.json + tools/lib/prompt.js (TextEncodeQwenImage21 + UNETLoader)
 *   3. 下载原图仅暂存于临时目录，必须经 scripts/compress_assets.py 去背、缩放、8-bit量化压缩后写入 assets/
 *   4. 实时计算 64位 dHash 并与已入库资产做汉明距离 (>6) 防撞校验，撞车自动偏移种子重抽
 *   5. 增量持久化 assets/manifest.json，支持断点续传
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildComfyWorkflow } = require('../tools/lib/prompt');
const { decodePNG, dHash, hamming } = require('../tools/lib/png');

const ROOT = path.resolve(__dirname, '..');
const PROMPTS_PATH = path.join(ROOT, 'data/art/prompts.json');
const MANIFEST_PATH = path.join(ROOT, 'assets/manifest.json');
const COVER_PATH = path.join(ROOT, 'docs/assets/cover.jpg');
const COMPRESS_SCRIPT = path.join(ROOT, 'scripts/compress_assets.py');

const DEFAULT_COMFY_URL = process.env.COMFY_URL || 'https://chemical-integer-shepherd-kept.trycloudflare.com';

function parseArgs(argv) {
  const opts = {
    url: DEFAULT_COMFY_URL,
    concurrency: 3,
    steps: 25,
    cfg: 4.0,
    only: null,
    category: null,
    force: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--url') opts.url = argv[++i];
    else if (a === '--concurrency' || a === '-c') opts.concurrency = Math.max(1, Number(argv[++i]) || 3);
    else if (a === '--steps') opts.steps = Number(argv[++i]) || 25;
    else if (a === '--cfg') opts.cfg = Number(argv[++i]) || 4.0;
    else if (a === '--only') opts.only = new Set(argv[++i].split(',').map(s => s.trim()).filter(Boolean));
    else if (a === '--category') opts.category = argv[++i];
    else if (a === '--force') opts.force = true;
  }
  opts.url = opts.url.replace(/\/+$/, '');
  return opts;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkServerAndUploadAnchor(baseUrl, anchorFileName) {
  const statsRes = await fetchWithTimeout(`${baseUrl}/system_stats`, {}, 10000);
  if (!statsRes.ok) {
    throw new Error(`ComfyUI /system_stats 返回 HTTP ${statsRes.status}`);
  }
  const stats = await statsRes.json();
  const devName = stats.devices && stats.devices[0] ? stats.devices[0].name : 'unknown GPU';
  console.log(`[ComfyUI] 服务在线 (${stats.system?.comfyui_version || 'unknown'}) | 设备: ${devName}`);

  if (!fs.existsSync(COVER_PATH)) {
    throw new Error(`找不到画风基准封面图: ${COVER_PATH}`);
  }
  const coverBuf = fs.readFileSync(COVER_PATH);
  const form = new FormData();
  form.append('image', new Blob([coverBuf], { type: 'image/jpeg' }), anchorFileName);
  form.append('overwrite', 'true');

  const upRes = await fetchWithTimeout(`${baseUrl}/upload/image`, { method: 'POST', body: form }, 20000);
  if (!upRes.ok) {
    const txt = await upRes.text().catch(() => '');
    throw new Error(`上传画风基准图失败 HTTP ${upRes.status}: ${txt}`);
  }
  const upJson = await upRes.json();
  console.log(`[ComfyUI] 已上传画风基准图: ${upJson.name || anchorFileName}`);
}

async function submitAndWaitImage(baseUrl, workflow, assetId, timeoutMs = 180000) {
  const postRes = await fetchWithTimeout(
    `${baseUrl}/prompt`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: `slt-${process.pid}` }),
    },
    20000
  );
  if (!postRes.ok) {
    const errTxt = await postRes.text().catch(() => '');
    throw new Error(`提交 /prompt 失败 (${assetId}) HTTP ${postRes.status}: ${errTxt}`);
  }
  const { prompt_id: promptId } = await postRes.json();
  if (!promptId) throw new Error(`提交 /prompt 未返回 prompt_id (${assetId})`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(750);
    const histRes = await fetchWithTimeout(`${baseUrl}/history/${promptId}`, {}, 15000);
    if (!histRes.ok) continue;
    const hist = await histRes.json();
    const entry = hist[promptId];
    if (!entry) continue;

    if (entry.status && entry.status.status_str === 'error') {
      throw new Error(`ComfyUI 执行报错 (${assetId}): ${JSON.stringify(entry.status)}`);
    }

    const outputs = entry.outputs || {};
    const saveNode = outputs['8'] || Object.values(outputs).find(o => o && Array.isArray(o.images) && o.images.length > 0);
    if (saveNode && saveNode.images && saveNode.images[0]) {
      const imgInfo = saveNode.images[0];
      const qs = new URLSearchParams({
        filename: imgInfo.filename,
        subfolder: imgInfo.subfolder || '',
        type: imgInfo.type || 'output',
      });
      const viewRes = await fetchWithTimeout(`${baseUrl}/view?${qs.toString()}`, {}, 30000);
      if (!viewRes.ok) {
        throw new Error(`下载图片失败 (${assetId}) HTTP ${viewRes.status}`);
      }
      const arrBuf = await viewRes.arrayBuffer();
      return Buffer.from(arrBuf);
    }
  }
  throw new Error(`等待生图超时 (${assetId}, prompt_id=${promptId})`);
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { version: 1, generatedAt: new Date().toISOString(), styleAnchor: 'docs/assets/cover.jpg', items: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return { version: 1, generatedAt: new Date().toISOString(), styleAnchor: 'docs/assets/cover.jpg', items: [] };
  }
}

function saveManifest(manifest, itemsMap, orderedIds) {
  manifest.generatedAt = new Date().toISOString();
  manifest.items = orderedIds.map(id => itemsMap.get(id)).filter(Boolean);
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('用法: node scripts/generate_assets.js [--url URL] [--concurrency 3] [--steps 25] [--cfg 4.0] [--only id1,id2] [--category cat] [--force]');
    return;
  }

  const artLib = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
  const allAssets = artLib.assets;
  const orderedIds = allAssets.map(a => a.assetId);
  const manifest = loadManifest();
  const itemsMap = new Map((manifest.items || []).map(it => [it.assetId, it]));

  // 先同步校验本地已存在的压缩图片，避免重复重跑
  const todo = [];
  for (const asset of allAssets) {
    if (opts.only && !opts.only.has(asset.assetId)) continue;
    if (opts.category && asset.category !== opts.category) continue;

    const { meta } = buildComfyWorkflow(asset, artLib);
    const outAbs = path.join(ROOT, asset.output);
    const prev = itemsMap.get(asset.assetId);

    if (!opts.force && prev && prev.promptHash === meta.promptHash && prev.dhash && fs.existsSync(outAbs)) {
      continue;
    }
    todo.push(asset);
  }

  console.log(`[Plan] 总资产: ${allAssets.length} | 已就绪跳过: ${allAssets.length - todo.length} | 本次待生成: ${todo.length}`);
  if (todo.length === 0) {
    console.log('✅ 所有目标美术资产均已生成并压缩就绪。');
    return;
  }

  const anchorName = artLib.styleAnchors?.image_1?.file || 'style_anchor_cover.jpg';
  await checkServerAndUploadAnchor(opts.url, anchorName);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-raw-'));
  let completed = 0;
  let failed = 0;
  let cursor = 0;
  const tStart = Date.now();

  async function processAsset(asset) {
    const offsets = [0, 12, -12, 18, -18, 8, -8, 15];
    const maxAttempts = offsets.length;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const assetVariant = attempt === 0
        ? asset
        : {
            ...asset,
            seed: ((buildComfyWorkflow(asset, artLib).meta.seed + attempt * 104729) % 2147483647),
          };
      const { workflow, meta } = buildComfyWorkflow(assetVariant, artLib);
      // 应用快速高质量采样参数
      if (workflow['6'] && workflow['6'].inputs) {
        workflow['6'].inputs.steps = opts.steps;
        workflow['6'].inputs.cfg = opts.cfg;
      }

      const rawBuf = await submitAndWaitImage(opts.url, workflow, asset.assetId);
      const rawPath = path.join(tmpDir, `${asset.assetId}_raw_${attempt}.png`);
      const outAbs = path.join(ROOT, asset.output);
      fs.writeFileSync(rawPath, rawBuf);

      try {
        // 强制经过本地压缩与去背脚本处理后再入库
        execFileSync(
          'python3',
          [
            COMPRESS_SCRIPT,
            rawPath,
            '-o',
            outAbs,
            '--asset-id',
            asset.assetId,
            '--offset-x',
            String(offsets[attempt] || 0),
            '--check-budget',
          ],
          { cwd: ROOT, stdio: 'pipe' }
        );
      } finally {
        if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
      }

      const decoded = decodePNG(outAbs);
      const hash = dHash(decoded);
      const stat = fs.statSync(outAbs);

      // 检查是否与任何已入库其他资产发生 dHash 碰撞（汉明距离 <= 6）
      let collision = null;
      for (const [otherId, otherItem] of itemsMap.entries()) {
        if (otherId === asset.assetId || !otherItem.dhash) continue;
        const dist = hamming(hash, otherItem.dhash);
        if (dist <= 6) {
          collision = { otherId, dist };
          break;
        }
      }

      if (collision && attempt + 1 < maxAttempts) {
        console.warn(
          `[Retry] ${asset.assetId} 与 ${collision.otherId} 的 dHash 距离为 ${collision.dist} (<=6)，自动偏移种子重抽 (${attempt + 1}/${maxAttempts})...`
        );
        continue;
      }
      if (collision) {
        throw new Error(`${asset.assetId} 连续 ${maxAttempts} 次与 ${collision.otherId} 发生 dHash 碰撞 (dist=${collision.dist})`);
      }

      // 记录原始默认种子的 promptHash 以便下次幂等跳过
      const canonicalHash = buildComfyWorkflow(asset, artLib).meta.promptHash;
      const record = {
        assetId: asset.assetId,
        category: asset.category,
        output: asset.output,
        width: decoded.width,
        height: decoded.height,
        bytes: stat.size,
        rawBytes: rawBuf.length,
        seed: meta.seed,
        promptHash: canonicalHash,
        dhash: hash,
      };
      itemsMap.set(asset.assetId, record);
      saveManifest(manifest, itemsMap, orderedIds);
      completed++;
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(
        `[${completed}/${todo.length} | ${elapsed}s] ✅ ${asset.assetId} -> ${asset.output} ` +
        `(${decoded.width}x${decoded.height}, ${(rawBuf.length / 1024).toFixed(0)}KB -> ${(stat.size / 1024).toFixed(1)}KB, dHash=${hash})`
      );
      return;
    }
  }

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= todo.length) break;
      const asset = todo[idx];
      try {
        await processAsset(asset);
      } catch (err) {
        failed++;
        console.error(`❌ [${asset.assetId}] 生成失败: ${err.message}`);
      }
    }
  }

  try {
    const workers = Array.from({ length: Math.min(opts.concurrency, todo.length) }, () => worker());
    await Promise.all(workers);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const totalSec = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(`\n====== 批量生图与压缩结束 (${totalSec}s) | 成功: ${completed} | 失败: ${failed} ======`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
