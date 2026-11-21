#!/usr/bin/env node
'use strict';
/**
 * 内容总校验（CI 必跑）：node tools/validate-content.js [--fast] [--level N] [--report]
 *  A. 关卡结构：ID/标题唯一、区块→桶一一映射、颜色一致、坐标越界、解法引用、锁色可达
 *  B. 关卡物理：无头模拟标准解法必须通关、零残留、初始稳定；expectTrap 关卡必须能找到至少 1 种堵口错误顺序
 *  C. 关卡去重：几何指纹（颜色归一化 + 镜像）与现有/已下架关卡相似度 ≥0.90 报错，≥0.80 警告
 *  D. 公仔/盲盒：ID/名称唯一（含已下架）、名称模糊相似、物种+造型重复、估值区间、概率和=100
 *  E. 注册表：所有内容必须已登记且为 active，已下架 ID 不得复用
 *  F. 美术提示词：每个公仔/盲盒必须有提示词、assetId/输出路径唯一、主体描述相似度 ≥0.80 报错
 *  G. 生成图片：assets/manifest.json 中 dHash 汉明距离 ≤6 判为重复图
 */
const fs = require('fs');
const path = require('path');
const { Sim, GW, GH } = require('./lib/sim');
const { normalizeText, jaccard, nameSimilarity, levelFingerprint, levelSimilarity } = require('./lib/dedupe');
const { buildPrompt } = require('./lib/prompt');
const { hamming } = require('./lib/png');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const FAST = args.includes('--fast');
const REPORT = args.includes('--report');
const ONLY = args.includes('--level') ? Number(args[args.indexOf('--level') + 1]) : null;

const TH = { levelError: 0.9, levelWarn: 0.8, nameWarn: 0.5, promptError: 0.8, promptWarn: 0.62, imageHamming: 6, residueMax: 0.03 };
const errors = [];
const warnings = [];
const err = (scope, msg) => errors.push(`[${scope}] ${msg}`);
const warn = (scope, msg) => warnings.push(`[${scope}] ${msg}`);
const load = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const vessels = load('data/vessels.json');
const figData = load('data/figurines.json');
const boxData = load('data/blindboxes.json');
const art = load('data/art/prompts.json');
const reg = fs.existsSync(path.join(ROOT, 'data/registry/id_registry.json')) ? load('data/registry/id_registry.json') : { entries: [] };
const levels = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data/levels')).filter(x => x.endsWith('.json')).sort()) {
  for (const L of load(`data/levels/${f}`).levels) levels.push({ ...L, _file: f });
}
const boxIds = new Set(boxData.boxes.map(b => b.boxId));
const figs = figData.series.flatMap(s => s.items.map(i => ({ ...i, seriesId: s.seriesId })));

// ---------------- A. 关卡结构 ----------------
function checkLevelStructure(L) {
  const S = `关卡 ${L.levelId}「${L.title}」`;
  if (!vessels[L.vesselTemplate]) err(S, `未知容器模板 ${L.vesselTemplate}`);
  const ids = new Set();
  for (const b of L.boards) {
    if (ids.has(b.id)) err(S, `木板 ID 重复 ${b.id}`);
    ids.add(b.id);
    for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y1]]) if (x < 0 || x >= GW || y < 0 || y >= GH) err(S, `木板 ${b.id} 坐标越界`);
  }
  const zoneIds = new Set();
  for (const z of L.sandZones) {
    if (zoneIds.has(z.id)) err(S, `沙区 ID 重复 ${z.id}`);
    zoneIds.add(z.id);
    if (![1, 2, 3, 4, 5].includes(z.color)) err(S, `沙区 ${z.id} 颜色非法 ${z.color}`);
  }
  const used = {};
  L.bucketQueue.forEach((bk, k) => {
    for (const zid of bk.zones) {
      const z = L.sandZones.find(x => x.id === zid);
      if (!z) { err(S, `桶 #${k} 引用了不存在的沙区 ${zid}`); continue; }
      if (used[zid] != null) err(S, `沙区 ${zid} 被多个桶重复引用`);
      used[zid] = k;
      const eff = z.expectDyeTo || z.color;
      if (eff !== bk.color) err(S, `桶 #${k} 颜色 ${bk.color} 与沙区 ${zid} 实际颜色 ${eff} 不一致`);
      if (z.expectDyeTo && !(L.dyeRings || []).some(r => r.toColor === z.expectDyeTo)) err(S, `沙区 ${zid} 期望染成 ${z.expectDyeTo} 但没有对应染色环`);
    }
  });
  for (const z of L.sandZones) if (used[z.id] == null) err(S, `沙区 ${z.id} 没有分配接沙桶（违反 1:1 配比）`);
  for (const sid of L.solution) {
    const b = L.boards.find(x => x.id === sid);
    if (!b) err(S, `解法引用不存在的木板 ${sid}`);
    else if (b.lockColor) err(S, `解法不应包含上锁木板 ${sid}（满桶自动解锁）`);
  }
  for (const b of L.boards.filter(x => x.lockColor)) {
    if (!L.bucketQueue.some(q => q.color === b.lockColor)) err(S, `锁 ${b.id} 的颜色 ${b.lockColor} 在桶队列中不存在，永远无法解锁`);
  }
  for (const c of L.capsules || []) {
    if (!boxIds.has(c.boxType)) err(S, `未知盲盒类型 ${c.boxType}`);
  }
  if (L.levelId === 1 && !(L.capsules || []).some(c => c.boxType === 'box_purple')) err(S, '第 1 关必须放置新手保底炫紫盒');
}

