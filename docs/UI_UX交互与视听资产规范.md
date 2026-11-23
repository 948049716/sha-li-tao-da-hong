# 《星夜流沙瓶》星夜工坊绘本水彩版 UI/UX 交互与视听资产规范（v5.0）

> [!NOTE]
> 本文档定义《星夜流沙瓶》v5 绘本工坊版（`starry_storybook_atelier_v5`）严格对齐 5 张权威 UI 设计原稿（[`docs/assets/ui_design/`](./assets/ui_design/)）的全局 Design Tokens（[`data/ui_tokens.json`](../data/ui_tokens.json)）、内置手账楷体 `StarryStorybook` 与微倾序号排版、全中文无英文残留规范、五段式星夜实木工作台布局、五大界面 1:1 视觉实现以及 G 大调治愈音乐与玻璃清音规范（[`data/audio_haptics.json`](../data/audio_haptics.json)）。

---

## 1. 五张权威 UI 设计原稿与视觉系统基准

| 界面模块 | 权威设计原稿 | 源码实现文件 | 核心视觉与交互特征 |
| :--- | :--- | :--- | :--- |
| **启动加载页** | [`splash.webp`](./assets/ui_design/splash.webp) | [`src/ui/SplashScreen.ts`](../src/ui/SplashScreen.ts) | 星夜玻璃花房悬浮丝带许愿瓶 + 立体双描边木牌标题《星夜流沙瓶》+ 微拱羊皮纸飘带「流沙入瓶 · 静谧解谜」+ 左右双卷轴羊皮纸加载条 + 左下角全中文「`8+ 适龄提示`」徽章 |
| **局内主界面** | [`gameplay.webp`](./assets/ui_design/gameplay.webp) | [`src/ui/GameHUD.ts`](../src/ui/GameHUD.ts)<br>[`src/engine/SandRenderer.ts`](../src/engine/SandRenderer.ts) | 顶栏左 `[⊞ 08]` 羊皮纸胶囊 + 右 `[?][↻]` 雕刻圆木牌；高透星空水晶漏斗沙箱（圆珠木拨片 + 翡翠胶囊染色环 + 浅橡木竖齿滤网）；48~56px 星夜流光净空内流萤星砂 S 曲线光带钻入敞口药剂瓶；蜂蜜橡木工作台 `4+1` 圆形杯托 + `4` 条 3D 斜切深胡桃木凹槽（**下近上远**透视队列）；桌下深棕暗影栏 4 枚暖奶油圆角方卡道具钮 |
| **玩法与机关图鉴弹窗** | [`guide_modal.webp`](./assets/ui_design/guide_modal.webp) | [`src/ui/GuideModal.ts`](../src/ui/GuideModal.ts) | 星夜草药工坊虚化后景 + 浅橡木画框 + 右下卷角象牙羊皮纸内衬 + 微拱飘带「玩法与机关图鉴」+ 右上珊瑚粉 `×` 关闭圆钮 + 5 张圆角白底水彩插画卡（点击卡片弹出单行规则轻提示） |
| **选关与设置抽屉** | [`level_drawer.webp`](./assets/ui_design/level_drawer.webp) | [`src/ui/LevelDrawer.ts`](../src/ui/LevelDrawer.ts) | 顶部 4 枚全中文开关/功能圆钮（`音效 / 震动 / 图鉴 / 云同步`）夹持手写微倾 `01—20` + 中部 `4×5` 选关方格（已通关浅木框配秒数与绿勾 `✓`、当前关暖金发光框、未解锁灰褐凹石板配小锁、`10/20` 关顶戴小皇冠）+ 底部左 `8+ 适龄` / `隐私指引` 与右双嫩叶 `07/20` 进度章 |
| **通关结算弹窗** | [`victory_modal.webp`](./assets/ui_design/victory_modal.webp) | [`src/ui/VictoryModal.ts`](../src/ui/VictoryModal.ts) | 飘落暖金发光纸屑 + 浅橡木画框象牙面板 + 大号微倾手写 `✦ 08 ✦` + 暖金发光胶囊「`3 连胜 · 新纪录`」+ 3 张手绘水彩晕染战绩竖卡（暖杏橙秒表 / 晴空蓝脚印 / 薄荷绿皇冠）+ 底部左实木方钮 `↻` 与右森林绿宽钮 `▶ 09` |

### 1.1 定制手账字体（`StarryStorybook`）与全中文铁律
1. **双端一致内置手账楷体**：仓库内置开源字体 **霞鹜文楷 Medium（`LXGW WenKai Medium`，SIL OFL 1.1）** 精简子集 [`assets/fonts/ui_storybook.ttf`](../assets/fonts/ui_storybook.ttf)（`567` 字形，仅 `187.6 KB`，TTF 内部族名统一设为 `StarryStorybook`）。
   - Web 端通过 [`index.html`](../index.html) `@font-face` 与 `FontFace` API 预加载；
   - 微信小游戏端通过 [`WxPlatform.loadCustomFont()`](../src/platform/WxPlatform.ts) 调用 `wx.loadFont('assets/fonts/ui_storybook.ttf')` 注册同一字体族。
2. **微倾手写数字排版（`drawStorybookNumber`）**：对关卡序号与战绩数字（`08`、`01—20`、`24.5s`、`▶ 09`）施加 `-0.04 ~ -0.10` 水平微斜变换与温润纸面压印高光，复刻设计原稿的手写温度。
3. **100% 纯中文界面 & 零系统原生 Emoji**：全游界面仅保留规范中文与阿拉伯数字单位（如 `适龄提示`、`音效 / 震动 / 图鉴 / 云同步`），所有图标均由高精度手绘水彩贴图或 [`UIHelpers.drawHandDrawnGlyph`](../src/ui/UIHelpers.ts) 钢笔水彩路径绘制，严禁渲染系统 Emoji。

