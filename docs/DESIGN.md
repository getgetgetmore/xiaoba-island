# 柴犬小岛 · 3D 桌宠 —— 设计方案 / 模块契约 / 验收标准

> 本文档是所有分工的唯一依据。每个工作包（WP）只能修改自己名下的文件；
> 如果认为契约需要改动，**不要自行改共享文件**，在最终汇报里写明即可。

## 1. 产品目标

一只可爱的小柴犬住在一小块悬浮的田园小岛上。画面惬意、自然、耐看。

- 小岛：狗窝、草坪、花、草、树、小池塘、木栅栏等田园元素。
- 时间：跟随电脑系统时间做昼夜变化；天气有 晴 / 阴 / 雨 / 雷雨，晴天傍晚有晚霞。
- 昆虫：蝴蝶、蜜蜂、蜻蜓、萤火虫，随昼夜与天气出现和消失。
- 狗狗自主行为与环境联动：下雨回窝待着、晴天去草坪奔跑打滚、有蝴蝶就去扑、深夜睡觉、晚霞时坐着看夕阳。
- 外部交互：点击画面出现小木棍 → 狗狗跑到跟前兴奋转圈 → 再点击把木棍扔出去 → 狗狗捡回来 → 木棍回到手上可再扔；
  木棍在手上超过 10 秒无操作 → 木棍收起，狗狗回到自主行为。
- 形态：Electron 透明无边框置顶窗口（桌宠），可拖动、可拖拽改变大小，画面自适应。

## 2. 技术栈与目录

- three.js（npm `three`）+ Vite（开发/构建）+ Electron（桌宠外壳、无头截图工具）。纯 ES Module，无框架，无外部美术资源（全部程序化建模）。
- 目录与归属：

```
shiba-island/
  package.json  vite.config.js  index.html        [WP0]（WP6 可追加 electron 相关 scripts）
  docs/DESIGN.md                                  [主控，只读]
  src/main.js                                     [WP0] 启动、主循环、相机自适应、模块装载、调试 API
  src/core/env.js  util.js  palette.js  params.js [WP0] 环境(时间+天气)状态、工具函数、调色板、URL 参数
  src/ui/panel.js                                 [WP0] 悬停出现的小控制面板（时间/天气预览）
  src/stubs/*.js                                  [WP0] 各模块的占位实现（契约的最小可运行版本）
  src/world/island.js   (+ src/world/island/*)    [WP1] 小岛、狗窝、植被、道具
  src/world/sky.js      (+ src/world/sky/*)       [WP2] 天空、日月星、云、光照、雨、闪电、晚霞
  src/world/critters.js                           [WP4] 蝴蝶/蜜蜂/蜻蜓/萤火虫
  src/dog/dogModel.js   (+ src/dog/model/*)       [WP3] 柴犬模型与程序化动画
  src/dog/dogBrain.js                             [WP5] 狗狗行为状态机
  src/interaction/stick.js                        [WP5] 木棍与点击交互
  scripts/smoke.mjs                               [WP0] Node 无头冒烟测试
  scripts/shot.cjs                                [WP0] Electron 无头截图工具
  scripts/behavior-test.mjs                       [WP5] Node 无头行为测试
  electron/main.cjs  preload.cjs                  [WP6] 桌宠窗口外壳
```

## 3. 全局约定

- 坐标：Y 向上；+Z 朝向镜头（前方），+X 向右。单位≈米。小岛顶面在 y≈0，近似圆形，半径 `8`。
- 朝向（heading）：`rotation.y = atan2(dx, dz)`，即物体本地 +Z 为“前”。
- 布局（俯视，供 WP1 实现、其他 WP 只通过 `island.anchors` 读取，不得硬编码）：
  - 狗窝：左后 `(-3.6, -2.6)`，门朝右前方（让镜头能看到门洞里的狗）。
  - 草坪：中右 `(1.6, 0.8)`，半径 `3.6`，平坦。
  - 大树：右后 `(4.4, -3.4)`；池塘：左前 `(-4.3, 2.8)` 半径 `1.2`；菜畦/草垛等田园道具放后方或边缘，不挡草坪和前方。
  - 交互点 front：`(0, 0, 5.8)`，狗在这里面朝镜头等木棍。
- 相机：透视 fov 32，低机位俯角 14°（见 3.0），由 main.js 负责让“以 (0,-0.9,0) 为心、半径 9.8 的包围球”在任何宽高比下都完整可见。
- 画风：**见 3.0（手绘水粉质感，以 3.0 为准）**。以下为旧描述，仅作参考：柔和的低多边形田园风。地形/石头/树用 `flatShading`，狗用圆润的光滑形体。材质 `MeshStandardMaterial`（roughness≈0.9）或自写 Shader。颜色统一取自 `src/core/palette.js`（需要新颜色时在自己模块里定义，风格保持暖、柔、低饱和撞色）。
- 光照与阴影全部由 WP2（sky）负责；其他模块只需给 mesh 设置 `castShadow/receiveShadow`，**不得自己加全局光**（狗窝灯笼、萤火虫这类局部小光源除外，且 PointLight 全场 ≤ 3 个）。
- **Node 无头可运行**：所有模块在 import 和 `createXxx()` 时不得访问 `document/window/navigator`（必须用时以 `typeof document !== 'undefined'` 守卫）。因此不要用 CanvasTexture；用顶点色、DataTexture 或 ShaderMaterial。
- 每个模块都导出一个工厂函数 `createXxx(ctx)`，返回带 `group` 和 `update(dt, env)` 的对象。`dt` 单位秒（主循环已钳制到 ≤0.1）。`update` 中不得 `new` 大量对象（避免 GC 卡顿），不得出现 NaN。
- 性能预算（整场景合计）：draw calls ≤ 250，三角形 ≤ 200k，重复物体用 `InstancedMesh`。各 WP 的份额写在各自验收标准里。
- 所有出现/消失/切换都要有过渡（淡入淡出、缩放、插值），**不允许瞬间闪现或瞬移**。

### 3.0 画风（修订版，优先级高于本文其他处关于“低多边形/flatShading/调色板”的描述）

目标：**一幅会动的手绘水粉画 / 绘本插画**，而不是“3D 建模渲染图”。用户给出的参考是一张手绘质感的悬浮小岛（只借鉴质感与氛围，内容是我们自己的柴犬小岛，不照搬参考图里的角色、建筑、构图）。特征：

1. **色调**：低饱和、统一偏青绿。天空是带笔触的青蓝/孔雀蓝（约 `#2f8f9f`→`#3aa0a8`，不是明亮的天蓝）；草是橄榄绿、苔绿、黄绿、深墨绿的混合（`#5f7a34` `#7c9a4a` `#9aa84f` `#3f5a2c`）；土石是深赭/可可棕（`#4a2f27` `#5c3a2e`）带零星橙红斑块（`#b5532a`）；木头是做旧的灰褐（`#8b8375` `#6f6558`）；屋顶是锈橙（`#c9783a`）。亮部偏暖黄、暗部偏冷蓝绿，阴影不是黑色。
2. **笔触与不规则**：色块里看得见深浅冷暖不一的笔触色斑；轮廓带手工的歪斜和粗细不均——栅栏板高低歪斜、屋顶略塌、石块大小不一、草叶方向各异。**杜绝标准几何体（正圆、正方、等距排列、完全对称）带来的僵硬感**：顶点加扰动、物件加随机倾斜/缩放、排列加抖动。
3. **密草**：岛面被成千上万片高草覆盖（InstancedMesh 草叶，每片 2–3 个三角形，高 0.25–0.7，颜色在上述几种绿之间随机，根部深、梢部亮），草里点缀成簇的花（橙红、黄、白、淡紫）。草坪区和 front 交互区的草矮一些（0.1–0.2），保证狗和木棍清晰可见。草随风整体起伏。
4. **岛体**：厚实的大块面岩土侧壁和底部（高度约 3–4，向下略收，块面之间有明暗转折，带橙红斑块和几道裂缝），岛沿一圈做旧的歪木栅栏（前方留出缺口/放矮，不挡交互）。
5. **背景是“画出来的”**（WP2）：带明显笔触和画布颗粒的天空；厚涂的积云（体块感强、边缘是干笔触）；画面底部是手绘的起伏草甸（小岛悬浮在草甸上方，草甸上有小岛的投影暗区）；画面两个下角有几株前景野草/小白花做框景，随风轻摆。背景整体随昼夜、天气、晚霞变色。
6. **镜头**：低机位，俯角 14°，能看到岛的侧壁和底部、身后的天空与草甸（已在 main.js 里改好）。
7. **统一工具** `src/core/paint.js`：`paintMaterial(params, opts)` / `applyPaint(material, opts)` / `PAINT_NOISE_GLSL`。**所有实体材质都要用它创建或加工**（用法见文件头注释）：静态物体 `space:'world'`，会动的物体（狗、昆虫、木棍）`space:'local'`。自写 ShaderMaterial 的（草、天空、水）用 `PAINT_NOISE_GLSL` 自己加笔触扰动。
8. **全屏后处理**（WP8）：Kuwahara 油画滤镜 + 画布/纸纹颗粒 + 轻微调色与暗角，把所有元素统一成一幅画。各模块自检截图时后处理可能还没接入，先保证自己的造型、配色、笔触方向正确即可。
9. 狗同样是手绘质感：柔软、毛茸茸的体块（脸颊、胸口、尾巴有蓬松的毛簇轮廓），颜色带笔触变化，动作有挤压拉伸的弹性，不要“塑料玩具”感。

### 3.1 ctx

```js
ctx = { scene, camera, renderer /*无头时为 null*/, env /*Environment 实例*/, palette, rng /*() => [0,1) 可复现*/,
        island, sky, critters, dog, stick, brain /*按创建顺序逐步填入*/ }
```
创建顺序：env → island → sky → critters → dog → stick → brain。
每帧更新顺序：env → sky → island → critters → stick → brain → dog。

### 3.2 Environment（WP0，`src/core/env.js`）

```js
createEnvironment({ rng, hour?, weather?, timeScale? }) → env
env.update(dt)
env.setHour(h | null)            // null = 跟随系统时钟
env.setTimeScale(s)              // 1 = 实时；>1 加速（用于演示/测试）
env.setWeather(name | null, { instant = false } = {})  // null = 自动天气
// 只读状态（每帧更新）：
env.hour          // 0..24 浮点
env.phase         // 'night' | 'dawn' | 'day' | 'dusk'
env.dayFactor     // 0(夜)..1(白天) 平滑；日出 6:00、日落 18:30，各有约 ±45 分钟过渡
env.sunsetFactor  // 0..1 霞光强度：黄昏 17:15–19:15 峰值 18:15（清晨 5:30–7:00 有较弱的朝霞，≤0.6）；乘以 (1 - 0.85*cloudiness)，下雨时为 0
env.sunDir        // THREE.Vector3 单位向量，指向太阳（夜间在地平线下）；太阳自 +X(东/右) 升起、-X(西/左) 落下，略偏向 +Z
env.moonDir       // THREE.Vector3
env.weather       // 'clear' | 'cloudy' | 'rain' | 'storm'（当前目标天气）
env.cloudiness    // 0..1 平滑（clear≈0.15, cloudy≈0.7, rain≈0.9, storm≈1）
env.rain          // 0..1 平滑雨强（rain≈0.6, storm≈1）
env.storm         // 0..1 平滑
env.wind          // 0..1 平滑（storm 最大）
env.wetness       // 0..1 地面潮湿度，雨时上升、雨停后约 60s 缓慢回落
env.lightning     // 0..1 当前帧闪电亮度（快速衰减，可二次闪烁）
env.lightningSeq  // 整数，每次打雷 +1（狗可据此受惊）
env.isNight       // dayFactor < 0.25
env.isRaining     // rain > 0.15
env.elapsed       // 启动以来的模拟秒数
```
自动天气：马尔可夫切换。停留时长 clear 8–20 分钟、cloudy 5–12、rain 4–10、storm 3–6；连续量过渡约 20 秒。初始天气 clear 60% / cloudy 25% / rain 15%。storm 时每 4–12 秒打一次雷。

### 3.3 Island（WP1）

```js
createIsland(ctx) → {
  group, update(dt, env),
  radius: 8,
  heightAt(x, z) → y,                  // 顶面高度（缓起伏 ≤0.3；草坪和 front 附近基本平）
  isWalkable(x, z) → bool,             // 在岛内（离边缘 ≥0.5）且不在障碍圆内；并且容得下狗身子、从草坪走得到（见“可行走区域的收口”）
  clampWalkable(x, z, margin = 0.5) → { x, z },   // 把任意点拉回最近的可行走位置
  obstacles: [{ x, z, r, name }],      // 圆形障碍：kennel、tree、pond、道具……
  groundMeshes: THREE.Mesh[],          // 点击射线检测用的地面网格
  anchors: {
    kennelDoor: Vector3,     // 门外 0.9 处，狗进出的落脚点
    kennelInside: Vector3,   // 窝内趴卧点（狗趴在这里时头部从门洞可见）
    kennelFacing: number,    // 趴在窝里时的朝向（朝门外）
    lawn: { x, z, r },
    front: Vector3, frontFacing: number /* = 0，朝 +Z */,
    flowerSpots: Vector3[],  // ≥6 个花丛位置（昆虫活动点）
    sniffSpots: Vector3[],   // ≥5 个狗会去闻的位置（花、树根、栅栏……都必须 walkable）
    napSpot: Vector3,        // 晒太阳打盹的位置（草坪边）
    sunsetSpot: Vector3, sunsetFacing: number,  // 看夕阳的位置与朝向（面向 -X 西侧，且从镜头能看到狗的侧脸/背影）
    pond: { x, z, r },
    pondDrink: Vector3,      // 池塘边喝水落脚点
  },
}
```

