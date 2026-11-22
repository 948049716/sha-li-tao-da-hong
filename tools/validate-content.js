#!/usr/bin/env node
'use strict';
/**
 * 内容总校验（CI 必跑）：node tools/validate-content.js [--fast] [--level N] [--report]
 *  A. 关卡结构：ID/标题唯一、区块→桶一一映射、颜色一致、坐标越界、解法引用、锁色可达
 *  B. 关卡物理：无头模拟标准解法必须通关、零残留、初始稳定；双核反测机器人与高空脆冰铁律；expectTrap 关卡必须存在堵口错误顺序
 *  C. 关卡去重：几何指纹（颜色归一化 + 镜像）与现有/已下架关卡相似度 ≥0.90 报错，≥0.80 警告
 *  D. 注册表：所有关卡/美术/音频必须已登记且为 active，已下架 ID 不得复用
 *  E. 美术提示词：assetId/输出路径唯一、主体描述相似度 ≥0.80 报错
 *  F. 生成图片：assets/manifest.json 中 dHash 汉明距离 ≤6 判为重复图
 *  G. 音频触觉与 UI 令牌：主包/分包音频预算、事件绑定、流沙色板完整性
 */
const fs = require('fs');
const path = require('path');
const { Sim, GW, GH } = require('./lib/sim');
const { normalizeText, jaccard, levelFingerprint, levelSimilarity } = require('./lib/dedupe');
const { buildPrompt } = require('./lib/prompt');
const { hamming } = require('./lib/png');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const FAST = args.includes('--fast');
const REPORT = args.includes('--report');
const ONLY = args.includes('--level') ? Number(args[args.indexOf('--level') + 1]) : null;

const TH = { levelError: 0.9, levelWarn: 0.8, promptError: 0.8, promptWarn: 0.62, imageHamming: 6, residueMax: 0.03 };
const errors = [];
const warnings = [];
const err = (scope, msg) => errors.push(`[${scope}] ${msg}`);
const warn = (scope, msg) => warnings.push(`[${scope}] ${msg}`);
const load = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const vessels = load('data/vessels.json');
const art = load('data/art/prompts.json');
const reg = fs.existsSync(path.join(ROOT, 'data/registry/id_registry.json')) ? load('data/registry/id_registry.json') : { entries: [] };
const levels = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data/levels')).filter(x => x.endsWith('.json')).sort()) {
  for (const L of load(`data/levels/${f}`).levels) levels.push({ ...L, _file: f });
}