### 1.2 五色流沙与丝带调色板（`data/ui_tokens.json`）
* `1` 樱花粉 `#F28B97`、`2` 暖麦杏黄 `#F4C45A`、`3` 晴空海盐蓝 `#65B8F0`、`4` 若竹薄荷绿 `#70CF98`、`5` 星耀金沙 `#FAD246`；深胡桃手绘钢笔线统一为 `#3B2416`。

---

## 2. 五段式星夜实木工作台安全区布局（`LayoutManager`）

所有竖屏机型（`375×667`、`393×852`、`384×864` 等）严格执行五段式零重叠几何布局：
1. **第一段：顶栏（置于微信右上角胶囊 `menuButtonRect` 正下方 `5px`）**
   - 左 `settingsPill`：日系温暖和纸单细墨线圆角胶囊（`2×2` 可可棕手绘方块图标 + 两位序号 `08`），去除厚重复古双白框，保持与右侧双圆钮左右贴边对称。
   - 右二 `guidePill` / 右一 `restartPill`：两枚浅桦木水彩铅笔木纹圆钮（`?` 图鉴钮与右侧开口顺时针 `↻` 免费重玩钮）。
2. **第二段：星夜通透水晶漏斗沙箱（`chamberRect`）与宽出细入漏斗流沙净空**
   - 沙箱内部空白区域全透明透出后方午夜靛蓝星空天窗；`2x` 脏行切片流沙渲染器消除流动时纵向白条；底部镶嵌浅橡木梯形竖齿滤网（`| | | |`），沙箱底口与敞口玻璃瓶口之间预留 **`24~48px` 星夜流光净空**，呈现从多道齿缝宽幅涌出、柔美 S 弯飘摆、至瓶口精准收束钻入的漏斗状流萤沙带（支持起流延伸与断流收尾过渡）。
3. **第三段：实木工作台上层 `4+1` 圆形杯托接沙位（`slotRowRect`）**
   - 桌面后沿地平线穿过修长药剂瓶中下腹，使双层圆润玻璃领圈与饱满长飘带蝴蝶结清透立于星夜背景前；通体同色粉彩半透明玻璃显露真实左右与底部内壁玻璃厚度；点选前排瓶时抛物线跃入杯托并轻弹拔塞，满瓶瞬间先落塞封口弹性微蹲，再沿侧上方抛物弧线伴随星芒尾迹轻跳离槽。
4. **第四段：实木工作台下层 `4` 条短巧透视暖木凹槽队列（`candidateAreaRect`）**
   - 桌面挖设 `3~4` 条温润肉桂木斜切透视凹槽，每槽疏朗显露最多 **`3` 只**软木塞候选瓶（第 3 只瓶塞自然微露于槽后沿之上，第 2 只燕麦雾面瓶 `?` 完整高于前排木塞）；**严格前排顺序限制**：唯独最前排瓶（`r = 0`）高亮并拥有宽松点触热区，误触后排瓶触发后排摇晃、前排金框高亮与轻提示「请按顺序先取用最前排的玻璃瓶」。
5. **第五段：桌下深棕暗影四道具底栏（`propRowRect`）**
   - 实木桌前沿木边下方居中排布 4 枚日系和纸圆角方卡（**纤巧可可 C 形回退箭头 / 左上 `-44°` 开口豆沙粉 U 形磁铁 / 修长鼠尾草绿药剂瓶`+` / 中心带穿插留白断口的双 S 洗牌箭头**），右上角嵌和纸圆角小方章展示状态/剩余次数。

---

## 3. 治愈音乐（Gmaj9 75BPM）与玻璃器皿音效规范

详见 [`data/audio_haptics.json`](../data/audio_haptics.json) 与合成脚本 [`scripts/compose_bgm.mjs`](../scripts/compose_bgm.mjs)：
* **无缝循环治愈 BGM（`bgm_workshop_starry.mp3`）**：`75 BPM` 4/4 拍温暖 G 大调 `Gmaj9 → Em9 → Cmaj9 → D13sus4` 进行（毡音钢琴 + 钢片琴 + 红木马林巴 + 玻璃风铃），时长 `51.2s` 无缝循环（`500.5 KB` 归入 `subpackages/audio/`），在 `2.7kHz` 预留 `-7dB` 流沙 ASMR 避让凹槽。
* **清脆玻璃瓶与木作 WebAudio 合成器**：点选软木塞玻璃瓶触发清亮水晶轻碰声与马林巴泛音；抽动圆珠木拨片触发温润木滑轨声；满瓶封塞跃离触发 G 大调五声音阶递升钢片琴清音。

---

## 4. 美术与字体资产规模

全部 30 项核心美术资产维护于 [`data/art/prompts.json`](../data/art/prompts.json)，经 [`scripts/compress_assets.py`](../scripts/compress_assets.py) 压缩后共 **`1017.2 KB`**，连同 `StarryStorybook` 子集字体 **`187.6 KB`** 全部打入微信单主包（**主包总计 `1.42 MB / 1452.2 KB ≤ 1.80 MB`**），完整提示词见《[美术资产清单与生图提示词手册](./美术资产清单与生图提示词手册.md)》。