**3.3.1 扩展：瞭望台与狗垫（可选字段，stub 小岛可以没有；行为模块必须判空后跳过对应行为）**

- `anchors.lookout = { base: Vector3, top: Vector3, rampFacing: number, viewFacings: number[], height: number }`
  - 岛右后方（平台中心约 `(5.8, -0.7)`）一座木质瞭望台：平台 1.5×1.5、顶面高 `height`（1.15），朝向 `(-0.8, 0.6)` 方向下降的木板坡道（长 2.3、宽 0.75）。
  - `base`：坡道底端外 0.3 处，`isWalkable` 为真，所有障碍圆之外；`top`：平台中心，`y = height`；`base → top` 的直线就是坡道中线 + 平台中线。`rampFacing`：从 base 上坡的朝向；`viewFacings`：平台上眺望的朝向（含一个大致朝镜头的、一个朝西 `-π/2`、一个朝东）。
  - `island.heightAt(x, z)` 返回 `max(地面, 设施表面)`（沿坡道中线走狗会自然“爬”上去，坡道底端与地面连续，坡道两侧边缘 0.2 内平滑收回地面）；草、花、岩石等内部放置用的纯地面高度另以 `island.groundHeightAt` 暴露。
  - 平台与坡道各有障碍圆（`name: 'lookout' / 'lookoutRamp'`）；`base → top` 这一段是**脚本化路段**，同狗窝门口那段一样，移动控制器忽略 walkable/障碍（`mover.onRamp`）。
- `island.mat = { object: THREE.Object3D, home: Vector3, homeYaw: number, lift, halfX, halfZ }`
  - 可移动的狗垫（扁椭圆垫芯 + 软边，暖色格子，外形约 1.1×1.38、厚约 0.09，1 个 draw call）。初始放在狗窝里 `kennelInside`（`home`）、朝向 `homeYaw`（= `kennelFacing`）。
  - **小岛模块自己不动它**：位置/朝向/倾斜由行为模块每帧控制（`object.rotation.order = 'YXZ'`，先偏航再绕本地 x 抬起 +z 端；`position.y = 地面高度 + lift`）。垫子长轴沿本地 z，图案关于中心 180° 对称。小岛会读取 `object` 的位置/朝向，把垫子压住的那一块草压平（只是视觉）。
  - 垫子**绝不瞬移**：只有被狗叼着（或被叼回窝里放好的过渡中）才会移动。

### 3.4 Sky（WP2）

```js
createSky(ctx) → { group, update(dt, env), sunLight /*DirectionalLight, castShadow*/ }
```
拥有：`scene.background`/天空穹顶、雾、所有全局光、太阳/月亮/星星、云、雨、闪电、色调。

### 3.5 Critters（WP4）

```js
createCritters(ctx) → {
  group, update(dt, env),
  targets: [{ id, kind /*'butterfly'|'bee'|'dragonfly'|'firefly'*/, position /*Vector3，实时世界坐标*/,
              active /*当前是否在场*/, chaseable /*狗能不能追*/ }],   // 数组与元素对象在生命周期内保持同一引用
  startle(id),   // 被狗扑到：向上飞走，约 4–6 秒后才重新变得 chaseable
}
```

### 3.6 Dog 模型（WP3）

```js
createDog(ctx) → {
  group,          // 根节点。**brain 只控制 group.position 和 group.rotation.y**；翻滚、弹跳等都在内部子节点完成
  mouthAnchor,    // Object3D，位于嘴部；木棍挂在这里（木棍本地 X 轴为长度方向，应横叼在嘴里）
  actions,        // 支持的动作名数组
  setAction(name, { fade = 0.25 } = {}),  // 幂等：重复设置同一动作不重启；动作之间姿态插值过渡
  action, actionTime,   // 当前动作名、已持续秒数
  actionDone,           // 一次性动作播完后为 true（保持末姿态，直到 brain 切换动作）
  speed,                // brain 每帧写入的地面速度(单位/秒)，walk/run 的步频据此同步，避免滑步
  lookAt(worldPos | null),  // 头部（含适度的颈部）平滑看向目标；null = 回正
  setCarrying(bool),        // 叼着木棍：嘴微张
  update(dt, env),
  size: { length, height, radius },   // 约 { 1.0, 0.75, 0.45 }
}
```
动作表：

| 名称 | 类型 | 说明 |
|---|---|---|
| idle | 循环 | 站立，呼吸，偶尔眨眼/抖耳，尾巴慢摇 |
| walk | 循环 | 参考速度 0.9 |
| run | 循环 | 参考速度 3.6，奔跑起伏，耳朵/尾巴有惯性 |
| sit | 循环 | 坐下，偶尔歪头，尾巴慢扫 |
| lie | 循环 | 趴卧抬头（狮身人面式），在窝里看雨用 |
| sleep | 循环 | 趴卧头落在前爪上，闭眼，呼吸慢而深 |
| roll | 循环 | 仰面在草地上扭动打滚，四脚朝天蹬 |
| spin | 循环 | 兴奋：原地小碎步弹跳、尾巴狂摇、张嘴吐舌（**转圈的 heading 由 brain 旋转**） |
| playbow | 循环 | 前身压低、屁股翘起、尾巴狂摇（邀玩） |
| sniff | 循环 | 嗅探，一轮约 4.6 秒：鼻子在草尖上往前探、左右大幅度扫（前脚跟着挪小碎步），然后抬头、鼻尖朝上冲着空气嗅两下、歪歪头再低下去；全程闭嘴、耳朵朝前、尾巴摇得欢。要和 drink（吃饭 / 喝水：站定、头埋下去一点一点、张嘴伸舌头）一眼分得开 |
| drink | 循环 | 低头舔水 |
| pounce | 一次性 ≈0.7s | 向前扑跃（位移由 brain 做，模型只做姿态+内部纵向弧线） |
| pickup | 一次性 ≈0.5s | 低头叼起 |
| shake | 一次性 ≈1.2s | 抖水 |
| flinch | 一次性 ≈0.6s | 被雷吓到一缩 |

### 3.7 Stick（WP5）

```js
createStick(ctx) → {
  group, update(dt, env),
  state,        // 'hidden' | 'held' | 'flying' | 'landed' | 'carried' | 'returning'
  position,     // Vector3 世界坐标（任何状态下都实时有效）
  handPos,      // Vector3 “手”的位置：front 上方偏前，例如 (0, 1.5, 7.2)
  target,       // Vector3 | null 本次投掷的落点
  idleTimeout,  // = 10 秒
  click(worldPoint | null),   // 一次点击：hidden→召唤到手；held→扔向 worldPoint（会 clampWalkable）；其它状态只刷新交互时间
  attachTo(dog),              // landed → carried（挂到 dog.mouthAnchor）
  release(),                  // carried → returning（从狗嘴飞回手上，到位后 → held，并重置 10 秒计时）
  dismiss(),                  // → hidden（带淡出）
}
```
浏览器里由 stick 模块自己监听 `renderer.domElement` 的 pointer 事件，做射线检测（`island.groundMeshes`，未命中则与 y=0 平面求交）后调用 `click()`；按下后移动超过 6px 视为拖拽不算点击。10 秒计时只在 `held` 状态下走；超时自动 `dismiss()`。

### 3.8 Brain（WP5）

```js
createBrain(ctx) → { update(dt, env), mode /*'auto'|'fetch'*/, state /*字符串，如 'auto:zoomies'、'fetch:wait'*/ }
```

**3.8.1 扩展：新增自主行为与调试入口**（`src/dog/brain/lookout.js`、`matCtl.js`、`matBehaviors.js`；`anchors.lookout` / `island.mat` 不存在时自动跳过）

- `lookout`（晴 3 / 阴 2；下雨、夜里 22–6 点不选）：走到坡道底端 `base` → 面向 `rampFacing` → 沿 `base→top` 直线走上平台（walk，0.85）→ 转向某个 `viewFacings` → 坐（sit）/站（idle）交替眺望 1–2 分钟（刚下来的 10 分钟里不再上去），`lookAt` 缓慢扫视（左、右、远方）→ 转身沿原路走下（0.8）→ 回到 `base`。晚霞（`sunsetFactor > 0.4`）时优先朝西并多坐着。阶段：`goto / align / climb / turn / watch / stand / descend`。
- `sunbathe`（9–16 点、`cloudiness < 0.5`、不下雨、垫子静止；晴天 3.5，12:30–14:30 为 7，垫子已在窝外时 ×2 起并随时间增加；窝里的垫子会压低 `nap`）：走到 `kennelDoor` → 进窝 → `pickup` 叼垫子 → 以 0.55–0.7 的速度拖到草坪上一个晒太阳的点（离狗窝 ≥ 3、离 front ≥ 2、离所有障碍/坡道够远）→ 松口落平 → 走到垫子上转小半圈 → `lie` → `sleep`（每隔 1–2.5 分钟 `roll` 翻个身、趴着看一会儿再睡）共 10–18 分钟（到饭点、转阴或过了 16 点会提前起来）→ `playbow` 伸懒腰 → 叼回窝里放回 `home` → 出窝。阶段：`goto / inside / turn / pick / drag / drop / toMat / circle / lie / sleep / roll / lie2 / wake / haul`（haul 内部再分 pick/haul/haulin/place/out）。
- `fetchMat`：垫子静止在窝外且不适合晒太阳（阴天、傍晚、夜里前）时权重很高：走到垫子上 → 叼起 → 拖回窝里放好 → 出窝。
- 抢救垫子：开始下雨且垫子在窝外、离狗 < 6 时，避雨流程先跑去叼上垫子再跑回窝（`kennel` 的 `rescueGo / rescuePick` 阶段）。
- 中断规则：任何行为被打断（下雨、木棍召唤、夜里……）时，若正叼着垫子，垫子**就地平滑落平**（0.35s）；在坡道/平台上时，`mover.onRamp` 机制保证 goal 为普通 nav 时先沿坡道中线走回 `base`（被召唤/避雨可较快，≤1.7），再继续——全程位置连续。
- `brain.state` 形如 `auto:lookout:climb`、`auto:sunbathe:drag`、`auto:fetchMat:haul`、`auto:kennel:rescueGo`。
- 调试：`brain.force(name)`——下一次选择行为时强制选 `name`（`'lookout' | 'sunbathe' | 'fetchMat' | 'zoomies' | ...`，选完即清除）；`brain.weights()` 当前各行为权重；`brain.mover` 只读观察移动控制器。URL `focus=lookout|mat` 是瞭望台 / 狗垫特写。

### 3.9 调试入口（WP0）

- URL 参数：`hour=18.2` `weather=clear|cloudy|rain|storm` `timescale=60` `seed=123` `brain=off` `action=roll`（隐含 brain=off，狗站在草坪中心播放该动作） `focus=dog|kennel|lawn`（相机特写） `panel=1`（面板常显）。
- `window.__pet = { ctx, env, island, sky, critters, dog, stick, brain, errors: [], step(dt, n), info() }`；`info()` 返回 `{ calls, triangles, fps, hour, weather, dogAction, brainState, stickState, errors }`。
- main.js 用动态 `import()` 装载各模块，装载/创建/更新抛错时记入 `__pet.errors` 并回退到 `src/stubs/` 的占位实现，保证单个模块出错不会让整个画面黑掉。**最终验收要求 `errors` 为空。**

### 3.10 工具（WP0 提供，所有 WP 用来自测）

- `npm run smoke` —— Node 无头：创建全部模块，在 4 种天气 × 多个时刻下各跑若干帧，检查无异常、无 NaN。
- `npm run shot -- --out <png> [--query "hour=18.2&weather=clear"] [--size 900x640] [--wait 2500] [--eval "<js>"] [--frames N --interval ms]`
  —— 用 Electron 隐藏窗口渲染并截图（自带独立的 Vite 服务，可多人并行），同时把页面 console 报错和 `__pet.info()` 打印到 stdout。
  截图请输出到 `shots/<你的WP名>/` 下，用 Read 工具查看图片做视觉自检。截图取自 WebGL 画布的当前帧（`--eval` 之后的状态、`--frames` 序列都是真实的当前画面）；不含 DOM 叠加层，需要时加 `--dom`。

## 4. 分工与验收标准

每个 WP 交付前必须自测通过自己的验收项，并在汇报里逐条写明结果（通过 / 未通过及原因）。视觉类 WP 必须附自检截图路径。

### WP0 脚手架与环境系统 —— sonnet

1. `npm install` 成功；`npm run dev` 能打开页面，看到占位场景（占位小岛 + 占位狗 + 渐变天空），控制台无报错。
2. `env` 完全符合 3.2：`hour=3/6/12/18.25/21` 时 `phase`、`dayFactor`、`sunsetFactor`、`sunDir.y` 的值合理（附打印的数值表）；不带参数时 `env.hour` 与系统时间一致（误差 < 1 分钟）。
3. 自动天气马尔可夫在 `timescale` 加速下能遍历 4 种天气；`setWeather('storm')` 后 `lightningSeq` 持续增长；`wetness` 雨时升、停后降。
4. 所有 stub 都实现了第 3 节契约的全部字段和方法（哪怕是空实现），`npm run smoke` 通过。
5. 相机自适应：窗口 300×300、900×500、400×900 下小岛都完整可见且居中（截图证明）；resize 无拉伸变形；pixelRatio 上限 2。
6. `npm run shot` 可用，能输出非空 PNG，并打印 `__pet.info()`；`--frames` 能输出序列。
7. 模块装载容错：故意让某个模块抛错时，画面仍显示（回退到 stub），`__pet.errors` 有记录。
8. 控制面板：鼠标悬停在右上角才浮现，可切换 时间（跟随系统/清晨/正午/黄昏/深夜）和 天气（自动/晴/阴/雨/雷雨），并显示当前时间、天气、狗的状态；面板上的点击不会触发扔木棍。
9. 页面 body 透明，画布圆角 22px；标签页不可见时暂停渲染。

