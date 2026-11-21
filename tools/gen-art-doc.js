#!/usr/bin/env node
'use strict';
/** 由 data/art/prompts.json 自动生成《美术资产清单与生图提示词手册》，保证手册与批量生图脚本 100% 一致。 */
const fs = require('fs');
const path = require('path');
const { buildPrompt } = require('./lib/prompt');

const ROOT = path.resolve(__dirname, '..');
const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/art/prompts.json'), 'utf8'));
const OUT = path.join(ROOT, 'docs/美术资产清单与生图提示词手册.md');

const groups = [];
for (const a of art.assets) if (!groups.includes(a.group)) groups.push(a.group);
const catName = { figurine: '公仔立绘', blindbox: '盲盒', ui_background: '背景', ui_icon: '图标', ui_frame: '卡框', ui_texture: '局内贴图' };

const L = [];
L.push('# 《沙里淘大红》美术资产清单与生图提示词手册');
L.push('');
L.push('> [!IMPORTANT]');
L.push('> 本手册由 `node tools/gen-art-doc.js` 根据 [`data/art/prompts.json`](../data/art/prompts.json) **自动生成，请勿手改**。新增或修改素材时只改 JSON，再重新生成手册；批量生图脚本也读取同一份 JSON，所以手册、校验和出图永远一致。');
L.push('');
L.push('## 1. 画风一致性硬规范（所有素材强制执行）');
L.push('');
L.push('| 项目 | 规范 |');
L.push('| :--- | :--- |');
L.push(`| **图1·风格参考图** | \`${art.styleAnchors.image_1.file}\`（本地源 \`${art.styleAnchors.image_1.localSource}\`）：唯一的笔触 / 排线 / 色调基准，每张图都必须接入 \`TextEncodeQwenImage21\` 的 \`images.image_1\`（resolution 768） |`);
L.push(`| **图2·游戏主图** | \`${art.styleAnchors.image_2.file}\`（${art.styleAnchors.image_2.localSource}）：整体氛围、配色比例、木屋星夜工坊世界观基准；上传后接入 \`images.image_2\`，批量脚本加 \`--key-art\` 开启 |`);
L.push('| **线条** | 深棕色 #4A2F1D 钢笔墨线，带手绘抖动与粗细变化；禁止纯黑粗描边、禁止矢量等宽线 |');
L.push('| **阴影** | 只用平行/交叉排线，禁止喷枪渐变与 3D 光影 |');
L.push('| **色彩** | 底调：奶油米 / 蜂蜜木 / 焦糖棕；点缀：草莓粉 #FF5D73、芒果黄 #FFB830、海盐蓝 #38B6FF、青提绿 #4CD97B（与流沙颜色一致） |');
L.push('| **质感** | 水彩 + 彩铅叠色平涂，轻微纸张颗粒；高光为奶白小色块 |');
L.push('| **品质材质** | 白=哑光软陶 / 绿=哑光软胶 / 蓝=亮面釉彩 / 紫=半透明果冻琉璃 / 金=24K 镀金 / 红=深红宝石+金花丝；光效始终贴近主体，不铺满背景 |');
L.push('| **抠图约束** | 公仔、盲盒、图标、贴图、卡框一律纯白 #FFFFFF 背景、无投影、无场景、主体完整不裁切；出图后统一抠成透明 PNG |');
L.push('| **文字约束** | 除 Logo「沙里淘大红」、馒头上的「福」、大红盒/大红卡框上的「红」字外，任何素材都不得出现文字 |');
L.push('| **禁区** | 不得把非猫公仔画成猫；任何素材不得出现三花猫；不复制参考图构图与角色 |');
L.push('| **采样参数** | Qwen-Image-2.1 · euler / simple · 28 steps · CFG 4.2 · 种子按 assetId 固定（可复现） |');
L.push('');
L.push('### 1.1 全局画风前缀（自动拼接在每条提示词最前面）');
L.push('');
L.push('```text');
L.push(art.stylePreset.prefix);
L.push('```');
L.push('');
L.push('### 1.2 全局负面提示词');
L.push('');
L.push('```text');
L.push(art.stylePreset.negative);
L.push('```');
L.push('');
L.push('## 2. 素材总清单');
L.push('');
L.push(`共 **${art.assets.length}** 项素材：`);
L.push('');
L.push('| 分组 | 数量 | 说明 |');
L.push('| :--- | :---: | :--- |');
for (const g of groups) {
  const list = art.assets.filter(a => a.group === g);
  L.push(`| ${g} | ${list.length} | ${list.map(a => a.title).join('、')} |`);
}
L.push('');
L.push('| # | assetId | 名称 | 类型 | 尺寸 | 透明底 | 输出路径 |');
L.push('| :---: | :--- | :--- | :--- | :---: | :---: | :--- |');
art.assets.forEach((a, i) => {
  const p = buildPrompt(a, art);
  L.push(`| ${i + 1} | \`${a.assetId}\` | ${a.title}${a.rarity ? `（${a.rarity}）` : ''} | ${catName[a.category]} | ${p.width}×${p.height} | ${a.transparent ? '✅' : '—'} | \`${a.output}\` |`);
});
L.push('');
L.push('## 3. 逐项完整提示词');
L.push('');
L.push('> 每条“完整正向提示词”= 全局画风前缀 + 品类模板 + 主体描述，可直接复制到 ComfyUI 的 `TextEncodeQwenImage21.prompt`；负面提示词填入 `negative_prompt`。');
L.push('');
let n = 0;
for (const g of groups) {
  L.push(`### ${g}`);
  L.push('');
  for (const a of art.assets.filter(x => x.group === g)) {
    n++;
    const p = buildPrompt(a, art);
    L.push(`#### ${n}. ${a.title} · \`${a.assetId}\``);
    L.push('');
    L.push(`- **尺寸**：${p.width}×${p.height}　**种子**：${p.seed}　**透明底**：${a.transparent ? '是（纯白底出图后抠图）' : '否'}　**输出**：\`${a.output}\``);
    if (a.rarity) L.push(`- **品质**：${a.rarity}（${art.rarityLooks[a.rarity].look}）`);
    L.push(`- **主体描述**：${a.subject}`);
    L.push('');
    L.push('```text');
    L.push(p.positive);
    L.push('```');
    L.push('');
  }
}
L.push('## 4. 去重与新增素材流程');
L.push('');
L.push('1. `node tools/registry.js allocate asset "<素材名>" <assetId>`：注册表先做名称精确 + 模糊查重（包括已下架素材），通过才发 ID；');
L.push('2. 在 `data/art/prompts.json` 追加条目，只写 `subject` 主体描述，画风前缀与模板自动套用；');
L.push('3. `node tools/registry.js bootstrap && node tools/validate-content.js --fast`：主体描述两两比对，相似度 ≥0.80 直接报错（避免出雷同图），≥0.62 给警告；');
L.push('4. `node tools/gen-art-doc.js` 重新生成本手册；');
L.push('5. 出图后批量脚本把每张图的 dHash 感知哈希写入 `assets/manifest.json`，校验器会把汉明距离 ≤6 的图判为重复图。');
L.push('');
fs.writeFileSync(OUT, L.join('\n'));
console.log(`已生成 ${path.relative(ROOT, OUT)}（${art.assets.length} 项素材）`);
