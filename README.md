# 《星夜流沙瓶》星夜工坊绘本水彩版 · 微信小游戏仓库

> **核心体验（星夜花房木作工坊绘本版 v5）**：星夜玻璃天窗通透水晶沙箱控流（G 大调治愈钢琴风铃 ASMR） × 蜂蜜橡木工作台 `4+1` 圆形杯托敞口药剂瓶与 `4` 条深胡桃木凹槽**「下近上远」软木塞玻璃瓶队列**深度博弈（流萤星砂 S 曲线入瓶光带 + 第 `02~20` 关 `10~20` 瓶策略排程） + 内置手账楷体 `StarryStorybook` 全中文绘本 UI（微信单主包 `1.42 MB` 含全部美术与字体，零美术分包） + 渐进式道具解锁与聚光灯新手指引。

---

## 目录结构

### 1. 核心策划与架构文档（`docs/`）
| 文档 | 说明 |
| :--- | :--- |
| [GDD_星夜流沙瓶.md](./docs/GDD_星夜流沙瓶.md) | **总纲设计文档（v5 绘本工坊版）**：严格对齐 5 张权威 UI 设计稿、星夜水晶漏斗沙箱与圆珠木拨片、实木工作台 `4+1` 圆杯托与 `4` 条 3D 深胡桃木凹槽（下近上远透视）、流萤星砂 S 曲线入瓶光带、内置 `StarryStorybook` 手绘字体与全中文界面规范 |
| [功能需求文档_PRD_v1.0.md](./docs/功能需求文档_PRD_v1.0.md) | **功能需求规格说明书（PRD）**：五大界面（启动加载页 / 局内主界面 / 图鉴弹窗 / 选关与设置抽屉 / 通关结算弹窗）交互与全中文文案规范、渐进道具与聚光灯首次指引（`seenGuides`）、开局零误流静稳态及 7 项 QA 自动化验收标准 |
| [关卡设计文档_星夜流沙瓶.md](./docs/关卡设计文档_星夜流沙瓶.md) | **关卡设计文档**：纯序号 `01~20` 关高密度上下双核逐关配置（通透沙箱、`10~20` 只系丝带玻璃瓶队列、混合解法与双机器人反无脑校验）及 `LevelSchema v3.1` 标准 |
| [技术选型与架构设计文档.md](./docs/技术选型与架构设计文档.md) | **技术选型与架构设计文档**：**单套统一 TypeScript + Canvas 2D 代码库**（Web `@font-face` 与微信 `wx.loadFont` 双端共享 `StarryStorybook` 手绘字体与 `src/` 核心）、开局静稳态预落定物理、实木工作台自适应几何、存档 Schema v2 与 `1.42 MB` 超轻主包规范 |
| [UI_UX交互与视听资产规范.md](./docs/UI_UX交互与视听资产规范.md) | **UI/UX 与视听资产规范**：5 张权威 UI 设计稿（`docs/assets/ui_design/*.webp`）逐屏实现映射、`StarryStorybook` 霞鹜文楷手账字体与微倾序号排版、浅橡木画框羊皮纸弹窗组件、G 大调 `75 BPM` 治愈 BGM 与玻璃清音规范 |
| [美术资产清单与生图提示词手册.md](./docs/美术资产清单与生图提示词手册.md) | **美术资产手册**：30 项星夜工坊绘本水彩核心视觉资产的规格、输出路径与 Qwen-Image v5 正/负提示词；局内实机以 [`gameplay_ref.jpg`](./docs/assets/gameplay_ref.jpg) 为唯一基准，启动主视觉以 [`cover.jpg`](./docs/assets/cover.jpg) 为基准 |
| [美术素材压缩与分包规范.md](./docs/美术素材压缩与分包规范.md) | **素材压缩与包体规范**：强制压缩入库准则、四边泛洪去背算法、8-bit PNG 量化、`ui_storybook.ttf` 字体子集化（`187.6 KB`）、主包 `1.42 MB` 与 `audio` 分包 `500.5 KB` 门禁规范 |
| [内容去重与校验规范.md](./docs/内容去重与校验规范.md) | **去重与校验规范**：纯序号 ID 注册表永不复用、开局零误流静稳态门禁、双核关卡布局指纹/提示词/图片查重阈值、混合动作序列物理可解性与双反无脑机器人校验 |
| [reports/内容校验报告.md](./docs/reports/内容校验报告.md) | 最近一次全量校验报告（`01~20` 纯序号关卡混合解法通关 + 开局静稳态 + 盲派瓶/狂抽片双反测 + 陷阱验证 + 相似度排行） |
| [assets/ui_design/](./docs/assets/ui_design/) | **5 张权威 UI 设计原稿归档**：`splash.webp`（启动加载页）、`gameplay.webp`（局内主界面）、`guide_modal.webp`（玩法与机关图鉴弹窗）、`level_drawer.webp`（选关与设置抽屉）、`victory_modal.webp`（通关结算弹窗） |
| [level_previews/](./docs/level_previews/) | 纯序号 `01~20` 关卡俯视预览图（含上层沙箱与底部候选玻璃瓶矩阵，`overview_chapter_01.png` 为首章总览） |