### WP1 小岛与田园场景 —— sonnet

1. 悬浮小岛：顶面草地 + 侧面土层 + 底部收拢的岩石，轮廓有机不规则（不是正圆柱）；从默认相机看是“一小块岛屿”。
2. 狗窝：木质/奶油色墙体 + 红瓦斜顶 + 拱形门洞 + 门楣小骨头牌；内部空间能容纳趴着的狗（内宽≥1.5、内深≥1.6、门洞宽≥0.9 高≥0.9）；门口有狗碗；窝旁有一盏灯笼，`env.dayFactor < 0.3` 时渐亮（自发光 + 一个暖色 PointLight），白天渐灭。
3. 草坪区平坦、颜色比周围略亮；全岛有 InstancedMesh 草丛随 `env.wind` 摇摆；≥5 种颜色的花成簇分布；至少：1 棵大树（树冠分层）、木栅栏一段、踏脚石小路（窝门→草坪）、小池塘（水面有轻微波动，下雨时有涟漪更好）、1–2 个田园道具（菜畦/草垛/木牌/稻草人任选）。
4. `anchors`、`obstacles`、`heightAt`、`isWalkable`、`clampWalkable`、`groundMeshes` 全部符合 3.3；所有 anchor 点 `isWalkable` 为 true（kennelInside 除外）；`kennelInside` 到 `kennelDoor` 的直线不穿墙。
5. `env.wetness` 升高时地面颜色略变深；夜晚不需要自己变暗（由光照负责）。
6. 预算：draw calls ≤ 90，三角形 ≤ 90k。`npm run smoke` 通过。
7. 视觉自检截图（正午晴、黄昏、深夜灯笼亮起、`focus=kennel` 特写）：构图饱满不空、不杂乱，前方交互区和草坪不被遮挡。

### WP2 天空 / 光照 / 天气 —— sonnet

1. 天空穹顶渐变随 `env` 连续变化：白天蓝、晚霞（橙粉紫，`sunsetFactor` 驱动，云被染成粉橙色）、夜晚深蓝带星星和月亮、阴天灰白、雷雨暗灰。任何时刻切换都平滑无跳变。
2. 太阳/月亮沿 `env.sunDir/moonDir` 运动且在画面内可见（太阳低时又大又暖）；星星只在夜晚且云少时可见，会闪烁。
3. 光照：一盏投射阴影的平行光（白天太阳、夜晚月光，颜色强度平滑变化）+ 半球光/环境光；阴影覆盖整个小岛（半径 10）、柔和、无明显锯齿/闪烁；夜晚画面仍看得清狗和岛（偏蓝的柔光，不是漆黑）；雨天整体偏冷偏暗。
4. 云：低多边形蓬松云朵 6–12 朵，缓慢漂移，数量/灰度随 `cloudiness` 变化；岛下方可以有几朵衬托悬浮感。
5. 雨：雨丝（InstancedMesh 或 Points/LineSegments）密度随 `env.rain`，随 `env.wind` 倾斜；地面有小水花/涟漪更好；雨停时逐渐稀疏。
6. 闪电：`env.lightning` 驱动全局闪白 + 一道可见的折线闪电（位置随机、在岛后方天空），不刺眼（峰值增亮适度）。
7. 预算：draw calls ≤ 45，三角形 ≤ 30k。`npm run smoke` 通过。
8. 视觉自检截图：hour=12 clear / 18.25 clear（晚霞）/ 23 clear（星月）/ 12 cloudy / 15 rain / 21 storm（抓到闪电帧，可用 `--frames`）/ 6 clear（朝霞）。

### WP3 柴犬模型与动画 —— opus

1. 一眼能认出是**柴犬**且可爱：橘色被毛 + 奶白色“里白”（脸颊、嘴套、胸、腹、腿内侧、尾巴下侧）、立起的三角耳（内耳浅色）、卷到背上的卷尾、圆润的头和脸颊、黑鼻子、黑亮的眼睛（带高光点）、眉点、红色项圈带金色小铃牌。Q 版比例（头略大，腿短）。
2. 骨架层级清晰（root → body → 胸/臀 → 颈/头/耳/下颌/舌、四条两段式腿、多节尾巴），全部程序化动画，无外部资源。
3. 3.6 动作表全部实现；动作之间姿态插值过渡，无跳变；循环动作首尾衔接无顿挫；一次性动作结束后 `actionDone = true`。
4. walk/run 步频与 `dog.speed` 同步（脚不明显滑步）；run 有腾空与脊柱伸缩感；roll 是真的仰面打滚扭动；spin 明显“很兴奋”；sleep 明显“很安详”。
5. 附加生命感：呼吸、眨眼、耳朵抖动、尾巴摇动（强度随动作变化）、`lookAt` 头部平滑跟随（转角限幅，不能扭断脖子）。
6. `mouthAnchor` 位置正确：木棍挂上去是横叼在嘴里。`setCarrying(true)` 嘴微张。
7. 趴在 `kennelInside`（lie/sleep）时身体不明显穿出狗窝墙体（尺寸符合 `size`，肩高≤0.62，体长≤1.05，lie 姿态高度≤0.55）。
8. 预算：draw calls ≤ 45，三角形 ≤ 25k；`update` 不分配对象。`npm run smoke` 通过。
9. 视觉自检：每个动作用 `?action=<名称>&focus=dog` 截 `--frames 4` 序列并查看；附一张正面、一张侧面定妆照。

### WP4 昆虫 —— haiku

1. 蝴蝶 3–5 只：6:30–17:30 且不下雨时出现，翅膀扇动（两片翅膀绕身体轴拍动），在 `flowerSpots` 之间飘忽飞行并偶尔停花，高度 0.4–1.6，`chaseable = true`。颜色多样。
2. 蜜蜂 2–3 只：白天晴/阴，在花丛附近小范围悬停抖动，`chaseable = false`。
3. 蜻蜓 1–2 只：15:30–19:00 在池塘上方悬停—急冲，`chaseable = false`。
4. 萤火虫 10–16 只：19:00–次日 4:30 且不下雨，缓慢漂浮，黄绿色辉光明暗呼吸（自发光/加色混合；不要每只一个 PointLight），`chaseable = false`。
5. 下雨（`env.isRaining`）时所有昆虫在 5 秒内飞走/淡出，雨停约 20 秒后陆续回来；出现和消失都是平滑的缩放/淡入淡出；`active` 字段与是否可见一致。
6. `startle(id)`：该昆虫快速向上飞离，4–6 秒内 `chaseable=false`，之后飞回。
7. 不飞出小岛范围（水平距岛心 ≤ 7.5），不钻地。`targets` 引用稳定。
8. 预算：draw calls ≤ 12（用 InstancedMesh），`update` 不分配对象。`npm run smoke` 通过。
9. 视觉自检截图：hour=10 clear、hour=17 clear（蜻蜓）、hour=21 clear（萤火虫）、hour=10 rain（无昆虫）。

### WP5 狗狗行为 + 木棍交互 —— sonnet

自主行为（mode=auto），按优先级：
1. **避雨**：`env.isRaining` → 跑回狗窝（run 到 kennelDoor → 走进 kennelInside → 转身朝外）→ `shake` 一次 → `lie` 看雨（lookAt 偶尔移动）；打雷（`lightningSeq` 变化）时 `flinch`。雨停（`rain < 0.05`）持续 8 秒后才出窝。
2. **睡觉**：22:00–6:00 在窝里 `sleep`；清晨出窝先 `playbow`（伸懒腰）。
3. **看夕阳**：`sunsetFactor > 0.5` 时有较高概率去 `sunsetSpot` 坐着看夕阳。
4. **晴天白天**（权重随机，单个行为持续 6–25 秒，连续不重复同一个）：草坪撒欢跑圈（zoomies：run，绕草坪不规则跑动）、草坪打滚（roll）、追蝴蝶（靠近 → 压低 playbow 蓄势 → pounce → `critters.startle(id)`，2–3 次后休息）、闻花（sniff）、闲逛（walk）、坐着张望（sit，lookAt 蝴蝶）、午后 12:30–14:30 在 napSpot 打盹（sleep）、去池塘喝水（drink）。
5. **阴天**：同上但更安静（zoomies 权重低，闲逛/坐/闻为主）。**傍晚 19:00–22:00**：窝门口趴着/坐着，看萤火虫（lookAt firefly）。
6. 移动质量：有加减速和转向速率上限（不瞬间掉头）、绕开 `obstacles`、始终 `isWalkable`、`y = island.heightAt`，动作与速度匹配（慢走 walk、快跑 run），**绝不瞬移**。

交互（mode=fetch）：
7. 点击 → 木棍出现在 `handPos`（带出现动画，悬浮轻晃）；狗无论在干什么（包括睡觉/避雨）都起身跑到 `front`，面向镜头，`spin` 兴奋转圈（heading 持续旋转，转 1–2 圈后 playbow/小跳交替，lookAt 木棍）。
8. 再点击 → 木棍沿抛物线旋转飞向落点（飞行 0.8–1.4 秒，落地有一两次小弹跳）；狗立刻转身追（run），到达后 `pickup` → 木棍挂到嘴上（横叼）→ 跑回 `front` → 放下，木棍飞回手上（`returning` → `held`）→ 狗继续兴奋等待。可无限循环。
9. 木棍在 `held` 状态超过 10 秒无点击 → 木棍淡出收起（`hidden`），狗回到 auto（如果正在下雨则回窝并抖水）。
10. 鲁棒性：飞行/叼回途中的点击不打断流程；任何时候点击都不会让状态机卡死；狗还没跑到 front 就被扔出木棍也能正常去追。
11. `scripts/behavior-test.mjs`（Node 无头，固定 seed，用真实模块，失败时非零退出）覆盖并通过：
    a) 正午晴天模拟 180 秒：出现过 run、roll 两种动作，且至少一次追蝴蝶（`critters.startle` 被调用）；全程位置 walkable、无 NaN、单帧位移 ≤ 最高速度×dt×1.5。
    b) 切到 rain：25 秒内狗到达 kennelInside（距离 < 0.4）且动作为 lie；随后切回 clear，40 秒内离开狗窝。
    c) hour=2：60 秒内在窝里 sleep。
    d) click() → 8 秒内狗距 front < 1.0 且动作为 spin 或 playbow；click(草坪上一点) → 15 秒内 stick.state 回到 'held' 且期间经历过 flying、carried；连续 3 轮都成功。
    e) held 后 10–11 秒 stick.state 变为 'hidden' 且 brain.mode 变回 'auto'。
    f) 下雨时 click：狗依然出来接；超时后回窝。
12. `npm run smoke` 通过。

### WP6 Electron 桌宠外壳 —— haiku

