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
| [UI_UX交互与视听资产规范.md](./docs/UI_UX交互与视听资产规范.md) | **UI/UX 与视听资产规范（v1.0）**：全局 Design Tokens、6 大界面竖屏像素级线框、10 组动效曲线、双套系皮肤渲染算法、WebAudio 合成参数、19 项音频与震动联动清单及 87 项切图九宫格装配表 |
| [美术资产清单与生图提示词手册.md](./docs/美术资产清单与生图提示词手册.md) | **美术资产手册**：87 项视觉资产（UI 45 + 卡框 6 + 盲盒 6 + 公仔 30）的规格、输出路径与 Qwen-Image 正/负提示词，统一以封面 cover.jpg 为唯一画风基准（由 `data/art/prompts.json` 生成） |
| [美术素材压缩与分包规范.md](./docs/美术素材压缩与分包规范.md) | **素材压缩与分包红线规范（v1.0）**：强制压缩入库准则、全品类目标尺寸、保护内部白色的四边泛洪去背算法、8-bit PNG 量化与主分包体积预算门禁 |
| [内容去重与校验规范.md](./docs/内容去重与校验规范.md) | **去重与校验规范**：ID 注册表永不复用、名称/关卡布局/提示词/图片查重阈值、物理可解性校验、音频与 UI 令牌预算校验 |
| [reports/内容校验报告.md](./docs/reports/内容校验报告.md) | 最近一次全量校验报告（20 关物理通关 + 陷阱验证 + 反贪心与冰冻早抽反测 + 相似度排行） |
| [level_previews/](./docs/level_previews/) | 关卡俯视预览图（`overview_chapter_01.png` 为首章总览） |

### 2. 内容数据（`data/`）——游戏直接读取的唯一数据源
| 文件 | 说明 |
| :--- | :--- |
| `data/levels/chapter_01.json` | 首章 20 关可执行配置（LevelSchema v2.2，含脆冰/万年寒冰、反复推拉活门闸与绳轮双栓） |
| `data/vessels.json` | 容器模板（标准罐 / 窄高罐 / 宽沙漏 / 奶茶杯） |
| `data/figurines.json` | 30 款公仔、品质表、合成规则 |
| `data/blindboxes.json` | 6 款盲盒、概率表、暗保底、新手锁 |
| `data/ui_tokens.json` | 全局 UI 设计令牌（木屋主题色、5 色流沙噪点调色板、6 档品质色卡、6 阶头衔徽章、竖屏栅格与缓动曲线） |
| `data/audio_haptics.json` | 听觉与触觉配置（4 组 WebAudio 合成器、19 项主包/分包音效与 BGM 规格、微信震动序列、23 条事件绑定表） |
| `data/art/prompts.json` | 画风锚点、风格预设、提示词模板与 87 项视觉资产 |
| `data/registry/id_registry.json` | 全内容 ID 注册表（关卡 / 公仔 / 套系 / 盲盒 / 美术资产 / 音频资产，含已下架占位与关卡指纹） |

### 3. 游戏源码架构与研发命令（MVP v1.0）
* `src/engine/`：零平台依赖 `150×165` `Uint8Array` 流沙物理核心、双冰法则（高空脆冰软沙缓冲 + 万年寒冰冲刷融化）、反复推拉活门闸、绳轮联动双栓、1:1 容量守恒、3 步撤回与 `Uint32Array` 离屏像素渲染。
* `src/systems/`：状态机、20 关管理、6 档盲盒双暗保底抽奖、双档碎片合成、纯 IAA 激励与离线优先云同步。
* `src/ui/`：启动合规页、星夜工坊主菜单大厅（`HomeScreen`）、玩法与盲盒概率图鉴（`GuideModal`）、主局内 HUD、放大镜慢转鉴定台（含绝世大红全屏特写）、大红藏馆与选关设置抽屉。
* `src/platform/`：`WxPlatform`（`wx.onTouch*` 原生触摸绑定） / `WebMockPlatform` 双端适配、`CanvasPolyfill`（iOS JSCore 2D Context 圆角与高精度时钟兼容）、微信「更多游戏 + 官方胶囊」双胶囊安全避让、WebAudio 实时合成 ASMR 与压缩图集着色缓存。
* `assets/`：经 `scripts/compress_assets.py` 泛洪去背与压缩校验入库的全部 87 项绘本风美术资产及 `manifest.json`。

```bash
npm install             # 安装构建依赖
npm run dev             # 启动本地竖屏预览开发服 (http://localhost:5173)
npm run typecheck       # TypeScript strict 类型检查
npm run build           # 构建 Web 生产静态包 -> dist/
npm run build:wx        # 构建微信小游戏提审包 -> dist-wx/（自动切分主包与 figurines 分包并校验体积红线）
npm run test:ac         # 运行 PRD v1.0 全量 14 项 QA 自动化验收套件
npm run gen:assets      # 调用 ComfyUI + Qwen-Image-2.1 批量生图并自动压缩登记
npm run compress:assets # 批量压缩 assets/ 并执行单图体积门禁检查
npm run validate:fast   # 快速内容与图片 dHash 去重校验（CI 必跑）
npm run validate        # 全量校验 + 生成报告
```

### 4. 前期玩法验证原型（`demos/`）
| 文件 | 说明 |
| :--- | :--- |
| [sand_pin_blindbox_demo.html](./demos/sand_pin_blindbox_demo.html) | 核心流沙抽板 + 接沙桶 + 盲盒图鉴玩法验证单页原型 |
| [sand_asmr_demo.html](./demos/sand_asmr_demo.html) | 流沙 ASMR 颗粒物理与音效验证原型 |
| [bobo_pop_demo.html](./demos/bobo_pop_demo.html) | 早期解压冒泡点击验证原型 |
