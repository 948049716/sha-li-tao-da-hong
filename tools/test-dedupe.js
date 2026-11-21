#!/usr/bin/env node
'use strict';
/** 去重机制自测：构造"换色克隆 / 镜像克隆 / 近似改名"等作弊样例，确认全部能被拦截。 */
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
mirror.capsules.forEach(c => { c.x = mx(c.x); });
const sm = levelSimilarity(fpBase, levelFingerprint(mirror, vessels));
ok(sm.score >= 0.9 && sm.mirrored, '镜像克隆关被识别（相似度 ≥90% 且标记为镜像）');

// 3. 轻微挪动木板（±2 格）
const nudge = clone(base);
nudge.boards.forEach(b => { b.y0 += 2; b.y1 += 2; });
ok(levelSimilarity(fpBase, levelFingerprint(nudge, vessels)).score >= 0.85, '微调坐标的克隆关被识别（相似度 ≥85%）');

// 4. 真正不同的关卡不误报
const diff = levels.find(l => l.levelId === 15);
ok(levelSimilarity(fpBase, levelFingerprint(diff, vessels)).score < 0.8, '结构不同的关卡不会误报');

// 5. 名称查重
ok(normalizeText('非洲之心 鸭！') === normalizeText('非洲之心鸭'), '名称归一化忽略空格与标点');
ok(nameSimilarity('纯金招财橘猫', '纯金招财大橘猫') >= 0.6, '"纯金招财大橘猫" 与 "纯金招财橘猫" 判定为近似名');
const reg = loadReg();
ok(nameConflicts(reg, 'figurine', '纯金招财大橘猫').length > 0, '注册表拒绝为近似名发号');
ok(nameConflicts(reg, 'figurine', '困困团子鼠').some(h => h.exact), '注册表拒绝完全同名');
ok(nameConflicts(reg, 'figurine', '铜钱小锦鲤').length === 0, '全新名称可以正常发号');

console.log(`\n去重自测全部通过（${pass} 项）`);
