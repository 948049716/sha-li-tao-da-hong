# 《沙里淘大红》微信小游戏策划与研发仓库

> **核心体验**：上层抽栓流沙雪崩塌方（ASMR 解压） + 下层 `4+1` 小卡槽与前后排候选木桶顺序博弈（上下双核强耦合解谜） + 沙里淘大红盲盒图鉴（6 档品质收集 & 放大镜慢转鉴定） + 纯 IAA 商业化预留。

---

## 目录结构

### 1. 核心策划与架构文档（`docs/`）
| 文档 | 说明 |
| :--- | :--- |
| [GDD_流沙抽板盲盒.md](./docs/GDD_流沙抽板盲盒.md) | **总纲设计文档（GDD v2.0 双核版）**：上下双核强耦合玩法循环、宽底黄铜滤沙格栅、`4+1` 小卡槽 FIFO 与前后排候选桶（含 `❓问号盲桶` / `🧊冰封木桶`）、精简上层物理机关、四大局内救援道具与纯 IAA 接口 |
| [功能需求文档_PRD_v1.0.md](./docs/功能需求文档_PRD_v1.0.md) | **功能需求规格说明书（PRD）**：双层木工台与上下耦合交互规则、两阶段死局预警与救援弹窗、四大道具 `1:1` 容量守恒与智能洗牌算法、宝箱概率与双暗保底公式、30 款公仔权重与碎片合成、14 项 QA 自动化验收标准 |
| [关卡设计文档_沙里淘大红.md](./docs/关卡设计文档_沙里淘大红.md) | **关卡设计文档**：首批 1~20 关上下双核逐关配置（容器、上层机关、`3~4` 列前后排木桶矩阵、混合解法与死局陷阱）、第 21~100+ 关章节规划及 `LevelSchema v3.0` 标准 |
| [盲盒设计文档_沙里淘大红.md](./docs/盲盒设计文档_沙里淘大红.md) | **盲盒设计文档**：首批 6 种绘本风盲盒/宝箱（素白/炫紫/流光金/至尊大红箱/极寒冰封/双黄蛋）、掉落概率矩阵、通关「复古放大镜慢转圈」鉴定节奏表与 `BlindBoxSchema` |
| [公仔设计文档_沙里淘大红.md](./docs/公仔设计文档_沙里淘大红.md) | **公仔藏品设计文档**：首批 30 款原创日系手绘绘本风藏品（《摸金打工萌宠》+《深夜暴富食堂》双套系）、6 档估值体系、碎片保底合成公式与 `FigurineSchema` |
| [技术选型与架构设计文档.md](./docs/技术选型与架构设计文档.md) | **技术选型与架构设计文档**：**单套统一 TypeScript + Canvas 2D 代码库**（Web 与微信小游戏 100% 共享 `src/` 核心）、宽底格栅物理与双层桶槽架构、微信云开发存档同步、数据契约与 60FPS/包体优化规范 |
| [UI_UX交互与视听资产规范.md](./docs/UI_UX交互与视听资产规范.md) | **UI/UX 与视听资产规范**：全局 Design Tokens、竖屏五段式双核工作台线框（顶栏五胶囊 + 宽底滤沙格栅玻璃箱 + `4+1` 接沙槽 + `3~4` 列候选桶滑道 + 四道具栏）、多股贝塞尔流沙飞线、WebAudio 合成器与 28 项声光震事件联动表 |
| [美术资产清单与生图提示词手册.md](./docs/美术资产清单与生图提示词手册.md) | **美术资产手册**：87 项视觉资产（UI 45 + 卡框 6 + 盲盒 6 + 公仔 30）的规格、输出路径与 Qwen-Image 正/负提示词；局内实机界面与流沙质感以 [`gameplay_ref.jpg`](./docs/assets/gameplay_ref.jpg) 为唯一基准，[`cover.jpg`](./docs/assets/cover.jpg) 仅用于封面与角色比例参考 |
| [美术素材压缩与分包规范.md](./docs/美术素材压缩与分包规范.md) | **素材压缩与分包红线规范**：强制压缩入库准则、全品类目标尺寸、保护内部白色的四边泛洪去背算法、8-bit PNG 量化与主分包体积预算门禁 |
| [内容去重与校验规范.md](./docs/内容去重与校验规范.md) | **去重与校验规范**：ID 注册表永不复用、名称/双核关卡布局指纹/提示词/图片查重阈值、混合动作序列物理可解性与反无脑策略校验 |
| [reports/内容校验报告.md](./docs/reports/内容校验报告.md) | 最近一次全量校验报告（20 关上下双核混合解法通关 + 盲派桶/狂按首列反测 + 陷阱验证 + 相似度排行） |
| [assets/gameplay_ref.jpg](./docs/assets/gameplay_ref.jpg) / [cover.jpg](./docs/assets/cover.jpg) | 视觉基准图：`gameplay_ref.jpg` 为局内实机界面与流沙质感参考图，`cover.jpg` 仅为封面主视觉参考图 |
| [level_previews/](./docs/level_previews/) | 关卡俯视预览图（含上层沙盘与底部 `3~4` 列候选桶矩阵，`overview_chapter_01.png` 为首章总览） |