// ---------------- A. 关卡结构 ----------------
function checkLevelStructure(L) {
  const S = `关卡 ${String(L.levelId).padStart(2, '0')}`;
  if (L.title !== undefined) err(S, `禁止包含关卡名称字段 title（"${L.title}"），全局仅保留纯序号`);
  if (!vessels[L.vesselTemplate]) err(S, `未知容器模板 ${L.vesselTemplate}`);
  const numCols = L.numCols != null ? L.numCols : 4;
  if (numCols !== 3 && numCols !== 4) err(S, `numCols 非法 (${numCols})，仅允许 3 或 4 列`);

  const ids = new Set();
  for (const b of L.boards) {
    if (ids.has(b.id)) err(S, `木板 ID 重复 ${b.id}`);
    ids.add(b.id);
    for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y1]]) {
      if (x < 0 || x >= GW || y < 0 || y >= GH) err(S, `木板 ${b.id} 坐标越界`);
    }
  }
  const zoneIds = new Set();
  for (const z of L.sandZones) {
    if (zoneIds.has(z.id)) err(S, `沙区 ID 重复 ${z.id}`);
    zoneIds.add(z.id);
    if (![1, 2, 3, 4, 5].includes(z.color)) err(S, `沙区 ${z.id} 颜色非法 ${z.color}`);
  }

  const used = {};
  const colCounts = Array(numCols).fill(0);
  L.bucketQueue.forEach((bk, k) => {
    if (bk.col == null || bk.col < 0 || bk.col >= numCols || !Number.isInteger(bk.col)) {
      err(S, `桶 #${k} 缺少合法列号 col (需为 0..${numCols - 1})`);
    } else {
      if (bk.mystery && colCounts[bk.col] === 0) {
        err(S, `桶 #${k} 标记了问号盲桶 mystery，但位于第 ${bk.col} 列排头 Row 0（开局即明牌无悬念）`);
      }
      colCounts[bk.col]++;
    }
    if (bk.iceLayers != null && (!Number.isInteger(bk.iceLayers) || bk.iceLayers < 1 || bk.iceLayers > 3)) {
      err(S, `桶 #${k} iceLayers 非法 (${bk.iceLayers})，需为 1..3`);
    }
    for (const zid of bk.zones) {
      const z = L.sandZones.find(x => x.id === zid);
      if (!z) {
        err(S, `桶 #${k} 引用了不存在的沙区 ${zid}`);
        continue;
      }
      if (used[zid] != null) err(S, `沙区 ${zid} 被多个桶重复引用`);
      used[zid] = k;
      const eff = z.expectDyeTo || z.color;
      if (eff !== bk.color && z.color !== 5) {
        err(S, `桶 #${k} 颜色 ${bk.color} 与沙区 ${zid} 实际颜色 ${eff} 不一致`);
      }
      if (z.expectDyeTo && !(L.dyeRings || []).some(r => r.toColor === z.expectDyeTo)) {
        err(S, `沙区 ${zid} 期望染成 ${z.expectDyeTo} 但没有对应染色环`);
      }
    }
  });
  for (const z of L.sandZones) {
    if (used[z.id] == null) err(S, `沙区 ${z.id} 没有分配接沙桶（违反 1:1 配比）`);
  }

  const solColCounts = Array(numCols).fill(0);
  for (const act of L.solution) {
    if (typeof act === 'string' && act.startsWith('col:')) {
      const cIdx = Number(act.slice(4));
      if (!Number.isInteger(cIdx) || cIdx < 0 || cIdx >= numCols) {
        err(S, `解法引用了非法候选列 ${act}`);
      } else {
        solColCounts[cIdx]++;
      }
    } else {
      const b = L.boards.find(x => x.id === act);
      if (!b) err(S, `解法引用不存在的动作/木板 ${act}`);
      else if (b.lockColor) err(S, `解法不应包含上锁木板 ${act}（满桶自动解锁）`);
    }
  }
  for (let cIdx = 0; cIdx < numCols; cIdx++) {
    if (solColCounts[cIdx] !== colCounts[cIdx]) {
      err(S, `第 ${cIdx} 列共有 ${colCounts[cIdx]} 只候选桶，但 solution 中点选了 ${solColCounts[cIdx]} 次`);
    }
  }

  for (const b of L.boards) {
    if (b.linkedTo) {
      if (b.linkedTo === b.id) err(S, `木板 ${b.id} 不能 linkedTo 自身`);
      if (!L.boards.some(x => x.id === b.linkedTo)) err(S, `木板 ${b.id} linkedTo 引用了不存在的木板 ${b.linkedTo}`);
    }
  }
  for (const b of L.boards.filter(x => x.lockColor)) {
    if (!L.bucketQueue.some(q => q.color === b.lockColor)) {
      err(S, `锁 ${b.id} 的颜色 ${b.lockColor} 在桶队列中不存在，永远无法解锁`);
    }
  }
}

// ---------------- B. 关卡物理 & 双核防无脑贪心反测 ----------------
function runSim(L, steps, seed) {
  const sim = new Sim(L, vessels, { seed });
  const r = sim.play(steps);
  return { r, sim };
}

function runBlindColumnBot(L) {
  const sim = new Sim(L, vessels, { seed: 20261121 });
  sim.runUntilIdle(1500);
  let cursor = 0;
  for (let step = 0; step < 52 && !sim.won; step++) {
    let acted = false;
    if (sim.findFirstEmptySlot() >= 0) {
      for (let k = 0; k < sim.numCols; k++) {
        const cIdx = (cursor + k) % sim.numCols;
        const col = sim.columns[cIdx];
        if (col && col.length > 0 && col[0].iceLayers === 0) {
          cursor = (cIdx + 1) % sim.numCols;
          sim.dispatchBucket(cIdx);
          acted = true;
          break;
        }
      }
    }
    if (!acted) {
      const clickable = sim.boards.filter(b => !b.removed && !b.isOpen && !b.lockColor);
      if (!clickable.length) break;
      clickable.sort((a, b) => Math.max(b.y0, b.y1) - Math.max(a.y0, a.y1));
      sim.pullBoard(clickable[0].id);
      acted = true;
    }
    if (sim.runUntilIdle(6000) < 0) return 'timeout';
  }
  return sim.won ? 'win' : 'fail';
}

