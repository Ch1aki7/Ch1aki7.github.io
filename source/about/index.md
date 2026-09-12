---
title: 关于我
date: 2026-08-05 13:29:39
updated: 2026-09-12 22:58:22
description: 关于 Chiaki Zaphkiel，以及 Glimmer、Ashen-Requiem、Nautilus-Prime 等游戏引擎、Unity 与嵌入式项目。
keywords:
  - Chiaki Zaphkiel
  - Glimmer
  - Ashen-Requiem
  - Nautilus-Prime
  - 游戏引擎
  - C++
  - Unity
  - 嵌入式开发
  - OpenGL
top_img: false
comments: false
aside: false
---

<div align="center">
  <img class="no-lightbox" src="/img/avatar.png" width="128" height="128">
  <h2>Chiaki Zaphkiel</h2>
  <p>Engine Developer · Gameplay Builder · Continuous Learner</p>
  <p><em>世界を騙せ。</em></p>
</div>

{% note primary %}
欢迎来到 **Zaphkiel's Lab**。这里是一间位于世界线交汇处的小型实验室，用来保存代码、设计选择、问题排查过程，以及那些值得被认真记录的想法。
{% endnote %}

## 关于我

你好，我是 **Chiaki Zaphkiel**。

我关注游戏引擎、实时图形、编辑器工具与工程系统，也会把这些能力带进 Unity 游戏、嵌入式设备和端侧 AI 项目中。我喜欢从一个具体问题出发，一直追踪到数据流、资源生命周期和架构边界。相比只记录“最后该怎么写”，我更希望保留问题如何出现、方案为何调整，以及实现背后的取舍。

这个博客既是个人知识库，也是长期项目日志。文章可能来自一次调试、一项编辑器功能、一个渲染实验，或对既有设计的重新审视。

我相信好的工程记录不只给出答案，还应该让后来的人看见抵达答案的路径。

## 从这里开始

如果你第一次来到这里，可以按感兴趣的问题选择一条阅读路线：

| 阅读方向 | 推荐文章 | 你会看到什么 |
| --- | --- | --- |
| 渲染架构 | [基于 Shader-ABI 的多 Pass 处理](/posts/c218b63/) · [HDR 线性渲染链与 IBL](/posts/508162ef/) | Shader 接口、Pass 编排、后处理与线性颜色空间如何在引擎中衔接 |
| 材质与性能 | [MaterialInstance 与实体材质 Override](/posts/4d26f4b/) · [3D GPU Instancing 与材质实例缓存](/posts/1eddf29f/) | 材质覆盖、实例批次、缓存键与资源生命周期之间的关系 |
| 编辑器与资产 | [Glimmer 中内容浏览器的设计](/posts/468bd775/) · [基于 GraphView 的 Unity AB Graph](/posts/7824cc20/) | 如何把文件、资源依赖与编辑操作组织成可见、可维护的工作流 |
| 工具与调试 | [ParticleSystem 特效烘焙为序列帧](/posts/cc954f23/) · [使用 RenderDoc 连接模拟器抓帧](/posts/79433343/) | 从离线资源生产到运行时图形诊断的两类实践 |

## 代表项目

这些项目的规模和目标并不相同，但它们共享一条主线：先让系统工作，再把隐式关系整理成能够继续演进的结构。

### Glimmer

