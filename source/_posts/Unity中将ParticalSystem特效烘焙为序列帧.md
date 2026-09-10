---
title: Unity中将ParticalSystem特效烘焙为序列帧
cover: cover_cc954f23.png
top_img: false
toc: true
aside: true
abbrlink: cc954f23
date: 2026-09-09 17:07:00
update: 2026-09-09 17:07:00
categories: 引擎工具
tags:
  - Unity
description: 开发Unity内部工具把实时粒子特效预先录制成序列帧，运行时改用普通 Quad 播放，以降低粒子模拟和复杂渲染的性能开销。
keywords:
---
{% note info %}
完整源码、使用说明及最新版本请参见：[Unity-VFX-Baker](https://github.com/Ch1aki7/Unity-VFX-Baker)
{% endnote %}

## 代码原理

## 使用示例

为了更方便的进行调试操作，将特效从原始大项目中导出到小型demo中进行测试，以提升加载速度。

![](IMG-20260909172150692.png "在原始项目中导出特效相关文件")

在demo中导入后，挑选合适的特效进行播放，查看效果

![](IMG-20260909174405584.png "粒子特效包含物体")

![](IMG-20260910102529458.gif "原始粒子系统特效")

打开VFXBaker工具

![](IMG-20260909174503456.png "菜单面板")

设置好参数进行烘焙，相同名字的物体会被分为一组

![](IMG-20260909174536151.png)

最终结果包含各组的序列帧图片、prefab、材质以及AnimTex

![](IMG-20260909174929679.png "烘焙后的文件")

序列帧结果示例

![](cover_cc954f23.png)

材质示例

![](IMG-20260909175003687.png)

烘焙后的prefab分为预先设置好的组，可以分别进行开关

![](IMG-20260909175035911.png)

播放示例，运行时反复勾选可以从头播放

![](IMG-20260910105820666.gif)




