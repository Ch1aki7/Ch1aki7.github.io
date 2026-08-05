---
title: 关于我
date: 2026-08-05 13:29:39
updated: 2026-08-05 15:30:00
description: 关于 Chiaki Zaphkiel、Glimmer、技术方向与这个博客。
keywords:
  - Chiaki Zaphkiel
  - Glimmer
  - 游戏引擎
  - C++
  - OpenGL
top_img: false
comments: false
aside: false
---

<div align="center">
  <img class="no-lightbox" src="/img/avatar.png" width="128" height="128">
  <h2>Chiaki Zaphkiel</h2>
  <p>Developer · Engine Enthusiast · Continuous Learner</p>
  <p><em>世界を騙せ。</em></p>
</div>

{% note primary %}
欢迎来到 **Zaphkiel's Lab**。这里是一间位于世界线交汇处的小型实验室，用来保存代码、设计选择、问题排查过程，以及那些值得被认真记录的想法。
{% endnote %}

## 关于我

你好，我是 **Chiaki Zaphkiel**。

我关注游戏引擎、实时图形、编辑器工具与工程系统，也喜欢从一个具体问题出发，一直追踪到数据流、资源生命周期和架构边界。相比只记录“最后该怎么写”，我更希望保留问题如何出现、方案为何调整，以及实现背后的取舍。

这个博客既是个人知识库，也是长期项目日志。文章可能来自一次调试、一项编辑器功能、一个渲染实验，或对既有设计的重新审视。

> 我相信好的工程记录不只给出答案，还应该让后来的人看见抵达答案的路径。

## 当前关注

{% tabs focus,1 %}
<!-- tab 游戏引擎@fa-solid fa-cubes -->

- 引擎与编辑器的模块边界
- Scene、Asset 与 Renderer 的协作关系
- 内容浏览器、层级面板和属性面板等编辑器工具
- 资源导入、序列化与生命周期管理

<!-- endtab -->

<!-- tab 图形与渲染@fa-solid fa-wand-magic-sparkles -->

- OpenGL 渲染管线与抽象层设计
- 2D/3D 渲染、纹理、着色器和帧缓冲
- 地形、材质与场景可视化
- 从渲染结果反推状态、数据和 API 使用问题

<!-- endtab -->

<!-- tab 工程实践@fa-solid fa-screwdriver-wrench -->

- C++ 工程结构与可维护性
- 性能数据链路和问题定位
- 延迟初始化、缓存策略与文件系统 I/O
- 将一次性修复整理为可复用的设计经验

<!-- endtab -->
{% endtabs %}

## Glimmer

**Glimmer** 是我持续开发和整理的游戏引擎项目。它既是技术实践，也是观察复杂系统如何逐渐形成的一块试验场。

目前博客中会重点记录：

- 编辑器功能如何拆分和组织；
- 场景、资源与渲染系统如何交换数据；
- 功能从“可以运行”走向“可以维护”时经历的调整；
- 实现过程中遇到的性能、状态与工具链问题。

{% note info %}
可以从《[Glimmer中内容浏览器的设计](/posts/Glimmer中内容浏览器的设计/)》开始了解项目中的编辑器设计记录。
{% endnote %}

## 技术栈

### 经常使用

{% label C++ blue %} {% label OpenGL green %} {% label GLSL purple %} {% label Git orange %} {% label CMake red %}

### 持续探索

{% label Engine-Architecture blue %} {% label Rendering green %} {% label Editor-Tools purple %} {% label Asset-Pipeline orange %} {% label Performance red %}

技术栈会变化，解决问题、验证假设和保持系统清晰的习惯更值得长期保留。

## 博客里有什么

| 栏目 | 主要内容 |
| --- | --- |
| 游戏引擎 | Glimmer 的模块、编辑器与功能设计 |
| 图形渲染 | OpenGL、GLSL、纹理、地形和渲染调试 |
| 工程记录 | C++ 架构、文件系统、资源管理和工具链 |
| 问题分析 | 性能数据链路、异常定位和修复复盘 |
| 随笔与收藏 | 阶段思考、学习线索和值得保留的资料 |

## 最近的世界线

{% timeline 开发与记录,blue %}
<!-- timeline 现在 -->

持续完善 Glimmer，并将实现过程中的关键设计、失败尝试和最终选择整理成文章。

<!-- endtimeline -->

<!-- timeline 近期 -->

围绕编辑器内容浏览器、资源导航、场景加载和拖拽交互进行设计与迭代，同时记录性能监测平台的数据链路分析过程。

<!-- endtimeline -->

<!-- timeline 接下来 -->

继续补充渲染架构、资产管线、场景系统与编辑器工作流相关内容，让零散实验逐渐形成可以回看和复用的知识体系。

<!-- endtimeline -->
{% endtimeline %}

## 写作原则

1. **先说明问题，再展示答案。** 缺少上下文的代码很难复用。
2. **记录取舍。** 一个方案为什么被保留，通常和它如何实现同样重要。
3. **区分事实、推断与计划。** 避免把尚未验证的想法写成确定结论。
4. **允许文章持续更新。** 工程认知会随项目演进，旧文章也应该被修正。
5. **尽量留下可验证的信息。** 包括路径、配置、调用链、复现条件和边界情况。

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