### 2. 内容数据（`data/`）——游戏直接读取的唯一数据源
| 文件 | 说明 |
| :--- | :--- |
| `data/levels/chapter_01.json` | 首章 20 关上下双核可执行配置（`LevelSchema v3.0`，含 `"col:K"` 派桶与 `"<boardId>"` 抽栓混合解法、`❓问号盲桶` 与 `🧊冰封木桶`） |
| `data/vessels.json` | 宽底黄铜滤沙格栅容器模板（标准方罐 / 窄高直筒罐 / 宽口大沙漏 / 珍珠奶茶杯，底部 `76~100` 格宽平底滤沙区） |
| `data/figurines.json` | 30 款公仔、品质表、合成规则 |
| `data/blindboxes.json` | 6 款盲盒、概率表、暗保底、新手锁 |
| `data/ui_tokens.json` | 全局 UI 设计令牌（木屋主题色、5 色流沙噪点调色板、6 档品质色卡、6 阶头衔徽章、竖屏栅格与缓动曲线） |
| `data/audio_haptics.json` | 听觉与触觉配置（4 组 WebAudio 合成器、19 项主包/分包音效与 BGM 规格、微信震动序列、28 条事件绑定表） |
| `data/art/prompts.json` | 画风锚点、风格预设、提示词模板与 87 项视觉资产 |
| `data/registry/id_registry.json` | 全内容 ID 注册表（关卡 / 公仔 / 套系 / 盲盒 / 美术资产 / 音频资产，含已下架占位与双核关卡指纹） |

### 3. 游戏源码架构与研发命令（单套统一 TypeScript 代码库）
* `src/engine/`：零平台依赖 `150×165` `Uint8Array` 流沙物理与双层桶槽双核引擎（`SandEngine` + `BucketSystem`）、宽底黄铜滤沙格栅多流并发吸沙、`4+1` 小卡槽 FIFO 同色优先分配、`3~4` 列前排挡后排候选桶（含 `❓问号盲桶` 翻牌与 `🧊冰封木桶` 破冰）、高空脆冰 `44` 格硬底碎裂、颜色锁、魔法染色环、`1:1` 磁吸满桶、智能候选洗牌、双动作（抽栓/派桶）撤回栈、两阶段死局检测与 `3x` 超采样像素渲染。
* `src/systems/`：全局状态机、20 关管理与新机制横幅、6 档盲盒双暗保底抽奖、双档碎片合成、纯 IAA 激励（含 `SHUFFLE`）与离线优先云同步。
* `src/ui/`：启动合规页、星夜工坊主菜单大厅（`HomeScreen`）、双核玩法与盲盒概率图鉴（`GuideModal`）、双层木工台主局内 HUD（含顶栏免费重玩、多股贝塞尔彩沙流线、两阶段死局救援弹窗）、第 1 关四步双核手势引导（`FtueOverlay`）、放大镜慢转鉴定台、大红藏馆与选关设置抽屉。
* `src/platform/`：`WxPlatform` / `WebMockPlatform` 薄层双端桥接（Web 与微信小游戏 100% 共用同一套 `src/` 业务与引擎代码）、`CanvasPolyfill`、微信双胶囊安全避让与五段式竖屏几何布局（`LayoutManager`）、WebAudio 实时合成 ASMR 与压缩图集着色缓存。
* `assets/`：经 `scripts/compress_assets.py` 泛洪去背与压缩校验入库的全部 87 项绘本风美术资产及 `manifest.json`。

```bash
npm install             # 安装构建依赖
npm run dev             # 启动本地竖屏预览开发服 (http://localhost:5173)
npm run typecheck       # TypeScript strict 类型检查
npm run build           # 构建 Web 生产静态包 -> dist/
npm run build:wx        # 构建微信小游戏提审包 -> dist-wx/（自动切分主包与 figurines 分包并校验体积红线）
npm run test:dedupe     # 运行关卡指纹、名称与公仔去重算法自测
npm run test:ac         # 运行 PRD 全量 14 项 QA 自动化验收套件（覆盖上下双核物理、四道具与盲盒保底）
npm run render:levels   # 生成首章 20 关上层沙盘 + 下层候选桶列俯视预览图
npm run validate:fast   # 快速内容与图片 dHash 去重校验（CI 必跑）
npm run validate        # 全量双核物理模拟 + 反贪心/反乱点校验 + 生成报告
```

### 4. 前期玩法验证原型（`demos/`）
| 文件 | 说明 |
| :--- | :--- |
| [sand_pin_blindbox_demo.html](./demos/sand_pin_blindbox_demo.html) | 早期流沙抽板 + 接沙桶 + 盲盒图鉴概念验证单页原型（只读归档） |
| [sand_asmr_demo.html](./demos/sand_asmr_demo.html) | 流沙 ASMR 颗粒物理与音效验证原型 |
| [bobo_pop_demo.html](./demos/bobo_pop_demo.html) | 早期解压冒泡点击验证原型 |
