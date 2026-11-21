#!/usr/bin/env node
'use strict';
/**
 * 内容 ID 注册表（永不复用）
 *   node tools/registry.js bootstrap                 # 从现有数据生成/补全注册表（首次或新增内容后）
 *   node tools/registry.js allocate <type> <名称>     # 申请新 ID：先做名称精确+模糊查重，再发号
 *   node tools/registry.js retire <id> "<原因>"       # 下架：ID 与名称永久保留占位，不可再用
 *   node tools/registry.js list [type]
 * type: level | figurine | box | series | asset
 */
const fs = require('fs');
const path = require('path');
const { normalizeText, nameSimilarity, levelFingerprint } = require('./lib/dedupe');

const ROOT = path.resolve(__dirname, '..');
const REG = path.join(ROOT, 'data/registry/id_registry.json');
const FUZZY_BLOCK = 0.6;

const PREFIX = { level: 'lvl_', figurine: 'fig_', box: 'box_', series: 'series_', asset: '' };
const PAD = { level: 4, figurine: 3 };

function load(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); }
function loadReg() {
  if (!fs.existsSync(REG)) return { policy: '', next: { level: 1, figurine: 1 }, entries: [] };
  return JSON.parse(fs.readFileSync(REG, 'utf8'));
}
function saveReg(reg) {
  reg.entries.sort((a, b) => (a.type + a.id).localeCompare(b.type + b.id));
  fs.mkdirSync(path.dirname(REG), { recursive: true });
  fs.writeFileSync(REG, JSON.stringify(reg, null, 2) + '\n');
}

function collectContent() {
  const vessels = load('data/vessels.json');
  const out = [];
  const levelDir = path.join(ROOT, 'data/levels');
  for (const f of fs.readdirSync(levelDir).filter(x => x.endsWith('.json')).sort()) {
    const ch = load(`data/levels/${f}`);
    for (const L of ch.levels) out.push({ type: 'level', id: L.key, name: L.title, fingerprint: levelFingerprint(L, vessels) });
  }
  const figs = load('data/figurines.json');
  for (const s of figs.series) {
    out.push({ type: 'series', id: s.seriesId, name: s.seriesName });
    for (const it of s.items) out.push({ type: 'figurine', id: it.id, name: it.name, species: it.species, archetype: it.archetype });
  }
  for (const b of load('data/blindboxes.json').boxes) out.push({ type: 'box', id: b.boxId, name: b.name });
  for (const a of load('data/art/prompts.json').assets) out.push({ type: 'asset', id: a.assetId, name: a.title });
  return out;
}

function nameConflicts(reg, type, name, selfId) {
  const n = normalizeText(name);
  const hits = [];
  for (const e of reg.entries) {
    if (e.id === selfId) continue;
    if (type !== 'asset' && e.type === 'asset') continue;
    const same = normalizeText(e.name) === n;
    const sim = nameSimilarity(e.name, name);
    if (same || (e.type === type && sim >= FUZZY_BLOCK)) hits.push({ id: e.id, name: e.name, status: e.status, similarity: Number(sim.toFixed(2)), exact: same });
  }
  return hits;
}

function bootstrap() {
  const reg = loadReg();
  reg.policy = '所有 ID 一经发放永不复用；下架内容标记 retired 并永久保留名称与关卡指纹，用于后续查重。新增内容必须先 allocate 再写入数据。';
  const today = new Date().toISOString().slice(0, 10);
  let added = 0, updated = 0;
  for (const c of collectContent()) {
    const e = reg.entries.find(x => x.id === c.id && x.type === c.type);
    if (!e) {
      reg.entries.push({ type: c.type, id: c.id, name: c.name, status: 'active', issuedAt: today,
        ...(c.fingerprint ? { fingerprint: c.fingerprint } : {}), ...(c.species ? { species: c.species, archetype: c.archetype } : {}) });
      added++;
    } else if (c.fingerprint && e.status === 'active') {
      if (!e.fingerprint || e.fingerprint.hash !== c.fingerprint.hash) { e.fingerprint = c.fingerprint; updated++; }
    }
  }
  const maxNum = (type, prefix) => reg.entries.filter(e => e.type === type).reduce((m, e) => Math.max(m, parseInt(e.id.replace(prefix, ''), 10) || 0), 0);
  reg.next = { level: maxNum('level', 'lvl_') + 1, figurine: maxNum('figurine', 'fig_') + 1 };
  saveReg(reg);
  console.log(`注册表已更新：新增 ${added} 条，刷新指纹 ${updated} 条，共 ${reg.entries.length} 条。next=${JSON.stringify(reg.next)}`);
}

function allocate(type, name, custom) {
  if (!PREFIX.hasOwnProperty(type) || !name) { console.error('用法: allocate <level|figurine|box|series|asset> <名称> [自定义ID]'); process.exit(2); }
  const reg = loadReg();
  const hits = nameConflicts(reg, type, name);
  if (hits.length) {
    console.error(`❌ 名称「${name}」与已有内容冲突（含已下架内容），请换名：`);
    for (const h of hits) console.error(`   - ${h.id}「${h.name}」[${h.status}] ${h.exact ? '完全相同' : '相似度 ' + h.similarity}`);
    process.exit(1);
  }
  let id;
  if (type === 'level' || type === 'figurine') {
    const num = reg.next[type] || 1;
    id = PREFIX[type] + String(num).padStart(PAD[type], '0');
    reg.next[type] = num + 1;
  } else {
    if (!custom) { console.error(`${type} 类型需要提供自定义 ID（如 box_mystery / series_03_fortune / ui_xxx）`); process.exit(2); }
    if (PREFIX[type] && !custom.startsWith(PREFIX[type])) { console.error(`ID 必须以 ${PREFIX[type]} 开头`); process.exit(2); }
    id = custom;
  }
  const taken = reg.entries.some(e => e.id === id && (e.type === type || (type !== 'asset' && e.type !== 'asset')));
  if (taken) { console.error(`❌ ID ${id} 已被占用（含已下架），不可复用`); process.exit(1); }
  reg.entries.push({ type, id, name, status: 'reserved', issuedAt: new Date().toISOString().slice(0, 10) });
  saveReg(reg);
  console.log(`✅ 已发放 ${id}「${name}」（状态 reserved，写入数据并执行 bootstrap 后转为 active）`);
}

function retire(id, reason) {
  const reg = loadReg();
  const e = reg.entries.find(x => x.id === id);
  if (!e) { console.error(`未找到 ${id}`); process.exit(1); }
  e.status = 'retired';
  e.retiredAt = new Date().toISOString().slice(0, 10);
  e.retireReason = reason || '';
  saveReg(reg);
  console.log(`已下架 ${id}「${e.name}」，其 ID / 名称 / 指纹永久保留占位。`);
}

function list(type) {
  const reg = loadReg();
  for (const e of reg.entries.filter(x => !type || x.type === type)) console.log(`${e.status.padEnd(8)} ${e.type.padEnd(8)} ${e.id.padEnd(24)} ${e.name}`);
}

if (require.main === module) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'bootstrap') bootstrap();
  else if (cmd === 'allocate') allocate(a, b, c);
  else if (cmd === 'retire') retire(a, b);
  else if (cmd === 'list') list(a);
  else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 11).join('\n')); }
}

module.exports = { loadReg, nameConflicts, collectContent };