function runPrematurePinSpamBot(L) {
  const sim = new Sim(L, vessels, { seed: 20261121 });
  sim.runUntilIdle(1500);
  const clickable = sim.boards
    .filter(b => !b.removed && !b.isOpen && !b.lockColor)
    .sort((a, b) => Math.max(b.y0, b.y1) - Math.max(a.y0, a.y1));
  if (clickable.length === 0) return 'no_pins';

  for (const b of clickable) {
    if (!b.removed) {
      sim.pullBoard(b.id);
      if (sim.runUntilIdle(6000) < 0) return 'timeout';
    }
  }

  for (let step = 0; step < 48 && !sim.won; step++) {
    if (sim.findFirstEmptySlot() < 0) {
      const morePins = sim.boards.filter(b => !b.removed && !b.isOpen && !b.lockColor);
      if (!morePins.length) break;
      sim.pullBoard(morePins[0].id);
      if (sim.runUntilIdle(6000) < 0) return 'timeout';
      continue;
    }
    const exposed = new Set();
    for (let y = 159; y <= 163; y++) {
      for (let x = 22; x <= 127; x++) {
        const v = sim.grid[y * GW + x];
        if (v >= 1 && v <= 5) exposed.add(v);
      }
    }
    let pickCol = -1;
    for (let cIdx = 0; cIdx < sim.numCols; cIdx++) {
      const col = sim.columns[cIdx];
      if (col.length > 0 && col[0].iceLayers === 0 && exposed.has(col[0].color)) {
        pickCol = cIdx;
        break;
      }
    }
    if (pickCol < 0) {
      for (let cIdx = 0; cIdx < sim.numCols; cIdx++) {
        const col = sim.columns[cIdx];
        if (col.length > 0 && col[0].iceLayers === 0) {
          pickCol = cIdx;
          break;
        }
      }
    }
    if (pickCol < 0) break;
    sim.dispatchBucket(pickCol);
    if (sim.runUntilIdle(6000) < 0) return 'timeout';
  }
  return sim.won ? 'win' : 'fail';
}

function trapCandidates(sol) {
  const out = [];
  const key = s => s.join(',');
  const seen = new Set([key(sol)]);
  const push = s => {
    if (!seen.has(key(s))) {
      seen.add(key(s));
      out.push(s);
    }
  };
  for (let i = sol.length - 1; i >= 1; i--) {
    if (!String(sol[i]).startsWith('col:') && sol[i] !== sol[0]) {
      push([sol[i], ...sol.filter((_, k) => k !== i)]);
    }
  }
  push(sol.slice().reverse());
  for (let i = 0; i < sol.length - 1; i++) {
    if (sol[i] === sol[i + 1]) continue;
    const s = sol.slice();
    [s[i], s[i + 1]] = [s[i + 1], s[i]];
    push(s);
  }
  for (let i = sol.length - 1; i >= 1; i--) {
    if (sol[i] === sol[0]) continue;
    push([sol[i], ...sol.filter((_, k) => k !== i)]);
  }
  return out.slice(0, 8);
}