1. `npm run pet`（先 `vite build` 再启动 Electron 加载 `dist/index.html`）弹出：透明、无边框、置顶、不占任务栏的窗口，默认 420×380，出现在屏幕右下角。
2. 透明窗口在 Windows 上无法用系统边框缩放，所以自己实现：右下角一个悬停才显现的缩放手柄（拖拽经 IPC 调 `setBounds`，最小 220×200，最大为屏幕工作区），顶部一条悬停才显现的拖动条（`-webkit-app-region: drag`）。缩放过程中画面实时自适应。手柄/拖动条上的操作不触发扔木棍。
3. 系统托盘图标（图标用代码生成的 nativeImage，无外部文件亦可）+ 菜单：置顶开关、重置大小位置、退出。窗口位置大小持久化到 `app.getPath('userData')`，下次启动恢复。
4. 这些 UI 只在 Electron 环境注入（preload 暴露 `window.petShell`，页面里用 `if (window.petShell)` 判断），不影响浏览器里的 `npm run dev`。需要的页面侧代码放在 `electron/shell-ui.js` 并由 preload 注入，**不改 src/**。
5. 支持 `--capture=<png路径> [--capture-delay=ms]`：启动后截图保存并退出（供主控验收）。支持把 URL query 透传：`--query="hour=21&weather=clear"`。
6. `package.json` 增加 `pet` script 和 `启动桌宠.bat`（双击即可运行）。安全：`contextIsolation: true`、`nodeIntegration: false`。
7. 自测：`npm run pet -- --capture=shots/wp6/pet.png` 输出非空截图；说明手动验证过的项目与未能验证的项目。

### WP8 手绘后处理 —— sonnet

1. `src/render/painterly.js`：`createPainterly(renderer, { width, height })` → `{ render(scene, camera), setSize(w, h, pixelRatio), setEnabled(bool), enabled, params }`。场景先渲染到 RenderTarget（带深度、MSAA samples 4），再经全屏 pass 输出到屏幕。
2. 滤镜：Kuwahara（建议各向异性或 4 象限、半径可调，默认约 3–4 像素 @1x，按 pixelRatio 缩放），保留主体轮廓的同时把细节抹成笔触；叠加程序化画布/纸纹颗粒（屏幕空间固定、不随相机动，强度克制）；轻微调色（略降饱和、暗部偏青、亮部偏暖）；很轻的暗角。小物体（狗的眼睛高光、蝴蝶、雨丝、萤火虫）不能被抹没——必要时降低半径或对高对比细节做保护。
3. 色彩管线正确：最终画面的亮度/对比与关闭后处理时基本一致（不发灰、不过曝、不偏色过头）；tone mapping 与 sRGB 转换只做一次。
4. 接入 `src/main.js`：`render()` 改走 painterly；resize 时同步尺寸；URL 参数 `fx=0` 关闭后处理（对比用）；`__pet.fx` 暴露实例以便调参。`renderer.info` 的统计仍能反映场景的 draw calls（`renderer.info.autoReset = false` 并在每帧开头手动 reset，或在场景 pass 后立刻读取并缓存供 `info()` 使用）。
5. 性能：420×380 窗口下后处理耗时可忽略；1600×900@1x 下整帧仍 ≥ 50fps（本机）。画布 alpha、圆角不受影响。无头（renderer 为 null）不受影响，`npm run smoke` 通过。
6. 视觉自检：同一场景 `fx=0` 与默认各截一张对比（正午晴、黄昏、夜晚、雨天），确认“像水粉画”且细节不糊成一团；附截图。

### WP7 集成与总验收 —— 主控（fable）

- A0 画风符合 3.0：整体观感是手绘水粉画，没有僵硬的建模感；与参考图的质感和氛围一致。

- A1 小岛形态完整，300×300 ~ 1600×900 各种宽高比下都完整居中、无变形。
- A2 狗窝 / 草坪 / 花草树 / 池塘齐全，田园风统一，构图好看。
- A3 昆虫随昼夜天气出现消失（蝴蝶白天、萤火虫夜晚、雨天无）。
- A4 默认时间 = 系统时间；清晨/正午/黄昏/深夜四个时段观感明显不同且都好看。
- A5 晴 / 阴 / 雨 / 雷雨观感明显不同；晴天黄昏有晚霞；切换平滑。
- A6 自主行为：雨→回窝；晴→草坪跑、打滚；追蝴蝶；夜里睡觉。行为自然不抽搐、不瞬移、不穿模（明显的）。
- A7 木棍交互全流程可无限循环；A8 10 秒超时回到自主状态。
- A9 Electron 桌宠窗口：透明、置顶、可拖动、可缩放自适应。
- A10 `__pet.errors` 为空；`npm run smoke`、`behavior-test` 全过；draw calls ≤ 250；帧率稳定。
- 验收方式：无头测试 + 多组截图（时段 × 天气 × 交互阶段 × 窗口尺寸）逐张目检，不合格项打回对应 WP 或由主控直接修。

## 遛狗小游戏（walk）

入口：狗窝外墙玩具架的第 2 个格子里挂着一卷遛狗绳（`shelf.claim('leash')`，悬停放大轻晃，点击开始）。一局 180 秒，第一人称，小狗在前面拉着你跑。

操控因果链（手 → 绳子 → 小狗）：
- 鼠标移动的是“手”（`handX`，±3.4 米，很小的平滑），键盘 A/D、←/→ 也移动手；小狗不直接跟鼠标。
- 绳子有松紧 `slack`：手与狗的横向差在 slack 以内，绳子只是荡，对狗没有拉力；超出的部分才拉（`k` = 4.3 /米·秒²）。松着 slack 0.9 米；按住左键（或 S/↓/空格）收紧：slack 0.15 米、`k` ×3.2，前进速度降到 55%。
- 快速甩手（手速 > 7 米/秒且绳子在该方向已绷住）= 拽一下：给狗一个侧向冲量（0.6 秒冷却）。
- 握力条：张力 = 0.4×|拉力| + 6×收紧×(1+0.5×连续握住秒数)，0.6 秒低通，超过 9.5 时涨、低于时回落；涨满 → 脱手（狗自由 2.5 秒，记一次失误，之后自动重新握住）。
- 小狗自己的意志：乱晃、被诱惑物吸引、被害怕的东西（洒水器 / 扫地车 / 气球）推开、小动物横穿时猛地前冲（收紧可抑制）、在嗅桩处停下来嗅（拽一下才走）。

难度：速度 6.5 → 12.5 米/秒，排间距 14 → 5.8 米；15 秒起诱惑物，25 秒起左右移动的障碍（扫地机器人 / 遥控车），40 秒起横穿物和害怕的东西，50 秒起迎面行人 / 婴儿车，75 秒起前冲事件和“堵两条道”（含窄通道围挡），120 秒后事件叠加；减速带（20 秒起，踩到不算失误）。

结构：
- `src/minigame/walkSim.js` 纯逻辑（Node 可跑；`createWalkSim({ rng, test })` 的 `test` 开关：`noWill` / `noTug` / `track` 供数值实验使用）。赛道一次性生成，公平性在生成时保证：每排至少一条空道，`row.safe` 是一条保证可走的“安全路线”，换道距离受 `maxLaneShift(gap, t)` 约束，横穿物靠收紧一定躲得开。
- `src/minigame/walkBot.js` 机器人（高手 / 普通 / 只移手 / 全程收紧 / 什么都不做，都只通过 `{ hand, grip }` 操控；测试与 URL 调试 `gameT` 用）。
- `src/minigame/walk.js` 入口 `createWalkGame(ctx)`；`walk/world.js` 场景；`walk/props.js`、`walk/props2.js` 物件几何；`walk/leash.js` 架子上的遛狗绳 / 第一人称的手和绳 / 项圈；`walk/hud.js` DOM 界面（含握力条、连击、绳子松紧、“脱手了！”）。
- 接入 `main.js`：`game.active` 时主循环只跑 `game.update(dt)`，渲染小游戏自己的 scene/camera（仍走 `fx.render`），岛的模拟 / 相机 / 点穿 / 摸摸 / 放大镜暂停；强制 60 帧；`dataset.petNoDrag = '1'`。小狗借用 `ctx.dog`，结束后归还。
- 调试参数：`game=walk` 自动开始；`gameT=<秒>` 跳过倒计时并用自动驾驶快进到该秒数。测试：`node scripts/walk-test.mjs [--table]`。

奖励口子：结算时构造 `result = { game:'walk', completion, stars, tier:'gold'|'silver'|'bronze', avoided, hits, bones, bonesTotal, distance, duration, aborted, maxCombo, slips, tugs }`，
(a) 调用 `ctx.rewards.grant(result)`（main.js 里是空实现，只记 `this.last`，奖励机制接在这里）；(b) `window.dispatchEvent(new CustomEvent('pet:minigame-finished', { detail: result }))`。
中途退出：只派发事件（`aborted: true`），不调用 `grant`。完成度 = round(100 × (0.40×躲开比例 + 0.25×骨头比例 + 0.20×路程比例 + 0.15×min(1, maxCombo/40)))；躲开比例 = 躲开的排数 /（躲开 + 失误，脱手也算失误）；骨头比例 = 捡到 /（路过的与全程总数的平均）；≥85 三星、≥65 二星、其余一星。


## 池塘常驻小动物：青蛙与螃蟹（`src/world/island/pondlife.js`）

模型（钓鱼小游戏可直接复用）：
- `createFrog()` → `{ group, body, update(dt), setState(name), state, squash }`；状态 `'sit' | 'croak' | 'jump' | 'held'`。`squash`（-1..1）可直接赋值：正 = 蹲扁，负 = 拉长。
- `createCrab()` → `{ group, body, update(dt), setState(name), state, dir, walkRate, lurk }`；状态 `'idle' | 'walk' | 'pinch' | 'hide'`；`dir` = ±1 决定横着走的步态方向，`lurk` 0..1 = 半藏在石头边的程度。
- 约定：`group` 原点在脚底中心，本地 +Z 为正面（螃蟹横走沿本地 ±X）；不带位移，位置由调用者控制；`update(dt)` 只做肢体动画（喉囊、眨眼、迈步、举钳、眼柄晃动都由状态驱动，状态切换带平滑过渡）。每次调用返回独立实例（几何体、材质共享）。
- 实现：每只动物 1 个 draw call——静态顶点色几何体 + 形变目标（morph targets：青蛙 5 个、螃蟹 10 个）做肢体动画；青蛙 2100 三角形、螃蟹 1500；`paintMaterial(space:'local')`。尺寸：青蛙体长 0.24，螃蟹壳宽 0.26（含腿 0.40）。

常驻行为：`createPondLife({ heightAt, anchors, rng })` → `{ group, update(dt, env, dogPos|null), frogs, crabs, setHidden(bool), hidden, pads }`，`island.pondLife` 对外暴露，`island.update` 每帧传入 `ctx.dog.group.position`。
- 青蛙（2 只）蹲在荷叶上（荷叶位置与 props.js 一致，粉色花那片除外），`croak` / 每 10–25 秒跳到另一片空荷叶（起跳蹲伏 → 抛物线 → 落地压扁 + 小涟漪）；小狗到 1.7 以内（或小狗在喝水落脚点附近）立刻跳进水里（双层涟漪，缩小下沉），在水下游向另一片荷叶，8–15 秒后（狗走开才会）浮出再爬上去。傍晚（18–22 点或霞光 > 0.45）×2.4、雨天 ×2 更勤；22–5 点完全不动。
- 螃蟹（1 只）沿池塘远岸的浅滩（半径 pondR(θ)×0.96 起向外 0.14）横着走，停下，举钳；白天半藏（`lurk`），清晨傍晚雨后更活跃，深夜缩着不动；小狗到 1.4 以内：很近则 `hide`，否则快速横着躲向远离狗的一侧再 `hide`。环带避开喝水落脚点 0.62 和岛沿。
  - 为什么只在浅滩、只在远岸：`plants.js` 在 pondU ≥ 1.04 处长满齐腰高的草，螃蟹（高 0.15）走到“池塘半径 + 0.05 以外”会整只藏在草里；镜头在南面（+Z），近岸前景的草也会挡住，所以环带限制在 pondU ≈ 0.96–1.04 且 sinθ ≤ 0.25 的那一段。
- `setHidden(true)`：青蛙跳进水里、螃蟹缩进去后缩小消失并保持；`false` 恢复（青蛙 ≤ 6 秒内浮出）。
- 测试：`node scripts/pondlife-test.mjs`；截图脚本 `scripts/pondlife-shot-model.js`（`__WHAT__` 占位，如 `frog:croak`）、`scripts/pondlife-shot-pond.js`（`__MODE__` 占位：plain / jump / splash）。`main.js` 的调试特写支持 `__pet.setFocus('frog:0' | 'crab:0' | 'debug')`（`debug` 跟随 `ctx.debugTarget`）。


## 尾巴钓鱼小游戏（fishing）

入口：狗窝外墙玩具架的第 3 个格子里挂着一只红白浮漂（`shelf.claim('fishing')`，悬停放大轻晃，点击开始）。**在岛上的池塘边进行，不换场景、不换相机对象**：岛的模拟（天气 / 昆虫 / 小鱼）照常运行，钓鱼模块只接管 ① 小狗（brain 的 `game` 模式）② 镜头取景（`fishing.view`，main.js 的 `updateCamera` 读取，不强制背景）③ 指针交互（扔树枝 / 摸摸 / 遛狗 / 架子放大镜 / 滚轮缩放 / 右键旋转 / 点穿暂停，强制 60 帧，`dataset.petNoDrag = '1'`）。Esc 或界面上的“✕ 回小岛”随时退出；下雨 / 深夜时点浮漂不会开始（浮漂抖一下 + 提示），钓到一半下雨则提前结束（aborted）。

玩法：小狗走到池塘边的钓鱼点（朝草坪一侧），转身背对水面坐下，把尾巴放进水里；一局固定 6 次下钩，每钩 = 下钩 → 等鱼（2–6 秒，可能有 0–2 次“假咬”，等鱼阶段任何点击都会把鱼吓跑）→ 真咬（尾巴被拽、耳朵竖起、头顶“!”，0.5–1.0 秒的提竿窗口，越稀有越短）→ 拉扯（按住 = 拉，松开 = 放松；它挣扎前有 0.3 秒预兆；挣扎时还拉 → “尾巴疼”涨满就跑了；安静时拉进度才涨；最长 5 秒）→ 出水（沿抛物线落到岸边，小卡片 + 小狗的反应，活物自己回水里）。恶搞：大鱼反拉（小狗被拽进池塘，爬上岸甩水，这一钩落空；每局最多 1 次）。

战利品（`fishSim.js` 的 LOOT 表，只有岛上 / 池塘里本来就可能有的东西）：常见（60%，5 分）小金鱼 / 水草 / 荷叶 / 莲蓬 / 鹅卵石；少见（28%，12 分）螃蟹 / 青蛙 / 泥鳅 / 河蚌；稀有（12%，25 分）金色锦鲤 / 丢失的树枝 / 珍珠河蚌；特殊（15 分）漂流瓶——**每天第一局必出**（`localStorage` 记录上次钓到漂流瓶的日期），之后每钩约 4% 的概率偶尔出现；纸条上的寄语来自 `src/core/messages.js`（`MESSAGES` 列表 + `pickMessage({ rng, date, seen })`，每条 `{ id, text, from?, when? }`，`when` 支持 md / from-to / months / weekdays，今天专属的寄语优先，优先没看过的）。图鉴数据记在 `shiba.fishing.dex`（每样东西钓到的次数 + 首次日期），界面以后再做。

结构：
- `src/minigame/fishSim.js` 纯逻辑（Node 可跑）：`createFishSim({ rng, casts, forceBottle, allowPrank })` → `update(dt, { click, hold })`、阶段 / 计时 / 信号（fake / real / warn / struggle）/ 进度 / 尾巴疼 / 事件队列 / `result()`。`src/minigame/fishBot.js` 机器人（熟练 / 乱点 / 只会按住 / 什么都不做 / 抢点）。测试：`node scripts/fish-test.mjs`。
- `src/minigame/fishing.js` 入口 `createFishing(ctx)` → `{ active, start(), stop(aborted), abort(), update(dt), sim, view }`：流程、输入、小狗的 controller、出水反应脚本、大鱼反拉、奖励口子；`fishing/hud.js` DOM 界面（顶部 6 个小圆点 + 得分 + 退出，底部提示 / 拉力条 / 尾巴疼条，出水卡片，漂流瓶纸条，结算）；`fishing/loot.js` 战利品模型（青蛙 / 螃蟹优先用 `world/island/pondlife.js`，通过 `import.meta.glob` 懒加载，缺失时用占位）；`fishing/fx.js` 涟漪 / 飞沫 / “!” / 鱼线 / 架子上的浮漂；`fishing/store.js` 本地存储（Node / 无痕模式安全降级）；`fishing/icons.js` 图标。
- 小狗接管：`brain.enterGame(controller)` / `brain.exitGame()` / `brain.canGame()` / `brain.needKennel()`；接管期间 brain 每帧只调用 `controller.update(dt, S)` 和 `mover.update(dt)`，`canPet()` 为 false，需要回窝（下雨 / 深夜）时调用 `controller.onNeedKennel(why)`。`mover.goStraight(x, z, { free: true })` 是不走窝门 / 坡道入口的脚本化直线段（钓鱼点在池塘障碍圆内的水边）。
- 模型外部钩子（默认 0 时与原来完全一致）：`dog.tailDrop`（0..1，把尾巴放下来向身后下方伸出）、`dog.tailTug`（-1..1，被拽的抖动 / 绷直 / 松垮）、`dog.earPerk`（0..1，耳朵竖起）、`dog.noseDown`（0..1，边走边闻：叠在走路动作上，头压低、鼻子贴地左右扫、尾巴摇；嗅探行为挪步时用）。小鱼的引诱点：`island.group.getObjectByName('pondFish').userData.pond` 上的 `setLure({x,z}, 强度)` / `strike()` / `release()` / `scatter(秒)` / `ripple()`（不设引诱点时小鱼行为与原来完全一致）。
- 调试：URL `game=fishing` 启动后自动开始（小狗直接就位）；`__pet.fishing.start({ instant, seed, forceBottle, allowPrank, queue, test })`、`__pet.fishing.debugNext('crab' | 'prank' | ...)` 指定当前（尚未提竿的）这一钩钓到什么、`__pet.fishing.setBot('skilled')` 自动驾驶、`__pet.fishing.info()`。

奖励口子（与遛狗一致）：结算时 `result = { game:'fishing', completion, stars, tier, score, casts: 6, landed, missed, catches:[{ id, name, rarity, points }], bottle: 寄语对象|null, prank: bool, aborted }`，正常结束 → `ctx.rewards.grant(result)` + `window` 事件 `pet:minigame-finished`；中途退出（Esc / ✕ / 下雨）→ 只派发事件（`aborted: true`），不调用 grant。完成度 = round(100 × (0.7 × 钓上来的钩数 / 6 + 0.3 × min(1, 得分 / 60)))；≥85 三星、≥60 二星、其余一星。

## 作息（默认机制，跟随电脑时钟）

小狗的一天按现实里狗的作息安排，时间取岛上的时间（即电脑时钟）。实现在 `src/dog/dogBrain.js`（作息表、精力曲线、饭点）和 `src/dog/brain/behaviors.js`（`wake` / `eat` 行为，各行为权重乘以精力）。

| 时间 | 做什么 |
| --- | --- |
| 22:00–6:30 | 在窝里睡觉 |
| 6:30 | 起床：出窝，伸懒腰（playbow），抖毛，四下看看，然后去池塘喝水 |
| 7:00–9:00 | 早饭（只吃一次）：碗里盛上狗粮，小跑到碗边埋头吃完，碗空，吃完去喝水 |
| 7:00–10:00 | 一天里最活跃：撒欢、追蝴蝶、打滚、上瞭望台巡视 |
| 10:00–12:00 | 平缓：闲逛、嗅探、晒太阳 |
| 12:15–14:45 | 午睡 / 在垫子上晒太阳，几乎不奔跑 |
| 15:00–18:00 | 逐渐活跃，傍晚是第二个高峰 |
| 18:00–19:30 | 晚饭（只吃一次），之后看晚霞 |
| 19:30–22:00 | 在窝门口趴着 / 坐着看萤火虫，不再疯跑 |

- 长时间行为的时长（`S.rest(下限, 上限)`，单位秒；到饭点一律提前结束去吃饭）：

  | 行为 | 一次多久 | 中途 | 提前结束 |
  | --- | --- | --- | --- |
  | 晒太阳 `sunbathe`（在垫子上睡） | 10–18 分钟 | 每 1–2.5 分钟翻个身、趴着看一会儿 | 转阴、下雨、过了 16 点 |
  | 午睡 `nap` | 10–20 分钟 | 每 1–2.5 分钟抬头看看又睡过去 | 过了 15 点 |
  | 晚间歇息 `evening` | 6–12 分钟 | 每 1–2 分钟在趴着 / 坐着之间换姿势 | 22 点回窝 |
  | 看晚霞 `sunset` | 4–8 分钟 | — | 晚霞散了 |
  | 眺望 `lookout` | 1–2 分钟 | 坐 / 站交替 | — |
  | 坐着歇息 `sit` | 10–20 秒，精力低时最多到 2.5 倍 | — | — |

- 白天的觉：晒太阳算在睡觉里，和午睡是同一件事（`S.napUrge()`、`S.sleptAt`）。睡完一觉（不管哪种）以后，午睡时段（12:15–14:45）隔 8 分钟、其余时间隔 25 分钟才会再睡，再往后 20 分钟里也少选；精力最旺时（约 7:15–10:00）晒太阳的权重再 ×0.25。按真实时长连续模拟一整天：白天睡觉合计约 3 小时（上午每小时 15–25 分钟，午睡时段每小时 35–40 分钟）。被摸、被叫去玩打断的觉不算睡完，之后会回去接着睡。
- `brain.restScale`（默认 1）是测试用的时长倍率：`scripts/behavior-test.mjs` 默认用 0.1 好快速跑完一轮，其中 R 组用 1 按真实时长检查（晒太阳 / 午睡一次 ≥ 10 分钟、晚间歇息 ≥ 6 分钟、太阳没了 / 午睡时段过了会起来）。
- 嗅探 `sniff`（一轮 12–22 秒）：从 `sniffSpots`（树根、花丛、灌木旁）里挑一处走过去 → 站着闻 2–3.5 秒 → 鼻子贴着地面慢慢挪几步（速度 0.45，`dog.noseDown = 1` 叠在走路动作上：头压低、左右扫、尾巴摇）换个位置接着闻，一处挪 1–2 次 → 再去下一处。它不是在吃东西：饭碗只在窝门口，吃饭只发生在饭点。
- 精力曲线 `ENERGY`：清晨、傍晚两个高峰，中午低谷，晚上递减；`S.energy` 乘进撒欢、打滚、追蝴蝶、闲逛、嗅探的权重，坐着歇息的权重反向变化。
- 饭点由 `S.mealDue` 表示；离开饭点时段后“吃过了”的标记清零，所以手动拨时间也能重复触发。下雨时不吃（在窝里躲雨）。
- 狗碗里的狗粮是单独的网格，`island.bowl.setLevel(0..1)` 控制：到饭点盛满，吃的过程中减少，吃完为空。
- 验证：`scripts/routine-test.eval.js`（把时间依次拨到一天各时段，统计时间分配并检查起床、两顿饭、午睡、夜里睡觉）。

## 寻路

`src/dog/brain/mover.js` 的普通寻路从“见障碍就贴着绕”改为栅格 A*：小岛铺成 0.25 一格的栅格，`goTo` 时规划整条路线并拉直成几个路点，沿路点走；目标被障碍围死时走到能到的最近处再放弃。验证：`scripts/nav-test.eval.js`（全岛格点 × 常用目标和随机点，统计放弃、卡顿、绕远）。

### 可行走区域的收口（修“扔木棍后小狗卡在小屋后面原地转圈”）

问题：小屋后墙和岛沿之间有一条只有 0.4 宽的斜向窄带，解析式判断认为能站。寻路栅格在这条带子上只有几个对角相邻的孤立格子，搜路时“不钻对角缝”所以和主区域不连通；但“两点之间能不能走直线”和实际移动都没有这条规则。结果小狗能沿直线走进去，却规划不出离开的路线，之后每个目标都立刻放弃。扔木棍的流程又把“放弃”当成了“到达”：在屋后把木棍交了（木棍飞回手上）、原地转圈等下一次，收起木棍再拿出来也回不来；走不到跟前的木棍还会被隔空叼起。

修法（三层）：

- **地图**（`src/world/island.js`）：`isWalkable` = 解析式 `rawWalkable` 再过一张 0.125 的细栅格——只保留“容得下狗身子”（四周 `ROOM = 0.25` 以内都能站）并且从草坪一路走得到的区域，再向外补回 `KEEP = 0.45` 的一圈（贴着障碍 / 岛沿的边仍然能站；`KEEP` 要比 `ROOM` 多出栅格的斜向误差，否则紧贴障碍圆的一线时有时无，小狗贴着障碍滑行会卡住）。不到半个身位宽的窄带和被围住的小口袋因此不可行走，木棍落点也不会落进去。全岛能站的面积减少约 3%。`island.isWalkableRaw` 是收口前的判断（调试用）。
- **寻路**（`mover.js`）：建栅格时只保留和草坪连通的格子，孤立格子不当起点、终点，也不算“能走直线”。小狗已经站在不能站的地方时（被摆过去的、小游戏结束时留下的）放行，让它沿路线走回能站的地方。
- **扔木棍**（`fetch.js`、`stick.js`）：离木棍超过 1.3 不叼——重试几次还走不到就进入 `giveup`：面朝木棍坐下看一眼，木棍自己飞回手上（`stick.recall()`：`landed → returning → held`），小狗跑回 `front`。往 `front` 跑的路上停下了但没到跟前（1.2 以外）不算到达，再试最多 3 次，不在半路上交木棍。

验证：`scripts/behavior-test.mjs` 的 S 组（死胡同不可行走；往小屋后面 / 左后方 / 菜地南侧扔木棍都回到 `front`；从以前卡住的位置出发也能走回来）。把木棍扔到全岛 0.4 一格的所有落点：修复前 863 个里 72 个异常，修复后 784 个里 0 个。

## 白鹭来访与乘鹭出门（默认机制）

### 机制

- **来访**：每天 8:00–18:00 之间，白鹭从远处飞来落在岛的边缘，沿岛边走一走、啄啄地，最多停留 1 分钟后飞走消失。晴天 5 次，阴天 3 次，下雨和雷雨不来；在岛上时开始下雨就提前飞走。小游戏进行中不来（推迟，最多推迟 20 分钟）。
- **出门**：白鹭在岛上时，小狗有一定概率跑过去趴到白鹭背上，被驮着飞走。每天最多一次。条件：精力够（不是午睡 / 晚间时段）、不在饭点、没下雨、没在窝里 / 瞭望台上 / 叼着垫子、没有正在进行的互动。概率 = 基础 12% + “无聊”加成（越久没人跟它玩越想出门，2 小时没互动时再加 35%）；刚互动过（20 分钟内）不出门。
- **出门期间**：岛上没有小狗，白鹭也不再来；画面上有提示“小柴乘着白鹭出门了，18:00 回来”，带“叫它回来”按钮。此时点玩具架上的物品只会提示小狗出门了。
- **回来**：18:00（或点了“叫它回来”）白鹭驮着小狗飞回，落在岛边，小狗跳下来，白鹭飞走。出门状态记在本地存储里，中途重启桌宠仍然保持“出门中”；过了 18:00 再启动则直接在家。

### 分工

| 部分 | 负责 | 文件 |
| --- | --- | --- |
| 白鹭模型与动作 | 子模型 | `src/world/egret.js`、`scripts/egret-shot.eval.js` |
| 来访调度、飞行路线、乘鹭出门 / 回来、提示与召回、与其他互动的互斥 | 主控 | `src/world/egretVisit.js`、`src/ui/awayHint.js`、`src/main.js` 等 |

### 白鹭模型的验收标准（子模型交付前自查，主控按此验收）

1. `createEgret()` 返回 `{ group, update(dt), setState(name), state, seat, dims }`；原点在站立时两脚之间的地面，头朝本地 +Z；`seat` 是背上的一个 `Object3D`（小狗趴的位置，本地 +Z 与鸟身一致）；`dims = { height, length, wingspan }`。
2. 造型是小白鹭：全身白；细长的 S 形脖子；又长又尖的黑色喙，眼先（眼睛到喙根）黄绿色；黑色的长腿、黄色的脚；后脑两根细长的饰羽；背上蓬松的蓑羽。站立头顶高约 2.0、身长约 1.35、翼展约 3.4（世界单位，驮得下身长约 1.25 的小狗）。
3. 状态与动作（都是程序动画，状态切换有 0.3–0.5 秒的平滑过渡，不跳变）：
   - `fly`：扇翅（约 2 次/秒，上抬时翼尖略收、下压时展开），脖子缩成 S 形贴在肩上，双腿并拢向后伸直。
   - `glide`：展翅滑翔，翅膀略上反、有轻微抖动。
   - `land`：翅膀向前兜风减速、身体竖起、双腿前伸准备着地。
   - `stand`：收翅站立，脖子 S 形，偶尔转头、换重心，饰羽随风飘。
   - `walk`：鹭类的慢步——一条腿抬起、向前探、落下，头随步子前后一探一探；`dims.stride` 给出一步的前进距离，按 `egret.walkSpeed`（单位/秒）走时脚不明显打滑。
   - `peck`：低头快速啄一下地面再抬起（约 1.2 秒），做完自动回到 `stand`。
   - `takeoff`：先下蹲，再蹬地跃起、大幅快扇（约 0.8 秒），之后由调用方切到 `fly`。
   - `egret.carry = true`（背上驮着小狗）：扇翅幅度略大、频率略慢；翅膀根部不穿过 `seat` 上方的空间。
4. 技术：程序化建模、顶点色、`paintMaterial`（local 空间）；不引入外部素材；三角形 ≤ 8000，draw call ≤ 12；`update` 内不分配对象；各状态连续跑 600 帧无 NaN、页面无报错。
5. 截图：`scripts/egret-shot.eval.js` 配合 `scripts/shot.cjs`，能拍每个状态的特写；交付时附 `shots/egret/` 下的截图（站立侧面、行走两帧、啄地、起飞、飞行上下两帧、滑翔、降落），并且在小岛默认全景下（鸟只有几十像素高）剪影仍能认出是白鹭。
6. 约束：只新增上述文件，不改其他源码；不启动 / 结束桌宠进程，不运行 electron-builder，不写 `dist/`、`release/`。

### 白鹭的外形（更新）

白鹭的身体改用导入的模型：原始文件是用户提供的 `white_egret_model.glb`（约 95 万个三角形、22MB，静态、无骨骼），处理成 `src/assets/egret.glb`（约 1.7 万个三角形、1.2MB）后使用。

- 处理流程见 `scripts/tools/egret-rig.mjs` 顶部的说明：先用 gltf-transform 减面、缩小贴图，再由该脚本换算坐标、按位置给顶点分配骨骼权重（身体 / 脖子 4 节 / 头 / 左右腿各 3 节），关节坐标写在节点的 `extras.rig` 里。
- `src/world/egret.js` 的 `preloadEgret()` 加载它，`createEgret()` 照着 `extras.rig` 建骨架，动作系统（站立、行走、啄地、起飞、飞行、滑翔、降落）不变。
- 导入的模型翅膀是收拢的，飞行时展开的翅膀仍是程序生成的，收翅时隐藏。
- 模型加载失败时退回原来的纯程序化造型。

### 白鹭的外形（再更新）：空中换成飞行姿态的模型

用户又提供了一个飞行姿态的白鹭 `flying_egret_model.stl`（约 62 万个三角形，无贴图、无骨骼）。处理成 `src/assets/egretFly.glb`（约 1.8 万个三角形、665KB）后，用于空中的状态（起飞腾空后、飞行、滑翔、降落）；地面状态仍用站立模型 `egret.glb`。

- 处理流程见 `scripts/tools/egret-fly-rig.mjs` 顶部：`stl2glb.mjs` 转 GLB 并合并顶点 → gltf-transform 减面 → 换算坐标、按部位上顶点色（喙和腿黑色、脚黄色、其余白色）、绑骨（身体 / 左右翅各 3 节 / 脖子 / 头 / 双腿）。
- `egret.js` 里飞行模型有自己的一副小骨架，挂在主骨架的 body 骨头下面；`1 - ground` 超过 0.5 时显示它、隐藏站立模型。翅膀的上扬角由原来的扇翅参数驱动；驮着小狗（`carry`）时翅膀压低、幅度减小。
- 飞行模型没加载到时，空中仍用站立模型 + 程序生成的翅膀。
- 站立模型的修正：后脑的长饰羽只有靠近头的一段跟着头，越往后越跟着身体（之前整条绑在头上，飞行时会把背上的面扯成一片挂在脖子下面的三角形）。

## 农场捣乱小游戏（替换原来的遛狗跑酷）——画面与角色设定

玩法脚本另见后文（待补）；这一节先定画面和角色，交付“角色阵容图 + 游戏画面样张”给用户确认后再做玩法。

### 画面

- 粗块的 3D 像素风：所有东西由小方块搭成，1 个方块 = 1/16 世界单位；纯色（顶点色）、无贴图、无渐变，平直着色（每个面一个明暗）。
- 低分辨率渲染后用最近邻放大（内部高度约 216 像素），边缘是清晰的像素格；阴影也是硬边。
- 暖色农场配色，全部颜色集中定义在一张调色板里（三十来种）：草绿两档、土黄、谷仓红、木头棕、天蓝、云白、庄稼绿、南瓜橙等。
- 镜头在小柴身后偏上方，看得到前方一段路；天空是纯色加几朵方块云。

### 角色（高度以方块数计，小柴约 12 个方块高、16 个方块长）

| 角色 | 样子 | 动作 |
| --- | --- | --- |
| 小柴 `shiba` | 橘色身体，白脸颊 / 胸口 / 肚子 / 四只白袜，三角立耳，卷尾巴（尾尖白），黑豆眼黑鼻，红项圈金铃铛，身后拖一截断掉的红牵引绳；`muddy` 选项 = 泥狗配色 | idle、run、pounce（前扑）、dig（刨地）、held（被拎着后颈）、roll（打滚） |
| 小鸡 `chick` | 黄色小方块，橙喙橙脚，黑眼 | idle、run（小翅膀扑腾）、flap（受惊跳起） |
| 母鸡 `hen` | 白身体，红鸡冠红肉垂，黄喙 | idle、run、peck（追着啄） |
| 管理员 `farmer` | 草帽、红格子衬衫、蓝背带裤、黑雨靴、小胡子，手举扫帚；`angry` 时脸变红 | idle、run（举着扫帚追）、grab（弯腰抓）、stumble（被绊倒） |
| 大鹅 `goose` | 白色长脖子，橙色喙和脚 | idle、run（张翅、压低头冲）、honk |
| 猪 `pig` | 粉色，深粉鼻子，卷尾 | idle、run |
| 羊 `sheep` | 白色蓬松羊毛（表面凹凸），黑脸黑腿 | idle、run、jump（受惊跳开） |
| 奶牛 `cow` / 公牛 `bull` | 黑白花；公牛棕色、带角、鼻环 | idle、run（公牛低头冲） |
| 蜂群 `bees` | 一团黄黑小方块 | fly |

### 场景物件 `prop`

红谷仓（白边）、鸡舍、木栅栏段、栅栏门、方草垛、圆草垛、菜畦（萝卜 / 卷心菜 / 南瓜三种）、拔出来的大萝卜、晾衣绳 + 床单、苹果树、蜂箱、泥塘、水塘、奶桶、手推车、稻草人、风车、篱笆洞、地面块（草地 / 土路）。

### 模块（子模型做，只新增这些文件）

- `src/minigame/farm/palette.js`：调色板 `PAL`。
- `src/minigame/farm/voxel.js`：方块建模工具（按方块坐标加盒子、合并成一个带顶点色的几何，平直着色）。
- `src/minigame/farm/models.js`：`createFarmModel(kind, opts)` → `{ group, parts, update(dt), setAction(name), action, size: { w, h, l } }`；原点在脚下地面中心，头朝本地 +Z；`FARM_MODELS` 列出全部种类和各自的动作。
- `src/minigame/farm/props.js`：`createFarmProp(kind, opts)` → `THREE.Object3D`（静态，原点在底面中心）；`FARM_PROPS` 列出全部种类。
- `src/minigame/farm/pixel.js`：`createPixelPass(renderer, { height })` → `{ render(scene, camera), setSize(w, h), dispose() }`：低分辨率渲染 + 最近邻放大。
- `scripts/farm-shot.eval.js`：配合 `scripts/shot.cjs` 出图。

### 验收标准（这一步）

1. 角色阵容图 `shots/farm/lineup.png`：全部角色站成一排（小柴含普通和泥狗两版，管理员含普通和生气两版），像素风渲染，每个角色一眼能认出是什么；小柴必须能认出是柴犬（橘白配色、立耳、卷尾）。
2. 游戏画面样张 `shots/farm/scene.png`：镜头在小柴身后偏上方，小柴在土路上奔跑，前方几只四散的小鸡和一只母鸡，后方举着扫帚追的管理员，两侧有栅栏、菜畦、草垛、谷仓、苹果树，远处风车；画面读得清、不杂乱。
3. 动作图 `shots/farm/actions-<角色>.png`：每个角色的每个动作各一帧（拼在一张图里），run 取两帧能看出腿在交替。
4. 像素感：放大看是整齐的像素格，没有模糊；颜色都来自调色板；没有贴图。
5. 技术：每个角色由若干刚性部件组成（身体、头、四肢、尾巴等，≤ 10 个部件网格，共用同一个材质），动作靠逐帧设置部件的位置 / 旋转；每个角色三角形 ≤ 1500（管理员 ≤ 2500）；每个物件 1 个网格；`update` 内不分配对象；各动作连续跑 600 帧无 NaN、页面无报错。

### 第一步先出：农场全景图

用户要求先看农场全景。全景图 `shots/farm/panorama.png`（1600×900）：从高处斜着俯视整个农场，一条土路从左下的农场大门蜿蜒到右上的篱笆出口，沿路依次是六个区域——

1. 鸡舍前院：鸡舍、食槽、围栏；
2. 菜地：成排的菜畦（萝卜、卷心菜、南瓜），稻草人；
3. 晾晒场和果园：晾衣绳上的白床单、苹果树、蜂箱、小水塘；
4. 谷仓和牛棚：红色大谷仓（白边）、草垛堆、奶桶、手推车；
5. 猪圈和羊圈：泥塘、围栏；
6. 出口：一长排篱笆，中间一个狗能钻过去的洞；远处一座风车。

验收：六个区域都看得出是什么、互相分得开；土路连贯；画面有层次（近处大、远处小），不空也不杂乱；像素感清晰（见上面第 4 条）；全景里三角形总数 ≤ 15 万，渲染无报错。这一步只做场景物件，角色（上表）放到下一步。
6. 约束：只新增上面列出的文件和 `shots/farm/` 下的图，不改任何现有源码；不启动 / 结束桌宠进程，不运行 electron-builder，不写 `dist/`、`release/`。

### 画面设定第二版（用户看过第一版全景后给了参考图，以此为准）

参考：星露谷那一类浓郁细腻的像素画（斜俯视的农场）、带深色描边的像素动物、戴草帽的像素女孩。第一版的问题：太平、太像积木，细节少。场景仍然用 3D 方块搭，但渲染出来要有像素画的质感。

**镜头**：斜俯视的正交相机（从南面向下看，俯角约 50–60°），小狗可以在整张地图上自由跑；游戏时画面只显示地图的一部分并跟着小狗移动。

**质感**
- 描边：物体和角色的轮廓有 1 像素的深色描边（后处理：按深度 / 法线 / 物体边界找边，描成比本色更深的颜色，不是纯黑）。
- 明暗：每种材质 3–4 档颜色，暗部偏蓝紫、亮部偏黄，直接做进方块的颜色里（树冠的亮斑 / 暗斑、屋顶瓦片的层次、草地的深浅斑块）。
- 配色更浓郁：深浅两三档的草绿、金黄色的土路、深青色的松树、粉色的花树、暖棕色的木头。
- 地面细节：草丛、三叶草斑块、小花、石子、脚印；土路是弯曲的自然边缘（不是直角方格），不要棋盘格草地。
- 树：圆团状、分层的树冠带叶片斑点；橡树、松树（深青色、塔形）、粉色花树、果树；灌木、树桩。
- 栅栏：圆木桩 + 两道横杆。
- 房子：木屋，瓦片屋顶（绿瓦 / 红瓦，瓦片有层次）、烟囱、带窗框的窗、门、门廊。
- 水：池塘岸线不规则，中间颜色更深，有睡莲和芦苇。
- 地图铺满画面，边缘用密林、石崖、溪流收住，不要悬空的平板。

**大地图**（为以后的探索模式留底子；面积约为第一版的 2 倍以上，用弯曲的小路连起来）
- 六个捣乱区域照旧：鸡舍前院、菜地、晾晒场和果园、谷仓和牛棚、猪圈和羊圈、带狗洞的篱笆出口。
- 新增：花园（花坛、小径、长椅、花架拱门、小喷泉或鸟浴盆）；农户的房子（门廊、信箱、水井、柴堆）；树林，林间空地上是农户们正在盖房子的工地（搭了一半的木屋框架、脚手架、木料堆、锯木架）；池塘和小溪、小木桥；牧场；路牌；到处散落的小东西（树桩、石头、蘑菇、木桶、木箱）。

**角色**（3D 方块搭，圆润的大头短腿比例，配色照参考图，靠描边读出轮廓）
- 小柴（主角，含泥狗版）。
- 管理员改为戴草帽的女孩：宽檐草帽（帽带）、棕色长卷发、白上衣、卡其色围巾或背带裤、雨靴，手里拿扫帚；生气时脸红。
- 动物：白母鸡（红冠）、小鸡、绿头鸭（绿头、棕身、橙喙橙脚）、大鹅、粉猪、黑白奶牛、绵羊（蓬松白毛、浅棕脸）、羊驼（棕身、米白脖子和脸）、公牛。

**这一轮的交付**
- 场景（子模型 A）：重做 `palette.js` / `props.js` / `pixel.js`（加描边）/ `farm-shot.eval.js`，新增地图布局 `src/minigame/farm/map.js`（`buildFarmMap()` → `{ group, size, zones, paths }`）；出 `shots/farm/panorama.png`（整张地图）和两张游戏视角的近景 `shots/farm/view-garden.png`、`shots/farm/view-woods.png`。
- 角色（子模型 B）：`src/minigame/farm/models.js`、`scripts/farm-chars-shot.eval.js`；出 `shots/farm/lineup.png`（全部角色站成一排，游戏的斜俯视镜头）和 `shots/farm/actions-<角色>.png`。
- 验收：和参考图并排看，质感接近（有描边、有明暗层次、地面和树有细节、配色浓郁）；每个区域 / 角色一眼认得出；整张地图三角形 ≤ 40 万、任一游戏视角内 ≤ 15 万；无页面报错。

## 农场（定稿方向）：画风、架构与预留接口

用户看过方块版后的结论：方块搭的东西“太积木”。定稿做法：**圆润的 3D 造型（球、椭球、圆柱、圆锥拼的低面数模型）+ 卡通分档明暗 + 深色实线描边 + 低分辨率像素化**；地面仍用带颜色变化的地形网格。样张见 `scripts/farm-style-test.eval.js`（`shots/farm/style-round*.png`）。蜂群取消。玩家的宠物直接用岛上的小狗模型（`createDog`），不另做方块版。此后由主控自行判断、验收、执行。

### 玩法（“捣乱”模式 caper，一局 5 分钟，大地图自由跑）

- 开场：牵着绳走到农场大门，小柴挣脱，绳子拖在身后；之后直接操控小狗。
- 操控：小狗朝鼠标所指的地面位置跑（离得越远跑得越快，贴近就停下）；左键 = 扑（短冲刺：扑鸡、撞翻东西、吓散动物）；在可以刨的地方按住左键 = 刨。Esc 退出。
- 捣乱点分布在全图，各有分值，也会涨管理员的“火气”：追散鸡群 / 扑小鸡、刨萝卜（刨久了出大萝卜）、踩花坛、扯晾着的床单、撞翻奶桶和草垛、泥塘打滚（变泥狗，之后碰到的床单 / 石板地留泥爪印加分）、把猪羊从圈里吓出来、跳喷泉 / 池塘（洗掉泥）、撞工地的木料堆。每个区域有自己的小清单，清完有区域奖励。
- 管理员（草帽女孩）：平时按路线巡视；看见（视野扇形）或听见（响动半径）捣乱就涨火气，满了开始追。甩掉她：脱离视线一段时间、钻灌木 / 草垛躲起来、钻她过不去的篱笆洞、过小溪绕路。被抓住：拎后颈、扣分、罚 3 秒；被抓 3 次提前结束。
- 最后 60 秒“全场通缉”：管理员加一只大鹅一起追，出口的篱笆洞打开，钻出去有额外奖励；没钻出去时间到也结算。
- 结算：按捣乱分算完成度和星级，沿用 `ctx.rewards.grant(result)` 和 `pet:minigame-finished`；中途退出不发奖励。

### 分层

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 地图数据 | `farm/mapData.js` | 纯数据（不依赖 three）：尺寸、区域、路、碰撞体、水域、可互动物、出生点、躲藏点。画面和逻辑都读它 |
| 地图画面 | `farm/map.js`、`props.js`、`palette.js`、`lighting.js` | 按 mapData 摆场景；`lighting.js` 给出各时段的灯光预设 |
| 角色 | `farm/models.js` | 管理员和动物；宠物用 `createPetAvatar(profile)`（包一层 `createDog`） |
| 时钟与规则 | `farm/clock.js`、`farm/rules.js` | 见下 |
| 逻辑 | `farmSim.js`、`farmBot.js` | 纯逻辑、确定性、可序列化；只吃“指令”，不碰输入设备和画面 |
| 联机 | `farm/net.js` | 见下；本版只有离线实现和测试用的假对端 |
| 外壳 | `farm.js`、`farm/hud.js`、`farm/pixel.js` | 输入 → 指令、相机、像素化渲染、界面、阶段（开场 → 进行 → 结算）、和主程序的接口 |

主程序接口沿用现在的小游戏约定：`createFarmGame(ctx)` → `{ active, scene, camera, start(opts), stop(aborted), update(dt), resize(w, h), render(renderer), shelfItem, sim }`；`render` 是新增的可选项（小游戏自己做像素化渲染时主程序调用它）。

### 预留接口一：时段与模式（本版只做白天的 caper，其余是数据和接口）

- `createFarmClock({ env, source })` → `{ hour, phase, weather, source, setSource(s), on('phase', fn) }`。`phase` ∈ `dawn | day | dusk | night`；`source`：`'env'`（默认，跟随岛上的时间和天气，即电脑时钟）、`'fixed'`（调试 / 剧情固定某个时刻）、`'host'`（联机时以房主的时间为准）。
- `FARM_RULES[phase]`（`rules.js`，纯数据）：`{ lighting: 预设名, keeper: { awake, speed, visionRange, visionAngle, lantern }, animals: { chickens: 'roam' | 'roost', pigs, sheep }, spawns: [...], mischief: { 可用的捣乱点种类: 分值倍率 }, events: [...] }`。逻辑和画面只读这张表，不在代码里写死“白天 / 夜晚”。夜晚的设想（先只填表）：管理员提灯巡夜、视野 = 灯光范围，鸡回窝，萤火虫，可以偷鸡蛋，分值更高。
- 模式 `FarmMode`：`{ id, enter(farm), exit(), update(dt), onEvent(e) }`，注册在 `farm.modes` 里。本版只有 `caper`；预留 `explore`（无计时的探索，逐步解锁区域和新内容）和 `social`（联机闲逛）。地图数据里的区域带 `tags` 和 `unlock` 字段给探索模式用。

### 预留接口二：联机（本版不接真实网络）

目标：每个人桌面上的宠物进到同一个农场，能互相看见、交流、一起玩。真实联机需要一台中转服务器（或点对点连接的信令服务器），这涉及部署和费用，要用户决定后才做；本版把客户端结构留好，以后接上不用重写。

- 实体统一：`{ id, kind, owner: 'local' | 'remote' | 'npc', x, z, heading, speed, action, appearance }`。逻辑层只处理“指令”`{ id, moveTo: {x, z} | null, pounce, dig, emote, say }`，本地输入、机器人、网络收到的对端指令都走同一个入口。
- 宠物资料 `PetProfile { id, name, species, appearance: { ... }, owner }`：进农场时带进来，`createPetAvatar(profile)` 按它生成模型。只包含宠物名和外观，不含任何个人信息。
- `FarmNet` 接口：`{ connected, selfId, peers, join(room, profile), leave(), send(type, payload), on(type, fn), now() }`。消息种类：`profile`（进场）、`pose`（自己宠物的位置 / 朝向 / 动作，约每秒 10 次，对端做插值）、`cmd`（扑、刨、互动某个物件）、`emote`、`chat`、`world`（房主发：管理员、动物、可互动物的状态）、`time`（房主的农场时间）。
- 权威划分：各客户端对自己的宠物位置说了算；管理员、动物、可互动物以房主为准（房主跑完整逻辑，其他人只跑自己的宠物并显示房主同步来的状态）。所以 `farmSim` 的状态要能 `snapshot()` / `applySnapshot()`，可互动物都有稳定的 `id`。
- 本版实现：`createLocalNet()`（离线，没有对端）和 `createMockNet({ bots })`（测试用，本机模拟几只别人的宠物在农场里走动、发表情），用来验证“多只宠物同屏、名字牌、表情气泡”这条链路。
- 社交接口 `farm.social`：`emote(id)`（叫、摇尾巴、爱心）、`say(text)`（限长、限频）、`follow(peerId)`（一起遛：跟着对方跑）；宠物头顶的名字牌和气泡。聊天以后接真实网络时要加屏蔽 / 举报，本版只留接口。

### 约定一：地图数据 `src/minigame/farm/mapData.js`（纯数据，不依赖 three；坐标：原点在地图中心，+x 向东，+z 向南，单位 = 世界单位）

```js
export const FARM_MAP = {
  size: { w: 64, d: 48 },                       // 可玩范围：x ∈ [-32, 32]，z ∈ [-24, 24]
  zones: [{ id, name, x, z, r, tags: [], unlock: null }],
  paths: [{ id, width, points: [[x, z], ...] }],
  colliders: [                                  // 走不过去的东西（房子、栅栏、树干、石头、井…）
    { id, kind, shape: 'circle', x, z, r } | { id, kind, shape: 'box', x, z, w, d, rot },
  ],                                            // kind 里 'fence' 的可以带 gap: true（狗能钻、人不能过的洞）→ blocks: ['keeper'] 
  water: [{ id, kind: 'pond' | 'stream', shape: 'circle' | 'poly', ... , depth: 'shallow' | 'deep' }], // 浅水能走（减速），深水狗能游、人绕路
  interactables: [                              // 可以捣乱的东西，id 稳定（联机同步用）
    { id, kind, zone, x, z, r, ...参数 },        // kind：radish_bed / flower_bed / clothesline / milk_can / hay_bale / mud_pit / fountain / lumber_pile / pen_gate / crate …
  ],
  hides: [{ id, kind: 'bush' | 'hay' | 'kennel', x, z, r }],   // 能躲的地方
  spawns: {
    gate: { x, z, heading },                    // 开场：大门口
    exit: { x, z, r },                          // 篱笆洞
    keeper: { home: { x, z }, patrol: [[x, z], ...] },
    goose: { x, z },
    animals: [{ id, kind: 'chick' | 'hen' | 'duck' | 'pig' | 'sheep' | 'cow' | 'alpaca' | 'bull', zone, x, z, count, roam: r, pen: 圈的 id 或 null }],
  },
};
```
`map.js` 按这份数据摆场景（纯装饰的树、花草不必都进数据，但凡是挡路的、能互动的、能躲的都必须在数据里，并且和画面位置一致）。

### 约定二：逻辑层 `src/minigame/farmSim.js`（纯逻辑，不依赖 three / DOM；确定性：同样的种子和指令序列得到同样的结果）

```js
export const FARM = { DURATION: 300, WANTED_AT: 240, CAUGHT_MAX: 3, DOG_SPEED: 5.2, ... };   // 可调常量集中在这里
createFarmSim({ map = FARM_MAP, rules, seed, mode = 'caper', test = {} }) → sim
sim.addPet(profile, { owner: 'local' | 'remote' })  → petId        // 可以有多只宠物（联机预留）；caper 的计分只算 local 的那只
sim.command(petId, { moveTo: { x, z } | null, pounce: bool, dig: bool, emote: id | null })   // 每帧 / 每次变化时调用
sim.update(dt)                                                   // 固定步长内部细分
sim.time, sim.phase ('intro' | 'play' | 'wanted' | 'done'), sim.finished
sim.pets: [{ id, owner, x, z, heading, speed, action, muddy, hidden, held, stamina?, ... }]
sim.keeper: { x, z, heading, action, anger (0..1), state: 'patrol' | 'suspicious' | 'chase' | 'search' | 'carry' | 'return', target }
sim.goose: { active, x, z, heading, action }
sim.animals: [{ id, kind, x, z, heading, action, loose, scared }]
sim.objects: [{ id, kind, state, progress, ... }]                 // interactables 的状态
sim.score, sim.caught, sim.zones: { [zoneId]: { done, total, cleared } }
sim.events: [{ type, ... }]   sim.clearEvents()                  // 给画面 / 音效 / 界面用：'mischief' { kind, objectId, points, x, z } | 'alert' | 'chaseStart' | 'chaseEnd' | 'caught' | 'hide' | 'wanted' | 'escaped' | 'zoneCleared' | 'finished' …
sim.result(aborted) → { game: 'farm', mode, completion (0..100), stars (0..3), score, caught, escaped, mischief: { kind: 次数 }, zonesCleared, duration, aborted }
sim.snapshot() → 可 JSON 序列化的完整状态； sim.applySnapshot(s)
sim.setRules(rules)                                              // 时段变化时换规则表
```
- 移动：宠物朝 `moveTo` 跑，带加减速和转向；碰撞体挡路时沿着边滑过去，不卡死；浅水减速、深水游泳（更慢）；`blocks: ['keeper']` 的洞只有宠物能过。
- 管理员的寻路：在按地图数据生成的栅格上做 A*（参考 `src/dog/brain/mover.js` 里的做法），不能穿墙、不能过洞、过溪要走桥。
- `src/minigame/farmBot.js`：`createFarmBot({ kind })` → `(sim, petId, dt) => command`，至少三档：`idle`（不动）、`random`（乱跑乱扑）、`skilled`（有计划地捣乱、被追时会跑会躲）。

### 逻辑层的验收（`scripts/farm-test.mjs`，纯 Node 运行，不开浏览器）

1. 确定性：同种子同机器人跑两遍，结果和事件序列完全一致；`snapshot` → 新 sim `applySnapshot` 后继续跑，结果与不中断的一致。
2. 一局正好 300 秒结束（或被抓 3 次提前结束）；240 秒进入“全场通缉”，大鹅出现、出口打开。
3. 机器人分档明显：`idle` 完成度 ≤ 5；`random` 在 15–55 之间；`skilled` ≥ 70 且被抓 ≤ 1 次（各取 8 个种子的中位数）。`skilled` 钻出口的比例 ≥ 60%。
4. 管理员：不穿墙、不过洞、不涉深水（全程采样位置都在可走区域内）；视线被房子 / 树林挡住时不会凭空发现小狗；躲进灌木 / 草垛且她没亲眼看着进去时会丢失目标；追逐速度略低于小狗的全速、但小狗刨地 / 撞障碍时能追上。
5. 小狗：全程不出地图、不进碰撞体内部；被 4 面围住的死角里不卡死（随机点对点跑 2000 次都能到达或停在最近处）。
6. 每种捣乱点都能被触发并计分；泥狗 → 床单 / 石板地的连带加分生效；清完一个区域触发 `zoneCleared`。
7. 多宠物：加入 3 只 `remote` 宠物各自发指令，不影响 `local` 的计分；性能：一次 `update(1/60)` 平均 ≤ 0.3 毫秒（Node）。

### 农场：实现落地（与上面约定的差异和现状）

- 入口仍是玩具架上的遛狗绳；原来的遛狗跑酷（`walk.js`、`walkSim.js` 等）已删除，`walk/geo.js`、`walk/leash.js` 因为钓鱼和玩具架还在用而保留。
- 主程序接口：`createFarmGame(ctx)`，新增 `render(renderer)`（小游戏自己做像素化渲染，主程序在小游戏进行中调用它）；启动参数 `game=farm`、`farmNet=mock`。
- 宠物直接借用岛上的小狗模型，进农场时临时换成卡通材质（`actors.js`），退出时换回；对端宠物用 `createDog` 另建实例。
- 时段：`rulesFor(phase, { mode: 'caper' })` 本版一律返回白天的规则，灯光也固定为白天；`FARM_RULES` 里夜晚等时段的表已填好但没有启用。
- 联机：只有 `createLocalNet`（离线）和 `createMockNet`（两只假对端）；对端宠物在逻辑层里是 `owner: 'remote'`，不计分、不会被抓。`farm.social` 提供 `emote / say / follow`。
- 可互动物件的画面状态：`buildFarmMap().objects`（`setState`）由外壳每帧按 `sim.objects` 喂入。
- 地图数据相对约定新增了 `bridges`、`terrain`、`props` 字段；`createFarmSim` 必须显式传入 `map`。
- 尚未做：开场“牵着绳走到门口、挣脱”的动画（目前直接从大门口开始）、拖在身后的断绳、音效、泥爪印留在石板地上的持久痕迹、镜头的像素对齐。
- 验证：`node scripts/farm-test.mjs`（逻辑层 86 项）。外壳的端到端检查（整局结算、退出复原、中途退出、互斥）是页面内脚本 `scripts/farm-flow.eval.js`，配合 `scripts/shot.cjs` 运行、人工看输出，还没有做成自动判定通过 / 未通过的测试。

### 农场：操控与镜头（用户试玩后的调整，以此为准）

鼠标（最新，覆盖下面“视角跟着鼠标转”里按鼠标位置算的写法）：
- 游戏进行中（`phase === 'play'`）鼠标锁定在窗口里并隐藏（Pointer Lock，锁的是画布），鼠标移动只转镜头：按位移算，左右 = 绕小狗转（`LOOK_YAW` 弧度 / 像素，不限圈数），上下 = 抬头 / 低头（`LOOK_TILT`，-1..1 → 俯角和落点前移量）；仍有回差（`LOOK_BAND_YAW / LOOK_BAND_TILT`）。位移取自 `mousemove`（实测锁定状态下 `pointermove` 的 movementX / Y 是 0），`pointermove` 只在 mousemove 没送达时兜底。左键 = 扑、滚轮 = 缩放照旧。
- 锁定要由用户操作触发：开局时先申请一次，没成功（开局动画隔得久 / 窗口不在前台）就在下一次按键或点击时再申请；没锁上期间光标也不显示（`cursor: none`），鼠标位移照样转镜头。
- 放开：进入结算（要点“再来一局 / 退出”）和退出游戏时 `releaseLock()` 并恢复光标；“再来一局”重新锁上。
- 暂停：窗口失去焦点（Alt+Tab、Win 键、点到别的窗口）时自动暂停（`setPaused`）——逻辑、动画、镜头、倒计时都停，画面停在最后一帧，盖一层“已暂停”的遮罩，光标恢复；回来以后点一下或按任意键继续（这一下只用来继续，不算扑 / 不算操作），并重新锁定鼠标；暂停时按 Esc 仍然是退出。只在 `phase === 'play'` 时暂停，结算界面不暂停。
- Esc：锁定状态下系统先用 Esc 解锁、页面收不到这次按键，所以 `pointerlockchange` 里“不是自己放开的、窗口还在前台”就当作按了 Esc → 退出游戏；切到别的窗口造成的解锁不退出，回来后下一次按键 / 点击重新锁上。

挡住小狗的树变半透明：
- 树（`tree / apple_tree / pink_tree / pine`）都合并在地块网格里，没法单独换材质，所以合并时给每棵树的顶点写一个 `aOcc = (x, z, 半径, 高度)`（`map.js` 的 `SEE_KINDS`、`voxel.js` 的 `mergeStatic`），别的东西是 0。
- 卡通材质（`props.js` 的 `farmToonMaterial.onBeforeCompile`）在顶点着色器里按“这棵树”判断：树根比小狗离镜头近、且在画面上盖住小狗 → 整棵树一起变透；片元按 2×2 抖动格子丢像素（`uSeeMax` = 0.7，最透时丢 3/4），留下的像素把 alpha 写成 0.5 做记号。
- `pixel.js` 描边时，旁边更近的那一格如果带这个记号就不算边，树后面透出来的小狗不会被描黑。抖动格子跟着世界走（`onSnap` → `uSeeGrid`），镜头平移时不在树上爬。
- `farm.js` 的 `placeCamera` 每帧把小狗位置和相机的右 / 上 / 后方向写进 `farmSeeThrough`。只对本机的小狗生效；房子、篱笆不透。

管理员对捣乱的反应（逻辑层 `keeperNotice` / `stepKeeper`；用户定的流程，以此为准）：
- 流程：只要小狗有捣乱的动作，不管她在哪儿 → **先赶到现场** → 小狗还在现场就**驱赶** → 驱赶无效才**抓**，拎到最近的路上扔下 → 小狗不在现场就**回去巡逻**。
- 赶到现场：每次捣乱都记下出事地点（`K.sceneX / sceneZ`）并切到 `suspicious`（`alert` 事件），先愣 `REACT_T`（1.2 秒）转身，再以 `SUSPECT_SPEED`（3.0）跑过去；路上又有新的捣乱就改去最新的地方。没有“听得见才去”“动静攒够才去”这类条件（规则表里 `keeper.respondAll === false` 可以关掉远处的响应，留给夜晚模式）。
- 小狗还在：赶路 / 张望时看见小狗在出事地点 `SCENE_R`（7）以内 → 开始驱赶（`chaseStart` 带 `shoo: true`）。亲眼看见捣乱的等于已经在现场，直接开始驱赶。
- 驱赶：冲着小狗去，到跟前 1.1 以内站住挥手（`K.action = 'shoo'`），**不抓**。有效 = 小狗离开现场（离出事地点 > `SCENE_R` + 1.5 且离她 > 3），或 `SHOO_HIDE_T`（1.5 秒）看不见小狗 → `shooed` 事件，回去巡逻，火气涨 `SHOO_ANGER`。
- 驱赶无效（`shooFail` 事件，`reason`）→ 改成抓：① `stay`：她到了小狗 `SHOO_NEAR`（6）以内以后累计 `SHOO_T`（4 秒）小狗还没离开现场；② `again`：正被驱赶时当着她的面又捣乱；③ `back`：刚被赶走 `SHOO_CD`（8 秒）内又回到原地（离刚赶过的地方 `AGAIN_R` 7 以内）捣乱，她回来直接抓；④ `angry`：火气到 `ANGER_FULL`（0.9）或进入通缉阶段，不再先驱赶。
- 小狗不在：到了出事地点没看见，张望 `LOOK_T`（1.8 秒）就回去巡逻，不搜。抓的过程中跟丢了才会搜一圈（原有的 `search`）。
- 圈门（用户反馈“管理员被卡在了门口”后修的）：寻路一直是按“撞开的圈门能走”规划的，但她走路时的碰撞（`keeperGo` / 贴身追）写死成圈门永远关着，所以门开了她也被挡在门口。现在碰撞和寻路都用同一个 `gateOpen`：门开着她能进圈赶 / 抓，门关着进不去——驱赶时够不着就站在能到的最近处隔着篱笆赶（`K.partial && arrived && K.shoo`），时间照算，之后改成抓也够不着，等 `GIVEUP_T` 放弃（关着门的圈仍然是小狗的避风港）。
- 驱赶时她“知道小狗还在现场”（`aware`）：绕篱笆、找门的时候视线没对着小狗不算跟丢，只有小狗躲起来或离开了现场才算不见了。
- 躲藏：她赶过来的路上、驱赶的时候，小狗钻进灌木 / 草垛 = 不在现场了——她不对着藏起来的小狗驱赶，也不抓；站住张望 `SHOO_HIDE_T` 秒找不到就回去巡逻（事件 `shooed` 带 `hid: true`，提示“她没找到你，回去巡逻了”）。“看着钻进去会被揪出来”（`hideSeen`）只在她动手抓的时候才算（`chase` 且不是驱赶：驱赶无效 / 火气满 / 通缉 / 刚赶走又回来）。原因：她是一路朝着现场跑的，几乎总能看到小狗钻进去，如果这也算“看着进去”，躲藏就形同虚设（先对着藏起来的小狗驱赶、再抓走，还会在“驱赶 → 抓 → 找 → 驱赶”之间打转）。
- 地图：牛圈的水槽原来摆在圈门里面 1.2 处，把她的通道堵死，挪到了北边篱笆下。
- 界面：`alert` → “管理员听到动静，正赶过来！”；驱赶开始 → “管理员来赶你了，快走开！”；驱赶无效 → “还不走？她要抓你了！”等；被赶开 → “被赶开了，她回去巡逻了”。她驱赶时头顶冒“去！走开！”。
- 难度（真实地图，机器人各 8 局 × 4 分钟）：改之前她对九成的捣乱没有反应（小狗捣乱时她平均在 18 个单位外，响动半径只有 3–12）；现在每次都来。熟练机器人完成度 97 → 约 56、每局被抓 0 → 约 1.3；随机机器人（不躲）每局被抓 0.4 → 1.8。偏难的话先调 `SUSPECT_SPEED / REACT_T / SHOO_T`。

被抓以后（逻辑层）：
- 管理员抓到小狗后不再是走 3 秒就地放下，而是拎到路上再扔：`catchPet` 里用 `pickRoadDrop` 在路面落点（沿每条路约 1 个单位取一个，`roadPts`）里挑一个离这儿至少 `ROAD_MIN`（3.5）、实际走过去最近的；拎着走的速度 `CARRY_SPEED` 3.0，至少拎 `CARRY_T` 1.5 秒，最多 `CARRY_MAX_T` 10 秒（走不到 / 卡住就地处理）。
- 到了以后站定 `TOSS_WIND` 0.35 秒转向落点（`pickLanding`：优先附近路面上最顺着朝向的一点，没有再朝各方向找空地），然后扔出去：小狗 `action = 'tossed'`，沿抛物线飞 `TOSS_T` 0.55 秒（`p.air` = 离地高度，画面用），落地发 `landed` 事件、晕 `TOSS_STUN` 0.6 秒，之后 `IMMUNE_T` 5 秒内不会被再抓。
- 顺带修了寻路：起点不在能站的格子上（贴着薄篱笆）时，“最近的能站的格子”不能隔着碰撞体选，否则管理员会顶着篱笆原地走。

画面防闪（低分辨率 + 硬描边，镜头一动边缘就容易跳）：
- 镜头平移：`pixel.js` 每帧把相机沿画面左右 / 上下方向对齐到像素格的整数倍再画（渲染目标四周多画 1 格），对齐掉的零头在放大时按亚像素补回来——静止的东西落在同样的像素上，平移仍然顺滑；相机本身画完即还原，界面按相机算的屏幕坐标不受影响。
- 鼠标视角：加回差（`LOOK_BAND_X / LOOK_BAND_Y`，鼠标挪出半宽的 5% / 半高的 8% 才带动视角），手抖和点击时的小晃动不转；转动 / 俯仰 / 缩放的收尾改成匀速收住（`approach`），不拖一条越来越慢的尾巴。
- 阴影：范围按 4 个单位一档取整，对准的位置按阴影贴图的格子取整（`lighting.js` 的 `apply`），镜头走动时影子边缘不抖。
- 量化办法：`shots/` 下的一次性脚本逐帧对比（整体平移对齐后仍在变的像素比例）。改之前：跑动 5–7%、鼠标小幅晃动约 10%；改之后：跑动只剩小狗自己在动、鼠标小幅晃动 0。转视角本身会让整幅画面重新取样，这部分是这种画风固有的。
- `createPixelPass` 留了 `ss`（超采样倍数）参数，默认 1：试过 2 倍，小石子和小花会被描成一圈黑边、画面发糊，没有采用。

- 移动：WASD / 方向键，按屏幕方向（上 = 北）；外壳把按键方向换成“小狗前方 4 个单位处”的 moveTo 喂给逻辑层，逻辑层接口不变。鼠标不再控制移动。
- 鼠标左键（或 K / Shift）= 扑：追鸡、吓散动物，随时都能扑。
- 空格（或 J / 回车）= 和眼前的东西互动，对象就是头顶显示操作提示的那一个（离它边缘 1.5 以内最近的、还没捣乱过的）：
  菜畦 → 按住原地刨（还差一点没站进去时自己走进去再刨）；奶桶 / 草垛 / 箱子 / 圈门等 → 按一下，小狗自己对准它冲过去撞（外壳在 0.32 秒内把 moveTo 指向目标并发一次 pounce）；
  花坛 / 泥塘 / 喷泉 → 按住就往里走。眼前没有东西时空格不做任何事。
- 镜头始终以小狗为中心。滚轮缩放 0.55–2.4 倍（`ZOOM_MIN / ZOOM_MAX`）；小狗走进“范围内有可捣乱物件”的区域时自动再推近 1.38 倍（`ZONE_ZOOM`）并提示区域名，离开恢复，进出有回差。
- 视角跟着鼠标转：鼠标在窗口里的左右位置 → 镜头绕小狗的方位角（最左 / 最右各 140°，`YAW_MAX`），上下位置 → 抬头 / 低头：鼠标在最上俯角从 42° 放平到 22°（`PITCH_UP`），同时镜头落点沿视线方向往前挪（`AHEAD_BASE / AHEAD_UP / AHEAD_DOWN`，占画面一半可见纵深的比例：平时 0.12、最上 0.5、最下 −0.2），小狗退到画面下方、前面的路露出来；鼠标在最下俯角加到 50°（`PITCH_DOWN`）、落点往回收。描边的上下向阈值跟着俯角走（`pixel.js` 的 `uSlope`），视线放平时地面不会被描成一片黑线；窗口中间留一块不动的区域（`LOOK_DEAD`）；鼠标移出窗口时保持最后的视角。方向键是相对画面的，外壳按镜头的方位角把它转成世界方向。
- 撞到要捣乱的东西不算撞墙：逻辑层把“扑的时候一头撞上障碍”推迟到物件判定之后结算（`settleBonk`）——这一扑撞到过可捣乱物件就只是停下，什么都没撞到才眩晕 0.8 秒；
  方的东西从侧面撞（离中心比较远）时，只要撞上的碰撞体就在它身上也算撞到。
- 捣乱点的提示：10 个单位以内、还没捣乱过的东西头顶显示一个黄色小感叹号；离它边缘 1.5 以内最近的那一个改成操作提示（“按住空格 刨萝卜”“空格 撞奶桶”“来回跑 踩花坛”等，文案在 `farm.js` 的 `TRIGGER_TEXT / KIND_TEXT`）。