### 2. 内容数据（`data/`）——游戏直接读取的唯一数据源
| 文件 | 说明 |
| :--- | :--- |
| `data/levels/chapter_01.json` | 首章 `01~20` 纯序号高密度上下双核配置（`LevelSchema v3.1`，零关卡标题，`02~20` 关 `10~20` 只系丝带玻璃瓶、含 `?雾面问号瓶` 与 `❄冰晶瓶`） |
| `data/vessels.json` | 斜切漏斗木齿滤网水晶沙箱模板（标准方罐 / 窄高直筒罐 / 宽口大沙漏 / 珍珠奶茶杯，底部 `76~100` 格宽平底滤沙区） |
| `data/ui_tokens.json` | 全局星夜工坊绘本水彩 UI 设计令牌 v5（`StarryStorybook` 手账字体配置、浅橡木/羊皮纸/水彩晕染调色板、5 色流沙与丝带色值、高屏效竖屏栅格） |
| `data/audio_haptics.json` | 治愈系听觉与触觉配置（G 大调 `maj9` 毡音钢琴 + 钢片琴 + 红木马林巴 + 玻璃风铃 BGM、清脆玻璃瓶碰击 WebAudio 合成器与 20 条事件绑定表） |
| `data/art/prompts.json` | `starry_storybook_atelier_v5` 画风锚点、风格预设、提示词模板与 30 项核心视觉资产 |
| `data/registry/id_registry.json` | 全内容 ID 注册表（纯序号关卡 / 美术资产 / 音频资产，含双核关卡指纹） |

### 3. 游戏源码架构与研发命令（单套统一 TypeScript 代码库）
* `src/engine/`：零平台依赖 `150×165` `Uint8Array` 流沙物理与双层玻璃瓶槽双核引擎（`SandEngine` + `BucketSystem`）、开局静默落定零误流机制（`settleInitialState`）、宽底浅橡木竖齿滤网多流并发吸沙、`4+1` 圆形杯托 FIFO 同色优先灌装、`3~4` 列「下近上远」软木塞玻璃瓶队列（含 `?雾面问号瓶` 揭晓与 `❄冰晶瓶` 破冰）、高透星空水晶沙箱与圆珠木拨片/翡翠胶囊染色环（`SandRenderer`）及细微星砂流光粒子池（`ParticleSystem`）。
* `src/systems/`：精简状态机（`SPLASH → PLAYING → VICTORY`）、纯序号 `01~20` 关卡管理、按关渐进解锁纯 IAA 救援道具（`02` 撤回/加瓶、`03` 磁吸、`04` 洗牌）与存档 Schema v2（最高解锁关 / 总通关数 / 连胜 / 逐关最佳用时 / `seenGuides` 已读指引集）。
* `src/ui/`：双卷轴羊皮纸启动加载页（`SplashScreen`，立体木牌标题 + 飘带 + `8+ 适龄提示`）、星夜实木工作台主局内 HUD（`GameHUD`，`[⊞ 08]` 羊皮纸胶囊 + `[?][↻]` 圆木牌 + 敞口药剂瓶流萤 S 曲线入瓶 + 3D 胡桃木凹槽队列 + 暖奶油四道具方卡）、5 卡极简水彩插画图鉴弹窗（`GuideModal`，卷角羊皮纸 + 点卡片轻弹规则提示）、全中文选关与设置抽屉（`LevelDrawer`，`音效/震动/图鉴/云同步` + `01—20` 微倾序号木框/金框/石板网格）、水彩三卡结算弹窗（`VictoryModal`，`✦ 08 ✦` + 连胜胶囊 + 秒表/脚印/皇冠水彩卡 + `↻` / `▶ 09`）与聚光灯引导（`FtueOverlay`）。
* `src/platform/`：`WxPlatform`（含 `wx.loadFont` 真机自定义手账字体加载） / `WebMockPlatform`（`FontFace` 双端同字体桥接）、`CanvasPolyfill`、微信胶囊避让与星夜流沙净空几何计算（`LayoutManager`）、WebAudio 合成器与单主包着色缓存。
* `assets/`：经 `scripts/compress_assets.py` 泛洪去背与 8-bit 压缩校验入库的全部 30 项核心美术资产（`1017.2 KB`）、开源手账楷体子集 `assets/fonts/ui_storybook.ttf`（`187.6 KB`，`LXGW WenKai Medium` SIL OFL 1.1 子集）、`bgm_workshop_starry.mp3`（`500.5 KB` 无缝循环）及 `manifest.json`。

```bash
npm install             # 安装构建依赖
npm run gen:bgm         # 合成 G 大调 75 BPM 治愈无缝循环 BGM -> assets/audio/bgm_workshop_starry.mp3
npm run dev             # 启动本地竖屏预览开发服 (http://localhost:5173)
npm run typecheck       # TypeScript strict 类型检查
npm run build           # 构建 Web 生产静态包 -> dist/
npm run build:wx        # 构建微信小游戏提审包 -> dist-wx/（主包 1.42 MB 含美术与字体 + audio 分包 500.5 KB）
npm run test:dedupe     # 运行关卡指纹与资产名称去重算法自测
npm run test:ac         # 运行 7 项核心 QA 自动化验收套件
npm run render:levels   # 生成首章 01~20 纯序号关卡沙盘 + 候选玻璃瓶矩阵俯视预览图
npm run validate:fast   # 快速内容、开局零误流与图片 dHash 去重校验（CI 必跑）
npm run validate        # 全量双核物理模拟 + 反贪心/反乱抽机器人 + 陷阱校验 + 生成报告
```

### 4. 前期玩法验证原型（`demos/`）
| 文件 | 说明 |
| :--- | :--- |
| [sand_pin_blindbox_demo.html](./demos/sand_pin_blindbox_demo.html) | 早期概念验证单页原型（只读归档） |
| [sand_asmr_demo.html](./demos/sand_asmr_demo.html) | 流沙 ASMR 颗粒物理与音效验证原型 |
| [bobo_pop_demo.html](./demos/bobo_pop_demo.html) | 早期解压冒泡点击验证原型 |