// ---------------- B. 关卡物理 ----------------
function runSim(L, steps, seed) {
  const sim = new Sim(L, vessels, { seed });
  const r = sim.play(steps);
  return { r, sim };
}

function trapCandidates(sol) {
  const out = [];
  const key = s => s.join(',');
  const seen = new Set([key(sol)]);
  const push = s => { if (!seen.has(key(s))) { seen.add(key(s)); out.push(s); } };
  for (let i = 0; i < sol.length - 1; i++) { const s = sol.slice(); [s[i], s[i + 1]] = [s[i + 1], s[i]]; push(s); }
  for (let i = 1; i < sol.length; i++) push([sol[i], ...sol.filter((_, k) => k !== i)]);
  return out.slice(0, 6);
}

const levelResults = {};
function checkLevelPhysics(L) {
  const S = `关卡 ${L.levelId}「${L.title}」`;
  const { r, sim } = runSim(L, L.solution, 20261121);
  const total = sim.buckets.reduce((s, b) => s + b.max, 0);
  const res = { result: r.result, seconds: +(r.frame / 60).toFixed(1), residuePct: total ? +((100 * (r.residue || 0)) / total).toFixed(2) : 0,
    totalSand: total, capsulesStuck: r.capsulesStuck || [], traps: null, trapTried: 0 };
  levelResults[L.levelId] = res;
  if (r.result !== 'win') { err(S, `标准解法未通关：${JSON.stringify(r)}`); return; }
  if (r.sandLeft > 0) err(S, `通关后仍残留 ${r.sandLeft} 粒沙`);
  if ((r.residue || 0) / total > TH.residueMax) err(S, `清尾吸走 ${(100 * r.residue / total).toFixed(1)}% 沙粒，超过 3%（容器死角过多）`);
  if (res.capsulesStuck.length) warn(S, `盲盒未自然滚出出沙口（通关时自动飞入战利品袋）：${res.capsulesStuck.join(', ')}`);
  // 第二个随机种子复核，避免"侥幸通关"
  const r2 = runSim(L, L.solution, 7).r;
  if (r2.result !== 'win') err(S, `换随机种子后标准解法未通关（解法不稳定）：${JSON.stringify(r2)}`);
  if (FAST) return;
  let traps = 0;
  const cands = trapCandidates(L.solution);
  for (const c of cands) {
    const t = runSim(L, c, 20261121).r;
    if (t.result !== 'win') traps++;
  }
  res.traps = traps;
  res.trapTried = cands.length;
  if (L.expectTrap && cands.length && traps === 0) err(S, `设计要求存在堵口陷阱，但尝试 ${cands.length} 种错误顺序全部能通关（关卡过于简单）`);
}

