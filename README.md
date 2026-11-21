# 《沙里淘大红》微信小游戏策划与设计文档仓库

> **核心体验**：抽木板流沙雪崩塌方（ASMR 解压） + 按序接沙防堵口（微策略） + 沙里淘大红盲盒图鉴（6 档品质收集 & 放大镜慢转鉴定） + 纯 IAA 商业化预留。

---

## 目录结构

### 1. 核心策划文档（`docs/`）
| 文档 | 说明 |
| :--- | :--- |
| [GDD_流沙抽板盲盒.md](./docs/GDD_流沙抽板盲盒.md) | **总纲设计文档（GDD v1.0）**：核心玩法循环、1:1 零残留接沙规则、6 大物理机关、6 档大红品质矩阵、纯 IAA 道具接口、纯 2D 微信小游戏技术架构 |
| [功能需求文档_PRD_v1.0.md](./docs/功能需求文档_PRD_v1.0.md) | **功能需求规格说明书（PRD v1.0）**：宝箱首通/复刷获取与双暗保底概率公式、30 款公仔单款权重速查表、双档碎片合成与满图鉴兜底、三大道具容量守恒/防刷逻辑、全界面交互流转与 14 项 QA 验收标准 |
| [关卡设计文档_沙里淘大红.md](./docs/关卡设计文档_沙里淘大红.md) | **关卡设计文档**：首批 1~20 关逐关详细配置（含机关、队列、解法与堵口陷阱）、第 21~100+ 关章节规划及可扩展 `LevelSchema` JSON 标准 |
| [盲盒设计文档_沙里淘大红.md](./docs/盲盒设计文档_沙里淘大红.md) | **盲盒设计文档**：首批 6 种绘本风盲盒/宝箱（素白/炫紫/流光金/至尊大红箱/极寒冰封/双黄蛋）、掉落概率矩阵、通关「复古放大镜慢转圈」鉴定节奏表与 `BlindBoxSchema` |
| [公仔设计文档_沙里淘大红.md](./docs/公仔设计文档_沙里淘大红.md) | **公仔藏品设计文档**：首批 30 款原创日系手绘绘本风藏品（《摸金打工萌宠》+《深夜暴富食堂》双套系）、6 档估值体系、碎片保底合成公式与 `FigurineSchema` |
| [技术选型与架构设计文档.md](./docs/技术选型与架构设计文档.md) | **技术选型与架构设计文档（v1.0）**：原生 TS + Canvas 2D + Vite 双端构建方案、微信云开发登录存档架构、核心模块设计、数据契约及 60FPS/包体优化规范 |
| [美术资产清单与生图提示词手册.md](./docs/美术资产清单与生图提示词手册.md) | **美术资产手册**：77 项资产（UI 35 + 盲盒 6 + 公仔 30）的规格、输出路径与 Qwen-Image 正/负提示词，统一锁定主图 / 风格参考图画风（由 `data/art/prompts.json` 生成） |
| [内容去重与校验规范.md](./docs/内容去重与校验规范.md) | **去重与校验规范**：ID 注册表永不复用、名称/关卡布局/提示词/图片查重阈值、物理可解性校验、新增内容流程 |
| [reports/内容校验报告.md](./docs/reports/内容校验报告.md) | 最近一次全量校验报告（20 关物理通关 + 陷阱验证 + 相似度排行） |
| [level_previews/](./docs/level_previews/) | 关卡俯视预览图（`overview_chapter_01.png` 为首章总览） |

### 2. 内容数据（`data/`）——游戏直接读取的唯一数据源
| 文件 | 说明 |
| :--- | :--- |
| `data/levels/chapter_01.json` | 首章 20 关可执行配置（LevelSchema v2） |
| `data/vessels.json` | 容器模板（标准罐 / 窄高罐 / 宽沙漏 / 奶茶杯） |
| `data/figurines.json` | 30 款公仔、品质表、合成规则 |
| `data/blindboxes.json` | 6 款盲盒、概率表、暗保底、新手锁 |
| `data/art/prompts.json` | 画风锚点、风格预设、提示词模板与 77 项资产 |
| `data/registry/id_registry.json` | 全内容 ID 注册表（含已下架占位与关卡指纹） |

### 3. 工具（`tools/`，Node ≥18，零依赖）
```bash
npm run validate        # 全量校验 + 生成报告（物理通关、陷阱、去重、概率、提示词）
npm run validate:fast   # 快速校验（CI 使用）
npm run test:dedupe     # 去重算法自测
npm run render:levels   # 生成关卡预览图
npm run gen:art-doc     # 重新生成美术手册
npm run registry -- allocate figurine "新公仔名"   # 申请新 ID
```

### 4. 前期玩法验证原型（`demos/`）
| 文件 | 说明 |
| :--- | :--- |
| [sand_pin_blindbox_demo.html](./demos/sand_pin_blindbox_demo.html) | 核心流沙抽板 + 接沙桶 + 盲盒图鉴玩法验证单页原型 |
| [sand_asmr_demo.html](./demos/sand_asmr_demo.html) | 流沙 ASMR 颗粒物理与音效验证原型 |
| [bobo_pop_demo.html](./demos/bobo_pop_demo.html) | 早期解压冒泡点击验证原型 |