const levelResults = {};
function checkLevelPhysics(L) {
  const S = `关卡 ${String(L.levelId).padStart(2, '0')}`;
  const freshSim = new Sim(L, vessels, { seed: 20261121 });
  if (freshSim.ice.some(ic => ic.shattered)) {
    err(S, '开局预沉降阶段发生冰砖提前碎裂（托冰结构不稳）');
  }
  if (freshSim.step() !== 0) {
    err(S, '开局未进行任何操作时首帧仍有沙粒流动（开局未静止）');
  }

  const { r, sim } = runSim(L, L.solution, 20261121);
  const total = sim.buckets.reduce((s, b) => s + b.max, 0);
  const res = {
    result: r.result,
    seconds: +(r.frame / 60).toFixed(1),
    residuePct: total ? +((100 * (r.residue || 0)) / total).toFixed(2) : 0,
    totalSand: total,
    bottleCount: sim.buckets.length,
    traps: null,
    trapTried: 0,
  };
  levelResults[L.levelId] = res;
  if (r.result !== 'win') {
    err(S, `标准解法未通关：${JSON.stringify(r)}`);
    return;
  }
  if (r.sandLeft > 0) err(S, `通关后仍残留 ${r.sandLeft} 粒沙`);
  if ((r.residue || 0) / total > TH.residueMax) {
    err(S, `清尾吸走 ${((100 * r.residue) / total).toFixed(1)}% 沙粒，超过 3%（容器死角过多）`);
  }

  const r2 = runSim(L, L.solution, 7).r;
  if (r2.result !== 'win') {
    err(S, `换随机种子后标准解法未通关（解法不稳定）：${JSON.stringify(r2)}`);
  }

  if (L.antiGreedy) {
    if (runBlindColumnBot(L) === 'win') {
      err(S, '可被「无脑轮流乱塞卡槽+顺抽木栓」直接通关，底部选桶顺序缺乏博弈深度！');
    }
    const spamRes = runPrematurePinSpamBot(L);
    if (spamRes === 'win') {
      err(S, '可被「开局无脑全抽光木栓」后平推通关，上下双核未形成活埋/脆冰/染色联动约束！');
    }
  }

  if ((L.sandZones || []).some(z => z.frozen)) {
    const icePin = (L.boards || []).find(
      b => !b.lockColor && (b.id.includes('ice') || b.id.includes('brittle'))
    );
    if (icePin) {
      const earlyIceSeq = [icePin.id, ...L.solution.filter(x => x !== icePin.id)];
      if (runSim(L, earlyIceSeq, 20261121).r.result === 'win') {
        err(S, `开局抢抽托冰木板 ${icePin.id} 仍可通关，高空脆冰机制未起到阻挡约束！`);
      }
    }
  }

  if (FAST) return;
  let traps = 0;
  const cands = trapCandidates(L.solution);
  for (const c of cands) {
    const t = runSim(L, c, 20261121).r;
    if (t.result !== 'win') traps++;
  }
  res.traps = traps;
  res.trapTried = cands.length;
  if (L.expectTrap && cands.length && traps === 0) {
    err(S, `设计要求存在卡槽/活埋陷阱，但尝试 ${cands.length} 种错误顺序全部能通关（关卡过于简单）`);
  }
}

// ---------------- C. 关卡去重 ----------------
function checkLevelDedupe() {
  const fps = levels.map(L => ({ L, fp: levelFingerprint(L, vessels) }));
  const seenId = {}, seenKey = {};
  for (const { L } of fps) {
    const S = `关卡 ${String(L.levelId).padStart(2, '0')}`;
    if (seenId[L.levelId]) err(S, `levelId 与第 ${seenId[L.levelId]} 关重复`);
    if (seenKey[L.key]) err(S, `key ${L.key} 重复`);
    seenId[L.levelId] = L.levelId; seenKey[L.key] = 1;
    if (L.key !== `lvl_${String(L.levelId).padStart(4, '0')}`) err(S, `key 必须为 lvl_${String(L.levelId).padStart(4, '0')}`);
  }
  const pairs = [];
  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      const s = levelSimilarity(fps[i].fp, fps[j].fp);
      const sameQueue = fps[i].fp.queueSig === fps[j].fp.queueSig;
      const score = s.score * (sameQueue ? 1 : 0.97);
      pairs.push({ a: fps[i].L, b: fps[j].L, score, mirrored: s.mirrored });
      const S = `关卡 ${fps[i].L.levelId} vs ${fps[j].L.levelId}`;
      if (fps[i].fp.hash === fps[j].fp.hash) err(S, '几何指纹完全相同（重复关卡）');
      else if (score >= TH.levelError) err(S, `布局相似度 ${(score * 100).toFixed(0)}%${s.mirrored ? '（镜像）' : ''}，判定为换皮重复关`);
      else if (score >= TH.levelWarn) warn(S, `布局相似度 ${(score * 100).toFixed(0)}%${s.mirrored ? '（镜像）' : ''}，建议拉开差异`);
    }
  }
  for (const e of reg.entries.filter(x => x.type === 'level' && x.status === 'retired' && x.fingerprint)) {
    for (const { L, fp } of fps) {
      const s = levelSimilarity(fp, e.fingerprint);
      if (s.score >= TH.levelError) err(`关卡 ${L.levelId}`, `与已下架关卡 ${e.id} 相似度 ${(s.score * 100).toFixed(0)}%`);
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return pairs.slice(0, 5);
}

// ---------------- D. 注册表 ----------------
function checkRegistry() {
  const S = '注册表';
  if (!reg.entries.length) { err(S, '缺少 data/registry/id_registry.json，请执行 node tools/registry.js bootstrap'); return; }
  const seen = new Set();
  for (const e of reg.entries) {
    const k = `${e.type}:${e.id}`;
    if (seen.has(k)) err(S, `注册表内 ${e.type} ID 重复 ${e.id}`);
    seen.add(k);
  }
  const audioList = fs.existsSync(path.join(ROOT, 'data/audio_haptics.json')) ? load('data/audio_haptics.json').audioAssets : [];
  const content = [
    ...levels.map(L => ({ type: 'level', id: L.key, name: String(L.levelId).padStart(2, '0') })),
    ...art.assets.map(a => ({ type: 'asset', id: a.assetId, name: a.title })),
    ...audioList.map(au => ({ type: 'audio', id: au.audioId, name: au.title })),
  ];
  for (const c of content) {
    const e = reg.entries.find(x => x.id === c.id && x.type === c.type);
    if (!e) err(S, `${c.type} ${c.id}「${c.name}」未登记，请先 allocate 再 bootstrap`);
    else if (e.status === 'retired') err(S, `${c.id} 已下架，禁止复用`);
    else if (normalizeText(e.name) !== normalizeText(c.name)) warn(S, `${c.id} 名称与登记不一致：登记「${e.name}」/ 数据「${c.name}」`);
  }
}

// ---------------- E. 美术提示词 ----------------
function checkArt() {
  const S = '美术提示词';
  const ids = new Set(), outs = new Set();
  for (const a of art.assets) {
    if (ids.has(a.assetId)) err(S, `assetId 重复 ${a.assetId}`);
    if (outs.has(a.output)) err(S, `输出路径重复 ${a.output}`);
    ids.add(a.assetId); outs.add(a.output);
    try { buildPrompt(a, art); } catch (e) { err(S, e.message); }
    if (!fs.existsSync(path.join(ROOT, a.output))) err(S, `缺失磁盘美术文件 ${a.output}`);
  }
  const list = art.assets;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (list[i].category !== list[j].category) continue;
    const s = jaccard(list[i].subject, list[j].subject);
    if (s >= TH.promptError) err(S, `${list[i].assetId} 与 ${list[j].assetId} 主体描述相似度 ${s.toFixed(2)}，会生成雷同图`);
    else if (s >= TH.promptWarn) warn(S, `${list[i].assetId} 与 ${list[j].assetId} 主体描述相似度 ${s.toFixed(2)}`);
  }
}

