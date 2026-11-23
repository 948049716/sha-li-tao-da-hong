# 《星夜流沙瓶》日系治愈流沙解谜 · 微信小游戏仓库

> **核心体验（日系治愈极简版）**：宽幅通透玻璃沙箱抽片雪崩（静谧星夜轻绘风 + G 大调治愈钢琴风铃 ASMR） × 下层 `4+1` 接沙槽与 `4` 行高密度**系丝带糖果玻璃瓶**顺序博弈（第 `02~20` 关 `10~20` 瓶深度烧脑） + 纯序号极简无字图标 UI（1 秒直进当前关，微信单主包 `1.14 MB` 零美术分包） + 渐进式道具解锁与聚光灯新手指引。

---

## 目录结构

### 1. 核心策划与架构文档（`docs/`）
| 文档 | 说明 |
| :--- | :--- |
| [GDD_星夜流沙瓶.md](./docs/GDD_星夜流沙瓶.md) | **总纲设计文档（日系治愈极简版）**：静谧星夜轻绘风视觉重构、磨砂石英玻璃隔条与浅枫木奶油拨片、`4+1` 接沙槽与 `4` 行系丝带玻璃瓶（含 `?和纸盲瓶` / `❄冰封玻璃瓶`）、G 大调治愈音乐与玻璃清音、渐进道具聚光灯指引与纯序号 `01~20` 关卡体系 |
| [功能需求文档_PRD_v1.0.md](./docs/功能需求文档_PRD_v1.0.md) | **功能需求规格说明书（PRD）**：纯图标极简顶栏（`01` 选关胶囊 + `?` 速查圆钮 + `↻` 重玩圆钮）、无字四道具底栏（`02/03/04` 关渐进解锁）、聚光灯新道具/新机制首次指引（`seenGuides`）、开局零误流静稳态及 7 项 QA 自动化验收标准 |
| [关卡设计文档_星夜流沙瓶.md](./docs/关卡设计文档_星夜流沙瓶.md) | **关卡设计文档**：纯序号 `01~20` 关高密度上下双核逐关配置（`93.5%` 宽幅沙箱、`10~20` 只系丝带玻璃瓶队列、混合解法与双机器人反无脑校验）及 `LevelSchema v3.1` 标准 |
| [技术选型与架构设计文档.md](./docs/技术选型与架构设计文档.md) | **技术选型与架构设计文档**：**单套统一 TypeScript + Canvas 2D 代码库**（Web 与微信小游戏 100% 共享 `src/` 核心）、开局静稳态预落定物理、`4` 行候选玻璃瓶自适应几何、存档 Schema v2（含 `seenGuides`）与 `1.14 MB` 超轻主包规范 |
| [UI_UX交互与视听资产规范.md](./docs/UI_UX交互与视听资产规范.md) | **UI/UX 与视听资产规范**：磨砂奶油玻璃 Design Tokens v2、五段式高屏效竖屏线框、去文字纯图标控件体系、G 大调 `75 BPM` 毡音钢琴 + 钢片琴 + 风铃无缝循环 BGM 与玻璃清脆 SFX 事件表 |
| [美术资产清单与生图提示词手册.md](./docs/美术资产清单与生图提示词手册.md) | **美术资产手册**：30 项日系治愈核心视觉资产的规格、输出路径与 Qwen-Image v3 正/负提示词；局内实机界面与系丝带玻璃瓶以 [`gameplay_ref.jpg`](./docs/assets/gameplay_ref.jpg) 为唯一基准，[`cover.jpg`](./docs/assets/cover.jpg) 仅用于品牌主视觉参考 |
| [美术素材压缩与分包规范.md](./docs/美术素材压缩与分包规范.md) | **素材压缩与包体规范**：强制压缩入库准则、四边泛洪去背算法、8-bit PNG 量化、主包 `1.14 MB`（零美术分包）与 `audio` 分包 `500.5 KB` 门禁规范 |
| [内容去重与校验规范.md](./docs/内容去重与校验规范.md) | **去重与校验规范**：纯序号 ID 注册表永不复用、开局零误流静稳态门禁、双核关卡布局指纹/提示词/图片查重阈值、混合动作序列物理可解性与双反无脑机器人校验 |
| [reports/内容校验报告.md](./docs/reports/内容校验报告.md) | 最近一次全量校验报告（`01~20` 纯序号关卡混合解法通关 + 开局静稳态 + 盲派瓶/狂抽片双反测 + 陷阱验证 + 相似度排行） |
| [assets/gameplay_ref.jpg](./docs/assets/gameplay_ref.jpg) / [cover.jpg](./docs/assets/cover.jpg) | 视觉基准图：`gameplay_ref.jpg` 为静谧星夜轻绘风局内实机界面、系丝带玻璃瓶与流沙质感唯一参考图，`cover.jpg` 为品牌启动主视觉参考图 |
| [level_previews/](./docs/level_previews/) | 纯序号 `01~20` 关卡俯视预览图（含上层宽幅沙箱与底部 `3~4` 列高密度系丝带玻璃瓶矩阵，`overview_chapter_01.png` 为首章总览） |