// ---------------- C. 关卡去重 ----------------
function checkLevelDedupe() {
  const fps = levels.map(L => ({ L, fp: levelFingerprint(L, vessels) }));
  const seenId = {}, seenKey = {}, seenTitle = {};
  for (const { L } of fps) {
    const S = `关卡 ${L.levelId}「${L.title}」`;
    if (seenId[L.levelId]) err(S, `levelId 与「${seenId[L.levelId]}」重复`);
    if (seenKey[L.key]) err(S, `key ${L.key} 重复`);
    const nt = normalizeText(L.title);
    if (seenTitle[nt]) err(S, `关卡名与第 ${seenTitle[nt]} 关重复`);
    seenId[L.levelId] = L.title; seenKey[L.key] = 1; seenTitle[nt] = L.levelId;
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
  // 与已下架关卡比对
  for (const e of reg.entries.filter(x => x.type === 'level' && x.status === 'retired' && x.fingerprint)) {
    for (const { L, fp } of fps) {
      const s = levelSimilarity(fp, e.fingerprint);
      if (s.score >= TH.levelError) err(`关卡 ${L.levelId}`, `与已下架关卡 ${e.id}「${e.name}」相似度 ${(s.score * 100).toFixed(0)}%`);
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return pairs.slice(0, 5);
}

// ---------------- D. 公仔 / 盲盒 ----------------
function checkFigurines() {
  const S = '公仔';
  const byId = {}, byName = {}, bySpeciesArch = {}, bySpecies = {};
  for (const f of figs) {
    if (byId[f.id]) err(S, `ID 重复 ${f.id}`);
    byId[f.id] = f;
    const n = normalizeText(f.name);
    if (byName[n]) err(S, `名称重复「${f.name}」(${byName[n].id} / ${f.id})`);
    byName[n] = f;
    const sa = `${f.species}|${f.archetype}`;
    if (bySpeciesArch[sa]) err(S, `物种+造型完全重复：${f.id} 与 ${bySpeciesArch[sa].id}（${sa}）`);
    bySpeciesArch[sa] = f;
    (bySpecies[f.species] = bySpecies[f.species] || []).push(f.id);
    const rr = figData.rarities[f.rarity];
    if (!rr) err(S, `${f.id} 品质非法 ${f.rarity}`);
    else if (f.valuation < rr.valuation[0] || f.valuation > rr.valuation[1]) err(S, `${f.id} 估值 ${f.valuation} 超出 ${f.rarity} 区间 ${rr.valuation.join('~')}`);
    if (!/^fig_\d{3,}$/.test(f.id)) err(S, `${f.id} ID 格式应为 fig_NNN`);
  }
  for (const [sp, list] of Object.entries(bySpecies)) if (list.length > 1) warn(S, `物种「${sp}」出现 ${list.length} 次：${list.join(', ')}（确认造型差异足够大）`);
  for (let i = 0; i < figs.length; i++) for (let j = i + 1; j < figs.length; j++) {
    const s = nameSimilarity(figs[i].name, figs[j].name);
    if (s >= TH.nameWarn) warn(S, `名称相近：「${figs[i].name}」vs「${figs[j].name}」相似度 ${s.toFixed(2)}`);
  }
  for (const e of reg.entries.filter(x => x.type === 'figurine' && x.status === 'retired')) {
    for (const f of figs) {
      if (f.id === e.id) err(S, `${f.id} 是已下架 ID，不可复用`);
      if (normalizeText(f.name) === normalizeText(e.name)) err(S, `「${f.name}」与已下架公仔 ${e.id} 同名`);
      if (e.species && `${e.species}|${e.archetype}` === `${f.species}|${f.archetype}`) err(S, `${f.id} 与已下架公仔 ${e.id} 物种+造型相同`);
    }
  }
  const seriesIds = new Set();
  for (const s of figData.series) { if (seriesIds.has(s.seriesId)) err(S, `套系 ID 重复 ${s.seriesId}`); seriesIds.add(s.seriesId); }

  const B = '盲盒';
  const bid = new Set(), bname = new Set();
  for (const b of boxData.boxes) {
    if (bid.has(b.boxId)) err(B, `ID 重复 ${b.boxId}`);
    if (bname.has(normalizeText(b.name))) err(B, `名称重复 ${b.name}`);
    bid.add(b.boxId); bname.add(normalizeText(b.name));
    for (const key of ['dropWeights', 'secondDropWeights']) {
      if (!b[key]) continue;
      const sum = Object.values(b[key]).reduce((a, x) => a + x, 0);
      if (sum !== 100) err(B, `${b.boxId}.${key} 概率和为 ${sum}，必须为 100`);
      for (const r of Object.keys(b[key])) if (!figData.rarities[r]) err(B, `${b.boxId}.${key} 未知品质 ${r}`);
      for (const [r, w] of Object.entries(b[key])) if (w > 0 && !figs.some(f => f.rarity === r)) err(B, `${b.boxId} 可掉落 ${r} 但该品质没有任何公仔`);
    }
    if (b.featuredFigurines) for (const id of b.featuredFigurines.ids) if (!figs.some(f => f.id === id)) err(B, `${b.boxId}.featuredFigurines 引用了不存在的公仔 ${id}`);
  }
  const sum100 = (o) => Object.entries(o).filter(([k]) => !k.startsWith('$')).reduce((a, [, x]) => a + x, 0);
  for (const [from, table] of Object.entries(boxData.replayDrops || {})) {
    if (from.startsWith('$')) continue;
    if (!bid.has(from)) err(B, `replayDrops 未知盒型 ${from}`);
    if (sum100(table) !== 100) err(B, `replayDrops.${from} 概率和为 ${sum100(table)}，必须为 100`);
    for (const to of Object.keys(table)) if (!bid.has(to)) err(B, `replayDrops.${from} 指向未知盒型 ${to}`);
  }
  if (boxData.airdrop && sum100(boxData.airdrop.weights) !== 100) err(B, `airdrop.weights 概率和必须为 100`);
  for (const id of (boxData.pity && boxData.pity.redPityBoxes) || []) if (!bid.has(id)) err(B, `pity.redPityBoxes 未知盒型 ${id}`);
}

// ---------------- E. 注册表 ----------------
function checkRegistry() {
  const S = '注册表';
  if (!reg.entries.length) { err(S, '缺少 data/registry/id_registry.json，请执行 node tools/registry.js bootstrap'); return; }
  const seen = new Set();
  const contentIds = {};
  for (const e of reg.entries) {
    const k = `${e.type}:${e.id}`;
    if (seen.has(k)) err(S, `注册表内 ${e.type} ID 重复 ${e.id}`);
    seen.add(k);
    if (e.type !== 'asset' && e.type !== 'audio') {
      if (contentIds[e.id]) err(S, `ID ${e.id} 同时被 ${contentIds[e.id]} 与 ${e.type} 占用`);
      contentIds[e.id] = e.type;
    }
  }
  const audioList = fs.existsSync(path.join(ROOT, 'data/audio_haptics.json')) ? load('data/audio_haptics.json').audioAssets : [];
  const content = [
    ...levels.map(L => ({ type: 'level', id: L.key, name: L.title })),
    ...figs.map(f => ({ type: 'figurine', id: f.id, name: f.name })),
    ...figData.series.map(s => ({ type: 'series', id: s.seriesId, name: s.seriesName })),
    ...boxData.boxes.map(b => ({ type: 'box', id: b.boxId, name: b.name })),
    ...art.assets.map(a => ({ type: 'asset', id: a.assetId, name: a.title })),
    ...audioList.map(au => ({ type: 'audio', id: au.audioId, name: au.title }))
  ];
  for (const c of content) {
    const e = reg.entries.find(x => x.id === c.id && x.type === c.type);
    if (!e) err(S, `${c.type} ${c.id}「${c.name}」未登记，请先 allocate 再 bootstrap`);
    else if (e.status === 'retired') err(S, `${c.id} 已下架，禁止复用`);
    else if (normalizeText(e.name) !== normalizeText(c.name)) warn(S, `${c.id} 名称与登记不一致：登记「${e.name}」/ 数据「${c.name}」`);
  }
}

// ---------------- F. 美术提示词 ----------------
function checkArt() {
  const S = '美术提示词';
  const ids = new Set(), outs = new Set();
  for (const a of art.assets) {
    if (ids.has(a.assetId)) err(S, `assetId 重复 ${a.assetId}`);
    if (outs.has(a.output)) err(S, `输出路径重复 ${a.output}`);
    ids.add(a.assetId); outs.add(a.output);
    try { buildPrompt(a, art); } catch (e) { err(S, e.message); }
    if (a.category === 'figurine' && !a.rarity) err(S, `${a.assetId} 缺少 rarity`);
  }
  for (const f of figs) {
    const a = art.assets.find(x => x.assetId === f.id);
    if (!a) err(S, `公仔 ${f.id}「${f.name}」缺少生图提示词`);
    else {
      if (a.rarity !== f.rarity) err(S, `${f.id} 提示词品质 ${a.rarity} 与数据 ${f.rarity} 不一致`);
      if (normalizeText(a.title) !== normalizeText(f.name)) err(S, `${f.id} 提示词标题「${a.title}」与公仔名「${f.name}」不一致`);
    }
  }
  for (const b of boxData.boxes) if (!art.assets.some(x => x.assetId === b.boxId)) err(S, `盲盒 ${b.boxId} 缺少生图提示词`);
  const list = art.assets;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (list[i].category !== list[j].category) continue;
    const s = jaccard(list[i].subject, list[j].subject);
    if (s >= TH.promptError) err(S, `${list[i].assetId} 与 ${list[j].assetId} 主体描述相似度 ${s.toFixed(2)}，会生成雷同图`);
    else if (s >= TH.promptWarn) warn(S, `${list[i].assetId} 与 ${list[j].assetId} 主体描述相似度 ${s.toFixed(2)}`);
  }
}

// ---------------- G. 生成图片 ----------------
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

// ---------------- H. 音频触觉与 UI 令牌 ----------------
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
    for (const r of Object.keys(figData.rarities)) if (!ut.rarityTokens || !ut.rarityTokens[r]) err(U, `rarityTokens 缺少品质 ${r}`);
    const artIds = new Set(art.assets.map(a => a.assetId));
    for (const rb of ut.rankBadges || []) if (!artIds.has(rb.assetId)) err(U, `头衔 Lv.${rb.level} 引用了不存在的美术资产 ${rb.assetId}`);
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
checkFigurines();
checkRegistry();
checkArt();
checkImages();
checkAudioAndUiTokens();

const audioCount = fs.existsSync(path.join(ROOT, 'data/audio_haptics.json')) ? load('data/audio_haptics.json').audioAssets.length : 0;
console.log(`\n====== 内容校验完成（${((Date.now() - t0) / 1000).toFixed(1)}s）======`);
console.log(`关卡 ${levels.length} | 公仔 ${figs.length} | 盲盒 ${boxData.boxes.length} | 美术资产 ${art.assets.length} | 音频资产 ${audioCount}`);
for (const [id, r] of Object.entries(levelResults)) {
  console.log(`  L${String(id).padStart(2, '0')} ${r.result.padEnd(5)} ${String(r.seconds).padStart(5)}s 残留清尾 ${r.residuePct}%  陷阱 ${r.traps == null ? '-' : r.traps + '/' + r.trapTried}${r.capsulesStuck.length ? '  卡盒:' + r.capsulesStuck.join(',') : ''}`);
}
console.log('最相似关卡对：' + topPairs.map(p => `L${p.a.levelId}-L${p.b.levelId} ${(p.score * 100).toFixed(0)}%`).join('  '));
if (warnings.length) { console.log(`\n⚠️  警告 ${warnings.length} 条：`); warnings.forEach(w => console.log('  - ' + w)); }
if (errors.length) { console.log(`\n❌ 错误 ${errors.length} 条：`); errors.forEach(e => console.log('  - ' + e)); }
else console.log('\n✅ 无错误');

if (REPORT) {
  const lines = ['# 关卡与内容自动校验报告', '', `> 由 \`node tools/validate-content.js --report\` 自动生成，请勿手改。生成时间：${new Date().toISOString()}`, '',
    '| 关卡 | 名称 | 类型 | 标准解法 | 预计时长 | 清尾比例 | 错误顺序堵口数 | 盲盒自然滚出 |', '| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |'];
  for (const L of levels) {
    const r = levelResults[L.levelId];
    if (!r) continue;
    lines.push(`| ${L.levelId} | ${L.title} | ${L.type} | ${r.result === 'win' ? '✅ 通关' : '❌ ' + r.result} | ${r.seconds}s | ${r.residuePct}% | ${r.traps == null ? '-' : `${r.traps}/${r.trapTried}`} | ${r.capsulesStuck.length ? '⚠️ ' + r.capsulesStuck.join(',') : '✅'} |`);
  }
  lines.push('', '## 布局最相似的关卡对（去重监控）', '', '| 关卡对 | 相似度 | 阈值 |', '| :--- | :---: | :--- |');
  for (const p of topPairs) lines.push(`| L${p.a.levelId}「${p.a.title}」 vs L${p.b.levelId}「${p.b.title}」 | ${(p.score * 100).toFixed(0)}%${p.mirrored ? '（镜像）' : ''} | ≥80% 警告 / ≥90% 报错 |`);
  lines.push('', `## 警告（${warnings.length}）`, '', ...(warnings.length ? warnings.map(w => `- ${w}`) : ['- 无']));
  lines.push('', `## 错误（${errors.length}）`, '', ...(errors.length ? errors.map(e => `- ${e}`) : ['- 无']), '');
  fs.writeFileSync(path.join(ROOT, 'docs/reports/内容校验报告.md'), lines.join('\n'));
  console.log('报告已写入 docs/reports/内容校验报告.md');
}
process.exit(errors.length ? 1 : 0);