// ---------------- F. 生成图片 ----------------
function checkImages() {
  const mf = path.join(ROOT, 'assets/manifest.json');
  if (!fs.existsSync(mf)) return;
  const items = JSON.parse(fs.readFileSync(mf, 'utf8')).items || [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    if (!items[i].dhash || !items[j].dhash) continue;
    const d = hamming(items[i].dhash, items[j].dhash);
    if (d <= TH.imageHamming) err('生成图片', `${items[i].assetId} 与 ${items[j].assetId} 感知哈希距离 ${d}，疑似重复图`);
  }
}

// ---------------- G. 音频触觉与 UI 令牌 ----------------
function checkAudioAndUiTokens() {
  const ap = path.join(ROOT, 'data/audio_haptics.json');
  if (fs.existsSync(ap)) {
    const A = '音频与触觉';
    const ad = load('data/audio_haptics.json');
    const aids = new Set(), aouts = new Set();
    const synthIds = new Set((ad.webAudioSynths || []).map(s => s.synthId));
    let mainKB = 0, subKB = 0;
    for (const au of ad.audioAssets || []) {
      if (aids.has(au.audioId)) err(A, `audioId 重复 ${au.audioId}`);
      if (aouts.has(au.output)) err(A, `音频输出路径重复 ${au.output}`);
      aids.add(au.audioId); aouts.add(au.output);
      if (au.package === 'main') mainKB += au.maxSizeKB || 0;
      else if (au.package === 'subpackage_audio') subKB += au.maxSizeKB || 0;
      else err(A, `${au.audioId} 未知分包归属 ${au.package}`);
    }
    if (ad.budgets) {
      if (mainKB > ad.budgets.mainAudioMaxKB) err(A, `主包音频预算总和 ${mainKB}KB 超过上限 ${ad.budgets.mainAudioMaxKB}KB`);
      if (subKB > ad.budgets.subpackageAudioMaxKB) err(A, `分包音频预算总和 ${subKB}KB 超过上限 ${ad.budgets.subpackageAudioMaxKB}KB`);
    }
    for (const b of ad.eventBindings || []) {
      if (!aids.has(b.audioId) && !synthIds.has(b.audioId)) err(A, `事件 ${b.event} 引用了未知音频/合成器 ${b.audioId}`);
      if (!ad.hapticPatterns || !ad.hapticPatterns[b.haptic]) err(A, `事件 ${b.event} 引用了未知震动模式 ${b.haptic}`);
    }
  }
  const up = path.join(ROOT, 'data/ui_tokens.json');
  if (fs.existsSync(up)) {
    const U = 'UI设计令牌';
    const ut = load('data/ui_tokens.json');
    for (const cid of ['1', '2', '3', '4', '5']) if (!ut.sandPalette || !ut.sandPalette[cid]) err(U, `sandPalette 缺少颜色 ${cid}`);
  }
}