[**Glimmer**](https://github.com/Ch1aki7/Glimmer) 是我持续开发的 Modern C++ 游戏引擎，也是这个博客最主要的长期项目。它从窗口、事件和 Renderer API 抽象起步，逐步形成了带独立编辑器的场景与资产工作流。

目前已经覆盖 ECS 场景、内容浏览器、Inspector 与 Gizmo、2D Batch、3D GPU Instancing、材质实例、地形、HDR 线性渲染链、IBL、CSM，以及基于 Shader ABI 的多 Pass 材质和自定义后处理栈。对我来说，它的价值不只在于功能数量，更在于反复回答几个工程问题：模块边界应该落在哪里，运行时资源由谁拥有，状态怎样恢复，旧资产又如何继续兼容。

博客中的 Glimmer 系列会把提交背后的推理单独展开，例如 [HDR 线性渲染链与 IBL](/posts/508162ef/) 与 [基于 Shader-ABI 的多 Pass 处理](/posts/c218b63/)。

[![Glimmer 的 HDR 场景与 PBR 材质展示](/about/img/GL1.png)](https://github.com/Ch1aki7/Glimmer)

<div align="center"><small>Glimmer 的最终渲染画面：日落天空、低照度环境、不同材质参数的球体与金属模型共同构成测试场景，用来观察 HDR 线性渲染、环境光照、反射和 PBR 材质在明暗区域中的表现。</small></div>

[![Glimmer 编辑器中的地形、资源浏览器与渲染统计](/about/img/GL2.gif)](https://github.com/Ch1aki7/Glimmer)

<div align="center"><small>Glimmer Editor 的实际工作流：Viewport 中同时显示地形、材质球和模型；Scene Hierarchy 负责管理场景实体，Content Browser 浏览字体、材质、模型、场景、Shader、天空盒和纹理，右侧 Debug 面板则实时呈现绘制、剔除与 GPU 耗时等统计信息。</small></div>

### Ashen-Requiem

[**Ashen-Requiem**](https://github.com/Ch1aki7/Ashen-Requiem) 是一个 Unity 2D 动作游戏项目。它从 Player State Machine 出发，继续实现移动、连击、受击、击退、墙面动作与敌人状态，并逐步扩展到技能树、属性系统、异常状态、Tilemap、视差背景、2D 光照和 Shader 表现。

这个项目更接近“把系统放进真实玩法里检验”：状态切换必须和动画、物理、输入窗口及技能冷却对齐；一个视觉效果也需要同时考虑命中反馈、角色状态和资源组织。仓库中的 Developing Log 保留了从基础移动到次元斩等技能的完整演进过程。

[![Ashen-Requiem 的技能树与“恶神火焰”技能说明](/about/img/AR1.png)](https://github.com/Ch1aki7/Ashen-Requiem)

<div align="center"><small>Ashen-Requiem 的技能树界面：左侧节点与连线表达技能的前置关系，右侧面板展示“恶神火焰”的背景、行为和解锁条件。技能点、前置技能与互斥选择被集中到同一套数据驱动 UI 中，也让玩法规则能够被玩家直接理解。</small></div>

### Nautilus-Prime

[**Nautilus-Prime**](https://github.com/Ch1aki7/Nautilus-Prime) 是一次端侧 AI 与嵌入式软硬件整合实践。项目使用 K230 CanMV 开发板承担摄像头、触摸界面和 YOLOv5 推理，再通过 UART 与 STC-B 板连接数码管、蜂鸣器、RTC、霍尔和振动传感器。

最终实现并不只是一次模型推理 Demo，而是一套以宝可梦图鉴和“希卡之石”为表现形式的交互系统：可以拍摄或检索目标、显示详情与序列帧动画，并让识别结果继续触发 LED、声音和外围硬件反馈。它让我完整经历了数据准备、模型转换、板端内存限制、UI 绘制、串口协议和传感器联调之间的交叉问题。

[![Nautilus-Prime 的设备主界面与外围硬件联调](/about/img/NP1.png)](https://github.com/Ch1aki7/Nautilus-Prime)

<div align="center"><small>Nautilus-Prime 的设备主界面：屏幕提供 Pokémon Detect、Pokémon Browser、Sheikah Stone 与 Super Earth 四个入口；后方 STC-B 板的数码管与 LED 同步工作，体现了 K230 图形界面与外围控制板之间的协作。</small></div>

[![Nautilus-Prime 在 K230 上运行宝可梦图像识别](/about/img/NP2.png)](https://github.com/Ch1aki7/Nautilus-Prime)

<div align="center"><small>端侧识别结果：K230 对输入图像执行 YOLOv5 推理，并在屏幕上给出 Espeon（太阳伊布）的类别与置信度。识别、文字叠加和画面显示均在开发板端完成。</small></div>

[![Nautilus-Prime 的宝可梦图鉴详情页](/about/img/NP3.png)](https://github.com/Ch1aki7/Nautilus-Prime)

<div align="center"><small>识别结果进入图鉴详情页后，界面会组合原始图片、像素动画、编号、中文名称、属性、身高体重、栖息地与六维能力数据。这张图展示了模型输出如何继续进入资源检索和信息可视化链路，而不是止步于一个分类标签。</small></div>

[![Nautilus-Prime 的屏幕时钟与 RTC 数码管同步](/about/img/NP4.png)](https://github.com/Ch1aki7/Nautilus-Prime)

<div align="center"><small>RTC 联调画面：K230 屏幕与 STC-B 数码管同时显示 16:13:10，并以北京时间页面作为参照。它验证了时间数据读取、UART 通信以及两种显示终端之间的同步。</small></div>

### Unity-VFX-Baker

[**Unity-VFX-Baker**](https://github.com/Ch1aki7/Unity-VFX-Baker) 是一个范围更小、目标更明确的 Unity 编辑器工具。它将实时 ParticleSystem 离线采样为序列帧图集，并生成播放材质与 Quad Prefab，以纹理空间换取更可控的运行时成本。

这个项目代表我偏爱的另一种工作方式：不追求扩张成大系统，而是围绕一个性能问题，把采样、透明区域裁剪、图集数据、资源生成和运行时播放链路做完整。实现过程记录在 [Unity 中将 ParticleSystem 特效烘焙为序列帧](/posts/cc954f23/)。

## 技术栈

### 经常使用

{% label C++ blue %} {% label C# green %} {% label Python purple %} {% label OpenGL orange %} {% label GLSL red %} {% label Unity blue %} {% label Git green %}

### 项目中使用

{% label ImGui blue %} {% label EnTT green %} {% label Premake purple %} {% label YOLOv5 orange %} {% label CanMV red %} {% label Embedded-Systems blue %}

### 持续探索

{% label Engine-Architecture blue %} {% label Rendering green %} {% label Editor-Tools purple %} {% label Asset-Pipeline orange %} {% label Performance red %}

技术栈会变化，解决问题、验证假设和保持系统清晰的习惯更值得长期保留。

## 博客里有什么

| 栏目 | 主要内容 |
| --- | --- |
| 游戏引擎 | Glimmer 的模块、编辑器与功能设计 |
| 图形渲染 | OpenGL、GLSL、材质、光照和渲染调试 |
| Unity 与工具 | 游戏系统、编辑器扩展和资源生产流程 |
| 工程记录 | C++ 架构、文件系统、资源管理和工具链 |
| 嵌入式实践 | 端侧推理、串口通信、UI 与传感器联调 |
| 问题分析 | 性能数据链路、异常定位和修复复盘 |
| 随笔与收藏 | 阶段思考、学习线索和值得保留的资料 |

## 最近的世界线

{% timeline 开发与记录,blue %}
<!-- timeline 现在 -->

持续完善 Glimmer 的渲染、资产和编辑器链路，并将关键设计、失败尝试与验证过程整理成文章。

<!-- endtimeline -->

<!-- timeline 近期 -->

完成 Shader ABI、多 Pass 材质与自定义后处理链路；同时继续整理 Unity 工具、游戏系统和早期嵌入式项目中值得复用的经验。

<!-- endtimeline -->

<!-- timeline 接下来 -->

继续补充渲染架构、资产管线、场景系统和编辑器工作流，也会为 Ashen-Requiem、Nautilus-Prime 等项目留下更完整的专题记录。

<!-- endtimeline -->
{% endtimeline %}

## 关于这个站点

本站使用 {% label Hexo blue %} 构建，采用 {% label Butterfly purple %} 主题，并托管在 {% label GitHub-Pages default %}。

这里没有宏大的完成期限。它会随着项目和认知一起生长：可能增加新的专题，也可能重写旧文章；可能记录一次漂亮的实现，也会保留一次值得复盘的错误。

{% note warning %}
文章内容主要是个人学习与项目实践记录。随着代码和工具版本变化，部分实现可能不再适用于最新环境，请结合文章日期和上下文判断。
{% endnote %}

## 找到我

如果你对文章中的实现、Glimmer 或相关技术方向感兴趣，可以通过 GitHub 查看我的公开项目与动态。

{% btn https://github.com/Ch1aki7,访问 GitHub,fa-brands fa-github,blue larger %}
{% btn /archives/,浏览文章,fa-solid fa-box-archive,purple larger %}

---

<div align="center">
  <p><strong>進め！( •̀ᴗ•́ )و ̑̑</strong></p>
  <p>愿每一次调试，都让世界线向更清晰的方向收束。</p>
</div>
