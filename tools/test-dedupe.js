#!/usr/bin/env node
'use strict';
/** 去重机制自测：构造"换色克隆 / 镜像克隆 / 微调坐标 / 近似改名"等作弊样例，确认全部能被拦截。 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { levelFingerprint, levelSimilarity, nameSimilarity, normalizeText } = require('./lib/dedupe');
const { loadReg, nameConflicts } = require('./registry');

const ROOT = path.resolve(__dirname, '..');
const vessels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/vessels.json'), 'utf8'));
const levels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/levels/chapter_01.json'), 'utf8')).levels;
const clone = o => JSON.parse(JSON.stringify(o));
let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('  ✅ ' + msg); };

const base = levels.find(l => l.levelId === 7);
const fpBase = levelFingerprint(base, vessels);

// 1. 只换颜色
const recolor = clone(base);
const swap = { 1: 2, 2: 3, 3: 4, 4: 1 };
recolor.sandZones.forEach(z => { z.color = swap[z.color]; });
recolor.bucketQueue.forEach(b => { b.color = swap[b.color]; });
ok(levelSimilarity(fpBase, levelFingerprint(recolor, vessels)).score >= 0.9, '换色克隆关被识别（相似度 ≥90%）');

// 2. 左右镜像
const mirror = clone(base);
const mx = x => 149 - x;
mirror.staticWalls.forEach(w => { w.x0 = mx(w.x0); w.x1 = mx(w.x1); });
mirror.boards.forEach(b => { [b.x0, b.x1] = [mx(b.x1), mx(b.x0)]; [b.y0, b.y1] = [b.y1, b.y0]; });
mirror.sandZones.forEach(z => { [z.x0, z.x1] = [mx(z.x1), mx(z.x0)]; });
const sm = levelSimilarity(fpBase, levelFingerprint(mirror, vessels));
ok(sm.score >= 0.9 && sm.mirrored, '镜像克隆关被识别（相似度 ≥90% 且标记为镜像）');

// 3. 轻微挪动木板（±2 格）
const nudge = clone(base);
nudge.boards.forEach(b => { b.y0 += 2; b.y1 += 2; });
ok(levelSimilarity(fpBase, levelFingerprint(nudge, vessels)).score >= 0.85, '微调坐标的克隆关被识别（相似度 ≥85%）');

// 4. 真正不同的关卡不误报
const diff = levels.find(l => l.levelId === 15);
ok(levelSimilarity(fpBase, levelFingerprint(diff, vessels)).score < 0.8, '结构不同的关卡不会误报');

// 5. 资产/音频名称查重与纯序号关卡校验
ok(normalizeText('丝带 玻璃瓶！') === normalizeText('丝带玻璃瓶'), '名称归一化忽略空格与标点');
ok(nameSimilarity('染色环装置', '魔法染色环装置') >= 0.6, '"魔法染色环装置" 与 "染色环装置" 判定为近似名');
const reg = loadReg();
const sampleAsset = reg.entries.find(e => e.type === 'asset' && e.status === 'active');
ok(nameConflicts(reg, 'asset', sampleAsset.name).some(h => h.exact), '注册表拒绝完全同名的美术资产发号');
ok(nameConflicts(reg, 'asset', sampleAsset.name + '升级版').length > 0, '注册表拒绝近似名称的美术资产发号');
ok(nameConflicts(reg, 'asset', '风铃星盘折射镜').length === 0, '全新美术资产名称可以正常发号');

console.log(`\n去重自测全部通过（${pass} 项）`);