// ---------------- 执行 ----------------
const t0 = Date.now();
for (const L of levels) if (!ONLY || L.levelId === ONLY) checkLevelStructure(L);
for (const L of levels) {
  if (ONLY && L.levelId !== ONLY) continue;
  process.stdout.write(`模拟关卡 ${L.levelId}…\r`);
  checkLevelPhysics(L);
}
const topPairs = checkLevelDedupe();
checkRegistry();
checkArt();
checkImages();
checkAudioAndUiTokens();

const audioCount = fs.existsSync(path.join(ROOT, 'data/audio_haptics.json')) ? load('data/audio_haptics.json').audioAssets.length : 0;
console.log(`\n====== 内容校验完成（${((Date.now() - t0) / 1000).toFixed(1)}s）======`);
console.log(`关卡 ${levels.length} | 美术资产 ${art.assets.length} | 音频资产 ${audioCount}`);
for (const [id, r] of Object.entries(levelResults)) {
  console.log(`  L${String(id).padStart(2, '0')} (${String(r.bottleCount).padStart(2, ' ')}瓶/${String(r.totalSand).padStart(4, ' ')}粒) ${r.result.padEnd(5)} ${String(r.seconds).padStart(5)}s 残留清尾 ${r.residuePct}%  陷阱 ${r.traps == null ? '-' : r.traps + '/' + r.trapTried}`);
}
console.log('最相似关卡对：' + topPairs.map(p => `L${String(p.a.levelId).padStart(2, '0')}-L${String(p.b.levelId).padStart(2, '0')} ${(p.score * 100).toFixed(0)}%`).join('  '));
if (warnings.length) { console.log(`\n⚠️  警告 ${warnings.length} 条：`); warnings.forEach(w => console.log('  - ' + w)); }
if (errors.length) { console.log(`\n❌ 错误 ${errors.length} 条：`); errors.forEach(e => console.log('  - ' + e)); }
else console.log('\n✅ 无错误');

if (REPORT) {
  const lines = ['# 关卡与内容自动校验报告', '', `> 由 \`node tools/validate-content.js --report\` 自动生成，请勿手改。生成时间：${new Date().toISOString()}`, '',
    '| 序号 | 类型 | 丝带玻璃瓶 | 沙粒总数 | 标准解法 | 预计时长 | 清尾比例 | 错误顺序堵口数 |', '| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |'];
  for (const L of levels) {
    const r = levelResults[L.levelId];
    if (!r) continue;
    lines.push(`| ${String(L.levelId).padStart(2, '0')} | ${L.type} | ${r.bottleCount} | ${r.totalSand} | ${r.result === 'win' ? '✅ 通关' : '❌ ' + r.result} | ${r.seconds}s | ${r.residuePct}% | ${r.traps == null ? '-' : `${r.traps}/${r.trapTried}`} |`);
  }
  lines.push('', '## 布局最相似的关卡对（去重监控）', '', '| 关卡对 | 相似度 | 阈值 |', '| :--- | :---: | :--- |');
  for (const p of topPairs) lines.push(`| L${String(p.a.levelId).padStart(2, '0')} vs L${String(p.b.levelId).padStart(2, '0')} | ${(p.score * 100).toFixed(0)}%${p.mirrored ? '（镜像）' : ''} | ≥80% 警告 / ≥90% 报错 |`);
  lines.push('', `## 警告（${warnings.length}）`, '', ...(warnings.length ? warnings.map(w => `- ${w}`) : ['- 无']));
  lines.push('', `## 错误（${errors.length}）`, '', ...(errors.length ? errors.map(e => `- ${e}`) : ['- 无']), '');
  fs.writeFileSync(path.join(ROOT, 'docs/reports/内容校验报告.md'), lines.join('\n'));
  console.log('报告已写入 docs/reports/内容校验报告.md');
}
process.exit(errors.length ? 1 : 0);