### 2. 内容数据（`data/`）——游戏直接读取的唯一数据源
| 文件 | 说明 |
| :--- | :--- |
| `data/levels/chapter_01.json` | 首章 `01~20` 纯序号高密度上下双核配置（`LevelSchema v3.1`，零关卡标题，`02~20` 关 `10~20` 只系丝带玻璃瓶、含 `?和纸盲瓶` 与 `❄冰封玻璃瓶`） |
| `data/vessels.json` | 宽底黄铜滤沙格栅玻璃容器模板（标准方罐 / 窄高直筒罐 / 宽口大沙漏 / 珍珠奶茶杯，底部 `76~100` 格宽平底滤沙区） |
| `data/ui_tokens.json` | 全局日系治愈极简 UI 设计令牌 v2（磨砂象牙奶油卡片、淡暖灰轻绘细边、5 色糖果流沙与丝带调色板、高屏效竖屏栅格） |
| `data/audio_haptics.json` | 日系治愈听觉与触觉配置（G 大调 `maj9` 毡音钢琴 + 钢片琴 + 红木马林巴 + 玻璃风铃 BGM、清脆玻璃瓶碰击 WebAudio 合成器与 20 条事件绑定表） |
| `data/art/prompts.json` | `serene_starry_glass_atelier_v3` 画风锚点、风格预设、提示词模板与 30 项核心视觉资产 |
| `data/registry/id_registry.json` | 全内容 ID 注册表（纯序号关卡 / 美术资产 / 音频资产，含双核关卡指纹） |

### 3. 游戏源码架构与研发命令（单套统一 TypeScript 代码库）
* `src/engine/`：零平台依赖 `150×165` `Uint8Array` 流沙物理与双层玻璃瓶槽双核引擎（`SandEngine` + `BucketSystem`）、开局静默落定零误流机制（`settleInitialState`）、宽底滤沙格栅多流并发吸沙、`4+1` 接沙槽 FIFO 同色优先灌装、`3~4` 列 `4` 行系丝带玻璃瓶队列（含 `?和纸盲瓶` 揭晓与 `❄冰封玻璃瓶` 破冰）、磨砂石英玻璃隔条与浅枫木奶油拨片（`SandRenderer`）、高空脆冰 `44` 格硬底碎裂、颜色锁、水彩染色环、`1:1` 磁吸满瓶、智能洗牌与双动作撤回栈。
* `src/systems/`：精简状态机（`SPLASH → PLAYING → VICTORY`）、纯序号 `01~20` 关卡管理、按关渐进解锁纯 IAA 救援道具（`02` 撤回/加瓶、`03` 磁吸、`04` 洗牌）与存档 Schema v2（最高解锁关 / 总通关数 / 连胜 / 逐关最佳用时 / `seenGuides` 已读指引集）。
* `src/ui/`：启动直入页（`SplashScreen`）、高屏效极简主局内 HUD（`GameHUD`，纯图标顶栏 + 系丝带透明玻璃瓶彩沙渐满动效 + 无字四道具卡 + 纯图标死局救援窗）、双轨聚光灯手势引导（`FtueOverlay`，第 `01` 关四步引导 + 新道具/新机关首次登场镂空高亮引导）、纯序号结算卡（`VictoryModal`）、极简图解速查卡（`GuideModal`）与纯序号选关设置面板（`LevelDrawer`）。
* `src/platform/`：`WxPlatform` / `WebMockPlatform` 薄层双端桥接、`CanvasPolyfill`、微信双胶囊安全避让与 `93.5%` 宽沙箱 + `4` 行玻璃瓶托盘几何计算（`LayoutManager`）、G 大调治愈系 WebAudio 合成器与单主包着色缓存。
* `assets/`：经 `scripts/compress_assets.py` 泛洪去背与压缩校验入库的全部 30 项日系治愈美术资产（`934.2 KB`）、`bgm_workshop_starry.mp3`（`500.5 KB` 无缝循环）及 `manifest.json`。

```bash
npm install             # 安装构建依赖
npm run gen:bgm         # 合成 G 大调 75 BPM 日系治愈无缝循环 BGM -> assets/audio/bgm_workshop_starry.mp3
npm run dev             # 启动本地竖屏预览开发服 (http://localhost:5173)
npm run typecheck       # TypeScript strict 类型检查
npm run build           # 构建 Web 生产静态包 -> dist/
npm run build:wx        # 构建微信小游戏提审包 -> dist-wx/（主包 1.14 MB + audio 分包 500.5 KB）
npm run test:dedupe     # 运行关卡指纹与资产名称去重算法自测
npm run test:ac         # 运行日系治愈极简版 7 项核心 QA 自动化验收套件
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
